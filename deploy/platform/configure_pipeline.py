"""Bind one registered demo application to Actions; prompt for the token privately."""
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request


def configure(root=Path('/mnt/data/vcp-platform')):
    root = root.resolve()
    private = root / 'private'
    target = private / 'github.env'
    if not private.is_dir() or private.is_symlink() or target.exists() or target.is_symlink():
        raise ValueError('Private directory missing or github.env already exists; refusing overwrite.')
    if private.stat().st_mode & 0o077:
        raise ValueError('Private directory must have mode 0700.')
    # Fixed demo binding. Never let an arbitrary company claiming the same URL deploy here.
    query = "SELECT id::text FROM applications WHERE company_id='company-a' AND repository_url IN ('https://github.com/prasath-local-host/verdikjede-ki-demo.git', 'https://github.com/prasath-local-host/verdikjede-ki-demo');"
    result = subprocess.run(['docker', 'compose', 'exec', '-T', 'platform-db', 'psql', '-U', 'vcp', '-d', 'vcp', '-At', '-c', query], cwd=root, check=True, capture_output=True, text=True, timeout=30)
    ids = result.stdout.strip().splitlines()
    if len(ids) != 1 or not re.fullmatch('[0-9a-f-]{36}', ids[0]):
        raise ValueError('Expected exactly one registered demo repository under company-a; resolve duplicates in the portal first.')
    token = getpass.getpass('Paste the fine-grained GitHub token (hidden): ').strip()
    if not re.fullmatch('[A-Za-z0-9_]+', token):
        raise ValueError('Invalid token format.')
    source = 'prasath-local-host/verdikjede-ki-demo'
    workflow = 'prasath-local-host/vibe-platform-architecture-spikes'
    # Read-only preflight. No workflow is dispatched by configuration.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for repo, path in [(source, 'commits/main'), (workflow, 'actions/workflows/demo-build.yml'), (workflow, 'actions/workflows/demo-deploy.yml')]:
        request = urllib.request.Request(f'https://api.github.com/repos/{repo}/{path}', headers={
            'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10'})
        try:
            with opener.open(request, timeout=20) as response:
                data = json.load(response)
                if path.startswith('actions/') and data.get('state') != 'active':
                    raise ValueError('Workflow is not active.')
        except Exception:
            raise ValueError('GitHub preflight failed. Check token access and active workflows; no configuration was written.') from None
    values = {'DEMO_PIPELINE_ENABLED': 'true', 'DEMO_PIPELINE_COMPANY_ID': 'company-a',
              'DEMO_PIPELINE_APPLICATION_ID': ids[0], 'DEMO_PIPELINE_SOURCE_REPOSITORY': source,
              'DEMO_PIPELINE_WORKFLOW_REPOSITORY': workflow,
              'DEMO_PIPELINE_WORKFLOW_BRANCH': 'codex/vibe-2-control-plane', 'DEMO_PIPELINE_TOKEN': token}
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(''.join(f'{key}={value}\n' for key, value in values.items()))
    print('Demo application bound. Private GitHub settings saved; no build or deployment started.')
    print('Recreate only the platform service to load the settings. Never paste github.env or rendered Compose output into chat.')


if __name__ == '__main__':
    try:
        configure()
    except (ValueError, subprocess.SubprocessError) as error:
        # Do not print subprocess payloads or environment values.
        raise SystemExit(str(error) if isinstance(error, ValueError) else 'Database lookup failed; check that the platform database is running.')
