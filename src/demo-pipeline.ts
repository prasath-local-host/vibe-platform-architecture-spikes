import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "./database.js";
import type { ApplicationRepository } from "./application-service.js";
import { requireCompanyAccess, type Actor } from "./domain.js";

export type PipelineKind = "build" | "stage" | "prod";
export interface PipelineRun {
  id: string; companyId: string; applicationId: string; actorSubject: string;
  kind: PipelineKind; sourceRevision: string; buildId: string | null; idempotencyKey: string;
  runId: string | null; status: string; conclusion: string | null; createdAt: string;
}
export interface PipelineStore {
  list(companyId: string, applicationId: string): Promise<PipelineRun[]>;
  reserve(run: PipelineRun): Promise<PipelineRun>;
  update(run: PipelineRun): Promise<void>;
}
export class PipelineError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const activeRun = (run: PipelineRun) => run.status !== "completed";
export class PostgresPipelineStore implements PipelineStore {
  constructor(private readonly db: Kysely<Database>) {}
  async list(companyId: string, applicationId: string) {
    const rows = await this.db.selectFrom("demo_pipeline_runs").select("record")
      .where("company_id", "=", companyId).where("application_id", "=", applicationId)
      .orderBy("created_at", "desc").limit(50).execute();
    return rows.map(row => row.record as PipelineRun);
  }
  async reserve(run: PipelineRun) {
    try {
      await this.db.insertInto("demo_pipeline_runs").values({ id: run.id, company_id: run.companyId,
        application_id: run.applicationId, idempotency_key: run.idempotencyKey,
        created_at: run.createdAt, active: true, record: run }).execute();
      return run;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "23505")) throw error;
      const row = await this.db.selectFrom("demo_pipeline_runs").select("record")
        .where("company_id", "=", run.companyId).where("application_id", "=", run.applicationId)
        .where("idempotency_key", "=", run.idempotencyKey).executeTakeFirst();
      if (row) return row.record as PipelineRun;
      throw new PipelineError(409, "Another pipeline request is active. Refresh its status before starting another.");
    }
  }
  async update(run: PipelineRun) {
    // A delayed poll must never move a completed record backwards.
    await this.db.updateTable("demo_pipeline_runs").set({ record: run, active: activeRun(run) })
      .where("id", "=", run.id).where("active", "=", true).execute();
  }
}
export interface PipelineConfig {
  token: string; companyId: string; applicationId: string; sourceRepository: string;
  workflowRepository: string; workflowBranch: string;
}
export interface RemoteRun { id: number; status: string; conclusion: string | null; path: string; head_branch: string; event: string; display_title: string }
export interface PipelineGateway {
  latest(): Promise<string>;
  dispatch(run: PipelineRun, buildRunId?: string): Promise<string | null>;
  read(run: PipelineRun): Promise<RemoteRun | undefined>;
  artifactExists(runId: string): Promise<boolean>;
}
const workflow = (kind: PipelineKind) => kind === "build" ? "demo-build.yml" : "demo-deploy.yml";
export const pipelineTitle = (run: PipelineRun) => `VCP ${run.kind} ${run.id}`;
export class GitHubPipelineGateway implements PipelineGateway {
  constructor(private readonly config: PipelineConfig, private readonly fetcher: typeof fetch = fetch) {}
  private async api(repository: string, path: string, body?: unknown): Promise<any> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.github.com/repos/${repository}/${path}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.config.token}`,
          "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new PipelineError(503, "GitHub is unreachable. Refresh the request; do not dispatch it again."); }
    if (!response.ok) throw new PipelineError(503, `GitHub returned HTTP ${response.status}. Check the private token, repository permissions and workflow configuration.`);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new PipelineError(503, "GitHub returned an unreadable response. Refresh before retrying."); }
  }
  async latest() {
    const commit = await this.api(this.config.sourceRepository, "commits/main");
    if (!/^[0-9a-f]{40}$/.test(commit?.sha)) throw new PipelineError(503, "GitHub did not return a valid source commit.");
    return commit.sha as string;
  }
  async dispatch(run: PipelineRun, buildRunId?: string) {
    const response = await this.api(this.config.workflowRepository, `actions/workflows/${workflow(run.kind)}/dispatches`, {
      ref: this.config.workflowBranch,
      inputs: { portal_request_id: run.id, ...(run.kind === "build" ? { source_revision: run.sourceRevision, expected_source_repository: this.config.sourceRepository } : { build_run_id: buildRunId, environment: run.kind }) },
    });
    return Number.isSafeInteger(response?.workflow_run_id) && response.workflow_run_id > 0 ? String(response.workflow_run_id) : null;
  }
  async read(run: PipelineRun) {
    let remote: RemoteRun | undefined;
    if (run.runId) remote = await this.api(this.config.workflowRepository, `actions/runs/${run.runId}`);
    else {
      // Recover a lost dispatch response by exact nonce, never by "latest run".
      const data = await this.api(this.config.workflowRepository, `actions/workflows/${workflow(run.kind)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(this.config.workflowBranch)}&per_page=100&created=${encodeURIComponent(">=" + run.createdAt)}`);
      const matches = (data?.workflow_runs ?? []).filter((item: RemoteRun) => item.display_title === pipelineTitle(run));
      if (matches.length > 1) throw new PipelineError(409, "Multiple matching runs need operator review.");
      remote = matches[0];
    }
    if (remote && (remote.path !== `.github/workflows/${workflow(run.kind)}` || remote.event !== "workflow_dispatch" ||
      remote.head_branch !== this.config.workflowBranch || remote.display_title !== pipelineTitle(run) || !Number.isSafeInteger(remote.id))) {
      throw new PipelineError(409, "Workflow provenance does not match this application request.");
    }
    return remote;
  }
  async artifactExists(runId: string) {
    const result = await this.api(this.config.workflowRepository, `actions/runs/${runId}/artifacts?per_page=100`);
    return result.artifacts?.some((item: any) => item.name === "demo-candidate" && item.expired === false) === true;
  }
}
export class DemoPipelineService {
  constructor(private readonly applications: ApplicationRepository, private readonly store?: PipelineStore,
    private readonly config?: PipelineConfig, private readonly gateway?: PipelineGateway) {}
  private async authorize(actor: Actor, companyId: string, applicationId: string) {
    requireCompanyAccess(actor, companyId);
    if (!await this.applications.findById(companyId, applicationId)) throw new PipelineError(404, "Application not found.");
  }
  private async configured(companyId: string, applicationId: string) {
    const app = await this.applications.findById(companyId, applicationId);
    return Boolean(this.config && this.gateway && this.store && this.config.companyId === companyId &&
      this.config.applicationId === applicationId && app?.repositoryUrl.replace(/\.git$/, "").toLowerCase() === `https://github.com/${this.config.sourceRepository}`.toLowerCase());
  }
  private async requireConfigured(companyId: string, applicationId: string) {
    if (!await this.configured(companyId, applicationId)) throw new PipelineError(503, "This application has no configured demo pipeline. An operator must bind its ID and private GitHub credential on the server.");
  }
  private async refresh(run: PipelineRun) {
    const remote = await this.gateway!.read(run);
    if (!remote) return run;
    const updated = { ...run, runId: String(remote.id), status: remote.status, conclusion: remote.conclusion };
    await this.store!.update(updated);
    return updated;
  }
  async list(actor: Actor, companyId: string, applicationId: string) {
    await this.authorize(actor, companyId, applicationId);
    const configured = await this.configured(companyId, applicationId);
    if (!configured) return { configured: false, runs: [] };
    const records = await this.store!.list(companyId, applicationId);
    const runs = await Promise.all(records.map(run => activeRun(run) ? this.refresh(run) : run));
    return { configured: true, runs: runs.map(run => ({ ...run, url: run.runId ? `https://github.com/${this.config!.workflowRepository}/actions/runs/${run.runId}` : null })) };
  }
  async latest(actor: Actor, companyId: string, applicationId: string) {
    await this.authorize(actor, companyId, applicationId);
    await this.requireConfigured(companyId, applicationId);
    return { sourceRevision: await this.gateway!.latest() };
  }
  async dispatch(actor: Actor, companyId: string, applicationId: string,
    command: { kind: PipelineKind; sourceRevision?: string; buildId?: string; idempotencyKey: string }) {
    await this.authorize(actor, companyId, applicationId);
    await this.requireConfigured(companyId, applicationId);
    const records = await this.store!.list(companyId, applicationId);
    const existing = records.find(run => run.idempotencyKey === command.idempotencyKey);
    const compatible = (run: PipelineRun) => run.kind === command.kind && (command.kind === "build" ? run.sourceRevision === command.sourceRevision : run.buildId === command.buildId);
    if (existing) {
      if (!compatible(existing)) throw new PipelineError(409, "Idempotency key was already used for another request.");
      return this.refresh(existing);
    }
    let sourceRevision = command.sourceRevision ?? "";
    let buildRunId: string | undefined;
    if (command.kind !== "build") {
      const build = records.find(run => run.id === command.buildId && run.kind === "build");
      if (!build) throw new PipelineError(404, "Build not found for this application.");
      const verified = await this.refresh(build);
      if (verified.status !== "completed" || verified.conclusion !== "success" || !verified.runId) throw new PipelineError(409, "Build, tests and security checks must all succeed first.");
      if (!await this.gateway!.artifactExists(verified.runId)) throw new PipelineError(409, "The approved artifact has expired or is missing. Build again.");
      sourceRevision = verified.sourceRevision;
      buildRunId = verified.runId;
      if (command.kind === "prod") {
        const stage = records.find(run => run.kind === "stage");
        if (!stage || stage.buildId !== build.id) throw new PipelineError(409, "Deploy this exact build to Stage first.");
        const verifiedStage = await this.refresh(stage);
        if (verifiedStage.status !== "completed" || verifiedStage.conclusion !== "success") throw new PipelineError(409, "Stage deployment and health verification must succeed first.");
      }
    }
    const run: PipelineRun = { id: randomUUID(), companyId, applicationId, actorSubject: actor.subject,
      kind: command.kind, sourceRevision, buildId: command.buildId ?? null, idempotencyKey: command.idempotencyKey,
      runId: null, status: "dispatching", conclusion: null, createdAt: new Date().toISOString() };
    const reserved = await this.store!.reserve(run);
    if (reserved.id !== run.id) {
      if (!compatible(reserved)) throw new PipelineError(409, "Idempotency key conflict.");
      return reserved;
    }
    // Persist intent BEFORE the external call. On ambiguous failure, leave it active;
    // polling reconciles the nonce. Never automatically retry a deployment POST.
    const runId = await this.gateway!.dispatch(run, buildRunId);
    const dispatched = { ...run, runId, status: runId ? "queued" : "dispatching" };
    await this.store!.update(dispatched);
    return dispatched;
  }
}
export function pipelineConfigFromEnvironment(): PipelineConfig | undefined {
  if (process.env.DEMO_PIPELINE_ENABLED !== "true") return undefined;
  const config = { token: process.env.DEMO_PIPELINE_TOKEN ?? "", companyId: process.env.DEMO_PIPELINE_COMPANY_ID ?? "",
    applicationId: process.env.DEMO_PIPELINE_APPLICATION_ID ?? "", sourceRepository: process.env.DEMO_PIPELINE_SOURCE_REPOSITORY ?? "",
    workflowRepository: process.env.DEMO_PIPELINE_WORKFLOW_REPOSITORY ?? "", workflowBranch: process.env.DEMO_PIPELINE_WORKFLOW_BRANCH ?? "" };
  if (Object.values(config).some(value => !value) || !/^[0-9a-f-]{36}$/.test(config.applicationId) ||
    ![config.sourceRepository, config.workflowRepository].every(repo => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))) {
    throw new Error("Demo pipeline requires an explicit application/company binding, repositories, branch and private token.");
  }
  return config;
}
