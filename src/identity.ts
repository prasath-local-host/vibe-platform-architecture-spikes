import type { Actor } from "./domain.js";
import { ForbiddenError } from "./domain.js";

export interface VerifiedIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly authenticationContext?: string;
  readonly authenticationMethods?: readonly string[];
}

export interface AccessTokenVerifier {
  verify(authorizationHeader: string | undefined): Promise<VerifiedIdentity>;
}

export interface AuthorizationRepository {
  isPlatformOperator(subject: string): Promise<boolean>;
  hasCompanyAccess(subject: string, companyId: string): Promise<boolean>;
}

export class AuthenticationError extends Error {
  constructor(message = "Authentication is required") {
    super(message);
  }
}

export class IdentityConfigurationError extends Error {
  constructor(message = "No production identity provider is configured") {
    super(message);
  }
}

export class IdentityService {
  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly authorization: AuthorizationRepository,
    private readonly privilegedAuthenticationContexts: readonly string[] = [],
  ) {}

  async resolveActor(
    authorizationHeader: string | undefined,
    companyId: string,
  ): Promise<Actor> {
    const identity = await this.verifier.verify(authorizationHeader);
    if (await this.authorization.isPlatformOperator(identity.subject)) {
      if (
        this.privilegedAuthenticationContexts.length > 0 &&
        (!identity.authenticationContext ||
          !this.privilegedAuthenticationContexts.includes(identity.authenticationContext))
      ) {
        throw new AuthenticationError("Privileged authentication assurance is required");
      }
      return { subject: identity.subject, role: "operator" };
    }
    if (await this.authorization.hasCompanyAccess(identity.subject, companyId)) {
      return {
        subject: identity.subject,
        role: "company-user",
        companyId,
      };
    }
    throw new ForbiddenError();
  }
}

export function parsePrivilegedAuthenticationContexts(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

export class SpikeAccessTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly enabled: boolean) {}

  async verify(header: string | undefined): Promise<VerifiedIdentity> {
    if (!this.enabled) throw new IdentityConfigurationError();
    if (!header?.startsWith("Bearer spike:")) throw new AuthenticationError();
    const subject = header.slice("Bearer spike:".length).trim();
    if (!subject || subject.length > 255) throw new AuthenticationError();
    return { issuer: "urn:vibe:local-spike", subject };
  }
}

export interface InMemoryGrant {
  readonly subject: string;
  readonly companyId?: string;
  readonly platformOperator?: boolean;
  readonly active?: boolean;
}

export class InMemoryAuthorizationRepository
  implements AuthorizationRepository
{
  constructor(private readonly grants: readonly InMemoryGrant[]) {}

  async isPlatformOperator(subject: string): Promise<boolean> {
    return this.grants.some(
      (grant) =>
        grant.subject === subject &&
        grant.platformOperator === true &&
        grant.active !== false,
    );
  }

  async hasCompanyAccess(
    subject: string,
    companyId: string,
  ): Promise<boolean> {
    return this.grants.some(
      (grant) =>
        grant.subject === subject &&
        grant.companyId === companyId &&
        grant.active !== false,
    );
  }
}

export function parseSpikeGrants(value: string | undefined): InMemoryGrant[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new IdentityConfigurationError();
  return parsed.flatMap((entry): InMemoryGrant[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.subject !== "string") return [];
    const active = record.active !== false;
    if (record.platformOperator === true) {
      return [{ subject: record.subject, platformOperator: true, active }];
    }
    if (typeof record.companyId === "string") {
      return [{ subject: record.subject, companyId: record.companyId, active }];
    }
    return [];
  });
}
