# VIBE-2 live release-routing E2E evidence

## Status

Pending infrastructure readiness as of 2026-09-04.

The committed E2E harness is ready, but the live container execution was not claimed as passing. Docker Desktop was initially stopped. Its user-level application was launched successfully, and WSL2 reports Ubuntu as the default distribution with version 2. The Docker engine did not become responsive: both `docker version` and `docker desktop status` exceeded bounded 30-second readiness windows. Starting `com.docker.service` directly was denied by Windows service permissions. A second invocation was made explicitly with `D:\` as the working directory; the CLI resolved correctly to `C:\Program Files\Docker\Docker\resources\bin\docker.exe`, selected the `desktop-linux` context, and again timed out waiting for the server. The working drive is therefore not the cause.

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
$env:VCP_E2E_RUNTIME_IMAGE='node@sha256:<64-hex-digest>'
pnpm test:e2e-release
```

Acceptance requires one passed test with no skipped test, no remaining `vcp-test-*` containers created by the test, and no remaining `vcp-e2e-*` network created by the test.

## Current automated gates

- TypeScript typecheck: passed
- Production portal and control-plane build: passed
- Architecture dependency check: passed
- PostgreSQL persistence suite: passed
- Non-live automated suite: passed
- Live Docker deployment and rollback: pending Docker engine readiness
