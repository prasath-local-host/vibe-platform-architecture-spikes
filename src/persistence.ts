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
import { ReleaseService, ReleaseWorker, UnavailableDeploymentEngine } from "./release-service.js";
import { InMemoryReleaseRepository } from "./in-memory-release-repository.js";
import { PostgresReleaseRepository } from "./postgres-release-repository.js";
import { DockerTestDeploymentEngine } from "./docker-test-deployment-engine.js";
import { FilesystemIngressRouter } from "./filesystem-ingress-router.js";
import { TraefikFileReconciler, UnavailableIngressReconciler, type IngressReconciler } from "./traefik-file-reconciler.js";
import { BaselineArtifactSecurityScanner } from "./artifact-security.js";

export interface ApplicationRuntime {
  readonly applications: ApplicationService;
  readonly assessments: AssessmentService;
  readonly assessmentWorker: AssessmentWorker;
  readonly builds: BuildJobService;
  readonly buildWorker: BuildJobWorker;
  readonly releases: ReleaseService;
  readonly releaseWorker: ReleaseWorker;
  readonly ingressReconciler: IngressReconciler;
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
  const artifactStore = process.env.BUILD_ARTIFACT_ROOT ? new FilesystemArtifactStore(process.env.BUILD_ARTIFACT_ROOT) : undefined;
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
        artifactStore!,
        Number(process.env.BUILD_ARTIFACT_RETENTION_DAYS ?? 30),
        new BaselineArtifactSecurityScanner(),
      )
    : new UnavailableBuildJobEngine();
  const releaseConfigurationComplete = Boolean(artifactStore && process.env.RELEASE_RUNTIME_IMAGE && process.env.RELEASE_NETWORK && process.env.RELEASE_DEPLOYMENT_ROOT);
  if (process.env.RELEASE_WORKER_ENABLED === "true" && !releaseConfigurationComplete) throw new Error("Release worker requires artifact storage, a digest-pinned runtime image, a deployment network, and a deployment root");
  const deploymentEngine = releaseConfigurationComplete
    ? new DockerTestDeploymentEngine({ image: process.env.RELEASE_RUNTIME_IMAGE!, network: process.env.RELEASE_NETWORK!, deploymentRoot: process.env.RELEASE_DEPLOYMENT_ROOT!, containerPort: Number(process.env.RELEASE_CONTAINER_PORT ?? 3000), healthPath: process.env.RELEASE_HEALTH_PATH ?? "/health", healthAttempts: Number(process.env.RELEASE_HEALTH_ATTEMPTS ?? 10), healthIntervalMs: Number(process.env.RELEASE_HEALTH_INTERVAL_MS ?? 250), ...(process.env.RELEASE_COMMAND ? { command: process.env.RELEASE_COMMAND.split(" ").filter(Boolean) } : {}) }, artifactStore!)
    : new UnavailableDeploymentEngine();
  const ingress = process.env.INGRESS_ROUTE_ROOT ? new FilesystemIngressRouter(process.env.INGRESS_ROUTE_ROOT) : undefined;
  if (process.env.INGRESS_RECONCILER_ENABLED === "true" && (!ingress || !process.env.TRAEFIK_DYNAMIC_CONFIG_PATH)) throw new Error("Ingress reconciler requires route storage and a Traefik dynamic configuration path");
  const ingressReconciler = ingress && process.env.TRAEFIK_DYNAMIC_CONFIG_PATH ? new TraefikFileReconciler(ingress, process.env.TRAEFIK_DYNAMIC_CONFIG_PATH, process.env.TRAEFIK_ENTRYPOINT ?? "websecure") : new UnavailableIngressReconciler();
  if (!connectionString) {
    const audit = new InMemoryAuditRepository();
    const assessments = new InMemoryAssessmentRepository(audit);
    const applications = new InMemoryApplicationRepository(audit);
    const builds = new InMemoryBuildRecordRepository(audit);
    const releases = new InMemoryReleaseRepository(audit);
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
      releases: new ReleaseService(releases, builds),
      releaseWorker: new ReleaseWorker(process.env.RELEASE_WORKER_ID ?? `local-release-${process.pid}`, releases, deploymentEngine, ingress),
      ingressReconciler,
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
  const releases = new PostgresReleaseRepository(db);
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
    releases: new ReleaseService(releases, builds),
    releaseWorker: new ReleaseWorker(process.env.RELEASE_WORKER_ID ?? `release-worker-${process.pid}`, releases, deploymentEngine, ingress),
    ingressReconciler,
    identity: new IdentityService(
      verifier,
      new PostgresAuthorizationRepository(db),
      stepUpContexts,
      stepUpMethods,
    ),
  };
}
