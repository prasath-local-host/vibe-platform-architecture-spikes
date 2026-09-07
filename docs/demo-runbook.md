# Single-host demo runbook

## Scope and topology

This is a time-bounded GitHub Actions demonstration, separate from the VCP portal release model. The portal does **not** yet display these workflow runs or control promotion. A successful rehearsal shows one exact customer commit passing tests, build, source/image security and smoke checks; Stage deployment; and a separately initiated Prod promotion of the same image. Both environments share one Ubuntu host and are not high-availability infrastructure.

- Source repository: `prasath-local-host/verdikjede-ki-demo` (customer code stays there).
- Trusted pipeline: this repository's default branch `codex/vibe-2-control-plane`.
- Build/scanning: disposable GitHub-hosted `ubuntu-24.04` runner, no deployment credentials.
- Deployment: existing `lab.localhost.no` runner, labels `self-hosted`, `Linux`, `X64`, Ubuntu `10.0.32.115`.
- Runtime: loopback Stage port 3101 and Prod port 3100. Separate Docker networks and environment files.
- Database: separate Supabase demo projects; no real customer data. Schema setup is manual for this demo, not an implemented migration automation service.

## 1. GitHub configuration (required)

In the **platform repository**, create Actions repository variables:

| Variable | Value |
| --- | --- |
| `DEMO_SOURCE_REPOSITORY` | `prasath-local-host/verdikjede-ki-demo` |
| `DEMO_AUTO_STAGE` | `false` initially; set `true` for automatic staging after all checks pass |

Add Actions secret `DEMO_SOURCE_READ_TOKEN`: a fine-grained token restricted to the demo repository with Contents read permission. Prefer a short-lived GitHub App token for a longer-lived installation. Never paste tokens into chat, source, command logs or screenshots.

Create environments `demo-stage` and `demo-prod`. Restrict both to the platform default branch. Add required reviewers for Prod if supported by the GitHub plan; the separate manually invoked promotion workflow is still mandatory. Do not claim independent approval if required reviewers are not configured. Restrict write/Actions access to trusted operators; no fork/PR workflow targets the self-hosted runner. If more matching runners exist, give this demo runner an additional label and update both deploy jobs to require it.

In the **demo repository**, add `PLATFORM_DISPATCH_TOKEN`: fine-grained Actions write permission on the platform repository only. Set `PLATFORM_BUILD_ENABLED=true` only after all setup is ready. Pushes to demo `main` then request the platform workflow for the exact pushed commit. Manual platform builds are available without that trigger token.

## 2. Ubuntu preparation (run as the runner service account)

Confirm RAM upgrade, disk capacity and existing workloads before changes:

```bash
free -h
df -h / /mnt/data
docker info --format '{{.OSType}} / {{.Architecture}}'
docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -ltn '( sport = :3100 or sport = :3101 )'
python3 --version
```

The service account must have Docker access. Docker access effectively grants host-level privileges; reserve the runner for trusted platform deployment workflows. Do not run customer npm/build scripts directly on this runner. Builds and security scans run elsewhere.

Create a new demo-owned directory, without changing ownership of existing unrelated data:

```bash
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /mnt/data/vcp-demo
install -d -m 700 /mnt/data/vcp-demo/secrets /mnt/data/vcp-demo/state
umask 077
touch /mnt/data/vcp-demo/secrets/stage.env
touch /mnt/data/vcp-demo/secrets/prod.env
chmod 600 /mnt/data/vcp-demo/secrets/stage.env /mnt/data/vcp-demo/secrets/prod.env
```

Use a local editor to populate each file. Docker env files use `NAME=value` without shell exports or wrapping quotes:

```text
SUPABASE_URL=https://YOUR-ENVIRONMENT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_PRIVATE_SERVICE_ROLE_KEY
APP_URL=http://localhost:3101
ANTHROPIC_API_KEY=YOUR_DEMO_AI_KEY
```

Use port **3100** in Prod's `APP_URL`. Use different Supabase projects/keys for each environment. Optional `ANTHROPIC_MODEL`, `RESEND_API_KEY`, and `RESEND_FROM` must only be added if valid values are available; omit unused optional fields rather than supplying blank overrides. Follow the app README for migrations, demo users and redirect allowlists.

The observed server uses Snap Docker. If Docker cannot access `/mnt/data`, inspect its Snap connections and have the operator enable the appropriate removable-media interface if needed. Do not uninstall/reconfigure Docker or relocate existing Docker storage as part of this demo setup.

## 3. View through an encrypted SSH tunnel

On the demo laptop, verify the server host-key fingerprint out of band, then run:

```bash
ssh -N -L 3101:127.0.0.1:3101 -L 3100:127.0.0.1:3100 lhost@10.0.32.115
```

Open `http://localhost:3101` for Stage and `http://localhost:3100` for Prod. These ports stay private on Ubuntu; SSH encrypts traffic between laptop and server. No DNS or public TLS setup is assumed. Public HTTPS domains and trusted certificates are a subsequent configuration task. Do not disable SSH host-key checking.

## 4. Rehearsal

1. Make a visible UI-only change using the customer's preferred AI tool, review it, and push to demo `main`.
2. Follow **Demo - build, test and security** in platform Actions. With the trigger disabled, manually run it on the default branch with the full 40-character demo commit SHA.
3. Verify every gate passes. Download SBOM evidence from the run. Failed security or tests must leave no deployable candidate artifact.
4. With auto-stage disabled, run **Demo - deploy Stage or promote Prod**, enter the successful build run ID and choose `stage`. With auto-stage enabled, Stage runs after the build gates.
5. Confirm Stage login, company isolation, create/save/reopen an evaluation, and a representative AI/PDF action using synthetic data. Process/database/login checks are automated; business acceptance remains manual.
6. Run the deploy workflow again with the **same build run ID**, choosing `prod`. The script refuses promotion unless the exact manifest matches the current healthy Stage receipt and Stage still passes health checks.
7. Confirm the same visible UI and revision in Prod. Inspect `/mnt/data/vcp-demo/state/prod.json` for immutable source/image identity and previous-container reference.
8. Rehearse a deliberately failing test on a disposable commit to show deployment is blocked. Do not intentionally damage the live demo database to demonstrate rollback.

## Recovery and limitations

The deployment adapter verifies image-tar SHA-256 and exact Docker image ID. It checks a candidate on a temporary loopback port before replacing the stable binding. Switching requires stopping/recreating a container and can cause brief downtime; this is not zero-downtime ingress. A failed replacement attempts to restore the previous container and verifies it. Application rollback does not reverse database changes. Previous containers remain for recovery; there is no automatic image/container retention cleanup yet.

Receipts and environment files are trusted operator-owned storage, not signed attestations. A runner/host compromise defeats that trust boundary. Host crashes between switching and recording state require operator recovery. Local smoke and mocked rollback tests do not establish live server readiness. Missing projects, migrations, GitHub tokens, runner permissions, or successful live rehearsal are release blockers.
