"""Restricted static-site receiver. Keep compatible with Hoster's Python 2.6."""
from __future__ import print_function

import base64
import hashlib
import json
import os
import re
import shutil
import sys


MAX_PAYLOAD = 4 * 1024 * 1024
ASSET_PATH = re.compile(r'^assets/[A-Za-z0-9][A-Za-z0-9._-]*[.](js|css|png|svg|jpg|jpeg|webp|gif|ico)\Z')


def digest(content):
    return hashlib.sha256(content).hexdigest()


def read_file(path):
    with open(path, 'rb') as source:
        return source.read()


def write_file(path, content, mode=0o600):
    parent = os.path.dirname(path)
    if not os.path.isdir(parent):
        os.makedirs(parent, 0o700)
    with open(path, 'wb') as target:
        target.write(content)
    os.chmod(path, mode)


def target_path(web, name):
    path = os.path.join(web, name)
    if os.path.realpath(path) != os.path.abspath(path):
        raise ValueError('Symlinks are not allowed in deployment targets')
    if os.path.exists(path) and not os.path.isfile(path):
        raise ValueError('Deployment target is not a regular file')
    return path


def decode_package(package):
    release_id = package.get('id', '')
    if not re.match(r'^[a-f0-9]{32}\Z', release_id):
        raise ValueError('Invalid release ID')
    files = package.get('files', {})
    if not isinstance(files, dict) or not 2 <= len(files) <= 256 or 'index.html' not in files:
        raise ValueError('Expected index.html and static game assets')
    if not any(name.endswith('.js') for name in files):
        raise ValueError('The game JavaScript is missing')
    contents = {}
    for name, item in files.items():
        if name != 'index.html' and not ASSET_PATH.match(name):
            raise ValueError('Only index.html and static assets are allowed')
        content = base64.b64decode(item['content'].encode('ascii'))
        if digest(content) != item['sha256']:
            raise ValueError('Package checksum mismatch')
        contents[name] = content
    if sum(len(value) for value in contents.values()) > MAX_PAYLOAD // 2:
        raise ValueError('Package is too large')
    return release_id, contents


def restore(receipt, directory, web, names):
    for name in reversed(names):
        path = target_path(web, name)
        if receipt['before'][name] is None:
            if os.path.exists(path):
                os.unlink(path)
        else:
            temporary = os.path.join(directory, 'restore', name)
            write_file(temporary, read_file(os.path.join(directory, 'backup', name)), receipt['modes'][name])
            os.rename(temporary, path)


def mark_pending(state, release_id):
    temporary = os.path.join(state, 'pending.tmp')
    write_file(temporary, release_id.encode('ascii'))
    os.rename(temporary, os.path.join(state, 'pending'))


def recover_interrupted(web, state):
    pending = os.path.join(state, 'pending')
    if not os.path.isfile(pending):
        return None
    release_id = read_file(pending).decode('ascii')
    if not re.match(r'^[a-f0-9]{32}\Z', release_id):
        raise ValueError('Invalid recovery journal')
    directory = os.path.join(state, release_id)
    with open(os.path.join(directory, 'receipt.json')) as source:
        receipt = json.load(source)
    for name, expected in receipt['after'].items():
        path = target_path(web, name)
        current = digest(read_file(path)) if os.path.isfile(path) else None
        if current not in (expected, receipt['before'][name]):
            raise ValueError('Site changed during interruption; recovery stopped')
    restore(receipt, directory, web, sorted(receipt['after']))
    latest = os.path.join(state, 'latest')
    if os.path.isfile(latest) and read_file(latest).decode('ascii') == release_id:
        os.unlink(latest)
        previous = receipt.get('previous_release')
        if previous and os.path.isdir(os.path.join(state, previous)):
            pointer = os.path.join(state, 'latest.tmp')
            write_file(pointer, previous.encode('ascii'))
            os.rename(pointer, latest)
    os.unlink(pending)
    shutil.rmtree(directory)
    return release_id


