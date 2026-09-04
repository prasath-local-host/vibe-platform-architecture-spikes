import { Kysely, PostgresDialect, type Generated } from "kysely";
import { Pool } from "pg";
import { StructuredLogger, type OperationalLogger } from "./observability.js";

export interface CompanyTable {
  id: string;
  display_name: string;
  created_at: string;
}

export interface CompanyMembershipTable {
  company_id: string;
  subject: string;
  role: "company-user";
  active: boolean;
  created_at: string;
}

export interface PlatformRoleTable {
  subject: string;
  role: "operator";
  active: boolean;
  created_at: string;
}

export interface ApplicationTable {
  id: string;
  company_id: string;
  name: string;
  repository_url: string;
  idempotency_key: string;
  correlation_id: string;
  created_at: string;
}

export interface AuditEventTable {
  sequence: Generated<string>;
  id: string;
  occurred_at: string;
  actor_subject: string;
  actor_role: "operator" | "company-user";
  company_id: string;
  action: string;
  entity_type: "application" | "assessment" | "build";
  entity_id: string;
  correlation_id: string;
}

export interface BuildRecordTable {
  id: string;
  company_id: string;
  application_id: string;
  repository_url: string;
  source_revision: string;
  package_manager: "npm" | "pnpm" | "yarn";
  script: "build" | "test";
  idempotency_key: string;
  correlation_id: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  result: unknown | null;
  error: string | null;
  locked_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AssessmentTable {
  id: string;
  company_id: string;
  application_id: string;
  repository_url: string;
  source_revision: string;
  idempotency_key: string;
  correlation_id: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  result: unknown | null;
  error: string | null;
  locked_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Database {
  companies: CompanyTable;
  company_memberships: CompanyMembershipTable;
  platform_roles: PlatformRoleTable;
  applications: ApplicationTable;
  audit_events: AuditEventTable;
  assessments: AssessmentTable;
  builds: BuildRecordTable;
}

export function createDatabase(
  connectionString: string,
  logger: OperationalLogger = new StructuredLogger(),
): Kysely<Database> {
  return new Kysely<Database>({
    log(event) {
      const fields = {
        durationMs: Number(event.queryDurationMillis.toFixed(3)),
        sql: event.query.sql,
      };
      if (event.level === "error") {
        logger.error("database.query.failed", {
          ...fields,
          error:
            event.error instanceof Error
              ? event.error.message
              : String(event.error),
        });
      } else {
        logger.info("database.query.completed", fields);
      }
    },
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 10,
        application_name: "vibe-control-plane-spike",
      }),
    }),
  });
}
