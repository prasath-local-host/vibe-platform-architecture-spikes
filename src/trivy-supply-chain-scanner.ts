import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { verifySourceArtifact, type SourceArtifact } from "./build-service.js";
import type { SupplyChainEvidence, SupplyChainScanner } from "./supply-chain-security.js";
import { withScannerCache } from "./scanner-cache.js";

const executeFile = promisify(execFile);
const pinnedImage = /^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[0-9a-f]{64}$/;
const reportSchema = z.object({
  bomFormat: z.literal("CycloneDX"), specVersion: z.string().min(1),
  metadata: z.object({ component: z.object({ name: z.string().min(1) }).passthrough() }).passthrough(),
  components: z.array(z.object({ name: z.string(), version: z.string().optional() }).passthrough()).optional(),
  vulnerabilities: z.array(z.object({
    id: z.string().min(1),
    ratings: z.array(z.object({ severity: z.string() }).passthrough()).min(1),
  }).passthrough()).optional(),
}).passthrough();

export interface TrivyScannerConfig {
  readonly image: string;
  readonly network: string;
  readonly evidenceRoot: string;
  readonly timeoutMs?: number;
  readonly cacheRoot?: string;
}

type Runner = (args: readonly string[], timeoutMs: number) => Promise<string>;
async function runDocker(args: readonly string[], timeoutMs: number): Promise<string> {
  const { stdout } = await executeFile("docker", [...args], {
    timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  return stdout;
}

export class TrivySupplyChainScanner implements SupplyChainScanner {
  private readonly root: string;
  constructor(private readonly config: TrivyScannerConfig, private readonly runner: Runner = runDocker) {
    if (!pinnedImage.test(config.image)) throw new Error("A digest-pinned Trivy image is required");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(config.network)) throw new Error("Scanner network is invalid");
    if (!config.evidenceRoot) throw new Error("Scanner evidence root is required");
    if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 600_000)) throw new Error("Scanner timeout is invalid");
    this.root = resolve(config.evidenceRoot);
  }

  async scanSource(companyId: string, buildId: string, source: SourceArtifact): Promise<SupplyChainEvidence> {
    verifySourceArtifact(source);
    const workspace = await mkdtemp(join(tmpdir(), "vcp-scan-"));
    try {
      let bytes = 0;
      if (source.files.length > 5000) throw new Error("Scanner source file limit exceeded");
      for (const file of source.files) {
        // Reject cross-platform path tricks before constructing any host path.
        if (!file.path || /[\\:\x00]/.test(file.path) || file.path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe scanner source path");
        bytes += Buffer.byteLength(file.content);
        if (bytes > 50 * 1024 * 1024) throw new Error("Scanner source byte limit exceeded");
        const destination = join(workspace, file.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, { flag: "wx" });
      }
      if (!source.files.some((file) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file.path))) throw new Error("Source scan requires a supported dependency lockfile");
      if (workspace.includes(",")) throw new Error("Scanner workspace cannot contain Docker mount separators");
      return await this.scan(companyId, buildId, source.digest, "fs", "/source", workspace);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async scanImage(companyId: string, releaseId: string, image: string): Promise<SupplyChainEvidence> {
    if (!pinnedImage.test(image)) throw new Error("A digest-pinned scan target is required");
    return this.scan(companyId, releaseId, image, "image", image);
  }

  private async scan(companyId: string, entityId: string, identity: string, kind: "fs" | "image", target: string, workspace?: string): Promise<SupplyChainEvidence> {
    if (this.config.cacheRoot) return withScannerCache(this.config.cacheRoot, (cache) => this.scanLocked(companyId, entityId, identity, kind, target, workspace, cache));
    return this.scanLocked(companyId, entityId, identity, kind, target, workspace);
  }

  private async scanLocked(companyId: string, entityId: string, identity: string, kind: "fs" | "image", target: string, workspace?: string, cache?: string): Promise<SupplyChainEvidence> {
    const id = randomUUID();
    const container = `vcp-scan-${id}`;
    const timeout = this.config.timeoutMs ?? 300_000;
    let output: string;
    try {
      output = await this.runner([
        "run", "--rm", "--name", container, "--network", this.config.network,
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--user", "65532:65532", "--pids-limit", "128", "--memory", "3g", "--cpus", "2",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=2g", "--workdir", "/tmp", "--entrypoint", "trivy",
        ...(workspace ? ["--mount", `type=bind,source=${workspace},target=/source,readonly`] : []),
        ...(cache ? ["--mount", `type=bind,source=${cache},target=/cache`] : []),
        this.config.image, kind, "--quiet", "--config", "/dev/null", "--ignorefile", "/dev/null",
        "--cache-dir", cache ? "/cache" : "/tmp/trivy-cache", "--cache-backend", "memory", "--timeout", `${Math.floor(timeout / 1000)}s`,
        "--scanners", "vuln", "--format", "cyclonedx", "--exit-code", "0",
        ...(kind === "image" ? ["--image-src", "remote"] : ["--include-dev-deps"]), target,
      ], timeout);
    } catch (cause) {
      throw new Error("Supply-chain scanner unavailable or timed out; approval denied", { cause });
    } finally {
      // Killing the host Docker CLI does not necessarily stop its container.
      try { await this.runner(["rm", "-f", container], 10_000); } catch { /* --rm may already have removed it */ }
    }
    if (Buffer.byteLength(output) > 16 * 1024 * 1024) throw new Error("Scanner report exceeds limit");
    const report = reportSchema.parse(JSON.parse(output));
    const blocked = (report.vulnerabilities ?? []).filter((vulnerability) =>
      vulnerability.ratings.some((rating) => !["none", "low", "medium"].includes(rating.severity.toLowerCase())));
    const evidence = JSON.stringify({
      id, companyId, entityId, identity, kind, scannerImage: this.config.image,
      scannedAt: new Date().toISOString(), policy: "block-high-critical-unknown/v1",
      status: blocked.length ? "rejected" : "approved", report,
    });
    const digest = `sha256:${createHash("sha256").update(evidence).digest("hex")}`;
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `${id}.tmp`);
    try { await writeFile(temporary, evidence, { flag: "wx" }); await rename(temporary, join(this.root, `${id}.json`)); }
    finally { await rm(temporary, { force: true }); }
    if (blocked.length) throw new Error(`Supply-chain policy rejected ${blocked.length} vulnerabilities; evidence ${id}`);
    return { id, digest };
  }
}
