import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('configure_otp', Path(__file__).with_name('configure_otp.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OtpConfigurationTests(unittest.TestCase):
    def fixture(self, previous=None, extra=False, mapper=True):
        state = {'previous': previous}
        execution = {'id': 'otp-id', 'providerId': 'auth-otp-form', 'requirement': 'ALTERNATIVE'}
        def api(method, path, payload=None):
            if method == 'POST':
                self.assertTrue(path.endswith('/executions/otp-id/config'))
                state['previous'] = {**payload, 'id': 'config-id'}
                return None
            if path == '/admin/realms/vibe':
                return {'browserFlow': 'browser'}
            if path.endswith('clients?clientId=vibe-control-plane'):
                return [{'id': 'client-id'}]
            if path.endswith('/protocol-mappers/models'):
                return [{'protocolMapper': 'oidc-amr-mapper', 'config': {'access.token.claim': 'true'}}] if mapper else []
            if path.endswith('/executions'):
                result = {**execution, **({'authenticationConfig': 'config-id'} if state['previous'] else {})}
                return [result, {**result, 'id': 'second-otp'}] if extra else [result]
            if path.endswith('/config/config-id'):
                return state['previous']
            raise AssertionError('Unexpected API call')
        return Mock(side_effect=api), state

    def test_only_completed_otp_reference_is_added_and_repeat_is_noop(self):
        api, state = self.fixture()
        backup = Mock()
        module.configure(api, backup)
        self.assertEqual(state['previous']['config'], module.REFERENCE)
        backup.assert_called_once()
        writes = [call for call in api.call_args_list if call.args[0] != 'GET']
        self.assertEqual(len(writes), 1)
        api.reset_mock()
        module.configure(api, backup)
        self.assertTrue(all(call.args[0] == 'GET' for call in api.call_args_list))

    def test_refuses_ambiguous_flow_missing_mapper_and_custom_configuration(self):
        for kwargs in ({'extra': True}, {'mapper': False}, {'previous': {'id': 'config-id', 'config': {'custom': 'keep'}}}):
            with self.subTest(kwargs=kwargs):
                api, state = self.fixture(**kwargs)
                with self.assertRaises(ValueError):
                    module.configure(api, Mock())
                self.assertTrue(all(call.args[0] == 'GET' for call in api.call_args_list))


if __name__ == '__main__':
    unittest.main()
