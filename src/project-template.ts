import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectTemplate } from "./project-provisioning-service.js";

export class NextPostgresProjectTemplate implements ProjectTemplate {
  async files() {
    const files: Record<string, string> = {};
    for (const name of ["AGENTS.md", "CLAUDE.md", "vcp.project.json", "README.md", ".gitignore"]) {
      files[name] = (await readFile(resolve("templates/nextjs-postgresql", name), "utf8")).replace(/\r\n/g, "\n");
    }
    return files;
  }
}
