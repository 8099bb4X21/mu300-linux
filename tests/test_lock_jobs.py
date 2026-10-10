"""Verified MU300 writes and asynchronous results without touching a modem."""
import json
import re
import shutil
import subprocess
import time
import unittest
from pathlib import Path

from helpers import ShellTest, TOP

LIB = TOP / 'openwrt/luci-app-mu300/root/usr/libexec/unisoc-modem'


class LockWrites(ShellTest):
    def setUp(self):
        super().setUp()
        self.state = self.tmp / 'saved'
        self.state.mkdir()
        self.run = self.tmp / 'run'
        self.run.mkdir()
        self.lock = self.tmp / 'lib/lock'
        self.lock.parent.mkdir()
        for name in ('lock', 'lock-apply.sh', 'lock-jobs.sh'):
            shutil.copyfile(LIB / name, self.lock.parent / name)
            (self.lock.parent / name).chmod(0o755)
        self.modem = self.tmp / 'modem.json'
        self.stub('uci', f'case "$3" in unisoc_modem.main.state_dir) echo "{self.state}";; esac')
        self.stub('logger', ':')
        self.stub('ifup', 'echo ifup >> "$STUBLOG/commands"')
        self.stub('sleep', ':')
        self.stub('jsonfilter', 'exit 1')
        at = self.tmp / 'fake-at'
        at.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p=Path(os.environ['STUBLOG']); f=p/'modem.json'; s=json.loads(f.read_text())
cmd=sys.argv[-1]
with (p/'commands').open('a') as log: log.write(cmd+'\\n')
reads={'AT+SPTESTMODE?':('SPTESTMODE','tm'), 'AT+SP5GRAN?':('SP5GRAN','gran'),
 'AT+SPENDC?':('ENDC','endc'), 'AT+SPLBAND=0':('SPLBAND','lte'),
 'AT+SPLBAND=3':('SPLBAND','nr'), 'AT+CFUN?':('CFUN','cfun')}
if cmd in reads:
 if s.get('silent'): sys.exit(1)
 label,key=reads[cmd]; value=s[key]
 if key=='endc' and value=='2': value=s.get('endc_off_reply','0')
 print('+'+label+': '+value); print('OK'); sys.exit(0)
if cmd=='AT+SP5GCMDS="get nr support_band"':
 print('+SP5GCMDS: get nr support_band,6,41,78,1,8,28,5'); print('OK'); sys.exit(0)
if cmd in ('AT+SPFORCEFRQ=12,3','AT+SPFORCEFRQ=16,3'):
 tag=cmd.split('=')[1].split(',')[0]; cells=s['cells'+tag]
 print('+SPFORCEFRQ: '+tag+',3'+(''.join(','+x for x in cells))); print('OK'); sys.exit(0)
if s.get('reject'): print('+CME ERROR: 3'); sys.exit(0)
if s.get('reject_restart') and cmd.startswith('AT+SFUN='): print('ERROR'); sys.exit(0)
for prefix,key in [('AT+SPTESTMODE=','tm'),('AT+SP5GRAN=','gran'),('AT+SPENDC=','endc'),
 ('AT+SPLBAND=1,','lte'),('AT+SPLBAND=2,','nr')]:
 if cmd.startswith(prefix) and not s.get('ignore'): s[key]=cmd[len(prefix):]
if cmd.startswith('AT+SPFORCEFRQ='):
 args=cmd.split('=')[1].split(','); key='cells'+args[0]
 if args[1]=='4': s[key]=[]
 elif args[1]=='6': s[key]=sorted(set(s[key]+[','.join(args[2:])]))
