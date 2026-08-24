import { Body, Controller, Get, Headers, HttpException, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { ApplicationService } from "./application-service.js";
import { ForbiddenError } from "./domain.js";
import {
  AuthenticationError,
  IdentityConfigurationError,
  IdentityService,
} from "./identity.js";

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  repositoryUrl: z.string().url(),
  idempotencyKey: z.string().min(8).max(100),
});

@Controller("companies/:companyId/applications")
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
