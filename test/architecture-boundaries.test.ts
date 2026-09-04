import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  analyzeArchitecture,
  renderArchitectureReport,
} from "../src/architecture-boundaries.js";

describe("architecture module boundaries", () => {
  it("has no outward dependencies or local import cycles", async () => {
    const analysis = await analyzeArchitecture();
    expect(analysis.violations).toEqual([]);
    expect(analysis.cycles).toEqual([]);
  });

  it("keeps domain and application independent of frameworks and databases", async () => {
    const analysis = await analyzeArchitecture();
    const innerModules = analysis.modules.filter(
      (module) => module.layer === "domain" || module.layer === "application",
    );
    expect(innerModules).toHaveLength(9);
    expect(
      innerModules.flatMap((module) => module.externalDependencies),
    ).toEqual(["node:crypto", "node:crypto", "node:crypto", "node:crypto", "node:async_hooks"]);
  });

  it("keeps the committed dependency report synchronized", async () => {
    const analysis = await analyzeArchitecture();
    const committed = await readFile(
      new URL("../docs/vibe-2-architecture-dependency-report.md", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(renderArchitectureReport(analysis));
  });
});
