"""NDJSON command server and persistent coordinator. No generic exec command."""
from contextlib import ExitStack
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import threading
import time
import zipfile

from .adapter import Adapter
from .package import inspect_package
from .state import Cancelled, Context, DeviceLock, Pending, RecoveryRequired, Store, compatible
from .transport import Adb

METHODS = {'tf', 'part', 'reinstall', 'image', 'boot', 'update'}


def plan_install(package, device, choices):
    method = choices.get('method')
    if method not in METHODS:
        raise ValueError('Unknown installation method')
    if device.get('readiness') != 'ready':
        raise ValueError('Device is not ready / 设备尚未就绪')
    if method == 'update':
        return {'method': method, 'wipe': False, 'openwrt_bytes': device['capacity'], 'two_stage': False,
                'preserves_settings': True, 'host': choices['host']}
    size = choices.get('size_gib', 4)
    if type(size) not in (float, int) or not math.isfinite(size) or size <= 0:
        raise ValueError('Size must be a positive number / 容量必须为正数')
    size_bytes = math.ceil(size*1024/4)*4*(1 << 20)
    plan = {'method': method, 'wipe': False, 'two_stage': False, 'openwrt_bytes': size_bytes,
            'android_bytes': device['userdata_bytes'], 'grow': choices.get('grow', True),
            'target': None, 'data_impact': method}
    storage = device['storage']
    if method == 'boot':
        plan.update(openwrt_bytes=0, target='misc', temporary=True)
    elif method == 'tf':
        if not device.get('tf'):
            raise ValueError('No TF card / 未检测到 TF 卡')
        plan.update(target=device['tf'], openwrt_bytes=device['tf_bytes'])
        plan['target_identity'] = device.get('tf_identity')
        if plan['openwrt_bytes'] < 2 << 30:
            raise ValueError('TF target is smaller than the system image / TF 分区小于系统镜像')
    elif method == 'reinstall':
        if not device.get('existing'):
            raise ValueError('No existing internal partition / 没有可重装的内置分区')
        plan.update(target=storage['ROOT'], openwrt_bytes=storage['ROOT_SIZE']*512)
    elif method == 'image':
        if device['encrypted']:
            raise ValueError('Encrypted userdata cannot boot an image / 加密 userdata 不支持镜像启动')
        uploads = sum((Path(package['path'])/name).stat().st_size for name in package['payloads'])
        maximum = device['free_bytes'] - (1536 << 20) - uploads - (2 << 30 if package['adapter'] == 'mu300' else 0)
        if size_bytes < 2 << 30 or size_bytes > maximum:
            raise ValueError(f'Image requires staging space and Android reserve; maximum {max(0,maximum)/(1<<30):.2f} GiB / 镜像大小超出含临时空间与 Android 预留的范围')
        plan.update(target='userdata-image', maximum_bytes=maximum, experimental=True)
    else:
        if device.get('existing'):
            raise ValueError('Internal partition exists; choose update or reinstall / 已存在内置分区，请选择更新或重装')
        if size_bytes < 2 << 30:
            raise ValueError('OpenWrt needs at least 2 GiB / OpenWrt 至少需要 2 GiB')
        candidates = [(n, a) for a, n in device['gpt']['safe_gaps'] if n*512 >= size_bytes]
        gap = max(candidates)[1] if candidates and device['gpt']['empty'] else None
        if gap is not None:
            plan.update(gap_start=gap, target='GPT unallocated space', two_stage=package['adapter'] == 'e5')
        else:
            wipe = device['encrypted'] or bool(choices.get('wipe'))
            android = device['userdata_bytes'] - size_bytes
            used = device['userdata_bytes'] - device['free_bytes']
            if android < (2 << 30) or (not wipe and android < used+(2 << 30)):
                raise ValueError('Insufficient Android retained space / Android 保留空间不足')
            plan.update(wipe=wipe, two_stage=wipe, android_bytes=android, target='userdata shrink')
            plan['offline'] = True
    return plan


