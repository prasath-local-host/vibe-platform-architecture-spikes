import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { StructuredLogger } from "./observability.js";
import { ReleaseWorker } from "./release-service.js";

@Injectable()
export class ReleaseWorkerHost implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout; private running = false; private readonly logger = new StructuredLogger();
  constructor(private readonly worker: ReleaseWorker) {}
  onModuleInit(): void { if (process.env.RELEASE_WORKER_ENABLED !== "true") return; this.timer = setInterval(() => void this.drain(), 500); this.timer.unref(); void this.drain(); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async drain() { if (this.running) return; this.running = true; try { for (let count = 0; count < 5; count += 1) if (!await this.worker.tick()) break; } catch (error) { this.logger.error("release.worker.cycle_failed", { error: error instanceof Error ? error.message : String(error) }); } finally { this.running = false; } }
}
