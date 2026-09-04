# VIBE-2 artifact-security gate evidence

## Decision

Build artifacts fail closed before storage and release. A completed build result must include an `approved` security status, scanner identity, and scan timestamp. Release creation rejects missing or rejected decisions.

## Implemented baseline

- re-verifies the content-addressed artifact before inspection;
- rejects the standard antivirus test signature;
- rejects embedded PKCS#8, RSA, or OpenSSH private-key markers;
- scans before artifact storage, so rejected output is not published;
- exposes the decision fields in the committed OpenAPI contract;
- persists the decision with the build result in PostgreSQL JSON;
- preserves a scanner port that can be replaced by production malware, SBOM, and vulnerability services.

The baseline is architecture evidence, not a production antivirus claim. Production readiness still requires a maintained malware engine, dependency and container-image vulnerability policies, SBOM generation, signed attestations, scanner availability handling, and exception governance.

## Verification

Passed on 2026-09-04:

- default suite: 113 tests passed;
- artifact publication rejects unsafe output before storage;
- release creation rejects an unapproved artifact;
- PostgreSQL suite: 7 tests passed;
- live deployment and rollback E2E: passed;
- live exact-GitHub-SHA build and release E2E: passed in 10.953 seconds;
- TypeScript, production build, OpenAPI synchronization, and architecture checks: passed.
