import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { verifyBuildArtifact, type ArtifactStore, type BuildArtifact } from "./artifact-service.js";

interface SerializedArtifact extends Omit<BuildArtifact, "files"> {
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

function serialize(artifact: BuildArtifact): string {
  return JSON.stringify({ ...artifact, files: artifact.files.map((file) => ({ path: file.path, content: Buffer.from(file.content).toString("base64") })) });
}

function deserialize(value: string): BuildArtifact {
  const stored = JSON.parse(value) as SerializedArtifact;
  return { ...stored, files: stored.files.map((file) => ({ path: file.path, content: Buffer.from(file.content, "base64") })) };
}

export class FilesystemArtifactStore implements ArtifactStore {
  private readonly root: string;
  constructor(root: string, private readonly maximumArtifactBytes = 100 * 1024 * 1024) {
    if (!root) throw new Error("Artifact root is required");
    this.root = resolve(root);
  }

  async put(artifact: BuildArtifact): Promise<void> {
    verifyBuildArtifact(artifact);
    if (artifact.totalBytes > this.maximumArtifactBytes) throw new Error("Build artifact exceeds the configured byte limit");
    await mkdir(this.root, { recursive: true });
    const destination = this.path(artifact.id);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, serialize(artifact), { encoding: "utf8", flag: "wx" });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async get(companyId: string, artifactId: string): Promise<BuildArtifact | undefined> {
    try {
      const artifact = deserialize(await readFile(this.path(artifactId), "utf8"));
      verifyBuildArtifact(artifact);
      return artifact.companyId === companyId ? artifact : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async deleteExpired(now: string): Promise<number> {
    await mkdir(this.root, { recursive: true });
    let deleted = 0;
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(this.root, entry.name);
      const artifact = deserialize(await readFile(path, "utf8"));
      verifyBuildArtifact(artifact);
      if (artifact.expiresAt <= now) { await rm(path); deleted += 1; }
    }
    return deleted;
  }

  private path(artifactId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId) || basename(artifactId) !== artifactId) throw new Error("Artifact identifier is invalid");
    return join(this.root, `${artifactId}.json`);
  }
}
