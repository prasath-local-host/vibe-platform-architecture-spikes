import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/domain.js";
import {
  AuthenticationError,
  IdentityConfigurationError,
  IdentityService,
  InMemoryAuthorizationRepository,
  parseSpikeGrants,
  parsePrivilegedAuthenticationContexts,
  SpikeAccessTokenVerifier,
  type AccessTokenVerifier,
} from "../src/identity.js";

class FixedVerifier implements AccessTokenVerifier {
  constructor(private readonly subject: string, private readonly authenticationContext?: string) {}
  async verify() {
    return {
      issuer: "https://identity.example.test",
      subject: this.subject,
      ...(this.authenticationContext ? { authenticationContext: this.authenticationContext } : {}),
    };
  }
}

describe("identity integration boundary", () => {
  it("derives company access from stored grants rather than request claims", async () => {
    const identity = new IdentityService(
      new FixedVerifier("user-a"),
      new InMemoryAuthorizationRepository([
        { subject: "user-a", companyId: "company-a" },
      ]),
    );

    await expect(identity.resolveActor("Bearer ignored", "company-a")).resolves.toEqual({
      subject: "user-a",
      role: "company-user",
      companyId: "company-a",
    });
    await expect(
      identity.resolveActor("Bearer ignored", "company-b"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps platform operator grants separate from company membership", async () => {
    const identity = new IdentityService(
      new FixedVerifier("operator-a"),
      new InMemoryAuthorizationRepository([
        { subject: "operator-a", platformOperator: true },
      ]),
    );

    await expect(identity.resolveActor("Bearer ignored", "company-b")).resolves.toEqual({
      subject: "operator-a",
      role: "operator",
    });
  });

  it("rejects a platform operator without an approved MFA assurance context", async () => {
    const authorization = new InMemoryAuthorizationRepository([
      { subject: "operator-a", platformOperator: true },
    ]);
    const identity = new IdentityService(
      new FixedVerifier("operator-a", "password-only"),
      authorization,
      ["mfa"],
    );
    await expect(identity.resolveActor("Bearer ignored", "company-a")).rejects.toThrow(
      "Privileged authentication assurance is required",
    );
  });

  it("accepts a platform operator with an approved MFA assurance context", async () => {
    const identity = new IdentityService(
      new FixedVerifier("operator-a", "mfa"),
      new InMemoryAuthorizationRepository([{ subject: "operator-a", platformOperator: true }]),
      ["mfa"],
    );
    await expect(identity.resolveActor("Bearer ignored", "company-a")).resolves.toEqual({
      subject: "operator-a",
      role: "operator",
    });
  });

  it("parses the configured privileged assurance allow-list", () => {
    expect(parsePrivilegedAuthenticationContexts("mfa, urn:example:loa:2, ")).toEqual([
      "mfa",
      "urn:example:loa:2",
    ]);
  });

  it("does not promote a company member to platform operator", async () => {
    const authorization = new InMemoryAuthorizationRepository([
      { subject: "company-admin", companyId: "company-a" },
    ]);
    expect(await authorization.isPlatformOperator("company-admin")).toBe(false);
  });

  it("does not treat a platform operator grant as a company membership", async () => {
    const authorization = new InMemoryAuthorizationRepository([
      { subject: "operator-a", platformOperator: true },
    ]);
    expect(
      await authorization.hasCompanyAccess("operator-a", "company-a"),
    ).toBe(false);
  });

  it("rejects disabled grants", async () => {
    const identity = new IdentityService(
      new FixedVerifier("disabled-user"),
      new InMemoryAuthorizationRepository([
        { subject: "disabled-user", companyId: "company-a", active: false },
      ]),
    );

    await expect(
      identity.resolveActor("Bearer ignored", "company-a"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the temporary verifier disabled unless explicitly enabled", async () => {
    await expect(
      new SpikeAccessTokenVerifier(false).verify("Bearer spike:user-a"),
    ).rejects.toBeInstanceOf(IdentityConfigurationError);
  });

  it("requires the bounded spike bearer format when enabled", async () => {
    const verifier = new SpikeAccessTokenVerifier(true);
    await expect(verifier.verify(undefined)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    await expect(verifier.verify("Bearer spike:user-a")).resolves.toEqual({
      issuer: "urn:vibe:local-spike",
      subject: "user-a",
    });
  });

  it("preserves explicit revocation in parsed local grants", async () => {
    const authorization = new InMemoryAuthorizationRepository(
      parseSpikeGrants(
        '[{"subject":"disabled-user","companyId":"company-a","active":false}]',
      ),
    );
    expect(
      await authorization.hasCompanyAccess("disabled-user", "company-a"),
    ).toBe(false);
  });
});
