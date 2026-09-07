# SSH-only platform deployment

Demo installation, NOT production hardening. Keep ports bound to loopback and
access through verified SSH. No public DNS/TLS is configured. `start-dev`, HTTP
OIDC and development cookies are intentional for this tunnel-only rehearsal.
Do not publish these ports on 0.0.0.0 or route them publicly. Production needs
HTTPS, secure cookies, hardened identity settings, backups and scanner/worker
configuration. Images are version-tagged for this bounded demo, not attested.

This stack is separate from the customer app and both Supabase installations:

- Platform/API: Ubuntu 127.0.0.1:3200; browser http://localhost:3200/portal/.
- Keycloak: Ubuntu 127.0.0.1:8083; issuer http://localhost:8083/realms/vibe.
- Two PostgreSQL containers, no published database ports; persistent bind mounts
  below /mnt/data/vcp-platform/data. Keycloak users and MFA survive recreation.
- One private backend network. Platform shares Keycloak's container network
  namespace so the BFF and browser agree on the localhost issuer. Neither uses
  host networking or mounts the Docker socket. These two services are a shared
  network trust boundary and should be recreated together when changing identity.
- Read-only, non-root platform. Build, release, assessment and ingress workers
  disabled. GitHub demo build/deploy runs are NOT integrated into this portal yet.

## Prepare on Ubuntu as lhost

Check free disk and ports first. Image builds use Docker's existing storage under
/var/lib/docker (and possibly /var/lib/containerd); putting this checkout on
/mnt/data does NOT relocate Docker. Reserve several GB on root for the build.
Do not prune or relocate existing customer containers/images to free space.

```bash
df -h / /mnt/data
free -h
ss -ltn '( sport = :3200 or sport = :8083 )'
```

Choose the exact reviewed platform commit supplied with these instructions:

```bash
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /mnt/data/vcp-platform
git clone https://github.com/prasath-local-host/vibe-platform-architecture-spikes.git /mnt/data/vcp-platform/source
cd /mnt/data/vcp-platform/source
git checkout --detach APPROVED_PLATFORM_COMMIT
python3 deploy/platform/prepare.py
cd /mnt/data/vcp-platform
docker compose config --quiet
docker compose build platform
docker compose up -d --wait --wait-timeout 600
```

Preparation refuses existing config/data and does not start services. Never rerun
it to rotate passwords; use Keycloak account management and a deliberate secret
rotation process. Do not print `docker compose config` or container environments:
they contain secrets. Original realm-import passwords are protected by the host
private directory (0700); the individual realm file is 0644 so the container UID
can read its file bind mount. Other generated credential files are 0600.

After all services are healthy, bootstrap ONLY the new platform database:

```bash
cd /mnt/data/vcp-platform
docker compose exec -T platform-db psql -X -U vcp -d vcp -v ON_ERROR_STOP=1 < source/deploy/platform/bootstrap.sql
docker compose ps
curl -fsS -o /dev/null -w 'Portal HTTP %{http_code}\n' http://127.0.0.1:3200/portal/
```

Bootstrap refuses any existing authorization data. It creates a synthetic VCP
Demo Company and maps the two generated Keycloak users. It does not copy local
laptop state, customer users, applications, or Stage/Prod release records.

## Open on laptop

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 3200:127.0.0.1:3200 -L 8083:127.0.0.1:8083 lhost@10.0.32.115
```

Keep that terminal running; open http://localhost:3200/portal/. Use `localhost`
consistently, not 127.0.0.1 in the browser. Existing Stage tunnels can stay open.
View `/mnt/data/vcp-platform/private/initial-credentials.json` with a local editor
on Ubuntu; do not paste its contents into chat or CI logs. The portal operator is
`vibe-operator`, company login `company-user`, identity admin `platform-admin`.
Both portal users must enroll a new authenticator for THIS identity instance;
their laptop Keycloak MFA registrations are not copied. Check host/phone clocks.

Verify operator/company login, logout, company scope and a sensitive action.
Sensitive actions require a signed `otp` authentication method; fail closed if
the provider does not supply it. Do not weaken the policy to make a demo work.
Password reset/email delivery is disabled until a mail service is configured.

## Recovery

Use `docker compose logs --tail 80 platform identity` locally; redact sensitive
content before sharing. Do not delete data directories, use `down -v`, or rerun
SQL bootstrap to recover a login failure. Back up both databases before upgrades.
Keycloak imports a realm only on first creation; changes to its import file do
not modify an existing realm. App startup runs platform schema migrations; an
image rollback does not reverse those migrations. This is not a zero-downtime
or production-ready installation.

## Local verification evidence (2026-09-07)

- Container build and TypeScript/portal compilation passed.
- Platform suite: 142 passed, 17 optional integration tests skipped.
- Preparation tests: 2 passed (unique secrets, permissions, no secret output,
  location and overwrite guards).
- Real four-container rehearsal: separate PostgreSQL databases, persisted
  Keycloak realm, platform migrations and loopback portal HTTP 200.
- Login entry returns 302 to the exact expected localhost:8083 realm; full
  interactive password/MFA login must still be rehearsed on the Ubuntu host.
- Synthetic authorization bootstrap succeeded; data survived container/network
  recreation and repeated bootstrap was refused without altering roles.
- Rendered Compose checks: only two host-loopback published ports, no database
  ports, synthetic auth disabled, token introspection and OTP policy enabled.

These checks are not an Ubuntu deployment result or a production security audit.
