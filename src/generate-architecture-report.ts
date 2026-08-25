import { readFile, writeFile } from "node:fs/promises";
import {
  analyzeArchitecture,
  renderArchitectureReport,
} from "./architecture-boundaries.js";

const reportUrl = new URL(
  "../docs/vibe-2-architecture-dependency-report.md",
  import.meta.url,
);
const report = renderArchitectureReport(await analyzeArchitecture());

if (process.argv.includes("--check")) {
  const committed = await readFile(reportUrl, "utf8");
  if (committed !== report) {
    throw new Error(
      "Architecture report is stale. Run pnpm architecture:generate.",
    );
  }
} else {
  await writeFile(reportUrl, report, "utf8");
}

const analysis = await analyzeArchitecture();
if (analysis.violations.length || analysis.cycles.length) {
  throw new Error(
    `Architecture boundary check failed with ${analysis.violations.length} violation(s) and ${analysis.cycles.length} cycle(s).`,
  );
}
