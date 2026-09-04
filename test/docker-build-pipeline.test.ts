import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSourceArtifact } from "../src/build-service.js";
import { DockerBuildPipeline } from "../src/docker-build-pipeline.js";

describe("Docker build pipeline handoff", () => {
  const image = `node:24-alpine@sha256:${"a".repeat(64)}`;
  const config = {
    image,
    egressNetwork: "vcp-dependency-egress",
    registryUrl: "https://registry.npmjs.org/",
    allowedRegistryOrigins: ["https://registry.npmjs.org"],
  } as const;
  const artifact = () => createSourceArtifact("e".repeat(40), [
    { path: "package.json", content: "{}" },
    { path: "package-lock.json", content: "{}" },
    { path: "src/main.ts", content: "export {};" },
  ]);

  it("restores then builds the same verified workspace without build networking", async () => {
    const invocations: readonly string[][] = [];
    let workspace = "";
    const pipeline = new DockerBuildPipeline(config, async (arguments_) => {
      (invocations as string[][]).push([...arguments_]);
      const mount = arguments_[arguments_.indexOf("--mount") + 1]!;
      const current = mount.split(",source=")[1]!.split(",target=")[0]!;
      workspace ||= current;
      expect(current).toBe(workspace);
      await expect(access(join(current, "src", "main.ts"))).resolves.toBeUndefined();
      if (invocations.length === 2) {
        await mkdir(join(current, "dist"));
        await writeFile(join(current, "dist", "app.js"), "built");
      }
      return { exitCode: 0, output: "ok", outputTruncated: false };
    });
    await expect(pipeline.execute({ artifact: artifact(), packageManager: "npm", script: "build" }))
      .resolves.toMatchObject({ status: "succeeded", restoration: { status: "succeeded" }, build: { status: "succeeded" }, outputFiles: [{ path: "dist/app.js" }] });
    expect(invocations).toHaveLength(2);
    expect(invocations[0]).toEqual(expect.arrayContaining(["--network", "vcp-dependency-egress", "npm", "ci", "--ignore-scripts"]));
    expect(invocations[1]).toEqual(expect.arrayContaining(["--network", "none", "npm", "run", "build"]));
    await expect(access(workspace)).rejects.toBeDefined();
  });

  it("does not build when restoration fails", async () => {
    let calls = 0;
    const pipeline = new DockerBuildPipeline(config, async () => {
      calls += 1;
      return { exitCode: 1, output: "restore failed", outputTruncated: false };
    });
    const result = await pipeline.execute({ artifact: artifact(), packageManager: "npm", script: "test" });
    expect(result.status).toBe("restore-failed");
    expect(result.build).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("rejects source mutation between restoration and build", async () => {
    let calls = 0;
    const pipeline = new DockerBuildPipeline(config, async (arguments_) => {
      calls += 1;
      const mount = arguments_[arguments_.indexOf("--mount") + 1]!;
      const workspace = mount.split(",source=")[1]!.split(",target=")[0]!;
      await writeFile(join(workspace, "src", "main.ts"), "tampered");
      return { exitCode: 0, output: "", outputTruncated: false };
    });
    await expect(pipeline.execute({ artifact: artifact(), packageManager: "npm", script: "build" }))
      .rejects.toThrow("modified immutable source");
    expect(calls).toBe(1);
  });

  it("builds a bounded application subdirectory and publishes paths relative to it", async () => {
    const nestedArtifact = createSourceArtifact("f".repeat(40), [
      { path: "fixtures/app/package.json", content: "{}" },
      { path: "fixtures/app/package-lock.json", content: "{}" },
      { path: "fixtures/app/build.js", content: "export {};" },
    ]);
    let calls = 0;
    const pipeline = new DockerBuildPipeline({ ...config, workingDirectory: "fixtures/app" }, async (arguments_) => {
      calls += 1;
      expect(arguments_).toEqual(expect.arrayContaining(["--workdir", "/workspace/fixtures/app"]));
      if (calls === 2) {
        const mount = arguments_[arguments_.indexOf("--mount") + 1]!;
        const workspace = mount.split(",source=")[1]!.split(",target=")[0]!;
        await mkdir(join(workspace, "fixtures", "app", "dist"), { recursive: true });
        await writeFile(join(workspace, "fixtures", "app", "dist", "server.js"), "built");
      }
      return { exitCode: 0, output: "ok", outputTruncated: false };
    });

    await expect(pipeline.execute({ artifact: nestedArtifact, packageManager: "npm", script: "build" }))
      .resolves.toMatchObject({ status: "succeeded", outputFiles: [{ path: "dist/server.js" }] });
  });

  it("rejects an unsafe application working directory", async () => {
    const pipeline = new DockerBuildPipeline({ ...config, workingDirectory: "../customer" });
    await expect(pipeline.execute({ artifact: artifact(), packageManager: "npm", script: "build" }))
      .rejects.toThrow("unsafe path");
  });
});
