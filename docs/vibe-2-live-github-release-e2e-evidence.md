# VIBE-2 live GitHub-to-release E2E evidence

## Status

Passed on 2026-09-04 against pushed commit `d53a57bb08e81c2460d863246d598079dd937fe7`.

Vitest reported one passed test with no skip. The scenario completed in 11.434 seconds using the digest-pinned runtime `node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf` on Docker Desktop's Linux engine from the D-drive repository.

## Verified sequence

The platform-owned fixture verifies the following without customer source, data, or credentials:

1. fetch the exact 40-character commit from the configured GitHub repository;
2. verify the checkout SHA and create an integrity-protected source artifact;
3. restore locked dependencies in the dedicated controlled-egress Docker network with lifecycle scripts disabled;
4. verify immutable source files after restoration;
5. build the bounded application working directory with `--network none`;
6. collect only the configured output directory and store a content-addressed build artifact;
7. create a release record that copies the artifact identifier and digest;
8. deploy the artifact in the hardened Docker test runtime;
9. verify the application's `/health` endpoint;
10. mark the release healthy and atomically activate its tenant/application route;
11. remove the temporary checkout, build workspace, deployment container, Docker network, and filesystem state.

## Acceptance command

```powershell
$env:VCP_E2E_RUNTIME_IMAGE='node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf'
$env:VCP_E2E_GITHUB_REVISION='d53a57bb08e81c2460d863246d598079dd937fe7'
pnpm test:e2e-github-release
```

Acceptance requires one passed test with no skipped test and no remaining `vcp-test-*` container or `vcp-e2e-*` network created by the test.
