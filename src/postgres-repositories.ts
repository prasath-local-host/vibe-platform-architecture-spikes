import type { Kysely, Selectable } from "kysely";
import type {
  ApplicationRepository,
  AuditRepository,
} from "./application-service.js";
import type {
  ApplicationTable,
  AuditEventTable,
  Database,
} from "./database.js";
import type { Application, AuditEvent } from "./domain.js";

function applicationFromRow(row: Selectable<ApplicationTable>): Application {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    repositoryUrl: row.repository_url,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function auditFromRow(row: Selectable<AuditEventTable>): AuditEvent {
  return {
    id: row.id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actorSubject: row.actor_subject,
    actorRole: row.actor_role,
    companyId: row.company_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    correlationId: row.correlation_id,
  };
}

export class PostgresApplicationRepository implements ApplicationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findByIdempotencyKey(companyId: string, key: string) {
    const row = await this.db
      .selectFrom("applications")
      .selectAll()
      .where("company_id", "=", companyId)
      .where("idempotency_key", "=", key)
      .executeTakeFirst();
    return row ? applicationFromRow(row) : undefined;
  }

  async register(application: Application, event: AuditEvent): Promise<Application> {
    return this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("companies")
        .values({
          id: application.companyId,
          display_name: application.companyId,
          created_at: application.createdAt,
        })
        .onConflict((conflict) => conflict.column("id").doNothing())
        .execute();

      const inserted = await transaction
        .insertInto("applications")
        .values({
          id: application.id,
          company_id: application.companyId,
          name: application.name,
          repository_url: application.repositoryUrl,
          idempotency_key: application.idempotencyKey,
          correlation_id: event.correlationId,
          created_at: application.createdAt,
        })
        .onConflict((conflict) =>
          conflict.columns(["company_id", "idempotency_key"]).doNothing(),
        )
        .returningAll()
        .executeTakeFirst();

      if (!inserted) {
        const existing = await transaction
          .selectFrom("applications")
          .selectAll()
          .where("company_id", "=", application.companyId)
          .where("idempotency_key", "=", application.idempotencyKey)
          .executeTakeFirstOrThrow();
        return applicationFromRow(existing);
      }

      await transaction
        .insertInto("audit_events")
        .values({
          id: event.id,
          occurred_at: event.occurredAt,
          actor_subject: event.actorSubject,
          actor_role: event.actorRole,
          company_id: event.companyId,
          action: event.action,
          entity_type: event.entityType,
          entity_id: event.entityId,
          correlation_id: event.correlationId,
        })
        .execute();
      return applicationFromRow(inserted);
    });
  }

  async listByCompany(companyId: string): Promise<readonly Application[]> {
    const rows = await this.db
      .selectFrom("applications")
      .selectAll()
      .where("company_id", "=", companyId)
      .orderBy("created_at")
      .execute();
    return rows.map(applicationFromRow);
  }
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async append(event: AuditEvent): Promise<void> {
    await this.db
      .insertInto("audit_events")
      .values({
        id: event.id,
        occurred_at: event.occurredAt,
        actor_subject: event.actorSubject,
        actor_role: event.actorRole,
        company_id: event.companyId,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId,
        correlation_id: event.correlationId,
      })
      .execute();
  }

  async listByCompany(companyId: string): Promise<readonly AuditEvent[]> {
    const rows = await this.db
      .selectFrom("audit_events")
      .selectAll()
      .where("company_id", "=", companyId)
      .orderBy("sequence")
      .execute();
    return rows.map(auditFromRow);
  }
}
