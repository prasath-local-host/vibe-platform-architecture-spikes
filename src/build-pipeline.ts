import type { SourceArtifact } from "./build-service.js";
import type { DependencyRestoreResult } from "./dependency-restoration.js";
import type { BuildExecutionResult } from "./build-service.js";

export interface BuildPipelineRequest {
  readonly artifact: SourceArtifact;
  readonly packageManager: "npm" | "pnpm" | "yarn";
  readonly script: "build" | "test";
}

export interface BuildPipelineResult {
  readonly status: "succeeded" | "restore-failed" | "build-failed";
  readonly restoration: DependencyRestoreResult;
  readonly build?: BuildExecutionResult;
}

export interface BuildPipeline {
  execute(request: BuildPipelineRequest): Promise<BuildPipelineResult>;
}
