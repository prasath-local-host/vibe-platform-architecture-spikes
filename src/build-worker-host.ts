import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BuildJobWorker } from "./build-job-service.js";
import { StructuredLogger } from "./observability.js";

@Injectable()
export class BuildWorkerHost implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new StructuredLogger();
  constructor(private readonly worker: BuildJobWorker) {}
  onModuleInit(): void {
    if (process.env.BUILD_WORKER_ENABLED !== "true") return;
    this.timer = setInterval(() => void this.drain(), 500);
    this.timer.unref();
    void this.drain();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (let processed = 0; processed < 5; processed += 1) if (!(await this.worker.tick())) break;
    } catch (error) {
      this.logger.error("build.worker.cycle_failed", { error: error instanceof Error ? error.message : String(error) });
    } finally { this.running = false; }
  }
}
