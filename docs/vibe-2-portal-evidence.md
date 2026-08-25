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

The local spike token is held in a React in-memory session only. It is never written to local storage, session storage or IndexedDB, and it is cleared on sign-out or page refresh.

`test/portal-security.test.ts` verifies both the session lifecycle and absence of browser persistence API usage in portal sources. The synthetic `spike:` identity mechanism remains local-only and must be replaced by the selected federated provider before production use.

## Verification

On 2026-08-25:

| Check | Result |
| --- | --- |
| Backend strict TypeScript | Passed |
| Portal strict TypeScript | Passed |
| React/Vite production build | Passed — 30 modules |
| Test files | 10 passed |
| Tests | 43 passed |
| PostgreSQL integration tests | 6 passed |
| Architecture boundary check | Passed — 0 violations, 0 cycles |
| Live operator flow | Passed — selected customer application visible |
| Live company-user flow | Passed — assigned-company application visible; customer selector absent |

## Reproduce

```powershell
pnpm build
$env:DATABASE_URL='postgres://vibe:vibe-development-only@localhost:5432/vibe_control'
$env:SPIKE_IDENTITY_ENABLED='true'
pnpm start
```

Open `http://127.0.0.1:3000/portal/`.

## Remaining limits

* The login form represents the identity-provider integration boundary; it is not a production login.
* Operator customer discovery uses an explicit company identifier in this slice. A managed customer-directory endpoint remains product work.
* Full cross-browser, accessibility and responsive test matrices remain outstanding.
* CSRF/session-cookie controls will be defined with the production identity flow; the spike currently uses an in-memory bearer token.
