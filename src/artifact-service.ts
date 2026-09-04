import { createHash, randomUUID } from "node:crypto";

export interface ArtifactFile {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface BuildArtifact {
  readonly id: string;
  readonly companyId: string;
  readonly applicationId: string;
  readonly buildId: string;
  readonly sourceRevision: string;
  readonly digest: string;
  readonly files: readonly ArtifactFile[];
  readonly totalBytes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ArtifactStore {
  put(artifact: BuildArtifact): Promise<void>;
  get(companyId: string, artifactId: string): Promise<BuildArtifact | undefined>;
  deleteExpired(now: string): Promise<number>;
}

export interface CreateBuildArtifactCommand {
  readonly companyId: string;
  readonly applicationId: string;
  readonly buildId: string;
  readonly sourceRevision: string;
  readonly files: readonly ArtifactFile[];
  readonly retentionDays: number;
  readonly now?: string;
}

export function artifactDigest(sourceRevision: string, files: readonly ArtifactFile[]): string {
  if (!/^[0-9a-f]{40}$/i.test(sourceRevision)) throw new Error("Artifact source revision must be a full Git commit SHA");
  const paths = new Set<string>();
  const hash = createHash("sha256");
  hash.update(`revision\0${sourceRevision.toLowerCase()}\0`, "utf8");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = file.path.replaceAll("\\", "/").split("/");
    if (!file.path || file.path.startsWith("/") || /^[A-Za-z]:/.test(file.path) || segments.some((segment) => !segment || segment === "." || segment === "..") || paths.has(file.path)) {
      throw new Error("Artifact contains an invalid or duplicate path");
    }
    paths.add(file.path);
    hash.update(`path\0${file.path}\0length\0${file.content.byteLength}\0`, "utf8");
    hash.update(file.content);
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function createBuildArtifact(command: CreateBuildArtifactCommand): BuildArtifact {
  if (!Number.isInteger(command.retentionDays) || command.retentionDays < 1 || command.retentionDays > 365) {
    throw new Error("Artifact retention must be between 1 and 365 days");
  }
  const createdAt = command.now ?? new Date().toISOString();
  const expiresAt = new Date(new Date(createdAt).getTime() + command.retentionDays * 86_400_000).toISOString();
  return {
    id: randomUUID(), companyId: command.companyId, applicationId: command.applicationId,
    buildId: command.buildId, sourceRevision: command.sourceRevision.toLowerCase(),
    digest: artifactDigest(command.sourceRevision, command.files), files: command.files,
    totalBytes: command.files.reduce((total, file) => total + file.content.byteLength, 0),
    createdAt, expiresAt,
  };
}

export function verifyBuildArtifact(artifact: BuildArtifact): void {
  const bytes = artifact.files.reduce((total, file) => total + file.content.byteLength, 0);
  if (bytes !== artifact.totalBytes || artifact.digest !== artifactDigest(artifact.sourceRevision, artifact.files)) {
    throw new Error("Build artifact integrity verification failed");
  }
}
