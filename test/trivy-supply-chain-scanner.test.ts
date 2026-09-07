import { mkdtemp, readFile, readdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceArtifact } from "../src/build-service.js";
import { TrivySupplyChainScanner } from "../src/trivy-supply-chain-scanner.js";

const image = `aquasec/trivy@sha256:${"a".repeat(64)}`;
const runtime = `node@sha256:${"b".repeat(64)}`;
const report = { bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { name: "fixture" } }, components: [] };
const roots: string[] = [];
async function root() { const value = await mkdtemp(join(tmpdir(), "vcp-scan-test-")); roots.push(value); return value; }
afterEach(async () => { for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true }); });

describe("Trivy supply-chain boundary", () => {
  it("rejects unscannable source instead of approving an empty dependency inventory", async () => {
    const scanner = new TrivySupplyChainScanner({ image, network: "scanner-egress", evidenceRoot: await root() }, async () => JSON.stringify(report));
    await expect(scanner.scanSource("company-a", "build-a", createSourceArtifact("c".repeat(40), []))).rejects.toThrow("supported dependency lockfile");
  });
  it("retains digest-bound CycloneDX evidence and uses an isolated read-only source mount", async () => {
    const evidenceRoot = await root(); const calls: string[][] = []; let workspace = "";
    const scanner = new TrivySupplyChainScanner({ image, network: "scanner-egress", evidenceRoot }, async (args) => {
      calls.push([...args]);
      if (args[0] === "run") {
        workspace = args[args.indexOf("--mount") + 1]!.split(",source=")[1]!.split(",target=")[0]!;
        await expect(readFile(join(workspace, "package-lock.json"), "utf8")).resolves.toBe("{}");
      }
      return JSON.stringify(report);
    });
    const source = createSourceArtifact("c".repeat(40), [{ path: "package-lock.json", content: "{}" }]);
    const evidence = await scanner.scanSource("company-a", "build-a", source);
    const stored = await readFile(join(evidenceRoot, `${evidence.id}.json`), "utf8");
    expect(JSON.parse(stored)).toMatchObject({ companyId: "company-a", identity: source.digest, status: "approved", report });
    expect(evidence.digest).toBe(`sha256:${createHash("sha256").update(stored).digest("hex")}`);
    expect(calls[0]).toEqual(expect.arrayContaining(["--read-only", "--user", "65532:65532", "--ignorefile", "/dev/null", "cyclonedx"]));
    expect(calls[1]!.slice(0, 2)).toEqual(["rm", "-f"]);
    await expect(access(workspace)).rejects.toBeDefined();
  });

  it.each(["high", "critical", "unknown", "unrecognized"])("blocks %s vulnerabilities and retains rejection evidence", async (severity) => {
    const evidenceRoot = await root();
    const scanner = new TrivySupplyChainScanner({ image, network: "scanner-egress", evidenceRoot }, async () => JSON.stringify({ ...report, vulnerabilities: [{ id: "CVE-fixture", ratings: [{ severity }] }] }));
    await expect(scanner.scanImage("company-a", "release-a", runtime)).rejects.toThrow("policy rejected");
    const files = await readdir(evidenceRoot);
    expect(JSON.parse(await readFile(join(evidenceRoot, files[0]!), "utf8"))).toMatchObject({ status: "rejected", identity: runtime });
  });

  it.each(["{}", "not-json", JSON.stringify({ ...report, vulnerabilities: [{ id: "CVE-no-rating", ratings: [] }] })])("denies malformed reports", async (output) => {
    const evidenceRoot = await root();
    const scanner = new TrivySupplyChainScanner({ image, network: "scanner-egress", evidenceRoot }, async () => output);
    await expect(scanner.scanImage("company-a", "release-a", runtime)).rejects.toThrow();
    expect(await readdir(evidenceRoot)).toEqual([]);
  });

  it("cleans up after scanner failure without granting approval", async () => {
    const calls: string[][] = [];
    const scanner = new TrivySupplyChainScanner({ image, network: "scanner-egress", evidenceRoot: await root() }, async (args) => { calls.push([...args]); throw new Error("timeout"); });
    await expect(scanner.scanImage("company-a", "release-a", runtime)).rejects.toThrow("approval denied");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(["--image-src", "remote", runtime]));
  });

  it.each(["../escape", "C:/escape", "folder\\escape", "/escape"])("rejects unsafe source path %s", async (path) => {
    const scanner = new TrivySupplyChainScanner({ image, network: "scanner-egress", evidenceRoot: await root() }, async () => { throw new Error("must not run"); });
    await expect(scanner.scanSource("company-a", "build-a", createSourceArtifact("c".repeat(40), [{ path, content: "x" }]))).rejects.toThrow("Unsafe scanner source path");
  });
});
