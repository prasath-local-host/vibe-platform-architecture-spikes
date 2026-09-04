import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import { sourceArtifactDigest, verifySourceArtifact } from "./build-service.js";
import type { BuildPipeline, BuildPipelineRequest, BuildPipelineResult } from "./build-pipeline.js";

const executeFile = promisify(execFile);

type StageRunner = (
  arguments_: readonly string[],
  options: { readonly timeoutMs: number; readonly maximumOutputBytes: number },
) => Promise<{ readonly exitCode: number; readonly output: string; readonly outputTruncated: boolean }>;

export interface DockerBuildPipelineConfig {
  readonly image: string;
  readonly egressNetwork: string;
  readonly registryUrl: string;
  readonly allowedRegistryOrigins: readonly string[];
  readonly restoreTimeoutMs?: number;
  readonly buildTimeoutMs?: number;
  readonly maximumSourceBytes?: number;
  readonly maximumOutputBytes?: number;
}

function safePath(value: string): string {
  const normalized = normalize(value.replaceAll("\\", "/"));
  if (!value || isAbsolute(value) || normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Build pipeline source contains an unsafe path");
  }
  return normalized;
}

function lockfile(packageManager: BuildPipelineRequest["packageManager"]): string {
  return packageManager === "npm" ? "package-lock.json" : packageManager === "pnpm" ? "pnpm-lock.yaml" : "yarn.lock";
}

function restoreCommand(packageManager: BuildPipelineRequest["packageManager"]): readonly string[] {
  if (packageManager === "npm") return ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  if (packageManager === "pnpm") return ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"];
  return ["yarn", "install", "--immutable", "--mode=skip-build"];
}

async function runDocker(arguments_: readonly string[], options: { timeoutMs: number; maximumOutputBytes: number }) {
  try {
    const { stdout, stderr } = await executeFile("docker", [...arguments_], {
      timeout: options.timeoutMs,
      maxBuffer: options.maximumOutputBytes,
      windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    return { exitCode: 0, output: `${stdout}${stderr}`, outputTruncated: false };
  } catch (caught) {
    const error = caught as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
    if (error.killed) throw new Error("Build pipeline stage timed out");
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      output: output.slice(0, options.maximumOutputBytes),
      outputTruncated: output.length >= options.maximumOutputBytes || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    };
  }
}

export class DockerBuildPipeline implements BuildPipeline {
  private readonly registry: URL;

  constructor(private readonly config: DockerBuildPipelineConfig, private readonly runner: StageRunner = runDocker) {
    if (!/@sha256:[0-9a-f]{64}$/i.test(config.image)) throw new Error("A digest-pinned pipeline image is required");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.egressNetwork)) throw new Error("Dependency egress network is invalid");
    this.registry = new URL(config.registryUrl);
    if (this.registry.protocol !== "https:" || this.registry.username || this.registry.password) {
      throw new Error("Dependency registry must use credential-free HTTPS");
    }
    const allowed = new Set(config.allowedRegistryOrigins.map((origin) => new URL(origin).origin));
    if (!allowed.has(this.registry.origin)) throw new Error("Dependency registry origin is not allowed");
  }

  async execute(request: BuildPipelineRequest): Promise<BuildPipelineResult> {
    verifySourceArtifact(request.artifact);
    if (!request.artifact.files.some((file) => file.path === lockfile(request.packageManager))) {
      throw new Error(`Build pipeline requires ${lockfile(request.packageManager)}`);
    }
    const workspace = await mkdtemp(join(tmpdir(), "vcp-pipeline-"));
    const maximumOutputBytes = this.config.maximumOutputBytes ?? 256 * 1024;
    try {
      let sourceBytes = 0;
      for (const file of request.artifact.files) {
        const path = safePath(file.path);
        sourceBytes += typeof file.content === "string" ? Buffer.byteLength(file.content) : file.content.byteLength;
        if (sourceBytes > (this.config.maximumSourceBytes ?? 50 * 1024 * 1024)) throw new Error("Build pipeline source exceeds the configured byte limit");
        const destination = join(workspace, path);
        if (relative(workspace, destination).startsWith("..")) throw new Error("Build pipeline source escaped its workspace");
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, { flag: "wx" });
      }

      const mount = `type=bind,source=${workspace},target=/workspace`;
      const common = [
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--pids-limit", "256", "--memory", "1g", "--cpus", "2", "--user", "65532:65532",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", "--mount", mount, "--workdir", "/workspace",
      ];
      const restoreStarted = performance.now();
      const restored = await this.runner([
        "run", "--rm", "--network", this.config.egressNetwork, ...common,
        "--env", `NPM_CONFIG_REGISTRY=${this.registry.toString()}`,
        this.config.image, ...restoreCommand(request.packageManager),
      ], { timeoutMs: this.config.restoreTimeoutMs ?? 300_000, maximumOutputBytes });
      const restoration = {
        status: restored.exitCode === 0 ? "succeeded" as const : "failed" as const,
        exitCode: restored.exitCode,
        durationMs: Math.round(performance.now() - restoreStarted),
        output: restored.output,
        outputTruncated: restored.outputTruncated,
      };
      if (restoration.status === "failed") return { status: "restore-failed", restoration };

      const originalFiles = await Promise.all(request.artifact.files.map(async (file) => ({
        path: file.path,
        content: await readFile(join(workspace, safePath(file.path))),
      })));
      if (sourceArtifactDigest(request.artifact.revision, originalFiles) !== request.artifact.digest) {
        throw new Error("Dependency restoration modified immutable source files");
      }

      const buildStarted = performance.now();
      const command = request.packageManager === "npm"
        ? ["npm", "run", request.script, "--if-present"]
        : [request.packageManager, "run", request.script, "--if-present"];
      const built = await this.runner([
        "run", "--rm", "--network", "none", ...common, this.config.image, ...command,
      ], { timeoutMs: this.config.buildTimeoutMs ?? 120_000, maximumOutputBytes });
      const build = {
        status: built.exitCode === 0 ? "succeeded" as const : "failed" as const,
        exitCode: built.exitCode,
        durationMs: Math.round(performance.now() - buildStarted),
        output: built.output,
        outputTruncated: built.outputTruncated,
      };
      return { status: build.status === "succeeded" ? "succeeded" : "build-failed", restoration, build };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
