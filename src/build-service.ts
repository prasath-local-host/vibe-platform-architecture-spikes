import { createHash } from "node:crypto";

export interface BuildSourceFile {
  readonly path: string;
  readonly content: string | Uint8Array;
}

export interface SourceArtifact {
  readonly revision: string;
  readonly digest: string;
  readonly files: readonly BuildSourceFile[];
}

export interface SourceArtifactRepository {
  acquire(repositoryUrl: string, revision: string): Promise<SourceArtifact>;
}

function fileBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
}

export function sourceArtifactDigest(revision: string, files: readonly BuildSourceFile[]): string {
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error("Source artifact revision must be a full Git commit SHA");
  }
  const paths = new Set<string>();
  const hash = createHash("sha256");
  hash.update(`revision\0${revision.toLowerCase()}\0`, "utf8");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    if (paths.has(file.path)) throw new Error("Source artifact contains a duplicate path");
    paths.add(file.path);
    const bytes = fileBytes(file.content);
    hash.update(`path\0${file.path}\0length\0${bytes.byteLength}\0`, "utf8");
    hash.update(bytes);
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function createSourceArtifact(revision: string, files: readonly BuildSourceFile[]): SourceArtifact {
  return { revision: revision.toLowerCase(), digest: sourceArtifactDigest(revision, files), files };
}

export function verifySourceArtifact(artifact: SourceArtifact): void {
  if (artifact.digest !== sourceArtifactDigest(artifact.revision, artifact.files)) {
    throw new Error("Source artifact integrity verification failed");
  }
}

export interface BuildExecutionRequest {
  readonly artifact: SourceArtifact;
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
