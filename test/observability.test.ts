import { describe, expect, it } from "vitest";
import {
  runWithCorrelation,
  StructuredLogger,
  type LogRecord,
} from "../src/observability.js";
import { AssessmentService, AssessmentWorker } from "../src/assessment-service.js";
import { InMemoryAssessmentRepository } from "../src/in-memory-assessment-repository.js";
import { InMemoryAuditRepository } from "../src/in-memory-repositories.js";

describe("structured correlation evidence", () => {
  it("emits machine-readable records and inherits asynchronous context", async () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger("test-service", (record) => records.push(record));

    await runWithCorrelation("corr-http-1", async () => {
      await Promise.resolve();
      logger.info("database.query.completed", { durationMs: 2.5 });
    });

    expect(records).toMatchObject([
      {
        level: "info",
        event: "database.query.completed",
        service: "test-service",
        correlationId: "corr-http-1",
        durationMs: 2.5,
      },
    ]);
    expect(() => JSON.parse(JSON.stringify(records[0]))).not.toThrow();
  });

  it("retains submission correlation through worker and audit events", async () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger("test-service", (record) => records.push(record));
    const audit = new InMemoryAuditRepository();
    const repository = new InMemoryAssessmentRepository(audit);
    const service = new AssessmentService(repository, logger);
    const worker = new AssessmentWorker("worker-one", repository, logger);

    const assessment = await service.submit({
      actor: { subject: "user-a", role: "company-user", companyId: "company-a" },
      companyId: "company-a",
      applicationId: "application-a",
      idempotencyKey: "assessment-request",
      correlationId: "corr-assessment-1",
    });
    await worker.tick();

    const lifecycle = records.filter((record) =>
      record.event.startsWith("assessment.worker") || record.event === "audit.event.persisted",
    );
    expect(lifecycle.length).toBeGreaterThanOrEqual(4);
    expect(lifecycle.every((record) => record.correlationId === "corr-assessment-1")).toBe(true);
    expect(lifecycle).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "audit.event.persisted", action: "assessment.queued", entityId: assessment.id }),
      expect.objectContaining({ event: "assessment.worker.started", assessmentId: assessment.id }),
      expect.objectContaining({ event: "audit.event.persisted", action: "assessment.completed", entityId: assessment.id }),
      expect.objectContaining({ event: "assessment.worker.completed", assessmentId: assessment.id }),
    ]));
  });
});
