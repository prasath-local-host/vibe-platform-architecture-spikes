import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import json

spec = importlib.util.spec_from_file_location('demo_deploy', Path(__file__).with_name('deploy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReleasePolicyTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {'source_revision': 'a' * 40, 'image_id': 'sha256:' + 'b' * 64,
                         'tar_sha256': 'c' * 64, 'workflow_run_id': '123',
                         'security_policy': 'block-high-critical-unknown/v1'}

    def test_valid_manifest(self):
        module.validate_manifest(self.manifest)

    def test_untrusted_identifiers_are_rejected(self):
        for field in ['source_revision', 'image_id', 'tar_sha256', 'workflow_run_id', 'security_policy']:
            with self.assertRaises(ValueError):
                module.validate_manifest({**self.manifest, field: '$(bad-command)'})

    def test_prod_requires_exact_current_healthy_stage_artifact(self):
        module.require_stage(self.manifest, {'status': 'healthy', 'manifest': self.manifest})
        for receipt in [{}, {'status': 'failed', 'manifest': self.manifest}, {'status': 'healthy', 'manifest': {**self.manifest, 'image_id': 'sha256:' + 'd' * 64}}]:
            with self.assertRaises(ValueError):
                module.require_stage(self.manifest, receipt)

    def test_failed_replacement_restores_previous_container_and_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'secrets').mkdir()
            secret = root / 'secrets/stage.env'
            secret.write_text('fixture=true\n')
            secret.chmod(0o600)
            candidate = root / 'candidate'
            candidate.mkdir()
            (candidate / 'image.tar').write_bytes(b'fixture-image')
            manifest = {**self.manifest, 'tar_sha256': module.digest(candidate / 'image.tar')}
            (candidate / 'release.json').write_text(json.dumps(manifest))
            (root / 'state').mkdir()
            old = 'vcp-demo-stage-1-1'
            receipt = {'status': 'healthy', 'container': old, 'manifest': self.manifest}
            (root / 'state/stage.json').write_text(json.dumps(receipt))
            containers = {old: True}

            def fake_docker(*args):
                if args[0] == 'inspect':
                    if args[1] not in containers:
                        raise module.subprocess.CalledProcessError(1, ['docker'])
                    return json.dumps([{'Config': {'Labels': {'vcp.demo.environment': 'stage'}}}])
                if args[:2] == ('image', 'inspect'):
                    return manifest['image_id']
                if args[0] == 'run':
                    containers[args[args.index('--name') + 1]] = True
                if args[0] == 'port':
                    return '127.0.0.1:49100'
                if args[0] == 'rm':
                    containers.pop(args[-1])
                if args[0] == 'stop':
                    containers[args[1]] = False
                if args[0] == 'start':
                    containers[args[1]] = True
                return ''

            with patch.object(module, 'docker', side_effect=fake_docker), patch.object(module, 'check_health', side_effect=[None, RuntimeError('candidate failed'), None]):
                with self.assertRaisesRegex(RuntimeError, 'candidate failed'):
                    module.deploy('stage', candidate, root)
            self.assertEqual(containers, {old: True})
            self.assertEqual(json.loads((root / 'state/stage.json').read_text()), receipt)


if __name__ == '__main__':
    unittest.main()
