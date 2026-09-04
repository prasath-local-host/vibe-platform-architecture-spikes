import { randomUUID } from "node:crypto";
import type { Actor, Assessment, AuditEvent } from "./domain.js";
import { ApplicationNotFoundError, requireCompanyAccess } from "./domain.js";
import type { ApplicationRepository } from "./application-service.js";
import {
  runWithCorrelation,
  silentLogger,
  type OperationalLogger,
} from "./observability.js";

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
  readonly sourceRevision: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface SourceSnapshot {
  readonly revision: string;
  readonly files: readonly SourceFile[];
}

export interface SourceRepository {
  checkout(repositoryUrl: string, revision: string): Promise<SourceSnapshot>;
}

export interface AssessmentEngine {
  assess(repositoryUrl: string, revision: string): Promise<NonNullable<Assessment["result"]>>;
}

export class AssessmentService {
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly applications: ApplicationRepository,
    private readonly logger: OperationalLogger = silentLogger,
  ) {}

  async submit(command: SubmitAssessmentCommand): Promise<Assessment> {
    requireCompanyAccess(command.actor, command.companyId);
    const application = await this.applications.findById(command.companyId, command.applicationId);
    if (!application) throw new ApplicationNotFoundError();
    const now = new Date().toISOString();
    const assessment: Assessment = {
      id: randomUUID(),
      companyId: command.companyId,
      applicationId: command.applicationId,
      repositoryUrl: application.repositoryUrl,
      sourceRevision: command.sourceRevision,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      status: "queued",
      attempts: 0,
      createdAt: now,
    };
    const submitted = await this.assessments.submit(
      assessment,
      this.event(
        command.actor,
        assessment,
        "assessment.queued",
        command.correlationId,
        now,
      ),
    );
    this.logger.info("audit.event.persisted", {
      correlationId: submitted.correlationId,
      action: "assessment.queued",
      companyId: submitted.companyId,
      entityType: "assessment",
      entityId: submitted.id,
    });
    return submitted;
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
    private readonly engine: AssessmentEngine,
    private readonly logger: OperationalLogger = silentLogger,
  ) {}

  async tick(): Promise<boolean> {
    const assessment = await this.assessments.claimNext(
      this.workerId,
      new Date().toISOString(),
    );
    if (!assessment) return false;
    return runWithCorrelation(assessment.correlationId, async () => {
      const occurredAt = new Date().toISOString();
      const eventBase = {
        id: randomUUID(),
        occurredAt,
        actorSubject: `worker:${this.workerId}`,
        actorRole: "operator" as const,
        companyId: assessment.companyId,
        entityType: "assessment",
        entityId: assessment.id,
        correlationId: assessment.correlationId,
      } as const;
      try {
        this.logger.info("assessment.worker.started", {
          workerId: this.workerId,
          companyId: assessment.companyId,
          assessmentId: assessment.id,
        });
        const result = await this.engine.assess(
          assessment.repositoryUrl,
          assessment.sourceRevision,
        );
        await this.assessments.complete(
          assessment.id,
          result,
          { ...eventBase, action: "assessment.completed" },
        );
        this.logger.info("audit.event.persisted", {
          action: "assessment.completed",
          companyId: assessment.companyId,
          entityType: "assessment",
          entityId: assessment.id,
        });
        this.logger.info("assessment.worker.completed", {
          workerId: this.workerId,
          companyId: assessment.companyId,
          assessmentId: assessment.id,
        });
      } catch (error) {
        await this.assessments.fail(
          assessment.id,
          error instanceof Error ? error.message : "Unknown assessment failure",
          { ...eventBase, action: "assessment.failed" },
        );
        this.logger.error("assessment.worker.failed", {
          workerId: this.workerId,
          companyId: assessment.companyId,
          assessmentId: assessment.id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown assessment failure",
        });
      }
      return true;
    });
  }
}
