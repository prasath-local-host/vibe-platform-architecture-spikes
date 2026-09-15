#!/usr/bin/env bash
# Run from the exact reviewed platform checkout as the existing runner account.
set -euo pipefail
cd /mnt/data/vcp-platform
test -d source/.git
test "$(stat -c %u /mnt/data/vcp-demo)" = "$(id -u)" || { echo 'Run as the existing demo runner account.'; exit 1; }
test -z "$(git -C source status --porcelain --untracked-files=no)" || { echo 'Platform checkout has tracked changes; resolve them first.'; exit 1; }
revision="$(git -C source rev-parse HEAD)"
test -f source/.github/workflows/todo-build.yml
test -f source/.github/workflows/todo-deploy.yml

# Check the new ports without modifying or stopping any existing service.
python3 - <<'PY'
import socket
sockets = []
try:
    for port in (3111, 3110):
        listener = socket.socket()
        sockets.append(listener)
        listener.bind(('127.0.0.1', port))
except OSError:
    raise SystemExit('Daylist port 3111 or 3110 is in use; no deployment was started.')
finally:
    for listener in sockets:
        listener.close()
PY

# No customer environment files are copied. Daylist needs no application secrets.
if [ ! -d /mnt/data/vcp-daylist ]; then
  sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /mnt/data/vcp-daylist
fi
test ! -L /mnt/data/vcp-daylist
test "$(stat -c %u /mnt/data/vcp-daylist)" = "$(id -u)"
install -d -m 700 /mnt/data/vcp-daylist/secrets /mnt/data/vcp-daylist/state
python3 - <<'PY'
import os
from pathlib import Path
for name in ('stage', 'prod'):
    path = Path('/mnt/data/vcp-daylist/secrets') / (name + '.env')
    if path.is_symlink():
        raise SystemExit('Refusing a symlink environment file.')
    if not path.exists():
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
    if path.stat().st_mode & 0o077:
        raise SystemExit('Daylist environment files must have mode 0600.')
PY

if [ ! -e private/daylist.env ]; then
  python3 source/deploy/platform/configure_pipeline.py --daylist --reuse-token
fi

# Keep local Compose customizations and all other environment settings.
PLATFORM_TARGET_REVISION="$revision" python3 - <<'PY'
import os, re, shutil
from pathlib import Path
root = Path('/mnt/data/vcp-platform')
updates = {}
compose = root / 'compose.yaml'
text = compose.read_text()
if './private/daylist.env' not in text:
    anchor = '      - path: ./private/github.env\n        required: false'
    if text.count(anchor) != 1:
        raise SystemExit('Compose env_file layout differs; no configuration was overwritten. Add the Daylist env_file entry manually.')
    text = text.replace(anchor, anchor + '\n      - path: ./private/daylist.env\n        required: false')
updates[compose] = text
env = root / '.env'
text = env.read_text()
if len(re.findall(r'^PLATFORM_REVISION=.*$', text, re.M)) != 1:
    raise SystemExit('Expected exactly one PLATFORM_REVISION setting.')
updates[env] = re.sub(r'^PLATFORM_REVISION=.*$', 'PLATFORM_REVISION=' + os.environ['PLATFORM_TARGET_REVISION'], text, flags=re.M)
for path, text in updates.items():
    if path.is_symlink():
        raise SystemExit('Refusing symlink platform configuration.')
    backup = path.with_name(path.name + '.before-daylist')
    if not backup.exists():
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(path.read_bytes())
    temporary = path.with_name(path.name + '.daylist-new')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(text)
    temporary.replace(path)
PY

docker compose config --quiet
docker compose build platform
docker compose up -d --no-deps --wait --wait-timeout 120 platform
curl -fsS -o /dev/null http://127.0.0.1:3200/portal/
echo 'Daylist pipeline configured. Original demo preserved. No application build or deployment started.'
echo 'In the portal: company-b > Daylist > Use latest main > Build, test & scan > Deploy to Stage.'
echo 'After successful Stage verification, promote that same build to Prod.'
echo 'Daylist Stage: http://localhost:3111/ ; Daylist Prod: http://localhost:3110/'
