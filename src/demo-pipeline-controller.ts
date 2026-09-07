import { Body, Controller, Get, Headers, HttpCode, HttpException, Param, Post } from "@nestjs/common";
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiProperty, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { z } from "zod";
import { DemoPipelineService, PipelineError } from "./demo-pipeline.js";
import { AuthenticationError, IdentityConfigurationError, IdentityService } from "./identity.js";
import { ForbiddenError } from "./domain.js";
import { HttpErrorResponse } from "./openapi.js";

export class PipelineRunResponse {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String }) companyId!: string;
  @ApiProperty({ type: String, format: "uuid" }) applicationId!: string;
  @ApiProperty({ type: String }) actorSubject!: string;
  @ApiProperty({ type: String, enum: ["build", "stage", "prod"] }) kind!: string;
  @ApiProperty({ type: String }) sourceRevision!: string;
  @ApiProperty({ type: String, nullable: true }) buildId!: string | null;
  @ApiProperty({ type: String }) idempotencyKey!: string;
  @ApiProperty({ type: String, nullable: true }) runId!: string | null;
  @ApiProperty({ type: String, description: "GitHub status, or dispatching while the outcome is being reconciled" }) status!: string;
  @ApiProperty({ type: String, nullable: true }) conclusion!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, required: false }) url?: string | null;
}
export class PipelineListResponse {
  @ApiProperty({ type: Boolean }) configured!: boolean;
  @ApiProperty({ type: [PipelineRunResponse] }) runs!: PipelineRunResponse[];
}
export class PipelineSourceResponse { @ApiProperty({ type: String, pattern: "^[0-9a-f]{40}$" }) sourceRevision!: string; }
export class PipelineRequest {
  @ApiProperty({ type: String, enum: ["build", "stage", "prod"] }) kind!: string;
  @ApiProperty({ type: String, required: false, pattern: "^[0-9a-f]{40}$", description: "Required for build; immutable commit from the bound source repository" }) sourceRevision?: string;
  @ApiProperty({ type: String, required: false, format: "uuid", description: "Required for Stage/Prod; platform build record ID, not an arbitrary GitHub run ID" }) buildId?: string;
  @ApiProperty({ type: String, format: "uuid" }) idempotencyKey!: string;
}
const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("build"), sourceRevision: z.string().regex(/^[0-9a-f]{40}$/), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ kind: z.enum(["stage", "prod"]), buildId: z.string().uuid(), idempotencyKey: z.string().uuid() }).strict(),
]);
@Controller("companies/:companyId/applications/:applicationId/demo-pipeline")
@ApiTags("demo-pipeline")
@ApiBearerAuth("bearer")
@ApiParam({ name: "companyId" })
@ApiParam({ name: "applicationId", format: "uuid" })
@ApiUnauthorizedResponse({ type: HttpErrorResponse, description: "Sign-in required; dispatch also requires action-level step-up authentication." })
@ApiForbiddenResponse({ type: HttpErrorResponse, description: "No company access." })
@ApiNotFoundResponse({ type: HttpErrorResponse, description: "Application or bound build not found." })
@ApiConflictResponse({ type: HttpErrorResponse, description: "Promotion gate, provenance, active request or idempotency conflict." })
@ApiServiceUnavailableResponse({ type: HttpErrorResponse, description: "Pipeline not configured, identity unavailable, or GitHub unavailable. Dispatch is never automatically retried." })
export class DemoPipelineController {
  constructor(private readonly pipeline: DemoPipelineService, private readonly identity: IdentityService) {}
  @Get()
  @ApiOkResponse({ type: PipelineListResponse })
  async list(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>) {
    try { return await this.pipeline.list(await this.identity.resolveActor(headers.authorization, companyId), companyId, applicationId); }
    catch (error) { this.rethrow(error); }
  }
  @Get("source")
  @ApiOkResponse({ type: PipelineSourceResponse })
  async latest(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>) {
    try { return await this.pipeline.latest(await this.identity.resolveActor(headers.authorization, companyId), companyId, applicationId); }
    catch (error) { this.rethrow(error); }
  }
  @Post()
  @HttpCode(202)
  @ApiBody({ type: PipelineRequest })
  @ApiAcceptedResponse({ type: PipelineRunResponse })
  @ApiBadRequestResponse({ type: HttpErrorResponse, description: "Invalid action-specific request body." })
  async dispatch(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>, @Body() body: unknown) {
    try {
      // Verify identity before validation; all dispatches are sensitive operations.
      const actor = await this.identity.resolveActor(headers.authorization, companyId, { sensitiveAction: "release.create" });
      return await this.pipeline.dispatch(actor, companyId, applicationId, commandSchema.parse(body));
    } catch (error) { this.rethrow(error); }
  }
  private rethrow(error: unknown): never {
    if (error instanceof z.ZodError) throw new HttpException("Invalid pipeline request body.", 400);
    if (error instanceof AuthenticationError) throw new HttpException(error.message, 401);
    if (error instanceof ForbiddenError) throw new HttpException(error.message, 403);
    if (error instanceof IdentityConfigurationError) throw new HttpException(error.message, 503);
    if (error instanceof PipelineError) throw new HttpException(error.message, error.status);
    throw error;
  }
}