if cmd=='AT+SFUN=4' and s.get('drift'): s['lte']='0,0,0,0,0'
f.write_text(json.dumps(s))
if s.get('omit_ok'): sys.exit(1)
print('OK')
''')
        at.chmod(0o755)
        self.extra = dict(MU300_AT=at, MU300_DASH_DIR=self.run,
                          UNISOC_APPLY_DIR=self.tmp / 'mutex', UNISOC_REPLAY_MARKER=self.tmp / 'marker')
        self.reset()

    def reset(self, **extra):
        self.modem.write_text(json.dumps(dict(tm='134,128,1,0,0,0', gran='1', endc='1',
            lte='0,0,0,0,0', nr='0,0,0,0', cfun='1', cells12=['1650,10'], cells16=[], **extra)))
        (self.tmp / 'commands').write_text('')

    def apply(self, shell, kind, val):
        return self.script(shell, self.lock, 'apply', kind, val, **self.extra)

    def test_verified_mode_preserves_slot1_and_primary(self):
        for shell in self.each_shell():
            self.reset()
            r = self.apply(shell, 'mode', 'nsa')
            self.assertEqual(r.returncode, 0, r.stderr)
            commands = (self.tmp / 'commands').read_text()
            self.assertIn('AT+SPTESTMODE=131,128,1\n', commands)
            self.assertEqual((self.state / 'mode').read_text(), 'nsa')
            self.assertEqual(commands.count('AT+SFUN=5'), 1)
            cache = json.loads((self.run / 'lock.json').read_text())
            self.assertNotIn('6', cache['write_caps']['nr'].split(','))
            self.assertIn('6', cache['caps']['nr'].split(','))

    def test_missing_ok_can_only_succeed_with_real_readback(self):
        for shell in self.each_shell():
            self.reset(omit_ok=True)
            r = self.apply(shell, 'endc', 'off')
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual((self.state / 'endc').read_text(), 'off')
            self.assertEqual(json.loads((self.run / 'lock.json').read_text())['endc'], '0')
            self.assertNotIn('SFUN', (self.tmp / 'commands').read_text())

    def test_endc_write_two_accepts_only_off_query_values(self):
        for shell in self.each_shell():
            for reply in ('0', '2'):
                self.reset(endc_off_reply=reply)
                r = self.apply(shell, 'endc', 'off')
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn('AT+SPENDC=2\n', (self.tmp / 'commands').read_text())
                self.assertEqual((self.state / 'endc').read_text(), 'off')
                self.assertEqual(json.loads((self.run / 'lock.json').read_text())['endc'], reply)
            for reply in ('', '1', '3', '-1', 'ERROR'):
                self.reset(endc_off_reply=reply)
                (self.state / 'endc').write_text('on')
                r = self.apply(shell, 'endc', 'off')
                self.assertNotEqual(r.returncode, 0, repr(reply))
                self.assertEqual((self.state / 'endc').read_text(), 'on')

    def test_endc_enable_cannot_be_confirmed_by_off_reply(self):
        for shell in self.each_shell():
            self.reset(ignore=True)
            state = json.loads(self.modem.read_text())
            state['endc'] = '0'
            self.modem.write_text(json.dumps(state))
            r = self.apply(shell, 'endc', 'on')
            self.assertNotEqual(r.returncode, 0)
            self.assertFalse((self.state / 'endc').exists())

    def test_early_endc_off_replay_accepts_zero_without_sfun(self):
        for shell in self.each_shell():
            self.reset()
            (self.state / 'endc').write_text('off')
            (self.tmp / 'marker').unlink(missing_ok=True)
            r = self.script(shell, self.lock, 'replay', 'early', **self.extra)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue((self.tmp / 'marker').exists())
            commands = (self.tmp / 'commands').read_text()
            self.assertIn('AT+SPENDC=2\n', commands)
            self.assertIn('AT+SPENDC?\n', commands)
            self.assertNotIn('SFUN', commands)

    def test_rejected_ignored_and_silent_writes_do_not_save_or_restart(self):
        for shell in self.each_shell():
            for failure in ('reject', 'ignore', 'silent'):
                self.reset(**{failure: True})
                (self.state / 'lte').write_text('3')
                r = self.apply(shell, 'lte', '1')
                self.assertNotEqual(r.returncode, 0, failure)
                self.assertEqual((self.state / 'lte').read_text(), '3')
                self.assertNotIn('SFUN', (self.tmp / 'commands').read_text())

    def test_setting_lost_after_restart_is_not_persisted(self):
        for shell in self.each_shell():
            self.reset(drift=True)
            (self.state / 'lte').write_text('3')
            r = self.apply(shell, 'lte', '1')
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('协议栈重启后', r.stderr)
            self.assertEqual((self.state / 'lte').read_text(), '3')

    def test_restart_error_restores_radio_attempt_but_does_not_save(self):
        for shell in self.each_shell():
            self.reset(reject_restart=True)
            r = self.apply(shell, 'lte', '1')
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('协议栈重启被拒绝', r.stderr)
            self.assertIn('AT+SFUN=4', (self.tmp / 'commands').read_text())
            self.assertFalse((self.state / 'lte').exists())

    def test_persistence_error_is_not_reported_as_success(self):
        (self.state / 'endc').mkdir()
        for shell in self.each_shell():
            self.reset()
            r = self.apply(shell, 'endc', 'off')
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('设置保存失败', r.stderr)

    def test_invalid_inputs_never_send_at(self):
        for shell in self.each_shell():
            for kind, val in [('lte', '1,79'), ('nr', '6'), ('nr','78;reboot'), ('nr','1,,2'),
                              ('mode','bogus'), ('endc','2'), ('cell','nr:123,1008'),
                              ('cell','lte:123,504'), ('cell','other:1,2'), ('auto_apply','yes')]:
                self.reset()
                r = self.apply(shell, kind, val)
                self.assertNotEqual(r.returncode, 0, (kind,val))
                self.assertEqual((self.tmp / 'commands').read_text(), '')

    def test_duplicate_bands_and_multi_rat_cells(self):
        for shell in self.each_shell():
            self.reset()
            self.assertEqual(self.apply(shell, 'nr', '78,41,78').returncode, 0)
            self.assertEqual((self.state / 'nr').read_text(), '41,78')
            r = self.apply(shell, 'cell', 'nr:627264,393')
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual((self.state / 'cell').read_text(), 'lte:1650,10\nnr:627264,393\n')
            self.assertEqual(self.apply(shell, 'cell', 'off-nr').returncode, 0)
            self.assertEqual((self.state / 'cell').read_text(), 'lte:1650,10\n')
            self.assertEqual(self.apply(shell, 'cell', 'off').returncode, 0)
            self.assertEqual((self.state / 'cell').read_text(), '')

    def test_job_completion_and_status_have_no_at_for_auto_apply(self):
        for shell in self.each_shell():
            self.reset()
            start = self.script(shell, self.lock, 'start', 'auto_apply', 'off', **self.extra)
            job = json.loads(start.stdout)
            self.assertEqual(job['ok'], 1, start.stderr)
            self.assertRegex(job['id'], r'^[A-Za-z0-9]{10}$')
            result = {}
            for _ in range(50):
                result = json.loads(self.script(shell, self.lock, 'status', job['id'], **self.extra).stdout)
                if result.get('state') in ('done','error'): break
                time.sleep(.02)
            self.assertEqual(result['state'], 'done', result)
            self.assertEqual(result['ok'], 1)
            self.assertEqual((self.state / 'auto_apply').read_text(), 'off')
            self.assertEqual((self.tmp / 'commands').read_text(), '')

    def test_expired_missing_and_dead_job_results_are_explicit(self):
        for shell in self.each_shell():
            for id, age, pid in [('a'*10, 300, '1'), ('b'*10, 5, '99999999')]:
                path = self.run / 'lock-jobs' / id
                path.mkdir(parents=True, exist_ok=True)
                path.joinpath('result').write_text(json.dumps(dict(id=id, state='running')))
                path.joinpath('started').write_text(str(int(float(Path('/proc/uptime').read_text().split()[0]))-age))
                path.joinpath('pid').write_text(pid)
                r = self.script(shell, self.lock, 'status', id, **self.extra)
                self.assertEqual(json.loads(r.stdout)['state'], 'error', r)
            for id in ('../lock.json', 'missing000'):
                r = self.script(shell, self.lock, 'status', id, **self.extra)
                self.assertEqual(json.loads(r.stdout)['state'], 'error')

    def test_job_reports_real_modem_failure(self):
        for shell in self.each_shell():
            self.reset(reject=True)
            job = json.loads(self.script(shell, self.lock, 'start', 'endc', 'off', **self.extra).stdout)
            for _ in range(50):
                result = json.loads(self.script(shell, self.lock, 'status', job['id'], **self.extra).stdout)
                if result['state'] in ('done','error'): break
                time.sleep(.02)
            self.assertEqual(result['state'], 'error')
            self.assertEqual(result['ok'], 0)
            self.assertIn('模组拒绝', result['error'])
            self.assertFalse((self.state / 'endc').exists())

    def test_dead_mutex_reclaimed_but_live_owner_not_removed(self):
        for shell in self.each_shell():
            mutex = self.tmp / 'mutex'
            mutex.mkdir(exist_ok=True)
            (mutex / 'pid').write_text('99999999')
            self.assertEqual(self.apply(shell, 'endc', 'on').returncode, 0)
            mutex.mkdir(exist_ok=True)
            (mutex / 'pid').write_text('1')
            self.reset()
            r = self.apply(shell, 'endc', 'off')
            self.assertNotEqual(r.returncode, 0)
            self.assertEqual((mutex / 'pid').read_text(), '1')
            self.assertEqual((self.tmp / 'commands').read_text(), '')
            shutil.rmtree(mutex)


class LockFrontend(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node required')
    def test_result_waiter(self):
        r = subprocess.run(['node', str(TOP / 'tests/dashboard_lock_jobs.js')], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_packaging_and_no_timestamp_success(self):
        for name in ('home', 'locks'):
            src = (LIB.parents[3] / f'htdocs/luci-static/resources/view/mu300/{name}.js').read_text()
            self.assertNotIn('readback(Date.now()', src)
            self.assertNotIn('35000', src)
        for path in ('tools/build-openwrt-tf-magisk.sh','tools/make-release.sh'):
            for name in ('lock-apply.sh','lock-jobs.sh'):
                self.assertIn('/unisoc-modem/'+name, (TOP / path).read_text())
