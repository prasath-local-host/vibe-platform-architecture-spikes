export type Role = "operator" | "company-user";

export interface Actor {
  readonly subject: string;
  readonly role: Role;
  readonly companyId?: string;
}

export interface Application {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorSubject: string;
  readonly actorRole: Role;
  readonly companyId: string;
  readonly action: string;
  readonly entityType: "application";
  readonly entityId: string;
  readonly correlationId: string;
}

export class ForbiddenError extends Error {
  constructor() {
    super("Access to this company is forbidden");
  }
}

export function requireCompanyAccess(actor: Actor, companyId: string): void {
  if (actor.role === "operator") return;
  if (!actor.companyId || actor.companyId !== companyId) throw new ForbiddenError();
}

