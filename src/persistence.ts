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
  const verifier = new SpikeAccessTokenVerifier(
    process.env.SPIKE_IDENTITY_ENABLED === "true",
  );
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
    ),
  };
}
