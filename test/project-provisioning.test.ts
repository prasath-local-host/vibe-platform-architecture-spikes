import { describe, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/application-service.js";
import { InMemoryApplicationRepository, InMemoryAuditRepository } from "../src/in-memory-repositories.js";
import { ProjectProvisioningService, type ProjectState, type ProjectStateStore } from "../src/project-provisioning-service.js";
import { NextPostgresProjectTemplate } from "../src/project-template.js";

const actor = { subject: "alice", role: "company-user" as const, companyId: "company-a" };
const operator = { subject: "ops", role: "operator" as const };
const input = { name: "Portal", repositoryName: "portal", idempotencyKey: "request-123" };
class Store implements ProjectStateStore {
  state: ProjectState = { projects: [] };
  events: string[] = [];
  async read() { return structuredClone(this.state); }
  async exclusive<T>(_company: string, action: Parameters<ProjectStateStore["exclusive"]>[1]) {
    const state = await this.read();
    return await action(state, async event => { this.state = structuredClone(state); this.events.push(event); }) as T;
  }
}
function fixture() {
  const audit = new InMemoryAuditRepository(); const apps = new InMemoryApplicationRepository(audit);
  const applications = new ApplicationService(apps, audit); const store = new Store();
  const github = { verify: vi.fn(async () => ({ organizationId: 10, installationId: 20 })),
    create: vi.fn(async () => ({ id: 30, url: "https://github.com/company/portal" })), initialize: vi.fn(async () => {}) };
  const service = new ProjectProvisioningService(applications, store, github, new NextPostgresProjectTemplate());
  const approve = async () => { await service.requestOrganization(actor, "company-a", "Company"); await service.approveOrganization(operator, "company-a", "company", "ONBOARD-1"); };
  return { service, store, github, apps, approve, applications };
}
describe("company project initialization", () => {
  it("rejects cross-company reads, requests, approval, and creation without GitHub side effects", async () => {
    const f = fixture();
    await expect(f.service.snapshot(actor, "company-b")).rejects.toThrow();
    await expect(f.service.requestOrganization(actor, "company-b", "company")).rejects.toThrow();
    await expect(f.service.approveOrganization(actor, "company-a", "company", "ticket")).rejects.toThrow();
    await expect(f.service.createProject(actor, "company-b", input)).rejects.toThrow();
    expect(f.github.verify).not.toHaveBeenCalled(); expect(f.github.create).not.toHaveBeenCalled();
  });
  it("requires verified ownership and a current operator approval request", async () => {
    const f = fixture();
    await expect(f.service.createProject(actor, "company-a", input)).rejects.toThrow(/verify/);
    await f.service.requestOrganization(actor, "company-a", "company");
    await expect(f.service.approveOrganization(operator, "company-a", "different", "ticket")).rejects.toThrow(/changed/);
    await expect(f.service.createProject(actor, "company-a", input)).rejects.toThrow(/verify/);
    await f.approve();
    await expect(f.service.requestOrganization(actor, "company-a", "other")).rejects.toThrow(/change/);
  });
  it("initializes shared rules once, registers once, and retains auditable checkpoints", async () => {
    const f = fixture(); await f.approve();
    const first = await f.service.createProject(actor, "company-a", input);
    expect(await f.service.createProject(actor, "company-a", input)).toEqual(first);
    expect(f.github.create).toHaveBeenCalledTimes(1); expect(f.github.initialize).toHaveBeenCalledTimes(1);
    expect(await f.apps.listByCompany("company-a")).toHaveLength(1);
    const files = f.store.state.projects[0]!.files;
    expect(files["AGENTS.md"]).toContain("Please contact the VCP team");
    expect(files["CLAUDE.md"]).toContain("@AGENTS.md");
    expect(JSON.parse(files["vcp.project.json"]!).database).toBe("postgresql17");
    expect(f.store.events).toContain("repository.initialized");
    expect((await f.service.snapshot(actor, "company-a")).projects[0]).not.toHaveProperty("files");
    await expect(f.service.createProject(actor, "company-a", { ...input, name: "Changed" })).rejects.toThrow(/different/);
  });
  it("never adopts or retries a repository after an ambiguous create response", async () => {
    const f = fixture(); await f.approve(); f.github.create.mockRejectedValueOnce(new Error("timeout"));
    await expect(f.service.createProject(actor, "company-a", input)).rejects.toThrow("timeout");
    await expect(f.service.createProject(actor, "company-a", input)).rejects.toThrow(/uncertain/);
    await expect(f.service.createProject(actor, "company-a", { ...input, idempotencyKey: "different-key" })).rejects.toThrow(/already/);
    expect(f.github.create).toHaveBeenCalledTimes(1); expect(await f.apps.listByCompany("company-a")).toHaveLength(0);
  });
  it("resumes initialization with persisted template bytes, never creating a second repo", async () => {
    const f = fixture(); await f.approve(); f.github.initialize.mockRejectedValueOnce(new Error("timeout"));
    await expect(f.service.createProject(actor, "company-a", input)).rejects.toThrow("timeout");
    expect(f.store.state.projects[0]?.status).toBe("initializing");
    expect(await f.apps.listByCompany("company-a")).toHaveLength(0);
    await f.service.createProject(actor, "company-a", input);
    expect(f.github.create).toHaveBeenCalledTimes(1); expect(f.github.initialize).toHaveBeenCalledTimes(2);
  });
  it("fails closed when the feature is unconfigured and validates organization names", async () => {
    const f = fixture();
    const disabled = new ProjectProvisioningService(f.applications);
    expect((await disabled.snapshot(actor, "company-a")).configured).toBe(false);
    await expect(disabled.createProject(actor, "company-a", input)).rejects.toMatchObject({ status: 503 });
    for (const slug of ["https://github.com/company", "../other", "company/other"]) {
      await expect(f.service.requestOrganization(actor, "company-a", slug)).rejects.toMatchObject({ status: 400 });
    }
  });
});
