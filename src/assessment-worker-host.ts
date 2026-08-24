import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AssessmentWorker } from "./assessment-service.js";

@Injectable()
export class AssessmentWorkerHost implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly worker: AssessmentWorker) {}

  onModuleInit(): void {
    if (process.env.ASSESSMENT_WORKER_ENABLED === "false") return;
    this.timer = setInterval(() => void this.drain(), 250);
    this.timer.unref();
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let processed = 0; processed < 10; processed += 1) {
        if (!(await this.worker.tick())) break;
      }
    } catch (error) {
      console.error("Assessment worker cycle failed", error);
    } finally {
      this.running = false;
    }
  }
}
