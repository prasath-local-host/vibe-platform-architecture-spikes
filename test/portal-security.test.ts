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
    expect(source).toContain("HttpOnly; SameSite=Strict");
    expect(source).toContain('config.secure ? "__Host-vcp_session" : "vcp_session"');
    expect(source).toContain("code_challenge_method: \"S256\"");
    expect(source).toContain('request.headers["x-csrf-token"]');
    expect(source).toContain('request.headers.authorization = `Bearer ${session.accessToken}`');
  });
});
