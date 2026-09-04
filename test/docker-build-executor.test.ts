import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DockerBuildExecutor } from "../src/docker-build-executor.js";

describe("Docker build executor", () => {
  const image = `node:24-alpine@sha256:${"a".repeat(64)}`;

  it("uses a disposable, non-root, networkless, resource-limited container", async () => {
    let workspace = "";
    const executor = new DockerBuildExecutor(
      { image, timeoutMs: 5_000 },
      async (arguments_) => {
        expect(arguments_).toEqual(expect.arrayContaining([
          "--network", "none", "--read-only", "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges", "--user", "65532:65532",
        ]));
        const mount = arguments_[arguments_.indexOf("--mount") + 1]!;
        workspace = mount.split(",source=")[1]!.split(",target=")[0]!;
        await expect(access(join(workspace, "package.json"))).resolves.toBeUndefined();
        return { exitCode: 0, output: "build passed", outputTruncated: false };
      },
    );

    await expect(executor.execute({
      packageManager: "npm",
      script: "build",
      files: [{ path: "package.json", content: "{}" }],
    })).resolves.toMatchObject({ status: "succeeded", exitCode: 0, output: "build passed" });
    await expect(access(workspace)).rejects.toBeDefined();
  });

  it.each(["../secret", "/absolute", "C:\\absolute"])("rejects unsafe source path %s", async (path) => {
    const executor = new DockerBuildExecutor(
      { image },
      async () => ({ exitCode: 0, output: "", outputTruncated: false }),
    );
    await expect(executor.execute({ packageManager: "npm", script: "build", files: [{ path, content: "x" }] }))
      .rejects.toThrow("unsafe path");
  });

  it("enforces the aggregate source byte limit", async () => {
    const executor = new DockerBuildExecutor(
      { image, maximumSourceBytes: 3 },
      async () => ({ exitCode: 0, output: "", outputTruncated: false }),
    );
    await expect(executor.execute({ packageManager: "npm", script: "build", files: [{ path: "a.txt", content: "four" }] }))
      .rejects.toThrow("byte limit");
  });

  it("rejects mutable image tags", () => {
    expect(() => new DockerBuildExecutor({ image: "node:24-alpine" })).toThrow("digest-pinned");
  });
});
