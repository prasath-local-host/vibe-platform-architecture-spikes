import { describe, expect, it } from "vitest";
import { OidcAccessTokenVerifier } from "../src/oidc-access-token-verifier.js";

const issuer = process.env.TEST_OIDC_ISSUER;
const username = process.env.TEST_OIDC_USERNAME ?? "company-user";
const password = process.env.TEST_OIDC_PASSWORD ?? "local-demo-only";
const subject = process.env.TEST_OIDC_SUBJECT ?? "22222222-2222-4222-8222-222222222222";

describe.skipIf(!issuer)("Keycloak OIDC integration", () => {
  it("blocks password-only operator token issuance while MFA enrollment is required", async () => {
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "vibe-control-plane",
        username: "vibe-operator",
        password: "local-demo-only",
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("discovers Keycloak keys and verifies a provider-issued access token", async () => {
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "vibe-control-plane",
        username,
        password,
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
    await expect(verifier.verify(`Bearer ${payload.access_token}`)).resolves.toMatchObject({
      issuer,
      subject,
    });
  });
});
