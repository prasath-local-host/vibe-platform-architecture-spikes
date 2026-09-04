import { describe, expect, it } from "vitest";
import { ManifestAssessmentEngine } from "../src/manifest-assessment-engine.js";

const revision = "0123456789abcdef0123456789abcdef01234567";

describe("manifest assessment engine", () => {
  it("detects a Next.js stack and reports missing production controls", async () => {
    const engine = new ManifestAssessmentEngine({
      async checkout(repositoryUrl, requestedRevision) {
        expect(repositoryUrl).toBe("https://github.com/example/app.git");
        return {
          revision: requestedRevision,
          files: [
            { path: "package.json", content: JSON.stringify({ dependencies: { next: "14", react: "18" }, scripts: { build: "next build" } }) },
            { path: "package-lock.json", content: "{}" },
          ],
        };
      },
    });

    await expect(engine.assess("https://github.com/example/app.git", revision)).resolves.toEqual({
      profile: "nextjs-web-application",
      detectedStack: ["nextjs", "nodejs", "react"],
      manifests: ["package.json", "package-lock.json"],
      findings: ["package.json does not define a test script", "No Dockerfile was detected"],
    });
  });

  it("rejects a provider response for a different revision", async () => {
    const engine = new ManifestAssessmentEngine({
      async checkout() { return { revision: "f".repeat(40), files: [] }; },
    });
    await expect(engine.assess("https://github.com/example/app.git", revision)).rejects.toThrow(
      "Source revision did not match",
    );
  });
});
