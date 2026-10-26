import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('prepare_share', Path(__file__).parents[1] / 'prepare-share.py')
share = importlib.util.module_from_spec(spec)
spec.loader.exec_module(share)


class SharingBoundaryTest(unittest.TestCase):
    def test_runtime_and_identity_files_are_excluded(self):
        for path in ['.git/config', '.github/workflows/release.yml', 'household/.env',
                     'tv/local.properties', 'tv/keystore.properties', 'tv/private.jks',
                     'household/profile.sqlite', 'household/log.local.log',
                     'artifacts/sharing/private-rules.json', 'docs/household/private-capture.png',
                     'docs/household/test-results.xml', 'app/node_modules/package/index.js']:
            with self.subTest(path=path):
                self.assertFalse(share.allowed(path))

    def test_code_and_license_files_remain_available(self):
        for path in ['LICENSE', 'LICENSE-ANIME4K', 'household/.env.example',
                     'tv/app/src/main/AndroidManifest.xml', 'shared/local/local.js',
                     'docs/household/FORK-ADDITIONS.md']:
            with self.subTest(path=path):
                self.assertTrue(share.allowed(path))

    def test_personal_terms_paths_and_credentials_are_detected(self):
        self.assertIn('private-term', share.findings('Viewer: PRIVATE_NAME', ['private_name']))
        self.assertIn('user-path', share.findings('C:' + '\\' + 'Users' + '\\' + 'PrivateName/file', []))
        self.assertIn('user-path', share.findings('C:' + '\\\\' + 'Users' + '\\\\' + 'PrivateName/file', []))
        self.assertIn('credential-url', share.findings('token=' + 'a' * 24, []))
        self.assertIn('email', share.findings('private' + '@' + 'private-domain.com', []))

    def test_reserved_test_addresses_and_kotlin_labels_are_not_personal_email(self):
        self.assertFalse(share.findings('viewer@example.invalid this@SeriesPlaybackTest.then', []))

    def test_only_upstream_public_email_metadata_is_exempted(self):
        contact = 'public' + '@' + 'upstream-domain.com'
        self.assertFalse(share.findings(contact, [], {contact}))
        self.assertIn('private-term', share.findings(contact, ['upstream-domain'], {contact}))


if __name__ == '__main__':
    unittest.main()
