import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { OidcAccessTokenVerifier } from "./oidc-access-token-verifier.js";

interface BrowserSession {
  readonly accessToken: string;
  readonly subject: string;
  readonly displayName: string;
  readonly csrfToken: string;
  readonly expiresAt: number;
}

interface PendingLogin {
  readonly verifier: string;
  readonly expiresAt: number;
}

const sessions = new Map<string, BrowserSession>();
const pendingLogins = new Map<string, PendingLogin>();

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function cookies(request: FastifyRequest): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator < 1 ? [] : [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1))]];
  }));
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function configured(): { issuer: string; clientId: string; clientSecret?: string; secure: boolean } | undefined {
  const issuer = process.env.OIDC_ISSUER_URL?.replace(/\/$/, "");
  const clientId = process.env.OIDC_CLIENT_ID ?? process.env.OIDC_AUDIENCE;
  if (!issuer || !clientId) return undefined;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  return { issuer, clientId, ...(clientSecret ? { clientSecret } : {}), secure: process.env.NODE_ENV === "production" };
}

export async function registerBrowserSessions(server: FastifyInstance): Promise<void> {
  const config = configured();
  if (!config) return;
  const sessionCookie = config.secure ? "__Host-vcp_session" : "vcp_session";
  const stateCookie = config.secure ? "__Host-vcp_oidc_state" : "vcp_oidc_state";
  const discovery = await fetch(`${config.issuer}/.well-known/openid-configuration`);
  if (!discovery.ok) throw new Error("OIDC discovery failed for browser sessions");
  const metadata = await discovery.json() as { authorization_endpoint: string; token_endpoint: string; end_session_endpoint?: string };
  const verifier = await OidcAccessTokenVerifier.create({ issuer: config.issuer, audience: process.env.OIDC_AUDIENCE ?? config.clientId, allowHttp: process.env.OIDC_ALLOW_HTTP === "true" });

  server.get("/auth/login", async (_request, reply) => {
    const now = Date.now();
    for (const [key, value] of pendingLogins) if (value.expiresAt < now) pendingLogins.delete(key);
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    pendingLogins.set(state, { verifier, expiresAt: Date.now() + 5 * 60_000 });
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = `${process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000"}/auth/callback`;
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid profile email", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    return reply.header("set-cookie", cookie(stateCookie, state, 300, config.secure)).redirect(url.toString());
  });

  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/callback", async (request, reply) => {
    const { code, state, error } = request.query;
    const pending = state ? pendingLogins.get(state) : undefined;
    if (state) pendingLogins.delete(state);
    if (error || !code || !state || !pending || pending.expiresAt < Date.now() || !safeEqual(cookies(request)[stateCookie], state)) return reply.code(401).send({ message: "OIDC callback validation failed" });
    const redirectUri = `${process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000"}/auth/callback`;
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, code, code_verifier: pending.verifier, redirect_uri: redirectUri });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
    const exchanged = await fetch(metadata.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!exchanged.ok) return reply.code(401).send({ message: "OIDC code exchange failed" });
    const tokens = await exchanged.json() as { access_token: string; expires_in?: number };
    const verified = await verifier.verify(`Bearer ${tokens.access_token}`);
    const payload = JSON.parse(Buffer.from(tokens.access_token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; name?: string; preferred_username?: string };
    if (!payload.sub || payload.sub !== verified.subject) return reply.code(401).send({ message: "OIDC subject is missing" });
    const id = base64url(randomBytes(32));
    const lifetime = Math.min(tokens.expires_in ?? 300, 900);
    sessions.set(id, { accessToken: tokens.access_token, subject: payload.sub, displayName: payload.name ?? payload.preferred_username ?? payload.sub, csrfToken: base64url(randomBytes(32)), expiresAt: Date.now() + lifetime * 1000 });
    return reply.header("set-cookie", [cookie(sessionCookie, id, lifetime, config.secure), cookie(stateCookie, "", 0, config.secure)]).redirect("/portal/");
  });

  server.get("/auth/session", async (request, reply) => {
    const id = cookies(request)[sessionCookie];
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      if (id) sessions.delete(id);
      return reply.code(401).send({ message: "Authentication is required" });
    }
    return reply.header("cache-control", "no-store").send({ subject: session.subject, displayName: session.displayName, csrfToken: session.csrfToken });
  });

  server.post("/auth/logout", async (request, reply) => {
    const id = cookies(request)[sessionCookie];
    const session = id ? sessions.get(id) : undefined;
    if (!session || !safeEqual(request.headers["x-csrf-token"] as string | undefined, session.csrfToken)) return reply.code(403).send({ message: "CSRF validation failed" });
    sessions.delete(id!);
    const logoutUrl = metadata.end_session_endpoint ? `${metadata.end_session_endpoint}?${new URLSearchParams({ client_id: config.clientId, post_logout_redirect_uri: `${process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000"}/portal/` })}` : "/portal/";
    return reply.header("set-cookie", cookie(sessionCookie, "", 0, config.secure)).send({ logoutUrl });
  });

  server.addHook("onRequest", (request, reply, done) => {
    if (request.url.startsWith("/auth/")) return done();
    const id = cookies(request)[sessionCookie];
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      if (id) sessions.delete(id);
      return done();
    }
    request.headers.authorization = `Bearer ${session.accessToken}`;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !safeEqual(request.headers["x-csrf-token"] as string | undefined, session.csrfToken)) {
      void reply.code(403).send({ message: "CSRF validation failed" });
      return;
    }
    done();
  });
}
