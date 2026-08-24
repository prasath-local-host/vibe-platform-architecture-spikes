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
    example: "placeholder-web-application",
    description: "Detected application profile. This spike currently returns a placeholder profile.",
  })
  profile!: string;

  @ApiProperty({
    type: [String],
    example: [],
    description: "Machine-produced readiness findings; empty when no findings are produced.",
  })
  findings!: string[];
}

export class AssessmentResponse {
  @ApiProperty({ type: String, format: "uuid", description: "Assessment identifier used for status polling." })
  id!: string;

  @ApiProperty({ type: String, description: "Owning VCP company identifier.", example: "company-a" })
  companyId!: string;

  @ApiProperty({ type: String, format: "uuid", description: "Application being assessed." })
  applicationId!: string;

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
