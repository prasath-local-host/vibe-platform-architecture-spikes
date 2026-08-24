import { Kysely, PostgresDialect, type Generated } from "kysely";
import { Pool } from "pg";

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
  entity_type: "application" | "assessment";
  entity_id: string;
  correlation_id: string;
}

export interface AssessmentTable {
  id: string;
  company_id: string;
  application_id: string;
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
}

export function createDatabase(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 10,
        application_name: "vibe-control-plane-spike",
      }),
    }),
  });
}
