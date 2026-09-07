import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
repo = Path(__file__).resolve().parents[2]


class PreparationTests(unittest.TestCase):
    def test_private_unique_credentials_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source'
            (source / 'keycloak').mkdir(parents=True)
            (source / 'deploy/platform').mkdir(parents=True)
            shutil.copyfile(repo / 'keycloak/vibe-realm.json', source / 'keycloak/vibe-realm.json')
            shutil.copyfile(repo / 'deploy/platform/compose.yaml', source / 'deploy/platform/compose.yaml')
            output = io.StringIO()
            with patch.object(module.subprocess, 'check_output', side_effect=['a' * 40, '']), contextlib.redirect_stdout(output):
                module.prepare(root, source)
            env = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines())
            creds = json.loads((root / 'private/initial-credentials.json').read_text())
            realm = json.loads((root / 'private/vibe-realm.json').read_text())
            client = realm['clients'][0]
            self.assertEqual(client['secret'], env['OIDC_CLIENT_SECRET'])
            self.assertFalse(client['directAccessGrantsEnabled'])
            self.assertEqual(client['redirectUris'], ['http://localhost:3200/auth/callback'])
            passwords = [creds[key] for key in creds if key.endswith('_password')]
            self.assertEqual(len(set(passwords)), 3)
            self.assertTrue(all(len(value) > 32 for value in passwords))
            self.assertTrue(all(user['requiredActions'] == ['CONFIGURE_TOTP'] for user in realm['users']))
            for value in [*passwords, env['OIDC_CLIENT_SECRET']]:
                self.assertNotIn(value, output.getvalue())
            self.assertEqual((root / '.env').stat().st_mode & 0o777, 0o600)
            self.assertEqual((root / 'private').stat().st_mode & 0o777, 0o700)
            self.assertEqual((root / 'private/initial-credentials.json').stat().st_mode & 0o777, 0o600)
            before = (root / '.env').read_bytes()
            with self.assertRaises(ValueError):
                module.prepare(root, source)
            self.assertEqual((root / '.env').read_bytes(), before)

    def test_refuses_wrong_checkout_location(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                module.prepare(Path(temp), Path(temp) / 'wrong')


if __name__ == '__main__':
    unittest.main()
