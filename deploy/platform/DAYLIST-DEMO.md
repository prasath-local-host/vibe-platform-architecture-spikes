# Daylist alongside the existing demo

The control plane supports the original `DEMO_PIPELINE_*` binding and an independent
`DAYLIST_PIPELINE_*` binding. Company, application ID and exact repository are checked
for each request. Existing demo settings and pipeline history are retained.

| Application | Stage | Prod | Host storage |
|---|---|---|---|
| Original demo | 3101 | 3100 | `/mnt/data/vcp-demo` |
| Daylist | 3111 | 3110 | `/mnt/data/vcp-daylist` |

All ports bind to loopback and are accessed through SSH. Daylist has separate
container names, Docker networks, environment files, release receipts, locks,
workflow concurrency groups and GitHub environments (`daylist-stage`, `daylist-prod`).
It uses no Supabase credentials or network. Its task storage is browser-local;
this setup does not provision a PostgreSQL backend or certify full profile compliance.

## Install the platform change

1. Push this platform revision to its default branch, `codex/vibe-2-control-plane`.
   Both `todo-build.yml` and `todo-deploy.yml` must be active in GitHub.
2. Keep the existing trusted Linux runner online. Run server setup as that same
   runner account. The account needs access to the existing platform checkout/Docker.
3. Fetch and check out the exact reviewed platform commit under
   `/mnt/data/vcp-platform/source`, then run:

   ```sh
   bash /mnt/data/vcp-platform/source/deploy/platform/setup-daylist.sh
   ```

The installer verifies free ports, prepares a separate Daylist directory, finds
exactly one `company-b` registration for `prasath-local-host/vcp-demo-todo`, reuses
the original private pipeline token only after GitHub read preflight, creates
`private/daylist.env`, preserves the old `github.env`, and rebuilds/recreates only
the platform service. Its original `.env` and Compose files are saved as private
`.before-daylist` backups. It never starts an application build or deployment.
If token preflight fails, configure an appropriate credential privately by running
`python3 source/deploy/platform/configure_pipeline.py --daylist` and rerun setup.
Do not paste credentials or rendered Compose configuration into chat.

Daylist is currently a public repository and checkout uses the workflow's GitHub token.
If made private, configure `DAYLIST_SOURCE_READ_TOKEN` in the **platform** repository
with read access to Daylist before building. The server token needs Contents read for
the source and Actions read/write on the platform workflow repository, just as before.

Create/review the `daylist-stage` and `daylist-prod` GitHub environment protection
rules before use, restricting deployment to the platform default branch and using
Prod reviewers where supported. They are separate from the existing demo environments.
The workflow itself rejects non-default branches and requires successful exact-artifact
Stage promotion. No independent reviewer approval is claimed without configured rules.

## Demo flow

Add `-L 3111:127.0.0.1:3111 -L 3110:127.0.0.1:3110` to SSH, or restart the updated
`start-demo-tunnels.ps1` from the demo workspace. You may open a second SSH session
with just these two forwards to keep the existing tunnels running.

Open company-b and its to-do application, select **Use latest main**, run
**Build, test & scan**, then **Deploy to Stage**. Verify Daylist on port 3111 before
promoting the same build to Prod on 3110. The build retains mandatory npm tests,
secret scanning, source/runtime vulnerability gates and immutable artifact checks.
The Daylist smoke test checks its actual workspace and runtime revision instead of
the original application's login and AI endpoints.

Until server setup is run, the portal will continue to report an unconfigured pipeline.

## Local verification

The platform build and TypeScript checks passed. Pipeline tests cover simultaneous
company bindings, cross-company authorization, workflow provenance, and promotion
history isolation. Eleven Linux deployment tests passed, including rollback for both
port profiles; four private-configuration tests passed. Daylist's production build,
runtime-revision test, and HTTP smoke checks passed. Live server installation,
GitHub build/scanning and Stage/Prod promotion still need execution in the demo environment.
