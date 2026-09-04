import { ApplicationService } from "./application-service.js";
import { AssessmentService, AssessmentWorker } from "./assessment-service.js";
import { createDatabase } from "./database.js";
import {
  InMemoryApplicationRepository,
  InMemoryAuditRepository,
} from "./in-memory-repositories.js";
import { migrateToLatest } from "./migrations.js";
import {
  IdentityService,
  InMemoryAuthorizationRepository,
  parseSpikeGrants,
  parseStepUpAuthenticationContexts,
  parseStepUpAuthenticationMethods,
  SpikeAccessTokenVerifier,
} from "./identity.js";
import { PostgresAuthorizationRepository } from "./postgres-authorization-repository.js";
import { InMemoryAssessmentRepository } from "./in-memory-assessment-repository.js";
import { PostgresAssessmentRepository } from "./postgres-assessment-repository.js";
import {
  PostgresApplicationRepository,
  PostgresAuditRepository,
} from "./postgres-repositories.js";
import { StructuredLogger } from "./observability.js";
import { OidcAccessTokenVerifier } from "./oidc-access-token-verifier.js";
import { ManifestAssessmentEngine, UnavailableSourceRepository } from "./manifest-assessment-engine.js";
import { GitHubSourceRepository } from "./git-source-repository.js";
import { BuildJobService, BuildJobWorker } from "./build-job-service.js";
import { InMemoryBuildRecordRepository } from "./in-memory-build-record-repository.js";
import { PostgresBuildRecordRepository } from "./postgres-build-record-repository.js";
import { GitHubSourceArtifactRepository } from "./git-source-artifact-repository.js";
import { DockerBuildPipeline } from "./docker-build-pipeline.js";
import { SourceBuildJobEngine, UnavailableBuildJobEngine } from "./build-job-engine.js";
import { FilesystemArtifactStore } from "./filesystem-artifact-store.js";

export interface ApplicationRuntime {
  readonly applications: ApplicationService;
  readonly assessments: AssessmentService;
  readonly assessmentWorker: AssessmentWorker;
  readonly builds: BuildJobService;
  readonly buildWorker: BuildJobWorker;
  readonly identity: IdentityService;
}

