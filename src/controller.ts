import { Body, Controller, Get, Headers, HttpException, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { ApplicationService } from "./application-service.js";
import type { Actor } from "./domain.js";
import { ForbiddenError } from "./domain.js";
import { InMemoryApplicationRepository, InMemoryAuditRepository } from "./in-memory-repositories.js";

const applications = new InMemoryApplicationRepository();
const audit = new InMemoryAuditRepository();
const service = new ApplicationService(applications, audit);

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  repositoryUrl: z.string().url(),
  idempotencyKey: z.string().min(8).max(100),
});

function actor(headers: Record<string, string | undefined>): Actor {
  const subject = headers["x-spike-subject"];
  const role = headers["x-spike-role"];
  if (!subject || (role !== "operator" && role !== "company-user")) {
    throw new HttpException("Missing synthetic spike identity", 401);
  }
  const companyId = headers["x-spike-company-id"];
  return companyId ? { subject, role, companyId } : { subject, role };
}

@Controller("companies/:companyId/applications")
export class AppController {
  @Get()
  async list(@Param("companyId") companyId: string, @Headers() headers: Record<string, string | undefined>) {
    try { return await service.list(actor(headers), companyId); }
    catch (error) { if (error instanceof ForbiddenError) throw new HttpException(error.message, 403); throw error; }
  }

  @Post()
  async register(
    @Param("companyId") companyId: string,
    @Headers() headers: Record<string, string | undefined>,
    @Body() rawBody: unknown,
  ) {
    try {
      const body = bodySchema.parse(rawBody);
      return await service.register({
        actor: actor(headers), companyId, ...body,
        correlationId: headers["x-correlation-id"] ?? crypto.randomUUID(),
      });
    } catch (error) {
      if (error instanceof ForbiddenError) throw new HttpException(error.message, 403);
      if (error instanceof z.ZodError) throw new HttpException(error.issues, 400);
      throw error;
    }
  }
}

