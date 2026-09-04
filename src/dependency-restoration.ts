import type { SourceArtifact } from "./build-service.js";

export interface DependencyRestoreRequest {
  readonly artifact: SourceArtifact;
  readonly packageManager: "npm" | "pnpm" | "yarn";
}

export interface DependencyRestoreResult {
  readonly status: "succeeded" | "failed";
  readonly exitCode: number;
  readonly durationMs: number;
  readonly output: string;
  readonly outputTruncated: boolean;
}

export interface DependencyRestorer {
  restore(request: DependencyRestoreRequest): Promise<DependencyRestoreResult>;
}
