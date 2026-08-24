import type { Kysely } from "kysely";
import type { Database } from "./database.js";
import type { AuthorizationRepository } from "./identity.js";

export class PostgresAuthorizationRepository
  implements AuthorizationRepository
{
  constructor(private readonly db: Kysely<Database>) {}

  async isPlatformOperator(subject: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("platform_roles")
      .select("subject")
      .where("subject", "=", subject)
      .where("role", "=", "operator")
      .where("active", "=", true)
      .executeTakeFirst();
    return Boolean(row);
  }

  async hasCompanyAccess(
    subject: string,
    companyId: string,
  ): Promise<boolean> {
    const row = await this.db
      .selectFrom("company_memberships")
      .select("subject")
      .where("subject", "=", subject)
      .where("company_id", "=", companyId)
      .where("active", "=", true)
      .executeTakeFirst();
    return Boolean(row);
  }
}
