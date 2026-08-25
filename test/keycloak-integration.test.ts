import { describe, expect, it } from "vitest";
import { OidcAccessTokenVerifier } from "../src/oidc-access-token-verifier.js";

const issuer = process.env.TEST_OIDC_ISSUER;

describe.skipIf(!issuer)("Keycloak OIDC integration", () => {
  it("discovers Keycloak keys and verifies a provider-issued access token", async () => {
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "vibe-control-plane",
        username: "vibe-operator",
        password: "local-demo-only",
        scope: "openid profile",
      }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { access_token: string };
    const verifier = await OidcAccessTokenVerifier.create({
      issuer: issuer!,
      audience: "vibe-control-plane",
      allowHttp: true,
    });
    await expect(verifier.verify(`Bearer ${payload.access_token}`)).resolves.toEqual({
      issuer,
      subject: "11111111-1111-4111-8111-111111111111",
    });
  });
});
