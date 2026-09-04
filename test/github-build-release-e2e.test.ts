import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BuildRecordRepository } from "../src/build-job-service.js";
import { SourceBuildJobEngine } from "../src/build-job-engine.js";
import { DockerBuildPipeline } from "../src/docker-build-pipeline.js";
import { DockerTestDeploymentEngine } from "../src/docker-test-deployment-engine.js";
import type { Actor, BuildRecord } from "../src/domain.js";
import { FilesystemArtifactStore } from "../src/filesystem-artifact-store.js";
import { FilesystemIngressRouter } from "../src/filesystem-ingress-router.js";
import { GitHubSourceArtifactRepository } from "../src/git-source-artifact-repository.js";
import { InMemoryReleaseRepository } from "../src/in-memory-release-repository.js";
import { InMemoryAuditRepository } from "../src/in-memory-repositories.js";
import { ReleaseService, ReleaseWorker } from "../src/release-service.js";

const image = process.env.VCP_E2E_RUNTIME_IMAGE;
const revision = process.env.VCP_E2E_GITHUB_REVISION;
const repositoryUrl = process.env.VCP_E2E_GITHUB_REPOSITORY_URL
  ?? "https://github.com/prasath-local-host/vibe-platform-architecture-spikes.git";
const executeFile = promisify(execFile);
const companyId = "e2e-platform-company";
const applicationId = "44444444-4444-4444-8444-444444444444";
const actor: Actor = { subject: "e2e-operator", role: "operator" };

describe.skipIf(!image || !revision)("GitHub build and release E2E", () => {
  let root: string;
  let network: string;
  const containers: string[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "vcp-github-release-e2e-"));
    network = `vcp-e2e-${randomUUID()}`;
    await executeFile("docker", ["network", "create", network], { windowsHide: true });
  }, 30_000);

  afterAll(async () => {
    for (const container of containers) {
      try { await executeFile("docker", ["rm", "-f", container], { windowsHide: true }); } catch {}
    }
    if (network) {
      try { await executeFile("docker", ["network", "rm", network], { windowsHide: true }); } catch {}
    }
    if (root) await rm(root, { recursive: true, force: true });
  }, 30_000);

  it("fetches an exact GitHub revision, builds it without build egress, deploys it, verifies health, and activates its route", async () => {
    const store = new FilesystemArtifactStore(join(root, "artifacts"));
    const build: BuildRecord = {
      id: randomUUID(), companyId, applicationId, repositoryUrl, sourceRevision: revision!,
      packageManager: "npm", script: "build", idempotencyKey: "github-e2e-build",
      correlationId: randomUUID(), status: "running", attempts: 1, createdAt: new Date().toISOString(),
    };
    const engine = new SourceBuildJobEngine(
      new GitHubSourceArtifactRepository({ timeoutMs: 120_000 }),
      new DockerBuildPipeline({
        image: image!, egressNetwork: network, registryUrl: "https://registry.npmjs.org/",
        allowedRegistryOrigins: ["https://registry.npmjs.org"], workingDirectory: "fixtures/platform-node-app",
        outputDirectories: ["dist"], restoreTimeoutMs: 120_000, buildTimeoutMs: 60_000,
      }),
      store,
      1,
    );
    const result = await engine.execute(build);
    const completed: BuildRecord = { ...build, status: "completed", result, completedAt: new Date().toISOString() };
    const builds: BuildRecordRepository = {
      async findById(requestCompanyId, buildId) { return requestCompanyId === companyId && buildId === completed.id ? completed : undefined; },
      async submit(value) { return value; }, async listByApplication() { return [completed]; },
      async claimNext() { return undefined; }, async complete() {}, async fail() {},
    };
    const audit = new InMemoryAuditRepository();
    const releases = new InMemoryReleaseRepository(audit);
    const routes = new FilesystemIngressRouter(join(root, "routes"));
    const release = await new ReleaseService(releases, builds).create({
      actor, companyId, applicationId, buildId: completed.id,
      idempotencyKey: "github-e2e-release", correlationId: randomUUID(),
    });
    containers.push(`vcp-test-${release.id}`);
    const deployment = new DockerTestDeploymentEngine({
      image: image!, network, deploymentRoot: join(root, "deployments"),
      command: ["node", "dist/server.js"], healthAttempts: 20, healthIntervalMs: 250,
    }, store);

    expect(await new ReleaseWorker("github-e2e", releases, deployment, routes).tick()).toBe(true);
    expect(await releases.findById(companyId, release.id)).toMatchObject({ status: "healthy" });
    expect(await routes.current(companyId, applicationId)).toMatchObject({ releaseId: release.id });
    expect((await audit.listByCompany(companyId)).map((event) => event.action)).toEqual(expect.arrayContaining(["release.queued", "release.healthy"]));
  }, 180_000);
});
