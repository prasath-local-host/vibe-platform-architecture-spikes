import { Controller, Get, Headers, HttpException, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { ForbiddenError } from "./domain.js";
import { AuthenticationError, IdentityConfigurationError, IdentityService } from "./identity.js";
import { HttpErrorResponse, ScanSummaryResponse, ScanDetailResponse } from "./openapi.js";
import { ScanEvidenceService } from "./scan-evidence-service.js";

@Controller("companies/:companyId/applications/:applicationId/security-scans")
@ApiTags("security-scans")
@ApiBearerAuth("bearer")
@ApiParam({ name: "companyId" })
@ApiParam({ name: "applicationId", format: "uuid" })
@ApiUnauthorizedResponse({ type: HttpErrorResponse })
@ApiForbiddenResponse({ type: HttpErrorResponse })
@ApiServiceUnavailableResponse({ type: HttpErrorResponse })
export class ScanEvidenceController {
  constructor(private readonly evidence: ScanEvidenceService, private readonly identity: IdentityService) {}
  @Get()
  @ApiOperation({ summary: "List saved security scans for this application's builds and releases" })
  @ApiOkResponse({ type: [ScanSummaryResponse] })
  async list(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Headers() headers: Record<string, string | undefined>) {
    try { return await this.evidence.list(await this.identity.resolveActor(headers.authorization, companyId), companyId, applicationId); }
    catch (error) { this.rethrow(error); }
  }
  @Get(":scanId")
  @ApiParam({ name: "scanId", format: "uuid" })
  @ApiOperation({ summary: "Read a saved scan and its CycloneDX report" })
  @ApiOkResponse({ type: ScanDetailResponse })
  @ApiNotFoundResponse({ type: HttpErrorResponse })
  async get(@Param("companyId") companyId: string, @Param("applicationId") applicationId: string, @Param("scanId") scanId: string, @Headers() headers: Record<string, string | undefined>) {
    try {
      const evidence = await this.evidence.get(await this.identity.resolveActor(headers.authorization, companyId), companyId, applicationId, scanId);
      if (!evidence) throw new HttpException("Scan not found", 404);
      return evidence;
    } catch (error) { this.rethrow(error); }
  }
  private rethrow(error: unknown): never {
    if (error instanceof AuthenticationError) throw new HttpException(error.message, 401);
    if (error instanceof IdentityConfigurationError) throw new HttpException(error.message, 503);
    if (error instanceof ForbiddenError) throw new HttpException(error.message, 403);
    throw error;
  }
}