export async function createApplicationRuntime(
  connectionString: string | undefined,
): Promise<ApplicationRuntime> {
  const logger = new StructuredLogger();
  const stepUpContexts = parseStepUpAuthenticationContexts(
    process.env.STEP_UP_AUTHENTICATION_CONTEXTS ??
      process.env.PRIVILEGED_AUTHENTICATION_CONTEXTS,
  );
  const stepUpMethods = parseStepUpAuthenticationMethods(
    process.env.STEP_UP_AUTHENTICATION_METHODS,
  );
  const verifier = process.env.OIDC_ISSUER_URL && process.env.OIDC_AUDIENCE
    ? await OidcAccessTokenVerifier.create({
        issuer: process.env.OIDC_ISSUER_URL,
        audience: process.env.OIDC_AUDIENCE,
        allowHttp: process.env.OIDC_ALLOW_HTTP === "true",
      })
    : new SpikeAccessTokenVerifier(process.env.SPIKE_IDENTITY_ENABLED === "true");
  const sourceRepository = process.env.GITHUB_SOURCE_ENABLED === "true"
    ? new GitHubSourceRepository({
        ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
        timeoutMs: Number(process.env.GITHUB_CHECKOUT_TIMEOUT_MS ?? 60_000),
        maximumManifestBytes: Number(process.env.GITHUB_MANIFEST_BYTE_LIMIT ?? 1024 * 1024),
      })
    : new UnavailableSourceRepository();
  const buildConfigurationComplete = Boolean(
    process.env.GITHUB_SOURCE_ENABLED === "true" &&
    process.env.BUILD_PIPELINE_IMAGE &&
    process.env.BUILD_EGRESS_NETWORK &&
    process.env.BUILD_ARTIFACT_ROOT,
  );
  if (process.env.BUILD_WORKER_ENABLED === "true" && !buildConfigurationComplete) {
    throw new Error("Build worker requires GitHub source, a digest-pinned pipeline image, an egress network, and artifact storage");
  }
  const buildEngine = buildConfigurationComplete
    ? new SourceBuildJobEngine(
        new GitHubSourceArtifactRepository({
          ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
          timeoutMs: Number(process.env.GITHUB_CHECKOUT_TIMEOUT_MS ?? 120_000),
          maximumTotalBytes: Number(process.env.GITHUB_SOURCE_BYTE_LIMIT ?? 50 * 1024 * 1024),
          maximumFiles: Number(process.env.GITHUB_SOURCE_FILE_LIMIT ?? 5_000),
        }),
        new DockerBuildPipeline({
          image: process.env.BUILD_PIPELINE_IMAGE!,
          egressNetwork: process.env.BUILD_EGRESS_NETWORK!,
          registryUrl: process.env.BUILD_REGISTRY_URL ?? "https://registry.npmjs.org/",
          allowedRegistryOrigins: (process.env.BUILD_ALLOWED_REGISTRY_ORIGINS ?? "https://registry.npmjs.org").split(",").map((value) => value.trim()),
          outputDirectories: (process.env.BUILD_OUTPUT_DIRECTORIES ?? "dist").split(",").map((value) => value.trim()),
        }),
        new FilesystemArtifactStore(process.env.BUILD_ARTIFACT_ROOT!),
        Number(process.env.BUILD_ARTIFACT_RETENTION_DAYS ?? 30),
      )
    : new UnavailableBuildJobEngine();
  if (!connectionString) {
    const audit = new InMemoryAuditRepository();
    const assessments = new InMemoryAssessmentRepository(audit);
    const applications = new InMemoryApplicationRepository(audit);
    const builds = new InMemoryBuildRecordRepository(audit);
    const engine = new ManifestAssessmentEngine(sourceRepository);
    return {
      applications: new ApplicationService(
        applications,
        audit,
        logger,
      ),
      assessments: new AssessmentService(assessments, applications, logger),
      assessmentWorker: new AssessmentWorker(
        process.env.ASSESSMENT_WORKER_ID ?? `local-${process.pid}`,
        assessments,
        engine,
        logger,
      ),
      builds: new BuildJobService(builds, applications, logger),
      buildWorker: new BuildJobWorker(process.env.BUILD_WORKER_ID ?? `local-build-${process.pid}`, builds, buildEngine, logger),
      identity: new IdentityService(
        verifier,
        new InMemoryAuthorizationRepository(
          parseSpikeGrants(process.env.SPIKE_IDENTITY_GRANTS),
        ),
        stepUpContexts,
        stepUpMethods,
      ),
    };
  }

  const db = createDatabase(connectionString, logger);
  await migrateToLatest(db);
  const assessments = new PostgresAssessmentRepository(db);
  const applications = new PostgresApplicationRepository(db);
  const builds = new PostgresBuildRecordRepository(db);
  const engine = new ManifestAssessmentEngine(sourceRepository);
  return {
    applications: new ApplicationService(
      applications,
      new PostgresAuditRepository(db),
      logger,
    ),
    assessments: new AssessmentService(assessments, applications, logger),
    assessmentWorker: new AssessmentWorker(
      process.env.ASSESSMENT_WORKER_ID ?? `worker-${process.pid}`,
      assessments,
      engine,
      logger,
    ),
    builds: new BuildJobService(builds, applications, logger),
    buildWorker: new BuildJobWorker(process.env.BUILD_WORKER_ID ?? `build-worker-${process.pid}`, builds, buildEngine, logger),
    identity: new IdentityService(
      verifier,
      new PostgresAuthorizationRepository(db),
      stepUpContexts,
      stepUpMethods,
    ),
  };
}
