"""Durable state and cross-process device ownership (protocol version 1)."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import uuid

VERSION = 1
TERMINAL = {'completed', 'cancelled'}
WAITING = {'waiting_device', 'waiting_user'}


def app_directory():
    return Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local/share')) / 'OpenWrt-Installer'


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Never truncate the last good checkpoint. Flush before atomic replacement.
    fd, temp = tempfile.mkstemp(prefix='.checkpoint-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def compatible(old, new):
    reasons = []
    for key in ('protocol', 'adapter', 'profile', 'layout', 'kernel'):
        if old.get(key) != new.get(key):
            reasons.append(f'{key}: {old.get(key)} -> {new.get(key)}')
    for name in sorted(set(old.get('payloads', {})) | set(new.get('payloads', {}))):
        if old.get('payloads', {}).get(name) != new.get('payloads', {}).get(name):
            reasons.append('payload changed: ' + name)
    if reasons:
        raise ValueError('Incompatible package / 安装包不兼容: ' + '; '.join(reasons))
    return True


class DeviceLock:
    """Kernel releases ownership after a crash; files are never used as leases."""
    def __init__(self, base, identity):
        self.path = Path(base) / 'locks' / (hashlib.sha256(identity.encode()).hexdigest() + '.lock')
        self.stream = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.path.open('a+b')
        self.stream.seek(0)
        self.stream.write(b'\0')
        self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.stream.close()
            self.stream = None
            raise RuntimeError('Another installer owns this device / 另一个安装器正在操作此设备') from None
        return self

    def __exit__(self, *_):
        if self.stream:
            if os.name == 'nt':
                import msvcrt
                self.stream.seek(0)
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
            self.stream.close()


class Store:
    def __init__(self, base=None):
        self.base = Path(base or app_directory())
        self.base.mkdir(parents=True, exist_ok=True)

    def directory(self, tid):
        if not re.fullmatch('[a-f0-9]{32}', tid):
            raise ValueError('Invalid transaction ID')
        return self.base / 'transactions' / tid

    def save(self, record):
        record['updated'] = time.time()
        atomic_json(self.directory(record['id']) / 'transaction.json', record)

    def load(self, tid):
        record = json.loads((self.directory(tid) / 'transaction.json').read_text(encoding='utf-8'))
        if record.get('version') != VERSION or record.get('id') != tid:
            raise ValueError('Unsupported or damaged transaction / 事务版本不支持或记录损坏')
        return record

    def list(self):
        records = []
        for path in (self.base / 'transactions').glob('*/transaction.json'):
            try:
                records.append(self.load(path.parent.name))
            except (OSError, ValueError):
                continue
        return sorted(records, key=lambda r: r['updated'], reverse=True)

    def create(self, package, device, choices, plan):
        record = dict(version=VERSION, id=uuid.uuid4().hex, created=time.time(),
                      status='ready', stage='plan', device=device, package=package,
                      choices=choices, plan=plan, completed=[], effects={}, legacy=None,
                      unsafe=False, cancel_requested=False, error=None, result=None)
        self.save(record)
        return record


class RecoveryRequired(RuntimeError):
    pass


class Cancelled(Exception):
    pass


class Pending(Exception):
    """Expected device reboot; this is never a failure."""


class Context:
    def __init__(self, store, record, emit):
        self.store, self.record, self.emit = store, record, emit
        self.cancel = False
        self.clock = time.monotonic()

    @property
    def directory(self):
        return self.store.directory(self.record['id'])

    def snapshot(self):
        # Transaction/backup files retain identity; public events mask it.
        out = json.loads(json.dumps(self.record))
        def redact(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key.lower() in ('serial', 'cid', 'ssh_key') and isinstance(item, str):
                        value[key] = '••••' + item[-4:]
                    else:
                        redact(item)
            elif isinstance(value, list):
                for item in value: redact(item)
        redact(out)
        out.pop('legacy', None)
        out.pop('effects', None)
        out.pop('secrets', None)
        self.emit('transaction', out)
        return out

    def stage(self, stage, status='running', **details):
        self.record.update(stage=stage, status=status, details=details)
        self.store.save(self.record)
        self.snapshot()

    def boundary(self):
        if self.cancel or self.record.get('cancel_requested'):
            raise Cancelled()

    def effect(self, name, operation, *, retry_safe=False):
        entry = self.record['effects'].get(name)
        if entry and entry['state'] == 'done':
            return entry.get('result')
        if entry and not retry_safe:
            raise RecoveryRequired('Interrupted write requires readback / 写入中断，必须复核: ' + name)
        self.boundary()
        self.record['effects'][name] = {'state': 'started', 'time': time.time()}
        self.record['unsafe'] = not retry_safe
        self.store.save(self.record)
        self.snapshot()
        result = operation()
        self.record['effects'][name] = {'state': 'done', 'time': time.time(), 'result': result}
        self.record['unsafe'] = False
        if name not in self.record['completed']:
            self.record['completed'].append(name)
        self.store.save(self.record)
        self.snapshot()
        self.boundary()
        return result

    def legacy_record(self, path, value):
        self.record['legacy'] = str(Path(path).resolve())
        self.record['legacy_phase'] = value.get('phase', value.get('state'))
        self.store.save(self.record)

    def transfer(self, name, done, total, since):
        self.emit('transfer', dict(name=name, bytes=done, total=total,
                                  bytes_per_second=done / max(time.monotonic() - since, .001)))

    def log(self, message):
        # Legacy stdout can contain hotspot credentials, SMS or raw identifiers.
        # It is intentionally not forwarded. Only named structured events log.
        safe = str(message)
        for value in (self.record['device'].get('serial'), self.record['device'].get('cid')):
            if value:
                safe = safe.replace(value, '[redacted]')
        self.emit('log', {'time': time.time(), 'message': safe[:2000]})
