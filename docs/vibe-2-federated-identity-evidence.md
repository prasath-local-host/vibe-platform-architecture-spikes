# VIBE-2 Federated Identity Evidence

> **Result:** PASS for the bounded Keycloak/OpenID Connect spike
>
> **Provider:** Keycloak 26.7.0, pinned container image
>
> **Flow:** Server-owned Authorization Code with PKCE; HTTP-only browser session; signed JWT access token remains in the BFF

## Trust boundary

The API loads OpenID Connect discovery metadata from the configured issuer, requires the returned issuer to match exactly, and accepts only a same-origin JWKS endpoint. Production issuers must use HTTPS; HTTP requires an explicit local-spike override.

Access-token verification requires:

* RS256 signature from the trusted remote JWKS;
* exact issuer and `vibe-control-plane` audience;
* subject, issued-at and expiry claims;
* a maximum token age of 15 minutes and five-second clock tolerance.

The verified subject is the only external authorization key. Company memberships and platform-operator roles are always loaded from PostgreSQL. Tenant IDs or privileged roles from browser input or token claims do not grant access.

## Privileged authentication assurance

The verifier maps `acr` and `amr` only from a token that has already passed signature, issuer, audience, expiry and required-claim validation. `IdentityService` applies the configured `PRIVILEGED_AUTHENTICATION_CONTEXTS` allow-list after resolving the subject as a platform operator from VCP-controlled storage. An operator without an approved signed `acr` is rejected with `401`; ordinary company membership is not elevated by assurance claims.

Automated evidence covers rejection of a password-only operator context, acceptance of an approved MFA context, configuration parsing, and signed `acr`/`amr` mapping. This proves the provider-neutral enforcement point. It does not yet prove real MFA enrollment, recovery, conditional access or an interactive step-up journey in the candidate provider.

## Browser flow

Fastify acts as the backend for frontend. It creates OAuth state and the PKCE verifier, validates the callback, exchanges the authorization code, and retains the provider access token in a bounded server-side session. The browser receives only an HTTP-only, same-site cookie. State-changing requests require a session-bound CSRF value supplied through a custom header. Logout deletes the local session and continues to the provider logout endpoint. Browser code contains no OIDC client or provider token handling.

The authenticated session cookie remains `SameSite=Strict`. The separate five-minute OAuth state cookie uses `SameSite=Lax`, because standards-compliant top-level callbacks must return from an identity provider that can be on a different site. State is still random, HTTP-only, single-use, server-bound and compared in constant time. The interactive Keycloak/Microsoft Authenticator journey exposed and validated this boundary.

The in-memory session adapter is deliberately bounded spike evidence. Production requires a shared, encrypted session store with expiry, rotation and operational recovery appropriate to the selected deployment topology.

## Prompt provider revocation

The BFF uses a confidential OIDC client and can require token introspection before honoring each browser session. If Keycloak reports the server-held access token inactive—or introspection fails or times out—the request fails closed with `401`, the process-local session is deleted and the browser cookie is expired.

Live integration evidence issues a company-user token, disables that account through the synthetic Keycloak administration boundary, verifies that introspection immediately returns `active: false`, and restores the account in a `finally` block. The browser never receives the client secret or provider token.

## Automated and live verification

| Evidence | Result |
| --- | --- |
| Trusted discovery and remote JWKS | Passed |
| Valid provider-issued token | Passed |
| Wrong issuer | Rejected |
| Wrong audience | Rejected |
| Expired token | Rejected |
| Wrong signature | Rejected |
| Missing/malformed bearer token | Rejected |
| HTTP issuer without local override | Rejected |
| Live Keycloak 26.7.0 token | Passed |
| Live operator PKCE browser flow | Passed |
| Live company-user PKCE browser flow | Passed |
| PostgreSQL authorization after verification | Passed |
| Browser provider-token exclusion | Passed by source enforcement |
| CSRF enforcement boundary | Passed by source enforcement |
| Privileged ACR allow-list enforcement | Passed |
| Signed ACR/AMR mapping | Passed |
| Microsoft Authenticator TOTP enrollment and sign-in | Passed interactively |
| Cross-site OAuth state callback | Passed after `SameSite=Lax` correction |
| Provider account disablement changes introspection to inactive | Passed against live Keycloak |
| BFF inactive/unavailable introspection fails closed | Passed by enforced session boundary |

Final combined run on 2026-08-28: **12 test files and 58/58 tests passed**, including all six PostgreSQL tests and three live Keycloak integration tests.

## Revocation decision

Company membership and platform-role revocation remains immediate because every request checks VCP-controlled PostgreSQL authorization. Browser sessions additionally support per-request provider introspection so account disablement fails closed promptly. Approved non-browser API clients still use short-lived offline JWT validation in this spike; their revocation latency, introspection policy, availability and load requirements remain a separate workload/API decision.

## Operational limits

The imported realm, users, passwords, HTTP transport, in-memory BFF sessions and `start-dev` command are synthetic local fixtures only. Production requires TLS, a shared encrypted session store, hardened provider persistence and policy, secret and administrator lifecycle, backup/recovery, monitoring, upgrade testing and removal of direct password grants.
