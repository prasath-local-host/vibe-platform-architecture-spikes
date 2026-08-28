import { describe, expect, it } from "vitest";
import { OidcAccessTokenVerifier } from "../src/oidc-access-token-verifier.js";

const issuer = process.env.TEST_OIDC_ISSUER;
const username = process.env.TEST_OIDC_USERNAME ?? "company-user";
const password = process.env.TEST_OIDC_PASSWORD ?? "local-demo-only";
const subject = process.env.TEST_OIDC_SUBJECT ?? "22222222-2222-4222-8222-222222222222";
const clientSecret = process.env.TEST_OIDC_CLIENT_SECRET ?? "local-bff-client-only";

describe.skipIf(!issuer)("Keycloak OIDC integration", () => {
  it("blocks password-only operator token issuance while MFA enrollment is required", async () => {
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "vibe-control-plane",
        client_secret: clientSecret,
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
        client_secret: clientSecret,
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

  it("marks an existing access token inactive when its provider account is disabled", async () => {
    const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "vibe-control-plane",
        client_secret: clientSecret,
        username,
        password,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const { access_token: accessToken } = await tokenResponse.json() as { access_token: string };

    const adminResponse = await fetch(`${issuer!.replace("/realms/vibe", "/realms/master")}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: process.env.TEST_KEYCLOAK_ADMIN_USERNAME ?? "admin",
        password: process.env.TEST_KEYCLOAK_ADMIN_PASSWORD ?? "local-development-only",
      }),
    });
    expect(adminResponse.status).toBe(200);
    const { access_token: adminToken } = await adminResponse.json() as { access_token: string };
    const userUrl = `${issuer!.replace("/realms/vibe", "")}/admin/realms/vibe/users/${subject}`;
    const setEnabled = (enabled: boolean) => fetch(userUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    try {
      expect((await setEnabled(false)).status).toBe(204);
      const introspection = await fetch(`${issuer}/protocol/openid-connect/token/introspect`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`vibe-control-plane:${clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: accessToken }),
      });
      expect(introspection.status).toBe(200);
      await expect(introspection.json()).resolves.toMatchObject({ active: false });
    } finally {
      expect((await setEnabled(true)).status).toBe(204);
    }
  });
});
