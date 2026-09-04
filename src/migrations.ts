import {
  Kysely,
  Migrator,
  type Migration,
  type MigrationProvider,
  sql,
} from "kysely";
import type { Database } from "./database.js";

const initialControlPlaneSchema: Migration = {
  async up(db) {
    await db.schema
      .createTable("companies")
      .ifNotExists()
      .addColumn("id", "varchar(100)", (column) => column.primaryKey())
      .addColumn("display_name", "varchar(160)", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();

    await db.schema
      .createTable("company_memberships")
      .ifNotExists()
      .addColumn("company_id", "varchar(100)", (column) =>
        column.notNull().references("companies.id").onDelete("cascade"),
      )
      .addColumn("subject", "varchar(255)", (column) => column.notNull())
      .addColumn("role", "varchar(40)", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("company_memberships_pk", ["company_id", "subject"])
      .addCheckConstraint(
        "company_memberships_role_check",
        sql`role in ('company-user')`,
      )
      .execute();

    await db.schema
      .createTable("applications")
      .ifNotExists()
      .addColumn("id", "uuid", (column) => column.primaryKey())
      .addColumn("company_id", "varchar(100)", (column) =>
        column.notNull().references("companies.id").onDelete("restrict"),
      )
      .addColumn("name", "varchar(120)", (column) => column.notNull())
      .addColumn("repository_url", "text", (column) => column.notNull())
      .addColumn("idempotency_key", "varchar(100)", (column) => column.notNull())
      .addColumn("correlation_id", "varchar(160)", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("applications_company_idempotency_uq", [
        "company_id",
        "idempotency_key",
      ])
      .execute();

    await db.schema
      .createIndex("applications_company_created_idx")
      .on("applications")
      .columns(["company_id", "created_at"])
      .execute();

    await db.schema
      .createTable("audit_events")
      .ifNotExists()
      .addColumn("sequence", "bigserial", (column) => column.primaryKey())
      .addColumn("id", "uuid", (column) => column.notNull().unique())
      .addColumn("occurred_at", "timestamptz", (column) => column.notNull())
      .addColumn("actor_subject", "varchar(255)", (column) => column.notNull())
      .addColumn("actor_role", "varchar(40)", (column) => column.notNull())
      .addColumn("company_id", "varchar(100)", (column) =>
        column.notNull().references("companies.id").onDelete("restrict"),
      )
      .addColumn("action", "varchar(120)", (column) => column.notNull())
      .addColumn("entity_type", "varchar(80)", (column) => column.notNull())
      .addColumn("entity_id", "uuid", (column) => column.notNull())
      .addColumn("correlation_id", "varchar(160)", (column) => column.notNull())
      .addCheckConstraint(
        "audit_events_actor_role_check",
        sql`actor_role in ('operator', 'company-user')`,
      )
      .addCheckConstraint(
        "audit_events_entity_type_check",
        sql`entity_type in ('application')`,
      )
      .execute();

    await db.schema
      .createIndex("audit_events_company_sequence_idx")
      .on("audit_events")
      .columns(["company_id", "sequence"])
      .execute();
    await db.schema
      .createIndex("audit_events_correlation_idx")
      .on("audit_events")
      .column("correlation_id")
      .execute();
  },
  async down(db) {
    await db.schema.dropTable("audit_events").ifExists().execute();
    await db.schema.dropTable("applications").ifExists().execute();
    await db.schema.dropTable("company_memberships").ifExists().execute();
    await db.schema.dropTable("companies").ifExists().execute();
  },
};

const identityAuthorizationSchema: Migration = {
  async up(db) {
    await db.schema
      .alterTable("company_memberships")
      .addColumn("active", "boolean", (column) =>
        column.notNull().defaultTo(true),
      )
      .execute();
    await db.schema
      .createTable("platform_roles")
      .addColumn("subject", "varchar(255)", (column) => column.notNull())
      .addColumn("role", "varchar(40)", (column) => column.notNull())
      .addColumn("active", "boolean", (column) =>
        column.notNull().defaultTo(true),
      )
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("platform_roles_pk", ["subject", "role"])
      .addCheckConstraint("platform_roles_role_check", sql`role in ('operator')`)
      .execute();
  },
  async down(db) {
    await db.schema.dropTable("platform_roles").execute();
    await db.schema
      .alterTable("company_memberships")
      .dropColumn("active")
      .execute();
  },
};

const asynchronousAssessmentSchema: Migration = {
  async up(db) {
    await db.schema
      .createTable("assessments")
      .addColumn("id", "uuid", (column) => column.primaryKey())
      .addColumn("company_id", "varchar(100)", (column) =>
        column.notNull().references("companies.id").onDelete("restrict"),
      )
      .addColumn("application_id", "uuid", (column) =>
        column.notNull().references("applications.id").onDelete("cascade"),
      )
      .addColumn("idempotency_key", "varchar(100)", (column) => column.notNull())
      .addColumn("correlation_id", "varchar(160)", (column) => column.notNull())
      .addColumn("status", "varchar(40)", (column) =>
        column.notNull().defaultTo("queued"),
      )
      .addColumn("attempts", "integer", (column) =>
        column.notNull().defaultTo(0),
      )
      .addColumn("result", "jsonb")
      .addColumn("error", "text")
      .addColumn("locked_by", "varchar(160)")
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("started_at", "timestamptz")
      .addColumn("completed_at", "timestamptz")
      .addUniqueConstraint("assessments_application_idempotency_uq", [
        "company_id",
        "application_id",
        "idempotency_key",
      ])
      .addCheckConstraint(
        "assessments_status_check",
        sql`status in ('queued', 'running', 'completed', 'failed')`,
      )
      .addCheckConstraint(
        "assessments_attempts_check",
        sql`attempts >= 0`,
      )
      .execute();
    await db.schema
      .createIndex("assessments_claim_idx")
      .on("assessments")
      .columns(["status", "created_at"])
      .execute();

    await sql`
      alter table audit_events drop constraint audit_events_entity_type_check
    `.execute(db);
    await sql`
      alter table audit_events
      add constraint audit_events_entity_type_check
      check (entity_type in ('application', 'assessment'))
    `.execute(db);
  },
  async down(db) {
    await sql`
      alter table audit_events drop constraint audit_events_entity_type_check
    `.execute(db);
    await sql`
      alter table audit_events
      add constraint audit_events_entity_type_check
      check (entity_type in ('application'))
    `.execute(db);
    await db.schema.dropTable("assessments").execute();
  },
};

const immutableAssessmentSourceSchema: Migration = {
  async up(db) {
    await db.schema.alterTable("assessments").addColumn("repository_url", "text").execute();
    await db.schema.alterTable("assessments").addColumn("source_revision", "varchar(64)").execute();
    await sql`
      update assessments
      set repository_url = applications.repository_url,
          source_revision = 'unresolved'
      from applications
      where assessments.application_id = applications.id
    `.execute(db);
    await sql`alter table assessments alter column repository_url set not null`.execute(db);
    await sql`alter table assessments alter column source_revision set not null`.execute(db);
  },
  async down(db) {
    await db.schema.alterTable("assessments").dropColumn("source_revision").execute();
    await db.schema.alterTable("assessments").dropColumn("repository_url").execute();
  },
};

const asynchronousBuildSchema: Migration = {
  async up(db) {
    await db.schema.createTable("builds")
      .addColumn("id", "uuid", (column) => column.primaryKey())
      .addColumn("company_id", "varchar(100)", (column) => column.notNull().references("companies.id").onDelete("restrict"))
      .addColumn("application_id", "uuid", (column) => column.notNull().references("applications.id").onDelete("cascade"))
      .addColumn("repository_url", "text", (column) => column.notNull())
      .addColumn("source_revision", "varchar(40)", (column) => column.notNull())
      .addColumn("package_manager", "varchar(16)", (column) => column.notNull())
      .addColumn("script", "varchar(16)", (column) => column.notNull())
      .addColumn("idempotency_key", "varchar(100)", (column) => column.notNull())
      .addColumn("correlation_id", "varchar(160)", (column) => column.notNull())
      .addColumn("status", "varchar(40)", (column) => column.notNull().defaultTo("queued"))
      .addColumn("attempts", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("result", "jsonb")
      .addColumn("error", "text")
      .addColumn("locked_by", "varchar(160)")
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("started_at", "timestamptz")
      .addColumn("completed_at", "timestamptz")
      .addUniqueConstraint("builds_application_idempotency_uq", ["company_id", "application_id", "idempotency_key"])
      .addCheckConstraint("builds_status_check", sql`status in ('queued', 'running', 'completed', 'failed')`)
      .addCheckConstraint("builds_package_manager_check", sql`package_manager in ('npm', 'pnpm', 'yarn')`)
      .addCheckConstraint("builds_script_check", sql`script in ('build', 'test')`)
      .addCheckConstraint("builds_attempts_check", sql`attempts >= 0`)
      .execute();
    await db.schema.createIndex("builds_claim_idx").on("builds").columns(["status", "created_at"]).execute();
    await sql`alter table audit_events drop constraint audit_events_entity_type_check`.execute(db);
    await sql`alter table audit_events add constraint audit_events_entity_type_check check (entity_type in ('application', 'assessment', 'build'))`.execute(db);
  },
  async down(db) {
    await sql`alter table audit_events drop constraint audit_events_entity_type_check`.execute(db);
    await sql`alter table audit_events add constraint audit_events_entity_type_check check (entity_type in ('application', 'assessment'))`.execute(db);
    await db.schema.dropTable("builds").execute();
  },
};

class ControlPlaneMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_initial_control_plane": initialControlPlaneSchema,
      "002_identity_authorization": identityAuthorizationSchema,
      "003_asynchronous_assessments": asynchronousAssessmentSchema,
      "004_immutable_assessment_source": immutableAssessmentSourceSchema,
      "005_asynchronous_builds": asynchronousBuildSchema,
    };
  }
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const { error, results } = await new Migrator({
    db,
    provider: new ControlPlaneMigrationProvider(),
  }).migrateToLatest();
  for (const result of results ?? []) {
    if (result.status === "Error") {
      throw new Error(`Migration ${result.migrationName} failed`);
    }
  }
  if (error) throw error;
}
