import type { BuildJobEngine } from "./build-job-service.js";
import type { BuildPipeline } from "./build-pipeline.js";
import type { SourceArtifactRepository } from "./build-service.js";
import type { BuildRecord } from "./domain.js";

export class SourceBuildJobEngine implements BuildJobEngine {
  constructor(private readonly sources: SourceArtifactRepository, private readonly pipeline: BuildPipeline) {}

  async execute(build: BuildRecord): Promise<NonNullable<BuildRecord["result"]>> {
    const artifact = await this.sources.acquire(build.repositoryUrl, build.sourceRevision);
    const result = await this.pipeline.execute({ artifact, packageManager: build.packageManager, script: build.script });
    if (result.status !== "succeeded") throw new Error(`Build pipeline ${result.status}`);
    return { artifactDigest: artifact.digest, restorationStatus: "succeeded", buildStatus: "succeeded" };
  }
}

export class UnavailableBuildJobEngine implements BuildJobEngine {
  async execute(): Promise<never> { throw new Error("Build pipeline is not configured"); }
}
