import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { createSourceArtifact, type BuildSourceFile, type SourceArtifactRepository } from "./build-service.js";
import { validateGitHubRepositoryUrl } from "./git-source-repository.js";

const executeFile = promisify(execFile);

export interface SourceArtifactLimits {
  readonly maximumFiles?: number;
  readonly maximumFileBytes?: number;
  readonly maximumTotalBytes?: number;
}

export interface GitHubSourceArtifactRepositoryConfig extends SourceArtifactLimits {
  readonly token?: string;
  readonly timeoutMs?: number;
}

export async function collectSourceArtifact(
  directory: string,
  revision: string,
  limits: SourceArtifactLimits = {},
) {
  const files: BuildSourceFile[] = [];
  let totalBytes = 0;
  const maximumFiles = limits.maximumFiles ?? 5_000;
  const maximumFileBytes = limits.maximumFileBytes ?? 5 * 1024 * 1024;
  const maximumTotalBytes = limits.maximumTotalBytes ?? 50 * 1024 * 1024;

  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (current === directory && entry.name === ".git") continue;
      const absolutePath = join(current, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw new Error("Source repository contains a symbolic link");
      if (metadata.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!metadata.isFile()) throw new Error("Source repository contains an unsupported filesystem entry");
      if (metadata.size > maximumFileBytes) throw new Error("Source repository file exceeds the configured byte limit");
      totalBytes += metadata.size;
      if (totalBytes > maximumTotalBytes) throw new Error("Source repository exceeds the configured total byte limit");
      if (files.length >= maximumFiles) throw new Error("Source repository exceeds the configured file-count limit");
      const path = relative(directory, absolutePath).split(sep).join("/");
      files.push({ path, content: await readFile(absolutePath) });
    }
  }

  await visit(directory);
  return createSourceArtifact(revision, files);
}

export class GitHubSourceArtifactRepository implements SourceArtifactRepository {
  constructor(private readonly config: GitHubSourceArtifactRepositoryConfig = {}) {}

  async acquire(repositoryUrl: string, revision: string) {
    const url = validateGitHubRepositoryUrl(repositoryUrl);
    if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("Source revision must be a full Git commit SHA");
    const directory = await mkdtemp(join(tmpdir(), "vcp-artifact-"));
    try {
      await this.git(["init", "--quiet"], directory);
      await this.git(["remote", "add", "origin", url.toString()], directory);
      await this.git(["-c", "protocol.version=2", "fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", revision], directory);
      await this.git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], directory);
      const actualRevision = (await this.git(["rev-parse", "HEAD"], directory)).trim().toLowerCase();
      if (actualRevision !== revision.toLowerCase()) throw new Error("Git checkout returned an unexpected revision");
      const submodules = (await this.git(["ls-files", "--stage"], directory))
        .split(/\r?\n/)
        .filter((line) => line.startsWith("160000 "));
      if (submodules.length) throw new Error("Source repository contains unsupported Git submodules");
      return await collectSourceArtifact(directory, actualRevision, this.config);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async git(arguments_: readonly string[], cwd: string): Promise<string> {
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: this.config.token ? "2" : "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      ...(this.config.token ? {
        GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_1: `Authorization: Bearer ${this.config.token}`,
      } : {}),
    };
    try {
      const { stdout } = await executeFile("git", [...arguments_], {
        cwd,
        env: environment,
        timeout: this.config.timeoutMs ?? 120_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    } catch {
      throw new Error("GitHub source artifact acquisition failed");
    }
  }
}
