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

export interface ApplicationRuntime {
  readonly applications: ApplicationService;
  readonly assessments: AssessmentService;
  readonly assessmentWorker: AssessmentWorker;
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
  if (!connectionString) {
    const audit = new InMemoryAuditRepository();
    const assessments = new InMemoryAssessmentRepository(audit);
    const applications = new InMemoryApplicationRepository(audit);
    const engine = new ManifestAssessmentEngine(new UnavailableSourceRepository());
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
  const engine = new ManifestAssessmentEngine(new UnavailableSourceRepository());
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
    identity: new IdentityService(
      verifier,
      new PostgresAuthorizationRepository(db),
      stepUpContexts,
      stepUpMethods,
    ),
  };
}
