import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from "@nestjs/swagger";
import { AssessmentService } from "./assessment-service.js";
import { ForbiddenError } from "./domain.js";
import {
  AuthenticationError,
  IdentityConfigurationError,
  IdentityService,
} from "./identity.js";
import {
  AssessmentResponse,
  HttpErrorResponse,
  SubmitAssessmentRequest,
  ValidationIssueResponse,
} from "./openapi.js";

const submitSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
});

@Controller("companies/:companyId/applications/:applicationId/assessments")
@ApiTags("assessments")
@ApiBearerAuth("bearer")
@ApiParam({ name: "companyId", description: "VCP-controlled company identifier" })
@ApiParam({ name: "applicationId", format: "uuid" })
@ApiUnauthorizedResponse({
  type: HttpErrorResponse,
  description: "Bearer token is missing, malformed, expired, or cannot be verified.",
})
@ApiForbiddenResponse({
  type: HttpErrorResponse,
  description: "Verified subject has no active access to the requested company.",
})
@ApiServiceUnavailableResponse({
  type: HttpErrorResponse,
  description: "The configured identity verifier cannot establish trust.",
})
export class AssessmentController {
  constructor(
    private readonly assessments: AssessmentService,
    private readonly identity: IdentityService,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: "Queue an asynchronous assessment idempotently" })
  @ApiBody({ type: SubmitAssessmentRequest })
  @ApiBadRequestResponse({
    type: [ValidationIssueResponse],
    description: "Request body failed schema validation.",
  })
  @ApiAcceptedResponse({
    type: AssessmentResponse,
    description: "Queued assessment, or the original assessment for an idempotent retry.",
  })
  async submit(
    @Param("companyId") companyId: string,
    @Param("applicationId") applicationId: string,
    @Headers() headers: Record<string, string | undefined>,
    @Body() rawBody: unknown,
  ) {
    try {
      const body = submitSchema.parse(rawBody);
      const actor = await this.identity.resolveActor(headers.authorization, companyId);
      return await this.assessments.submit({
        actor,
        companyId,
        applicationId,
        idempotencyKey: body.idempotencyKey,
        correlationId: headers["x-correlation-id"] ?? randomUUID(),
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Get()
  @ApiOperation({ summary: "List assessments for an application" })
  @ApiOkResponse({
    type: [AssessmentResponse],
    description: "Assessments for the requested company application, oldest first.",
  })
  async list(
    @Param("companyId") companyId: string,
    @Param("applicationId") applicationId: string,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    try {
      const actor = await this.identity.resolveActor(headers.authorization, companyId);
      return await this.assessments.list(actor, companyId, applicationId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Get(":assessmentId")
  @ApiOperation({ summary: "Get asynchronous assessment status and result" })
  @ApiParam({ name: "assessmentId", format: "uuid" })
  @ApiOkResponse({
    type: AssessmentResponse,
    description: "Current asynchronous lifecycle state and terminal result when available.",
  })
  @ApiNotFoundResponse({
    type: HttpErrorResponse,
    description: "No assessment with this identifier exists in the requested company.",
  })
  async get(
    @Param("companyId") companyId: string,
    @Param("assessmentId") assessmentId: string,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    try {
      const actor = await this.identity.resolveActor(headers.authorization, companyId);
      const assessment = await this.assessments.get(actor, companyId, assessmentId);
      if (!assessment) throw new HttpException("Assessment not found", 404);
      return assessment;
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof z.ZodError) throw new HttpException(error.issues, 400);
    if (error instanceof AuthenticationError) throw new HttpException(error.message, 401);
    if (error instanceof IdentityConfigurationError) throw new HttpException(error.message, 503);
    if (error instanceof ForbiddenError) throw new HttpException(error.message, 403);
    throw error;
  }
}
