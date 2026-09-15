import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import json
import hashlib
import io
import tarfile


def image_fixture(path, revision='a' * 40, config_change=None, image_index=False, tag=None):
    config = {'os': 'linux', 'architecture': 'amd64', 'config': {'Cmd': ['node', 'server.js']},
              'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + 'f' * 64]}}
    config.update(config_change or {})
    raw = json.dumps(config).encode()
    config_id = 'sha256:' + hashlib.sha256(raw).hexdigest()
    config_path = 'blobs/sha256/' + config_id[7:]
    metadata = {'manifest.json': json.dumps([{'Config': config_path,
                 'RepoTags': [tag or 'vcp-demo:' + revision], 'Layers': ['layer.tar']}]).encode(),
                config_path: raw}
    image_id = config_id
    if image_index:
        for descriptor in [{'config': {'digest': config_id}}, {'manifests': None}]:
            if 'manifests' in descriptor:
                descriptor['manifests'] = [{'digest': image_id}]
            data = json.dumps(descriptor).encode()
            image_id = 'sha256:' + hashlib.sha256(data).hexdigest()
            metadata['blobs/sha256/' + image_id[7:]] = data
    with tarfile.open(path, 'w') as archive:
        for name, data in metadata.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    return image_id

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

    def test_daylist_uses_separate_ports_names_and_artifact_binding(self):
        self.assertEqual(module.deployment_settings('daylist'), ('vcp-daylist', 3111, 3110, '/'))
        self.assertEqual(module.deployment_settings('demo'), ('vcp-demo', 3101, 3100, '/login'))
        with self.assertRaises(ValueError):
            module.validate_profile_manifest(self.manifest, 'daylist')
        daylist = {**self.manifest, 'deployment_profile': 'daylist', 'source_repository': 'prasath-local-host/vcp-demo-todo'}
        module.validate_profile_manifest(daylist, 'daylist')
        with self.assertRaises(ValueError):
            module.validate_profile_manifest(daylist, 'demo')
        with patch.object(module, 'docker') as docker:
            with self.assertRaises(ValueError):
                module.inspect_owned('vcp-demo-stage-1-1', 'stage', 'vcp-daylist')
            docker.assert_not_called()
        with patch.object(module, 'docker', return_value=json.dumps([{'Config': {'Labels': {'vcp.demo.environment': 'stage'}}}])):
            with self.assertRaisesRegex(ValueError, 'outside this application'):
                module.inspect_owned('vcp-daylist-stage-1-1', 'stage', 'vcp-daylist')

    def test_untrusted_identifiers_are_rejected(self):
        for field in ['source_revision', 'image_id', 'tar_sha256', 'workflow_run_id', 'security_policy']:
            with self.assertRaises(ValueError):
                module.validate_manifest({**self.manifest, field: '$(bad-command)'})

    def test_prod_requires_exact_current_healthy_stage_artifact(self):
        module.require_stage(self.manifest, {'status': 'healthy', 'manifest': self.manifest})
        for receipt in [{}, {'status': 'failed', 'manifest': self.manifest}, {'status': 'healthy', 'manifest': {**self.manifest, 'image_id': 'sha256:' + 'd' * 64}}]:
            with self.assertRaises(ValueError):
                module.require_stage(self.manifest, receipt)

    def test_archive_accepts_config_and_oci_index_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'image.tar'
            config_id = image_fixture(archive)
            self.assertEqual(module.archive_identity(archive, config_id), config_id)
            index_id = image_fixture(archive, image_index=True)
            self.assertNotEqual(index_id, config_id)
            self.assertEqual(module.archive_identity(archive, index_id), config_id)

    def test_archive_rejects_wrong_tag_identity_and_platform(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'image.tar'
            config_id = image_fixture(archive)
            with self.assertRaises(ValueError):
                module.archive_identity(archive, config_id, 'vcp-demo:wrong')
            with self.assertRaises(ValueError):
                module.archive_identity(archive, 'sha256:' + '0' * 64)
            image_fixture(archive, config_change={'architecture': 'arm64'})
            with self.assertRaises(ValueError):
                module.archive_identity(archive)

    def test_archive_rejects_duplicate_config_and_symlink_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'image.tar'
            config_id = image_fixture(archive)
            with tarfile.open(archive, 'a') as stream:
                member = tarfile.TarInfo('blobs/sha256/' + config_id[7:])
                stream.addfile(member, io.BytesIO())
            with self.assertRaises(ValueError):
                module.archive_identity(archive)
            with tarfile.open(archive, 'w') as stream:
                member = tarfile.TarInfo('manifest.json')
                member.type = tarfile.SYMTYPE
                member.linkname = '/etc/passwd'
                stream.addfile(member)
            with self.assertRaises(ValueError):
                module.archive_identity(archive)

    def test_loaded_image_requires_exact_config_and_layers_for_both_stores(self):
        for indexed in (False, True):
            for change in (None, {'config': {'Cmd': ['unexpected']}},
                           {'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + 'd' * 64]}}):
                with self.subTest(indexed=indexed, change=change), tempfile.TemporaryDirectory() as temp:
                    archive = Path(temp) / 'image.tar'
                    approved_id = image_fixture(archive, image_index=indexed)
                    manifest = {**self.manifest, 'image_id': approved_id,
                                'tar_sha256': module.digest(archive)}
                    local_id = 'sha256:' + 'e' * 64
                    def fake_docker(*args):
                        if args[:2] == ('image', 'inspect'):
                            self.assertEqual(args[2], 'vcp-demo:' + self.manifest['source_revision'])
                            return local_id
                        if args[0] == 'save':
                            self.assertEqual(args[-1], local_id)
                            image_fixture(Path(args[2]), config_change=change)
                        return ''
                    with patch.object(module, 'docker', side_effect=fake_docker):
                        if change:
                            with self.assertRaisesRegex(ValueError, 'configuration or layers'):
                                module.load_verified_image(archive, manifest)
                        else:
                            self.assertEqual(module.load_verified_image(archive, manifest), local_id)
                    self.assertEqual(list(Path(temp).iterdir()), [archive])

    def test_bad_archive_checksum_fails_before_docker(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'image.tar'
            image_fixture(archive)
            with patch.object(module, 'docker') as docker:
                with self.assertRaisesRegex(ValueError, 'Artifact digest'):
                    module.load_verified_image(archive, self.manifest)
                docker.assert_not_called()

    def test_failed_replacement_restores_previous_container_and_receipt(self):
        self._failed_replacement_restores_previous('demo')

    def test_daylist_failed_replacement_restores_only_its_own_container_and_port(self):
        self._failed_replacement_restores_previous('daylist')

    def _failed_replacement_restores_previous(self, profile):
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
            if profile == 'daylist':
                manifest.update(deployment_profile='daylist', source_repository='prasath-local-host/vcp-demo-todo')
            (candidate / 'release.json').write_text(json.dumps(manifest))
            (root / 'state').mkdir()
            prefix, stage_port, _, _ = module.deployment_settings(profile)
            old = prefix + '-stage-1-1'
            receipt = {'status': 'healthy', 'container': old, 'manifest': self.manifest}
            (root / 'state/stage.json').write_text(json.dumps(receipt))
            containers = {old: True}

            def fake_docker(*args):
                if args[0] == 'inspect':
                    if args[1] not in containers:
                        raise module.subprocess.CalledProcessError(1, ['docker'])
                    return json.dumps([{'Config': {'Labels': {'vcp.demo.environment': 'stage', 'vcp.demo.application': prefix}}}])
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

            local_id = 'sha256:' + 'e' * 64
            with patch.object(module, 'load_verified_image', return_value=local_id), patch.object(module, 'docker', side_effect=fake_docker) as docker_mock, patch.object(module, 'check_health', side_effect=[None, RuntimeError('candidate failed'), None]):
                with self.assertRaisesRegex(RuntimeError, 'candidate failed'):
                    module.deploy('stage', candidate, root, profile)
                starts = [call.args for call in docker_mock.call_args_list if call.args[0] == 'run']
                self.assertEqual(len(starts), 2)
                self.assertTrue(all(args[-1] == local_id for args in starts))
                self.assertEqual(starts[1][starts[1].index('-p') + 1], f'127.0.0.1:{stage_port}:3000')
                self.assertTrue(all(args[args.index('--network') + 1] == prefix + '-stage' for args in starts))
            self.assertEqual(containers, {old: True})
            self.assertEqual(json.loads((root / 'state/stage.json').read_text()), receipt)


if __name__ == '__main__':
    unittest.main()
