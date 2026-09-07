import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MemorySession } from "../portal/src/auth-session.js";

describe("portal browser credential boundary", () => {
  it("keeps only non-secret display context in portal memory", () => {
    const session = new MemorySession();
    session.signIn({ subject: "user", displayName: "Test user", role: "company-user", companyId: "company-a" });
    expect(session.value()).toMatchObject({ subject: "user", displayName: "Test user" });
    session.signOut();
    expect(session.value()).toBeUndefined();
  });

  it("keeps provider tokens and OIDC processing out of browser code", async () => {
    const sources = await Promise.all(
      ["auth-session.ts", "api.ts", "main.tsx"].map((name) =>
        readFile(new URL(`../portal/src/${name}`, import.meta.url), "utf8"),
      ),
    );
    const source = sources.join("\n");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|oidc-client-ts/i);
    expect(source).not.toContain("accessToken");
    expect(source).toContain('window.location.assign("/auth/login")');
    expect(source).toContain('"x-csrf-token": csrfToken');
  });

  it("requires the backend session and CSRF boundary", async () => {
    const source = await readFile(new URL("../src/browser-session.ts", import.meta.url), "utf8");
    expect(source).toContain('sameSite: "Strict" | "Lax" = "Strict"');
    expect(source).toContain("HttpOnly; SameSite=${sameSite}");
    expect(source).toContain('cookie(stateCookie, state, 300, config.secure, "Lax")');
    expect(source).toContain('config.secure ? "__Host-vcp_session" : "vcp_session"');
    expect(source).toContain("code_challenge_method: \"S256\"");
    expect(source).toContain('request.headers["x-csrf-token"]');
    expect(source).toContain('request.headers.authorization = `Bearer ${session.accessToken}`');
    expect(source).toContain("OIDC_INTROSPECTION_ENABLED");
    expect(source).toContain("providerSessionIsActive(session)");
    expect(source).toContain('sessions.delete(id!)');
  });

  it("offers fresh authentication and does not claim unmeasured worker health", async () => {
    const portal = await readFile(new URL("../portal/src/main.tsx", import.meta.url), "utf8");
    const api = await readFile(new URL("../portal/src/api.ts", import.meta.url), "utf8");
    const bff = await readFile(new URL("../src/browser-session.ts", import.meta.url), "utf8");
    expect(portal).not.toContain('demo-company');
    expect(portal).not.toContain('PostgreSQL and worker online');
    expect(portal).toContain('Not monitored');
    expect(portal).toContain('Verify identity');
    expect(api).toContain('/auth/login?reauthenticate=true');
    expect(bff).toContain('url.searchParams.set("prompt", "login")');
    expect(bff).toContain('url.searchParams.set("max_age", "0")');
  });
});
