import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MemorySession } from "../portal/src/auth-session.js";

describe("portal browser credential boundary", () => {
  it("keeps the access token in memory and clears it on sign-out", () => {
    const session = new MemorySession();
    session.signIn({ subject: "user", accessToken: "synthetic-token", role: "company-user", companyId: "company-a" });
    expect(session.value()).toMatchObject({ accessToken: "synthetic-token" });
    session.signOut();
    expect(session.value()).toBeUndefined();
  });

  it("keeps tokens in memory while limiting session storage to PKCE state", async () => {
    const sources = await Promise.all(
      ["auth-session.ts", "api.ts", "main.tsx", "oidc.ts"].map((name) =>
        readFile(new URL(`../portal/src/${name}`, import.meta.url), "utf8"),
      ),
    );
    expect(sources.join("\n")).not.toMatch(/localStorage|indexedDB/i);
    expect(sources.join("\n")).toContain("userStore: memoryUserStore");
    expect(sources.join("\n")).toContain("store: window.sessionStorage");
  });
});
