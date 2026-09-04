import { NestFactory } from "@nestjs/core";
import { readFile } from "node:fs/promises";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { createOpenApiDocument } from "../src/openapi.js";

describe("OpenAPI generation", () => {
  let app: NestFastifyApplication;
  let document: ReturnType<typeof createOpenApiDocument>;

  beforeAll(async () => {
    process.env.ASSESSMENT_WORKER_ENABLED = "false";
    process.env.RELEASE_WORKER_ENABLED = "false";
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    document = createOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes all control-plane routes with bearer security", () => {
    const paths = [
      "/companies/{companyId}/applications",
      "/companies/{companyId}/applications/{applicationId}/assessments",
      "/companies/{companyId}/applications/{applicationId}/assessments/{assessmentId}",
      "/companies/{companyId}/applications/{applicationId}/builds",
      "/companies/{companyId}/applications/{applicationId}/builds/{buildId}",
      "/companies/{companyId}/applications/{applicationId}/releases",
      "/companies/{companyId}/applications/{applicationId}/releases/{releaseId}",
    ];
    expect(Object.keys(document.paths)).toEqual(paths);
    for (const path of Object.values(document.paths)) {
      for (const operation of Object.values(path ?? {})) {
        if (typeof operation === "object" && operation && "responses" in operation) {
          expect(operation.security).toEqual([{ bearer: [] }]);
          expect(operation.responses["401"]).toBeDefined();
          expect(operation.responses["403"]).toBeDefined();
          expect(operation.responses["503"]).toBeDefined();
        }
      }
    }
  });

  it("documents validation and not-found responses on applicable operations", () => {
    const applicationPost = document.paths["/companies/{companyId}/applications"]?.post;
    const assessmentPost = document.paths["/companies/{companyId}/applications/{applicationId}/assessments"]?.post;
    const assessmentGet = document.paths["/companies/{companyId}/applications/{applicationId}/assessments/{assessmentId}"]?.get;
    const buildPost = document.paths["/companies/{companyId}/applications/{applicationId}/builds"]?.post;
    const buildGet = document.paths["/companies/{companyId}/applications/{applicationId}/builds/{buildId}"]?.get;
    const releasePost = document.paths["/companies/{companyId}/applications/{applicationId}/releases"]?.post;
    const releaseGet = document.paths["/companies/{companyId}/applications/{applicationId}/releases/{releaseId}"]?.get;

    expect(applicationPost?.responses["400"]).toBeDefined();
    expect(assessmentPost?.responses["400"]).toBeDefined();
    expect(assessmentPost?.responses["404"]).toBeDefined();
    expect(assessmentGet?.responses["404"]).toBeDefined();
    expect(buildPost?.responses["400"]).toBeDefined();
    expect(buildPost?.responses["404"]).toBeDefined();
    expect(buildGet?.responses["404"]).toBeDefined();
    expect(releasePost?.responses["400"]).toBeDefined();
    expect(releasePost?.responses["404"]).toBeDefined();
    expect(releaseGet?.responses["404"]).toBeDefined();
    expect(document.components?.schemas?.HttpErrorResponse).toBeDefined();
    expect(document.components?.schemas?.ValidationIssueResponse).toBeDefined();
  });

  it("keeps the committed OpenAPI artifact synchronized", async () => {
    const artifact = JSON.parse(
      await readFile(new URL("../openapi.json", import.meta.url), "utf8"),
    );
    expect(artifact).toEqual(document);
  });

  it("describes request bodies and asynchronous acceptance", () => {
    const applicationPost = document.paths["/companies/{companyId}/applications"]?.post;
    const assessmentPost = document.paths["/companies/{companyId}/applications/{applicationId}/assessments"]?.post;
    const buildPost = document.paths["/companies/{companyId}/applications/{applicationId}/builds"]?.post;
    const releasePost = document.paths["/companies/{companyId}/applications/{applicationId}/releases"]?.post;
    expect(applicationPost?.requestBody).toBeDefined();
    expect(applicationPost?.responses["201"]).toBeDefined();
    expect(assessmentPost?.requestBody).toBeDefined();
    expect(assessmentPost?.responses["202"]).toBeDefined();
    expect(buildPost?.requestBody).toBeDefined();
    expect(buildPost?.responses["202"]).toBeDefined();
    expect(releasePost?.requestBody).toBeDefined();
    expect(releasePost?.responses["202"]).toBeDefined();
  });

  it("documents schema constraints and conditional assessment fields", () => {
    const schemas = document.components?.schemas;
    expect(schemas?.RegisterApplicationRequest).toMatchObject({
      required: ["name", "repositoryUrl", "idempotencyKey"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        repositoryUrl: { type: "string", format: "uri" },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 100 },
      },
    });
    expect(schemas?.SubmitAssessmentRequest).toMatchObject({
      required: ["idempotencyKey", "sourceRevision"],
      properties: {
        sourceRevision: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
      },
    });
    expect(schemas?.AssessmentResponse).toMatchObject({
      required: expect.not.arrayContaining(["result", "error", "startedAt", "completedAt"]),
      properties: {
        status: {
          type: "string",
          enum: ["queued", "running", "completed", "failed"],
        },
        result: {
          allOf: [{ $ref: "#/components/schemas/AssessmentResultResponse" }],
        },
        error: { type: "string" },
      },
    });
  });
});
