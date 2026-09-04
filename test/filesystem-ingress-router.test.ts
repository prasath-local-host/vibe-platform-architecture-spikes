import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemIngressRouter } from "../src/filesystem-ingress-router.js";

const roots: string[] = [];
async function router() { const root = await mkdtemp(join(tmpdir(), "vcp-routes-")); roots.push(root); return new FilesystemIngressRouter(root); }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const base = { companyId: "company-a", applicationId: "11111111-1111-4111-8111-111111111111", activatedAt: "2026-09-04T20:00:00.000Z" };

describe("filesystem ingress router", () => {
  it("atomically activates a stable tenant/application route", async () => {
    const routes = await router();
    const result = await routes.activate({ ...base, releaseId: "22222222-2222-4222-8222-222222222222", upstreamUrl: "http://127.0.0.1:31000" });
    expect(result.route).toMatchObject({ stablePath: "/apps/company-a/11111111-1111-4111-8111-111111111111", upstreamUrl: "http://127.0.0.1:31000" });
    await expect(routes.current(base.companyId, base.applicationId)).resolves.toEqual(result.route);
  });

  it("returns the previous route as an explicit rollback target", async () => {
    const routes = await router();
    const first = (await routes.activate({ ...base, releaseId: "22222222-2222-4222-8222-222222222222", upstreamUrl: "http://127.0.0.1:31000" })).route;
    const second = await routes.activate({ ...base, releaseId: "33333333-3333-4333-8333-333333333333", upstreamUrl: "http://127.0.0.1:32000", activatedAt: "2026-09-04T20:01:00.000Z" });
    expect(second.previous).toEqual(first);
    expect((await routes.current(base.companyId, base.applicationId))?.releaseId).toBe(second.route.releaseId);
  });

  it("serializes concurrent switches without producing a partial route", async () => {
    const routes = await router();
    await Promise.all([
      routes.activate({ ...base, releaseId: "22222222-2222-4222-8222-222222222222", upstreamUrl: "http://127.0.0.1:31000" }),
      routes.activate({ ...base, releaseId: "33333333-3333-4333-8333-333333333333", upstreamUrl: "http://127.0.0.1:32000" }),
    ]);
    expect(["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]).toContain((await routes.current(base.companyId, base.applicationId))?.releaseId);
  });

  it("rejects non-loopback or credential-bearing upstreams", async () => {
    const routes = await router();
    await expect(routes.activate({ ...base, releaseId: "22222222-2222-4222-8222-222222222222", upstreamUrl: "https://public.example" })).rejects.toThrow("loopback");
    await expect(routes.activate({ ...base, releaseId: "22222222-2222-4222-8222-222222222222", upstreamUrl: "http://user:secret@127.0.0.1:3000" })).rejects.toThrow("credential-free");
  });
});
