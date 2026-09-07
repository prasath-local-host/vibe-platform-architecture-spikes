"""One-time SSH-only preparation. Generate secrets locally; never print them."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess


def prepare(root, source):
    root = root.resolve()
    source = source.resolve()
    if source != root / 'source':
        raise ValueError('Checkout must be source inside the chosen platform root')
    if not root.is_dir() or any((root / name).exists() for name in ('private', '.env', 'data', 'compose.yaml')):
        raise ValueError('Refusing to overwrite existing configuration or database')
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Invalid source revision')
    if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Source checkout must be clean')
    root.chmod(0o700)
    private = root / 'private'
    private.mkdir(mode=0o700)
    (root / 'data').mkdir(mode=0o700)
    values = {key: secrets.token_urlsafe(32) for key in (
        'PLATFORM_DB_PASSWORD', 'IDENTITY_DB_PASSWORD', 'IDENTITY_ADMIN_PASSWORD',
        'OIDC_CLIENT_SECRET', 'OPERATOR_PASSWORD', 'COMPANY_USER_PASSWORD')}
    realm = json.loads((source / 'keycloak/vibe-realm.json').read_text())
    realm['sslRequired'] = 'none'  # Private SSH-only HTTP fixture, never public.
    realm['registrationAllowed'] = False
    realm['resetPasswordAllowed'] = False  # No mail service configured.
    client = next(c for c in realm['clients'] if c['clientId'] == 'vibe-control-plane')
    client['secret'] = values['OIDC_CLIENT_SECRET']
    client['directAccessGrantsEnabled'] = False
    client['redirectUris'] = ['http://localhost:3200/auth/callback']
    client['webOrigins'] = ['http://localhost:3200']
    client['attributes']['post.logout.redirect.uris'] = 'http://localhost:3200/portal/'
    for user in realm['users']:
        key = {'vibe-operator': 'OPERATOR_PASSWORD', 'company-user': 'COMPANY_USER_PASSWORD'}[user['username']]
        user['credentials'] = [{'type': 'password', 'value': values[key], 'temporary': False}]
        user['requiredActions'] = ['CONFIGURE_TOTP']
    (private / 'vibe-realm.json').write_text(json.dumps(realm, indent=2) + '\n')
    # Parent 0700 protects the host file. Its individual bind mount must be
    # readable by Keycloak's UID, which may differ from the Ubuntu operator.
    (private / 'vibe-realm.json').chmod(0o644)
    env = {key: value for key, value in values.items() if key not in ('OPERATOR_PASSWORD', 'COMPANY_USER_PASSWORD')}
    env['PLATFORM_REVISION'] = revision
    (root / '.env').write_text(''.join(f'{key}={value}\n' for key, value in env.items()))
    (root / '.env').chmod(0o600)
    credentials = {'identity_admin_username': 'platform-admin',
                   'identity_admin_password': values['IDENTITY_ADMIN_PASSWORD'],
                   'operator_username': 'vibe-operator', 'operator_password': values['OPERATOR_PASSWORD'],
                   'company_username': 'company-user', 'company_password': values['COMPANY_USER_PASSWORD']}
    (private / 'initial-credentials.json').write_text(json.dumps(credentials, indent=2) + '\n')
    (private / 'initial-credentials.json').chmod(0o600)
    shutil.copyfile(source / 'deploy/platform/compose.yaml', root / 'compose.yaml')
    print('Prepared SSH-only platform. Secrets stay in private local files. No services started.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('/mnt/data/vcp-platform'))
    args = parser.parse_args()
    os.umask(0o077)
    prepare(args.root, Path(__file__).resolve().parents[2])
