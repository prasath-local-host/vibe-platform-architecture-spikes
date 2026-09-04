# Vibe Platform Architecture Spikes

Evidence-producing experiments for the Vibe Coding Platform architecture. This repository contains no customer application code, data or credentials.

## Current work

`VIBE-2` validates the smallest control-plane vertical slice. The current checkpoint proves company-scoped authorization, transactionally idempotent PostgreSQL writes, a restart-safe asynchronous assessment queue, and attributable audit evidence. Synthetic request headers are deliberately temporary; federated identity remains required before the spike can reach a decision.

## Run

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
docker compose up -d postgres
pnpm db:migrate
TEST_DATABASE_URL=postgres://vibe:vibe-development-only@localhost:5432/vibe_control pnpm test
pnpm dev
```

The API binds to `127.0.0.1:3000`. The minimal React control portal is available at `http://127.0.0.1:3000/portal/`. Never expose the synthetic-header authentication mechanism beyond the local spike environment.

OpenAPI is generated from the running NestJS application. The local Swagger UI is available at `http://127.0.0.1:3000/docs`, with machine-readable JSON at `/openapi.json` and YAML at `/openapi.yaml`.
Run `pnpm openapi:generate` to refresh the committed `openapi.json` contract after changing routes or schemas.

Run `pnpm architecture:check` to enforce inward module dependencies and verify the committed [architecture dependency report](docs/vibe-2-architecture-dependency-report.md). Refresh the report with `pnpm architecture:generate` after an intentional module change.

Without `DATABASE_URL`, the API uses the in-memory adapter for local unit-level exploration. With `DATABASE_URL`, startup applies the versioned Kysely migrations and uses PostgreSQL. Registration inserts the application and audit event in one transaction; the unique `(company_id, idempotency_key)` constraint is the final concurrency boundary.

## Minimal asynchronous assessment

Submit work with `POST /companies/:companyId/applications/:applicationId/assessments` and an `idempotencyKey` body. The API returns HTTP 202 with a `queued` assessment. Use `GET` on the collection or `GET .../assessments/:assessmentId` to observe progress.

The embedded worker claims rows with PostgreSQL `FOR UPDATE SKIP LOCKED`, processes at most ten per cycle, and records correlated completion or failure audit evidence. Queued work survives process restarts; running work becomes claimable again after five minutes. Set `ASSESSMENT_WORKER_ENABLED=false` when a process should serve only HTTP traffic, or give a worker a stable `ASSESSMENT_WORKER_ID` for diagnostics. The bounded assessment engine inspects supported manifests only; dependency scanning and repository-code execution are later isolation-boundary decisions.

Assessments are pinned to an immutable 40-character Git commit SHA and retain the registered repository URL at queue time. Set `GITHUB_SOURCE_ENABLED=true` to enable the bounded GitHub adapter. It accepts credential-free `https://github.com/<owner>/<repository>` URLs only, performs a shallow partial sparse checkout of supported root manifests, verifies the resulting commit, enforces a one-megabyte manifest limit by default, and always deletes its temporary checkout. `GITHUB_TOKEN` is optional for public repositories and is passed to Git through process environment configuration rather than URLs or arguments. `GITHUB_CHECKOUT_TIMEOUT_MS` and `GITHUB_MANIFEST_BYTE_LIMIT` configure the limits. The manifest engine currently detects Node.js, React, Next.js and NestJS and reports missing build/test scripts, lockfiles and Dockerfiles; it does not execute repository code.

The build-execution adapter accepts an explicit bounded file set and runs only `build` or `test` package scripts in a disposable Docker workspace. It requires a digest-pinned image and applies `--network none`, a read-only container root, a non-root UID, dropped Linux capabilities, `no-new-privileges`, PID/CPU/memory limits, a bounded temporary filesystem, timeout and output limits. No customer secret is injected. Dependency restoration and the handoff from a full source artifact are intentionally not wired yet; both require a separate controlled-egress and artifact-integrity decision.

## Identity boundary

The control plane separates authentication from authorization:

1. An `AccessTokenVerifier` adapter verifies issuer, signature, audience, expiry and subject for the selected identity provider.
2. VCP uses only the verified issuer/subject as the external identity key.
3. An `AuthorizationRepository` loads active platform roles and company memberships from VCP-controlled storage.
4. `IdentityService` derives the actor for the requested company. Tenant identifiers or privileged roles supplied by the browser or untrusted token claims are not accepted as authorization.

The production-shaped adapter discovers the configured OpenID Connect provider, pins the discovered issuer and same-origin JWKS endpoint, and validates RS256 signature, issuer, audience, subject, issued-at and expiry. Configure `OIDC_ISSUER_URL` and `OIDC_AUDIENCE`; non-HTTPS issuers require the explicit local-only `OIDC_ALLOW_HTTP=true` override.

Platform operators can be held to a higher authentication-assurance level with `PRIVILEGED_AUTHENTICATION_CONTEXTS`, a comma-separated allow-list of signed OIDC `acr` values. When configured, an operator token without an approved context is rejected with `401`; company membership alone does not trigger this privileged policy. The production values must be agreed with the selected identity provider and backed by an MFA enrollment and recovery policy.

The React portal uses a backend-for-frontend session. Fastify owns Authorization Code with PKCE, the code exchange and provider tokens. The browser receives only an HTTP-only, same-site session cookie and a non-secret CSRF value. Production cookies use the `Secure` attribute and `__Host-` prefix; the local HTTP fixture uses an explicitly development-only cookie name.

For prompt provider revocation, configure the BFF as a confidential client with `OIDC_CLIENT_SECRET` and set `OIDC_INTROSPECTION_ENABLED=true`. The BFF introspects its server-held token before honoring a browser session. An inactive token, failed introspection or unavailable provider fails closed with `401`, deletes the local session and expires the browser cookie. Client secrets must come from secret management; the value in the imported local realm is synthetic only.

The included `SpikeAccessTokenVerifier` accepts only `Authorization: Bearer spike:<subject>` and is disabled by default. It remains a fallback for isolated tests only. For an in-memory local run, grants can be supplied explicitly:

```powershell
$env:SPIKE_IDENTITY_ENABLED = "true"
$env:SPIKE_IDENTITY_GRANTS = '[{"subject":"user-a","companyId":"company-a"},{"subject":"operator-a","platformOperator":true}]'
pnpm dev
```

When PostgreSQL is configured, authorization comes from `company_memberships` and `platform_roles`; the environment grant list and token role claims are ignored. The local Keycloak realm is available through `docker compose up -d keycloak`; its synthetic accounts and development credentials must never be reused outside the spike.

## Source documents

- [Architecture Validation Spike Plan](https://local-host.atlassian.net/wiki/spaces/VCP/pages/224296961/Vibe+Coding+Platform+Architecture+Validation+Spike+Plan)
- [VIBE-2](https://local-host.atlassian.net/browse/VIBE-2)
