import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SignJWT } from "jose";
import { z } from "zod";
import { ProvisioningError, type OrganizationBinding, type ProjectGitHubGateway, type ProvisionedProject } from "./project-provisioning-service.js";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const installationSchema = z.object({ id, suspended_at: z.string().nullable(),
  account: z.object({ id, login: z.string(), type: z.literal("Organization") }),
  permissions: z.object({ administration: z.literal("write"), contents: z.literal("write") }) });
const repositorySchema = z.object({ id, name: z.string(), private: z.literal(true), fork: z.literal(false),
  owner: z.object({ id, login: z.string(), type: z.literal("Organization") }), default_branch: z.string().min(1) });

export class GitHubProjectGateway implements ProjectGitHubGateway {
  constructor(private readonly appId: string, private readonly privateKeyFile: string,
    private readonly transport: typeof fetch = fetch) {}

  private async request(token: string, path: string, method = "GET", body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(`https://api.github.com${path}`, { method, redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new ProvisioningError("GitHub did not return a confirmed result. Refresh the request status or contact the VCP team.", 502); }
    if (!response.ok) throw new ProvisioningError(`GitHub setup failed (${response.status}). Contact the VCP team; credentials and repository policy may need review.`, 502);
    return response.json();
  }
  private async appToken() {
    const key = createPrivateKey(await readFile(this.privateKeyFile));
    return new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(this.appId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60).setExpirationTime("5m").sign(key);
  }
  private async installation(slug: string) {
    const token = await this.appToken();
    const result = installationSchema.parse(await this.request(token, `/orgs/${encodeURIComponent(slug)}/installation`));
    if (result.account.login.toLowerCase() !== slug.toLowerCase() || result.suspended_at) throw new ProvisioningError("The GitHub App installation does not match an active company organization.");
    return { token, result };
  }
  async verify(slug: string) {
    const { result } = await this.installation(slug);
    return { organizationId: result.account.id, installationId: result.id };
  }
  private async token(binding: OrganizationBinding) {
    const { token, result } = await this.installation(binding.slug);
    if (binding.status !== "verified" || binding.organizationId !== result.account.id || binding.installationId !== result.id) {
      throw new ProvisioningError("The GitHub organization or installation changed. Contact the VCP team to verify the connection again.");
    }
    return z.object({ token: z.string().min(1) }).parse(await this.request(token, `/app/installations/${result.id}/access_tokens`, "POST", {
      permissions: { administration: "write", contents: "write" },
    })).token;
  }
  private checkRepository(value: unknown, binding: OrganizationBinding, name: string, expectedId?: number) {
    const repository = repositorySchema.parse(value);
    if (repository.owner.id !== binding.organizationId || repository.owner.login.toLowerCase() !== binding.slug ||
      repository.name !== name || (expectedId !== undefined && repository.id !== expectedId)) {
      throw new ProvisioningError("Repository identity changed. Contact the VCP team; initialization was stopped.");
    }
    return repository;
  }
  async create(binding: OrganizationBinding, name: string) {
    const token = await this.token(binding);
    const repository = this.checkRepository(await this.request(token, `/orgs/${encodeURIComponent(binding.slug)}/repos`, "POST", {
      name, private: true, auto_init: true, has_issues: false, has_projects: false, has_wiki: false,
      description: "Application managed by the Vibe Coding Platform",
    }), binding, name);
    return { id: repository.id, url: `https://github.com/${binding.slug}/${name}` };
  }
  async initialize(binding: OrganizationBinding, project: ProvisionedProject) {
    const token = await this.token(binding);
    const base = `/repos/${encodeURIComponent(binding.slug)}/${encodeURIComponent(project.repositoryName)}`;
    const repository = this.checkRepository(await this.request(token, base), binding, project.repositoryName, project.repositoryId);
    if (!project.repositoryId) throw new ProvisioningError("Missing repository identity.");
    const refPath = `${base}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`;
    const ref = z.object({ object: z.object({ sha }) }).parse(await this.request(token, refPath));
    const commit = z.object({ tree: z.object({ sha }) }).parse(await this.request(token, `${base}/git/commits/${ref.object.sha}`));
    const tree = z.object({ truncated: z.literal(false), tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.string(), sha })) })
      .parse(await this.request(token, `${base}/git/trees/${commit.tree.sha}?recursive=1`));
    const paths = Object.keys(project.files);
    if (tree.tree.some(entry => entry.type !== "blob" || entry.mode !== "100644" || !paths.includes(entry.path))) {
      throw new ProvisioningError("Repository already contains application changes. Contact the VCP team before initialization.");
    }
    if (tree.tree.length !== 1 || tree.tree[0]?.path !== "README.md") {
      // A prior initialization may have succeeded while the client lost the response.
      if (tree.tree.length !== paths.length) throw new ProvisioningError("Repository initialization is incomplete or changed. Contact the VCP team.");
      for (const entry of tree.tree) {
        const blob = z.object({ encoding: z.literal("base64"), content: z.string() })
          .parse(await this.request(token, `${base}/git/blobs/${entry.sha}`));
        if (Buffer.from(blob.content, "base64").toString("utf8") !== project.files[entry.path]) {
          throw new ProvisioningError("Repository policy files changed. Contact the VCP team; no files were overwritten.");
        }
      }
      return;
    }
    // Only the untouched GitHub auto-initialization README is eligible for replacement.
    const history = z.array(z.unknown()).parse(await this.request(token, `${base}/commits?per_page=2&sha=${ref.object.sha}`));
    if (history.length !== 1) throw new ProvisioningError("Repository has additional commits. Contact the VCP team.");
    const createdTree = z.object({ sha }).parse(await this.request(token, `${base}/git/trees`, "POST", {
      base_tree: commit.tree.sha, tree: Object.entries(project.files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })),
    }));
    const createdCommit = z.object({ sha }).parse(await this.request(token, `${base}/git/commits`, "POST", {
      message: "Initialize VCP application policy and PostgreSQL profile", tree: createdTree.sha, parents: [ref.object.sha],
    }));
    await this.request(token, `${base}/git/refs/heads/${encodeURIComponent(repository.default_branch)}`, "PATCH", { sha: createdCommit.sha, force: false });
  }
}
