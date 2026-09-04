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

The build-execution adapter accepts an immutable source artifact pinned to a full Git commit and protected by a deterministic SHA-256 digest over its revision, paths, lengths and bytes. It verifies that digest before writing any customer file, then runs only `build` or `test` package scripts in a disposable Docker workspace. It requires a digest-pinned image and applies `--network none`, a read-only container root, a non-root UID, dropped Linux capabilities, `no-new-privileges`, PID/CPU/memory limits, a bounded temporary filesystem, timeout and output limits. No customer secret is injected.

Dependency restoration is a separate adapter and security phase. It requires the package-manager-specific lockfile, a digest-pinned image, credential-free HTTPS registry from an explicit origin allowlist, and a dedicated Docker network that infrastructure must restrict to the approved registry through an egress proxy or firewall. It uses frozen/immutable installation, disables package lifecycle scripts, and applies resource, timeout and output limits. The same disposable workspace then passes through an integrity check before the networkless build phase.

The full-source GitHub adapter acquires only an exact 40-character commit SHA, verifies the resulting revision, rejects Git submodules and filesystem symbolic links, and enforces per-file, aggregate-byte and file-count limits before producing the integrity-protected binary-safe artifact. Git metadata and credentials are excluded, and the temporary checkout is always deleted. It is composed into the asynchronous build worker and the live GitHub-to-release acceptance harness.

The combined build-pipeline adapter proves the restoration-to-build handoff in one disposable workspace. It verifies the source artifact before restoration, requires a matching lockfile, restores with lifecycle scripts disabled through the controlled-egress network, re-hashes every immutable source file, and only then runs build or test with `--network none`. A bounded working directory supports monorepositories without allowing traversal, and published artifact paths are relative to that application root. A restore failure or source mutation prevents build execution, and the workspace is always removed.

Build execution now has a durable asynchronous record boundary. Build requests retain the company, registered application repository, immutable source revision, package manager, requested script, idempotency and correlation keys. PostgreSQL claims work with `FOR UPDATE SKIP LOCKED`, recovers locks stale for five minutes, and records terminal state plus audit evidence transactionally. The worker/service contract is implemented and tenant-isolation tested; HTTP routes and runtime composition with source acquisition and the build pipeline remain the next slice.

Authenticated build routes are available at `POST/GET /companies/:companyId/applications/:applicationId/builds` and `GET .../builds/:buildId`; submission requires configured step-up assurance. The build worker is opt-in with `BUILD_WORKER_ENABLED=true` and is runnable only when `GITHUB_SOURCE_ENABLED=true`, `BUILD_PIPELINE_IMAGE` is a digest-pinned image, and `BUILD_EGRESS_NETWORK` names an infrastructure-restricted network. Registry URL/origins and source limits are explicit environment settings. Without complete configuration, queued work is retained and no build worker runs.

Build outputs now have a content-addressed artifact-store boundary and a bounded filesystem adapter. Artifacts retain tenant, application, build, source revision, SHA-256 digest, byte count, creation time and explicit expiry. Writes are atomic, reads revalidate content integrity and company ownership, binary files round-trip without text conversion, and retention cleanup removes only expired records. This adapter is architecture evidence; production object storage, malware scanning and release records remain subsequent boundaries.

Successful build jobs now publish only files under configured output directories (default `dist`) after the networkless build completes. Output collection rejects links and special entries and applies byte/file-count limits. The artifact is stored before the build record completes, and its UUID plus digest become durable build evidence. `BUILD_ARTIFACT_ROOT` is mandatory when the worker is enabled; `BUILD_OUTPUT_DIRECTORIES` and `BUILD_ARTIFACT_RETENTION_DAYS` control publication. Production object storage, malware scanning and release records remain subsequent boundaries.

Test deployments now have a durable release-record boundary. A release can reference only a completed build and copies its artifact UUID and digest. The asynchronous release worker records deployment URL only after deployment, marks the release healthy only after an explicit health check, and otherwise stores a terminal failure. Each new release captures the latest healthy release as its rollback target. PostgreSQL uses idempotent creation, `SKIP LOCKED` claiming and transactional terminal audit evidence. Authenticated routes expose this lifecycle. The optional Docker adapter materializes the verified artifact, uses a digest-pinned runtime with a read-only mount and reduced privileges, publishes only to loopback, and performs a bounded HTTP health check. When a candidate fails, the worker restarts the captured healthy container, removes the failed candidate, verifies the restored endpoint, and records `rolled-back`; an unverified rollback remains `failed`. Production promotion and ingress switching remain later boundaries.

Stable application routing now has an `IngressRouter` port and a filesystem-backed control adapter. It accepts only credential-free loopback HTTP upstreams, derives a stable tenant/application path, serializes competing switches, replaces route records atomically, and returns the displaced route as rollback evidence. When `INGRESS_ROUTE_ROOT` is configured, the release worker switches the stable route only after direct candidate health verification; rollback verifies the restored container before repointing the route. The optional reconciler converts the complete route set into atomic Traefik file-provider configuration, including deterministic routers, services, entry points, and path-stripping middleware. Enable it with `INGRESS_RECONCILER_ENABLED=true` and `TRAEFIK_DYNAMIC_CONFIG_PATH`.

An opt-in release-routing E2E harness uses only a platform-owned fixture. It creates an isolated Docker network, publishes and deploys a healthy artifact, activates its route, deploys an unhealthy candidate, verifies automatic rollback, generates Traefik configuration, and removes its containers and temporary files. Set `VCP_E2E_RUNTIME_IMAGE` to a digest-pinned Node image and run `pnpm test:e2e-release`. The harness skips when no image is supplied.

An additional opt-in live acceptance harness fetches an exact pushed commit from GitHub, builds the platform-owned fixture at `fixtures/platform-node-app` through the controlled-restoration and networkless-build phases, stores the content-addressed artifact, deploys it with the hardened test adapter, verifies `/health`, and activates the stable route. Set `VCP_E2E_RUNTIME_IMAGE` and `VCP_E2E_GITHUB_REVISION`, then run `pnpm test:e2e-github-release`. `VCP_E2E_GITHUB_REPOSITORY_URL` defaults to this architecture repository. The harness skips unless both required values are supplied.

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
