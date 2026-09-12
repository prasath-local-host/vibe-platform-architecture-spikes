import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubProjectGateway } from "../src/github-project-gateway.js";
import type { OrganizationBinding, ProvisionedProject } from "../src/project-provisioning-service.js";
const binding: OrganizationBinding = { slug: "company", status: "verified", requestedBy: "alice", organizationId: 10, installationId: 20 };
const installation = { id: 20, suspended_at: null, account: { id: 10, login: "company", type: "Organization" }, permissions: { administration: "write", contents: "write" } };
const repository = { id: 30, name: "portal", private: true, fork: false, owner: installation.account, default_branch: "main" };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(replies: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), "vcp-github-test-")); dirs.push(dir);
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  await writeFile(join(dir, "test.pem"), key);
  const calls: { url: string; options: RequestInit }[] = [];
  const transport: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options: options! });
    const value = replies.shift(); if (value === undefined) throw new Error("Unexpected request");
    return Response.json(value);
  };
  return { gateway: new GitHubProjectGateway("1", join(dir, "test.pem"), transport), calls };
}
describe("GitHub project boundary", () => {
  it("creates only a private organization repository with a server-held installation token", async () => {
    const f = await fixture([installation, { token: "test-installation-token" }, repository]);
    expect(await f.gateway.create(binding, "portal")).toEqual({ id: 30, url: "https://github.com/company/portal" });
    expect(f.calls[2]!.url).toBe("https://api.github.com/orgs/company/repos");
    expect(JSON.parse(String(f.calls[2]!.options.body))).toMatchObject({ private: true, auto_init: true });
    expect(f.calls.every(call => call.options.redirect === "error")).toBe(true);
  });
  it("rejects revoked, renamed, transferred or underprivileged installations before creation", async () => {
    for (const changed of [{ ...installation, id: 21 }, { ...installation, suspended_at: "2026-09-13" },
      { ...installation, account: { ...installation.account, id: 11 } }, { ...installation, permissions: { contents: "read" } }]) {
      const f = await fixture([changed]); await expect(f.gateway.create(binding, "portal")).rejects.toThrow(); expect(f.calls).toHaveLength(1);
    }
  });
  it("rejects a repository that changed identity without writing anything", async () => {
    const f = await fixture([installation, { token: "test-token" }, { ...repository, id: 31 }]);
    await expect(f.gateway.initialize(binding, project())).rejects.toThrow(/identity/);
    expect(f.calls.some(call => call.url.includes("/git/"))).toBe(false);
  });
  it("does not overwrite customer files", async () => {
    const f = await fixture([installation, { token: "test-token" }, repository, { object: { sha: "a".repeat(40) } },
      { tree: { sha: "b".repeat(40) } }, { truncated: false, tree: [{ path: "app.ts", type: "blob", mode: "100644", sha: "c".repeat(40) }] }]);
    await expect(f.gateway.initialize(binding, project())).rejects.toThrow(/application changes/);
    expect(f.calls.filter(call => call.options.method === "PATCH")).toHaveLength(0);
  });
  it("publishes the complete template in one non-forced commit", async () => {
    const f = await fixture([installation, { token: "test-token" }, repository, { object: { sha: "a".repeat(40) } },
      { tree: { sha: "b".repeat(40) } }, { truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: "c".repeat(40) }] },
      [{}], { sha: "d".repeat(40) }, { sha: "e".repeat(40) }, {}]);
    await f.gateway.initialize(binding, project());
    expect(JSON.parse(String(f.calls.at(-1)!.options.body))).toEqual({ sha: "e".repeat(40), force: false });
    expect(JSON.parse(String(f.calls.at(-3)!.options.body)).tree.map((entry: { path: string }) => entry.path)).toContain("AGENTS.md");
  });
  it("recovers a lost commit response only when every policy file still matches", async () => {
    const p = project();
    for (const changed of [false, true]) {
      const files = Object.entries(p.files);
      const f = await fixture([installation, { token: "test-token" }, repository, { object: { sha: "a".repeat(40) } },
        { tree: { sha: "b".repeat(40) } }, { truncated: false, tree: files.map(([path]) => ({ path, type: "blob", mode: "100644", sha: "c".repeat(40) })) },
        ...files.map(([, content], index) => ({ encoding: "base64", content: Buffer.from(changed && index === 0 ? "Changed" : content).toString("base64") }))]);
      if (changed) await expect(f.gateway.initialize(binding, p)).rejects.toThrow(/policy files changed/);
      else await f.gateway.initialize(binding, p);
      expect(f.calls.some(call => call.options.method === "PATCH" || (call.options.method === "POST" && call.url.includes("/git/")))).toBe(false);
    }
  });
});
function project(): ProvisionedProject { return { id: "request", name: "Portal", repositoryName: "portal", idempotencyKey: "request-123", status: "initializing", repositoryId: 30, files: { "README.md": "Read AGENTS.md", "AGENTS.md": "Policy" } }; }
