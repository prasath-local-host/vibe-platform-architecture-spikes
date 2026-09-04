import { randomUUID } from "node:crypto";
import type { BuildRecordRepository } from "./build-job-service.js";
import { requireCompanyAccess, type Actor, type AuditEvent, type ReleaseRecord } from "./domain.js";
import type { IngressRouter } from "./ingress-router.js";

export interface ReleaseRepository {
  create(release: ReleaseRecord, event: AuditEvent): Promise<ReleaseRecord>;
  findById(companyId: string, releaseId: string): Promise<ReleaseRecord | undefined>;
  listByApplication(companyId: string, applicationId: string): Promise<readonly ReleaseRecord[]>;
  latestHealthy(companyId: string, applicationId: string): Promise<ReleaseRecord | undefined>;
  claimNext(workerId: string, occurredAt: string): Promise<ReleaseRecord | undefined>;
  healthy(releaseId: string, deploymentUrl: string, occurredAt: string, event: AuditEvent): Promise<void>;
  rolledBack(releaseId: string, deploymentUrl: string, error: string, occurredAt: string, event: AuditEvent): Promise<void>;
  fail(releaseId: string, error: string, occurredAt: string, event: AuditEvent): Promise<void>;
}

export interface DeploymentEngine {
  deploy(release: ReleaseRecord): Promise<{ readonly deploymentUrl: string }>;
  rollback(release: ReleaseRecord, target: ReleaseRecord): Promise<{ readonly deploymentUrl: string }>;
  verifyHealth(deploymentUrl: string): Promise<boolean>;
}

export class UnavailableDeploymentEngine implements DeploymentEngine {
  async deploy(): Promise<{ readonly deploymentUrl: string }> { throw new Error("Test deployment is not configured"); }
  async rollback(): Promise<{ readonly deploymentUrl: string }> { throw new Error("Test deployment is not configured"); }
  async verifyHealth(): Promise<boolean> { return false; }
}

export interface CreateReleaseCommand {
  readonly actor: Actor;
  readonly companyId: string;
  readonly applicationId: string;
  readonly buildId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

function audit(actor: Actor, release: ReleaseRecord, action: string, occurredAt: string): AuditEvent {
  return { id: randomUUID(), occurredAt, actorSubject: actor.subject, actorRole: actor.role, companyId: release.companyId, action, entityType: "release", entityId: release.id, correlationId: release.correlationId };
}

export class ReleaseService {
  constructor(private readonly releases: ReleaseRepository, private readonly builds: BuildRecordRepository) {}
  async create(command: CreateReleaseCommand): Promise<ReleaseRecord> {
    requireCompanyAccess(command.actor, command.companyId);
    const build = await this.builds.findById(command.companyId, command.buildId);
    if (!build || build.applicationId !== command.applicationId) throw new Error("Completed build not found");
    if (build.status !== "completed" || !build.result) throw new Error("Only a completed build can be released");
    if (build.result.securityStatus !== "approved") throw new Error("Only a security-approved build artifact can be released");
    const previous = await this.releases.latestHealthy(command.companyId, command.applicationId);
    const now = new Date().toISOString();
    const release: ReleaseRecord = {
      id: randomUUID(), companyId: command.companyId, applicationId: command.applicationId,
      buildId: build.id, artifactId: build.result.artifactId, artifactDigest: build.result.artifactDigest,
      environment: "test", status: "pending", idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId, ...(previous ? { rollbackTargetReleaseId: previous.id } : {}), createdAt: now,
    };
    return this.releases.create(release, audit(command.actor, release, "release.queued", now));
  }
  async get(actor: Actor, companyId: string, releaseId: string) { requireCompanyAccess(actor, companyId); return this.releases.findById(companyId, releaseId); }
  async list(actor: Actor, companyId: string, applicationId: string) { requireCompanyAccess(actor, companyId); return this.releases.listByApplication(companyId, applicationId); }
}

export class ReleaseWorker {
  constructor(private readonly workerId: string, private readonly releases: ReleaseRepository, private readonly deployment: DeploymentEngine, private readonly ingress?: IngressRouter) {}
  async tick(): Promise<boolean> {
    const release = await this.releases.claimNext(this.workerId, new Date().toISOString());
    if (!release) return false;
    const base = { id: randomUUID(), actorSubject: `worker:${this.workerId}`, actorRole: "operator" as const, companyId: release.companyId, entityType: "release" as const, entityId: release.id, correlationId: release.correlationId };
    try {
      const deployed = await this.deployment.deploy(release);
      if (!await this.deployment.verifyHealth(deployed.deploymentUrl)) throw new Error("Deployment health verification failed");
      const now = new Date().toISOString();
      if (this.ingress) await this.ingress.activate({ companyId: release.companyId, applicationId: release.applicationId, releaseId: release.id, upstreamUrl: deployed.deploymentUrl, activatedAt: now });
      await this.releases.healthy(release.id, deployed.deploymentUrl, now, { ...base, id: randomUUID(), occurredAt: now, action: "release.healthy" });
    } catch (error) {
      let message = error instanceof Error ? error.message : "Unknown release failure";
      if (release.rollbackTargetReleaseId) {
        const target = await this.releases.findById(release.companyId, release.rollbackTargetReleaseId);
        if (target?.status === "healthy" && target.deploymentUrl) {
          try {
            const restored = await this.deployment.rollback(release, target);
            if (!await this.deployment.verifyHealth(restored.deploymentUrl)) throw new Error("Rollback health verification failed");
            const rolledBackAt = new Date().toISOString();
            if (this.ingress) await this.ingress.activate({ companyId: target.companyId, applicationId: target.applicationId, releaseId: target.id, upstreamUrl: restored.deploymentUrl, activatedAt: rolledBackAt });
            await this.releases.rolledBack(release.id, restored.deploymentUrl, message, rolledBackAt, { ...base, id: randomUUID(), occurredAt: rolledBackAt, action: "release.rolled_back" });
            return true;
          } catch (rollbackError) {
            message = `${message}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : "unknown rollback failure"}`;
          }
        }
      }
      const now = new Date().toISOString();
      await this.releases.fail(release.id, message, now, { ...base, id: randomUUID(), occurredAt: now, action: "release.failed" });
    }
    return true;
  }
}
