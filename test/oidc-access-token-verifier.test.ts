import { createServer, type Server } from "node:http";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthenticationError, IdentityConfigurationError } from "../src/identity.js";
import { OidcAccessTokenVerifier } from "../src/oidc-access-token-verifier.js";

describe("OpenID Connect access-token verification", () => {
  let server: Server;
  let issuer: string;
  let privateKey: CryptoKey;
  let otherPrivateKey: CryptoKey;
  let publicJwk: JWK;

  beforeAll(async () => {
    ({ privateKey: otherPrivateKey } = await generateKeyPair("RS256", { extractable: true }));
    const matchingPair = await generateKeyPair("RS256", { extractable: true });
    privateKey = matchingPair.privateKey;
    publicJwk = { ...(await exportJWK(matchingPair.publicKey)), alg: "RS256", kid: "vibe-test", use: "sig" };

    server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/issuer/.well-known/openid-configuration") {
        response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      } else if (request.url === "/issuer/jwks") {
        response.end(JSON.stringify({ keys: [publicJwk] }));
      } else {
        response.statusCode = 404;
        response.end("{}");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    issuer = `http://127.0.0.1:${address.port}/issuer`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function token(options: {
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    key?: CryptoKey;
    kid?: string;
    acr?: string;
    amr?: string[];
  } = {}) {
    return new SignJWT({
      ...(options.acr ? { acr: options.acr } : {}),
      ...(options.amr ? { amr: options.amr } : {}),
    })
      .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "vibe-test" })
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? "vibe-control-plane")
      .setSubject("verified-subject")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5 minutes")
      .sign(options.key ?? privateKey);
  }

  async function verifier() {
    return OidcAccessTokenVerifier.create({ issuer, audience: "vibe-control-plane", allowHttp: true });
  }

  it("discovers a trusted JWKS and verifies issuer, audience, signature, expiry and subject", async () => {
    await expect((await verifier()).verify(`Bearer ${await token()}`)).resolves.toEqual({
      issuer,
      subject: "verified-subject",
    });
  });

  it("maps only cryptographically verified authentication assurance claims", async () => {
    await expect(
      (await verifier()).verify(`Bearer ${await token({ acr: "mfa", amr: ["pwd", "otp"] })}`),
    ).resolves.toEqual({
      issuer,
      subject: "verified-subject",
      authenticationContext: "mfa",
      authenticationMethods: ["pwd", "otp"],
    });
  });

  it.each([
    ["wrong issuer", () => token({ issuer: `${issuer}/other` })],
    ["wrong audience", () => token({ audience: "other-api" })],
    ["expired token", () => token({ expiresIn: "-1 minute" })],
    ["wrong signature", () => token({ key: otherPrivateKey })],
  ])("rejects a %s", async (_name, makeToken) => {
    await expect((await verifier()).verify(`Bearer ${await makeToken()}`)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects missing and malformed bearer credentials", async () => {
    const configured = await verifier();
    await expect(configured.verify(undefined)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(configured.verify("Bearer not-a-jwt")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects HTTP providers unless explicitly enabled for a local spike", async () => {
    await expect(OidcAccessTokenVerifier.create({ issuer, audience: "vibe-control-plane" })).rejects.toBeInstanceOf(IdentityConfigurationError);
  });
});
