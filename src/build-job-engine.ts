import type { BuildJobEngine } from "./build-job-service.js";
import type { BuildPipeline } from "./build-pipeline.js";
import type { SourceArtifactRepository } from "./build-service.js";
import type { BuildRecord } from "./domain.js";
import { createBuildArtifact, type ArtifactStore } from "./artifact-service.js";
import type { ArtifactSecurityScanner } from "./artifact-security.js";

export class SourceBuildJobEngine implements BuildJobEngine {
  constructor(
    private readonly sources: SourceArtifactRepository,
    private readonly pipeline: BuildPipeline,
    private readonly artifacts: ArtifactStore,
    private readonly retentionDays: number,
    private readonly scanner: ArtifactSecurityScanner,
  ) {}

  async execute(build: BuildRecord): Promise<NonNullable<BuildRecord["result"]>> {
    const artifact = await this.sources.acquire(build.repositoryUrl, build.sourceRevision);
    const result = await this.pipeline.execute({ artifact, packageManager: build.packageManager, script: build.script });
    if (result.status !== "succeeded") throw new Error(`Build pipeline ${result.status}`);
    if (!result.outputFiles?.length) throw new Error("Build pipeline produced no publishable output");
    const output = createBuildArtifact({
      companyId: build.companyId, applicationId: build.applicationId, buildId: build.id,
      sourceRevision: build.sourceRevision, files: result.outputFiles, retentionDays: this.retentionDays,
    });
    const security = await this.scanner.scan(output);
    if (security.status !== "approved") throw new Error(`Build artifact security rejected: ${security.findings.join("; ")}`);
    await this.artifacts.put(output);
    return {
      artifactId: output.id, artifactDigest: output.digest, restorationStatus: "succeeded", buildStatus: "succeeded",
      securityStatus: security.status, securityScanner: security.scanner, securityScannedAt: security.scannedAt,
    };
  }
}

export class UnavailableBuildJobEngine implements BuildJobEngine {
  async execute(): Promise<never> { throw new Error("Build pipeline is not configured"); }
}
