import type { AssessmentEngine, SourceRepository } from "./assessment-service.js";

export class ManifestAssessmentEngine implements AssessmentEngine {
  constructor(private readonly sources: SourceRepository) {}

  async assess(repositoryUrl: string, revision: string) {
    const snapshot = await this.sources.checkout(repositoryUrl, revision);
    if (snapshot.revision !== revision) throw new Error("Source revision did not match the requested commit");

    const normalizedPath = (value: string) => value.replaceAll("\\", "/");
    const paths = new Set(snapshot.files.map((file) => normalizedPath(file.path)));
    const manifests = ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "Dockerfile"]
      .filter((path) => paths.has(path));
    const detectedStack = new Set<string>();
    const findings: string[] = [];
    const packageFile = snapshot.files.find((file) => normalizedPath(file.path) === "package.json");
    if (packageFile) {
      detectedStack.add("nodejs");
      let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
      try {
        packageJson = JSON.parse(packageFile.content) as typeof packageJson;
      } catch {
        throw new Error("package.json is not valid JSON");
      }
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if (dependencies.next) detectedStack.add("nextjs");
      if (dependencies.react) detectedStack.add("react");
      if (dependencies["@nestjs/core"]) detectedStack.add("nestjs");
      if (!packageJson.scripts?.build) findings.push("package.json does not define a build script");
      if (!packageJson.scripts?.test) findings.push("package.json does not define a test script");
    } else {
      findings.push("No supported application manifest was detected");
    }
    if (!["pnpm-lock.yaml", "package-lock.json", "yarn.lock"].some((path) => paths.has(path))) {
      findings.push("No JavaScript dependency lockfile was detected");
    }
    if (!paths.has("Dockerfile")) findings.push("No Dockerfile was detected");

    return {
      profile: detectedStack.has("nextjs") ? "nextjs-web-application" : detectedStack.has("nodejs") ? "nodejs-application" : "unknown-application",
      findings,
      manifests,
      detectedStack: [...detectedStack].sort(),
    };
  }
}

export class UnavailableSourceRepository implements SourceRepository {
  async checkout(): Promise<never> {
    throw new Error("Source repository provider is not configured");
  }
}
