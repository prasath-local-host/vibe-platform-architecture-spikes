# VIBE-2: Shared scanner cache and portal evidence

Date: 2026-09-07. Builds on commit `29068df`.

## Delivered

- Shared Trivy database cache, with cross-process exclusive ownership, bounded waiting, and fail-closed abandoned-lock behavior. Database update checks remain enabled; scan artifacts use memory caching.
- Atomic publication of complete evidence files.
- Authenticated, company- and application-scoped scan list/detail endpoints, including rejected decisions. OpenAPI and route authorization inventory updated.
- Portal scan review, vulnerability severity display, saved-result timestamp, and full CycloneDX download. Customer/application changes discard prior scan state.

## Verification

- Default Vitest suite: 140 passed, 17 optional integration tests skipped.
- Live Trivy: two passed. First runtime-image scan 98.249 seconds; subsequent dependency scan 1.081 seconds using the shared database cache. This is a local observation, not a performance SLA.
- Edge browser: two passed, covering blocked findings, full downloaded report preservation, customer-context clearing, error display and refresh recovery. Synthetic API/session fixtures, not a live identity-provider test.
- TypeScript/portal production build and architecture dependency check passed.
- Browser screenshot inspected for scan-panel layout; test screenshots are ignored Git artifacts.
- Temporary scanner test network removed; no named scanner containers remained.
- PostgreSQL integration tests were not rerun; no database migration or schema change is included.

## Operational limits

Cache defaults to `<SUPPLY_CHAIN_EVIDENCE_ROOT>/scanner-cache` and can be moved using `TRIVY_CACHE_ROOT`. Linux needs an operator-provisioned directory writable by UID/GID 65532. Never remove `.vcp-scan-lock` until its previous owner is confirmed stopped. Network policy must still restrict scanner egress; a Docker network name alone is not an allowlist.

Evidence files are trusted operator-controlled storage, not signed attestations. Listing scans reads a flat directory, with a 10,000-entry ceiling and a 17 MiB per-report read limit. Backup, retention, scalable indexing, database provenance/freshness reporting, and multi-host cache validation remain outstanding. A saved passing scan is not a claim of current application health or production readiness.
