import { describe, expect, it } from "vitest";
import { validateGitHubRepositoryUrl } from "../src/git-source-repository.js";

describe("GitHub source repository boundary", () => {
  it("accepts canonical credential-free HTTPS repository URLs", () => {
    expect(validateGitHubRepositoryUrl("https://github.com/example/application.git").toString())
      .toBe("https://github.com/example/application.git");
  });

  it.each([
    "http://github.com/example/application",
    "https://token@github.com/example/application",
    "https://github.example.com/example/application",
    "https://github.com/example/application?ref=main",
    "https://github.com/example",
  ])("rejects unsafe repository URL %s", (value) => {
    expect(() => validateGitHubRepositoryUrl(value)).toThrow(
      "Only credential-free HTTPS GitHub repository URLs are supported",
    );
  });
});
