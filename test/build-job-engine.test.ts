import { describe, expect, it } from "vitest";
import type { ArtifactStore, BuildArtifact } from "../src/artifact-service.js";
import { createSourceArtifact } from "../src/build-service.js";
import { SourceBuildJobEngine } from "../src/build-job-engine.js";
import type { BuildRecord } from "../src/domain.js";

describe("artifact-publishing build job engine", () => {
  const build: BuildRecord = {
    id: "11111111-1111-4111-8111-111111111111", companyId: "company-a",
    applicationId: "22222222-2222-4222-8222-222222222222",
    repositoryUrl: "https://github.com/example/app", sourceRevision: "a".repeat(40),
    packageManager: "npm", script: "build", idempotencyKey: "build-request",
    correlationId: "correlation", status: "running", attempts: 1, createdAt: new Date().toISOString(),
  };

  it("publishes successful output and returns its immutable identity", async () => {
    let published: BuildArtifact | undefined;
    const store: ArtifactStore = {
      async put(artifact) { published = artifact; },
      async get() { return undefined; }, async deleteExpired() { return 0; },
    };
    const engine = new SourceBuildJobEngine(
      { async acquire() { return createSourceArtifact(build.sourceRevision, [{ path: "package.json", content: "{}" }]); } },
      { async execute() { return {
        status: "succeeded", restoration: { status: "succeeded", exitCode: 0, durationMs: 1, output: "", outputTruncated: false },
        build: { status: "succeeded", exitCode: 0, durationMs: 1, output: "", outputTruncated: false },
        outputFiles: [{ path: "dist/app.js", content: new TextEncoder().encode("built") }],
      }; } },
      store,
      30,
    );
    const result = await engine.execute(build);
    expect(published).toMatchObject({ companyId: "company-a", buildId: build.id, totalBytes: 5 });
    expect(result).toMatchObject({ artifactId: published!.id, artifactDigest: published!.digest, buildStatus: "succeeded" });
  });

  it("does not publish missing build output", async () => {
    let puts = 0;
    const engine = new SourceBuildJobEngine(
      { async acquire() { return createSourceArtifact(build.sourceRevision, []); } },
      { async execute() { return { status: "succeeded", restoration: { status: "succeeded", exitCode: 0, durationMs: 1, output: "", outputTruncated: false } }; } },
      { async put() { puts += 1; }, async get() { return undefined; }, async deleteExpired() { return 0; } },
      30,
    );
    await expect(engine.execute(build)).rejects.toThrow("no publishable output");
    expect(puts).toBe(0);
  });
});
