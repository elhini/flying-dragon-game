import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import os
import subprocess
import sys
import shutil


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('receiver', ROOT / 'scripts/hoster_receiver.py')
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)
sys.path.insert(0, str(ROOT / 'scripts'))
import deploy as client


def package(release_id='a' * 32):
    files = {}
    for name in ['index.html', 'assets/index.new.js', 'assets/index.new.css', 'assets/player.new.png']:
        content = ('new ' + name).encode()
        files[name] = {'content': base64.b64encode(content).decode(), 'sha256': hashlib.sha256(content).hexdigest()}
    return {'id': release_id, 'files': files}


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = Path(self.temp.name).resolve() / 'site'
        self.web = self.site / 'flying-dragon-game'
        self.state = Path(self.temp.name).resolve() / 'state'
        for name in ['index.html', 'en/index.html', '.htaccess', '.well-known/acme-challenge/token', 'another-project/index.html', 'flying-dragon-game/index.html', 'flying-dragon-game/assets/index.old.js', 'flying-dragon-game/assets/index.old.css']:
            target = self.site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('old ' + name)
        self.original = self.snapshot()

    def snapshot(self):
        return {str(p.relative_to(self.site)): p.read_bytes() for p in self.site.rglob('*') if p.is_file()}

    def test_deploy_and_rollback_preserve_neighbors_and_cached_css(self):
        result = receiver.apply_release(package(), str(self.web), str(self.state))
        self.assertEqual(result['verified_files'], 4)
        for name in ['index.html', 'en/index.html', '.htaccess', '.well-known/acme-challenge/token', 'another-project/index.html', 'flying-dragon-game/assets/index.old.js', 'flying-dragon-game/assets/index.old.css']:
            self.assertEqual((self.site / name).read_bytes(), self.original[name])
        receiver.rollback_release('a' * 32, str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), self.original)

    def test_invalid_paths_hashes_and_missing_files_never_change_site(self):
        for kind in ['traversal', 'extra', 'hash', 'missing']:
            with self.subTest(kind=kind):
                value = package()
                if kind == 'traversal': value['files']['../private'] = value['files'].pop('assets/index.new.css')
                if kind == 'extra': value['files']['code.php'] = value['files']['index.html']
                if kind == 'hash': value['files']['index.html']['sha256'] = '0' * 64
                if kind == 'missing': del value['files']['index.html']
                with self.assertRaises(ValueError): receiver.apply_release(value, str(self.web), str(self.state))
                self.assertEqual(self.snapshot(), self.original)

    def test_symlink_is_rejected_before_any_write(self):
        target = self.web / 'assets/index.new.js'
        outside = Path(self.temp.name) / 'private'
        outside.write_text('private')
        target.symlink_to(outside)
        with self.assertRaises(ValueError): receiver.apply_release(package(), str(self.web), str(self.state))
        self.assertEqual(outside.read_text(), 'private')
        self.assertEqual((self.web / 'index.html').read_bytes(), self.original['flying-dragon-game/index.html'])

    def test_new_assets_directory_is_readable_with_private_process_umask(self):
        shutil.rmtree(self.web / 'assets')
        previous = os.umask(0o077)
        try:
            receiver.apply_release(package(), str(self.web), str(self.state))
        finally:
            os.umask(previous)
        self.assertEqual((self.web / 'assets').stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.web / 'assets/index.new.js').stat().st_mode & 0o777, 0o644)

    def test_write_failure_restores_previous_site(self):
        rename = receiver.os.rename
        def fail_once(source, target):
            if str(target) == str(self.web / 'index.html') and '/stage/' in str(source):
                raise OSError('simulated write failure')
            return rename(source, target)
        with patch.object(receiver.os, 'rename', side_effect=fail_once):
            with self.assertRaises(OSError): receiver.apply_release(package(), str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), self.original)

    def test_rollback_does_not_overwrite_manual_edits(self):
        receiver.apply_release(package(), str(self.web), str(self.state))
        (self.web / 'index.html').write_text('manual edit')
        before = self.snapshot()
        with self.assertRaises(ValueError): receiver.rollback_release('a' * 32, str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), before)

    def test_only_latest_snapshot_retained_and_old_rollback_rejected(self):
        receiver.apply_release(package(), str(self.web), str(self.state))
        receiver.apply_release(package('b' * 32), str(self.web), str(self.state))
        self.assertEqual(sorted(p.name for p in self.state.iterdir() if p.is_dir()), ['b' * 32])
        with self.assertRaises(ValueError): receiver.rollback_release('a' * 32, str(self.web), str(self.state))

    def test_client_requests_rollback_after_https_failure_and_cleans_key(self):
        key_paths = []
        def ssh(args, **kwargs):
            key = Path(args[args.index('-i') + 1])
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            key_paths.append(key)
            value = {'id': 'a' * 32, 'verified_files': 4} if args[-1] == 'deploy' else {'rolled_back': 'a' * 32}
            return subprocess.CompletedProcess(args, 0, json.dumps(value).encode(), b'')
        env = {'HOSTER_HOST': 'host.example', 'HOSTER_USER': 'deploy', 'HOSTER_SSH_KEY': 'test-key', 'HOSTER_KNOWN_HOSTS': 'test-host', 'GITHUB_SHA': '', 'DEPLOY_URL': 'https://example.com/flying-dragon-game/'}
        with patch.dict(os.environ, env), patch.object(client, 'build_package', return_value=package()), patch.object(client, 'verify_site', side_effect=ValueError('HTTPS failure')), patch.object(client.time, 'sleep'), patch.object(client.subprocess, 'run', side_effect=ssh) as run:
            with self.assertRaises(ValueError): client.main()
        self.assertEqual(run.call_args_list[-1].args[0][-1], 'rollback ' + 'a' * 32)
        self.assertTrue(all(not path.exists() for path in key_paths))

    def test_superseded_commit_cannot_deploy(self):
        with patch.dict(os.environ, {'GITHUB_SHA': 'old'}), patch.object(client.subprocess, 'check_output', return_value='new\trefs/heads/master\n'), patch.object(client, 'build_package') as build:
            client.main()
        build.assert_not_called()

    def test_ssh_response_loss_still_attempts_rollback(self):
        calls = []
        def ssh(args, **kwargs):
            calls.append(args[-1])
            if args[-1] == 'deploy': raise subprocess.TimeoutExpired(args, 120)
            return subprocess.CompletedProcess(args, 0, b'{}', b'')
        env = {'HOSTER_HOST': 'host.example', 'HOSTER_USER': 'deploy', 'HOSTER_SSH_KEY': 'test-key', 'HOSTER_KNOWN_HOSTS': 'test-host', 'GITHUB_SHA': '', 'DEPLOY_URL': 'https://example.com/flying-dragon-game/'}
        with patch.dict(os.environ, env), patch.object(client, 'build_package', return_value=package()), patch.object(client.subprocess, 'run', side_effect=ssh):
            with self.assertRaises(subprocess.TimeoutExpired): client.main()
        self.assertEqual(calls, ['deploy', 'rollback ' + 'a' * 32])

    def test_unapproved_apache_handlers_are_rejected(self):
        value = package()
        content = b'AddHandler application/x-httpd-php .html'
        value['files']['.htaccess'] = {'content': base64.b64encode(content).decode(), 'sha256': hashlib.sha256(content).hexdigest()}
        with self.assertRaises(ValueError): receiver.apply_release(value, str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), self.original)

    def test_hard_interruption_is_recovered_by_next_deploy(self):
        code = '''import json,os,sys
sys.path.insert(0,sys.argv[1])
import hoster_receiver as r
rename=r.os.rename
def interrupt(source,target):
    rename(source,target)
    if target.endswith('/index.html'):os._exit(77)
r.os.rename=interrupt
r.apply_release(json.load(sys.stdin),sys.argv[2],sys.argv[3])
'''
        result = subprocess.run([sys.executable, '-c', code, str(ROOT / 'scripts'), str(self.web), str(self.state)], input=json.dumps(package()).encode())
        self.assertEqual(result.returncode, 77)
        receiver.apply_release(package('b' * 32), str(self.web), str(self.state))
        receiver.rollback_release('b' * 32, str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), self.original)

    def test_signal_immediately_after_publication_uses_persistent_journal(self):
        rename = receiver.os.rename
        fired = []
        def interrupted(source, target):
            rename(source, target)
            if str(target) == str(self.web / 'index.html') and not fired:
                fired.append(True)
                raise SystemExit('signal after rename')
        with patch.object(receiver.os, 'rename', side_effect=interrupted):
            with self.assertRaises(SystemExit): receiver.apply_release(package(), str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), self.original)
        self.assertFalse((self.state / 'pending').exists())

    def test_signal_after_latest_swap_restores_previous_pointer(self):
        receiver.apply_release(package(), str(self.web), str(self.state))
        before = self.snapshot()
        value = package('b' * 32)
        content = b'second version'
        value['files']['index.html'] = {'content': base64.b64encode(content).decode(), 'sha256': hashlib.sha256(content).hexdigest()}
        rename = receiver.os.rename
        fired = []
        def interrupted(source, target):
            rename(source, target)
            if str(target) == str(self.state / 'latest') and not fired:
                fired.append(True)
                raise SystemExit('signal after commit pointer')
        with patch.object(receiver.os, 'rename', side_effect=interrupted):
            with self.assertRaises(SystemExit): receiver.apply_release(value, str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), before)
        self.assertEqual((self.state / 'latest').read_text(), 'a' * 32)

    def test_interruption_while_writing_journal_does_not_block_next_deploy(self):
        write = receiver.write_file
        def interrupted(path, content, mode=0o600):
            if Path(path).name in ['pending', 'pending.tmp']:
                Path(path).write_bytes(b'')
                raise SystemExit('interrupted before journal write')
            return write(path, content, mode)
        with patch.object(receiver, 'write_file', side_effect=interrupted):
            with self.assertRaises(SystemExit): receiver.apply_release(package(), str(self.web), str(self.state))
        receiver.apply_release(package('b' * 32), str(self.web), str(self.state))
        receiver.rollback_release('b' * 32, str(self.web), str(self.state))
        self.assertEqual(self.snapshot(), self.original)


if __name__ == '__main__':
    unittest.main()
