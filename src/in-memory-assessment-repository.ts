import type { AssessmentRepository } from "./assessment-service.js";
import type { Assessment, AuditEvent } from "./domain.js";
import type { InMemoryAuditRepository } from "./in-memory-repositories.js";

export class InMemoryAssessmentRepository implements AssessmentRepository {
  private readonly rows: Assessment[] = [];

  constructor(private readonly audit: InMemoryAuditRepository) {}

  async submit(assessment: Assessment, event: AuditEvent): Promise<Assessment> {
    const existing = this.rows.find(
      (row) =>
        row.companyId === assessment.companyId &&
        row.applicationId === assessment.applicationId &&
        row.idempotencyKey === assessment.idempotencyKey,
    );
    if (existing) return existing;
    this.rows.push(assessment);
    await this.audit.append(event);
    return assessment;
  }

  async findById(companyId: string, assessmentId: string) {
    return this.rows.find(
      (row) => row.companyId === companyId && row.id === assessmentId,
    );
  }

  async listByApplication(companyId: string, applicationId: string) {
    return this.rows.filter(
      (row) =>
        row.companyId === companyId && row.applicationId === applicationId,
    );
  }

  async claimNext(_workerId: string, occurredAt: string) {
    const index = this.rows.findIndex((row) => row.status === "queued");
    const current = this.rows[index];
    if (index < 0 || !current) return undefined;
    const claimed: Assessment = {
      ...current,
      status: "running",
      attempts: current.attempts + 1,
      startedAt: occurredAt,
    };
    this.rows[index] = claimed;
    return claimed;
  }

  async complete(
    assessmentId: string,
    result: NonNullable<Assessment["result"]>,
    event: AuditEvent,
  ): Promise<void> {
    this.replace(assessmentId, {
      status: "completed",
      result,
      completedAt: event.occurredAt,
    });
    await this.audit.append(event);
  }

  async fail(
    assessmentId: string,
    error: string,
    event: AuditEvent,
  ): Promise<void> {
    this.replace(assessmentId, {
      status: "failed",
      error,
      completedAt: event.occurredAt,
    });
    await this.audit.append(event);
  }

  private replace(
    assessmentId: string,
    change: Partial<Assessment>,
  ): void {
    const index = this.rows.findIndex((row) => row.id === assessmentId);
    const current = this.rows[index];
    if (index < 0 || !current) throw new Error("Assessment not found");
    this.rows[index] = { ...current, ...change };
  }
}
