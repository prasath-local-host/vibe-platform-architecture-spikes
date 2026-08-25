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

The embedded worker claims rows with PostgreSQL `FOR UPDATE SKIP LOCKED`, processes at most ten per cycle, and records correlated completion or failure audit evidence. Queued work survives process restarts; running work becomes claimable again after five minutes. Set `ASSESSMENT_WORKER_ENABLED=false` when a process should serve only HTTP traffic, or give a worker a stable `ASSESSMENT_WORKER_ID` for diagnostics. The assessment result is intentionally a placeholder—the spike validates the delivery boundary, not a production analysis engine.

## Identity boundary

The control plane separates authentication from authorization:

1. An `AccessTokenVerifier` adapter verifies issuer, signature, audience, expiry and subject for the selected identity provider.
2. VCP uses only the verified issuer/subject as the external identity key.
3. An `AuthorizationRepository` loads active platform roles and company memberships from VCP-controlled storage.
4. `IdentityService` derives the actor for the requested company. Tenant identifiers or privileged roles supplied by the browser or untrusted token claims are not accepted as authorization.

The production-shaped adapter discovers the configured OpenID Connect provider, pins the discovered issuer and same-origin JWKS endpoint, and validates RS256 signature, issuer, audience, subject, issued-at and expiry. Configure `OIDC_ISSUER_URL` and `OIDC_AUDIENCE`; non-HTTPS issuers require the explicit local-only `OIDC_ALLOW_HTTP=true` override.

The React portal uses Authorization Code with PKCE. Access tokens and the user session stay in memory; only the short-lived PKCE transaction state crosses the redirect in session storage.

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
