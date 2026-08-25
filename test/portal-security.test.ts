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

  it("contains no browser persistence API usage", async () => {
    const sources = await Promise.all(
      ["auth-session.ts", "api.ts", "main.tsx"].map((name) =>
        readFile(new URL(`../portal/src/${name}`, import.meta.url), "utf8"),
      ),
    );
    expect(sources.join("\n")).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
  });
});
