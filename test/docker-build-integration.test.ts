import { describe, expect, it } from "vitest";
import { createSourceArtifact } from "../src/build-service.js";
import { DockerBuildExecutor } from "../src/docker-build-executor.js";

const image = process.env.TEST_BUILD_IMAGE;

describe.skipIf(!image)("Docker build integration", () => {
  it("executes a harmless fixture without network or elevated privileges", async () => {
    const result = await new DockerBuildExecutor({ image: image!, timeoutMs: 30_000 }).execute({
      packageManager: "npm",
      script: "build",
      artifact: createSourceArtifact("b".repeat(40), [{
        path: "package.json",
        content: JSON.stringify({ scripts: { build: "node -e \"console.log('isolated-build-ok')\"" } }),
      }]),
    });
    expect(result).toMatchObject({ status: "succeeded", exitCode: 0, outputTruncated: false });
    expect(result.output).toContain("isolated-build-ok");
  }, 40_000);
});
