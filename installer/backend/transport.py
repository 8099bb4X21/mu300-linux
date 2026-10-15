"""Serial-bound ADB operations. Frontend never supplies shell text."""
import base64
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time

from .state import sha


def hidden_process():
    return {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}


class Adb:
    def __init__(self, package, serial=None):
        self.serial = serial
        paths = [Path(package) / 'tools/adb.exe', Path(package) / 'platform-tools/adb.exe']
        self.exe = next((str(p) for p in paths if p.is_file()), shutil.which('adb'))
        if not self.exe:
            raise ValueError('ADB is missing from tools / 安装包缺少 ADB 工具')
        self.su = None

    def call(self, *args, timeout=20, check=True):
        cmd = [self.exe]
        if self.serial and args[0] != 'devices':
            cmd += ['-s', self.serial]
        result = subprocess.run(cmd + list(args), capture_output=True, timeout=timeout, **hidden_process())
        if check and result.returncode:
            raise ConnectionError('ADB connection interrupted / ADB 连接中断')
        return result.stdout.decode('utf-8', 'replace').replace('\r', '')

    def devices(self):
        result = []
        for line in self.call('devices', '-l').splitlines()[1:]:
            values = line.split()
            if len(values) >= 2:
                result.append({'serial': values[0], 'state': values[1],
                               'label': next((v[6:] for v in values[2:] if v.startswith('model:')), values[0][-4:])})
        return result

    def shell(self, script, root=False, timeout=20):
        if root and self.su is None:
            raise ValueError('Root has not been verified / 尚未验证 root')
        command = (self.su + ' -c ' if root and self.su else 'sh -c ') + shlex.quote(script)
        return self.call('shell', command, timeout=timeout)

    def root_status(self):
        if self.shell('id -u').strip() == '0':
            self.su = ''
            return 'ready'
        found = False
        for name in ('su', '/debug_ramdisk/su', '/sbin/su'):
            available = self.shell('command -v ' + name + ' >/dev/null 2>&1; echo $?').strip() == '0'
            if not available:
                continue
            found = True
            try:
                result = self.shell(name + ' -c id', timeout=8)
                if re.search(r'\buid=0\b', result):
                    self.su = name
                    return 'ready'
            except (ConnectionError, subprocess.TimeoutExpired):
                pass
        return 'root_permission' if found else 'magisk'

    def read(self, script):
        encoded = self.shell('set -o pipefail; ' + script + ' | base64', root=True, timeout=120)
        return base64.b64decode(''.join(encoded.split()), validate=True)

    def properties(self):
        names = ('ro.product.model', 'ro.product.device', 'ro.board.platform', 'ro.boot.slot_suffix',
                 'ro.boot.verifiedbootstate', 'ro.crypto.state', 'ro.crypto.type', 'sys.boot_completed')
        result = {}
        for name in names:
            result[name] = self.shell('getprop ' + name).strip()
        return result


def push_chunks(adb_call, shell, local, remote, context):
    """Actual acknowledged bytes, checksum at destination, no terminal parsing."""
    import tempfile
    total = Path(local).stat().st_size
    since = time.monotonic()
    shell('rm -f ' + shlex.quote(remote))
    done = 0
    with open(local, 'rb') as stream, tempfile.TemporaryDirectory() as temp:
        chunk_path = Path(temp) / 'chunk'
        while chunk := stream.read(8 << 20):
            context.boundary()
            chunk_path.write_bytes(chunk)
            part = remote + '.upload-chunk'
            adb_call('push', str(chunk_path), part)
            if shell('sha256sum ' + shlex.quote(part)).split()[0] != sha(chunk_path):
                raise ValueError('Transfer chunk checksum failed / 传输块校验失败')
            shell('cat ' + shlex.quote(part) + ' >> ' + shlex.quote(remote) + ' && rm -f ' + shlex.quote(part))
            done += len(chunk)
            context.transfer(Path(local).name, done, total, since)
    if shell('sha256sum ' + shlex.quote(remote)).split()[0] != sha(local):
        raise ValueError('Transfer checksum failed / 传输校验失败')
    return remote
