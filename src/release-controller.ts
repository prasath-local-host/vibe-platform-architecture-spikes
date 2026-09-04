import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, HttpException, Param, Post } from "@nestjs/common";
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { z } from "zod";
import { ForbiddenError } from "./domain.js";
import { AuthenticationError, IdentityConfigurationError, IdentityService } from "./identity.js";
import { CreateReleaseRequest, HttpErrorResponse, ReleaseRecordResponse, ValidationIssueResponse } from "./openapi.js";
import { ReleaseService } from "./release-service.js";

const schema = z.object({ buildId: z.string().uuid(), idempotencyKey: z.string().min(8).max(100) });

@Controller("companies/:companyId/applications/:applicationId/releases")
@ApiTags("releases")
@ApiBearerAuth("bearer")
@ApiParam({ name: "companyId", description: "VCP-controlled company identifier" })
@ApiParam({ name: "applicationId", format: "uuid" })
@ApiUnauthorizedResponse({ type: HttpErrorResponse, description: "Bearer token is missing, invalid, or lacks required step-up assurance." })
@ApiForbiddenResponse({ type: HttpErrorResponse, description: "Verified subject has no active access to the requested company." })
@ApiServiceUnavailableResponse({ type: HttpErrorResponse, description: "The configured identity verifier cannot establish trust." })
export class ReleaseController {
  constructor(private readonly releases: ReleaseService, private readonly identity: IdentityService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: "Queue deployment of a completed build to the test environment" })
  @ApiBody({ type: CreateReleaseRequest })
  @ApiBadRequestResponse({ type: [ValidationIssueResponse], description: "Request is invalid or the build is not completed." })
  @ApiNotFoundResponse({ type: HttpErrorResponse, description: "Completed build does not exist for this application and company." })
  @ApiAcceptedResponse({ type: ReleaseRecordResponse })
  async create(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>, @Body() rawBody: unknown) {
    try {
      const body = schema.parse(rawBody);
      const actor = await this.identity.resolveActor(headers.authorization, companyId, { sensitiveAction: "release.create" });
      return await this.releases.create({ actor, companyId, applicationId, ...body, correlationId: headers["x-correlation-id"] ?? randomUUID() });
    } catch (error) { this.rethrow(error); }
  }

  @Get()
  @ApiOperation({ summary: "List test releases for an application" })
  @ApiOkResponse({ type: [ReleaseRecordResponse] })
  async list(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>) {
    try { return await this.releases.list(await this.identity.resolveActor(headers.authorization, companyId), companyId, applicationId); }
    catch (error) { this.rethrow(error); }
  }

  @Get(":releaseId")
  @ApiOperation({ summary: "Get test-release deployment and health status" })
  @ApiParam({ name: "releaseId", format: "uuid" })
  @ApiOkResponse({ type: ReleaseRecordResponse })
  @ApiNotFoundResponse({ type: HttpErrorResponse, description: "Release record does not exist in the requested company." })
  async get(@Param("companyId") companyId: string, @Param("releaseId") releaseId: string, @Headers() headers: Record<string, string | undefined>) {
    try {
      const release = await this.releases.get(await this.identity.resolveActor(headers.authorization, companyId), companyId, releaseId);
      if (!release) throw new HttpException("Release not found", 404);
      return release;
    } catch (error) { this.rethrow(error); }
  }

  private rethrow(error: unknown): never {
    if (error instanceof z.ZodError) throw new HttpException(error.issues, 400);
    if (error instanceof AuthenticationError) throw new HttpException(error.message, 401);
    if (error instanceof IdentityConfigurationError) throw new HttpException(error.message, 503);
    if (error instanceof ForbiddenError) throw new HttpException(error.message, 403);
    if (error instanceof Error && error.message === "Completed build not found") throw new HttpException(error.message, 404);
    if (error instanceof Error && error.message === "Only a completed build can be released") throw new HttpException(error.message, 400);
    throw error;
  }
}
