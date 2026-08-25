# VIBE-2 Federated Identity Evidence

> **Result:** PASS for the bounded Keycloak/OpenID Connect spike
>
> **Provider:** Keycloak 26.7.0, pinned container image
>
> **Flow:** Authorization Code with PKCE for the browser; signed JWT access token for the API

## Trust boundary

The API loads OpenID Connect discovery metadata from the configured issuer, requires the returned issuer to match exactly, and accepts only a same-origin JWKS endpoint. Production issuers must use HTTPS; HTTP requires an explicit local-spike override.

Access-token verification requires:

* RS256 signature from the trusted remote JWKS;
* exact issuer and `vibe-control-plane` audience;
* subject, issued-at and expiry claims;
* a maximum token age of 15 minutes and five-second clock tolerance.

The verified subject is the only external authorization key. Company memberships and platform-operator roles are always loaded from PostgreSQL. Tenant IDs or privileged roles from browser input or token claims do not grant access.

## Browser flow

The React portal uses `oidc-client-ts` 3.5.0 with Authorization Code and PKCE. The OIDC user and access token use an in-memory store. Transient PKCE verifier/state uses session storage across the redirect; tokens never enter browser storage.

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

Final combined run on 2026-08-25: **12 test files and 51/51 tests passed**, including all six PostgreSQL tests and the live Keycloak integration test.

## Revocation decision

Company membership and platform-role revocation remains immediate because every request checks VCP-controlled PostgreSQL authorization. A provider-issued access token remains cryptographically valid until its five-minute expiry unless the provider changes key/not-before policy. Per-request token introspection is intentionally not implemented in this spike; production review must choose between short-lived offline JWT validation and introspection based on revocation latency, availability and load requirements.

## Operational limits

The imported realm, users, passwords, HTTP transport and `start-dev` command are synthetic local fixtures only. Production requires TLS, external Keycloak persistence, hardened realm/client policy, secret and administrator lifecycle, backup/recovery, monitoring, upgrade testing and removal of direct password grants.
