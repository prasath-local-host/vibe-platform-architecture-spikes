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
  parsePrivilegedAuthenticationContexts,
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
  const privilegedContexts = parsePrivilegedAuthenticationContexts(
    process.env.PRIVILEGED_AUTHENTICATION_CONTEXTS,
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
    return {
      applications: new ApplicationService(
        new InMemoryApplicationRepository(audit),
        audit,
        logger,
      ),
      assessments: new AssessmentService(assessments, logger),
      assessmentWorker: new AssessmentWorker(
        process.env.ASSESSMENT_WORKER_ID ?? `local-${process.pid}`,
        assessments,
        logger,
      ),
      identity: new IdentityService(
        verifier,
        new InMemoryAuthorizationRepository(
          parseSpikeGrants(process.env.SPIKE_IDENTITY_GRANTS),
        ),
        privilegedContexts,
      ),
    };
  }

  const db = createDatabase(connectionString, logger);
  await migrateToLatest(db);
  const assessments = new PostgresAssessmentRepository(db);
  return {
    applications: new ApplicationService(
      new PostgresApplicationRepository(db),
      new PostgresAuditRepository(db),
      logger,
    ),
    assessments: new AssessmentService(assessments, logger),
    assessmentWorker: new AssessmentWorker(
      process.env.ASSESSMENT_WORKER_ID ?? `worker-${process.pid}`,
      assessments,
      logger,
    ),
    identity: new IdentityService(
      verifier,
      new PostgresAuthorizationRepository(db),
      privilegedContexts,
    ),
  };
}
