'use strict';
'require view';
'require rpc';
'require poll';
'require mu300.common as M';

/* CPU 简易设置：在五个"模式"之间选择 + "默认生效"勾选框。
 * 频率复用内置 cpu.uc（单一数据源），核心限制用 cgroup v2 cpuset；
 * 真关核（热插拔）仅在重编内核后可用，否则自动回退 cpuset。 */
var callGet = rpc.declare({ object: 'mu300cpusimple', method: 'get', expect: { '': {} } });
var callApply = rpc.declare({ object: 'mu300cpusimple', method: 'apply', params: [ 'payload' ], expect: { '': {} } });

var MODES = [
	{
		id: 'openwrt-default', name: 'OpenWrt 默认',
		cores: '8 核（CPU 0–7）',
		freq: '不锁频，恢复开机基线',
		impact: '官方默认策略，随负载升降频，通用且省电。',
		tag: '默认'
	},
	{
		id: 'android-default', name: 'Android 默认',
		cores: '4 核（CPU 0–3，仅小核）',
		freq: '小核 ≤ 1.4 GHz，大核两簇压到最低频',
		impact: '最省电、发热最低；大核不参与运算，单核/多核吞吐明显下降，适合轻载常开。',
		tag: '省电'
	},
	{
		id: 'little-save', name: '小核省电模式',
		cores: '4 核（CPU 0–3，仅小核）',
		freq: '小核不锁频，大核两簇压到最低频',
		impact: '省电但小核可按需全速，响应比“Android 默认”好；适合想省电又不愿明显卡顿的场景。',
		tag: '省电'
	},
	{
		id: 'balanced', name: '适中模式',
		cores: '5 核（CPU 0–3 小核 + CPU 7 大核）',
		freq: '小核与 CPU 7 不锁频，CPU 4–6 压到最低频',
		impact: '兼顾性能与功耗；中等负载、需要一定单核/多核能力的场景。',
		tag: '均衡'
	},
	{
		id: 'performance', name: '性能模式',
		cores: '8 核（CPU 0–7）',
		freq: '三簇全部锁到硬件最高频（2002 / 2301 / 2210 MHz）',
		impact: '性能最高、响应最快；发热与功耗最大，长时间高负载需注意散热。本机满载可能断网掉线（机器固有），慎用。',
		tag: '性能'
	}
];

function fmtMHz(n) { return n == null || n === '' ? '--' : (n / 1000) + ' MHz'; }

