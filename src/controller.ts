import { Body, Controller, Get, Headers, HttpException, Param, Post } from "@nestjs/common";
import { z } from "zod";
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ApplicationService } from "./application-service.js";
import { ForbiddenError } from "./domain.js";
import {
  AuthenticationError,
  IdentityConfigurationError,
  IdentityService,
} from "./identity.js";
import {
  ApplicationResponse,
  HttpErrorResponse,
  RegisterApplicationRequest,
  ValidationIssueResponse,
} from "./openapi.js";

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  repositoryUrl: z.string().url(),
  idempotencyKey: z.string().min(8).max(100),
});

@Controller("companies/:companyId/applications")
@ApiTags("applications")
@ApiBearerAuth("bearer")
@ApiParam({ name: "companyId", description: "VCP-controlled company identifier" })
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
export class AppController {
  constructor(
    private readonly service: ApplicationService,
    private readonly identity: IdentityService,
  ) {}

  private rethrowIdentityError(error: unknown): never {
    if (error instanceof AuthenticationError) {
      throw new HttpException(error.message, 401);
    }
    if (error instanceof IdentityConfigurationError) {
      throw new HttpException(error.message, 503);
    }
    if (error instanceof ForbiddenError) {
      throw new HttpException(error.message, 403);
    }
    throw error;
  }

  @Get()
  @ApiOperation({ summary: "List applications visible in a company" })
  @ApiOkResponse({
    type: [ApplicationResponse],
    description: "Applications owned by the requested company.",
  })
  async list(@Param("companyId") companyId: string, @Headers() headers: Record<string, string | undefined>) {
    try {
      const actor = await this.identity.resolveActor(
        headers.authorization,
        companyId,
      );
      return await this.service.list(actor, companyId);
    } catch (error) {
      this.rethrowIdentityError(error);
    }
  }

  @Post()
  @ApiOperation({ summary: "Register an application idempotently" })
  @ApiBody({ type: RegisterApplicationRequest })
  @ApiBadRequestResponse({
    type: [ValidationIssueResponse],
    description: "Request body failed schema validation.",
  })
  @ApiCreatedResponse({
    type: ApplicationResponse,
    description: "New or previously registered idempotent application result.",
  })
  async register(
    @Param("companyId") companyId: string,
    @Headers() headers: Record<string, string | undefined>,
    @Body() rawBody: unknown,
  ) {
    try {
      const body = bodySchema.parse(rawBody);
      const actor = await this.identity.resolveActor(
        headers.authorization,
        companyId,
      );
      return await this.service.register({
        actor, companyId, ...body,
        correlationId: headers["x-correlation-id"] ?? crypto.randomUUID(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException(error.issues, 400);
      this.rethrowIdentityError(error);
    }
  }
}
