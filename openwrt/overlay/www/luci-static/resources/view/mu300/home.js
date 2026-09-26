'use strict';
'require view';
'require poll';
'require mu300.common as M';

/* MU300 状态看板 -- LuCI 落地页（menu.d 挂在 admin/home）。
 *
 * 这一页只做数据展示（控制卡片收在最后）：蜂窝状态、链路质量、流量、邻区、
 * 无线客户端、设备与 SIM。锁频/小区锁定在「蜂窝 -> 网络锁定」，AT 终端在
 * 「蜂窝 -> AT 终端」，短信在「蜂窝 -> 短信」。
 *
 * 数据只有一个来源：ubus mu300dash status（快照 + 蜂窝缓存，页面永不发 AT）。
 * CPU 占用与上下行速率用相邻两次快照差分。loadavg 不显示（厂商线程常驻 D 态）。 */

var POLL_S = 1.5;   /* 快档：信号/速率/CPU 每轮都刷；邻区等慢数据只在 cell.ts 变化时重绘 */
var RATE_WIN = 40;

return view.extend({
	load: function() { return Promise.resolve(); },

	render: function() {
		M.injectCss();
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = this.html();
		this.wire(root);
		var self = this;
		poll.add(function() {
			return L.resolveDefault(M.callStatus()).then(function(st) { self.update(st || {}); });
		}, POLL_S);
		return root;
	},

	html: function() {
		return `
<div class="mud-grid">
  <div class="mud-card mud-hero">
    <div class="mud-hero-l">
      <div style="font-size:.78rem;color:var(--text-muted,var(--text-light,#777))">
        <span class="mud-dot" id="mud-dot"></span><b id="mud-host" style="color:var(--text,#222)">--</b>
        <span id="mud-uptime"></span></div>
      <div class="mud-rat" id="mud-rat">--<span class="mud-bars" id="mud-bars"><i style="height:25%"></i><i style="height:45%"></i><i style="height:65%"></i><i style="height:85%"></i><i style="height:100%"></i></span></div>
      <div class="mud-op" id="mud-op">--</div>
      <div class="mud-cellline" id="mud-cellline"></div>
    </div>
    <div class="mud-hero-r">
      <div class="mud-rsrp" id="mud-rsrp">--</div>
      <div class="mud-chips" id="mud-metric-chips"></div>
    </div>
  </div>

  <div class="mud-card">
    <h3>链路质量</h3>
    <div class="mud-kpis">
      <div class="mud-kpi"><b id="mud-mcs">--</b><span>MCS 下/上</span></div>
      <div class="mud-kpi"><b id="mud-bler">--</b><span>BLER 下/上</span></div>
      <div class="mud-kpi"><b id="mud-bw">--</b><span>频宽</span></div>
      <div class="mud-kpi"><b id="mud-qci">--</b><span>QCI</span></div>
      <div class="mud-kpi"><b id="mud-ambr">--</b><span>AMBR 下/上</span></div>
    </div>
    <div class="mud-rows" id="mud-lteanchor"></div>
  </div>

  <div class="mud-card">
    <h3>网络与流量</h3>
    <div class="mud-kpis">
      <div class="mud-kpi"><b id="mud-dl" style="color:var(--brand,var(--primary,#2f7bf6))">--</b><span>下行速率</span><div style="color:var(--brand,var(--primary,#2f7bf6))" id="mud-spark-dl"></div></div>
      <div class="mud-kpi"><b id="mud-ul" style="color:var(--success,#2FBF71)">--</b><span>上行速率</span><div style="color:var(--success,#2FBF71)" id="mud-spark-ul"></div></div>
      <div class="mud-kpi"><b id="mud-rx">--</b><span>累计接收</span></div>
      <div class="mud-kpi"><b id="mud-tx">--</b><span>累计发送</span></div>
    </div>
    <div class="mud-rows">
      <div class="mud-r"><span class="mud-k">IPv4 / IPv6</span><span class="mud-v" id="mud-ip">--</span></div>
      <div class="mud-r"><span class="mud-k">DNS</span><span class="mud-v" id="mud-dns">--</span></div>
      <div class="mud-r"><span class="mud-k">APN · 会话</span><span class="mud-v" id="mud-apn">--</span></div>
      <div class="mud-r"><span class="mud-k">注册状态</span><span class="mud-v" id="mud-reg">--</span></div>
    </div>
  </div>

  <div class="mud-card">
    <h3>邻区</h3>
    <div class="mud-scroll">
    <table class="mud-table"><thead><tr><th>制式/频段</th><th>PCI</th><th>频点</th><th>RSRP</th><th>RSRQ</th><th>SINR</th></tr></thead>
    <tbody id="mud-neigh"><tr><td colspan="6" style="color:var(--text-muted,var(--text-light,#777))">--</td></tr></tbody></table>
    </div>
  </div>

  <div class="mud-card">
    <h3>Wi-Fi 与客户端</h3>
    <div class="mud-rows">
      <div class="mud-r"><span class="mud-k">SSID · 信道</span><span class="mud-v" id="mud-ssid">--</span></div>
      <div class="mud-r"><span class="mud-k">客户端 · 租约 · 连接跟踪</span><span class="mud-v" id="mud-lan">--</span></div>
    </div>
    <div id="mud-clist" style="margin-top:6px"></div>
  </div>

  <div class="mud-card">
    <h3>设备与 SIM</h3>
    <div class="mud-temp" id="mud-temps"></div>
    <div class="mud-kpis" style="margin-top:8px">
      <div class="mud-kpi"><b id="mud-cpu">--</b><span>CPU</span><div class="mud-meter"><i id="mud-cpu-bar" style="background:var(--brand,var(--primary,#3b82f6))"></i></div></div>
      <div class="mud-kpi"><b id="mud-ram">--</b><span>内存</span><div class="mud-meter"><i id="mud-ram-bar" style="background:var(--info,#0ea5e9)"></i></div></div>
      <div class="mud-kpi"><b id="mud-disk">--</b><span>存储</span><div class="mud-meter"><i id="mud-disk-bar" style="background:var(--warning,#f59e0b)"></i></div></div>
      <div class="mud-kpi"><b id="mud-batt">--</b><span id="mud-batt-l">电源</span></div>
    </div>
    <div class="mud-rows">
      <div class="mud-r"><span class="mud-k">CPU 频率</span><span class="mud-v" id="mud-freq">--</span></div>
      <div class="mud-r"><span class="mud-k">型号 · 系统</span><span class="mud-v" id="mud-model">--</span></div>
      <div class="mud-r"><span class="mud-k">调制解调器</span><span class="mud-v" id="mud-modem">--</span></div>
      <div class="mud-r"><span class="mud-k">运营商</span><span class="mud-v" id="mud-carr">--</span></div>
      <div class="mud-r"><span class="mud-k">IMEI</span><span class="mud-v" id="mud-imei">--</span></div>
      <div class="mud-r"><span class="mud-k">IMSI</span><span class="mud-v" id="mud-imsi">--</span></div>
      <div class="mud-r"><span class="mud-k">ICCID</span><span class="mud-v" id="mud-iccid">--</span></div>
      <div class="mud-r"><span class="mud-k">模组 · 固件</span><span class="mud-v" id="mud-fw">--</span></div>
    </div>
    <div class="mud-chiprow"><span class="mud-chip" id="mud-reveal">显示卡号信息</span></div>
  </div>

  <div class="mud-card" style="grid-column:1/-1">
    <h3>快捷控制</h3>
    <div class="mud-ctl" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <button class="mud-btn" id="mud-btn-data">数据连接</button>
      <button class="mud-btn" id="mud-btn-radio">无线电</button>
      <button class="mud-btn" id="mud-btn-wifi">Wi-Fi 热点</button>
      <button class="mud-btn" id="mud-btn-vpn">VPN</button>
      <button class="mud-btn warn" id="mud-btn-modem">重启调制解调器</button>
      <button class="mud-btn warn" id="mud-btn-reboot">重启设备</button>
    </div>
    <div class="mud-note" id="mud-actnote"></div>
  </div>
</div>`;
	},

	wire: function(root) {
		var self = this;
		this.identShown = false;
		this.dlHist = []; this.ulHist = [];
		this.lastNet = null; this.lastCpu = null; this.lastFullTs = 0;
		/* render() 在节点挂进文档之前运行，这里相对 root 查找（挂载后 update 用全文档查找） */
		var q = function(id) { return root.querySelector('#mud-' + id); };

		var act = function(op, arg, note) {
			M.v('actnote').textContent = note || ('正在执行 ' + op + ' …');
			return L.resolveDefault(M.callAct(op, arg)).then(function(r) {
				r = r || {};
				M.v('actnote').textContent = r.ok ? ((r.started ? '已后台执行：' : '已执行：') + (r.op || op)) : ('失败：' + (r.error || '未知错误'));
			}, function() { M.v('actnote').textContent = '调用失败'; });
		};
		q('btn-data').onclick = function() {
			var up = self.lastInfo && self.lastInfo.wan && self.lastInfo.wan.up;
			act('data', up ? 'down' : 'up', up ? '正在断开数据连接…' : '正在拨号…');
		};
		q('btn-radio').onclick = function() {
			var on = self.lastCell && self.lastCell.cfun === 1;
			if (on && !window.confirm('关闭无线电？蜂窝连接会中断。')) return;
			if (!on && !window.confirm('打开无线电？将执行 SFUN 上电序列（最多约 1 分钟）。')) return;
			act('radio', on ? 'off' : 'on');
		};
		q('btn-wifi').onclick = function() {
			var on = self.lastInfo && self.lastInfo.wifi && self.lastInfo.wifi.up;
			act('wifi', on ? 'off' : 'on');
		};
		q('btn-vpn').onclick = function() {
			var up = self.lastInfo && self.lastInfo.vpn && self.lastInfo.vpn.up;
			act('vpn', up ? 'stop' : 'start');
		};
		q('btn-modem').onclick = function() {
			if (!window.confirm('重启调制解调器？蜂窝连接会中断 1-2 分钟。')) return;
			act('modem-reset');
		};
		q('btn-reboot').onclick = function() {
			if (!window.confirm('重启整个设备？所有连接会断开。')) return;
			act('reboot');
		};
		q('reveal').onclick = function() {
			self.identShown = !self.identShown;
			M.v('reveal').textContent = self.identShown ? '隐藏卡号信息' : '显示卡号信息';
			self.paintIdent(self.lastCell);
		};
	},

	paintIdent: function(cell) {
		var id = cell && cell.ident;
		var mask = function(s) {
			if (!s) return '--';
			return this.identShown ? s : s.substring(0, 4) + '****' + s.substring(s.length - 3);
		}.bind(this);
		M.set('imei', mask(id && id.imei));
		M.set('imsi', mask(id && id.imsi));
		M.set('iccid', mask(id && id.iccid));
		M.set('fw', id ? ((id.model || '--') + ' · ' + (id.fw || '--')) : '--');
	},

	update: function(st) {
		var i = st.info || {};
		this.lastInfo = i;
		/* 快档覆盖：sig（服务小区/注册，1.5 s 级）盖在慢档缓存 c 的对应字段上 */
		var c = st.cell || null;
		var s = st.sig || null;
		if (s && !s.error && (!c || !c.ts || (s.ts || 0) >= c.ts)) {
			c = c ? Object.assign({}, c, {
				ts: s.ts, cfun: s.cfun, reg: s.reg, reg5g: s.reg5g,
				sig_src: s.sig_src, sig: s.sig, lte: s.lte, nr: s.nr
			}) : s;
		}
		this.lastCell = c;
		/* 慢档数据（邻区/运营商/身份）只在整份缓存的时间戳变化时重绘 */
		var fullTs = (st.cell && st.cell.ts) || 0;
		var slowChanged = fullTs !== this.lastFullTs;
		this.lastFullTs = fullTs;

		M.set('host', i.host);
		M.set('uptime', i.uptime ? '已运行 ' + M.fmtUptime(i.uptime) : '');
		M.v('dot').className = 'mud-dot' + (i.modem && i.modem.alive ? ' on' : '');

		var sig = c && !c.error ? (c.sig || {}) : {};
		var rsrp = sig.rsrp, rsrq = sig.rsrq, sinr = sig.sinr;
		var label = M.qLabel(rsrp, rsrq, sinr), score = M.qScore({ rsrp: rsrp, rsrq: rsrq, sinr: sinr });
		var col = M.qCol(label);

		var rat = '--';
		if (c && !c.error) {
			var nr = c.nr && c.nr.band ? true : false;
			var lte = c.lte && c.lte.band ? true : false;
			if (nr && lte) rat = '5G NSA';
			else if (nr) rat = '5G SA';
			else if (lte) {
				var act = (c.operator && c.operator.act) || (c.reg && c.reg.act);
				rat = (act == 13) ? '5G NSA' : (act == 11 || act == 18 || act == 19) ? '5G' : (act == 7 || act == 10) ? '4G' : (act >= 2 && act <= 6) ? '3G' : '4G';
			} else if (c.cfun === 0) rat = '无线电已关';
		}
		if (c && c.error) { rat = '无应答'; col = M.qCol('较差'); }
		var ratEl = M.v('rat');
		ratEl.firstChild.nodeValue = rat;
		ratEl.style.color = col;
		var bars = M.v('bars');
		if (bars) {
			var n = score == null ? 0 : Math.max(1, Math.round(score / 2));
			Array.prototype.forEach.call(bars.children, function(b, idx) { b.className = idx < n ? 'on' : ''; });
		}

		var oper = M.carrierName(c && c.operator);
		M.set('op', oper + (score != null ? ' · 信号 ' + label + ' ' + score.toFixed(1) + ' 分' : ' · 信号 ' + label));

		var cl = [];
		if (c && c.nr && c.nr.band) cl.push('n' + c.nr.band + (c.nr.bw_mhz ? ' · ' + c.nr.bw_mhz + ' MHz' : '') + ' · PCI ' + c.nr.pci + ' · ARFCN ' + c.nr.arfcn);
		if (c && c.lte && c.lte.band) cl.push('锚点 B' + c.lte.band + ' · PCI ' + c.lte.pci + ' · EARFCN ' + c.lte.earfcn +
			(c.lte.sinr != null ? ' · SINR ' + c.lte.sinr.toFixed(1) + ' dB' : ''));
		M.v('cellline').innerHTML = cl.map(M.esc).join('<br>') || '<span style="color:var(--text-muted,var(--text-light,#777))">未驻留小区</span>';

		M.set('rsrp', '--');
		if (rsrp != null) M.v('rsrp').innerHTML = rsrp.toFixed(1) + '<small> dBm</small>';
		M.v('rsrp').style.color = col;
		M.v('metric-chips').innerHTML =
			'<span class="mud-q" style="background:color-mix(in oklab,' + col + ' 16%,transparent);color:' + col + '">' + label + '</span>' +
			(rsrq != null ? '<span class="mud-tag">RSRQ ' + rsrq.toFixed(1) + '</span>' : '') +
			(sinr != null ? '<span class="mud-tag">SINR ' + sinr.toFixed(1) + '</span>' : '') +
			(c && c.lte && !c.nr && c.lte.sinr != null ? '<span class="mud-tag">LTE SINR ' + c.lte.sinr.toFixed(1) + '</span>' : '') +
			(st.refreshing ? '<span class="mud-tag" style="opacity:.6">采集中…</span>' : '');

		var nr = (c && c.nr) || null;
		M.set('mcs', nr && nr.dl_mcs != null ? nr.dl_mcs + ' / ' + (nr.ul_mcs != null ? nr.ul_mcs : '--') : '--');
		M.set('bler', nr && nr.dl_bler != null ? nr.dl_bler + '% / ' + (nr.ul_bler != null ? nr.ul_bler : '--') + '%' : '--');
		M.set('bw', nr && nr.bw_mhz ? nr.bw_mhz + ' MHz' : (c && c.lte && c.lte.bw) || '--');
		var qos = c && c.qos;
		M.set('qci', qos && qos.qci != null ? qos.qci : '--');
		M.set('ambr', qos && qos.dl != null ? qos.dl + ' / ' + qos.ul + ' Mbps' : '--');
		var anchor = (c && c.lte && c.lte.band) ? c.lte : null;
		M.v('lteanchor').innerHTML = (anchor && c.nr && c.nr.band) ?
			'<div class="mud-r"><span class="mud-k">LTE 锚点</span><span class="mud-v">B' + M.esc(anchor.band) +
			' · RSRP ' + (anchor.rsrp != null ? anchor.rsrp.toFixed(1) : '--') +
			(anchor.sinr != null ? ' · SINR ' + anchor.sinr.toFixed(1) : '') +
			(anchor.dl_mcs != null ? ' · MCS ' + anchor.dl_mcs : '') +
			(anchor.ca ? ' · ' + anchor.ca : '') + '</span></div>' :
			(anchor ? '<div class="mud-r"><span class="mud-k">LTE 链路</span><span class="mud-v">MCS ' +
			(anchor.dl_mcs != null ? anchor.dl_mcs : '--') + ' / ' + (anchor.ul_mcs != null ? anchor.ul_mcs : '--') +
			' · BLER ' + (anchor.dl_bler != null ? anchor.dl_bler : '--') + '%</span></div>' : '');

		var net = (i.net && i.net.sipa_eth0) || null;
		if (net && this.lastNet && i.ts && this.lastNet.ts) {
			var dt = i.ts - this.lastNet.ts;
			if (dt > 0) {
				var dl = (net.rx - this.lastNet.rx) / dt, ul = (net.tx - this.lastNet.tx) / dt;
				M.set('dl', M.fmtRate(dl)); M.set('ul', M.fmtRate(ul));
				this.dlHist.push(dl); this.ulHist.push(ul);
				if (this.dlHist.length > RATE_WIN) { this.dlHist.shift(); this.ulHist.shift(); }
				var peak = Math.max(1, Math.max.apply(null, this.dlHist.concat(this.ulHist)));
				M.spark(M.v('spark-dl'), this.dlHist, 0, peak, RATE_WIN);
				M.spark(M.v('spark-ul'), this.ulHist, 0, peak, RATE_WIN);
			}
		}
		if (net) {
			M.set('rx', M.fmtBytes(net.rx)); M.set('tx', M.fmtBytes(net.tx));
			this.lastNet = { ts: i.ts, rx: net.rx, tx: net.tx };
		}
		var w = i.wan || {};
		M.v('ip').innerHTML = M.esc(w.ip4 || '--') + (w.ip6 ? '<br>' + M.esc(w.ip6) : '');
		M.set('dns', w.dns || '--');
		M.set('apn', (w.apn || '--') + (w.uptime ? ' · ' + M.fmtUptime(w.uptime) : ''));
		var regmap = { 0: '未注册', 1: '已注册', 2: '搜索中', 3: '注册被拒', 4: '未知', 5: '已注册（漫游）', 7: '仅紧急', 8: '仅紧急', 10: '已注册' };
		var reg = '--';
		if (c && c.reg) {
			reg = regmap[c.reg.stat] || ('状态 ' + c.reg.stat);
			if (c.reg.tac) reg += ' · TAC ' + c.reg.tac;
			if (c.reg5g && c.reg5g.stat == 1) reg += ' · 5G ' + regmap[c.reg5g.stat];
		} else if (c && c.error) reg = c.error;
		M.set('reg', reg);

		if (slowChanged) {
			var nb = (c && c.neigh) || [];
			nb.sort(function(a, b) {
				if ((a.rat == 'nr') != (b.rat == 'nr')) return a.rat == 'nr' ? -1 : 1;
				return (b.rsrp || -999) - (a.rsrp || -999);
			});
			M.v('neigh').innerHTML = nb.length ? nb.map(function(n) {
				var l = M.qLabel(n.rsrp, n.rsrq, n.sinr);
				return '<tr><td>' + (n.rat == 'nr' ? 'NR n' + M.esc(n.band) : 'LTE B' + M.esc(n.band)) + '</td>' +
					'<td>' + M.esc(n.pci != null ? n.pci : '--') + '</td>' +
					'<td>' + M.esc(n.arfcn != null ? n.arfcn : '--') + '</td>' +
					'<td style="color:' + M.qCol(l) + '">' + (n.rsrp != null ? n.rsrp.toFixed(1) : '--') + '</td>' +
					'<td>' + (n.rsrq != null ? n.rsrq.toFixed(1) : '--') + '</td>' +
					'<td>' + (n.sinr != null ? n.sinr.toFixed(1) : '--') + '</td></tr>';
			}).join('') : '<tr><td colspan="6" style="color:var(--text-muted,var(--text-light,#777))">暂无邻区数据</td></tr>';
			M.set('carr', oper + (c && c.operator && c.operator.plmn ? ' · ' + c.operator.plmn : ''));
			this.paintIdent(c);
		}

		var wf = i.wifi || {};
		M.set('ssid', (wf.ssid || '--') + (wf.channel ? ' · Ch ' + wf.channel : '') +
			(wf.band ? '（' + wf.band + (wf.width ? ' · ' + wf.width : '') + '）' : ''));
		M.set('lan', (wf.clients_n != null ? wf.clients_n + ' 台' : '--') +
			' · ' + (i.lan ? i.lan.leases : '--') + ' 租约 · ' + (i.conns != null ? i.conns : '--') + ' 跟踪');
		M.v('clist').innerHTML = (wf.clients || []).map(function(cl) {
			var l = cl.signal != null ? (cl.signal >= -55 ? '优秀' : cl.signal >= -67 ? '良好' : cl.signal >= -80 ? '一般' : '较差') : '未知';
			return '<div class="mud-cli"><div class="t"><b>' + M.esc(cl.host || cl.ip || cl.mac) + '</b>' +
				(cl.signal != null ? '<span style="color:' + M.qCol(l) + ';font-variant-numeric:tabular-nums">' + cl.signal + ' dBm</span>' : '') +
				'</div><div class="s">' + (cl.ip ? M.esc(cl.ip) + ' · ' : '') + M.esc(cl.mac) +
				((cl.tx || cl.rx) ? ' · ↑' + M.esc(cl.tx || '--') + ' ↓' + M.esc(cl.rx || '--') : '') +
				(cl.conn ? ' · ' + M.esc(cl.conn) : '') + '</div></div>';
		}).join('') || '';

		var t = i.temps || {};
		M.v('temps').innerHTML = [ [ 'SoC', t.soc ], [ 'CPU', t.cpu ], [ '调制解调器', t.modem ], [ '主板', t.board ] ]
			.filter(function(x) { return x[1] != null; })
			.map(function(x) {
				var lab = x[1] >= 75 ? '较差' : x[1] >= 60 ? '一般' : '良好';
				return '<span style="color:' + M.qCol(lab) + '">' + x[0] + ' ' + x[1] + '°C</span>';
			}).join('') || '<span style="color:var(--text-muted,var(--text-light,#777))">无温度读数</span>';

		if (i.cpu && this.lastCpu && i.cpu.total != null && this.lastCpu.total != null) {
			var dt2 = i.cpu.total - this.lastCpu.total, di = i.cpu.idle - this.lastCpu.idle;
			var pct = dt2 > 0 ? Math.round((dt2 - di) * 100 / dt2) : null;
			M.set('cpu', pct != null ? pct + '%' : '--');
			M.v('cpu-bar').style.width = (pct || 0) + '%';
		}
		this.lastCpu = i.cpu || null;
		var fs = ((i.cpu && i.cpu.freqs) || []).map(function(f) {
			return (f.cur != null && f.max != null) ? (f.cur / 1000).toFixed(0) + ' / ' + (f.max / 1000).toFixed(0) : null;
		}).filter(Boolean).join(' MHz · ');
		if (fs) M.set('freq', fs + ' MHz');

		if (i.mem && i.mem.total_kb) {
			var used = i.mem.total_kb - i.mem.avail_kb, pct = Math.round(used * 100 / i.mem.total_kb);
			M.set('ram', pct + '%'); M.v('ram-bar').style.width = pct + '%';
		}
		if (i.storage && i.storage.total_kb) {
			var pct2 = Math.round(i.storage.used_kb * 100 / i.storage.total_kb);
			M.set('disk', pct2 + '%'); M.v('disk-bar').style.width = pct2 + '%';
		}
		var p = i.power || {};
		if (p.present && p.capacity != null) {
			M.set('batt', p.capacity + '%');
			M.set('batt-l', '电源 · ' + (p.status || '') + (p.volt != null ? ' · ' + p.volt + ' V' : '') + (p.usb ? ' · USB' : ''));
		} else {
			M.set('batt', p.usb ? 'USB' : '--');
			M.set('batt-l', '电源' + (p.volt != null ? ' · ' + p.volt + ' V' : ''));
		}
		M.set('model', (i.model || '--') + ' · ' + (i.fw || ''));
		M.set('modem', (i.modem && i.modem.alive ? '在线' : '无应答') + (i.modem && i.modem.atd ? '' : ' · mu300-atd 未运行'));

		var b;
		b = M.v('btn-data'); b.className = 'mud-btn' + (w.up ? ' on' : ''); b.textContent = w.up ? '数据连接 ✓' : '数据连接';
		b = M.v('btn-radio'); b.className = 'mud-btn' + (c && c.cfun === 1 ? ' on' : ''); b.textContent = c && c.cfun === 1 ? '无线电 ✓' : '无线电';
		b = M.v('btn-wifi'); b.className = 'mud-btn' + (wf.up ? ' on' : ''); b.textContent = wf.up ? 'Wi-Fi 热点 ✓' : 'Wi-Fi 热点';
		var vp = i.vpn || {};
		b = M.v('btn-vpn'); b.className = 'mud-btn' + (vp.up ? ' on' : ''); b.textContent = vp.up ? 'VPN ✓' : 'VPN';
	}
});
