import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBuildArtifact } from "../src/artifact-service.js";
import type { BuildRecordRepository } from "../src/build-job-service.js";
import { DockerTestDeploymentEngine } from "../src/docker-test-deployment-engine.js";
import type { Actor, BuildRecord } from "../src/domain.js";
import { FilesystemArtifactStore } from "../src/filesystem-artifact-store.js";
import { FilesystemIngressRouter } from "../src/filesystem-ingress-router.js";
import { InMemoryReleaseRepository } from "../src/in-memory-release-repository.js";
import { InMemoryAuditRepository } from "../src/in-memory-repositories.js";
import { ReleaseService, ReleaseWorker } from "../src/release-service.js";
import { TraefikFileReconciler } from "../src/traefik-file-reconciler.js";

const image = process.env.VCP_E2E_RUNTIME_IMAGE;
const executeFile = promisify(execFile);
const companyId = "e2e-company";
const applicationId = "11111111-1111-4111-8111-111111111111";
const actor: Actor = { subject: "e2e-operator", role: "operator" };

describe.skipIf(!image)("release routing E2E", () => {
  let root: string; let network: string; const containers: string[] = [];
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "vcp-release-e2e-")); network = `vcp-e2e-${randomUUID()}`; await executeFile("docker", ["network", "create", network], { windowsHide: true }); }, 30_000);
  afterAll(async () => {
    for (const container of containers) { try { await executeFile("docker", ["rm", "-f", container], { windowsHide: true }); } catch {} }
    if (network) { try { await executeFile("docker", ["network", "rm", network], { windowsHide: true }); } catch {} }
    if (root) await rm(root, { recursive: true, force: true });
  }, 30_000);

  it("deploys healthy, switches traffic, rejects unhealthy, and restores the route", async () => {
    const store = new FilesystemArtifactStore(join(root, "artifacts"));
    const builds = new Map<string, BuildRecord>();
    for (const [healthy, digit] of [[true, "2"], [false, "3"]] as const) {
      const buildId = `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
      const source = `const http=require('node:http');http.createServer((q,r)=>{r.statusCode=q.url==='/health'?${healthy ? 200 : 503}:200;r.end('${healthy ? "healthy" : "candidate"}')}).listen(3000,'0.0.0.0')`;
      const artifact = createBuildArtifact({ companyId, applicationId, buildId, sourceRevision: digit.repeat(40), files: [{ path: "server.js", content: Buffer.from(source) }], retentionDays: 1 });
      await store.put(artifact);
      builds.set(buildId, { id: buildId, companyId, applicationId, repositoryUrl: "https://example.invalid/platform-fixture", sourceRevision: digit.repeat(40), packageManager: "npm", script: "build", idempotencyKey: `build-${digit}`, correlationId: `correlation-${digit}`, status: "completed", attempts: 1, result: { artifactId: artifact.id, artifactDigest: artifact.digest, restorationStatus: "succeeded", buildStatus: "succeeded", securityStatus: "approved", securityScanner: "test-scanner/1", securityScannedAt: new Date().toISOString() }, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    }
    const buildRepository: BuildRecordRepository = { async findById(_company, id) { return builds.get(id); }, async submit(value) { return value; }, async listByApplication() { return [...builds.values()]; }, async claimNext() { return undefined; }, async complete() {}, async fail() {} };
    const audit = new InMemoryAuditRepository(); const releases = new InMemoryReleaseRepository(audit); const service = new ReleaseService(releases, buildRepository);
    const routes = new FilesystemIngressRouter(join(root, "routes"));
    const deployment = new DockerTestDeploymentEngine({ image: image!, network, deploymentRoot: join(root, "deployments"), healthAttempts: 20, healthIntervalMs: 250 }, store);
    const healthyBuild = [...builds.values()][0]!; const badBuild = [...builds.values()][1]!;
    const healthy = await service.create({ actor, companyId, applicationId, buildId: healthyBuild.id, idempotencyKey: "healthy-release", correlationId: "healthy" }); containers.push(`vcp-test-${healthy.id}`);
    await new ReleaseWorker("e2e", releases, deployment, routes).tick();
    expect((await service.get(actor, companyId, healthy.id))?.status).toBe("healthy");
    const candidate = await service.create({ actor, companyId, applicationId, buildId: badBuild.id, idempotencyKey: "candidate-release", correlationId: "candidate" }); containers.push(`vcp-test-${candidate.id}`);
    await new ReleaseWorker("e2e", releases, deployment, routes).tick();
    expect(await service.get(actor, companyId, candidate.id)).toMatchObject({ status: "rolled-back", rollbackTargetReleaseId: healthy.id });
    expect((await routes.current(companyId, applicationId))?.releaseId).toBe(healthy.id);
    const traefikPath = join(root, "traefik", "vcp.json"); await new TraefikFileReconciler(routes, traefikPath).reconcile();
    expect(JSON.parse(await readFile(traefikPath, "utf8")).http.routers[`vcp-${applicationId}`]).toBeDefined();
    expect((await audit.listByCompany(companyId)).map((event) => event.action)).toContain("release.rolled_back");
  }, 90_000);
});
