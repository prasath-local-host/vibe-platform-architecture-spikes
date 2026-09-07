import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/application-service.js";
import { InMemoryApplicationRepository, InMemoryAuditRepository } from "../src/in-memory-repositories.js";
import { DemoPipelineService, GitHubPipelineGateway, PipelineError, activeRun, pipelineTitle, type PipelineConfig, type PipelineGateway, type PipelineRun, type PipelineStore, type RemoteRun } from "../src/demo-pipeline.js";
import { DemoPipelineController } from "../src/demo-pipeline-controller.js";
import { IdentityService, InMemoryAuthorizationRepository, SpikeAccessTokenVerifier } from "../src/identity.js";

class MemoryStore implements PipelineStore {
  runs: PipelineRun[] = [];
  async list(companyId: string, applicationId: string) { return this.runs.filter(r => r.companyId === companyId && r.applicationId === applicationId).toReversed(); }
  async reserve(run: PipelineRun) {
    const existing = this.runs.find(r => r.applicationId === run.applicationId && r.idempotencyKey === run.idempotencyKey);
    if (existing) return existing;
    if (this.runs.some(r => r.applicationId === run.applicationId && activeRun(r))) throw new PipelineError(409, "Active request");
    this.runs.push(run); return run;
  }
  async update(run: PipelineRun) { const index = this.runs.findIndex(r => r.id === run.id); if (activeRun(this.runs[index]!)) this.runs[index] = run; }
}
const actor = { role: "company-user" as const, subject: "alice", companyId: "company-a" };
const revision = "a".repeat(40);
async function fixture() {
  const audit = new InMemoryAuditRepository();
  const apps = new InMemoryApplicationRepository(audit);
  const app = await new ApplicationService(apps, audit).register({ actor, companyId: actor.companyId, name: "Demo", repositoryUrl: "https://github.com/example/demo.git", idempotencyKey: randomUUID(), correlationId: randomUUID() });
  const config: PipelineConfig = { token: "test-not-a-secret", companyId: actor.companyId, applicationId: app.id, sourceRepository: "example/demo", workflowRepository: "example/platform", workflowBranch: "main" };
  const store = new MemoryStore();
  const remotes = new Map<string, RemoteRun>();
  const gateway: PipelineGateway = {
    latest: vi.fn(async () => revision), artifactExists: vi.fn(async () => true),
    dispatch: vi.fn(async run => {
      const id = remotes.size + 1;
      remotes.set(run.id, { id, status: "queued", conclusion: null, path: `.github/workflows/${run.kind === "build" ? "demo-build.yml" : "demo-deploy.yml"}`, event: "workflow_dispatch", head_branch: "main", display_title: pipelineTitle(run) });
      return String(id);
    }),
    read: vi.fn(async run => remotes.get(run.id)),
  };
  const service = new DemoPipelineService(apps, store, config, gateway);
  const send = (command: Parameters<DemoPipelineService["dispatch"]>[3]) => service.dispatch(actor, actor.companyId, app.id, command);
  const finish = async (run: PipelineRun, conclusion = "success") => { Object.assign(remotes.get(run.id)!, { status: "completed", conclusion }); await service.list(actor, actor.companyId, app.id); };
  return { apps, app, config, store, gateway, service, send, finish, remotes };
}
describe("portal demo pipeline", () => {
  it("builds once, gates Stage, then promotes that same build to Prod", async () => {
    const f = await fixture();
    const command = { kind: "build" as const, sourceRevision: revision, idempotencyKey: randomUUID() };
    const build = await f.send(command);
    expect((await f.send(command)).id).toBe(build.id);
    expect(f.gateway.dispatch).toHaveBeenCalledTimes(1);
    await expect(f.send({ kind: "stage", buildId: build.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await f.finish(build);
    await expect(f.send({ kind: "prod", buildId: build.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    const stage = await f.send({ kind: "stage", buildId: build.id, idempotencyKey: randomUUID() });
    await expect(f.send({ kind: "prod", buildId: build.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await f.finish(stage);
    const prod = await f.send({ kind: "prod", buildId: build.id, idempotencyKey: randomUUID() });
    expect(prod.sourceRevision).toBe(revision);
    expect(f.gateway.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "prod", buildId: build.id }), build.runId);
  });
  it("rejects tenant crossing, missing apps, unbound apps and foreign build IDs", async () => {
    const f = await fixture();
    await expect(f.service.list(actor, "company-b", f.app.id)).rejects.toThrow();
    await expect(f.service.list(actor, actor.companyId, randomUUID())).rejects.toMatchObject({ status: 404 });
    const other = await new ApplicationService(f.apps, new InMemoryAuditRepository()).register({ actor, companyId: actor.companyId, name: "Copy", repositoryUrl: f.app.repositoryUrl, idempotencyKey: randomUUID(), correlationId: randomUUID() });
    expect(await f.service.list(actor, actor.companyId, other.id)).toEqual({ configured: false, runs: [] });
    await expect(f.service.dispatch(actor, actor.companyId, other.id, { kind: "build", sourceRevision: revision, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 503 });
    await expect(f.send({ kind: "stage", buildId: randomUUID(), idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 404 });
  });
  it("rejects failed checks, expired artifacts and a different latest Stage build", async () => {
    const f = await fixture();
    const first = await f.send({ kind: "build", sourceRevision: revision, idempotencyKey: randomUUID() });
    await f.finish(first, "failure");
    await expect(f.send({ kind: "stage", buildId: first.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    const second = await f.send({ kind: "build", sourceRevision: revision, idempotencyKey: randomUUID() });
    await f.finish(second);
    vi.mocked(f.gateway.artifactExists).mockResolvedValueOnce(false);
    await expect(f.send({ kind: "stage", buildId: second.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    const stage = await f.send({ kind: "stage", buildId: second.id, idempotencyKey: randomUUID() });
    await f.finish(stage);
    const third = await f.send({ kind: "build", sourceRevision: "b".repeat(40), idempotencyKey: randomUUID() });
    await f.finish(third);
    await expect(f.send({ kind: "prod", buildId: third.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
  });
  it("does not redispatch after a lost response or permit concurrent runs", async () => {
    const f = await fixture();
    vi.mocked(f.gateway.dispatch).mockRejectedValueOnce(new PipelineError(503, "Timeout"));
    const command = { kind: "build" as const, sourceRevision: revision, idempotencyKey: randomUUID() };
    await expect(f.send(command)).rejects.toMatchObject({ status: 503 });
    expect((await f.send(command)).status).toBe("dispatching");
    expect(f.gateway.dispatch).toHaveBeenCalledTimes(1);
    await expect(f.send({ ...command, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(f.send({ ...command, sourceRevision: "b".repeat(40) })).rejects.toMatchObject({ status: 409 });
  });
  it("requires verified OTP for every dispatch and validates request schemas", async () => {
    const f = await fixture();
    const identity = new IdentityService({ verify: async () => ({ issuer: "https://identity.example", subject: actor.subject, authenticationMethods: ["pwd"] }) }, new InMemoryAuthorizationRepository([{ subject: actor.subject, companyId: actor.companyId }]), [], ["otp"]);
    const controller = new DemoPipelineController(f.service, identity);
    await expect(controller.dispatch(actor.companyId, f.app.id, { authorization: "Bearer spike:alice" }, { kind: "build", sourceRevision: revision, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 401 });
    expect(f.gateway.dispatch).not.toHaveBeenCalled();
    const steppedUp = new DemoPipelineController(f.service, new IdentityService(new SpikeAccessTokenVerifier(true), new InMemoryAuthorizationRepository([{ subject: actor.subject, companyId: actor.companyId }]), [], ["otp"]));
    await expect(steppedUp.dispatch(actor.companyId, f.app.id, { authorization: "Bearer spike:alice" }, { kind: "prod", sourceRevision: revision, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 400 });
    expect(f.gateway.dispatch).not.toHaveBeenCalled();
  });
});
describe("GitHub pipeline gateway", () => {
  it("uses fixed HTTPS endpoints, private authorization, nonce and exact SHA inputs", async () => {
    const f = await fixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ workflow_run_id: 123 }), { status: 200 }));
    const gateway = new GitHubPipelineGateway(f.config, fetcher);
    const run: PipelineRun = { id: randomUUID(), companyId: actor.companyId, applicationId: f.app.id, actorSubject: actor.subject, kind: "build", sourceRevision: revision, buildId: null, idempotencyKey: randomUUID(), runId: null, status: "dispatching", conclusion: null, createdAt: new Date().toISOString() };
    expect(await gateway.dispatch(run)).toBe("123");
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/example/platform/actions/workflows/demo-build.yml/dispatches", expect.objectContaining({ method: "POST", redirect: "error", body: JSON.stringify({ ref: "main", inputs: { portal_request_id: run.id, source_revision: revision, expected_source_repository: "example/demo" } }) }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ workflow_runs: [{ id: 123, status: "queued", conclusion: null, display_title: pipelineTitle(run), path: ".github/workflows/demo-build.yml", event: "workflow_dispatch", head_branch: "main" }] })));
    expect((await gateway.read(run))?.id).toBe(123);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ id: 123, display_title: "another request", path: ".github/workflows/demo-build.yml", event: "workflow_dispatch", head_branch: "main" })));
    await expect(gateway.read({ ...run, runId: "123" })).rejects.toMatchObject({ status: 409 });
    fetcher.mockResolvedValueOnce(new Response("private GitHub details", { status: 403 }));
    await expect(gateway.latest()).rejects.toThrow("GitHub returned HTTP 403");
  });
});
