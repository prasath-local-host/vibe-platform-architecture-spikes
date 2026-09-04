import { describe, expect, it } from "vitest";
import { AssessmentService, AssessmentWorker } from "../src/assessment-service.js";
import { ForbiddenError, type Actor } from "../src/domain.js";
import { InMemoryAssessmentRepository } from "../src/in-memory-assessment-repository.js";
import { InMemoryAuditRepository } from "../src/in-memory-repositories.js";
import { InMemoryApplicationRepository } from "../src/in-memory-repositories.js";
import { ManifestAssessmentEngine } from "../src/manifest-assessment-engine.js";

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

async function fixture() {
  const audit = new InMemoryAuditRepository();
  const repository = new InMemoryAssessmentRepository(audit);
  const applications = new InMemoryApplicationRepository();
  await applications.register({
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-a",
    name: "Assessed application",
    repositoryUrl: "https://github.com/example/assessed.git",
    idempotencyKey: "registered-app",
    createdAt: new Date().toISOString(),
  }, {
    id: "22222222-2222-4222-8222-222222222222",
    occurredAt: new Date().toISOString(),
    actorSubject: "user-a",
    actorRole: "company-user",
    companyId: "company-a",
    action: "application.registered",
    entityType: "application",
    entityId: "11111111-1111-4111-8111-111111111111",
    correlationId: "registration",
  });
  const engine = new ManifestAssessmentEngine({
    async checkout(_repositoryUrl, revision) {
      return {
        revision,
        files: [
          { path: "package.json", content: JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "14", react: "18" } }) },
          { path: "package-lock.json", content: "{}" },
        ],
      };
    },
  });
  return {
    audit,
    repository,
    applications,
    engine,
    service: new AssessmentService(repository, applications),
  };
}

const command = {
  actor: companyA,
  companyId: "company-a",
  applicationId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "assessment-request",
  correlationId: "assessment-correlation",
  sourceRevision: "0123456789abcdef0123456789abcdef01234567",
} as const;

describe("asynchronous assessments", () => {
  it("submits idempotently and records one queued audit event", async () => {
    const { service, audit } = await fixture();
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
    const { service, repository, audit, applications, engine } = await fixture();
    const submitted = await service.submit(command);

    const restartedService = new AssessmentService(repository, applications);
    const restartedWorker = new AssessmentWorker("worker-after-restart", repository, engine);
    expect(await restartedWorker.tick()).toBe(true);

    const completed = await restartedService.get(companyA, "company-a", submitted.id);
    expect(completed).toMatchObject({
      status: "completed",
      attempts: 1,
      sourceRevision: command.sourceRevision,
      repositoryUrl: "https://github.com/example/assessed.git",
      result: {
        profile: "nextjs-web-application",
        detectedStack: ["nextjs", "nodejs", "react"],
        manifests: ["package.json", "package-lock.json"],
        findings: ["package.json does not define a test script", "No Dockerfile was detected"],
      },
    });
    expect(await audit.listByCompany("company-a")).toMatchObject([
      { action: "assessment.queued", correlationId: "assessment-correlation" },
      { action: "assessment.completed", correlationId: "assessment-correlation" },
    ]);
  });

  it("allows only one concurrent worker to claim a queued assessment", async () => {
    const { service, repository, engine } = await fixture();
    await service.submit(command);

    const outcomes = await Promise.all([
      new AssessmentWorker("worker-one", repository, engine).tick(),
      new AssessmentWorker("worker-two", repository, engine).tick(),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
  });

  it("enforces company isolation for assessment reads", async () => {
    const { service } = await fixture();
    const submitted = await service.submit(command);

    await expect(
      service.get(companyB, "company-a", submitted.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.list(companyB, "company-a", command.applicationId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
