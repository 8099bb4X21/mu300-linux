'use strict';
'require view';
'require mu300.common as M';

/* 网络锁定 -- 模式 / 频段 / 小区 / EN-DC，全部经 ubus mu300dash lock_set -> 后端
 * mu300-dash-lock（编码按 ufi_tools 权威实现），应用后 SFUN 重启协议栈并落盘，
 * 开机由 init.d/mu300-dash 回放。页面只在打开和手动刷新时 lock_get（7 条 AT 读）。 */

var MODES = [ [ 'auto', '自动' ], [ '4g', '仅 4G' ], [ 'sa', '5G SA' ], [ 'nsa', '5G NSA' ] ];
var NR_CAND = [ 1, 3, 5, 8, 28, 41, 77, 78, 79 ];
var LTE_CAND = [ 1, 3, 5, 8, 34, 38, 39, 40, 41 ];

return view.extend({
	load: function() { return Promise.resolve(); },

	render: function() {
		M.injectCss();
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = `
<div class="mud-grid">
  <div class="mud-card" style="grid-column:1/-1">
    <h3>当前驻网（锁定前的参照）</h3>
    <div class="mud-rows" id="mud-srv"></div>
  </div>

  <div class="mud-card">
    <h3>网络模式 / EN-DC</h3>
    <div class="mud-r" style="margin-bottom:6px"><span class="mud-k">当前模式</span><span class="mud-v" id="mud-lock-modeline">--</span></div>
    <div class="mud-ctl" id="mud-lock-modes" style="grid-template-columns:repeat(4,1fr)"></div>
    <div class="mud-ctl" style="margin-top:7px;grid-template-columns:1fr 1fr">
      <button class="mud-btn" id="mud-lock-endc">EN-DC</button>
      <button class="mud-btn" id="mud-lock-refresh">刷新锁定状态</button>
    </div>
  </div>

  <div class="mud-card">
    <h3>频段锁定</h3>
    <div class="mud-r"><span class="mud-k">NR 频段</span><span class="mud-v" id="mud-lock-nrline">--</span></div>
    <div class="mud-chiprow" id="mud-lock-nr"></div>
    <div class="mud-r" style="margin-top:6px"><span class="mud-k">LTE 频段</span><span class="mud-v" id="mud-lock-lteline">--</span></div>
    <div class="mud-chiprow" id="mud-lock-lte"></div>
    <div class="mud-ctl" style="margin-top:7px;grid-template-columns:1fr 1fr">
      <button class="mud-btn" id="mud-lock-nr-apply">应用 NR 频段</button>
      <button class="mud-btn" id="mud-lock-lte-apply">应用 LTE 频段</button>
    </div>
  </div>

  <div class="mud-card">
    <h3>小区锁定</h3>
    <div class="mud-r"><span class="mud-k">当前锁定</span><span class="mud-v" id="mud-lock-cellline">--</span></div>
    <div class="mud-ctl" style="margin-top:8px">
      <button class="mud-btn" id="mud-lock-cell">锁定当前服务小区</button>
      <button class="mud-btn warn" id="mud-lock-cell-off">解除小区锁定</button>
    </div>
  </div>

  <div class="mud-card" style="grid-column:1/-1">
    <div class="mud-note" id="mud-lock-note">锁定属低频高危操作：应用后会重启协议栈（SFUN），蜂窝断开约半分钟；设置自动保存并在开机时回放。频段全不选再点应用 = 恢复自动。</div>
  </div>
</div>`;
		this.wire(root);
		return root;
	},

	wire: function(root) {
		var self = this;
		this.lockSel = { nr: {}, lte: {} };
		this.lockCand = { nr: NR_CAND, lte: LTE_CAND };
		var q = function(id) { return root.querySelector('#mud-' + id); };
		var self0 = this;

		var apply = function(kind, val, what) {
			if (!window.confirm('应用「' + what + '」？\n协议栈会重启（SFUN），蜂窝断开约半分钟。')) return;
			M.v('lock-note').textContent = '正在后台应用 ' + what + ' …（SFUN 重启 + 重新驻网，约半分钟）';
			L.resolveDefault(M.callLockSet(kind, val)).then(function(r) {
				r = r || {};
				M.v('lock-note').textContent = r.ok ? '已后台执行：' + (r.op || kind) + '。约半分钟后点「刷新锁定状态」确认。' : ('失败：' + (r.error || '未知错误'));
				setTimeout(function() { self.refresh(); }, 35000);
			}, function() { M.v('lock-note').textContent = '调用失败'; });
		};

		q('lock-modes').innerHTML = MODES.map(function(m) {
			return '<button class="mud-btn" data-mode="' + m[0] + '">' + m[1] + '</button>';
		}).join('');
		root.querySelectorAll('#mud-lock-modes .mud-btn').forEach(function(b) {
			b.onclick = function() {
				var m = b.getAttribute('data-mode');
				if (m === (self.lastLock && self.lastLock.mode && self.lastLock.mode.label)) return;
				apply('mode', m, '网络模式：' + b.textContent);
			};
		});
		q('lock-endc').onclick = function() {
			var on = self.lastLock && self.lastLock.endc === '1';
			apply('endc', on ? 'off' : 'on', on ? '关闭 EN-DC（NSA 锚点）' : '开启 EN-DC（NSA 锚点）');
		};
		q('lock-refresh').onclick = function() { self.refresh(); };

		var chipRow = function(el, rat, cand) {
			el.innerHTML = cand.map(function(b) {
				return '<span class="mud-chip" data-rat="' + rat + '" data-b="' + b + '">' + (rat === 'nr' ? 'n' : 'B') + b + '</span>';
			}).join('');
		};
		chipRow(q('lock-nr'), 'nr', NR_CAND);
		chipRow(q('lock-lte'), 'lte', LTE_CAND);
		root.querySelectorAll('#mud-lock-nr .mud-chip, #mud-lock-lte .mud-chip').forEach(function(ch) {
			ch.onclick = function() {
				var rat = ch.getAttribute('data-rat'), b = ch.getAttribute('data-b');
				self.lockSel[rat][b] = !self.lockSel[rat][b];
				ch.className = self.lockSel[rat][b] ? 'mud-chip on' : 'mud-chip';
			};
		});
		var selBands = function(rat) {
			return Object.keys(self.lockSel[rat]).filter(function(b) { return self.lockSel[rat][b]; })
				.map(Number).sort(function(a, b) { return a - b; });
		};
		q('lock-nr-apply').onclick = function() {
			var sel = selBands('nr');
			if (!sel.length) return apply('nr', '', 'NR 频段：恢复自动');
			apply('nr', sel.join(','), 'NR 频段锁定：n' + sel.join(' n'));
		};
		q('lock-lte-apply').onclick = function() {
			var sel = selBands('lte');
			if (!sel.length) return apply('lte', '', 'LTE 频段：恢复自动');
			apply('lte', sel.join(','), 'LTE 频段锁定：B' + sel.join(' B'));
		};
		q('lock-cell').onclick = function() { apply('cell', 'auto', '锁定当前服务小区'); };
		q('lock-cell-off').onclick = function() { apply('cell', 'off', '解除小区锁定'); };

		this.Q = function(id) { return root.querySelector('#mud-' + id); };
		this.refresh();
		/* 顶部的当前驻网参照（只读缓存，不发 AT） */
		L.resolveDefault(M.callStatus()).then(function(st) {
			var c = (st || {}).cell, l = [];
			if (c && !c.error) {
				if (c.nr && c.nr.band) l.push([ 'NR 服务小区', 'n' + c.nr.band + ' · PCI ' + c.nr.pci + ' · ARFCN ' + c.nr.arfcn ]);
				if (c.lte && c.lte.band) l.push([ 'LTE 锚点', 'B' + c.lte.band + ' · PCI ' + c.lte.pci + ' · EARFCN ' + c.lte.earfcn ]);
				l.push([ '运营商', M.carrierName(c.operator) ]);
			}
			self0.Q('srv').innerHTML = (l.length ? l.map(function(x) {
				return '<div class="mud-r"><span class="mud-k">' + x[0] + '</span><span class="mud-v">' + M.esc(x[1]) + '</span></div>';
			}).join('') : '<div class="mud-r"><span class="mud-k">状态</span><span class="mud-v">暂无驻网数据（看板页的采集器稍后填上）</span></div>');
		});
	},

	refresh: function() {
		var self = this;
		L.resolveDefault(M.callLockGet()).then(function(l) { self.lastLock = l || {}; self.paint(); });
	},

	paint: function() {
		var l = this.lastLock || {};
		var self = this;
		/* 渲染后的首轮刷新可能早于节点挂载，查找一律走页面局部 */
		var setR = function(id, txt) { var e = self.Q(id); if (e) e.textContent = (txt == null || txt === '') ? '--' : txt; };
		if (l.error) { setR('lock-modeline', l.error); return; }
		var MODE_TXT = { auto: '自动（5G/4G）', '4g': '仅 4G', sa: '仅 5G SA', nsa: '仅 5G NSA' };
		setR('lock-modeline', MODE_TXT[l.mode && l.mode.label] || '--');
		var modesBox = self.Q('lock-modes');
		if (modesBox) Array.prototype.forEach.call(modesBox.querySelectorAll('.mud-btn'), function(b) {
			b.className = (b.getAttribute('data-mode') === (l.mode && l.mode.label)) ? 'mud-btn on' : 'mud-btn';
		});
		var eb = self.Q('lock-endc');
		if (eb) { eb.className = 'mud-btn' + (l.endc === '1' ? ' on' : ''); eb.textContent = l.endc === '1' ? 'EN-DC ✓' : 'EN-DC'; }

		[ 'nr', 'lte' ].forEach(function(rat) {
			var locked = (l[rat] && l[rat].locked) || '';
			var arr = locked ? locked.split(',').map(Number) : [];
			var isAuto = arr.length === 0 || arr.length >= self.lockCand[rat].length;
			setR('lock-' + rat + 'line', isAuto
				? '自动（支持 ' + self.lockCand[rat].length + ' 个）'
				: '已锁 ' + arr.length + ' 个：' + (rat === 'nr' ? 'n' : 'B') + arr.join(' ' + (rat === 'nr' ? 'n' : 'B')));
			var box = self.Q('lock-' + rat);
			if (box) Array.prototype.forEach.call(box.children, function(ch) {
				var b = ch.getAttribute('data-b');
				var on = !isAuto && arr.indexOf(Number(b)) >= 0;
				self.lockSel[rat][b] = on;
				ch.className = on ? 'mud-chip on' : 'mud-chip';
			});
		});
		setR('lock-cellline', l.cell || '未锁定');
	}
});
