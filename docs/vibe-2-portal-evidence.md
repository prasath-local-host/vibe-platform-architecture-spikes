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

The Keycloak access token and OIDC user are held in a React in-memory store only. They are never written to local storage, session storage or IndexedDB, and are cleared on sign-out or page refresh. Only the short-lived PKCE verifier and OAuth transaction state use session storage so the full-page redirect can complete.

`test/portal-security.test.ts` verifies the session lifecycle, prohibits local storage and IndexedDB, and asserts that OIDC user storage is the explicit in-memory adapter.

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
$env:OIDC_BROWSER_ORIGIN='http://localhost:8081'
pnpm start
```

Open `http://127.0.0.1:3000/portal/`.

## Remaining limits

* The imported Keycloak realm and credentials are synthetic development fixtures; production realm hardening remains operational work.
* Operator customer discovery uses an explicit company identifier in this slice. A managed customer-directory endpoint remains product work.
* Full cross-browser, accessibility and responsive test matrices remain outstanding.
* Issued access tokens are bearer tokens with a five-minute lifetime. Immediate company/role revocation is enforced in VCP storage; provider token introspection is not implemented.
