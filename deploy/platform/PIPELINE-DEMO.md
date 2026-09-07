# Portal-driven demo delivery

This is a bounded adapter to the existing trusted Actions demo workflows, not the
generic build/release workers. Those workers remain disabled. The control plane
does not get a Docker socket, customer source checkout, or Supabase keys.

## One-time server configuration

1. Update the platform source checkout to the commit containing these controls.
2. Copy `source/deploy/platform/compose.yaml` to the existing platform root's
   `compose.yaml`. This adds an optional private `github.env`; it preserves existing
   databases and credentials. Do not run `prepare.py` or the bootstrap SQL again.
3. Create an expiring fine-grained GitHub token with access only to
   `vibe-platform-architecture-spikes` and `verdikjede-ki-demo`, repository Actions
   **read/write** and Contents **read**. GitHub applies those permissions to both
   selected repositories. Use a short demo expiry; revoke afterwards. Keep the
   existing Actions `DEMO_SOURCE_READ_TOKEN` secret—this new token does not replace it.
4. On Ubuntu, run `python3 source/deploy/platform/configure_pipeline.py`. It finds
   exactly one registered demo application under `company-a`, validates read access
   and active workflows, and prompts with hidden input. It writes
   `private/github.env` (0600, parent 0700). No workflow is started. Docker admins
   can inspect container environment; this is not a general-purpose secret vault.
5. Update `PLATFORM_REVISION` in the existing root `.env`, then run
   `docker compose build platform` and
   `docker compose up -d --no-deps --wait --wait-timeout 120 platform`.
   Migration 007 creates a separate pipeline history table; customer databases are
   unaffected. Do not print `.env`, `github.env`, or rendered Compose configuration.

## Walkthrough

Keep the SSH portal/identity forwards on 3200 and 8083. For viewing both apps, add
forwards 3101/8001 (Stage app/Supabase) and 3100/8002 (Prod app/Supabase). All remote
targets remain loopback on 10.0.32.115. Do not expose Supabase Studio publicly.

1. Commit/push the application change to its own repository. For a fully manual UI
   demonstration, leave that repository's `PLATFORM_BUILD_ENABLED` variable false
   or unset so the push does not create an additional automatic build.
2. Sign into the portal with OTP, open company-a, select the demo application.
3. In **Build → Stage → Prod**, click **Use latest main**, check the full SHA, then
   **Build, test & scan**. Status/history polls every 10 seconds. Open the run link
   for individual check steps, scan reports and logs. The success status represents
   the whole trusted workflow—not an independent vulnerability summary in the UI.
4. Wait for success. Select that build and click **Deploy to Stage**. After success,
   open Stage and verify login, an evaluation and the visible update banner.
5. Click **Promote to Prod**, confirm the SHA, and wait for success. Open Prod and
   verify the same banner. The deployment helper independently checks the current
   Stage receipt and live health before touching Prod. Both environments use the
   same image artifact but separate databases/secrets.

OIDC sessions/OTP assurance expire. If asked, verify identity and reopen the app;
history persists across sign-in. Reauthentication never automatically replays a
deployment. GitHub environment reviewer rules still apply if configured.

## Safety and limitations

- A server-configured application UUID + company + exact repository binding is
  required. Registering the same URL in another company grants no deployment access.
- Every route verifies company access; POST also requires existing action-level
  step-up and browser CSRF protection. Requests record actor, action, source SHA,
  parent build and nonce in PostgreSQL before calling GitHub.
- The database permits only one active request per application. Idempotency keys
  prevent retry duplicates, including after a service restart. Lost dispatch
  responses are reconciled by exact UUID in workflow run-name, never newest-run
  inference. No automatic POST retries. A successful dispatch is not build success.
- GitHub API version 2026-03-10 returns a run ID on workflow dispatch. A no-content
  response is also supported by nonce lookup. Lookup searches the newest 100 runs
  since request creation; larger backlogs require operator reconciliation.
- If a request stays `dispatching`, inspect the exact `VCP <kind> <UUID>` Actions
  run and credential/workflow setup. It remains blocked intentionally. Do not
  delete records or redispatch blindly; operator recovery tooling is a follow-up.
- Stage requires successful build/tests/security and an unexpired candidate.
  Prod requires a successful latest portal Stage deployment of that same build;
  the runner additionally enforces actual current Stage state. Manual external
  deployments are not imported, so a portal gate can be more restrictive.
- Health status is deployment-time verification, not ongoing monitoring. Candidate
  artifact retention is three days. Expired candidates must be rebuilt and staged.
- History currently shows the latest 50 portal requests. No scheduling, cancellation,
  GitHub App token rotation, user-configurable auto-Stage, or portal rollback button.
  Existing runner rollback-on-failure remains in force. For portal builds, the
  workflow's optional automatic Stage job is suppressed so promotion is explicit.

Reference: [GitHub workflow dispatch API](https://docs.github.com/en/rest/actions/workflows?apiVersion=2026-03-10#create-a-workflow-dispatch-event).
