import { describe, expect, it } from "vitest";
import { createSourceArtifact, sourceArtifactDigest, verifySourceArtifact } from "../src/build-service.js";

describe("immutable source artifact", () => {
  const revision = "c".repeat(40);

  it("has a deterministic digest independent of file order", () => {
    const files = [
      { path: "src/main.ts", content: "main" },
      { path: "package.json", content: new TextEncoder().encode("{}") },
    ];
    expect(sourceArtifactDigest(revision, files)).toBe(
      sourceArtifactDigest(revision.toUpperCase(), [...files].reverse()),
    );
  });

  it("detects content, path, and revision tampering", () => {
    const artifact = createSourceArtifact(revision, [{ path: "package.json", content: "{}" }]);
    expect(() => verifySourceArtifact(artifact)).not.toThrow();
    expect(() => verifySourceArtifact({ ...artifact, revision: "d".repeat(40) })).toThrow("integrity");
    expect(() => verifySourceArtifact({ ...artifact, files: [{ path: "package.json", content: "changed" }] })).toThrow("integrity");
    expect(() => verifySourceArtifact({ ...artifact, files: [{ path: "other.json", content: "{}" }] })).toThrow("integrity");
  });

  it("rejects ambiguous duplicate paths and incomplete revisions", () => {
    expect(() => createSourceArtifact(revision, [
      { path: "package.json", content: "one" },
      { path: "package.json", content: "two" },
    ])).toThrow("duplicate path");
    expect(() => createSourceArtifact("main", [])).toThrow("full Git commit SHA");
  });
});
