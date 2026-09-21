import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from updater.broker.releases import Releases
from updater.broker.auth import Denied


class DiscoveryBudgetTests(unittest.TestCase):
    def test_verified_candidate_survives_later_release_failure(self):
        for error in (Denied('verification deadline'), TimeoutError('network timeout'), ValueError('invalid manifest')):
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as work:
                releases = Releases({'mode': 'production'})
                index = [{'tag_name': 'v0.5.0'}, {'tag_name': 'v0.4.2'}, {'tag_name': 'v0.4.0'}]
                with patch('updater.broker.releases.transfer', return_value=json.dumps(index).encode()), patch.object(releases, 'verified_manifest', side_effect=[{'artifact': {'size': 123}}, error]) as verify:
                    result = releases.check(Path(work))
                self.assertEqual([entry['version'] for entry in result], ['v0.5.0'])
                self.assertTrue(result[0]['verified'])
                self.assertEqual(set(releases.entries), {'v0.5.0'})
                self.assertEqual(verify.call_count, 2)

    def test_first_candidate_failure_still_fails_closed(self):
        with tempfile.TemporaryDirectory() as work:
            releases = Releases({'mode': 'production'})
            with patch('updater.broker.releases.transfer', return_value=b'[{"tag_name":"v0.5.0"}]'), patch.object(releases, 'verified_manifest', side_effect=Denied('invalid signature')):
                with self.assertRaises(Denied):
                    releases.check(Path(work))
            self.assertEqual(releases.entries, {})

    def test_budget_and_signature_checks_remain_for_each_returned_release(self):
        with tempfile.TemporaryDirectory() as work:
            releases = Releases({'mode': 'production'})
            index = [{'tag_name': 'v0.6.0', 'prerelease': True}, {'tag_name': 'v0.5.0'}, {'tag_name': 'v0.4.2'}]
            with patch('updater.broker.releases.time.monotonic', return_value=100), patch('updater.broker.releases.transfer', return_value=json.dumps(index).encode()) as transfer, patch.object(releases, 'verified_manifest', return_value={'artifact': {'size': 123}}) as verify:
                result = releases.check(Path(work))
            self.assertEqual([entry['version'] for entry in result], ['v0.5.0', 'v0.4.2'])
            self.assertEqual(transfer.call_args.kwargs['deadline'], 108)
            self.assertEqual([c.args[0] for c in verify.call_args_list], ['v0.5.0', 'v0.4.2'])
            self.assertTrue(all(c.kwargs['deadline'] == 108 for c in verify.call_args_list))
