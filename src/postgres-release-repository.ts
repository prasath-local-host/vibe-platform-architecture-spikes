import { sql, type Kysely, type Selectable } from "kysely";
import type { Database, ReleaseRecordTable } from "./database.js";
import type { AuditEvent, ReleaseRecord } from "./domain.js";
import type { ReleaseRepository } from "./release-service.js";

function fromRow(row: Selectable<ReleaseRecordTable>): ReleaseRecord {
  return { id: row.id, companyId: row.company_id, applicationId: row.application_id, buildId: row.build_id,
    artifactId: row.artifact_id, artifactDigest: row.artifact_digest, environment: row.environment, status: row.status,
    idempotencyKey: row.idempotency_key, correlationId: row.correlation_id,
    ...(row.rollback_target_release_id ? { rollbackTargetReleaseId: row.rollback_target_release_id } : {}),
    ...(row.deployment_url ? { deploymentUrl: row.deployment_url } : {}), ...(row.error ? { error: row.error } : {}),
    createdAt: new Date(row.created_at).toISOString(), ...(row.deployed_at ? { deployedAt: new Date(row.deployed_at).toISOString() } : {}),
    ...(row.health_verified_at ? { healthVerifiedAt: new Date(row.health_verified_at).toISOString() } : {}),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}) };
}
function audit(event: AuditEvent) { return { id: event.id, occurred_at: event.occurredAt, actor_subject: event.actorSubject, actor_role: event.actorRole, company_id: event.companyId, action: event.action, entity_type: event.entityType, entity_id: event.entityId, correlation_id: event.correlationId } as const; }

export class PostgresReleaseRepository implements ReleaseRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async create(release: ReleaseRecord, event: AuditEvent) {
    return this.db.transaction().execute(async (transaction) => {
      const inserted = await transaction.insertInto("releases").values({ id: release.id, company_id: release.companyId, application_id: release.applicationId, build_id: release.buildId, artifact_id: release.artifactId, artifact_digest: release.artifactDigest, environment: "test", status: "pending", idempotency_key: release.idempotencyKey, correlation_id: release.correlationId, rollback_target_release_id: release.rollbackTargetReleaseId ?? null, deployment_url: null, error: null, locked_by: null, created_at: release.createdAt, deployed_at: null, health_verified_at: null, completed_at: null })
        .onConflict((conflict) => conflict.columns(["company_id", "application_id", "idempotency_key"]).doNothing()).returningAll().executeTakeFirst();
      if (!inserted) return fromRow(await transaction.selectFrom("releases").selectAll().where("company_id", "=", release.companyId).where("application_id", "=", release.applicationId).where("idempotency_key", "=", release.idempotencyKey).executeTakeFirstOrThrow());
      await transaction.insertInto("audit_events").values(audit(event)).execute(); return fromRow(inserted);
    });
  }
  async findById(companyId: string, releaseId: string) { const row = await this.db.selectFrom("releases").selectAll().where("company_id", "=", companyId).where("id", "=", releaseId).executeTakeFirst(); return row ? fromRow(row) : undefined; }
  async listByApplication(companyId: string, applicationId: string) { return (await this.db.selectFrom("releases").selectAll().where("company_id", "=", companyId).where("application_id", "=", applicationId).orderBy("created_at").execute()).map(fromRow); }
  async latestHealthy(companyId: string, applicationId: string) { const row = await this.db.selectFrom("releases").selectAll().where("company_id", "=", companyId).where("application_id", "=", applicationId).where("status", "=", "healthy").orderBy("completed_at", "desc").executeTakeFirst(); return row ? fromRow(row) : undefined; }
  async claimNext(workerId: string, occurredAt: string) { const result = await sql<Selectable<ReleaseRecordTable>>`with claimable as (select id from releases where status = 'pending' order by created_at for update skip locked limit 1) update releases set status = 'deploying', locked_by = ${workerId}, deployed_at = ${occurredAt} where id = (select id from claimable) returning *`.execute(this.db); return result.rows[0] ? fromRow(result.rows[0]) : undefined; }
  async healthy(releaseId: string, deploymentUrl: string, occurredAt: string, event: AuditEvent) { await this.finish(releaseId, { status: "healthy", deployment_url: deploymentUrl, health_verified_at: occurredAt, completed_at: occurredAt, locked_by: null, error: null }, event); }
  async fail(releaseId: string, error: string, occurredAt: string, event: AuditEvent) { await this.finish(releaseId, { status: "failed", error, completed_at: occurredAt, locked_by: null }, event); }
  private async finish(releaseId: string, change: Partial<ReleaseRecordTable>, event: AuditEvent) { await this.db.transaction().execute(async (transaction) => { const updated = await transaction.updateTable("releases").set(change).where("id", "=", releaseId).where("status", "=", "deploying").executeTakeFirst(); if (updated.numUpdatedRows !== 1n) throw new Error("Release is not deploying or was already finalized"); await transaction.insertInto("audit_events").values(audit(event)).execute(); }); }
}
