import { HttpException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ApplicationService } from "../src/application-service.js";
import { AssessmentController } from "../src/assessment-controller.js";
import { AssessmentService } from "../src/assessment-service.js";
import { AppController } from "../src/controller.js";
import {
  IdentityService,
  InMemoryAuthorizationRepository,
  SpikeAccessTokenVerifier,
} from "../src/identity.js";
import { InMemoryAssessmentRepository } from "../src/in-memory-assessment-repository.js";
import {
  InMemoryApplicationRepository,
  InMemoryAuditRepository,
} from "../src/in-memory-repositories.js";
import { createOpenApiDocument } from "../src/openapi.js";

type ProtectedOperation = {
  readonly method: "get" | "post";
  readonly path: string;
  readonly invoke: (headers: Record<string, string | undefined>) => Promise<unknown>;
};

async function expectStatus(operation: Promise<unknown>, status: number) {
  try {
    await operation;
    throw new Error("Expected request to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
  }
}

describe("documented route authorization contract", () => {
  let app: NestFastifyApplication;
  let operations: readonly ProtectedOperation[];

  beforeAll(async () => {
    process.env.ASSESSMENT_WORKER_ENABLED = "false";
    const audit = new InMemoryAuditRepository();
    const identity = new IdentityService(
      new SpikeAccessTokenVerifier(true),
      new InMemoryAuthorizationRepository([
        { subject: "user-a", companyId: "company-a" },
      ]),
      [],
      ["otp"],
    );
    const applicationRepository = new InMemoryApplicationRepository(audit);
    const applications = new AppController(
      new ApplicationService(applicationRepository, audit),
      identity,
    );
    const assessments = new AssessmentController(
      new AssessmentService(new InMemoryAssessmentRepository(audit), applicationRepository),
      identity,
    );
    const applicationId = "11111111-1111-4111-8111-111111111111";
    const assessmentId = "22222222-2222-4222-8222-222222222222";

    operations = [
      {
        method: "get",
        path: "/companies/{companyId}/applications",
        invoke: (headers) => applications.list("company-b", headers),
      },
      {
        method: "post",
        path: "/companies/{companyId}/applications",
        invoke: (headers) =>
          applications.register("company-b", headers, {
            name: "Authorization probe",
            repositoryUrl: "https://example.test/probe",
            idempotencyKey: "authorization-probe",
          }),
      },
      {
        method: "get",
        path: "/companies/{companyId}/applications/{applicationId}/assessments",
        invoke: (headers) => assessments.list("company-b", applicationId, headers),
      },
      {
        method: "post",
        path: "/companies/{companyId}/applications/{applicationId}/assessments",
        invoke: (headers) =>
          assessments.submit("company-b", applicationId, headers, {
            idempotencyKey: "authorization-probe",
            sourceRevision: "0123456789abcdef0123456789abcdef01234567",
          }),
      },
      {
        method: "get",
        path: "/companies/{companyId}/applications/{applicationId}/assessments/{assessmentId}",
        invoke: (headers) => assessments.get("company-b", assessmentId, headers),
      },
    ];

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("has an executable authorization case for every documented operation", () => {
    const document = createOpenApiDocument(app);
    const documented = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.entries(item ?? {})
        .filter(([, operation]) =>
          typeof operation === "object" && operation !== null && "responses" in operation,
        )
        .map(([method]) => `${method.toLowerCase()} ${path}`),
    );
    const covered = operations.map(({ method, path }) => `${method} ${path}`);

    expect(covered.sort()).toEqual(documented.sort());
  });

  it("returns 401 for every documented operation without a verified identity", async () => {
    for (const operation of operations) {
      await expectStatus(operation.invoke({}), 401);
    }
  });

  it("returns 403 for every documented operation across a company boundary", async () => {
    for (const operation of operations) {
      await expectStatus(
        operation.invoke({ authorization: "Bearer spike:user-a" }),
        403,
      );
    }
  });
});
