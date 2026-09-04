# VIBE-2 live release-routing E2E evidence

## Status

Passed on 2026-09-04.

Docker Desktop became responsive with server version 29.7.2. The live harness completed successfully using `node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf` on the `desktop-linux` context from the D-drive repository. Vitest reported one passed test with no skip; the scenario itself completed in 8.538 seconds. Post-run checks found no remaining `vcp-test-*` containers and no remaining `vcp-e2e-*` network.

Earlier readiness attempts timed out while Docker Desktop was starting, including an explicit invocation from `D:\`. This confirmed that the repository drive was not the cause; the same command succeeded once the Linux engine was ready.

## Executable evidence

Test: `test/release-routing-e2e.test.ts`

The platform-owned fixture verifies this sequence without customer source:

1. create an isolated Docker network;
2. persist a content-addressed healthy build artifact;
3. deploy the artifact in the hardened test runtime;
4. wait for bounded direct health verification;
5. atomically activate the company/application ingress route;
6. deploy an unhealthy candidate;
7. restore and verify the previous healthy container;
8. atomically restore its ingress route;
9. generate Traefik file-provider configuration;
10. verify the rollback audit event and clean up containers, network, and temporary files.

## Acceptance command

Start Docker Desktop and wait until `docker version` returns its server version. Then use a locally available digest-pinned Node image:

```powershell
$env:VCP_E2E_RUNTIME_IMAGE='node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf'
pnpm test:e2e-release
```

Acceptance requires one passed test with no skipped test, no remaining `vcp-test-*` containers created by the test, and no remaining `vcp-e2e-*` network created by the test.

## Current automated gates

- TypeScript typecheck: passed
- Production portal and control-plane build: passed
- Architecture dependency check: passed
- PostgreSQL persistence suite: passed
- Non-live automated suite: passed
- Live Docker deployment and rollback: passed (1 test, 8.538-second scenario)
- E2E container and network cleanup: passed
