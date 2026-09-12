import { Body, Controller, Get, Headers, HttpException, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiServiceUnavailableResponse } from "@nestjs/swagger";
import { z } from "zod";
import { ForbiddenError } from "./domain.js";
import { AuthenticationError, IdentityConfigurationError, IdentityService } from "./identity.js";
import { ProjectProvisioningService, ProvisioningError } from "./project-provisioning-service.js";

@Controller("companies/:companyId/project-setup")
@ApiTags("project-setup")
@ApiParam({ name: "companyId", description: "VCP-controlled company identifier" })
@ApiBearerAuth("bearer")
@ApiUnauthorizedResponse({ description: "Authentication or configured step-up assurance is required." })
@ApiForbiddenResponse({ description: "Company access or operator approval is required." })
@ApiServiceUnavailableResponse({ description: "Project creation or identity trust is not configured." })
export class ProjectProvisioningController {
  constructor(private readonly service: ProjectProvisioningService, private readonly identity: IdentityService) {}
  private async handle<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof AuthenticationError) throw new HttpException(error.message, 401);
      if (error instanceof ForbiddenError) throw new HttpException(error.message, 403);
      if (error instanceof IdentityConfigurationError) throw new HttpException(error.message, 503);
      if (error instanceof ProvisioningError) throw new HttpException(error.message, error.status);
      if (error instanceof z.ZodError) throw new HttpException("Invalid setup data or unexpected GitHub response. Contact the VCP team if the problem persists.", 400);
      throw new HttpException("Project setup failed. Contact the VCP team.", 500);
    }
  }
  @Get()
  @ApiOperation({ summary: "Get company GitHub onboarding and project initialization status" })
  snapshot(@Param("companyId") companyId: string, @Headers("authorization") authorization?: string) {
    return this.handle(async () => this.service.snapshot(await this.identity.resolveActor(authorization, companyId), companyId));
  }
  @Post("organization")
  @ApiOperation({ summary: "Request a company GitHub organization connection" })
  @ApiBody({ schema: { type: "object", required: ["slug"], properties: { slug: { type: "string", maxLength: 39 } } } })
  organization(@Param("companyId") companyId: string, @Headers("authorization") authorization: string | undefined, @Body() raw: unknown) {
    return this.handle(async () => {
      const actor = await this.identity.resolveActor(authorization, companyId, { sensitiveAction: "company.access.change" });
      const body = z.object({ slug: z.string().max(39) }).strict().parse(raw);
      return this.service.requestOrganization(actor, companyId, body.slug);
    });
  }
  @Post("organization/approve")
  @ApiOperation({ summary: "Operator confirms company ownership and verifies the GitHub App installation" })
  @ApiBody({ schema: { type: "object", required: ["slug", "approvalReference"], properties: { slug: { type: "string" }, approvalReference: { type: "string", maxLength: 200 } } } })
  approve(@Param("companyId") companyId: string, @Headers("authorization") authorization: string | undefined, @Body() raw: unknown) {
    return this.handle(async () => {
      const actor = await this.identity.resolveActor(authorization, companyId, { sensitiveAction: "company.access.change" });
      const body = z.object({ slug: z.string().max(39), approvalReference: z.string().min(1).max(200) }).strict().parse(raw);
      return this.service.approveOrganization(actor, companyId, body.slug, body.approvalReference);
    });
  }
  @Post("projects")
  @ApiOperation({ summary: "Create a private organization repository, initialize VCP policy, and register the application" })
  @ApiBody({ schema: { type: "object", required: ["name", "repositoryName", "idempotencyKey"], properties: {
    name: { type: "string", maxLength: 120 }, repositoryName: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,79}$" }, idempotencyKey: { type: "string", minLength: 8, maxLength: 100 },
  } } })
  create(@Param("companyId") companyId: string, @Headers("authorization") authorization: string | undefined, @Body() raw: unknown) {
    return this.handle(async () => {
      const actor = await this.identity.resolveActor(authorization, companyId, { sensitiveAction: "application.register" });
      const body = z.object({ name: z.string().min(1).max(120), repositoryName: z.string().max(80), idempotencyKey: z.string().min(8).max(100) }).strict().parse(raw);
      return this.service.createProject(actor, companyId, body);
    });
  }
}
