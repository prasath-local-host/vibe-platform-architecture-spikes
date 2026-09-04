import { describe, expect, it } from "vitest";
import type { BuildRecordRepository } from "../src/build-job-service.js";
import type { Actor, BuildRecord, ReleaseRecord } from "../src/domain.js";
import { InMemoryAuditRepository } from "../src/in-memory-repositories.js";
import { InMemoryReleaseRepository } from "../src/in-memory-release-repository.js";
import { ReleaseService, ReleaseWorker } from "../src/release-service.js";

const actor: Actor = { subject: "user-a", role: "company-user", companyId: "company-a" };
const build: BuildRecord = {
  id: "11111111-1111-4111-8111-111111111111", companyId: "company-a", applicationId: "22222222-2222-4222-8222-222222222222",
  repositoryUrl: "https://github.com/example/app", sourceRevision: "a".repeat(40), packageManager: "npm", script: "build",
  idempotencyKey: "build-request", correlationId: "build-correlation", status: "completed", attempts: 1,
  result: { artifactId: "33333333-3333-4333-8333-333333333333", artifactDigest: `sha256:${"b".repeat(64)}`, restorationStatus: "succeeded", buildStatus: "succeeded", securityStatus: "approved", securityScanner: "test-scanner/1", securityScannedAt: new Date().toISOString() },
  createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
};
const builds: BuildRecordRepository = {
  async findById(companyId, id) { return companyId === build.companyId && id === build.id ? build : undefined; },
  async submit(value) { return value; }, async listByApplication() { return []; }, async claimNext() { return undefined; }, async complete() {}, async fail() {},
};

describe("test release lifecycle", () => {
  it("deploys and records successful health verification", async () => {
    const audit = new InMemoryAuditRepository(); const repository = new InMemoryReleaseRepository(audit);
    const service = new ReleaseService(repository, builds);
    const release = await service.create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "release-request", correlationId: "release-correlation" });
    expect(release).toMatchObject({ status: "pending", environment: "test", artifactId: build.result!.artifactId });
    const activations: string[] = [];
    await new ReleaseWorker("release-worker", repository, { async deploy() { return { deploymentUrl: "https://test.example.invalid" }; }, async rollback() { throw new Error("unused"); }, async verifyHealth() { return true; } }, { async activate(command) { activations.push(command.releaseId); return { route: { ...command, stablePath: "/apps/company-a/app" } }; }, async current() { return undefined; }, async list() { return []; } }).tick();
    expect(await service.get(actor, "company-a", release.id)).toMatchObject({ status: "healthy", deploymentUrl: "https://test.example.invalid" });
    expect(activations).toEqual([release.id]);
    expect((await audit.listByCompany("company-a")).map((event) => event.action)).toEqual(["release.queued", "release.healthy"]);
  });

  it("records failed health verification", async () => {
    const repository = new InMemoryReleaseRepository(new InMemoryAuditRepository()); const service = new ReleaseService(repository, builds);
    const release = await service.create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "failed-release", correlationId: "release-correlation" });
    await new ReleaseWorker("release-worker", repository, { async deploy() { return { deploymentUrl: "https://unhealthy.invalid" }; }, async rollback() { throw new Error("unused"); }, async verifyHealth() { return false; } }).tick();
    expect(await service.get(actor, "company-a", release.id)).toMatchObject({ status: "failed", error: "Deployment health verification failed" });
  });

  it("rejects incomplete builds and captures the previous healthy rollback target", async () => {
    const repository = new InMemoryReleaseRepository(new InMemoryAuditRepository()); const service = new ReleaseService(repository, builds);
    const first = await service.create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "first-release", correlationId: "one" });
    await new ReleaseWorker("worker", repository, { async deploy() { return { deploymentUrl: "https://one.invalid" }; }, async rollback() { throw new Error("unused"); }, async verifyHealth() { return true; } }).tick();
    const second = await service.create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "second-release", correlationId: "two" });
    expect(second.rollbackTargetReleaseId).toBe(first.id);
    const { result: _result, ...buildWithoutResult } = build;
    const incomplete: BuildRecordRepository = { ...builds, async findById() { return { ...buildWithoutResult, status: "running" }; } };
    await expect(new ReleaseService(repository, incomplete).create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "bad-release", correlationId: "bad" })).rejects.toThrow("completed build");
  });

  it("rejects a build without an approved artifact-security decision", async () => {
    const repository = new InMemoryReleaseRepository(new InMemoryAuditRepository());
    const unapproved: BuildRecordRepository = { ...builds, async findById() { return { ...build, result: { ...build.result!, securityStatus: "rejected" } }; } };
    await expect(new ReleaseService(repository, unapproved).create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "unsafe-release", correlationId: "unsafe" }))
      .rejects.toThrow("security-approved");
  });

  it("automatically restores and verifies the previous healthy release", async () => {
    const audit = new InMemoryAuditRepository(); const repository = new InMemoryReleaseRepository(audit); const service = new ReleaseService(repository, builds);
    const first = await service.create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "healthy-release", correlationId: "one" });
    let deployment = 0;
    const engine = {
      async deploy() { deployment += 1; return { deploymentUrl: deployment === 1 ? "https://healthy.invalid" : "https://candidate.invalid" }; },
      async rollback(_release: ReleaseRecord, target: ReleaseRecord) { return { deploymentUrl: target.deploymentUrl! }; },
      async verifyHealth(url: string) { return url === "https://healthy.invalid"; },
    };
    const activations: string[] = [];
    const ingress = { async activate(command: { releaseId: string; companyId: string; applicationId: string; upstreamUrl: string; activatedAt: string }) { activations.push(command.releaseId); return { route: { ...command, stablePath: "/apps/company-a/app" } }; }, async current() { return undefined; }, async list() { return []; } };
    await new ReleaseWorker("worker", repository, engine, ingress).tick();
    const second = await service.create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "rollback-release", correlationId: "two" });
    expect(second.rollbackTargetReleaseId).toBe(first.id);
    await new ReleaseWorker("worker", repository, engine, ingress).tick();
    expect(await service.get(actor, "company-a", second.id)).toMatchObject({ status: "rolled-back", deploymentUrl: "https://healthy.invalid", error: "Deployment health verification failed" });
    expect((await audit.listByCompany("company-a")).at(-1)?.action).toBe("release.rolled_back");
    expect(activations).toEqual([first.id, first.id]);
  });

  it("does not activate ingress when direct candidate health verification fails", async () => {
    const repository = new InMemoryReleaseRepository(new InMemoryAuditRepository()); const service = new ReleaseService(repository, builds);
    await service.create({ actor, companyId: "company-a", applicationId: build.applicationId, buildId: build.id, idempotencyKey: "unhealthy-route", correlationId: "route" });
    let activated = false;
    await new ReleaseWorker("worker", repository, { async deploy() { return { deploymentUrl: "https://bad.invalid" }; }, async rollback() { throw new Error("unused"); }, async verifyHealth() { return false; } }, { async activate(command) { activated = true; return { route: { ...command, stablePath: "/apps/company-a/app" } }; }, async current() { return undefined; }, async list() { return []; } }).tick();
    expect(activated).toBe(false);
  });
});
