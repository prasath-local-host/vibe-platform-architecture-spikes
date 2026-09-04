import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import { verifyBuildArtifact, type ArtifactStore } from "./artifact-service.js";
import type { ReleaseRecord } from "./domain.js";
import type { DeploymentEngine } from "./release-service.js";

const executeFile = promisify(execFile);
type DockerRunner = (args: readonly string[], timeoutMs: number) => Promise<string>;
type HealthFetcher = (url: string, timeoutMs: number) => Promise<boolean>;

export interface DockerTestDeploymentConfig {
  readonly image: string;
  readonly network: string;
  readonly deploymentRoot: string;
  readonly containerPort?: number;
  readonly command?: readonly string[];
  readonly timeoutMs?: number;
  readonly healthPath?: string;
}

function safePath(value: string): string {
  const normalized = normalize(value.replaceAll("\\", "/"));
  if (!value || isAbsolute(value) || normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Artifact contains an unsafe path");
  return normalized;
}

async function runDocker(args: readonly string[], timeoutMs: number): Promise<string> {
  const { stdout } = await executeFile("docker", [...args], { timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  return stdout.trim();
}

async function fetchHealth(url: string, timeoutMs: number): Promise<boolean> {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" }); return response.ok; }
  catch { return false; }
}

export class DockerTestDeploymentEngine implements DeploymentEngine {
  constructor(private readonly config: DockerTestDeploymentConfig, private readonly artifacts: ArtifactStore, private readonly runner: DockerRunner = runDocker, private readonly healthFetcher: HealthFetcher = fetchHealth) {
    if (!/@sha256:[0-9a-f]{64}$/i.test(config.image)) throw new Error("A digest-pinned deployment image is required");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(config.network)) throw new Error("Deployment network is invalid");
    if (!config.deploymentRoot) throw new Error("Deployment root is required");
  }

  async deploy(release: ReleaseRecord): Promise<{ readonly deploymentUrl: string }> {
    const artifact = await this.artifacts.get(release.companyId, release.artifactId);
    if (!artifact) throw new Error("Build artifact not found");
    verifyBuildArtifact(artifact);
    if (artifact.digest !== release.artifactDigest || artifact.applicationId !== release.applicationId) throw new Error("Build artifact does not match release record");
    const root = join(this.config.deploymentRoot, release.id);
    await mkdir(root, { recursive: true });
    for (const file of artifact.files) {
      const destination = join(root, safePath(file.path));
      if (relative(root, destination).startsWith("..")) throw new Error("Artifact escaped deployment root");
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content);
    }
    const name = `vcp-test-${release.id}`;
    const timeout = this.config.timeoutMs ?? 30_000;
    try { await this.runner(["inspect", name], timeout); }
    catch {
      await this.runner(["run", "-d", "--name", name, "--label", `vcp.release=${release.id}`, "--network", this.config.network, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "512m", "--cpus", "1", "--user", "65532:65532", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--mount", `type=bind,source=${root},target=/app,readonly`, "--workdir", "/app", "-p", `127.0.0.1::${this.config.containerPort ?? 3000}`, this.config.image, ...(this.config.command ?? ["node", "server.js"])], timeout);
    }
    const mapping = await this.runner(["port", name, String(this.config.containerPort ?? 3000)], timeout);
    const match = mapping.match(/127\.0\.0\.1:(\d+)/);
    if (!match) throw new Error("Docker did not publish a loopback deployment port");
    return { deploymentUrl: `http://127.0.0.1:${match[1]}` };
  }

  async verifyHealth(deploymentUrl: string): Promise<boolean> {
    const healthUrl = new URL(this.config.healthPath ?? "/health", deploymentUrl).toString();
    return this.healthFetcher(healthUrl, this.config.timeoutMs ?? 30_000);
  }
}
