import type { INestApplication } from "@nestjs/common";
import {
  ApiProperty,
  ApiPropertyOptional,
  DocumentBuilder,
  SwaggerModule,
} from "@nestjs/swagger";

export class RegisterApplicationRequest {
  @ApiProperty({
    type: String,
    description: "Company-visible application name.",
    example: "Readiness portal",
    minLength: 1,
    maxLength: 120,
  })
  name!: string;

  @ApiProperty({
    type: String,
    description: "HTTPS URL of the approved source repository.",
    example: "https://github.com/example/readiness-portal",
    format: "uri",
  })
  repositoryUrl!: string;

  @ApiProperty({
    type: String,
    description: "Caller-generated key that makes retries return the original application.",
    example: "register-readiness-portal-v1",
    minLength: 8,
    maxLength: 100,
  })
  idempotencyKey!: string;
}

export class SubmitAssessmentRequest {
  @ApiProperty({
    type: String,
    description: "Caller-generated key unique to this application assessment request.",
    example: "assess-main-commit-v1",
    minLength: 8,
    maxLength: 100,
  })
  idempotencyKey!: string;

  @ApiProperty({
    type: String,
    pattern: "^[0-9a-fA-F]{40}$",
    description: "Immutable Git commit SHA to assess. Branch and tag names are not accepted.",
    example: "0123456789abcdef0123456789abcdef01234567",
  })
  sourceRevision!: string;
}

export class SubmitBuildRequest {
  @ApiProperty({ type: String, minLength: 8, maxLength: 100, example: "build-main-commit-v1" })
  idempotencyKey!: string;
  @ApiProperty({ type: String, pattern: "^[0-9a-fA-F]{40}$", description: "Immutable Git commit SHA." })
  sourceRevision!: string;
  @ApiProperty({ type: String, enum: ["npm", "pnpm", "yarn"] })
  packageManager!: string;
  @ApiProperty({ type: String, enum: ["build", "test"] })
  script!: string;
}

export class BuildResultResponse {
  @ApiProperty({ type: String, format: "uuid" })
  artifactId!: string;
  @ApiProperty({ type: String, pattern: "^sha256:[0-9a-f]{64}$" })
  artifactDigest!: string;
  @ApiProperty({ type: String, enum: ["succeeded"] })
  restorationStatus!: string;
  @ApiProperty({ type: String, enum: ["succeeded", "failed"] })
  buildStatus!: string;
}

export class BuildRecordResponse {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String }) companyId!: string;
  @ApiProperty({ type: String, format: "uuid" }) applicationId!: string;
  @ApiProperty({ type: String, format: "uri" }) repositoryUrl!: string;
  @ApiProperty({ type: String, pattern: "^[0-9a-f]{40}$" }) sourceRevision!: string;
  @ApiProperty({ type: String, enum: ["npm", "pnpm", "yarn"] }) packageManager!: string;
  @ApiProperty({ type: String, enum: ["build", "test"] }) script!: string;
  @ApiProperty({ type: String }) idempotencyKey!: string;
  @ApiProperty({ type: String }) correlationId!: string;
  @ApiProperty({ type: String, enum: ["queued", "running", "completed", "failed"] }) status!: string;
  @ApiProperty({ type: Number, minimum: 0 }) attempts!: number;
  @ApiPropertyOptional({ type: () => BuildResultResponse }) result?: BuildResultResponse;
  @ApiPropertyOptional({ type: String }) error?: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) startedAt?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) completedAt?: string;
}

export class CreateReleaseRequest {
  @ApiProperty({ type: String, format: "uuid", description: "Completed build whose verified artifact will be deployed." })
  buildId!: string;
  @ApiProperty({ type: String, minLength: 8, maxLength: 100, example: "release-test-commit-v1" })
  idempotencyKey!: string;
}

export class ReleaseRecordResponse {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String }) companyId!: string;
  @ApiProperty({ type: String, format: "uuid" }) applicationId!: string;
  @ApiProperty({ type: String, format: "uuid" }) buildId!: string;
  @ApiProperty({ type: String, format: "uuid" }) artifactId!: string;
  @ApiProperty({ type: String, pattern: "^sha256:[0-9a-f]{64}$" }) artifactDigest!: string;
  @ApiProperty({ type: String, enum: ["test"] }) environment!: string;
  @ApiProperty({ type: String, enum: ["pending", "deploying", "healthy", "failed", "rolled-back"] }) status!: string;
  @ApiProperty({ type: String }) idempotencyKey!: string;
  @ApiProperty({ type: String }) correlationId!: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) rollbackTargetReleaseId?: string;
  @ApiPropertyOptional({ type: String, format: "uri" }) deploymentUrl?: string;
  @ApiPropertyOptional({ type: String }) error?: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) deployedAt?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) healthVerifiedAt?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) completedAt?: string;
}

