import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/domain.js";
import {
  AuthenticationError,
  IdentityConfigurationError,
  IdentityService,
  InMemoryAuthorizationRepository,
  parseSpikeGrants,
  parseStepUpAuthenticationContexts,
  parseStepUpAuthenticationMethods,
  SpikeAccessTokenVerifier,
  type AccessTokenVerifier,
} from "../src/identity.js";

class FixedVerifier implements AccessTokenVerifier {
  constructor(
    private readonly subject: string,
    private readonly authenticationContext?: string,
    private readonly authenticationMethods?: readonly string[],
  ) {}
  async verify() {
    return {
      issuer: "https://identity.example.test",
      subject: this.subject,
      ...(this.authenticationContext ? { authenticationContext: this.authenticationContext } : {}),
      ...(this.authenticationMethods ? { authenticationMethods: this.authenticationMethods } : {}),
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

  it("allows an operator read without step-up authentication", async () => {
    const authorization = new InMemoryAuthorizationRepository([
      { subject: "operator-a", platformOperator: true },
    ]);
    const identity = new IdentityService(
      new FixedVerifier("operator-a", "password-only"),
      authorization,
      ["mfa"],
    );
    await expect(identity.resolveActor("Bearer ignored", "company-a")).resolves.toEqual({
      subject: "operator-a",
      role: "operator",
    });
  });

  it("rejects a sensitive operation without approved step-up assurance", async () => {
    const identity = new IdentityService(
      new FixedVerifier("operator-a", "password-only", ["pwd"]),
      new InMemoryAuthorizationRepository([{ subject: "operator-a", platformOperator: true }]),
      ["mfa"],
      ["otp"],
    );
    await expect(
      identity.resolveActor("Bearer ignored", "company-a", {
        sensitiveAction: "company.access.change",
      }),
    ).rejects.toThrow("Step-up authentication is required for company.access.change");
    await expect(
      identity.resolveActor("Bearer ignored", "company-a", {
        sensitiveAction: "build.submit",
      }),
    ).rejects.toThrow("Step-up authentication is required for build.submit");
  });

  it("accepts a sensitive operation with an approved MFA method", async () => {
    const identity = new IdentityService(
      new FixedVerifier("operator-a", "password-only", ["pwd", "otp"]),
      new InMemoryAuthorizationRepository([{ subject: "operator-a", platformOperator: true }]),
      ["mfa"],
      ["otp"],
    );
    await expect(identity.resolveActor("Bearer ignored", "company-a", {
      sensitiveAction: "company.access.change",
    })).resolves.toEqual({
      subject: "operator-a",
      role: "operator",
    });
  });

  it("fails closed when a sensitive-operation step-up policy is absent", async () => {
    const identity = new IdentityService(
      new FixedVerifier("user-a", "mfa", ["otp"]),
      new InMemoryAuthorizationRepository([{ subject: "user-a", companyId: "company-a" }]),
    );
    await expect(
      identity.resolveActor("Bearer ignored", "company-a", {
        sensitiveAction: "application.register",
      }),
    ).rejects.toBeInstanceOf(IdentityConfigurationError);
  });

  it("parses the configured privileged assurance allow-list", () => {
    expect(parseStepUpAuthenticationContexts("mfa, urn:example:loa:2, ")).toEqual([
      "mfa",
      "urn:example:loa:2",
    ]);
  });

  it("parses the configured step-up authentication methods", () => {
    expect(parseStepUpAuthenticationMethods("pwd, otp, ")).toEqual(["pwd", "otp"]);
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
      authenticationContext: "urn:vibe:local-spike:mfa",
      authenticationMethods: ["pwd", "otp"],
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
