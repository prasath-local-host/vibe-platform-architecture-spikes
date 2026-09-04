import { describe, expect, it } from "vitest";
import { verifySourceArtifact } from "../src/build-service.js";
import { GitHubSourceArtifactRepository } from "../src/git-source-artifact-repository.js";

const repositoryUrl = process.env.TEST_GITHUB_REPOSITORY_URL;
const revision = process.env.TEST_GITHUB_REVISION;

describe.skipIf(!repositoryUrl || !revision)("GitHub source artifact integration", () => {
  it("acquires the exact revision as a verified bounded artifact", async () => {
    const artifact = await new GitHubSourceArtifactRepository({ timeoutMs: 120_000 }).acquire(repositoryUrl!, revision!);
    expect(artifact.revision).toBe(revision!.toLowerCase());
    expect(artifact.files.length).toBeGreaterThan(0);
    expect(() => verifySourceArtifact(artifact)).not.toThrow();
  }, 130_000);
});