export class HttpErrorResponse {
  @ApiProperty({ type: Number, example: 401, description: "HTTP status code." })
  statusCode!: number;

  @ApiProperty({
    type: String,
    example: "Verified identity is required",
    description: "Safe, human-readable failure summary.",
  })
  message!: string;
}

export class ValidationIssueResponse {
  @ApiProperty({ type: String, example: "too_small", description: "Zod validation issue code." })
  code!: string;

  @ApiProperty({
    type: [String],
    example: ["idempotencyKey"],
    description: "Request-body property path. Numeric array indexes are serialized as values.",
  })
  path!: Array<string | number>;

  @ApiProperty({ type: String, example: "Too small: expected string to have >=8 characters" })
  message!: string;
}

export class ApplicationResponse {
  @ApiProperty({ type: String, format: "uuid", description: "VCP application identifier." })
  id!: string;

  @ApiProperty({ type: String, description: "Owning VCP company identifier.", example: "company-a" })
  companyId!: string;

  @ApiProperty({ type: String, description: "Company-visible application name.", example: "Readiness portal" })
  name!: string;

  @ApiProperty({ type: String, format: "uri", description: "Approved source repository URL." })
  repositoryUrl!: string;

  @ApiProperty({ type: String, description: "Idempotency key accepted during registration." })
  idempotencyKey!: string;

  @ApiProperty({ type: String, format: "date-time", description: "UTC registration timestamp." })
  createdAt!: string;
}

export class AssessmentResultResponse {
  @ApiProperty({
    type: String,
    example: "nextjs-web-application",
    description: "Application profile derived from committed repository manifests.",
  })
  profile!: string;

  @ApiProperty({
    type: [String],
    example: [],
    description: "Machine-produced readiness findings; empty when no findings are produced.",
  })
  findings!: string[];

  @ApiProperty({ type: [String], description: "Supported manifests detected at the repository root." })
  manifests!: string[];

  @ApiProperty({ type: [String], description: "Technology identifiers derived from committed manifests." })
  detectedStack!: string[];
}

export class AssessmentResponse {
  @ApiProperty({ type: String, format: "uuid", description: "Assessment identifier used for status polling." })
  id!: string;

  @ApiProperty({ type: String, description: "Owning VCP company identifier.", example: "company-a" })
  companyId!: string;

  @ApiProperty({ type: String, format: "uuid", description: "Application being assessed." })
  applicationId!: string;

  @ApiProperty({ type: String, format: "uri", description: "Repository URL copied from the registered application when queued." })
  repositoryUrl!: string;

  @ApiProperty({ type: String, description: "Immutable source commit assessed by the worker." })
  sourceRevision!: string;

  @ApiProperty({ type: String, description: "Idempotency key accepted for this assessment." })
  idempotencyKey!: string;

  @ApiProperty({
    type: String,
    description: "Correlation identifier retained from submission through worker audit events.",
    example: "01J5VCPASSESSMENT",
  })
  correlationId!: string;

  @ApiProperty({
    type: String,
    enum: ["queued", "running", "completed", "failed"],
    enumName: "AssessmentStatus",
    example: "queued",
    description: "Asynchronous lifecycle state. Completed and failed are terminal.",
  })
  status!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 0,
    description: "Number of worker claims, including recovery claims after a stale lock.",
  })
  attempts!: number;

  @ApiPropertyOptional({
    type: () => AssessmentResultResponse,
    description: "Present only when status is completed.",
  })
  result?: AssessmentResultResponse;

  @ApiPropertyOptional({
    type: String,
    description: "Safe failure summary present only when status is failed.",
    example: "Assessment worker could not process the request",
  })
  error?: string;

  @ApiProperty({ type: String, format: "date-time", description: "UTC submission timestamp." })
  createdAt!: string;

  @ApiPropertyOptional({
    type: String,
    format: "date-time",
    description: "UTC timestamp of the most recent worker claim.",
  })
  startedAt?: string;

  @ApiPropertyOptional({
    type: String,
    format: "date-time",
    description: "UTC timestamp when the assessment entered a terminal state.",
  })
  completedAt?: string;
}

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("Vibe Coding Platform Control Plane")
    .setDescription("Architecture-spike contract for company-scoped application registration and asynchronous assessment.")
    .setVersion("0.1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Verified identity-provider access token. The local spike token is not for production use.",
      },
      "bearer",
    )
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) => `${controller}_${method}`,
  });
}

export function configureOpenApi(app: INestApplication): void {
  SwaggerModule.setup("docs", app, () => createOpenApiDocument(app), {
    jsonDocumentUrl: "openapi.json",
    yamlDocumentUrl: "openapi.yaml",
    customSiteTitle: "VCP Control Plane API",
  });
}
