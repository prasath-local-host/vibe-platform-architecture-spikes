import { describe, expect, it } from "vitest";
import { BuildJobService, BuildJobWorker } from "../src/build-job-service.js";
import { ForbiddenError, type Actor } from "../src/domain.js";
import { InMemoryBuildRecordRepository } from "../src/in-memory-build-record-repository.js";
import { InMemoryApplicationRepository, InMemoryAuditRepository } from "../src/in-memory-repositories.js";

const actor: Actor = { subject: "user-a", role: "company-user", companyId: "company-a" };
const applicationId = "11111111-1111-4111-8111-111111111111";

async function fixture() {
  const audit = new InMemoryAuditRepository();
  const repository = new InMemoryBuildRecordRepository(audit);
  const applications = new InMemoryApplicationRepository();
  await applications.register({
    id: applicationId, companyId: "company-a", name: "Build app",
    repositoryUrl: "https://github.com/example/build-app", idempotencyKey: "registered-build-app",
    createdAt: new Date().toISOString(),
  }, {
    id: "22222222-2222-4222-8222-222222222222", occurredAt: new Date().toISOString(),
    actorSubject: actor.subject, actorRole: actor.role, companyId: "company-a",
    action: "application.registered", entityType: "application", entityId: applicationId, correlationId: "registration",
  });
  return { audit, repository, applications, service: new BuildJobService(repository, applications) };
}

const command = {
  actor, companyId: "company-a", applicationId, sourceRevision: "a".repeat(40),
  packageManager: "npm", script: "build", idempotencyKey: "build-request-1", correlationId: "build-correlation",
} as const;

describe("asynchronous build jobs", () => {
  it("submits idempotently with one audit event", async () => {
    const { service, audit } = await fixture();
    const [first, retry] = await Promise.all([service.submit(command), service.submit(command)]);
    expect(retry.id).toBe(first.id);
    expect(first).toMatchObject({ status: "queued", attempts: 0, repositoryUrl: "https://github.com/example/build-app" });
    expect(await audit.listByCompany("company-a")).toMatchObject([{ action: "build.queued", entityType: "build" }]);
  });

  it("completes a claimed build and records immutable result evidence", async () => {
    const { service, repository, audit } = await fixture();
    const queued = await service.submit(command);
    const worker = new BuildJobWorker("worker-one", repository, {
      async execute(build) {
        expect(build).toMatchObject({ sourceRevision: "a".repeat(40), packageManager: "npm", script: "build" });
        return { artifactDigest: `sha256:${"b".repeat(64)}`, restorationStatus: "succeeded", buildStatus: "succeeded" };
      },
    });
    expect(await worker.tick()).toBe(true);
    expect(await service.get(actor, "company-a", queued.id)).toMatchObject({ status: "completed", attempts: 1, result: { buildStatus: "succeeded" } });
    expect((await audit.listByCompany("company-a")).map((entry) => entry.action)).toEqual(["build.queued", "build.completed"]);
  });

  it("persists a safe terminal failure", async () => {
    const { service, repository } = await fixture();
    const queued = await service.submit(command);
    await new BuildJobWorker("worker-one", repository, { async execute() { throw new Error("pipeline failed"); } }).tick();
    expect(await service.get(actor, "company-a", queued.id)).toMatchObject({ status: "failed", error: "pipeline failed" });
  });

  it("enforces tenant isolation", async () => {
    const { service } = await fixture();
    const queued = await service.submit(command);
    const other: Actor = { subject: "user-b", role: "company-user", companyId: "company-b" };
    await expect(service.get(other, "company-a", queued.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.list(other, "company-a", applicationId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
