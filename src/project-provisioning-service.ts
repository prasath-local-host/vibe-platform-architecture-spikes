import { randomUUID } from "node:crypto";
import type { Actor, Application } from "./domain.js";
import { ForbiddenError, requireCompanyAccess } from "./domain.js";
import type { ApplicationService } from "./application-service.js";

export class ProvisioningError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export interface OrganizationBinding {
  slug: string; status: "pending" | "verified"; requestedBy: string;
  organizationId?: number; installationId?: number; approvedBy?: string; approvalReference?: string;
}
export interface ProvisionedProject {
  id: string; name: string; repositoryName: string; idempotencyKey: string;
  status: "creating" | "initializing" | "ready";
  repositoryId?: number; repositoryUrl?: string; application?: Application;
  files: Record<string, string>;
}
export interface ProjectState { organization?: OrganizationBinding; projects: ProvisionedProject[] }
export interface ProjectStateStore {
  read(companyId: string): Promise<ProjectState>;
  exclusive<T>(companyId: string, action: (state: ProjectState, save: (action: string, actor: Actor) => Promise<void>) => Promise<T>): Promise<T>;
}
export interface ProjectGitHubGateway {
  verify(slug: string): Promise<{ organizationId: number; installationId: number }>;
  create(binding: OrganizationBinding, name: string): Promise<{ id: number; url: string }>;
  initialize(binding: OrganizationBinding, project: ProvisionedProject): Promise<void>;
}
export interface ProjectTemplate { files(): Promise<Record<string, string>> }

export class ProjectProvisioningService {
  constructor(private readonly applications: ApplicationService, private readonly store?: ProjectStateStore,
    private readonly github?: ProjectGitHubGateway, private readonly template?: ProjectTemplate) {}

  async snapshot(actor: Actor, companyId: string) {
    requireCompanyAccess(actor, companyId);
    const state = this.store ? await this.store.read(companyId) : { projects: [] };
    return { configured: Boolean(this.store && this.github && this.template), organization: state.organization ?? null,
      projects: state.projects.map(({ files: _files, ...project }) => project) };
  }

  private configured() {
    if (!this.store || !this.github || !this.template) throw new ProvisioningError("Repository creation is not configured. Contact the VCP team.", 503);
    return { store: this.store, github: this.github, template: this.template };
  }

  async requestOrganization(actor: Actor, companyId: string, slug: string) {
    requireCompanyAccess(actor, companyId);
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(slug)) throw new ProvisioningError("Enter a GitHub organization name, not a URL.", 400);
    const { store } = this.configured();
    await store.exclusive(companyId, async (state, save) => {
      if (state.organization?.slug === slug.toLowerCase()) return;
      if (state.organization?.status === "verified" || state.projects.length) throw new ProvisioningError("Contact the VCP team to change a connected organization.");
      state.organization = { slug: slug.toLowerCase(), status: "pending", requestedBy: actor.subject };
      await save("organization.requested", actor);
    });
    return this.snapshot(actor, companyId);
  }

  async approveOrganization(actor: Actor, companyId: string, slug: string, approvalReference: string) {
    requireCompanyAccess(actor, companyId);
    if (actor.role !== "operator") throw new ForbiddenError();
    if (!approvalReference.trim() || approvalReference.length > 200) throw new ProvisioningError("Record the company ownership verification reference.", 400);
    const { store, github } = this.configured();
    await store.exclusive(companyId, async (state, save) => {
      const binding = state.organization;
      if (!binding || binding.slug !== slug) throw new ProvisioningError("Organization request changed. Refresh and verify it again.");
      if (binding.status === "verified") return;
      const verified = await github.verify(binding.slug);
      state.organization = { ...binding, ...verified, status: "verified", approvedBy: actor.subject, approvalReference };
      await save("organization.verified", actor);
    });
    return this.snapshot(actor, companyId);
  }

  async createProject(actor: Actor, companyId: string, input: { name: string; repositoryName: string; idempotencyKey: string }) {
    requireCompanyAccess(actor, companyId);
    if (!/^[a-z\d][a-z\d-]{0,79}$/.test(input.repositoryName) || input.name.trim().length < 1 || input.name.length > 120 || !/^[\w-]{8,100}$/.test(input.idempotencyKey)) {
      throw new ProvisioningError("Enter a valid application name, repository name and request key.", 400);
    }
    const { store, github, template } = this.configured();
    return store.exclusive(companyId, async (state, save) => {
      const binding = state.organization;
      if (binding?.status !== "verified") throw new ProvisioningError("The VCP team must verify the company organization first.");
      let project = state.projects.find(p => p.idempotencyKey === input.idempotencyKey);
      if (project && (project.name !== input.name || project.repositoryName !== input.repositoryName)) throw new ProvisioningError("This request key belongs to different project details.");
      if (project?.status === "ready") return project.application!;
      // Persist intent before GitHub; an uncertain create must never adopt an existing repository.
      if (project?.status === "creating") throw new ProvisioningError("Repository creation has an uncertain result. Contact the VCP team for reconciliation; do not create a replacement.");
      if (!project) {
        if (state.projects.some(p => p.repositoryName === input.repositoryName)) throw new ProvisioningError("This repository name already has a VCP request. Resume that request or contact the VCP team.");
        if (state.projects.length >= 100) throw new ProvisioningError("Company project limit reached. Contact the VCP team.");
        project = { ...input, id: randomUUID(), status: "creating", files: await template.files() };
        state.projects.push(project);
        await save("repository.creation.requested", actor);
        const repository = await github.create(binding, input.repositoryName);
        project.repositoryId = repository.id; project.repositoryUrl = repository.url; project.status = "initializing";
        await save("repository.created", actor);
      }
      await github.initialize(binding, project);
      project.application = await this.applications.register({ actor, companyId, name: project.name,
        repositoryUrl: project.repositoryUrl!, idempotencyKey: `vcp-project-${project.id}`, correlationId: project.id });
      project.status = "ready";
      await save("repository.initialized", actor);
      return project.application;
    });
  }
}
