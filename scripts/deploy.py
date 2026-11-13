"""Build a static release, send it over restricted SSH, verify HTTPS, roll back on failure."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request
import uuid

from hoster_receiver import decode_package, MAX_PAYLOAD


def build_package(directory):
    files = {}
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('Build output must not contain symlinks')
        if path.is_file():
            content = path.read_bytes()
            files[path.relative_to(directory).as_posix()] = {
                'content': base64.b64encode(content).decode('ascii'),
                'sha256': hashlib.sha256(content).hexdigest(),
            }
    package = {'id': uuid.uuid4().hex, 'files': files}
    decode_package(package)
    if len(json.dumps(package).encode()) > MAX_PAYLOAD:
        raise ValueError('Package is too large')
    return package


def verify_site(package):
    base = os.environ['DEPLOY_URL'].rstrip('/') + '/'
    if not base.startswith('https://'):
        raise ValueError('DEPLOY_URL must use HTTPS')
    for name, item in package['files'].items():
        route = '' if name == 'index.html' else name
        url = base + route + '?deployment=' + package['id']
        request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status != 200 or hashlib.sha256(response.read()).hexdigest() != item['sha256']:
                raise ValueError('HTTPS checksum mismatch: ' + name)


def main():
    commit = os.environ.get('GITHUB_SHA')
    if commit:
        current = subprocess.check_output(['git', 'ls-remote', 'origin', 'refs/heads/master'], text=True).split()[0]
        if current != commit:
            print('A newer commit is already on master; skipping superseded deployment.')
            return
    package = build_package(Path('dist'))
    host, user = os.environ['HOSTER_HOST'], os.environ['HOSTER_USER']
    if not re.fullmatch(r'[A-Za-z0-9.-]+', host) or not re.fullmatch(r'[A-Za-z0-9_-]+', user):
        raise ValueError('Invalid SSH destination')
    with tempfile.TemporaryDirectory() as directory:
        key = Path(directory) / 'key'
        known_hosts = Path(directory) / 'known_hosts'
        key.write_text(os.environ['HOSTER_SSH_KEY'].rstrip() + '\n')
        key.chmod(0o600)
        known_hosts.write_text(os.environ['HOSTER_KNOWN_HOSTS'].rstrip() + '\n')
        ssh = ['ssh', '-T', '-i', str(key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
               '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(known_hosts),
               '-o', 'ConnectTimeout=20', user + '@' + host]

        def remote(command, payload=None):
            result = subprocess.run(ssh + [command], input=payload, capture_output=True, timeout=120)
            if result.returncode:
                raise RuntimeError('SSH deployment command failed (exit %s)' % result.returncode)
            return json.loads(result.stdout)

        try:
            receipt = remote('deploy', json.dumps(package).encode())
            if receipt.get('id') != package['id'] or receipt.get('verified_files') != len(package['files']):
                raise ValueError('Invalid deployment receipt')
            for attempt in range(3):
                try:
                    verify_site(package)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(2)
        except BaseException:
            try:
                restored = remote('rollback ' + package['id'])
                if restored.get('rolled_back') != package['id']:
                    raise ValueError('Invalid rollback receipt')
                print('Deployment verification failed; previous site restored.')
            except Exception:
                print('Rollback could not be confirmed. Inspect the deployment state on the host.')
            raise
        print('Deployed %s: %s files verified on host and over HTTPS.' % (package['id'], len(package['files'])))


if __name__ == '__main__':
    import signal
    import sys
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit('Deployment interrupted'))
    main()
