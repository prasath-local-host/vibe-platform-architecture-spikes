import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import { verifySourceArtifact } from "./build-service.js";
import type { DependencyRestorer, DependencyRestoreRequest, DependencyRestoreResult } from "./dependency-restoration.js";

const executeFile = promisify(execFile);

type ContainerRunner = (
  arguments_: readonly string[],
  options: { readonly timeoutMs: number; readonly maximumOutputBytes: number },
) => Promise<{ readonly exitCode: number; readonly output: string; readonly outputTruncated: boolean }>;

export interface DockerDependencyRestorerConfig {
  readonly image: string;
  readonly egressNetwork: string;
  readonly registryUrl: string;
  readonly allowedRegistryOrigins: readonly string[];
  readonly timeoutMs?: number;
  readonly maximumSourceBytes?: number;
  readonly maximumOutputBytes?: number;
}

function safePath(value: string): string {
  const normalized = normalize(value.replaceAll("\\", "/"));
  if (!value || isAbsolute(value) || normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Dependency source contains an unsafe path");
  }
  return normalized;
}

function installCommand(packageManager: DependencyRestoreRequest["packageManager"]): readonly string[] {
  if (packageManager === "npm") return ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  if (packageManager === "pnpm") return ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"];
  return ["yarn", "install", "--immutable", "--mode=skip-build"];
}

function requiredLockfile(packageManager: DependencyRestoreRequest["packageManager"]): string {
  if (packageManager === "npm") return "package-lock.json";
  if (packageManager === "pnpm") return "pnpm-lock.yaml";
  return "yarn.lock";
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
    if (error.killed) throw new Error("Dependency restoration timed out");
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      output: output.slice(0, options.maximumOutputBytes),
      outputTruncated: output.length >= options.maximumOutputBytes || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    };
  }
}

export class DockerDependencyRestorer implements DependencyRestorer {
  private readonly registry: URL;

  constructor(
    private readonly config: DockerDependencyRestorerConfig,
    private readonly runner: ContainerRunner = runDocker,
  ) {
    if (!/@sha256:[0-9a-f]{64}$/i.test(config.image)) throw new Error("A digest-pinned restore image is required");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.egressNetwork)) throw new Error("Dependency egress network is invalid");
    this.registry = new URL(config.registryUrl);
    if (this.registry.protocol !== "https:" || this.registry.username || this.registry.password) {
      throw new Error("Dependency registry must use credential-free HTTPS");
    }
    const allowed = new Set(config.allowedRegistryOrigins.map((origin) => new URL(origin).origin));
    if (!allowed.has(this.registry.origin)) throw new Error("Dependency registry origin is not allowed");
  }

  async restore(request: DependencyRestoreRequest): Promise<DependencyRestoreResult> {
    verifySourceArtifact(request.artifact);
    if (!request.artifact.files.some((file) => file.path === requiredLockfile(request.packageManager))) {
      throw new Error(`Dependency restoration requires ${requiredLockfile(request.packageManager)}`);
    }
    const workspace = await mkdtemp(join(tmpdir(), "vcp-restore-"));
    const started = performance.now();
    try {
      let bytes = 0;
      for (const file of request.artifact.files) {
        const path = safePath(file.path);
        bytes += typeof file.content === "string" ? Buffer.byteLength(file.content) : file.content.byteLength;
        if (bytes > (this.config.maximumSourceBytes ?? 10 * 1024 * 1024)) throw new Error("Dependency source exceeds the configured byte limit");
        const destination = join(workspace, path);
        if (relative(workspace, destination).startsWith("..")) throw new Error("Dependency source escaped its workspace");
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, { flag: "wx" });
      }
      const maximumOutputBytes = this.config.maximumOutputBytes ?? 256 * 1024;
      const execution = await this.runner([
        "run", "--rm", "--network", this.config.egressNetwork,
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--pids-limit", "256", "--memory", "1g", "--cpus", "2", "--user", "65532:65532",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
        "--mount", `type=bind,source=${workspace},target=/workspace`, "--workdir", "/workspace",
        "--env", `NPM_CONFIG_REGISTRY=${this.registry.toString()}`,
        this.config.image, ...installCommand(request.packageManager),
      ], { timeoutMs: this.config.timeoutMs ?? 300_000, maximumOutputBytes });
      return {
        status: execution.exitCode === 0 ? "succeeded" : "failed",
        exitCode: execution.exitCode,
        durationMs: Math.round(performance.now() - started),
        output: execution.output,
        outputTruncated: execution.outputTruncated,
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
