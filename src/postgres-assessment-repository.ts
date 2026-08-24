import { sql, type Kysely, type Selectable } from "kysely";
import type { AssessmentRepository } from "./assessment-service.js";
import type { AssessmentTable, Database } from "./database.js";
import type { Assessment, AuditEvent } from "./domain.js";

function assessmentFromRow(row: Selectable<AssessmentTable>): Assessment {
  const result = row.result as Assessment["result"] | null;
  return {
    id: row.id,
    companyId: row.company_id,
    applicationId: row.application_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    status: row.status,
    attempts: row.attempts,
    ...(result ? { result } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.started_at
      ? { startedAt: new Date(row.started_at).toISOString() }
      : {}),
    ...(row.completed_at
      ? { completedAt: new Date(row.completed_at).toISOString() }
      : {}),
  };
}

function auditValues(event: AuditEvent) {
  return {
    id: event.id,
    occurred_at: event.occurredAt,
    actor_subject: event.actorSubject,
    actor_role: event.actorRole,
    company_id: event.companyId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId,
    correlation_id: event.correlationId,
  } as const;
}

export class PostgresAssessmentRepository implements AssessmentRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async submit(assessment: Assessment, event: AuditEvent): Promise<Assessment> {
    return this.db.transaction().execute(async (transaction) => {
      const inserted = await transaction
        .insertInto("assessments")
        .values({
          id: assessment.id,
          company_id: assessment.companyId,
          application_id: assessment.applicationId,
          idempotency_key: assessment.idempotencyKey,
          correlation_id: assessment.correlationId,
          status: "queued",
          attempts: 0,
          result: null,
          error: null,
          locked_by: null,
          created_at: assessment.createdAt,
          started_at: null,
          completed_at: null,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["company_id", "application_id", "idempotency_key"])
            .doNothing(),
        )
        .returningAll()
        .executeTakeFirst();
      if (!inserted) {
        const existing = await transaction
          .selectFrom("assessments")
          .selectAll()
          .where("company_id", "=", assessment.companyId)
          .where("application_id", "=", assessment.applicationId)
          .where("idempotency_key", "=", assessment.idempotencyKey)
          .executeTakeFirstOrThrow();
        return assessmentFromRow(existing);
      }
      await transaction
        .insertInto("audit_events")
        .values(auditValues(event))
        .execute();
      return assessmentFromRow(inserted);
    });
  }

  async findById(companyId: string, assessmentId: string) {
    const row = await this.db
      .selectFrom("assessments")
      .selectAll()
      .where("company_id", "=", companyId)
      .where("id", "=", assessmentId)
      .executeTakeFirst();
    return row ? assessmentFromRow(row) : undefined;
  }

  async listByApplication(companyId: string, applicationId: string) {
    const rows = await this.db
      .selectFrom("assessments")
      .selectAll()
      .where("company_id", "=", companyId)
      .where("application_id", "=", applicationId)
      .orderBy("created_at")
      .execute();
    return rows.map(assessmentFromRow);
  }

  async claimNext(workerId: string, occurredAt: string) {
    const staleBefore = new Date(
      new Date(occurredAt).getTime() - 5 * 60 * 1000,
    ).toISOString();
    const result = await sql<Selectable<AssessmentTable>>`
      with claimable as (
        select id
        from assessments
        where status = 'queued'
           or (status = 'running' and started_at < ${staleBefore})
        order by created_at
        for update skip locked
        limit 1
      )
      update assessments
      set status = 'running',
          attempts = attempts + 1,
          locked_by = ${workerId},
          started_at = ${occurredAt},
          error = null
      where id = (select id from claimable)
      returning *
    `.execute(this.db);
    const row = result.rows[0];
    return row ? assessmentFromRow(row) : undefined;
  }

  async complete(
    assessmentId: string,
    result: NonNullable<Assessment["result"]>,
    event: AuditEvent,
  ): Promise<void> {
    await this.finish(
      assessmentId,
      {
        status: "completed",
        result,
        error: null,
        completed_at: event.occurredAt,
        locked_by: null,
      },
      event,
    );
  }

  async fail(
    assessmentId: string,
    error: string,
    event: AuditEvent,
  ): Promise<void> {
    await this.finish(
      assessmentId,
      {
        status: "failed",
        result: null,
        error,
        completed_at: event.occurredAt,
        locked_by: null,
      },
      event,
    );
  }

  private async finish(
    assessmentId: string,
    change: {
      status: "completed" | "failed";
      result: Assessment["result"] | null;
      error: string | null;
      completed_at: string;
      locked_by: null;
    },
    event: AuditEvent,
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const updated = await transaction
        .updateTable("assessments")
        .set(change)
        .where("id", "=", assessmentId)
        .where("status", "=", "running")
        .executeTakeFirst();
      if (updated.numUpdatedRows !== 1n) {
        throw new Error("Assessment is not running or was already finalized");
      }
      await transaction
        .insertInto("audit_events")
        .values(auditValues(event))
        .execute();
    });
  }
}
