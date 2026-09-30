"""Checks over every script without running it: syntax under each shell that runs it, executable bits, and rules
that past bugs taught (see each test)."""
import re
import shutil
import subprocess
import unittest

from helpers import BIN, TOP, shells

OPENWRT = TOP / 'openwrt' / 'overlay'
LUCI_MU300 = TOP / 'openwrt' / 'luci-app-mu300'


def shebang(p):
    try:
        with open(p, 'rb') as f:
            first = f.readline()
    except OSError:
        return ''
    return first.decode(errors='replace').strip() if first.startswith(b'#!') else ''


def shell_scripts():
    """(path, 'sh'|'bash') of every shell script the project ships or runs."""
    cands = list(BIN.iterdir()) + list((TOP / 'tools').glob('*.sh')) + [
        TOP / 'install.sh', TOP / 'uninstall.sh', TOP / 'boot' / 'init', TOP / 'rootfs' / 'assemble.sh',
        TOP / 'kernel' / 'build-all.sh', TOP / 'tools' / 'i18n.sh', TOP / 'tools' / 'self-update.sh',
        TOP / 'tools' / 'linux-mode.sh', TOP / 'android-vendor' / 'ueventd-perms.sh']
    cands += [p for p in OPENWRT.rglob('*') if p.is_file()]
    cands += [p for p in (LUCI_MU300 / 'root').rglob('*') if p.is_file()]
    out = []
    for p in sorted(set(cands)):
        if not p.is_file():
            continue
        sb = shebang(p)
        if 'bash' in sb:
            out.append((p, 'bash'))
        elif sb.endswith('sh') or 'rc.common' in sb or (not sb and p.suffix == '.sh'):
            out.append((p, 'sh'))
    return out


class Syntax(unittest.TestCase):
    def test_every_script_parses(self):
        sh_shells = [s for s in shells() if s[0] != 'bash'] or shells()
        scripts = shell_scripts()
        self.assertGreater(len(scripts), 40)
        for p, kind in scripts:
            if kind == 'bash' and not shutil.which('bash'):
                continue
            for s in ([['bash']] if kind == 'bash' else sh_shells):
                with self.subTest(script=str(p.relative_to(TOP)), shell=' '.join(s)):
                    r = subprocess.run(s + ['-n', str(p)], capture_output=True, text=True)
                    self.assertEqual(r.returncode, 0, r.stderr)

    def test_device_programs_are_executable(self):
        for p in BIN.iterdir():
            if p.is_file() and shebang(p):
                with self.subTest(p=p.name):
                    self.assertTrue(p.stat().st_mode & 0o111, 'not executable')


