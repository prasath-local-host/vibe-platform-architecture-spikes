import { describe, expect, it } from "vitest";
import { GitHubSourceRepository } from "../src/git-source-repository.js";

const repositoryUrl = process.env.TEST_GITHUB_REPOSITORY;
const revision = process.env.TEST_GITHUB_REVISION;

describe.skipIf(!repositoryUrl || !revision)("GitHub source integration", () => {
  it("checks out the exact public commit and collects only supported manifests", async () => {
    const snapshot = await new GitHubSourceRepository({ timeoutMs: 60_000 }).checkout(
      repositoryUrl!,
      revision!,
    );
    expect(snapshot.revision).toBe(revision!.toLowerCase());
    expect(snapshot.files.map((file) => file.path)).toContain("package.json");
    expect(snapshot.files.every((file) => !file.path.includes("/"))).toBe(true);
  }, 70_000);
});
