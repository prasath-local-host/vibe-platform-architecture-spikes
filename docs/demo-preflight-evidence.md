# Demo preflight evidence

Date: 2026-09-07. Local verification only; the Ubuntu host has not been deployed to.

## Verified

- Platform Vitest: 142 passed; 17 optional integration tests skipped. Production build and architecture check passed.
- Deployment helper: four Linux Python tests passed, covering manifest validation, exact Stage-before-Prod identity, and restoring the previous container/receipt after replacement health failure.
- All three workflow files passed actionlint syntax/expression validation (shellcheck/pyflakes were disabled for this check).
- Sample app: four configuration/security unit tests passed; Linux production build passed, with TypeScript/lint validation. Two existing non-blocking image-related lint warnings remain.
- Container smoke: process startup, exact revision, login HTML, unauthenticated dashboard redirect and unauthenticated AI denial passed using synthetic public configuration and no real service keys.
- Full npm audit: zero reported vulnerabilities after Next.js 15.5.25 upgrade and PostCSS 8.5.28 override.
- Actual Trivy source vulnerability gate passed; source secret scan passed without emitting detected-secret contents.
- Actual Trivy final image vulnerability gate passed. The first image failed due to OpenSSL and bundled npm dependencies; the runtime now applies Alpine security updates and removes unused npm/corepack tooling. No severity exception was introduced.
- Final locally tested image: `sha256:6ea3448c28c19580feeed1d0a01fb6d0ea97e0ea587a267f041029faf7c7b1dd`. GitHub will build its own candidate and promote that candidate's exact image ID; this local image is not an approved live release.
- Temporary smoke containers removed. Local reports/image archive are retained outside both repositories under the task's audit-temp directory.

## Not yet verified / required before demonstration

- GitHub-hosted workflow execution and private cross-repository token configuration.
- Runner access to `/mnt/data/vcp-demo`, Docker, and the environment files.
- Separate Stage/Prod Supabase projects, migration application (including profile authorization protection), demo-user provisioning, redirects and email delivery.
- Live authenticated evaluation, company isolation, AI/PDF operations, Stage deployment, manual promotion and live rollback rehearsal.
- SSH host trust/access. The read-only SSH attempt stopped at unknown host-key verification; no trust settings were changed.

This demo uses GitHub Actions for progress and manual deployment, not the unfinished VCP portal promotion UI. No claim of production readiness or end-to-end live acceptance is made. The current helper has single-host local receipts, brief downtime during port rebinding, and no automatic database migration/rollback or retention controller.
