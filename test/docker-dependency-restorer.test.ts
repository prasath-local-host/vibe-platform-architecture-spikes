import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSourceArtifact } from "../src/build-service.js";
import { DockerDependencyRestorer } from "../src/docker-dependency-restorer.js";

describe("Docker dependency restorer", () => {
  const image = `node:24-alpine@sha256:${"a".repeat(64)}`;
  const config = {
    image,
    egressNetwork: "vcp-dependency-egress",
    registryUrl: "https://registry.npmjs.org/",
    allowedRegistryOrigins: ["https://registry.npmjs.org"],
  } as const;
  const artifact = (files: readonly { path: string; content: string }[]) =>
    createSourceArtifact("b".repeat(40), files);

  it("uses frozen npm restoration without lifecycle scripts on controlled egress", async () => {
    let workspace = "";
    const restorer = new DockerDependencyRestorer(config, async (arguments_) => {
      expect(arguments_).toEqual(expect.arrayContaining([
        "--network", "vcp-dependency-egress", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund",
      ]));
      expect(arguments_.join(" ")).not.toContain("token");
      const mount = arguments_[arguments_.indexOf("--mount") + 1]!;
      workspace = mount.split(",source=")[1]!.split(",target=")[0]!;
      await expect(access(join(workspace, "package-lock.json"))).resolves.toBeUndefined();
      return { exitCode: 0, output: "restored", outputTruncated: false };
    });
    await expect(restorer.restore({
      packageManager: "npm",
      artifact: artifact([{ path: "package.json", content: "{}" }, { path: "package-lock.json", content: "{}" }]),
    })).resolves.toMatchObject({ status: "succeeded", output: "restored" });
    await expect(access(workspace)).rejects.toBeDefined();
  });

  it.each([
    ["npm", "package-lock.json", ["npm", "ci"]],
    ["pnpm", "pnpm-lock.yaml", ["pnpm", "install", "--frozen-lockfile"]],
    ["yarn", "yarn.lock", ["yarn", "install", "--immutable"]],
  ] as const)("uses the locked %s command", async (packageManager, lockfile, command) => {
    const restorer = new DockerDependencyRestorer(config, async (arguments_) => {
      expect(arguments_).toEqual(expect.arrayContaining([...command]));
      return { exitCode: 0, output: "", outputTruncated: false };
    });
    await restorer.restore({ packageManager, artifact: artifact([{ path: lockfile, content: "lock" }]) });
  });

  it("rejects a missing lockfile before container execution", async () => {
    let launched = false;
    const restorer = new DockerDependencyRestorer(config, async () => {
      launched = true;
      return { exitCode: 0, output: "", outputTruncated: false };
    });
    await expect(restorer.restore({ packageManager: "npm", artifact: artifact([{ path: "package.json", content: "{}" }]) }))
      .rejects.toThrow("package-lock.json");
    expect(launched).toBe(false);
  });

  it("rejects mutable images, unsafe networks, credentials, and unapproved registries", () => {
    expect(() => new DockerDependencyRestorer({ ...config, image: "node:24-alpine" })).toThrow("digest-pinned");
    expect(() => new DockerDependencyRestorer({ ...config, egressNetwork: "host;bad" })).toThrow("network");
    expect(() => new DockerDependencyRestorer({ ...config, registryUrl: "https://token@registry.npmjs.org" })).toThrow("credential-free");
    expect(() => new DockerDependencyRestorer({ ...config, registryUrl: "https://packages.example.com" })).toThrow("not allowed");
  });
});
