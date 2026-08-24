import { describe, expect, it } from "vitest";
import { AssessmentService, AssessmentWorker } from "../src/assessment-service.js";
import { ForbiddenError, type Actor } from "../src/domain.js";
import { InMemoryAssessmentRepository } from "../src/in-memory-assessment-repository.js";
import { InMemoryAuditRepository } from "../src/in-memory-repositories.js";

const companyA: Actor = {
  subject: "user-a",
  role: "company-user",
  companyId: "company-a",
};
const companyB: Actor = {
  subject: "user-b",
  role: "company-user",
  companyId: "company-b",
};

function fixture() {
  const audit = new InMemoryAuditRepository();
  const repository = new InMemoryAssessmentRepository(audit);
  return {
    audit,
    repository,
    service: new AssessmentService(repository),
  };
}

const command = {
  actor: companyA,
  companyId: "company-a",
  applicationId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "assessment-request",
  correlationId: "assessment-correlation",
} as const;

describe("asynchronous assessments", () => {
  it("submits idempotently and records one queued audit event", async () => {
    const { service, audit } = fixture();
    const [first, duplicate] = await Promise.all([
      service.submit(command),
      service.submit(command),
    ]);

    expect(duplicate.id).toBe(first.id);
    expect(first.status).toBe("queued");
    expect(await audit.listByCompany("company-a")).toMatchObject([
      { action: "assessment.queued", correlationId: "assessment-correlation" },
    ]);
  });

  it("completes queued work independently after a service restart", async () => {
    const { service, repository, audit } = fixture();
    const submitted = await service.submit(command);

    const restartedService = new AssessmentService(repository);
    const restartedWorker = new AssessmentWorker("worker-after-restart", repository);
    expect(await restartedWorker.tick()).toBe(true);

    const completed = await restartedService.get(companyA, "company-a", submitted.id);
    expect(completed).toMatchObject({
      status: "completed",
      attempts: 1,
      result: { profile: "placeholder-web-application", findings: [] },
    });
    expect(await audit.listByCompany("company-a")).toMatchObject([
      { action: "assessment.queued", correlationId: "assessment-correlation" },
      { action: "assessment.completed", correlationId: "assessment-correlation" },
    ]);
  });

  it("allows only one concurrent worker to claim a queued assessment", async () => {
    const { service, repository } = fixture();
    await service.submit(command);

    const outcomes = await Promise.all([
      new AssessmentWorker("worker-one", repository).tick(),
      new AssessmentWorker("worker-two", repository).tick(),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
  });

  it("enforces company isolation for assessment reads", async () => {
    const { service } = fixture();
    const submitted = await service.submit(command);

    await expect(
      service.get(companyB, "company-a", submitted.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.list(companyB, "company-a", command.applicationId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
