import { randomUUID } from "node:crypto";
import type { Actor, Application, AuditEvent } from "./domain.js";
import { requireCompanyAccess } from "./domain.js";

export interface ApplicationRepository {
  findByIdempotencyKey(companyId: string, key: string): Promise<Application | undefined>;
  insert(application: Application): Promise<void>;
  listByCompany(companyId: string): Promise<readonly Application[]>;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  listByCompany(companyId: string): Promise<readonly AuditEvent[]>;
}

export interface RegisterApplicationCommand {
  readonly actor: Actor;
  readonly companyId: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export class ApplicationService {
  constructor(
    private readonly applications: ApplicationRepository,
    private readonly audit: AuditRepository,
  ) {}

  async register(command: RegisterApplicationCommand): Promise<Application> {
    requireCompanyAccess(command.actor, command.companyId);
    const existing = await this.applications.findByIdempotencyKey(command.companyId, command.idempotencyKey);
    if (existing) return existing;

    const application: Application = {
      id: randomUUID(),
      companyId: command.companyId,
      name: command.name,
      repositoryUrl: command.repositoryUrl,
      idempotencyKey: command.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    await this.applications.insert(application);
    await this.audit.append({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorSubject: command.actor.subject,
      actorRole: command.actor.role,
      companyId: command.companyId,
      action: "application.registered",
      entityType: "application",
      entityId: application.id,
      correlationId: command.correlationId,
    });
    return application;
  }

  async list(actor: Actor, companyId: string): Promise<readonly Application[]> {
    requireCompanyAccess(actor, companyId);
    return this.applications.listByCompany(companyId);
  }
}

