import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBuildArtifact } from "../src/artifact-service.js";
import { FilesystemArtifactStore } from "../src/filesystem-artifact-store.js";

describe("filesystem build artifact store", () => {
  async function fixture(run: (root: string, store: FilesystemArtifactStore) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "vcp-artifacts-test-"));
    try { await run(root, new FilesystemArtifactStore(root, 1024)); } finally { await rm(root, { recursive: true, force: true }); }
  }
  const artifact = (now = "2026-01-01T00:00:00.000Z") => createBuildArtifact({
    companyId: "company-a", applicationId: "app-a", buildId: "build-a",
    sourceRevision: "a".repeat(40), retentionDays: 30, now,
    files: [{ path: "dist/app.js", content: new Uint8Array([0, 255, 1, 2]) }],
  });

  it("round-trips binary content with integrity and tenant isolation", async () => fixture(async (_root, store) => {
    const value = artifact();
    await store.put(value);
    expect(await store.get("company-a", value.id)).toMatchObject({ digest: value.digest, totalBytes: 4 });
    expect(Array.from((await store.get("company-a", value.id))!.files[0]!.content)).toEqual([0, 255, 1, 2]);
    expect(await store.get("company-b", value.id)).toBeUndefined();
  }));

  it("detects stored content tampering", async () => fixture(async (root, store) => {
    const value = artifact();
    await store.put(value);
    const path = join(root, `${value.id}.json`);
    const stored = JSON.parse(await readFile(path, "utf8"));
    stored.files[0].content = Buffer.from("tampered").toString("base64");
    await writeFile(path, JSON.stringify(stored));
    await expect(store.get("company-a", value.id)).rejects.toThrow("integrity");
  }));

  it("deletes only expired artifacts", async () => fixture(async (_root, store) => {
    const expired = artifact("2025-01-01T00:00:00.000Z");
    const retained = artifact("2026-01-01T00:00:00.000Z");
    await store.put(expired); await store.put(retained);
    expect(await store.deleteExpired("2026-01-15T00:00:00.000Z")).toBe(1);
    expect(await store.get("company-a", expired.id)).toBeUndefined();
    expect(await store.get("company-a", retained.id)).toBeDefined();
  }));

  it("enforces retention, size, and identifier boundaries", async () => fixture(async (_root, store) => {
    expect(() => createBuildArtifact({ companyId: "c", applicationId: "a", buildId: "b", sourceRevision: "a".repeat(40), retentionDays: 0, files: [] })).toThrow("retention");
    const tooLarge = createBuildArtifact({ companyId: "c", applicationId: "a", buildId: "b", sourceRevision: "a".repeat(40), retentionDays: 1, files: [{ path: "large", content: new Uint8Array(1025) }] });
    await expect(store.put(tooLarge)).rejects.toThrow("byte limit");
    await expect(store.get("company-a", "../escape")).rejects.toThrow("identifier");
    expect(() => createBuildArtifact({ companyId: "c", applicationId: "a", buildId: "b", sourceRevision: "a".repeat(40), retentionDays: 1, files: [{ path: "../escape", content: new Uint8Array() }] })).toThrow("invalid");
  }));
});
