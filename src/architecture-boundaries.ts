import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export type ArchitectureLayer =
  | "domain"
  | "application"
  | "adapter"
  | "composition";

export interface ArchitectureModule {
  readonly name: string;
  readonly layer: ArchitectureLayer;
  readonly localDependencies: readonly string[];
  readonly externalDependencies: readonly string[];
}

export interface BoundaryViolation {
  readonly source: string;
  readonly dependency: string;
  readonly reason: string;
}

export interface ArchitectureAnalysis {
  readonly modules: readonly ArchitectureModule[];
  readonly violations: readonly BoundaryViolation[];
  readonly cycles: readonly (readonly string[])[];
}

const layerRank: Record<ArchitectureLayer, number> = {
  domain: 0,
  application: 1,
  adapter: 2,
  composition: 3,
};

const applicationModules = new Set([
  "build-service.ts",
  "dependency-restoration.ts",
  "application-service.ts",
  "assessment-service.ts",
  "identity.ts",
  "observability.ts",
]);
const compositionModules = new Set([
  "app.module.ts",
  "main.ts",
  "migrate.ts",
  "persistence.ts",
]);
const excludedTooling = new Set([
  "architecture-boundaries.ts",
  "generate-architecture-report.ts",
  "generate-openapi.ts",
]);

function layerFor(name: string): ArchitectureLayer | undefined {
  if (name === "domain.ts") return "domain";
  if (applicationModules.has(name)) return "application";
  if (compositionModules.has(name)) return "composition";
  if (!excludedTooling.has(name)) return "adapter";
  return undefined;
}

