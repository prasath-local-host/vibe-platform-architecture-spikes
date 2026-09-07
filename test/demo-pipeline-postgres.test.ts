import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationService } from "../src/application-service.js";
import { createDatabase } from "../src/database.js";
import { PostgresPipelineStore, type PipelineRun } from "../src/demo-pipeline.js";
import { migrateToLatest } from "../src/migrations.js";
import { PostgresApplicationRepository, PostgresAuditRepository } from "../src/postgres-repositories.js";

// A dedicated disposable DB URL avoids interfering with existing suite fixtures.
const url = process.env.TEST_PIPELINE_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL demo dispatch persistence", () => {
  const db = createDatabase(url ?? "postgres://unused");
  const companyId = `pipeline-${randomUUID()}`;
  let applicationId: string;
  let run: PipelineRun;
  beforeAll(async () => {
    await migrateToLatest(db);
    const app = await new ApplicationService(new PostgresApplicationRepository(db), new PostgresAuditRepository(db)).register({
      actor: { subject: "test", role: "operator" }, companyId, name: "Pipeline fixture", repositoryUrl: "https://github.com/example/demo",
      idempotencyKey: randomUUID(), correlationId: randomUUID(),
    });
    applicationId = app.id;
    run = { id: randomUUID(), companyId, applicationId, actorSubject: "test", kind: "build", sourceRevision: "a".repeat(40), buildId: null,
      idempotencyKey: randomUUID(), runId: null, status: "dispatching", conclusion: null, createdAt: new Date().toISOString() };
  });
  afterAll(async () => {
    await db.deleteFrom("demo_pipeline_runs").where("company_id", "=", companyId).execute();
    await db.deleteFrom("audit_events").where("company_id", "=", companyId).execute();
    await db.deleteFrom("applications").where("company_id", "=", companyId).execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.destroy();
  });
  it("persists intent across restarts and serializes concurrent dispatch reservations", async () => {
    const first = new PostgresPipelineStore(db);
    const results = await Promise.all([first.reserve(run), first.reserve({ ...run, id: randomUUID() })]);
    expect(results[0]?.id).toBe(results[1]?.id);
    const restored = new PostgresPipelineStore(db);
    const stored = (await restored.list(companyId, applicationId))[0]!;
    expect(stored.actorSubject).toBe("test");
    expect(stored.idempotencyKey).toBe(run.idempotencyKey);
    expect(await restored.list("another-company", applicationId)).toEqual([]);
    await expect(restored.reserve({ ...run, id: randomUUID(), idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await restored.update({ ...stored, status: "completed", conclusion: "success", runId: "123" });
    await restored.update({ ...stored, status: "queued" });
    expect((await restored.list(companyId, applicationId))[0]?.conclusion).toBe("success");
    await expect(restored.reserve({ ...run, id: randomUUID(), idempotencyKey: randomUUID() })).resolves.toMatchObject({ status: "dispatching" });
  });
});
