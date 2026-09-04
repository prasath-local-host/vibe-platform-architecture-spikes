import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { StructuredLogger } from "./observability.js";
import type { IngressReconciler } from "./traefik-file-reconciler.js";

@Injectable()
export class IngressReconcilerHost implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout; private running = false; private readonly logger = new StructuredLogger();
  constructor(private readonly reconciler: IngressReconciler) {}
  onModuleInit(): void { if (process.env.INGRESS_RECONCILER_ENABLED !== "true") return; this.timer = setInterval(() => void this.run(), Number(process.env.INGRESS_RECONCILE_INTERVAL_MS ?? 1000)); this.timer.unref(); void this.run(); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async run() { if (this.running) return; this.running = true; try { const routes = await this.reconciler.reconcile(); this.logger.info("ingress.routes.reconciled", { routes }); } catch (error) { this.logger.error("ingress.reconcile.failed", { error: error instanceof Error ? error.message : String(error) }); } finally { this.running = false; } }
}
