import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import type { BuildExecutionRequest, BuildExecutionResult, BuildExecutor } from "./build-service.js";

const executeFile = promisify(execFile);

type ContainerRunner = (
  arguments_: readonly string[],
  options: { readonly timeoutMs: number; readonly maximumOutputBytes: number },
) => Promise<{ readonly exitCode: number; readonly output: string; readonly outputTruncated: boolean }>;

export interface DockerBuildExecutorConfig {
  readonly image: string;
  readonly timeoutMs?: number;
  readonly maximumSourceBytes?: number;
  readonly maximumOutputBytes?: number;
  readonly memory?: string;
  readonly cpus?: string;
  readonly pidsLimit?: number;
}

function safeRelativePath(value: string): string {
  const normalized = normalize(value.replaceAll("\\", "/"));
  if (
    !value ||
    isAbsolute(value) ||
    normalized === ".." ||
    normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("Build source contains an unsafe path");
  }
  return normalized;
}

async function runDocker(
  arguments_: readonly string[],
  options: { readonly timeoutMs: number; readonly maximumOutputBytes: number },
) {
  const started = performance.now();
  try {
    const { stdout, stderr } = await executeFile("docker", [...arguments_], {
      timeout: options.timeoutMs,
      maxBuffer: options.maximumOutputBytes,
      windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    return { exitCode: 0, output: `${stdout}${stderr}`, outputTruncated: false, durationMs: performance.now() - started };
  } catch (caught) {
    const error = caught as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
    if (error.killed) throw new Error("Build execution timed out");
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      output: output.slice(0, options.maximumOutputBytes),
      outputTruncated: output.length >= options.maximumOutputBytes || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      durationMs: performance.now() - started,
    };
  }
}

export class DockerBuildExecutor implements BuildExecutor {
  constructor(
    private readonly config: DockerBuildExecutorConfig,
    private readonly runner: ContainerRunner = async (arguments_, options) => {
      const result = await runDocker(arguments_, options);
      return result;
    },
  ) {
    if (!/@sha256:[0-9a-f]{64}$/i.test(config.image)) {
      throw new Error("A digest-pinned build image is required");
    }
  }

  async execute(request: BuildExecutionRequest): Promise<BuildExecutionResult> {
    const workspace = await mkdtemp(join(tmpdir(), "vcp-build-"));
    const started = performance.now();
    try {
      let sourceBytes = 0;
      const maximumSourceBytes = this.config.maximumSourceBytes ?? 10 * 1024 * 1024;
      for (const file of request.files) {
        const safePath = safeRelativePath(file.path);
        sourceBytes += Buffer.byteLength(file.content);
        if (sourceBytes > maximumSourceBytes) throw new Error("Build source exceeds the configured byte limit");
        const destination = join(workspace, safePath);
        if (relative(workspace, destination).startsWith("..")) throw new Error("Build source escaped its workspace");
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, { encoding: "utf8", flag: "wx" });
      }

      const command = request.packageManager === "npm"
        ? ["npm", "run", request.script, "--if-present"]
        : [request.packageManager, "run", request.script, "--if-present"];
      const maximumOutputBytes = this.config.maximumOutputBytes ?? 256 * 1024;
      const execution = await this.runner([
        "run", "--rm",
        "--network", "none",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--pids-limit", String(this.config.pidsLimit ?? 128),
        "--memory", this.config.memory ?? "512m",
        "--cpus", this.config.cpus ?? "1",
        "--user", "65532:65532",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
        "--mount", `type=bind,source=${workspace},target=/workspace`,
        "--workdir", "/workspace",
        this.config.image,
        ...command,
      ], {
        timeoutMs: this.config.timeoutMs ?? 120_000,
        maximumOutputBytes,
      });
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
