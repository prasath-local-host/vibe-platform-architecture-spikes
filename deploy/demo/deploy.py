"""Bounded single-host demo deployment. Never runs customer scripts on the host."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request


def docker(*args):
    result = subprocess.run(['docker', *args], check=True, capture_output=True, text=True, timeout=180)
    return result.stdout.strip()


def validate_manifest(manifest):
    for field, pattern in [('source_revision', r'[0-9a-f]{40}'), ('image_id', r'sha256:[0-9a-f]{64}'), ('tar_sha256', r'[0-9a-f]{64}'), ('workflow_run_id', r'[0-9]+')]:
        if not re.fullmatch(pattern, str(manifest.get(field, ''))):
            raise ValueError('Invalid release manifest field: ' + field)
    if manifest.get('security_policy') != 'block-high-critical-unknown/v1':
        raise ValueError('Security approval missing')


def require_stage(manifest, receipt):
    if receipt.get('manifest') != manifest or receipt.get('status') != 'healthy':
        raise ValueError('This exact artifact must be the current healthy Stage release')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check_health(port, revision):
    base = f'http://127.0.0.1:{port}'
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    # Bound responses and refuse redirects from customer-controlled health endpoints.
    for attempt in range(20):
        try:
            with client.open(base + '/api/health', timeout=8) as response:
                if json.loads(response.read(65536)).get('revision') != revision:
                    raise ValueError('Wrong deployed revision')
            with client.open(base + '/api/ready', timeout=8) as response:
                if json.loads(response.read(65536)).get('status') != 'ready':
                    raise ValueError('Database is not ready')
            with client.open(base + '/login', timeout=8) as response:
                if response.status != 200:
                    raise ValueError('Login page is not ready')
            return
        except Exception:
            if attempt == 19:
                raise RuntimeError('Deployment startup/database/login verification failed') from None
            time.sleep(2)


def inspect_owned(name, environment):
    if not re.fullmatch(r'vcp-demo-(stage|prod)-[0-9]+-[0-9]+', name):
        raise ValueError('Invalid managed container name')
    info = json.loads(docker('inspect', name))[0]
    if info['Config']['Labels'].get('vcp.demo.environment') != environment:
        raise ValueError('Refusing to alter a container outside this environment')
    return info


def atomic_json(path, value):
    temp = path.with_suffix('.tmp')
    with temp.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def deploy(environment, candidate, root):
    if environment not in ('stage', 'prod'):
        raise ValueError('Unknown environment')
    manifest = json.loads((candidate / 'release.json').read_text())
    validate_manifest(manifest)
    image_tar = candidate / 'image.tar'
    if digest(image_tar) != manifest['tar_sha256']:
        raise ValueError('Artifact digest mismatch')
    secrets = root / 'secrets' / f'{environment}.env'
    if not secrets.is_file() or secrets.is_symlink() or secrets.stat().st_mode & 0o077:
        raise ValueError('Environment file must exist, not be a symlink, and have mode 600')
    state = root / 'state'
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'deployment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if environment == 'prod':
            stage = json.loads((state / 'stage.json').read_text())
            require_stage(manifest, stage)
            inspect_owned(stage['container'], 'stage')
            check_health(3101, manifest['source_revision'])
        receipt_path = state / f'{environment}.json'
        previous = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
        if previous:
            inspect_owned(previous['container'], environment)
        docker('load', '--input', str(image_tar))
        if docker('image', 'inspect', manifest['image_id'], '--format', '{{.Id}}') != manifest['image_id']:
            raise ValueError('Loaded image differs from approved image')
        name = f"vcp-demo-{environment}-{manifest['workflow_run_id']}-{time.time_ns()}"
        network = f'vcp-demo-{environment}'
        try:
            docker('network', 'inspect', network)
        except subprocess.CalledProcessError:
            docker('network', 'create', network)
        port = 3101 if environment == 'stage' else 3100

        def start(binding):
            docker('run', '-d', '--name', name, '--label', f'vcp.demo.environment={environment}',
                   '--restart', 'unless-stopped', '--read-only', '--cap-drop', 'ALL',
                   '--security-opt', 'no-new-privileges', '--user', '1000:1000',
                   '--pids-limit', '256', '--memory', '2g', '--cpus', '1',
                   '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
                   '--tmpfs', '/app/.next/cache:rw,noexec,nosuid,size=64m,uid=1000,gid=1000',
                   '--network', network, '--env-file', str(secrets),
                   '--env', 'VCP_SOURCE_REVISION=' + manifest['source_revision'],
                   '-p', binding, manifest['image_id'])

        changed = False
        try:
            start('127.0.0.1::3000')
            mapped = docker('port', name, '3000/tcp')
            match = re.fullmatch(r'127\.0\.0\.1:(\d+)', mapped)
            if not match:
                raise ValueError('Unexpected candidate binding')
            check_health(int(match[1]), manifest['source_revision'])
            inspect_owned(name, environment)
            docker('rm', '-f', name)
            if previous:
                docker('stop', previous['container'])
            changed = True
            start(f'127.0.0.1:{port}:3000')
            check_health(port, manifest['source_revision'])
            receipt = {'status': 'healthy', 'manifest': manifest, 'container': name,
                       'previous_container': previous['container'] if previous else None,
                       'deployed_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            atomic_json(state / f'{name}.json', receipt)
            atomic_json(receipt_path, receipt)
            print(f'{environment}: healthy, revision {manifest["source_revision"]}, image {manifest["image_id"]}')
        except Exception:
            try:
                inspect_owned(name, environment)
                docker('rm', '-f', name)
            except subprocess.CalledProcessError:
                pass
            if changed and previous:
                docker('start', previous['container'])
                check_health(port, previous['manifest']['source_revision'])
                print('Previous release restored and health verified')
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('environment', choices=['stage', 'prod'])
    parser.add_argument('--candidate', type=Path, required=True)
    args = parser.parse_args()
    deploy(args.environment, args.candidate.resolve(), Path('/mnt/data/vcp-demo'))
