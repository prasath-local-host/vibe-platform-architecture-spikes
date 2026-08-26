# VIBE-2 Minimal Company Portal Evidence

> **Result:** PASS for the bounded local spike
>
> **Scope:** React/Vite portal, company-scoped application workflow and browser credential-storage boundary.

## Implemented views

* LocalHost operator dashboard with an explicit customer selector and applications displayed for the selected customer.
* Company-user dashboard fixed to the authenticated user's company, with no customer-switching control.
* Application registration connected to the PostgreSQL-backed control-plane API.
* Application detail and asynchronous assessment submission/history.
* Responsive login and dashboard layouts using the VCP blue visual direction.

The portal is served by NestJS/Fastify at `/portal/`; Swagger remains at `/docs`.

## Credential boundary

The portal uses a backend-for-frontend session. Keycloak tokens, OAuth state and the PKCE verifier remain server-side. The browser receives only an HTTP-only, same-site session cookie and a session-bound CSRF value; it contains no OIDC library or provider-token handling. Logout invalidates the local session before continuing to provider logout.

`test/portal-security.test.ts` prohibits browser storage and access-token handling and asserts the HTTP-only cookie, PKCE and CSRF boundaries.

## Verification

On 2026-08-25:

| Check | Result |
| --- | --- |
| Backend strict TypeScript | Passed |
| Portal strict TypeScript | Passed |
| React/Vite production build | Passed — 33 modules |
| Test files | 12 passed |
| Tests | 51 passed |
| PostgreSQL integration tests | 6 passed |
| Architecture boundary check | Passed — 0 violations, 0 cycles |
| Live operator flow | Passed — Keycloak login and selected customer application visible |
| Live company-user flow | Passed — Keycloak login, assigned-company application visible, customer selector absent |

## Reproduce

```powershell
pnpm build
$env:DATABASE_URL='postgres://vibe:vibe-development-only@localhost:5432/vibe_control'
$env:OIDC_ISSUER_URL='http://localhost:8081/realms/vibe'
$env:OIDC_AUDIENCE='vibe-control-plane'
$env:OIDC_ALLOW_HTTP='true'
$env:OIDC_CLIENT_ID='vibe-control-plane'
$env:PUBLIC_ORIGIN='http://127.0.0.1:3000'
pnpm start
```

Open `http://127.0.0.1:3000/portal/`.

## Remaining limits

* The imported Keycloak realm and credentials are synthetic development fixtures; production realm hardening remains operational work.
* Operator customer discovery uses an explicit company identifier in this slice. A managed customer-directory endpoint remains product work.
* Full cross-browser, accessibility and responsive test matrices remain outstanding.
* The local BFF session store is process-local and intentionally non-durable. Production requires a shared encrypted session store and tested expiry, rotation, revocation and recovery behavior.
