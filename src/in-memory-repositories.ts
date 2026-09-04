import type { ApplicationRepository, AuditRepository } from "./application-service.js";
import type { Application, AuditEvent } from "./domain.js";

export class InMemoryApplicationRepository implements ApplicationRepository {
  private readonly rows: Application[] = [];
  constructor(private readonly audit?: InMemoryAuditRepository) {}
  async findById(companyId: string, applicationId: string) {
    return this.rows.find((row) => row.companyId === companyId && row.id === applicationId);
  }
  async findByIdempotencyKey(companyId: string, key: string) {
    return this.rows.find((row) => row.companyId === companyId && row.idempotencyKey === key);
  }
  async register(application: Application, event: AuditEvent) {
    const existing = await this.findByIdempotencyKey(application.companyId, application.idempotencyKey);
    if (existing) return existing;
    this.rows.push(application);
    await this.audit?.append(event);
    return application;
  }
  async listByCompany(companyId: string) { return this.rows.filter((row) => row.companyId === companyId); }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly rows: AuditEvent[] = [];
  async append(event: AuditEvent) { this.rows.push(event); }
  async listByCompany(companyId: string) { return this.rows.filter((row) => row.companyId === companyId); }
}
