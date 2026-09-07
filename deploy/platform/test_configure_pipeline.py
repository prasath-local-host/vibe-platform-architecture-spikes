import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('configure_pipeline', Path(__file__).with_name('configure_pipeline.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PipelineConfigurationTests(unittest.TestCase):
    def test_private_write_no_dispatch_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'private').mkdir(mode=0o700)
            opener = Mock()
            opener.open.side_effect = [io.BytesIO(b'{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'),
                                        io.BytesIO(b'{"state":"active"}'), io.BytesIO(b'{"state":"active"}')]
            with patch.object(module.subprocess, 'run', return_value=Mock(stdout='11111111-1111-4111-8111-111111111111\n')), \
                 patch.object(module.getpass, 'getpass', return_value='test_token_not_real'), \
                 patch.object(module.urllib.request, 'build_opener', return_value=opener), \
                 patch('sys.stdout', new_callable=io.StringIO) as output:
                module.configure(root)
                self.assertNotIn('test_token_not_real', output.getvalue())
                target = root / 'private/github.env'
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                self.assertIn('DEMO_PIPELINE_APPLICATION_ID=11111111-1111-4111-8111-111111111111', target.read_text())
                self.assertTrue(all(call.args[0].get_method() == 'GET' for call in opener.open.call_args_list))
                with self.assertRaisesRegex(ValueError, 'refusing overwrite'):
                    module.configure(root)

    def test_duplicate_registration_refused_before_token_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'private').mkdir(mode=0o700)
            with patch.object(module.subprocess, 'run', return_value=Mock(stdout='one\ntwo\n')), patch.object(module.getpass, 'getpass') as prompt:
                with self.assertRaisesRegex(ValueError, 'exactly one'):
                    module.configure(root)
                prompt.assert_not_called()
                self.assertFalse((root / 'private/github.env').exists())

    def test_failed_preflight_leaves_no_secret_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'private').mkdir(mode=0o700)
            opener = Mock()
            opener.open.side_effect = RuntimeError('private network details')
            with patch.object(module.subprocess, 'run', return_value=Mock(stdout='11111111-1111-4111-8111-111111111111\n')), \
                 patch.object(module.getpass, 'getpass', return_value='test_token_not_real'), \
                 patch.object(module.urllib.request, 'build_opener', return_value=opener):
                with self.assertRaisesRegex(ValueError, 'GitHub preflight failed'):
                    module.configure(root)
                self.assertFalse((root / 'private/github.env').exists())
