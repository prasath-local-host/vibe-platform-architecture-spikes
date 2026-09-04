import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SourceFile, SourceRepository } from "./assessment-service.js";

const executeFile = promisify(execFile);
const supportedManifests = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Dockerfile",
] as const;

export interface GitHubSourceRepositoryConfig {
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly maximumManifestBytes?: number;
}

export function validateGitHubRepositoryUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Repository URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)
  ) {
    throw new Error("Only credential-free HTTPS GitHub repository URLs are supported");
  }
  return url;
}

export class GitHubSourceRepository implements SourceRepository {
  constructor(private readonly config: GitHubSourceRepositoryConfig = {}) {}

  async checkout(repositoryUrl: string, revision: string) {
    const url = validateGitHubRepositoryUrl(repositoryUrl);
    if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("Source revision must be a full Git commit SHA");

    const directory = await mkdtemp(join(tmpdir(), "vcp-source-"));
    try {
      await this.git(["init", "--quiet"], directory);
      await this.git(["remote", "add", "origin", url.toString()], directory);
      await this.git(["sparse-checkout", "init", "--no-cone"], directory);
      await this.git(["sparse-checkout", "set", ...supportedManifests], directory);
      await this.git(["-c", "protocol.version=2", "fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", revision], directory);
      await this.git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], directory);
      const actualRevision = (await this.git(["rev-parse", "HEAD"], directory)).trim().toLowerCase();
      if (actualRevision !== revision.toLowerCase()) throw new Error("Git checkout returned an unexpected revision");

      const files: SourceFile[] = [];
      let totalBytes = 0;
      const maximumBytes = this.config.maximumManifestBytes ?? 1024 * 1024;
      for (const path of supportedManifests) {
        const absolutePath = join(directory, path);
        try {
          const metadata = await stat(absolutePath);
          if (!metadata.isFile()) continue;
          totalBytes += metadata.size;
          if (metadata.size > maximumBytes || totalBytes > maximumBytes) {
            throw new Error("Repository manifests exceed the configured byte limit");
          }
          files.push({ path, content: await readFile(absolutePath, "utf8") });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
      }
      return { revision: actualRevision, files };
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
      ...(this.config.token
        ? {
            GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_1: `Authorization: Bearer ${this.config.token}`,
          }
        : {}),
    };
    try {
      const { stdout } = await executeFile("git", [...arguments_], {
        cwd,
        env: environment,
        timeout: this.config.timeoutMs ?? 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    } catch {
      throw new Error("GitHub source checkout failed");
    }
  }
}
