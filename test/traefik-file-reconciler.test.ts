import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemIngressRouter } from "../src/filesystem-ingress-router.js";
import { TraefikFileReconciler } from "../src/traefik-file-reconciler.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Traefik file-provider reconciliation", () => {
  it("publishes deterministic path routers, services, and strip middleware", async () => {
    const root = await mkdtemp(join(tmpdir(), "vcp-traefik-")); roots.push(root);
    const routes = new FilesystemIngressRouter(join(root, "routes"));
    const applicationId = "11111111-1111-4111-8111-111111111111";
    await routes.activate({ companyId: "company-a", applicationId, releaseId: "22222222-2222-4222-8222-222222222222", upstreamUrl: "http://127.0.0.1:31000", activatedAt: "2026-09-04T20:00:00.000Z" });
    const output = join(root, "dynamic", "vcp.json");
    await expect(new TraefikFileReconciler(routes, output).reconcile()).resolves.toBe(1);
    const document = JSON.parse(await readFile(output, "utf8"));
    const key = `vcp-${applicationId}`;
    expect(document.http.routers[key]).toEqual({ rule: "PathPrefix(`/apps/company-a/11111111-1111-4111-8111-111111111111`)", entryPoints: ["websecure"], service: key, middlewares: [`${key}-strip`] });
    expect(document.http.services[key].loadBalancer.servers).toEqual([{ url: "http://127.0.0.1:31000" }]);
    expect(document.http.middlewares[`${key}-strip`].stripPrefix.prefixes).toEqual(["/apps/company-a/11111111-1111-4111-8111-111111111111"]);
  });

  it("reconciles an empty route set to remove stale dynamic configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "vcp-traefik-empty-")); roots.push(root);
    const output = join(root, "vcp.json");
    await new TraefikFileReconciler(new FilesystemIngressRouter(join(root, "routes")), output, "web").reconcile();
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual({ http: { routers: {}, services: {}, middlewares: {} } });
  });
});
