export interface BuildSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface BuildExecutionRequest {
  readonly files: readonly BuildSourceFile[];
  readonly packageManager: "npm" | "pnpm" | "yarn";
  readonly script: "build" | "test";
}

export interface BuildExecutionResult {
  readonly status: "succeeded" | "failed";
  readonly exitCode: number;
  readonly durationMs: number;
  readonly output: string;
  readonly outputTruncated: boolean;
}

export interface BuildExecutor {
  execute(request: BuildExecutionRequest): Promise<BuildExecutionResult>;
}
