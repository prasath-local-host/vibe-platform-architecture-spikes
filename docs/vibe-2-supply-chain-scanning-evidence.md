# VIBE-2 SBOM and vulnerability scanning evidence

Implemented and verified on 2026-09-07.

## Behavior

The configured build worker scans the immutable source before build execution. Trivy generates a CycloneDX report containing dependency inventory and vulnerability findings, including development dependencies. Source scans require a supported Node lockfile. High, critical, unknown, or unrecognized vulnerability severity blocks the build. Malformed reports, scanner errors, timeout, and evidence-storage failures cannot grant approval. The existing artifact-content gate remains in place after the build.

The deployment adapter independently scans the configured runtime image by digest through its registry before starting a candidate container. Both approved and policy-rejected reports are stored with tenant, build/release identity, scanner digest, target digest, scan timestamp, and policy version. Build results and OpenAPI expose the source evidence UUID and digest. When scanning is required, legacy builds without that evidence cannot create a new release; policy failures return HTTP 400.

Scanning is opt-in locally and mandatory for `NODE_ENV=production`. Required configuration is `TRIVY_SCANNER_IMAGE`, `TRIVY_SCANNER_NETWORK`, and `SUPPLY_CHAIN_EVIDENCE_ROOT`. No environment file was changed to enable this on the running local portal.

## Live evidence

Two live tests passed using:

- Scanner: `aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c` (0.69.3).
- Runtime target: `node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf`.
- Runtime image: registry scan, nonempty component inventory, and digest-bound decision retained; 154.649 seconds.
- Synthetic source: Lodash 4.17.15 detected in the CycloneDX component inventory, vulnerabilities reported, and policy rejection verified; 100.764 seconds.

The runtime test accepts either an approved or rejected policy result because database findings change over time; it does not certify this Node image as vulnerability-free. These are adapter-level live tests, with build/deployment gate integration tested separately. Temporary live-test reports were validated and removed by test cleanup.

Initial live attempts revealed that the database extraction exceeded the 1 GiB tmpfs limit. After increasing tmpfs to 2 GiB and the container memory limit to 3 GiB, both tests passed. Containers remain non-root, read-only, capability-restricted, without a Docker socket, and bounded by CPU, PID, output-size, and timeout limits. Source configuration and ignore files cannot override platform scanner flags.

## Remaining operational work

The scanner network requires infrastructure egress controls; creating a named bridge does not enforce them. Fresh databases are downloaded per invocation, so a controlled shared cache is needed for practical throughput. Evidence requires operator filesystem permissions, backup/retention, and an authenticated retrieval API. Private registry authentication, database provenance/freshness evidence, signed attestations, and exception management remain open. Full-source inventory can include packages not shipped in a bundled executable. Previously queued releases and rollback targets need review before enabling the new policy. This change adds vulnerability scanning, not a production malware engine.

## References

- [Trivy filesystem CLI](https://trivy.dev/docs/latest/guide/references/configuration/cli/trivy_filesystem/)
- [Trivy image CLI](https://trivy.dev/docs/latest/guide/references/configuration/cli/trivy_image/)
- [Vendor advisory identifying unaffected 0.69.3](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)
