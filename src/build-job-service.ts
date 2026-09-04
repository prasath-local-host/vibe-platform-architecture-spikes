import { randomUUID } from "node:crypto";
import type { ApplicationRepository } from "./application-service.js";
import { ApplicationNotFoundError, requireCompanyAccess, type Actor, type AuditEvent, type BuildRecord } from "./domain.js";
import { runWithCorrelation, silentLogger, type OperationalLogger } from "./observability.js";

export interface BuildRecordRepository {
  submit(build: BuildRecord, event: AuditEvent): Promise<BuildRecord>;
  findById(companyId: string, buildId: string): Promise<BuildRecord | undefined>;
  listByApplication(companyId: string, applicationId: string): Promise<readonly BuildRecord[]>;
  claimNext(workerId: string, occurredAt: string): Promise<BuildRecord | undefined>;
  complete(buildId: string, result: NonNullable<BuildRecord["result"]>, event: AuditEvent): Promise<void>;
  fail(buildId: string, error: string, event: AuditEvent): Promise<void>;
}

export interface BuildJobEngine {
  execute(build: BuildRecord): Promise<NonNullable<BuildRecord["result"]>>;
}

export interface SubmitBuildCommand {
  readonly actor: Actor;
  readonly companyId: string;
  readonly applicationId: string;
  readonly sourceRevision: string;
  readonly packageManager: BuildRecord["packageManager"];
  readonly script: BuildRecord["script"];
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

function event(actor: Actor, build: BuildRecord, action: string, occurredAt: string): AuditEvent {
  return {
    id: randomUUID(), occurredAt, actorSubject: actor.subject, actorRole: actor.role,
    companyId: build.companyId, action, entityType: "build", entityId: build.id,
    correlationId: build.correlationId,
  };
}

export class BuildJobService {
  constructor(
    private readonly builds: BuildRecordRepository,
    private readonly applications: ApplicationRepository,
    private readonly logger: OperationalLogger = silentLogger,
  ) {}

  async submit(command: SubmitBuildCommand): Promise<BuildRecord> {
    requireCompanyAccess(command.actor, command.companyId);
    const application = await this.applications.findById(command.companyId, command.applicationId);
    if (!application) throw new ApplicationNotFoundError();
    const now = new Date().toISOString();
    const build: BuildRecord = {
      id: randomUUID(), companyId: command.companyId, applicationId: command.applicationId,
      repositoryUrl: application.repositoryUrl, sourceRevision: command.sourceRevision.toLowerCase(),
      packageManager: command.packageManager, script: command.script,
      idempotencyKey: command.idempotencyKey, correlationId: command.correlationId,
      status: "queued", attempts: 0, createdAt: now,
    };
    const submitted = await this.builds.submit(build, event(command.actor, build, "build.queued", now));
    this.logger.info("audit.event.persisted", { action: "build.queued", companyId: submitted.companyId, entityType: "build", entityId: submitted.id });
    return submitted;
  }

  async get(actor: Actor, companyId: string, buildId: string) {
    requireCompanyAccess(actor, companyId);
    return this.builds.findById(companyId, buildId);
  }

  async list(actor: Actor, companyId: string, applicationId: string) {
    requireCompanyAccess(actor, companyId);
    return this.builds.listByApplication(companyId, applicationId);
  }
}

export class BuildJobWorker {
  constructor(
    private readonly workerId: string,
    private readonly builds: BuildRecordRepository,
    private readonly engine: BuildJobEngine,
    private readonly logger: OperationalLogger = silentLogger,
  ) {}

  async tick(): Promise<boolean> {
    const build = await this.builds.claimNext(this.workerId, new Date().toISOString());
    if (!build) return false;
    return runWithCorrelation(build.correlationId, async () => {
      const occurredAt = new Date().toISOString();
      const base = {
        id: randomUUID(), occurredAt, actorSubject: `worker:${this.workerId}`,
        actorRole: "operator" as const, companyId: build.companyId,
        entityType: "build" as const, entityId: build.id, correlationId: build.correlationId,
      };
      try {
        const result = await this.engine.execute(build);
        await this.builds.complete(build.id, result, { ...base, action: "build.completed" });
        this.logger.info("build.worker.completed", { workerId: this.workerId, companyId: build.companyId, buildId: build.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown build failure";
        await this.builds.fail(build.id, message, { ...base, action: "build.failed" });
        this.logger.error("build.worker.failed", { workerId: this.workerId, companyId: build.companyId, buildId: build.id, error: message });
      }
      return true;
    });
  }
}
