import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuildArtifact } from "../src/artifact-service.js";
import { DockerTestDeploymentEngine } from "../src/docker-test-deployment-engine.js";
import type { ReleaseRecord } from "../src/domain.js";

const artifact = createBuildArtifact({ companyId: "company-a", applicationId: "22222222-2222-4222-8222-222222222222", buildId: "11111111-1111-4111-8111-111111111111", sourceRevision: "a".repeat(40), files: [{ path: "server.js", content: Buffer.from("server") }], retentionDays: 1, now: new Date().toISOString() });
const release: ReleaseRecord = { id: "33333333-3333-4333-8333-333333333333", companyId: artifact.companyId, applicationId: artifact.applicationId, buildId: artifact.buildId, artifactId: artifact.id, artifactDigest: artifact.digest, environment: "test", status: "deploying", idempotencyKey: "release-key", correlationId: "correlation", createdAt: new Date().toISOString() };
const image = `node@sha256:${"b".repeat(64)}`;
const deploymentRoot = join(tmpdir(), "vcp-deployment-engine-tests");

describe("Docker test deployment engine", () => {
  it("materializes a verified artifact and starts a hardened loopback container", async () => {
    const calls: readonly string[][] = [] as string[][];
    const runner = async (args: readonly string[]) => { (calls as string[][]).push([...args]); if (args[0] === "inspect") throw new Error("missing"); if (args[0] === "port") return "127.0.0.1:32768"; return "container"; };
    const engine = new DockerTestDeploymentEngine({ image, network: "vcp-test", deploymentRoot }, { async get() { return artifact; }, async put() {}, async deleteExpired() { return 0; } }, runner);
    await expect(engine.deploy(release)).resolves.toEqual({ deploymentUrl: "http://127.0.0.1:32768" });
    expect(calls[1]).toEqual(expect.arrayContaining(["--read-only", "--cap-drop", "ALL", "--network", "vcp-test", "-p", "127.0.0.1::3000"]));
  });

  it("reuses the deterministic container and performs bounded health checks", async () => {
    const calls: string[][] = [];
    const engine = new DockerTestDeploymentEngine({ image, network: "vcp-test", deploymentRoot, healthPath: "/ready" }, { async get() { return artifact; }, async put() {}, async deleteExpired() { return 0; } }, async (args) => { calls.push([...args]); return args[0] === "port" ? "127.0.0.1:32000" : "exists"; }, async (url, timeout) => url === "http://127.0.0.1:32000/ready" && timeout === 30_000);
    expect((await engine.deploy(release)).deploymentUrl).toBe("http://127.0.0.1:32000");
    expect(calls.some((args) => args[0] === "run")).toBe(false);
    await expect(engine.verifyHealth("http://127.0.0.1:32000")).resolves.toBe(true);
  });

  it("rejects mutable images and mismatched artifacts", async () => {
    expect(() => new DockerTestDeploymentEngine({ image: "node:24", network: "vcp-test", deploymentRoot: "x" }, {} as never)).toThrow("digest-pinned");
    const engine = new DockerTestDeploymentEngine({ image, network: "vcp-test", deploymentRoot }, { async get() { return { ...artifact, applicationId: "other" }; }, async put() {}, async deleteExpired() { return 0; } }, async () => "");
    await expect(engine.deploy(release)).rejects.toThrow();
  });

  it("restarts the previous healthy container and removes the failed candidate", async () => {
    const calls: string[][] = [];
    const engine = new DockerTestDeploymentEngine({ image, network: "vcp-test", deploymentRoot }, { async get() { return artifact; }, async put() {}, async deleteExpired() { return 0; } }, async (args) => { calls.push([...args]); return args[0] === "port" ? "127.0.0.1:31000" : "ok"; });
    const target = { ...release, id: "44444444-4444-4444-8444-444444444444", status: "healthy" as const, deploymentUrl: "http://127.0.0.1:30001" };
    await expect(engine.rollback(release, target)).resolves.toEqual({ deploymentUrl: "http://127.0.0.1:31000" });
    expect(calls.map((args) => args.slice(0, 2))).toEqual([["inspect", `vcp-test-${target.id}`], ["start", `vcp-test-${target.id}`], ["rm", "-f"], ["port", `vcp-test-${target.id}`]]);
  });

  it("retries health while a newly started container becomes ready", async () => {
    let attempts = 0;
    const engine = new DockerTestDeploymentEngine({ image, network: "vcp-test", deploymentRoot, healthAttempts: 3, healthIntervalMs: 1 }, { async get() { return artifact; }, async put() {}, async deleteExpired() { return 0; } }, async () => "", async () => { attempts += 1; return attempts === 3; });
    await expect(engine.verifyHealth("http://127.0.0.1:3000")).resolves.toBe(true);
    expect(attempts).toBe(3);
  });
});
