"""The standalone dashboard follows LuCI's locale and theme tokens."""
import shutil
import subprocess
import unittest

from helpers import TOP


COMMON = TOP / 'openwrt/luci-app-mu300/htdocs/luci-static/resources/mu300/common.js'
HOME = TOP / 'openwrt/luci-app-mu300/htdocs/luci-static/resources/view/mu300/home.js'
PACKAGE = TOP / 'openwrt/luci-app-mu300'


@unittest.skipUnless(shutil.which('node'), 'Node.js is needed for LuCI JS smoke tests')
class DashboardI18n(unittest.TestCase):
    def test_package_installs_frontend_and_boot_worker(self):
        makefile = (PACKAGE / 'Makefile').read_text()
        self.assertIn('$(CP) ./htdocs/. $(1)/www/', makefile)
        self.assertIn('$(CP) ./root/. $(1)/', makefile)
        self.assertIn('/etc/init.d/unisoc-modem-ui enable', makefile)
        for name in ('home', 'at', 'locks', 'sms', 'settings'):
            self.assertTrue((PACKAGE / f'htdocs/luci-static/resources/view/mu300/{name}.js').is_file())

    def run_js(self, body):
        harness = r'''
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
let lang = 'en', aurora = '', official = 'hsl(0,0%,100%)', selected;
const root = { classList: { remove: () => {}, toggle: (name, value) => { selected = value; } } };
const document = { documentElement: root, body: {}, getElementById: () => ({}), head: { appendChild: () => {} } };
const style = (el) => ({ getPropertyValue: (key) =>
    key === '--surface' ? aurora : key === '--background-color-high' ? official : '' });
const M = new Function('rpc', 'baseclass', 'L', 'document', 'navigator', 'getComputedStyle', src)(
    { declare: () => () => {} }, { extend: (obj) => obj }, { env: { get lang() { return lang; } } },
    document, { language: 'en-US' }, style);
''' + body
        result = subprocess.run(['node', '-e', harness, str(COMMON)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_three_dashboard_languages(self):
        self.run_js("""
lang = 'en';
if (M.translate('链路与流量 · 无应答') !== 'Link & traffic · No response') throw Error('English');
lang = 'tr_TR';
if (M.translate('链路与流量 · 无应答') !== 'Bağlantı ve trafik · Yanıt yok') throw Error('Turkish');
lang = 'zh_Hans';
if (M.translate('链路与流量 · 无应答') !== '链路与流量 · 无应答') throw Error('Chinese');
""")

    def test_official_theme_bridge_keeps_aurora_intact(self):
        self.run_js("""
aurora = ''; M.injectCss();
if (selected !== true) throw Error('Bootstrap bridge missing');
M.injectCss();
if (selected !== true) throw Error('Bootstrap bridge lost on next page');
aurora = '#fff'; M.injectCss();
if (selected !== false) throw Error('Aurora must retain its own variables');
""")

    def test_dashboard_static_labels_have_english_and_turkish(self):
        self.run_js("""
const homeSrc = fs.readFileSync(process.argv[2], 'utf8');
const home = new Function('view', 'poll', 'M', homeSrc)(
    { extend: (obj) => obj }, {}, M);
for (const locale of ['en', 'tr']) {
    lang = locale;
    const visible = M.translate(home.html().replace(/<[^>]+>/g, ' '));
    if (/[\u3400-\u9fff]/.test(visible)) throw Error(locale + ': untranslated static label: ' + visible.match(/[\u3400-\u9fff]+/)[0]);
}
""".replace('process.argv[2]', repr(str(HOME))))


if __name__ == '__main__':
    unittest.main()