return view.extend({
	load: function() {
		return L.resolveDefault(callGet(), {});
	},
	render: function(data) {
		M.injectCss();
		M.localizeMenu();
		var self = this;
		this.data = data || {};
		var root = this.root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = `
<style>
.cs-wrap{max-width:960px;margin:0 auto}
.cs-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;margin:6px 0 4px}
.cs-mode{position:relative;display:flex;gap:10px;align-items:flex-start;padding:14px 16px;border:1px solid var(--hairline,var(--border,#ddd));border-radius:12px;cursor:pointer;background:var(--surface,#fff);transition:border-color .15s,background .15s}
.cs-mode:hover{border-color:var(--brand,#2f7bf6)}
.cs-mode.sel{border-color:var(--brand,#2f7bf6);background:color-mix(in srgb,var(--brand,#2f7bf6) 6%,var(--surface,#fff))}
.cs-mode input{margin:4px 0 0;flex-shrink:0;accent-color:var(--brand,#2f7bf6)}
.cs-mode .cs-body{min-width:0}
.cs-mode h4{margin:0 0 6px;font-size:.92rem;font-weight:650;color:var(--text,#222)}
.cs-mode .cs-lines{margin:0 0 8px;font-size:.75rem;color:var(--text-muted,#777);line-height:1.6}
.cs-mode .cs-impact{margin:0;font-size:.72rem;color:var(--text-muted,#888);line-height:1.6}
.cs-badge{position:absolute;top:12px;right:12px;font-size:.62rem;padding:2px 8px;border-radius:99px;border:1px solid var(--hairline,#ddd);color:var(--text-muted,#777)}
.cs-opts{display:flex;flex-direction:column;gap:12px;margin:18px 0 0;padding-top:16px;border-top:1px solid var(--hairline,#ddd)}
.cs-toggle{display:flex;gap:9px;align-items:flex-start;font-size:.82rem;color:var(--text,#222);cursor:pointer}
.cs-toggle input{margin:3px 0 0;flex-shrink:0;accent-color:var(--brand,#2f7bf6)}
.cs-toggle small{display:block;color:var(--text-muted,#888);font-size:.7rem;line-height:1.6;margin-top:2px}
.cs-toggle input:disabled+span{opacity:.55}
.cs-actions{display:flex;gap:12px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-top:18px;padding-top:16px;border-top:1px solid var(--hairline,#ddd)}
.cs-err{color:var(--danger,#d45);font-size:.78rem;flex:1;min-width:160px}
.cs-state{font-size:.75rem;color:var(--text-muted,#777);line-height:1.7;margin-top:10px}
.cs-state b{color:var(--text,#222)}
.cs-freq{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:8px 18px;margin-top:8px}
.cs-freq>div{display:flex;justify-content:space-between;gap:10px;font-size:.75rem;color:var(--text-muted,#777);padding:6px 0;border-bottom:1px solid var(--hairline,#ddd)}
.cs-freq b{color:var(--text,#222);font-variant-numeric:tabular-nums}
</style>
<div class="cs-wrap">
 <h2>CPU 简易设置</h2>
 <p class="mud-note">选择一个模式后点“应用”。频率复用固件内置机制（与“CPU 设置”页共享，最后操作者生效）；核心限制通过 cgroup 只作用于系统服务。</p>

 <div class="mud-card" style="padding:18px;margin-top:12px">
  <h3 style="margin-top:0">运行模式</h3>
  <div class="cs-modes" id="cs-modes"></div>

  <div class="cs-opts">
   <label class="cs-toggle"><input type="checkbox" id="cs-persist">
    <span>默认生效<small>勾选：写入配置，开机自动回放；不勾：仅本次生效，重启后回到上次持久设置（无则回到系统默认）。</small></span></label>
   <label class="cs-toggle"><input type="checkbox" id="cs-hotplug">
    <span>真关核（热插拔）<small id="cs-hotplug-note">打开后“Android 默认/小核省电”真正下线大核（CPU 4–7），“适中模式”下线 CPU 4–6。需内核开启 CONFIG_HOTPLUG_CPU；当前内核不支持时此项不可用，将自动回退为 cpuset 限制。</small></span></label>
  </div>

  <div class="cs-actions">
   <span class="cs-err" id="cs-err"></span>
   <button class="mud-btn on" id="cs-apply">应用</button>
  </div>
 </div>

 <div class="mud-card" style="padding:18px;margin-top:14px">
  <h3 style="margin-top:0">当前状态</h3>
  <div class="cs-state" id="cs-state"></div>
  <div class="cs-freq" id="cs-freq"></div>
 </div>
</div>`;
		this.sel = this.data.active || 'openwrt-default';
		this.paintModes();
		this.q('cs-persist').checked = false;
		this.q('cs-hotplug').checked = !!this.data.hotplug_requested;
		this.paintHotplug();
		this.paintState();
		this.wire();
		M.localize(root);

		this._refresh = function() {
			if (document.hidden || !root.isConnected) return Promise.resolve();
			return L.resolveDefault(callGet(), {}).then(function(d) {
				if (d && d.ok && self.root.isConnected) { self.data = d; self.paintState(); }
			});
		};
		poll.add(this._refresh, 5);
		return root;
	},
	q: function(id) { return this.root.querySelector('#' + id); },
	paintModes: function() {
		var self = this, box = this.q('cs-modes');
		box.replaceChildren();
		MODES.forEach(function(m) {
			var label = document.createElement('label');
			label.className = 'cs-mode' + (m.id === self.sel ? ' sel' : '');
			label.innerHTML = '<input type="radio" name="cs-mode" value="' + m.id + '"' + (m.id === self.sel ? ' checked' : '') + '>' +
				'<div class="cs-body"><h4>' + M.translate(m.name) + '</h4>' +
				'<div class="cs-lines">' + M.translate('可用核：') + M.translate(m.cores) + '<br>' + M.translate('频率：') + M.translate(m.freq) + '</div>' +
				'<p class="cs-impact">' + M.translate(m.impact) + '</p></div>' +
				'<span class="cs-badge">' + M.translate(m.tag) + '</span>';
			label.querySelector('input').onchange = function() {
				self.sel = m.id; self.paintModes();
			};
			box.appendChild(label);
		});
	},
	paintHotplug: function() {
		var supported = !!(this.data && this.data.hotplug_supported);
		var el = this.q('cs-hotplug');
		el.disabled = !supported;
		if (!supported) el.checked = false;
		var note = this.q('cs-hotplug-note');
		note.textContent = supported
			? M.translate('已检测到内核支持热插拔：打开后“Android 默认/小核省电”真正下线大核（CPU 4–7），“适中模式”下线 CPU 4–6。')
			: M.translate('当前内核未开启 CONFIG_HOTPLUG_CPU，无法真正下线大核；此项不可用，将自动回退为 cpuset 限制。');
	},
	paintState: function() {
		var d = this.data || {};
		var name = {};
		MODES.forEach(function(m) { name[m.id] = m.name; });
		var active = M.translate(name[d.active] || d.active || 'OpenWrt 默认');
		var saved = d.persisted && d.mode ? M.translate(name[d.mode] || d.mode) : M.translate('无（系统默认）');
		var s = this.q('cs-state');
		s.innerHTML = M.translate('当前生效模式：') + '<b>' + active + '</b>' +
			' · ' + M.translate('已存默认：') + '<b>' + saved + '</b>' +
			' · ' + M.translate('服务可用核：') + '<b>' + (d.cpus_effective || '0-7') + '</b>' +
			' · ' + M.translate('实际在线核：') + '<b>' + (d.online_cpus || '0-7') + '</b>' +
			' · ' + M.translate('热插拔：') + '<b>' + (d.hotplug_supported ? M.translate('支持') : M.translate('不支持')) + '</b>';
		var f = this.q('cs-freq');
		f.replaceChildren();
		(d.policies || []).forEach(function(p) {
			var row = document.createElement('div');
			var title = p.cpus ? 'CPU ' + p.cpus.trim().replace(/\s+/g, ',') : p.id;
			row.innerHTML = '<span>' + title + '</span><b>' +
				fmtMHz(p.current) + ' / ' + fmtMHz(p.max) + ' · ' + (p.governor || '--') + '</b>';
			f.appendChild(row);
		});
	},
	error: function(s) { this.q('cs-err').textContent = s ? M.translate(s) : ''; },
	wire: function() {
		var self = this;
		this.q('cs-apply').onclick = function() {
			var payload = {
				mode: self.sel,
				persist: self.q('cs-persist').checked,
				hotplug: self.q('cs-hotplug').checked && !self.q('cs-hotplug').disabled
			};
			var modeName = (MODES.filter(function(m) { return m.id === payload.mode; })[0] || {}).name || payload.mode;
			var extra = payload.persist ? M.translate('并设为默认（开机生效）') : M.translate('仅本次生效');
			M.confirmBox(M.translate('应用模式？'), M.translate(modeName) + ' · ' + extra, { okText: M.translate('应用') }).then(function(yes) {
				if (!yes) return;
				var btn = self.q('cs-apply'); M.busy(btn, true); self.error('');
				L.resolveDefault(callApply(JSON.stringify(payload)), {}).then(function(r) {
					M.busy(btn, false);
					if (!r || !r.ok) { self.error((r && r.error) || '应用失败'); M.toast('应用失败', { type: 'error' }); return; }
					self.data = r; self.paintState(); self.paintHotplug();
					M.toast('已应用：' + M.translate(modeName), { type: 'success' });
				});
			});
		};
	},
	unload: function() { poll.remove(this._refresh); }
});