class Service:
    def __init__(self, package_root, store=None, output=None):
        self.package_root = str(Path(package_root).resolve())
        self.store = store or Store()
        self.output = output or sys.stdout
        self.write_lock = threading.Lock()
        self.active = None
        self.worker = None
        self.package = None
        self.adapters = Adapter
        self.stop = threading.Event()

    def emit(self, kind, data, request_id=None):
        event = {'protocol': 1, 'type': kind, 'data': data}
        if request_id is not None:
            event['id'] = request_id
        with self.write_lock:
            self.output.write(json.dumps(event, ensure_ascii=False) + '\n')
            self.output.flush()

    def adapter(self, package=None, context=None):
        return self.adapters(package or self.package, context)

    def public(self, record):
        return Context(self.store, record, lambda *_: None).snapshot()

    def dispatch(self, request):
        if request.get('protocol') != 1:
            raise ValueError('Protocol version mismatch')
        command, p = request.get('command'), request.get('params', {})
        if not isinstance(p, dict):
            raise ValueError('Parameters must be an object')
        if command == 'hello':
            return {'protocol': 1, 'app_data': str(self.store.base), 'package_path': self.package_root,
                    'transactions': [self.public(r) for r in self.store.list()]}
        if command == 'snapshot':
            return self.active.snapshot() if self.active else None
        if command == 'list':
            return [self.public(r) for r in self.store.list()]
        if command == 'cancel':
            if self.active:
                self.active.cancel = True
                self.active.record['cancel_requested'] = True
                self.store.save(self.active.record)
                return {'accepted': True, 'deferred': self.active.record['unsafe']}
            return {'accepted': False}
        if command == 'can_close':
            return not self.worker or not self.worker.is_alive()
        if self.worker and self.worker.is_alive() and command not in ('export',):
            raise ValueError('An operation is active / 任务正在执行')
        if command == 'package':
            self.package = inspect_package(p.get('path') or self.package_root)
            self.package_root = self.package['path']
            return self.package
        if command == 'devices':
            return Adb(self.package_root).devices()
        if command == 'probe':
            if not self.package:
                raise ValueError('Verify a package first / 请先校验安装包')
            if not isinstance(p.get('serial'), str) or not p['serial']:
                raise ValueError('Select a device / 请选择设备')
            return self.adapter().probe(p['serial'], p.get('method', 'part'))
        if command == 'probe_update':
            return self.probe_update(p)
        if command == 'plan':
            if not self.package:
                raise ValueError('Verify package first')
            choices = p['choices']
            if choices.get('method') == 'update':
                device = self.probe_update(p)
            else:
                device = self.adapter().probe(p['serial'], choices['method'])
            plan = plan_install(self.package, device, choices)
            record = self.store.create(self.package, device, choices, plan)
            record['data_directory'] = str(self.store.directory(record['id']))
            record['secrets'] = {'wifi_key': secrets.token_urlsafe(12)}
            self.store.save(record)
            return self.public(record)
        if command in ('start', 'resume', 'retry'):
            record = self.store.load(p['transaction'])
            if record['status'] == 'completed':
                return self.public(record)
            current = inspect_package(p.get('path') or self.package_root)
            compatible(record['package'], current)
            record['package'] = current
            # A final confirmation is bound to this already persisted plan.
            if command == 'start' and p.get('confirmed') is not True:
                raise ValueError('Confirm the displayed plan / 请确认安装计划')
            if command != 'start' and record['status'] == 'ready':
                raise ValueError('This plan has not been confirmed / 此计划尚未确认')
            self.store.save(record)
            context = Context(self.store, record, self.emit)
            adapter = self.adapter(current, context)
            adapter.password = p.get('password', '')
            context.cancel = False
            record['cancel_requested'] = False
            record['error'] = None
            self.active = context
            self.worker = threading.Thread(target=self.run, args=(context, adapter), daemon=False)
            self.worker.start()
            return self.public(record)
        if command == 'export':
            record = self.store.load(p['transaction'])
            directory = self.store.directory(record['id'])
            # Export path is selected by native dialog, archive paths are fixed.
            target = Path(p['path'])
            if target.exists():
                raise ValueError('Export destination exists / 导出文件已存在')
            with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
                for path in directory.rglob('*'):
                    if path.is_file():
                        archive.write(path, path.relative_to(directory).as_posix())
            return {'path': str(target)}
        if command == 'import':
            # Import full directories, never extract arbitrary ZIP paths here.
            directory = Path(p['path']).resolve()
            record = json.loads((directory/'transaction.json').read_text(encoding='utf-8'))
            if record.get('version') != 1:
                raise ValueError('Unsupported transaction version')
            target = self.store.directory(record['id'])
            if target.exists():
                raise ValueError('Transaction already exists')
            if record.get('legacy'):
                relative = Path(record['legacy']).relative_to(Path(record.get('data_directory', directory)))
                record['legacy'] = str(target/relative)
            record['data_directory'] = str(target)
            shutil.copytree(directory, target)
            self.store.save(record)
            return self.public(record)
        raise ValueError('Unsupported command / 不支持的命令')

    def probe_update(self, p):
        import paramiko
        if not self.package:
            raise ValueError('Verify package first')
        choices = p.get('choices', p)
        host = choices.get('host', '')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}', host):
            raise ValueError('Enter an IP address or hostname / 请输入 IP 地址或主机名')
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(host, username='root', password=p.get('password', ''), timeout=12,
                           auth_timeout=15, look_for_keys=False, allow_agent=False)
            key = hashlib.sha256(client.get_transport().get_remote_server_key().asbytes()).hexdigest()
            def read(script):
                _, out, err = client.exec_command(script, timeout=15)
                data = out.read().decode('utf-8', 'replace').strip()
                if out.channel.recv_exit_status():
                    raise ValueError('OpenWrt preflight failed / OpenWrt 预检失败')
                return data
            if read('id -u') != '0':
                raise ValueError('SSH root required')
            kind = self.package['adapter']
            profile = read('cat /etc/e5/device-profile' if kind == 'e5' else 'cat /run/mu300/device')
            if kind == 'e5' and profile != self.package['profile'] or kind == 'mu300' and profile not in ('f50', 'v50', 'u30air'):
                raise ValueError('Wrong OpenWrt profile / OpenWrt 机型不匹配')
            cid = read('cat /sys/class/block/mmcblk0/device/cid')
            if not re.fullmatch('[a-f0-9]{32}', cid):
                raise ValueError('Cannot establish OpenWrt eMMC identity')
            capacity = int(read("df -Pk / | awk 'END {print $2}'"))*1024
            import base64
            root_dev = read('cat /run/mu300/disk-dev' if kind == 'mu300' else
                            "readlink -f $(awk '$2==\"/\" {print $1}' /proc/mounts | tail -1)")
            if re.fullmatch(r'/dev/(?:block/)?(?:mmcblk\d+(?:p\d+)?|loop\d+)', root_dev):
                raw = base64.b64decode(read(f'dd if={root_dev} bs=1024 skip=1 count=1 2>/dev/null | base64'))
                capacity = verify_ext4_capacity(raw, 0)
            return dict(serial='ssh:'+key, cid=cid, ssh_key=key, host=host, profile=profile,
                        model=profile.upper(), system='OpenWrt', slot=read('cat /run/mu300/linux-slot') if kind == 'mu300' else 'B',
                        root=True, readiness='ready', capacity=capacity)
        finally:
            client.close()

    def run(self, context, adapter):
        r = context.record
        try:
            with ExitStack() as locks:
                for identity in sorted({r['device']['serial'], r['device']['cid']}):
                    locks.enter_context(DeviceLock(self.store.base, identity))
                if r['stage'] == 'openwrt_boot':
                    return self.wait_openwrt(context, adapter)
                if r.get('legacy'):
                    self.wait_android(context, adapter)
                else:
                    if r['choices']['method'] != 'update':
                        actual = adapter.probe(r['device']['serial'], r['choices']['method'])
                        if actual.get('cid') != r['device']['cid'] or actual.get('slot') != r['device']['slot']:
                            raise ValueError('Device identity or Android slot changed since plan / 设备或 Android 槽位与计划不一致')
                        # Recompute immediately before execution; do not accept stale TF geometry or GPT gaps.
                        fresh = plan_install(r['package'], actual, r['choices'])
                        for key in ('wipe', 'target', 'openwrt_bytes', 'android_bytes', 'gap_start', 'target_identity'):
                            if fresh.get(key) != r['plan'].get(key):
                                raise ValueError('Installation plan changed; inspect and confirm again / 安装计划发生变化，请重新检查并确认: '+key)
                context.stage('prepare')
                try:
                    result = adapter.execute()
                except Pending:
                    self.wait_android(context, adapter)
                    result = adapter.execute()
                if result is not None and getattr(result, 'state', '') == 'pending' and r.get('legacy'):
                    self.wait_android(context, adapter)
                    result = adapter.execute()
                context.stage('openwrt_boot', 'waiting_device', reboot_manually=True)
                self.wait_openwrt(context, adapter)
        except Cancelled:
            context.stage(r['stage'], 'cancelled')
        except BaseException as error:
            message = str(error)[:2000] if isinstance(error, (ValueError, RecoveryRequired)) else \
                      'Operation interrupted; keep backups and retry from the saved record / 操作中断，请保留备份并从记录续装'
            for private in (r['device'].get('serial'), r['device'].get('cid'), adapter.password,
                            r.get('secrets', {}).get('wifi_key')):
                if private: message = message.replace(private, '[redacted]')
            r['error'] = {'code': 'recovery_required' if isinstance(error, RecoveryRequired) else 'operation_failed',
                          'message': message,
                          'retryable': not r['unsafe'] or bool(r.get('legacy'))}
            context.stage(r['stage'], 'failed')

    def wait_android(self, context, adapter):
        r = context.record
        # No deadline: initialization, debugging and Magisk are user paced.
        while True:
            context.boundary()
            try:
                device = adapter.probe(r['device']['serial'], r['choices']['method'])
                readiness = device.get('readiness', 'android_boot')
                if readiness == 'ready':
                    if device.get('cid') != r['device']['cid'] or device.get('profile') != r['device']['profile']:
                        raise RecoveryRequired('Reconnected device differs / 重连设备身份不一致')
                    if r['plan'].get('two_stage') and r['device'].get('boot_id') and device.get('boot_id') == r['device']['boot_id']:
                        context.stage('android_boot', 'waiting_device')
                        if self.stop.wait(3): raise Cancelled()
                        continue
                    context.stage('root_ready')
                    return
                context.stage(readiness, 'waiting_device' if readiness == 'android_boot' else 'waiting_user')
            except (ConnectionError, OSError, TimeoutError, __import__('subprocess').TimeoutExpired):
                context.stage('android_boot', 'waiting_device')
            if self.stop.wait(3):
                raise Cancelled()

    def wait_openwrt(self, context, adapter):
        import paramiko
        r = context.record
        host = r['choices'].get('host') or ('192.168.9.1' if r['package']['adapter'] == 'e5' else
                '192.168.78.1' if r['device']['profile'] == 'u30air' else '192.168.77.1')
        # No network/interface changes and no automatic hotspot connection.
        while True:
            context.boundary()
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            try:
                client.connect(host, username='root', password=adapter.password or 'root', timeout=5,
                               auth_timeout=5, look_for_keys=False, allow_agent=False)
                def read(script):
                    _, out, _ = client.exec_command(script, timeout=15)
                    value = out.read().decode().strip()
                    if out.channel.recv_exit_status():
                        raise ValueError('Final verification command failed')
                    return value
                cid = read('cat /sys/class/block/mmcblk0/device/cid')
                if cid != r['device']['cid']:
                    raise RecoveryRequired('Management address belongs to another device / 管理地址对应另一台设备')
                context.stage('verify_capacity')
                # Read superblock via SSH base64; no od/SFTP dependency.
                import base64
                if r['package']['adapter'] == 'e5':
                    dev = read("readlink -f $(awk '$2==\"/\" {print $1}' /proc/mounts | tail -1)")
                else:
                    dev = read('cat /run/mu300/disk-dev')
                if not re.fullmatch(r'/dev/(?:block/)?(?:mmcblk\d+(?:p\d+)?|loop\d+)', dev):
                    raise ValueError('Cannot identify installed root block device')
                raw = base64.b64decode(read(f'dd if={dev} bs=1024 skip=1 count=1 2>/dev/null | base64'))
                capacity = verify_ext4_capacity(raw, r['plan']['openwrt_bytes'] if r['plan'].get('grow', True) else 0)
                # Mounted and usable, not just a larger partition entry.
                read('test -s /etc/openwrt_release && test -x /sbin/init')
                r['result'] = {'filesystem_bytes': capacity, 'url': 'http://'+host,
                               'backup_directory': str(context.directory/'backup'), 'model': r['device']['model'],
                               'temporary': r['choices']['method'] == 'boot'}
                context.stage('complete', 'completed')
                return
            except (RecoveryRequired, ValueError):
                raise
            except (OSError, EOFError, paramiko.SSHException):
                context.stage('openwrt_boot', 'waiting_device', host=host, reboot_manually=True)
            finally:
                client.close()
            if self.stop.wait(4):
                raise Cancelled()


