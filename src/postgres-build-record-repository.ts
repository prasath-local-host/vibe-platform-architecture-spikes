import { sql, type Kysely, type Selectable } from "kysely";
import type { BuildRecordRepository } from "./build-job-service.js";
import type { BuildRecordTable, Database } from "./database.js";
import type { AuditEvent, BuildRecord } from "./domain.js";

function fromRow(row: Selectable<BuildRecordTable>): BuildRecord {
  const result = row.result as BuildRecord["result"] | null;
  return {
    id: row.id, companyId: row.company_id, applicationId: row.application_id,
    repositoryUrl: row.repository_url, sourceRevision: row.source_revision,
    packageManager: row.package_manager, script: row.script,
    idempotencyKey: row.idempotency_key, correlationId: row.correlation_id,
    status: row.status, attempts: row.attempts, ...(result ? { result } : {}),
    ...(row.error ? { error: row.error } : {}), createdAt: new Date(row.created_at).toISOString(),
    ...(row.started_at ? { startedAt: new Date(row.started_at).toISOString() } : {}),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
  };
}

function audit(event: AuditEvent) {
  return { id: event.id, occurred_at: event.occurredAt, actor_subject: event.actorSubject, actor_role: event.actorRole, company_id: event.companyId, action: event.action, entity_type: event.entityType, entity_id: event.entityId, correlation_id: event.correlationId } as const;
}

export class PostgresBuildRecordRepository implements BuildRecordRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async submit(build: BuildRecord, event: AuditEvent) {
    return this.db.transaction().execute(async (transaction) => {
      const inserted = await transaction.insertInto("builds").values({
        id: build.id, company_id: build.companyId, application_id: build.applicationId,
        repository_url: build.repositoryUrl, source_revision: build.sourceRevision,
        package_manager: build.packageManager, script: build.script,
        idempotency_key: build.idempotencyKey, correlation_id: build.correlationId,
        status: "queued", attempts: 0, result: null, error: null, locked_by: null,
        created_at: build.createdAt, started_at: null, completed_at: null,
      }).onConflict((conflict) => conflict.columns(["company_id", "application_id", "idempotency_key"]).doNothing()).returningAll().executeTakeFirst();
      if (!inserted) {
        const existing = await transaction.selectFrom("builds").selectAll()
          .where("company_id", "=", build.companyId).where("application_id", "=", build.applicationId)
          .where("idempotency_key", "=", build.idempotencyKey).executeTakeFirstOrThrow();
        return fromRow(existing);
      }
      await transaction.insertInto("audit_events").values(audit(event)).execute();
      return fromRow(inserted);
    });
  }
  async findById(companyId: string, buildId: string) {
    const row = await this.db.selectFrom("builds").selectAll().where("company_id", "=", companyId).where("id", "=", buildId).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }
  async listByApplication(companyId: string, applicationId: string) {
    return (await this.db.selectFrom("builds").selectAll().where("company_id", "=", companyId).where("application_id", "=", applicationId).orderBy("created_at").execute()).map(fromRow);
  }
  async claimNext(workerId: string, occurredAt: string) {
    const staleBefore = new Date(new Date(occurredAt).getTime() - 5 * 60 * 1000).toISOString();
    const result = await sql<Selectable<BuildRecordTable>>`
      with claimable as (select id from builds where status = 'queued' or (status = 'running' and started_at < ${staleBefore}) order by created_at for update skip locked limit 1)
      update builds set status = 'running', attempts = attempts + 1, locked_by = ${workerId}, started_at = ${occurredAt}, error = null
      where id = (select id from claimable) returning *
    `.execute(this.db);
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }
  async complete(buildId: string, result: NonNullable<BuildRecord["result"]>, event: AuditEvent) { await this.finish(buildId, "completed", result, null, event); }
  async fail(buildId: string, error: string, event: AuditEvent) { await this.finish(buildId, "failed", null, error, event); }
  private async finish(buildId: string, status: "completed" | "failed", result: BuildRecord["result"] | null, error: string | null, event: AuditEvent) {
    await this.db.transaction().execute(async (transaction) => {
      const updated = await transaction.updateTable("builds").set({ status, result, error, completed_at: event.occurredAt, locked_by: null }).where("id", "=", buildId).where("status", "=", "running").executeTakeFirst();
      if (updated.numUpdatedRows !== 1n) throw new Error("Build is not running or was already finalized");
      await transaction.insertInto("audit_events").values(audit(event)).execute();
    });
  }
}
