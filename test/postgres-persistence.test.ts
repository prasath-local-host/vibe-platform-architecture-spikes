import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { ApplicationService } from "../src/application-service.js";
import { AssessmentService, AssessmentWorker } from "../src/assessment-service.js";
import { BuildJobService, BuildJobWorker } from "../src/build-job-service.js";
import { createDatabase, type Database } from "../src/database.js";
import type { Actor } from "../src/domain.js";
import { migrateToLatest } from "../src/migrations.js";
import {
  PostgresApplicationRepository,
  PostgresAuditRepository,
} from "../src/postgres-repositories.js";
import { PostgresAuthorizationRepository } from "../src/postgres-authorization-repository.js";
import { PostgresAssessmentRepository } from "../src/postgres-assessment-repository.js";
import { PostgresBuildRecordRepository } from "../src/postgres-build-record-repository.js";
import { ManifestAssessmentEngine } from "../src/manifest-assessment-engine.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const companyA: Actor = {
  subject: "postgres-user-a",
  role: "company-user",
  companyId: "postgres-company-a",
};

describe.skipIf(!databaseUrl)("PostgreSQL persistence", () => {
  let db: Kysely<Database>;

  beforeAll(async () => {
    db = createDatabase(databaseUrl!);
    await migrateToLatest(db);
    await db.deleteFrom("audit_events").execute();
    await db.deleteFrom("builds").execute();
    await db.deleteFrom("assessments").execute();
    await db.deleteFrom("applications").execute();
    await db.deleteFrom("platform_roles").execute();
    await db.deleteFrom("company_memberships").execute();
    await db.deleteFrom("companies").execute();
  });

  afterAll(async () => {
    await db.destroy();
  });

  function service() {
    return new ApplicationService(
      new PostgresApplicationRepository(db),
      new PostgresAuditRepository(db),
    );
  }

  it("persists applications and audit evidence across service restarts", async () => {
    await service().register({
      actor: companyA,
      companyId: "postgres-company-a",
      name: "Persistent application",
      repositoryUrl: "https://example.test/persistent",
      idempotencyKey: "persistent-request",
      correlationId: "persistent-correlation",
    });

    expect(await service().list(companyA, "postgres-company-a")).toMatchObject([
      { name: "Persistent application", companyId: "postgres-company-a" },
    ]);
    expect(
      await new PostgresAuditRepository(db).listByCompany("postgres-company-a"),
    ).toMatchObject([
      {
        actorSubject: "postgres-user-a",
        action: "application.registered",
        correlationId: "persistent-correlation",
      },
    ]);
  });

  it("uses the database uniqueness constraint under concurrent duplicate commands", async () => {
    const command = {
      actor: companyA,
      companyId: "postgres-company-a",
      name: "Concurrent application",
      repositoryUrl: "https://example.test/concurrent",
      idempotencyKey: "concurrent-request",
      correlationId: "concurrent-correlation",
    } as const;

    const registrations = await Promise.all([
      service().register(command),
      service().register(command),
      service().register(command),
    ]);

    expect(new Set(registrations.map((application) => application.id)).size).toBe(1);
    const audits = await new PostgresAuditRepository(db).listByCompany(
      "postgres-company-a",
    );
    expect(
      audits.filter((event) => event.entityId === registrations[0]!.id),
    ).toHaveLength(1);
  });

  it("rolls back the application when its audit event cannot be persisted", async () => {
    await expect(
      service().register({
        actor: companyA,
        companyId: "postgres-company-a",
        name: "Must roll back",
        repositoryUrl: "https://example.test/rollback",
        idempotencyKey: "rollback-request",
        correlationId: "x".repeat(161),
      }),
    ).rejects.toBeDefined();

    expect(
      (await service().list(companyA, "postgres-company-a")).some(
        (application) => application.idempotencyKey === "rollback-request",
      ),
    ).toBe(false);
  });

  it("enforces persisted company grants and immediate revocation", async () => {
    await db
      .insertInto("companies")
      .values({
        id: "postgres-company-a",
        display_name: "PostgreSQL Company A",
        created_at: new Date().toISOString(),
      })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .execute();
    await db
      .insertInto("company_memberships")
      .values({
        company_id: "postgres-company-a",
        subject: "postgres-member",
        role: "company-user",
        active: true,
        created_at: new Date().toISOString(),
      })
      .execute();
    const authorization = new PostgresAuthorizationRepository(db);

    expect(
      await authorization.hasCompanyAccess(
        "postgres-member",
        "postgres-company-a",
      ),
    ).toBe(true);
    expect(
      await authorization.hasCompanyAccess("postgres-member", "company-b"),
    ).toBe(false);
    expect(await authorization.isPlatformOperator("postgres-member")).toBe(false);

    await db
      .updateTable("company_memberships")
      .set({ active: false })
      .where("company_id", "=", "postgres-company-a")
      .where("subject", "=", "postgres-member")
      .execute();
    expect(
      await authorization.hasCompanyAccess(
        "postgres-member",
        "postgres-company-a",
      ),
    ).toBe(false);
  });

  it("keeps persisted platform roles separate from company memberships", async () => {
    await db
      .insertInto("platform_roles")
      .values({
        subject: "postgres-operator",
        role: "operator",
        active: true,
        created_at: new Date().toISOString(),
      })
      .execute();
    const authorization = new PostgresAuthorizationRepository(db);

    expect(await authorization.isPlatformOperator("postgres-operator")).toBe(true);
    expect(
      await authorization.hasCompanyAccess(
        "postgres-operator",
        "postgres-company-a",
      ),
    ).toBe(false);
  });

  it("persists queued assessments and completes them after a worker restart", async () => {
    const application = await service().register({
      actor: companyA,
      companyId: "postgres-company-a",
      name: "Assessed application",
      repositoryUrl: "https://example.test/assessed",
      idempotencyKey: "assessed-application",
      correlationId: "application-correlation",
    });
    const repository = new PostgresAssessmentRepository(db);
    const applicationRepository = new PostgresApplicationRepository(db);
    const assessments = new AssessmentService(repository, applicationRepository);
    const submitted = await assessments.submit({
      actor: companyA,
      companyId: "postgres-company-a",
      applicationId: application.id,
      idempotencyKey: "postgres-assessment",
      correlationId: "postgres-assessment-correlation",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    });

    const restartedRepository = new PostgresAssessmentRepository(db);
    const engine = new ManifestAssessmentEngine({ async checkout(_url, revision) { return { revision, files: [] }; } });
    await new AssessmentWorker("postgres-worker", restartedRepository, engine).tick();
    expect(
      await new AssessmentService(restartedRepository, applicationRepository).get(
        companyA,
        "postgres-company-a",
        submitted.id,
      ),
    ).toMatchObject({ status: "completed", attempts: 1 });

    const events = await new PostgresAuditRepository(db).listByCompany(
      "postgres-company-a",
    );
    expect(events.filter((event) => event.entityId === submitted.id)).toMatchObject([
      { action: "assessment.queued", correlationId: "postgres-assessment-correlation" },
      { action: "assessment.completed", correlationId: "postgres-assessment-correlation" },
    ]);
  });

  it("persists idempotent build jobs and completes one concurrent claim", async () => {
    const application = await service().register({
      actor: companyA, companyId: "postgres-company-a", name: "Built application",
      repositoryUrl: "https://github.com/example/built", idempotencyKey: "built-application",
      correlationId: "built-application-correlation",
    });
    const repository = new PostgresBuildRecordRepository(db);
    const builds = new BuildJobService(repository, new PostgresApplicationRepository(db));
    const command = {
      actor: companyA, companyId: "postgres-company-a", applicationId: application.id,
      sourceRevision: "f".repeat(40), packageManager: "npm" as const, script: "build" as const,
      idempotencyKey: "postgres-build", correlationId: "postgres-build-correlation",
    };
    const [first, retry] = await Promise.all([builds.submit(command), builds.submit(command)]);
    expect(retry.id).toBe(first.id);
    const engine = { async execute() { return { artifactDigest: `sha256:${"a".repeat(64)}`, restorationStatus: "succeeded" as const, buildStatus: "succeeded" as const }; } };
    const outcomes = await Promise.all([
      new BuildJobWorker("build-worker-one", repository, engine).tick(),
      new BuildJobWorker("build-worker-two", repository, engine).tick(),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(await builds.get(companyA, "postgres-company-a", first.id)).toMatchObject({ status: "completed", attempts: 1, result: { buildStatus: "succeeded" } });
    const events = await new PostgresAuditRepository(db).listByCompany("postgres-company-a");
    expect(events.filter((event) => event.entityId === first.id)).toMatchObject([
      { action: "build.queued" }, { action: "build.completed" },
    ]);
  });
});
