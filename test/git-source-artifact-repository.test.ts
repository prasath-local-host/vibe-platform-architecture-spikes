import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySourceArtifact } from "../src/build-service.js";
import { collectSourceArtifact } from "../src/git-source-artifact-repository.js";

describe("source artifact collection", () => {
  const revision = "d".repeat(40);

  async function fixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "vcp-artifact-test-"));
    try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
  }

  it("collects text and binary files while excluding Git metadata", async () => fixture(async (directory) => {
    await mkdir(join(directory, "src"));
    await mkdir(join(directory, ".git"));
    await writeFile(join(directory, "src", "main.ts"), "export {};");
    await writeFile(join(directory, "asset.bin"), new Uint8Array([0, 255, 1]));
    await writeFile(join(directory, ".git", "config"), "secret metadata");
    const artifact = await collectSourceArtifact(directory, revision);
    expect(artifact.files.map((file) => file.path)).toEqual(["asset.bin", "src/main.ts"]);
    expect(() => verifySourceArtifact(artifact)).not.toThrow();
  }));

  it("enforces file, aggregate, and count limits", async () => fixture(async (directory) => {
    await writeFile(join(directory, "one"), "1234");
    await writeFile(join(directory, "two"), "5678");
    await expect(collectSourceArtifact(directory, revision, { maximumFileBytes: 3 })).rejects.toThrow("file exceeds");
    await expect(collectSourceArtifact(directory, revision, { maximumTotalBytes: 7 })).rejects.toThrow("total byte");
    await expect(collectSourceArtifact(directory, revision, { maximumFiles: 1 })).rejects.toThrow("file-count");
  }));

  it("rejects symbolic links", async () => fixture(async (directory) => {
    await writeFile(join(directory, "target"), "content");
    try {
      await symlink(join(directory, "target"), join(directory, "link"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(collectSourceArtifact(directory, revision)).rejects.toThrow("symbolic link");
  }));
});
