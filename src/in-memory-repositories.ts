import type { ApplicationRepository, AuditRepository } from "./application-service.js";
import type { Application, AuditEvent } from "./domain.js";

export class InMemoryApplicationRepository implements ApplicationRepository {
  private readonly rows: Application[] = [];
  async findByIdempotencyKey(companyId: string, key: string) {
    return this.rows.find((row) => row.companyId === companyId && row.idempotencyKey === key);
  }
  async insert(application: Application) { this.rows.push(application); }
  async listByCompany(companyId: string) { return this.rows.filter((row) => row.companyId === companyId); }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly rows: AuditEvent[] = [];
  async append(event: AuditEvent) { this.rows.push(event); }
  async listByCompany(companyId: string) { return this.rows.filter((row) => row.companyId === companyId); }
}