def verify_ext4_capacity(superblock, expected):
    import struct
    if len(superblock) < 340 or superblock[56:58] != b'\x53\xef':
        raise ValueError('Installed filesystem is not ext4 / 已安装文件系统不是 ext4')
    blocks = struct.unpack_from('<I', superblock, 4)[0] | (struct.unpack_from('<I', superblock, 336)[0] << 32)
    shift = struct.unpack_from('<I', superblock, 24)[0]
    if shift > 6:
        raise ValueError('Invalid ext4 block size')
    capacity = blocks*(1024 << shift)
    if capacity <= 0 or expected and not expected-(4 << 20) <= capacity <= expected:
        raise ValueError(f'Filesystem capacity differs from allocation / 文件系统容量与分配不符: {capacity} != {expected}')
    return capacity


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--package-root', required=True)
    p.add_argument('--data-dir')
    a = p.parse_args()
    output = sys.stdout
    service = Service(a.package_root, Store(a.data_dir), output)
    # Legacy prints are suppressed at the source; service replies always use
    # this captured protocol stream, even while legacy code redirects stdout.
    for line in sys.stdin:
        if len(line) > 1024*1024:
            continue
        request = {}
        try:
            request = json.loads(line)
            value = service.dispatch(request)
            service.emit('response', {'ok': True, 'result': value}, request.get('id'))
        except Exception as error:
            service.emit('response', {'ok': False, 'error': str(error)[:2000]}, request.get('id'))
    # EOF requests safe cancellation; never kill a storage operation.
    if service.active:
        service.active.cancel = True
    service.stop.set()
    if service.worker:
        service.worker.join()


if __name__ == '__main__':
    main()
