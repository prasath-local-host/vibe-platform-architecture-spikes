import { sql, type Kysely } from "kysely";
import type { Database } from "./database.js";
import { ProvisioningError, type ProjectState, type ProjectStateStore } from "./project-provisioning-service.js";

export class PostgresProjectStore implements ProjectStateStore {
  constructor(private readonly db: Kysely<Database>) {}
  async read(companyId: string): Promise<ProjectState> {
    const result = await sql<{ record: ProjectState }>`select record from company_project_setup where company_id = ${companyId}`.execute(this.db);
    return result.rows[0]?.record ?? { projects: [] };
  }
  async exclusive<T>(companyId: string, action: Parameters<ProjectStateStore["exclusive"]>[1]): Promise<T> {
    // A pinned session lock permits durable checkpoints around non-transactional GitHub calls.
    return this.db.connection().execute(async connection => {
      const lock = await sql<{ acquired: boolean }>`select pg_try_advisory_lock(hashtextextended(${`project-setup:${companyId}`}, 0)) as acquired`.execute(connection);
      if (!lock.rows[0]?.acquired) throw new ProvisioningError("Another setup request is running. Refresh and retry.");
      try {
        const result = await sql<{ record: ProjectState }>`select record from company_project_setup where company_id = ${companyId}`.execute(connection);
        const state = result.rows[0]?.record ?? { projects: [] };
        return await action(state, async (event, actor) => {
          await connection.transaction().execute(async transaction => {
            await sql`insert into companies(id, display_name, created_at) values (${companyId}, ${companyId}, now()) on conflict(id) do nothing`.execute(transaction);
            try {
              await sql`insert into company_project_setup(company_id, organization_id, record)
                values (${companyId}, ${state.organization?.organizationId ?? null}, ${JSON.stringify(state)}::jsonb)
                on conflict(company_id) do update set organization_id = excluded.organization_id, record = excluded.record`.execute(transaction);
            } catch (error) {
              if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new ProvisioningError("This GitHub organization is already connected to another company.");
              throw error;
            }
            await sql`insert into project_setup_events(company_id, actor_subject, action, record)
              values (${companyId}, ${actor.subject}, ${event}, ${JSON.stringify({ organization: state.organization, projects: state.projects.map(({ files: _files, ...p }) => p) })}::jsonb)`.execute(transaction);
          });
        }) as T;
      } finally {
        await sql`select pg_advisory_unlock(hashtextextended(${`project-setup:${companyId}`}, 0))`.execute(connection);
      }
    });
  }
}
