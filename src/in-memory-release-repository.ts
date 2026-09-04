import type { ReleaseRepository } from "./release-service.js";
import type { AuditEvent, ReleaseRecord } from "./domain.js";
import type { InMemoryAuditRepository } from "./in-memory-repositories.js";

export class InMemoryReleaseRepository implements ReleaseRepository {
  private readonly rows: ReleaseRecord[] = [];
  constructor(private readonly audit: InMemoryAuditRepository) {}
  async create(release: ReleaseRecord, event: AuditEvent) {
    const existing = this.rows.find((row) => row.companyId === release.companyId && row.applicationId === release.applicationId && row.idempotencyKey === release.idempotencyKey);
    if (existing) return existing;
    this.rows.push(release); await this.audit.append(event); return release;
  }
  async findById(companyId: string, releaseId: string) { return this.rows.find((row) => row.companyId === companyId && row.id === releaseId); }
  async listByApplication(companyId: string, applicationId: string) { return this.rows.filter((row) => row.companyId === companyId && row.applicationId === applicationId); }
  async latestHealthy(companyId: string, applicationId: string) { return [...this.rows].reverse().find((row) => row.companyId === companyId && row.applicationId === applicationId && row.status === "healthy"); }
  async claimNext(_workerId: string, occurredAt: string) {
    const index = this.rows.findIndex((row) => row.status === "pending"); const current = this.rows[index];
    if (!current) return undefined;
    const claimed: ReleaseRecord = { ...current, status: "deploying", deployedAt: occurredAt };
    this.rows[index] = claimed; return claimed;
  }
  async healthy(releaseId: string, deploymentUrl: string, occurredAt: string, event: AuditEvent) { this.replace(releaseId, { status: "healthy", deploymentUrl, healthVerifiedAt: occurredAt, completedAt: occurredAt }); await this.audit.append(event); }
  async fail(releaseId: string, error: string, occurredAt: string, event: AuditEvent) { this.replace(releaseId, { status: "failed", error, completedAt: occurredAt }); await this.audit.append(event); }
  private replace(id: string, change: Partial<ReleaseRecord>) { const index = this.rows.findIndex((row) => row.id === id); const current = this.rows[index]; if (!current) throw new Error("Release not found"); this.rows[index] = { ...current, ...change }; }
}