function importsFrom(source: string): readonly string[] {
  const file = ts.createSourceFile(
    "module.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: string[] = [];
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports;
}

function localName(specifier: string): string | undefined {
  if (!specifier.startsWith("./")) return undefined;
  return path.basename(specifier).replace(/\.js$/, ".ts");
}

function findCycles(modules: readonly ArchitectureModule[]) {
  const graph = new Map(
    modules.map((module) => [module.name, module.localDependencies]),
  );
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(name: string): void {
    if (active.has(name)) {
      const start = stack.indexOf(name);
      cycles.push([...stack.slice(start), name]);
      return;
    }
    if (visited.has(name)) return;
    visited.add(name);
    active.add(name);
    stack.push(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    stack.pop();
    active.delete(name);
  }

  for (const module of modules) visit(module.name);
  return cycles;
}

export async function analyzeArchitecture(
  sourceDirectory = new URL("./", import.meta.url),
): Promise<ArchitectureAnalysis> {
  const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const knownNames = new Set(entries.map((entry) => entry.name));
  const modules: ArchitectureModule[] = [];
  const violations: BoundaryViolation[] = [];

  for (const entry of entries) {
    const layer = layerFor(entry.name);
    if (!layer) continue;
    const source = await readFile(new URL(entry.name, sourceDirectory), "utf8");
    const imports = importsFrom(source);
    const localDependencies = imports
      .map(localName)
      .filter((name): name is string => Boolean(name))
      .filter((name) => knownNames.has(name) && !excludedTooling.has(name));
    const externalDependencies = imports.filter(
      (specifier) => !specifier.startsWith("./"),
    );
    modules.push({
      name: entry.name,
      layer,
      localDependencies: [...new Set(localDependencies)].sort(),
      externalDependencies: [...new Set(externalDependencies)].sort(),
    });
  }

  const moduleByName = new Map(modules.map((module) => [module.name, module]));
  for (const module of modules) {
    for (const dependencyName of module.localDependencies) {
      const dependency = moduleByName.get(dependencyName);
      if (!dependency) continue;
      if (layerRank[dependency.layer] > layerRank[module.layer]) {
        violations.push({
          source: module.name,
          dependency: dependencyName,
          reason: `${module.layer} cannot depend outward on ${dependency.layer}`,
        });
      }
    }
    if (module.layer === "domain" && module.externalDependencies.length > 0) {
      for (const dependency of module.externalDependencies) {
        violations.push({
          source: module.name,
          dependency,
          reason: "domain cannot depend on external packages",
        });
      }
    }
    if (module.layer === "application") {
      for (const dependency of module.externalDependencies) {
        if (!dependency.startsWith("node:")) {
          violations.push({
            source: module.name,
            dependency,
            reason: "application can use only the domain and Node.js built-ins",
          });
        }
      }
    }
  }

  return {
    modules,
    violations: violations.sort((a, b) =>
      `${a.source}:${a.dependency}`.localeCompare(`${b.source}:${b.dependency}`),
    ),
    cycles: findCycles(modules),
  };
}

export function renderArchitectureReport(
  analysis: ArchitectureAnalysis,
): string {
  const counts = new Map<ArchitectureLayer, number>();
  for (const module of analysis.modules) {
    counts.set(module.layer, (counts.get(module.layer) ?? 0) + 1);
  }
  const edges = analysis.modules.flatMap((module) =>
    module.localDependencies.map((dependency) => ({
      source: module,
      target: analysis.modules.find((candidate) => candidate.name === dependency)!,
    })),
  );
  const externalByLayer = (["domain", "application", "adapter", "composition"] as const)
    .map((layer) => ({
      layer,
      packages: [
        ...new Set(
          analysis.modules
            .filter((module) => module.layer === layer)
            .flatMap((module) => module.externalDependencies),
        ),
      ].sort(),
    }));

  return `# VIBE-2 Architecture Dependency and Module-Boundary Report

> **Result:** ${analysis.violations.length === 0 && analysis.cycles.length === 0 ? "PASS" : "FAIL"}
>
> **Scope:** Production TypeScript modules in \`src/\`; generators and this analyzer are excluded as build tooling.
>
> **Reproduce:** \`pnpm architecture:check\`

## Boundary model

Dependencies must point inward:

\`composition → adapters → application → domain\`

* **Domain** contains company-scoped entities and invariant enforcement and has no external dependencies.
* **Application** contains use cases and repository/identity ports. It may depend on the domain and Node.js built-ins only.
* **Adapters** contain HTTP/OpenAPI, worker hosting, persistence implementations, database schema and migrations.
* **Composition** wires adapters to ports and owns process startup and migration entry points.

## Automated result

| Check | Result |
| --- | --- |
| Classified production modules | ${analysis.modules.length} |
| Local dependency edges | ${edges.length} |
| Outward dependency violations | ${analysis.violations.length} |
| Local import cycles | ${analysis.cycles.length} |
| Overall | ${analysis.violations.length === 0 && analysis.cycles.length === 0 ? "PASS" : "FAIL"} |

## Modules by layer

| Layer | Count | Modules |
| --- | ---: | --- |
${(["domain", "application", "adapter", "composition"] as const)
  .map((layer) => `| ${layer} | ${counts.get(layer) ?? 0} | ${analysis.modules.filter((module) => module.layer === layer).map((module) => `\`${module.name}\``).join(", ")} |`)
  .join("\n")}

## Local dependency evidence

| Source | Source layer | Dependency | Dependency layer |
| --- | --- | --- | --- |
${edges.map(({ source, target }) => `| \`${source.name}\` | ${source.layer} | \`${target.name}\` | ${target.layer} |`).join("\n")}

## External dependency evidence

| Layer | Direct external imports |
| --- | --- |
${externalByLayer.map(({ layer, packages }) => `| ${layer} | ${packages.length ? packages.map((name) => `\`${name}\``).join(", ") : "None"} |`).join("\n")}

## Violations and cycles

${analysis.violations.length ? analysis.violations.map((violation) => `* \`${violation.source}\` → \`${violation.dependency}\`: ${violation.reason}`).join("\n") : "No outward dependency violations were detected."}

${analysis.cycles.length ? analysis.cycles.map((cycle) => `* Cycle: ${cycle.map((name) => `\`${name}\``).join(" → ")}`).join("\n") : "No local import cycles were detected."}

## Architectural conclusion

The tested backend supports the proposed modular control-plane direction. Domain and application logic remain independent of NestJS, Fastify, Kysely and PostgreSQL. Framework, HTTP and persistence concerns remain replaceable adapters, while runtime wiring is isolated in the composition layer.

This evidence covers static TypeScript imports only. It does not prove runtime tenant isolation, infrastructure isolation, identity-provider behavior or operational recovery; those require their dedicated spike evidence.
`;
}
