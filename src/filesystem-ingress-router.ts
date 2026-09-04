import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ActivateIngressCommand, IngressRoute, IngressRouter } from "./ingress-router.js";

function routeKey(companyId: string, applicationId: string): string {
  return createHash("sha256").update(`${companyId}\0${applicationId}`, "utf8").digest("hex");
}

function validate(command: ActivateIngressCommand): void {
  if (!command.companyId || !/^[0-9a-f-]{36}$/i.test(command.applicationId) || !/^[0-9a-f-]{36}$/i.test(command.releaseId)) throw new Error("Ingress route identity is invalid");
  const upstream = new URL(command.upstreamUrl);
  if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1" || !upstream.port || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("Ingress upstream must be a credential-free loopback HTTP origin");
  if (Number.isNaN(new Date(command.activatedAt).getTime())) throw new Error("Ingress activation timestamp is invalid");
}

export class FilesystemIngressRouter implements IngressRouter {
  private readonly root: string;
  private readonly locks = new Map<string, Promise<void>>();
  constructor(root: string) { if (!root) throw new Error("Ingress route root is required"); this.root = resolve(root); }

  async activate(command: ActivateIngressCommand): Promise<{ readonly route: IngressRoute; readonly previous?: IngressRoute }> {
    validate(command);
    const key = routeKey(command.companyId, command.applicationId);
    const previousLock = this.locks.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const lock = new Promise<void>((resolveLock) => { unlock = resolveLock; });
    const queued = previousLock.then(() => lock);
    this.locks.set(key, queued);
    await previousLock;
    try {
      const previous = await this.current(command.companyId, command.applicationId);
      const route: IngressRoute = { ...command, stablePath: `/apps/${encodeURIComponent(command.companyId)}/${command.applicationId}` };
      await mkdir(this.root, { recursive: true });
      const destination = join(this.root, `${key}.json`);
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
      try { await writeFile(temporary, `${JSON.stringify(route)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temporary, destination); }
      finally { await rm(temporary, { force: true }); }
      return { route, ...(previous ? { previous } : {}) };
    } finally { unlock(); if (this.locks.get(key) === queued) this.locks.delete(key); }
  }

  async current(companyId: string, applicationId: string): Promise<IngressRoute | undefined> {
    try {
      const route = JSON.parse(await readFile(join(this.root, `${routeKey(companyId, applicationId)}.json`), "utf8")) as IngressRoute;
      if (route.companyId !== companyId || route.applicationId !== applicationId) throw new Error("Ingress route identity mismatch");
      return route;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  async list(): Promise<readonly IngressRoute[]> {
    try {
      const routes: IngressRoute[] = [];
      for (const entry of (await readdir(this.root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
        const route = JSON.parse(await readFile(join(this.root, entry.name), "utf8")) as IngressRoute;
        validate(route);
        if (`${routeKey(route.companyId, route.applicationId)}.json` !== entry.name) throw new Error("Ingress route filename does not match its identity");
        routes.push(route);
      }
      return routes;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
}
