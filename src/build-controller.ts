import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, HttpException, Param, Post } from "@nestjs/common";
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { z } from "zod";
import { BuildJobService } from "./build-job-service.js";
import { ApplicationNotFoundError, ForbiddenError } from "./domain.js";
import { AuthenticationError, IdentityConfigurationError, IdentityService } from "./identity.js";
import { BuildRecordResponse, HttpErrorResponse, SubmitBuildRequest, ValidationIssueResponse } from "./openapi.js";

const schema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/i, "Expected an immutable 40-character Git commit SHA"),
  packageManager: z.enum(["npm", "pnpm", "yarn"]),
  script: z.enum(["build", "test"]),
});

@Controller("companies/:companyId/applications/:applicationId/builds")
@ApiTags("builds")
@ApiBearerAuth("bearer")
@ApiParam({ name: "companyId", description: "VCP-controlled company identifier" })
@ApiParam({ name: "applicationId", format: "uuid" })
@ApiUnauthorizedResponse({ type: HttpErrorResponse, description: "Bearer token is missing, invalid, or lacks required step-up assurance." })
@ApiForbiddenResponse({ type: HttpErrorResponse, description: "Verified subject has no active access to the requested company." })
@ApiServiceUnavailableResponse({ type: HttpErrorResponse, description: "The configured identity verifier cannot establish trust." })
export class BuildController {
  constructor(private readonly builds: BuildJobService, private readonly identity: IdentityService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: "Queue an immutable asynchronous build or test" })
  @ApiBody({ type: SubmitBuildRequest })
  @ApiBadRequestResponse({ type: [ValidationIssueResponse], description: "Request body failed schema validation." })
  @ApiAcceptedResponse({ type: BuildRecordResponse, description: "Queued build, or original record for an idempotent retry." })
  @ApiNotFoundResponse({ type: HttpErrorResponse, description: "Application does not exist in the requested company." })
  async submit(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>, @Body() rawBody: unknown) {
    try {
      const body = schema.parse(rawBody);
      const actor = await this.identity.resolveActor(headers.authorization, companyId, { sensitiveAction: "build.submit" });
      return await this.builds.submit({ actor, companyId, applicationId, ...body, sourceRevision: body.sourceRevision.toLowerCase(), correlationId: headers["x-correlation-id"] ?? randomUUID() });
    } catch (error) { this.rethrow(error); }
  }

  @Get()
  @ApiOperation({ summary: "List builds for an application" })
  @ApiOkResponse({ type: [BuildRecordResponse] })
  async list(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>) {
    try { return await this.builds.list(await this.identity.resolveActor(headers.authorization, companyId), companyId, applicationId); }
    catch (error) { this.rethrow(error); }
  }

  @Get(":buildId")
  @ApiOperation({ summary: "Get asynchronous build status" })
  @ApiParam({ name: "buildId", format: "uuid" })
  @ApiOkResponse({ type: BuildRecordResponse })
  @ApiNotFoundResponse({ type: HttpErrorResponse, description: "Build record does not exist in the requested company." })
  async get(@Param("companyId") companyId: string, @Param("buildId") buildId: string, @Headers() headers: Record<string, string | undefined>) {
    try {
      const build = await this.builds.get(await this.identity.resolveActor(headers.authorization, companyId), companyId, buildId);
      if (!build) throw new HttpException("Build not found", 404);
      return build;
    } catch (error) { this.rethrow(error); }
  }

  private rethrow(error: unknown): never {
    if (error instanceof z.ZodError) throw new HttpException(error.issues, 400);
    if (error instanceof AuthenticationError) throw new HttpException(error.message, 401);
    if (error instanceof IdentityConfigurationError) throw new HttpException(error.message, 503);
    if (error instanceof ForbiddenError) throw new HttpException(error.message, 403);
    if (error instanceof ApplicationNotFoundError) throw new HttpException(error.message, 404);
    throw error;
  }
}
