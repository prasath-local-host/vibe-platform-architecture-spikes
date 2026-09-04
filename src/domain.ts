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
  readonly entityType: "application" | "assessment";
  readonly entityId: string;
  readonly correlationId: string;
}

export type AssessmentStatus = "queued" | "running" | "completed" | "failed";

export interface Assessment {
  readonly id: string;
  readonly companyId: string;
  readonly applicationId: string;
  readonly repositoryUrl: string;
  readonly sourceRevision: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly status: AssessmentStatus;
  readonly attempts: number;
  readonly result?: {
    readonly profile: string;
    readonly findings: readonly string[];
    readonly manifests: readonly string[];
    readonly detectedStack: readonly string[];
  };
  readonly error?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export class ApplicationNotFoundError extends Error {
  constructor() {
    super("Application not found");
  }
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
