'use strict';
'require view';
'require mu300.common as M';

/* 网络锁定 -- 模式 / 频段 / 小区 / EN-DC，全部经 ubus mu300dash lock_set -> 后端
 * mu300-dash-lock（编码按 ufi_tools 权威实现），应用后 SFUN 重启协议栈并落盘，
 * 开机由 init.d/mu300-dash 回放。
 *
 * 当前驻网与邻区来自 status 的蜂窝缓存：打开页面时若缓存已陈旧，短轮询几次等
 * 新鲜数据落地（status 本身会踢后台采集），通常一秒内到位；之后停止轮询。
 * 邻区表每行带「锁定」按钮，与主页共用 M.neighborRows。 */

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
<div class="mud-card mud-hero" style="flex-wrap:wrap;display:flex;gap:14px;align-items:center">
  <div style="flex:1 1 260px;min-width:0">
    <div style="font-size:.78rem;color:var(--text-muted,var(--text-light,#777))">当前驻网</div>
    <div style="font-size:1.25rem;font-weight:700;margin-top:2px" id="mud-srv-rat">--</div>
    <div class="mud-cellline" id="mud-srv"></div>
  </div>
  <div style="flex:0 0 auto;text-align:right">
    <div class="mud-rsrp" id="mud-srv-rsrp" style="font-size:1.9rem">--</div>
    <div class="mud-chips" id="mud-srv-chips"></div>
  </div>
</div>

<div class="mud-sec">
  <h3>网络模式 · EN-DC</h3>
  <div class="mud-ctl" id="mud-lock-modes" style="grid-template-columns:repeat(4,1fr);max-width:520px"></div>
  <div class="mud-ctl" style="margin-top:7px;grid-template-columns:1fr 1fr;max-width:340px">
    <button class="mud-btn" id="mud-lock-endc">EN-DC</button>
    <button class="mud-btn" id="mud-lock-refresh">刷新锁定状态</button>
  </div>
</div>

<div class="mud-sec">
  <h3>频段锁定</h3>
  <div class="mud-cols">
    <div>
      <div class="mud-rows">
        <div class="mud-r"><span class="mud-k">NR 频段</span><span class="mud-v" id="mud-lock-nrline">--</span></div>
      </div>
      <div class="mud-chiprow" id="mud-lock-nr"></div>
    </div>
    <div>
      <div class="mud-rows">
        <div class="mud-r"><span class="mud-k">LTE 频段</span><span class="mud-v" id="mud-lock-lteline">--</span></div>
      </div>
      <div class="mud-chiprow" id="mud-lock-lte"></div>
    </div>
  </div>
  <div class="mud-ctl" style="margin-top:8px;max-width:360px">
    <button class="mud-btn" id="mud-lock-nr-apply">应用 NR 频段</button>
    <button class="mud-btn" id="mud-lock-lte-apply">应用 LTE 频段</button>
  </div>
</div>

<div class="mud-sec">
  <h3>邻区与小区锁定 <span id="mud-lock-note" style="font-weight:400"></span></h3>
  <div class="mud-ctl" style="max-width:400px;margin-bottom:8px">
    <button class="mud-btn" id="mud-lock-cell">锁定当前服务小区</button>
    <button class="mud-btn warn" id="mud-lock-cell-off">解除小区锁定</button>
  </div>
  <div class="mud-scroll">
  <table class="mud-table"><thead><tr><th>制式/频段</th><th>PCI</th><th>频点</th><th>RSRP</th><th>RSRQ</th><th>SINR</th><th></th></tr></thead>
  <tbody id="mud-neigh"><tr><td colspan="7" style="color:var(--text-muted,var(--text-light,#777))">--</td></tr></tbody></table>
  </div>
  <div class="mud-note">应用后协议栈重启（SFUN），蜂窝会断开约半分钟；设置自动保存并在开机时回放。频段全不选再点应用 = 恢复自动。</div>
