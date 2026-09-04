import type { BuildRecordRepository } from "./build-job-service.js";
import type { AuditEvent, BuildRecord } from "./domain.js";
import type { InMemoryAuditRepository } from "./in-memory-repositories.js";

export class InMemoryBuildRecordRepository implements BuildRecordRepository {
  private readonly rows: BuildRecord[] = [];
  constructor(private readonly audit: InMemoryAuditRepository) {}

  async submit(build: BuildRecord, event: AuditEvent) {
    const existing = this.rows.find((row) => row.companyId === build.companyId && row.applicationId === build.applicationId && row.idempotencyKey === build.idempotencyKey);
    if (existing) return existing;
    this.rows.push(build);
    await this.audit.append(event);
    return build;
  }
  async findById(companyId: string, buildId: string) { return this.rows.find((row) => row.companyId === companyId && row.id === buildId); }
  async listByApplication(companyId: string, applicationId: string) { return this.rows.filter((row) => row.companyId === companyId && row.applicationId === applicationId); }
  async claimNext(_workerId: string, occurredAt: string) {
    const index = this.rows.findIndex((row) => row.status === "queued");
    const current = this.rows[index];
    if (!current) return undefined;
    const claimed: BuildRecord = { ...current, status: "running", attempts: current.attempts + 1, startedAt: occurredAt };
    this.rows[index] = claimed;
    return claimed;
  }
  async complete(buildId: string, result: NonNullable<BuildRecord["result"]>, event: AuditEvent) {
    this.replace(buildId, { status: "completed", result, completedAt: event.occurredAt });
    await this.audit.append(event);
  }
  async fail(buildId: string, error: string, event: AuditEvent) {
    this.replace(buildId, { status: "failed", error, completedAt: event.occurredAt });
    await this.audit.append(event);
  }
  private replace(buildId: string, change: Partial<BuildRecord>) {
    const index = this.rows.findIndex((row) => row.id === buildId);
    const current = this.rows[index];
    if (!current) throw new Error("Build record not found");
    this.rows[index] = { ...current, ...change };
  }
}
