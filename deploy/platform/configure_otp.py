"""Add verified-OTP AMR reporting to the existing SSH-only realm; preserve users."""
import argparse
import datetime
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid

REFERENCE = {'default.reference.value': 'otp', 'default.reference.maxAge': '300'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def configure(api, backup):
    realm = api('GET', '/admin/realms/vibe')
    clients = api('GET', '/admin/realms/vibe/clients?clientId=vibe-control-plane')
    if len(clients) != 1 or clients[0].get('authenticationFlowBindingOverrides'):
        raise ValueError('Expected one portal client using the realm browser flow')
    mappers = api('GET', '/admin/realms/vibe/clients/' + clients[0]['id'] + '/protocol-mappers/models')
    if not any(m.get('protocolMapper') == 'oidc-amr-mapper' and m.get('config', {}).get('access.token.claim') == 'true' for m in mappers):
        raise ValueError('Portal access-token AMR mapper is missing; no changes made')
    flow = urllib.parse.quote(realm['browserFlow'], safe='')
    path = '/admin/realms/vibe/authentication'
    executions = api('GET', path + '/flows/' + flow + '/executions')
    candidates = [e for e in executions if e.get('providerId') == 'auth-otp-form'
                  and e.get('requirement') in ('REQUIRED', 'ALTERNATIVE')]
    if len(candidates) != 1:
        raise ValueError('Expected one enabled OTP form; refusing ambiguous flow')
    execution = candidates[0]
    config_id = execution.get('authenticationConfig')
    previous = api('GET', path + '/config/' + config_id) if config_id else None
    values = dict((previous or {}).get('config', {}))
    if all(values.get(key) == value for key, value in REFERENCE.items()):
        print('OTP reference already configured; users and flows unchanged.')
        return
    if previous:
        raise ValueError('OTP already has custom configuration; refusing to alter a potentially shared config')
    backup({'realm': 'vibe', 'browserFlow': realm['browserFlow'], 'execution': execution, 'previousConfig': previous})
    values.update(REFERENCE)
    payload = {'alias': 'vcp-otp-reference-' + execution['id'], 'config': values}
    api('POST', path + '/executions/' + execution['id'] + '/config', payload)
    updated = next(e for e in api('GET', path + '/flows/' + flow + '/executions') if e['id'] == execution['id'])
    confirmed = api('GET', path + '/config/' + updated['authenticationConfig'])
    if not all(confirmed['config'].get(key) == value for key, value in REFERENCE.items()):
        raise ValueError('OTP configuration read-back failed; inspect saved backup')
    print('Verified: only successful OTP executions report otp (reference lifetime 300s).')
    print('Users, passwords, MFA enrollment and flow requirements were not changed. Sign in afresh.')


def main(root):
    private = root / 'private'
    credentials_path = private / 'initial-credentials.json'
    if credentials_path.is_symlink() or credentials_path.stat().st_mode & 0o077:
        raise ValueError('Credentials must be a private regular file with mode 600')
    credentials = json.loads(credentials_path.read_text())
    base = 'http://127.0.0.1:8083'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    form = urllib.parse.urlencode({'grant_type': 'password', 'client_id': 'admin-cli',
        'username': credentials['identity_admin_username'], 'password': credentials['identity_admin_password']}).encode()
    try:
        with opener.open(urllib.request.Request(base + '/realms/master/protocol/openid-connect/token', data=form), timeout=15) as response:
            token = json.load(response)['access_token']
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Identity admin login failed (HTTP {error.code}); no configuration changed') from None

    def api(method, path, payload=None):
        request = urllib.request.Request(base + path, method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with opener.open(request, timeout=15) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Identity configuration request failed (HTTP {error.code})') from None

    def backup(value):
        name = 'otp-reference-backup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex + '.json'
        with (private / name).open('x') as stream:
            json.dump(value, stream, indent=2)
        print('Saved previous OTP configuration in the private directory.')

    configure(api, backup)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('/mnt/data/vcp-platform'))
    args = parser.parse_args()
    os.umask(0o077)
    main(args.root)