def apply_release(package, web, state):
    release_id, contents = decode_package(package)
    if os.path.realpath(web) != os.path.abspath(web) or not os.path.isdir(web):
        raise ValueError('Invalid web root')
    if os.path.realpath(state) != os.path.abspath(state) or state.startswith(web + os.sep):
        raise ValueError('Invalid deployment state directory')
    for name in contents:
        target_path(web, name)
    if not os.path.isdir(state):
        os.makedirs(state, 0o700)
    recover_interrupted(web, state)
    directory = os.path.join(state, release_id)
    os.mkdir(directory, 0o700)
    latest = os.path.join(state, 'latest')
    previous = read_file(latest).decode('ascii') if os.path.isfile(latest) else None
    receipt = {'id': release_id, 'before': {}, 'after': {}, 'modes': {}, 'previous_release': previous}
    try:
        for name, content in contents.items():
            path = target_path(web, name)
            old = read_file(path) if os.path.isfile(path) else None
            if old == content:
                continue
            receipt['before'][name] = digest(old) if old is not None else None
            receipt['after'][name] = digest(content)
            receipt['modes'][name] = os.stat(path).st_mode & 0o777 if old is not None else 0o644
            if old is not None:
                write_file(os.path.join(directory, 'backup', name), old)
            write_file(os.path.join(directory, 'stage', name), content, 0o644)
        # Persist recovery data before touching the web root, including for SIGKILL.
        write_file(os.path.join(directory, 'receipt.json'), json.dumps(receipt).encode('utf-8'))
        mark_pending(state, release_id)
        # Assets first: both old and new HTML can load their matching CSS.
        ordered = sorted(receipt['after'], key=lambda name: (name.endswith('.html'), name))
        for name in ordered:
            path = target_path(web, name)
            parent = os.path.dirname(path)
            if not os.path.isdir(parent):
                os.makedirs(parent, 0o755)
                os.chmod(parent, 0o755)
            os.rename(os.path.join(directory, 'stage', name), path)
        for name, content in contents.items():
            if digest(read_file(target_path(web, name))) != digest(content):
                raise ValueError('Installed file checksum mismatch')
        pointer = os.path.join(state, 'latest.tmp')
        write_file(pointer, release_id.encode('ascii'))
        os.rename(pointer, os.path.join(state, 'latest'))
        os.unlink(os.path.join(state, 'pending'))
    except BaseException:
        pending = os.path.join(state, 'pending')
        if os.path.isfile(pending):
            recover_interrupted(web, state)
        elif os.path.isfile(latest) and read_file(latest).decode('ascii') == release_id:
            rollback_release(release_id, web, state)
        elif os.path.isdir(directory):
            shutil.rmtree(directory)
        raise
    # Keep exactly one rollback snapshot, outside both the web root and site-backups.
    for name in os.listdir(state):
        if re.match(r'^[a-f0-9]{32}\Z', name) and name != release_id:
            shutil.rmtree(os.path.join(state, name))
    return {'id': release_id, 'verified_files': len(contents), 'changed_files': sorted(receipt['after'])}


def rollback_release(release_id, web, state):
    if recover_interrupted(web, state) == release_id:
        return {'rolled_back': release_id}
    if not re.match(r'^[a-f0-9]{32}\Z', release_id) or read_file(os.path.join(state, 'latest')).decode('ascii') != release_id:
        raise ValueError('Only the latest release can be rolled back')
    directory = os.path.join(state, release_id)
    with open(os.path.join(directory, 'receipt.json')) as source:
        receipt = json.load(source)
    # Check every file before restoring any: a manual edit must not be overwritten.
    for name, expected in receipt['after'].items():
        path = target_path(web, name)
        current = digest(read_file(path)) if os.path.isfile(path) else None
        if current not in (expected, receipt['before'][name]):
            raise ValueError('Site changed after deployment; rollback stopped')
    mark_pending(state, release_id)
    restore(receipt, directory, web, sorted(receipt['after']))
    os.unlink(os.path.join(state, 'latest'))
    os.unlink(os.path.join(state, 'pending'))
    shutil.rmtree(directory)
    return {'rolled_back': release_id}


def main():
    import fcntl
    os.umask(0o077)
    home = os.path.realpath(os.path.expanduser('~'))
    web = os.path.join(home, 'elhini.ru', 'flying-dragon-game')
    state = os.path.join(home, '.local', 'state', 'flying-dragon-game-deploy')
    if not os.path.isdir(state):
        os.makedirs(state, 0o700)
    command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    with open(os.path.join(state, 'lock'), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if command == 'deploy':
            stream = getattr(sys.stdin, 'buffer', sys.stdin)
            raw = stream.read(MAX_PAYLOAD + 1)
            if len(raw) > MAX_PAYLOAD:
                raise ValueError('Package is too large')
            result = apply_release(json.loads(raw), web, state)
        elif re.match(r'^rollback [a-f0-9]{32}\Z', command):
            result = rollback_release(command.split()[1], web, state)
        else:
            raise ValueError('Only deploy and rollback commands are allowed')
    print(json.dumps(result))


if __name__ == '__main__':
    import signal
    def interrupted(signum, frame):
        raise SystemExit('Deployment interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('Deployment rejected: ' + reason, file=sys.stderr)
        sys.exit(1)