</div>`;
		this.wire(root);
		return root;
	},

	wire: function(root) {
		var self = this;
		this.lockSel = { nr: {}, lte: {} };
		this.lockCand = { nr: NR_CAND, lte: LTE_CAND };
		this.Q = function(id) { return root.querySelector('#mud-' + id); };

		var apply = function(kind, val, what) {
			if (!window.confirm('应用「' + what + '」？\n协议栈会重启（SFUN），蜂窝断开约半分钟。')) return;
			self.note('正在后台应用 ' + what + ' …（SFUN 重启 + 重新驻网，约半分钟）');
			L.resolveDefault(M.callLockSet(kind, val)).then(function(r) {
				r = r || {};
				self.note(r.ok ? '已后台执行：' + (r.op || kind) + '。约半分钟后点「刷新锁定状态」确认。' : ('失败：' + (r.error || '未知错误')));
				setTimeout(function() { self.refresh(); }, 35000);
			}, function() { self.note('调用失败'); });
		};

		this.Q('lock-modes').innerHTML = MODES.map(function(m) {
			return '<button class="mud-btn" data-mode="' + m[0] + '">' + m[1] + '</button>';
		}).join('');
		root.querySelectorAll('#mud-lock-modes .mud-btn').forEach(function(b) {
			b.onclick = function() {
				var m = b.getAttribute('data-mode');
				if (m === (self.lastLock && self.lastLock.mode && self.lastLock.mode.label)) return;
				apply('mode', m, '网络模式：' + b.textContent);
			};
		});
		this.Q('lock-endc').onclick = function() {
			var on = self.lastLock && self.lastLock.endc === '1';
			apply('endc', on ? 'off' : 'on', on ? '关闭 EN-DC（NSA 锚点）' : '开启 EN-DC（NSA 锚点）');
		};
		this.Q('lock-refresh').onclick = function() {
			self.note('正在直读调制解调器（最多几秒）…');
			L.resolveDefault(M.callLockFresh('1')).then(function(l) {
				self.lastLock = l || {};
				self.paint();
				self.note('已刷新');
				var nb = self.Q('neigh');
				if (nb && self.lastCell) nb.innerHTML = M.neighborRows(self.lastCell, self.lastLock.cell || '');
			});
			self.loadServing();
		};

		this.chipRow = function(el, rat, cand) {
			el.innerHTML = cand.map(function(b) {
				return '<span class="mud-chip" data-rat="' + rat + '" data-b="' + b + '">' + (rat === 'nr' ? 'n' : 'B') + b + '</span>';
			}).join('');
			/* chips 重建后恢复选中态 */
			Array.prototype.forEach.call(el.children, function(ch) {
				var b = ch.getAttribute('data-b');
				if (self.lockSel[rat][b]) ch.className = 'mud-chip on';
			});
		};
		this.chipRow(this.Q('lock-nr'), 'nr', NR_CAND);
		this.chipRow(this.Q('lock-lte'), 'lte', LTE_CAND);
		/* 事件委托绑在容器上：paint() 依模组能力重建 chips 后点击依然有效 */
		[ 'nr', 'lte' ].forEach(function(rat) {
			self.Q('lock-' + rat).addEventListener('click', function(ev) {
				var ch = ev.target;
				if (!ch.getAttribute || !ch.getAttribute('data-b')) return;
				var b = ch.getAttribute('data-b');
				self.lockSel[rat][b] = !self.lockSel[rat][b];
				ch.className = self.lockSel[rat][b] ? 'mud-chip on' : 'mud-chip';
			});
		});
		var selBands = function(rat) {
			return Object.keys(self.lockSel[rat]).filter(function(b) { return self.lockSel[rat][b]; })
				.map(Number).sort(function(a, b) { return a - b; });
		};
		this.Q('lock-nr-apply').onclick = function() {
			var sel = selBands('nr');
			if (!sel.length) return apply('nr', '', 'NR 频段：恢复自动');
			apply('nr', sel.join(','), 'NR 频段锁定：n' + sel.join(' n'));
		};
		this.Q('lock-lte-apply').onclick = function() {
			var sel = selBands('lte');
			if (!sel.length) return apply('lte', '', 'LTE 频段：恢复自动');
			apply('lte', sel.join(','), 'LTE 频段锁定：B' + sel.join(' B'));
		};
		this.Q('lock-cell').onclick = function() { apply('cell', 'auto', '锁定当前服务小区'); };
		this.Q('lock-cell-off').onclick = function() { apply('cell', 'off', '解除小区锁定'); };

		/* 邻区行内锁定（事件委托，与主页一致） */
		this.Q('neigh').addEventListener('click', function(ev) {
			var btn = ev.target;
			if (!btn.getAttribute || !btn.getAttribute('data-lock')) return;
			var key = btn.getAttribute('data-lock');
			if (!window.confirm('锁定小区 ' + key.replace(':', ' ') + '？\n协议栈会重启（SFUN），蜂窝断开约半分钟。')) return;
			self.note('正在后台锁定 ' + key + ' …');
			L.resolveDefault(M.callLockSet('cell', key)).then(function(r) {
				r = r || {};
				self.note(r.ok ? '已后台锁定 ' + key + '，约半分钟后刷新确认。' : '锁定失败：' + (r.error || '未知错误'));
				setTimeout(function() { self.refresh(); }, 35000);
			});
		});

		this.refresh();
		this.loadServing(false);
	},

	note: function(txt) { var e = this.Q('lock-note'); if (e) e.textContent = '（' + txt + '）'; },

	/* 当前驻网 + 邻区：先用现有缓存立即渲染（宁可先给几秒前的参照），陈旧时 2.6 s
	 * 后补刷一次（status 自己会踢采集）。不做长等待循环。 */
	loadServing: function() {
		var self = this;
		L.resolveDefault(M.callStatus()).then(function(st) {
			st = st || {};
			self.paintServing(st.cell);
			if (st.cell_age == null || st.cell_age > 6)
				setTimeout(function() {
					L.resolveDefault(M.callStatus()).then(function(st2) {
						self.paintServing((st2 || {}).cell);
					});
				}, 2600);
		});
	},

	paintServing: function(c) {
		var e = this.Q('srv'); if (!e) return;
		this.lastCell = c;
		if (!c || c.error) {
			this.Q('srv-rat').textContent = c && c.error ? c.error : '暂无驻网数据';
			e.innerHTML = '';
			return;
		}
		var ratTxt = (c.nr && c.nr.band) ? ((c.lte && c.lte.band) ? '5G NSA' : '5G SA') : 'LTE';
		var sig = c.sig || {}, label = M.qLabel(sig.rsrp, sig.rsrq, sig.sinr);
		this.Q('srv-rat').textContent = ratTxt + ' · ' + M.carrierName(c.operator);
		this.Q('srv-rat').style.color = M.qCol(label);
		var rsrpEl = this.Q('srv-rsrp');
		if (sig.rsrp != null) { rsrpEl.innerHTML = sig.rsrp.toFixed(1) + '<small> dBm</small>'; rsrpEl.style.color = M.qCol(label); }
		this.Q('srv-chips').innerHTML =
			(sig.rsrq != null ? '<span class="mud-tag">RSRQ ' + sig.rsrq.toFixed(1) + '</span>' : '') +
			(sig.sinr != null ? '<span class="mud-tag">SINR ' + sig.sinr.toFixed(1) + '</span>' : '');
		var rows = [];
		if (c.nr && c.nr.band) rows.push([ 'NR 服务小区', 'n' + c.nr.band + ' · PCI ' + c.nr.pci + ' · ARFCN ' + c.nr.arfcn + (c.nr.bw_mhz ? ' · ' + c.nr.bw_mhz + ' MHz' : '') ]);
		if (c.lte && c.lte.band) rows.push([ 'LTE 锚点', 'B' + c.lte.band + ' · PCI ' + c.lte.pci + ' · EARFCN ' + c.lte.earfcn ]);
		e.innerHTML = rows.map(function(x) {
			return '<div class="mud-srvline"><span class="k">' + x[0] + '</span><span class="v">' + M.esc(x[1]) + '</span></div>';
		}).join('');
		var nb = this.Q('neigh');
		if (nb) nb.innerHTML = M.neighborRows(c, (this.lastLock || {}).cell || '');
	},

	refresh: function() {
		var self = this;
		L.resolveDefault(M.callLockGet()).then(function(l) {
			l = l || {};
			/* 空结果多半是 rpcd 高并发下的一次瞬时失败（实测同请求重发即好）：轻量重试 */
			if (!l.mode && !l.error && (self._retry = (self._retry || 0) + 1) <= 3)
				return setTimeout(function() { self.refresh(); }, 1800);
			self._retry = 0;
			self.lastLock = l;
			self.paint();
			/* 锁定状态回来了，把邻区表的“已锁定”标记也刷新一下 */
			var nb = self.Q('neigh');
			if (nb && self.lastCell) nb.innerHTML = M.neighborRows(self.lastCell, self.lastLock.cell || '');
		});
	},

	paint: function() {
		var l = this.lastLock || {};
		var self = this;
		var setR = function(id, txt) { var e = self.Q(id); if (e) e.textContent = (txt == null || txt === '') ? '--' : txt; };
		if (l.error) { setR('lock-nrline', l.error); setR('lock-lteline', ''); return; }
		var MODE_TXT = { auto: '自动（5G/4G）', '4g': '仅 4G', sa: '仅 5G SA', nsa: '仅 5G NSA' };
		var cur = this.Q('lock-modes');
		if (cur) Array.prototype.forEach.call(cur.querySelectorAll('.mud-btn'), function(b) {
			b.className = (b.getAttribute('data-mode') === (l.mode && l.mode.label)) ? 'mud-btn on' : 'mud-btn';
		});
		var eb = this.Q('lock-endc');
		if (eb) { eb.className = 'mud-btn' + (l.endc === '1' ? ' on' : ''); eb.textContent = l.endc === '1' ? 'EN-DC ✓' : 'EN-DC'; }

		/* 支持频段优先取模组能力（SPLBAND=4 / =0 解码），读不到才用静态表 */
		var caps = l.caps || {};
		[ 'nr', 'lte' ].forEach(function(rat) {
			var capList = (caps[rat] || '').split(',').map(Number).filter(function(b) { return b > 0; });
			if (capList.length) {
				capList.sort(function(a, b) { return a - b; });
				self.lockCand[rat] = capList;
				var box = self.Q('lock-' + rat);
				if (box) self.chipRow(box, rat, capList);
			}
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
	}
});
