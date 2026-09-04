import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { IngressRouter } from "./ingress-router.js";

export interface IngressReconciler { reconcile(): Promise<number>; }
export class UnavailableIngressReconciler implements IngressReconciler { async reconcile(): Promise<number> { throw new Error("Ingress reconciliation is not configured"); } }

export class TraefikFileReconciler implements IngressReconciler {
  private readonly output: string;
  constructor(private readonly routes: IngressRouter, output: string, private readonly entryPoint = "websecure") {
    if (!output) throw new Error("Traefik dynamic configuration output is required");
    if (!/^[a-zA-Z0-9_-]+$/.test(entryPoint)) throw new Error("Traefik entry point is invalid");
    this.output = resolve(output);
  }

  async reconcile(): Promise<number> {
    const routers: Record<string, unknown> = {}; const services: Record<string, unknown> = {}; const middlewares: Record<string, unknown> = {};
    const routes = await this.routes.list();
    for (const route of routes) {
      const key = `vcp-${route.applicationId}`;
      const middleware = `${key}-strip`;
      routers[key] = { rule: `PathPrefix(\`${route.stablePath}\`)`, entryPoints: [this.entryPoint], service: key, middlewares: [middleware] };
      services[key] = { loadBalancer: { servers: [{ url: route.upstreamUrl }], passHostHeader: true } };
      middlewares[middleware] = { stripPrefix: { prefixes: [route.stablePath] } };
    }
    const document = { http: { routers, services, middlewares } };
    await mkdir(dirname(this.output), { recursive: true });
    const temporary = `${this.output}.${process.pid}.${Date.now()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temporary, this.output); }
    finally { await rm(temporary, { force: true }); }
    return routes.length;
  }
}
