import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  AuthenticationError,
  IdentityConfigurationError,
  type AccessTokenVerifier,
  type VerifiedIdentity,
} from "./identity.js";

interface ProviderMetadata {
  readonly issuer?: unknown;
  readonly jwks_uri?: unknown;
}

export interface OidcVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly allowHttp?: boolean;
  readonly discoveryUrl?: string;
}

export class OidcAccessTokenVerifier implements AccessTokenVerifier {
  private constructor(
    private readonly issuer: string,
    private readonly audience: string,
    jwksUrl: URL,
  ) {
    this.jwks = createRemoteJWKSet(jwksUrl, {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }

  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  static async create(config: OidcVerifierConfig): Promise<OidcAccessTokenVerifier> {
    const issuer = new URL(config.issuer);
    if (issuer.protocol !== "https:" && !config.allowHttp) {
      throw new IdentityConfigurationError("OIDC issuer must use HTTPS");
    }
    const discoveryUrl = new URL(
      config.discoveryUrl ?? `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    );
    let metadata: ProviderMetadata;
    try {
      const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`Discovery returned ${response.status}`);
      metadata = (await response.json()) as ProviderMetadata;
    } catch (error) {
      throw new IdentityConfigurationError(
        `OIDC discovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (metadata.issuer !== config.issuer || typeof metadata.jwks_uri !== "string") {
      throw new IdentityConfigurationError("OIDC discovery metadata is not trusted");
    }
    const jwksUrl = new URL(metadata.jwks_uri);
    if (jwksUrl.origin !== issuer.origin || (jwksUrl.protocol !== "https:" && !config.allowHttp)) {
      throw new IdentityConfigurationError("OIDC JWKS endpoint is not trusted");
    }
    return new OidcAccessTokenVerifier(config.issuer, config.audience, jwksUrl);
  }

  async verify(header: string | undefined): Promise<VerifiedIdentity> {
    if (!header?.startsWith("Bearer ")) throw new AuthenticationError();
    const token = header.slice("Bearer ".length).trim();
    if (!token) throw new AuthenticationError();
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "iat", "exp"],
        clockTolerance: 5,
        maxTokenAge: "15 minutes",
      });
      if (!payload.sub) throw new AuthenticationError();
      return { issuer: this.issuer, subject: payload.sub };
    } catch {
      throw new AuthenticationError("Bearer token could not be verified");
    }
  }
}