class Rules(unittest.TestCase):
    def test_luci_mu300_is_one_package(self):
        # The web UI used to be scattered through the base OpenWrt overlay.
        # Keep one package as the canonical owner so built-in and installable
        # copies cannot drift apart.
        required = (
            'Makefile',
            'root/usr/libexec/rpcd/mu300dash',
            'root/usr/share/luci/menu.d/luci-app-mu300.json',
            'root/usr/share/rpcd/acl.d/luci-app-mu300.json',
            'root/usr/libexec/unisoc-modem/dashboard-info',
            'root/usr/libexec/unisoc-modem/cell',
            'root/usr/libexec/unisoc-modem/action',
            'root/usr/libexec/unisoc-modem/lock',
            'root/usr/libexec/unisoc-modem/at',
            'root/usr/libexec/unisoc-modem/boot-replay',
            'root/etc/init.d/unisoc-modem-ui',
            'root/etc/config/unisoc_modem',
            'htdocs/luci-static/resources/mu300/common.js',
            'htdocs/luci-static/resources/view/mu300/home.js',
            'htdocs/luci-static/resources/view/mu300/at.js',
            'htdocs/luci-static/resources/view/mu300/sms.js',
            'htdocs/luci-static/resources/view/mu300/locks.js',
            'htdocs/luci-static/resources/view/mu300/settings.js',
        )
        for rel in required:
            with self.subTest(path=rel):
                self.assertTrue((LUCI_MU300 / rel).is_file())
        self.assertFalse((OPENWRT / 'usr/libexec/rpcd/mu300dash').exists())
        legacy_views = OPENWRT / 'www/luci-static/resources/view/mu300'
        self.assertFalse(any(p.is_file() for p in legacy_views.rglob('*')))

    def test_powershell_device_commands_have_no_double_quotes(self):
        # Windows PowerShell 5.1 drops the double quotes inside an argument to a native program: `tr -d "\000"`
        # reached the device as tr -d \000 ("delete the character 0"), and every empty region was "not empty".
        # A command for the device (SuDo, adb shell) may therefore contain no `" and no "".
        for name in ('install.ps1', 'uninstall.ps1'):
            for n, line in enumerate((TOP / name).read_text().splitlines(), 1):
                code = line.split('#', 1)[0] if not line.lstrip().startswith('#') else ''
                if re.search(r'\bSuDo(ToFile)?\s+"|adb shell\s+"', code) and ('`"' in code or '""' in code):
                    self.fail(f'{name}:{n}: double quote inside a device command: {line.strip()}')

    def test_powershell_scripts_are_ascii(self):
        # Windows PowerShell 5.1 reads a file without a BOM as ANSI: non-ASCII text in the script is garbled
        for name in ('install.ps1', 'uninstall.ps1'):
            data = (TOP / name).read_bytes()
            bad = [i for i, b in enumerate(data) if b > 127]
            self.assertFalse(bad, f'{name}: non-ASCII byte at offset {bad[:1]}')

    def test_windows_pushes_text_with_lf(self):
        # a CRLF clone pushed its scripts as they were and Android's sh ran none of them (issue #7): the Windows
        # installers send text files through PushUnix, never a plain adb push
        for name in ('install.ps1', 'uninstall.ps1'):
            for n, line in enumerate((TOP / name).read_text().splitlines(), 1):
                if 'adb push' in line:
                    self.assertNotRegex(line, r'\.(sh|prop)\b|mu300-linux"|\$f"', f'{name}:{n}')
        self.assertIn('eol=lf', (TOP / '.gitattributes').read_text())

    def test_single_quoted_scripts_have_no_apostrophes(self):
        # A script handed to `sh -c '...'` (docker run) ends at its first apostrophe: "the U30 Air's charger" in a
        # comment there broke OpenWrt's build at release time, while every parser still saw balanced quotes.
        for name in ('openwrt/build-rootfs.sh', 'tools/make-release.sh'):
            lines = (TOP / name).read_text().splitlines()
            for n, line in enumerate(lines):
                if not line.rstrip().endswith("-c '"):
                    continue
                for m in range(n + 1, len(lines)):
                    if "'" in lines[m]:
                        self.assertTrue(lines[m].rstrip().endswith("'") and lines[m].count("'") == 1,
                                        f'{name}:{m + 1}: an apostrophe inside the script of line {n + 1}')
                        break

    def test_init_finds_partitions_after_the_modules(self):
        # the eMMC driver is one of the vendor modules: misc and boot_b cannot be found before they are loaded
        init = (TOP / 'boot' / 'init').read_text()
        calls = [l.strip() for l in init.splitlines()
                 if l.strip() in ('load_vendor_modules', 'find_misc_and_bootb')]
        self.assertEqual(calls, ['load_vendor_modules', 'find_misc_and_bootb'])

    def test_every_device_has_its_files(self):
        # a device the installers know needs its module order; its modules come from kernel/build-<device>.sh
        for dev in ('u30air',):
            self.assertTrue((TOP / 'boot' / f'module-order-{dev}.txt').is_file())
            self.assertTrue((TOP / 'kernel' / f'{dev}.fragment').is_file())
            self.assertIn(dev, (TOP / 'install.sh').read_text())
            self.assertIn(dev, (TOP / 'install.ps1').read_text())


if __name__ == '__main__':
    unittest.main()
