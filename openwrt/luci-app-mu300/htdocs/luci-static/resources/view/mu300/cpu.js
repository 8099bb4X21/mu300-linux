'use strict';
'require view';
'require rpc';
'require poll';
'require mu300.common as M';

var get = rpc.declare({ object: 'mu300dash', method: 'cpu_get', expect: { '': {} } });
var apply = rpc.declare({ object: 'mu300dash', method: 'cpu_apply', params: ['payload'], expect: { '': {} } });
function node(tag, text, cls) {
    var e = document.createElement(tag); if (text != null) e.textContent = text;
    if (cls) e.className = cls; return e;
}
function mhz(n) { return n == null ? '--' : (n / 1000) + ' MHz'; }
function select(values, value, label) {
    var e = node('select');
    values.forEach(function(v) { var o = node('option', label ? label(v) : v); o.value = v; e.appendChild(o); });
    e.value = value; return e;
}
function field(name, input) { var e = node('label', null, 'mud-cpu-field'); e.append(node('span', M.translate(name)), input); return e; }

return view.extend({
    load: function() { return get(); },
    render: function(data) {
        M.injectCss(); M.localizeMenu();
        var self = this, root = this.root = node('div', null, 'mud');
        root.appendChild(node('style', '.mud-cpu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:14px}.mud-cpu-field{display:flex;flex-direction:column;gap:8px;margin:14px 0}.mud-cpu-field select,.mud-cpu-field input{width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid var(--hairline,#8885);border-radius:8px;background:var(--surface,#fff);color:var(--text,#222)}.mud-cpu-actions{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:14px}.mud-cpu-grid .mud-card{min-width:0;overflow-wrap:anywhere}'));
        root.append(node('h2', M.translate('CPU 设置')), node('p', M.translate('仅调整驱动支持的调速器与频率范围，不修改电压或温控。'), 'mud-note'));
        var grid = node('div', null, 'mud-cpu-grid'); root.append(grid);
        this.inputs = [];
        (data.policies || []).forEach(function(p) {
            var card = node('section', null, 'mud-card'), current = node('div', mhz(p.current), 'mud-cpu-current'); current.dataset.policy = p.id;
            card.append(node('h3', 'CPU ' + p.cpus.replace(/ /g, ', ')), current);
            var gov = select(p.governors, p.governor), lo, hi;
            if (p.frequencies.length) { lo = select(p.frequencies, p.min, mhz); hi = select(p.frequencies, p.max, mhz); }
            else { lo = node('input'); hi = node('input'); [lo, hi].forEach(function(e) { e.type = 'number'; e.min = p.hardware_min; e.max = p.hardware_max; e.step = 1; }); lo.value = p.min; hi.value = p.max; }
            [gov, lo, hi].forEach(function(e) { e.disabled = !p.writable; });
            card.append(field('调速器', gov), field(p.frequencies.length ? '最低频率' : '最低频率（kHz）', lo), field(p.frequencies.length ? '最高频率' : '最高频率（kHz）', hi));
            card.append(node('p', p.driver + ' · ' + mhz(p.hardware_min) + ' – ' + mhz(p.hardware_max), 'mud-note'));
            grid.append(card); if (p.writable) self.inputs.push({ p: p, gov: gov, lo: lo, hi: hi });
        });
        if (!(data.policies || []).length) root.append(node('div', M.translate('CPU 调频驱动尚未就绪'), 'mud-card'));
        var controls = node('div', null, 'mud-cpu-actions'), persist = this.persist = node('input'); persist.type = 'checkbox'; persist.checked = !!data.persist;
        var label = node('label'); label.append(persist, document.createTextNode(' ' + M.translate('开机自动应用')));
        var button = node('button', M.translate('应用设置'), 'mud-btn on'); button.disabled = !this.inputs.length;
        controls.append(label, button); root.append(controls, node('p', M.translate('未勾选时仅本次运行生效，并取消之前保存的开机应用设置。'), 'mud-note'));
        button.onclick = function() {
            if (self.busy) return;
            var changes = self.inputs.map(function(x) { return { id: x.p.id, cpus: x.p.cpus, governor: x.gov.value, min: Number(x.lo.value), max: Number(x.hi.value) }; });
            if (changes.some(function(c) { return !Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min > c.max; })) { M.toast(M.translate('CPU 配置无效'), { type: 'error' }); return; }
            self.busy = true;
            M.confirmBox('应用 CPU 设置？', '降低频率可能降低吞吐量；提高最低频率可能增加功耗和温度。').then(function(yes) {
                if (!yes) return;
                M.busy(button, true);
                var toast = M.toast('正在应用 CPU 设置…', { type: 'busy', timeout: 0 });
                return apply(JSON.stringify({ changes: changes, persist: persist.checked })).then(function(r) {
                    if (!r.ok) throw new Error(r.rollback === false ? 'CPU 设置失败且回滚不完整，请检查实际状态' : r.error || 'CPU 配置无效');
                    M.toast(M.translate('CPU 设置已应用'), { type: 'success' });
                }).catch(function(e) { M.toast(M.translate(e.message), { type: 'error' }); }).finally(function() { toast.close(); M.busy(button, false); });
            }).finally(function() { self.busy = false; });
        };
        this.refresh = function() {
            if (document.hidden || !root.isConnected || self.busy || self.inflight) return Promise.resolve();
            self.inflight = true;
            return get().then(function(r) {
                if (!root.isConnected) return;
                (r.policies || []).forEach(function(p) { var e = root.querySelector('[data-policy="' + p.id + '"]'); if (e) e.textContent = mhz(p.current); });
            }).catch(function() {}).finally(function() { self.inflight = false; });
        };
        poll.add(this.refresh, 2);
        return root;
    },
    unload: function() { poll.remove(this.refresh); },
    handleSaveApply: null, handleSave: null, handleReset: null
});
