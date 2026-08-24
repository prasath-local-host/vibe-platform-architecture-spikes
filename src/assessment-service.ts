import { randomUUID } from "node:crypto";
import type { Actor, Assessment, AuditEvent } from "./domain.js";
import { requireCompanyAccess } from "./domain.js";

export interface AssessmentRepository {
  submit(assessment: Assessment, event: AuditEvent): Promise<Assessment>;
  findById(companyId: string, assessmentId: string): Promise<Assessment | undefined>;
  listByApplication(
    companyId: string,
    applicationId: string,
  ): Promise<readonly Assessment[]>;
  claimNext(workerId: string, occurredAt: string): Promise<Assessment | undefined>;
  complete(
    assessmentId: string,
    result: NonNullable<Assessment["result"]>,
    event: AuditEvent,
  ): Promise<void>;
  fail(assessmentId: string, error: string, event: AuditEvent): Promise<void>;
}

export interface SubmitAssessmentCommand {
  readonly actor: Actor;
  readonly companyId: string;
  readonly applicationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export class AssessmentService {
  constructor(private readonly assessments: AssessmentRepository) {}

  async submit(command: SubmitAssessmentCommand): Promise<Assessment> {
    requireCompanyAccess(command.actor, command.companyId);
    const now = new Date().toISOString();
    const assessment: Assessment = {
      id: randomUUID(),
      companyId: command.companyId,
      applicationId: command.applicationId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      status: "queued",
      attempts: 0,
      createdAt: now,
    };
    return this.assessments.submit(
      assessment,
      this.event(
        command.actor,
        assessment,
        "assessment.queued",
        command.correlationId,
        now,
      ),
    );
  }

  async get(
    actor: Actor,
    companyId: string,
    assessmentId: string,
  ): Promise<Assessment | undefined> {
    requireCompanyAccess(actor, companyId);
    return this.assessments.findById(companyId, assessmentId);
  }

  async list(
    actor: Actor,
    companyId: string,
    applicationId: string,
  ): Promise<readonly Assessment[]> {
    requireCompanyAccess(actor, companyId);
    return this.assessments.listByApplication(companyId, applicationId);
  }

  private event(
    actor: Actor,
    assessment: Assessment,
    action: string,
    correlationId: string,
    occurredAt: string,
  ): AuditEvent {
    return {
      id: randomUUID(),
      occurredAt,
      actorSubject: actor.subject,
      actorRole: actor.role,
      companyId: assessment.companyId,
      action,
      entityType: "assessment",
      entityId: assessment.id,
      correlationId,
    };
  }
}

export class AssessmentWorker {
  constructor(
    private readonly workerId: string,
    private readonly assessments: AssessmentRepository,
  ) {}

  async tick(): Promise<boolean> {
    const assessment = await this.assessments.claimNext(
      this.workerId,
      new Date().toISOString(),
    );
    if (!assessment) return false;
    const occurredAt = new Date().toISOString();
    const eventBase = {
      id: randomUUID(),
      occurredAt,
      actorSubject: `worker:${this.workerId}`,
      actorRole: "operator" as const,
      companyId: assessment.companyId,
      entityType: "assessment" as const,
      entityId: assessment.id,
      correlationId: assessment.correlationId,
    };
    try {
      await this.assessments.complete(
        assessment.id,
        {
          profile: "placeholder-web-application",
          findings: [],
        },
        { ...eventBase, action: "assessment.completed" },
      );
    } catch (error) {
      await this.assessments.fail(
        assessment.id,
        error instanceof Error ? error.message : "Unknown assessment failure",
        { ...eventBase, action: "assessment.failed" },
      );
    }
    return true;
  }
}
