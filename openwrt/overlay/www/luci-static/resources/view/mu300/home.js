'use strict';
'require view';
'require rpc';
'require poll';

/* MU300 状态看板 -- LuCI 落地页（menu.d 里挂在 admin/home，order 5，排在「状态」之前）。
 *
 * 数据只有一个来源：ubus mu300dash status（rpcd 后端 /usr/libexec/rpcd/mu300dash）。
 * 它返回系统快照（mu300-dash-info，纯 /proc /sys /uci /ubus，几十毫秒）加上蜂窝缓存
 * （mu300-dash-cell，AT 采集器写 /tmp/mu300-dash/cell.json，后台按 TTL 刷新）。
 * 页面永远不直接发 AT -- 这是 V50 面板用一次现场事故换来的铁律（饿死 AT 通道
 * => 拨号看门狗误判 => 反复重拨重启）。
 *
 * CPU 占用与上下行速率在页面里用相邻两次快照做差分，采样间隔多长都不失真。
 * 信号质量分级与 10 分制打分沿用 ufi_tools 独立模式的阈值（SignalQuality.kt）。
 * loadavg 一律不显示：本机三个厂商内核线程常驻 D 状态，把它常年钉在 3.5 左右。
 */

var callStatus = rpc.declare({
	object: 'mu300dash', method: 'status', expect: { '': {} }
});
var callAct = rpc.declare({
	object: 'mu300dash', method: 'act', params: [ 'op', 'arg' ], expect: { '': {} }
});
var callAt = rpc.declare({
	object: 'mu300dash', method: 'at', params: [ 'cmd' ], expect: { '': {} }
});
var callLockGet = rpc.declare({
	object: 'mu300dash', method: 'lock_get', expect: { '': {} }
});
var callLockSet = rpc.declare({
	object: 'mu300dash', method: 'lock_set', params: [ 'kind', 'val' ], expect: { '': {} }
});

/* 大陆运营商的 PLMN -> 名称；COPS 给的是数字时用它还原 */
var PLMN_CN = {
	'46000': '中国移动', '46002': '中国移动', '46004': '中国移动', '46007': '中国移动', '46008': '中国移动',
	'46001': '中国联通', '46006': '中国联通', '46009': '中国联通',
	'46003': '中国电信', '46005': '中国电信', '46011': '中国电信', '46012': '中国电信',
	'46015': '中国广电', '46020': '中国铁通'
};
function carrierName(op) {
	if (!op) return '--';
	return op.name || PLMN_CN[op.plmn] || op.plmn || '--';
}

var POLL_S = 3;          /* 快照轮询：只是读文件 + 一次 rpcd，很便宜 */
var RATE_WIN = 60;       /* 速率曲线保留的采样数 */

/* ---------------------------------------------------------------- 信号质量 */
var QCOL = { '优秀': '#2FBF71', '良好': '#7BC96F', '一般': '#F2B544', '较差': '#E25555', '未知': '#8A8F98' };

function qLabel(rsrp, rsrq, sinr) {
	if (rsrp == null && sinr == null && rsrq == null) return '未知';
	if (rsrp != null) {
		if (rsrp >= -90) return '优秀';
		if (rsrp >= -100) return '良好';
		if (rsrp >= -110) return '一般';
		return '较差';
	}
	if (sinr != null) {
		if (sinr >= 20) return '优秀';
		if (sinr >= 13) return '良好';
		if (sinr >= 0) return '一般';
		return '较差';
	}
	if (rsrq >= -8) return '优秀';
	if (rsrq >= -11) return '良好';
	if (rsrq >= -14) return '一般';
	return '较差';
}

/* 10 分制：RSRP 40% / RSRQ 25% / SINR 35%，锚点线性插值，缺项权重重分配 */
function interp(v, pts) {
	if (v == null) return null;
	var p = pts;
	for (var i = 0; i < p.length - 1; i++)
		if (v <= p[i][0])
			return p[i][1] + (v - p[i][0]) * (p[i+1][1] - p[i][1]) / (p[i+1][0] - p[i][0]);
	return p[p.length - 1][1];
}
function qScore(s) {
	var rsrp = [ [ -120, 0 ], [ -110, 3.5 ], [ -100, 6.5 ], [ -90, 8.5 ], [ -80, 10 ] ];
	var rsrq = [ [ -20, 0 ], [ -14, 3.5 ], [ -11, 6.5 ], [ -8, 8.5 ], [ -3, 10 ] ];
	var sinr = [ [ -5, 0 ], [ 0, 3.5 ], [ 13, 6.5 ], [ 20, 8.5 ], [ 30, 10 ] ];
	var parts = [
		[ interp(s.rsrp, rsrp), 0.40 ],
		[ interp(s.rsrq, rsrq), 0.25 ],
		[ interp(s.sinr, sinr), 0.35 ]
	];
	var sum = 0, w = 0;
	parts.forEach(function(p) { if (p[0] != null) { sum += p[0] * p[1]; w += p[1]; } });
	if (w == 0) return null;
	return Math.max(0, Math.min(10, sum / w));
}

/* ------------------------------------------------------------------ 格式化 */
function fmtBytes(b) {
	if (b == null || isNaN(b)) return '--';
	var u = [ 'B', 'KB', 'MB', 'GB', 'TB' ], i = 0;
	while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
	return (b >= 100 ? b.toFixed(0) : b.toFixed(1)) + ' ' + u[i];
}
function fmtRate(bps) {
	if (bps == null || isNaN(bps) || bps < 0) return '--';
	var u = [ 'B/s', 'KB/s', 'MB/s', 'GB/s' ], i = 0;
	while (bps >= 1024 && i < u.length - 1) { bps /= 1024; i++; }
	return (bps >= 100 ? bps.toFixed(0) : bps.toFixed(1)) + ' ' + u[i];
}
function fmtUptime(s) {
	if (s == null) return '--';
	var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
	if (d > 0) return d + ' 天 ' + h + ' 小时';
	if (h > 0) return h + ' 小时 ' + m + ' 分';
	return m + ' 分';
}
function hhmmss(ts) { var d = new Date(ts * 1000); return [ d.getHours(), d.getMinutes(), d.getSeconds() ].map(function(x) { return (x < 10 ? '0' : '') + x; }).join(':'); }
function v(id) { return document.getElementById('mud-' + id); }
function set(id, text, color) {
	var e = v(id);
	if (!e) return;
	e.textContent = (text == null || text === '') ? '--' : text;
	if (color !== undefined) e.style.color = color;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function spark(el, arr, min, max) {
	if (!el || !arr || arr.length < 2) return;
	var w = 100, h = 26, pts = [];
	for (var i = 0; i < arr.length; i++) {
		var x = i / (RATE_WIN - 1) * w;
		var y = h - Math.max(0, Math.min(1, (arr[i] - min) / (max - min || 1))) * (h - 2) - 1;
		pts.push(x.toFixed(1) + ',' + y.toFixed(1));
	}
	el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
		'<polyline points="' + pts.join(' ') + '" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>';
}

/* 载波显示：NR -> n78，LTE -> B3 */
function bandTag(rat, band) {
	if (band == null || band === 0 || band === '' || band === '?') return '';
	return '<span class="mud-tag">' + (rat === 'nr' ? 'n' : 'B') + esc(band) + '</span>';
}

return view.extend({
	load: function() { return Promise.resolve(); },

	render: function() {
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = this.html();
		this.wire(root);
		var self = this;
		poll.add(function() {
			return L.resolveDefault(callStatus()).then(function(st) { self.update(st || {}); });
		}, POLL_S);
		return root;
	},

	/* ------------------------------------------------------------- 骨架 */
	html: function() {
		return `
<style>
.mud{--c-card:var(--background-alt,#fff);--c-txt:var(--text,#222);--c-sub:var(--text-light,#777);--c-line:var(--border,#e3e6ea);font-size:.9rem;color:var(--c-txt)}
.mud *{box-sizing:border-box}
.mud-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;margin-top:8px}
.mud-card{background:var(--c-card);border:1px solid var(--c-line);border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.mud-card>h3{margin:0 0 10px;font-size:.82rem;font-weight:600;color:var(--c-sub);letter-spacing:.05em}
.mud-hero{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:16px;align-items:center;background:linear-gradient(135deg,var(--card-grad-a,rgba(47,191,113,.10)),var(--card-grad-b,rgba(59,130,246,.07))),var(--c-card)}
.mud-hero-l{flex:1 1 260px;min-width:0}
.mud-hero-r{flex:0 0 auto;text-align:right}
.mud-rat{font-size:1.9rem;font-weight:700;letter-spacing:.02em;line-height:1.15}
.mud-op{color:var(--c-sub);margin-top:2px}
.mud-cell-line{margin-top:8px;font-size:.85rem;color:var(--c-sub)}
.mud-rsrp{font-size:2.7rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.mud-rsrp small{font-size:1rem;font-weight:500}
.mud-chips{display:flex;gap:6px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap}
.mud-tag{display:inline-block;padding:1px 8px;border-radius:99px;background:rgba(127,127,127,.12);font-size:.78rem;font-weight:600;font-variant-numeric:tabular-nums}
.mud-q{display:inline-block;min-width:3.2em;padding:1px 8px;border-radius:99px;color:#fff;font-size:.78rem;font-weight:600;text-align:center}
.mud-rows{display:grid;gap:4px}
.mud-r{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed color-mix(in srgb,var(--c-line) 60%,transparent)}
.mud-r:last-child{border-bottom:none}
.mud-k{color:var(--c-sub);flex:0 0 auto}
.mud-v{font-variant-numeric:tabular-nums;text-align:right;word-break:break-all;font-weight:500}
.mud-bars{display:inline-flex;align-items:flex-end;gap:2px;height:18px;margin-left:8px;vertical-align:baseline}
.mud-bars i{width:4px;border-radius:1px;background:var(--c-line)}
.mud-bars i.on{background:currentColor}
.mud-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:6px}
.mud-kpi{background:rgba(127,127,127,.06);border-radius:10px;padding:8px 10px}
.mud-kpi b{display:block;font-size:1.15rem;font-variant-numeric:tabular-nums;font-weight:700}
.mud-kpi span{font-size:.75rem;color:var(--c-sub)}
.mud-meter{height:6px;border-radius:3px;background:rgba(127,127,127,.15);overflow:hidden;margin:4px 0 2px}
.mud-meter i{display:block;height:100%;border-radius:3px}
.mud-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;border:1px solid var(--c-line);border-radius:10px;background:var(--c-card);color:var(--c-txt);font-size:.85rem;cursor:pointer;user-select:none}
.mud-btn:active{transform:scale(.97)}
.mud-btn.on{background:#2FBF71;border-color:#2FBF71;color:#fff}
.mud-btn.warn{border-color:#E25555;color:#E25555}
.mud-btn[disabled]{opacity:.45;pointer-events:none}
.mud-ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.mud-note{font-size:.75rem;color:var(--c-sub);margin-top:8px}
.mud-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.mud-table th{font-weight:500;color:var(--c-sub);text-align:right;padding:2px 4px;border-bottom:1px solid var(--c-line);font-size:.78rem}
.mud-table td{text-align:right;padding:3px 4px;border-bottom:1px dashed color-mix(in srgb,var(--c-line) 55%,transparent)}
.mud-table th:first-child,.mud-table td:first-child{text-align:left}
.mud-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#8A8F98;margin-right:6px;vertical-align:1px}
.mud-dot.on{background:#2FBF71}
.mud-at-in{display:flex;gap:8px;margin-bottom:8px}
.mud-at-in input{flex:1;min-width:0;padding:7px 10px;border:1px solid var(--c-line);border-radius:10px;background:var(--c-card);color:var(--c-txt);font-family:monospace}
.mud-out{font-family:monospace;font-size:.8rem;white-space:pre-wrap;background:rgba(127,127,127,.07);border-radius:10px;padding:10px;max-height:220px;overflow:auto;margin:8px 0 0}
.mud-chiprow{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.mud-chip{padding:2px 9px;border-radius:99px;border:1px solid var(--c-line);font-size:.75rem;font-family:monospace;cursor:pointer}
.mud-chip.on{background:#2f7bf6;border-color:#2f7bf6;color:#fff}
.mud-temp{display:inline-flex;gap:6px;flex-wrap:wrap}
.mud-temp span{padding:2px 9px;border-radius:8px;background:rgba(127,127,127,.08);font-variant-numeric:tabular-nums;font-size:.82rem}
@media(max-width:600px){.mud-hero-r{text-align:left}.mud-chips{justify-content:flex-start}.mud-rsrp{font-size:2.1rem}}
</style>

<div class="mud-grid">
  <div class="mud-card mud-hero">
    <div class="mud-hero-l">
      <div><span class="mud-dot" id="mud-dot"></span><b id="mud-host">--</b>
        <span style="color:var(--c-sub);font-size:.8rem" id="mud-uptime"></span></div>
      <div class="mud-rat" id="mud-rat">--<span class="mud-bars" id="mud-bars"><i style="height:25%"></i><i style="height:45%"></i><i style="height:65%"></i><i style="height:85%"></i><i style="height:100%"></i></span></div>
      <div class="mud-op" id="mud-op">--</div>
      <div class="mud-cell-line" id="mud-cellline"></div>
    </div>
    <div class="mud-hero-r">
      <div class="mud-rsrp" id="mud-rsrp">--</div>
      <div class="mud-chips" id="mud-metric-chips"></div>
    </div>
  </div>

  <div class="mud-card">
    <h3>快捷控制</h3>
    <div class="mud-ctl">
      <button class="mud-btn" id="mud-btn-data">数据连接</button>
      <button class="mud-btn" id="mud-btn-radio">无线电</button>
      <button class="mud-btn" id="mud-btn-wifi">Wi-Fi 热点</button>
      <button class="mud-btn" id="mud-btn-vpn">VPN</button>
      <button class="mud-btn warn" id="mud-btn-modem">重启调制解调器</button>
      <button class="mud-btn warn" id="mud-btn-reboot">重启设备</button>
    </div>
    <div class="mud-note" id="mud-actnote"></div>
  </div>

  <div class="mud-card">
    <h3>网络锁定</h3>
    <div class="mud-r" style="margin-bottom:6px"><span class="mud-k">网络模式</span>
      <span class="mud-v" id="mud-lock-modeline">--</span></div>
    <div class="mud-ctl" id="mud-lock-modes" style="grid-template-columns:repeat(4,1fr)"></div>
    <div class="mud-ctl" style="margin-top:8px;grid-template-columns:1fr 1fr">
      <button class="mud-btn" id="mud-lock-endc">EN-DC</button>
      <button class="mud-btn" id="mud-lock-refresh">刷新锁定状态</button>
    </div>
    <div class="mud-r" style="margin-top:8px"><span class="mud-k">NR 频段</span><span class="mud-v" id="mud-lock-nrline">--</span></div>
    <div class="mud-chiprow" id="mud-lock-nr"></div>
    <div class="mud-r" style="margin-top:6px"><span class="mud-k">LTE 频段</span><span class="mud-v" id="mud-lock-lteline">--</span></div>
    <div class="mud-chiprow" id="mud-lock-lte"></div>
    <div class="mud-ctl" style="margin-top:8px;grid-template-columns:repeat(4,1fr)">
      <button class="mud-btn" id="mud-lock-nr-apply">应用 NR</button>
      <button class="mud-btn" id="mud-lock-lte-apply">应用 LTE</button>
      <button class="mud-btn" id="mud-lock-cell">锁定当前小区</button>
      <button class="mud-btn warn" id="mud-lock-cell-off">解除小区锁</button>
    </div>
    <div class="mud-r" style="margin-top:6px"><span class="mud-k">小区锁定</span><span class="mud-v" id="mud-lock-cellline">--</span></div>
    <div class="mud-note" id="mud-lock-note">锁定属低频高危操作：应用后会重启协议栈（SFUN），蜂窝断开约半分钟；设置自动保存并在开机时回放。</div>
  </div>

  <div class="mud-card">
    <h3>链路质量</h3>
    <div class="mud-kpis">
      <div class="mud-kpi"><b id="mud-mcs">--</b><span>MCS 下/上</span></div>
      <div class="mud-kpi"><b id="mud-bler">--</b><span>BLER 下/上</span></div>
      <div class="mud-kpi"><b id="mud-bw">--</b><span>频宽</span></div>
      <div class="mud-kpi"><b id="mud-qci">--</b><span>QCI / AMBR 下·上</span></div>
    </div>
    <div class="mud-rows" id="mud-lteanchor"></div>
  </div>

  <div class="mud-card">
    <h3>网络与流量</h3>
    <div class="mud-kpis">
      <div class="mud-kpi"><b id="mud-dl" style="color:#2f7bf6">--</b><span>下行速率</span><div style="color:#2f7bf6" id="mud-spark-dl"></div></div>
      <div class="mud-kpi"><b id="mud-ul" style="color:#2FBF71">--</b><span>上行速率</span><div style="color:#2FBF71" id="mud-spark-ul"></div></div>
      <div class="mud-kpi"><b id="mud-tx">--</b><span>累计发送</span></div>
      <div class="mud-kpi"><b id="mud-rx">--</b><span>累计接收</span></div>
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
    <table class="mud-table"><thead><tr><th>制式/频段</th><th>PCI</th><th>频点</th><th>RSRP</th><th>RSRQ</th><th>SINR</th></tr></thead>
    <tbody id="mud-neigh"><tr><td colspan="6" style="color:var(--c-sub)">--</td></tr></tbody></table>
  </div>

  <div class="mud-card">
    <h3>Wi-Fi 与客户端</h3>
    <div class="mud-rows">
      <div class="mud-r"><span class="mud-k">SSID · 信道</span><span class="mud-v" id="mud-ssid">--</span></div>
      <div class="mud-r"><span class="mud-k">已连接客户端</span><span class="mud-v" id="mud-wcl">--</span></div>
      <div class="mud-r"><span class="mud-k">DHCP 租约</span><span class="mud-v" id="mud-leases">--</span></div>
      <div class="mud-r"><span class="mud-k">连接跟踪表</span><span class="mud-v" id="mud-conns">--</span></div>
    </div>
    <div id="mud-clist" style="margin-top:8px"></div>
  </div>

  <div class="mud-card">
    <h3>设备</h3>
    <div class="mud-temp" id="mud-temps"></div>
    <div class="mud-kpis" style="margin-top:10px">
      <div class="mud-kpi"><b id="mud-cpu">--</b><span>CPU 占用</span><div class="mud-meter"><i id="mud-cpu-bar" style="background:#3b82f6"></i></div></div>
      <div class="mud-kpi"><b id="mud-ram">--</b><span>内存</span><div class="mud-meter"><i id="mud-ram-bar" style="background:#8b5cf6"></i></div></div>
      <div class="mud-kpi"><b id="mud-disk">--</b><span>存储</span><div class="mud-meter"><i id="mud-disk-bar" style="background:#f59e0b"></i></div></div>
      <div class="mud-kpi"><b id="mud-batt">--</b><span id="mud-batt-l">电源</span></div>
    </div>
    <div class="mud-rows">
      <div class="mud-r"><span class="mud-k">型号 · 系统</span><span class="mud-v" id="mud-model">--</span></div>
      <div class="mud-r"><span class="mud-k">调制解调器</span><span class="mud-v" id="mud-modem">--</span></div>
    </div>
  </div>

  <div class="mud-card">
    <h3>SIM / 模组</h3>
    <div class="mud-rows">
      <div class="mud-r"><span class="mud-k">运营商</span><span class="mud-v" id="mud-carr">--</span></div>
      <div class="mud-r"><span class="mud-k">IMEI</span><span class="mud-v" id="mud-imei">--</span></div>
      <div class="mud-r"><span class="mud-k">IMSI</span><span class="mud-v" id="mud-imsi">--</span></div>
      <div class="mud-r"><span class="mud-k">ICCID</span><span class="mud-v" id="mud-iccid">--</span></div>
      <div class="mud-r"><span class="mud-k">模组 · 固件</span><span class="mud-v" id="mud-fw">--</span></div>
    </div>
    <div class="mud-chiprow"><span class="mud-chip" id="mud-reveal">显示卡号信息</span></div>
  </div>

  <div class="mud-card" style="grid-column:1/-1">
    <h3>AT 终端</h3>
    <div class="mud-at-in">
      <input id="mud-at-cmd" placeholder="AT 命令，如 AT+CSQ" spellcheck="false"/>
      <button class="mud-btn" id="mud-at-go">发送</button>
    </div>
    <div class="mud-out" id="mud-at-out">就绪。命令经 mu300-at 走设备的 AT 通道（自动排队，不会干扰拨号）。</div>
    <div class="mud-chiprow" id="mud-at-chips"></div>
  </div>
</div>`;
	},

	/* ------------------------------------------------------------- 行为 */
	wire: function(root) {
		var self = this;
		this.identShown = false;
		this.dlHist = []; this.ulHist = [];
		this.lastNet = null; this.lastCpu = null;

		/* render() runs BEFORE LuCI attaches the node to the document, so look the
		   elements up relative to root here - document.getElementById would return
		   null and the page would die on the first .onclick below (seen on the
		   device). The poll-time update() may use document-wide lookups. */
		var q = function(id) { return root.querySelector('#mud-' + id); };

		var act = function(op, arg, note) {
			v('actnote').textContent = note || ('正在执行 ' + op + ' …');
			return L.resolveDefault(callAct(op, arg)).then(function(r) {
				r = r || {};
				v('actnote').textContent = r.ok ? ((r.started ? '已后台执行：' : '已执行：') + (r.op || op) + (r.started ? '（页面稍后自动反映新状态）' : '')) : ('失败：' + (r.error || '未知错误'));
			}, function() { v('actnote').textContent = '调用失败'; });
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
			v('reveal').textContent = self.identShown ? '隐藏卡号信息' : '显示卡号信息';
			self.paintIdent(self.lastCell);
		};

		var chips = [ 'AT+CSQ', 'AT+CEREG?', 'AT+C5GREG?', 'AT+COPS?', 'AT+CGACT?', 'AT+CGCONTRDP=1', 'AT+CFUN?', 'AT+CPIN?', 'AT+CGMR', 'AT+SPENDC?', 'AT+SPENGMD=0,14,1' ];
		q('at-chips').innerHTML = chips.map(function(c) { return '<span class="mud-chip">' + c + '</span>'; }).join('');
		root.querySelectorAll('.mud-chip').forEach(function(ch) {
			ch.onclick = function() { v('at-cmd').value = ch.textContent; v('at-go').onclick(); };
		});

		var sendAt = function() {
			var cmd = (v('at-cmd').value || '').trim();
			if (!cmd) return;
			v('at-out').textContent = '> ' + cmd + '\n…';
			L.resolveDefault(callAt(cmd)).then(function(r) {
				r = r || {};
				v('at-out').textContent = '> ' + cmd + '\n' +
					(r.ok ? (r.reply || '(无输出)') : ('错误：' + (r.error || '失败') + (r.busy ? '（AT 通道正忙，命令未发出）' : '')));
			}, function() { v('at-out').textContent = '调用失败'; });
		};
		q('at-go').onclick = sendAt;
		q('at-cmd').addEventListener('keydown', function(ev) { if (ev.key == 'Enter') sendAt(); });

		this.wireLocks(root, q);
	},

	/* --------------------------------------------------- 网络锁定（低频高危） */
	/* 锁定全部走 mu300dash lock_set：后端 mu300-dash-lock 负责编解码（SPTESTMODE/
	   SP5GRAN/SPLBAND/SPFORCEFRQ/SPENDC），应用后 SFUN 重启协议栈，落盘并在开机回放。
	   页面只在打开和手动刷新时 lock_get（7 条 AT 读），不进 3 秒轮询。 */
	wireLocks: function(root, q) {
		var self = this;
		var MODES = [ [ 'auto', '自动' ], [ '4g', '仅 4G' ], [ 'sa', '5G SA' ], [ 'nsa', '5G NSA' ] ];
		var NR_CAND = [ 1, 3, 5, 8, 28, 41, 77, 78, 79 ];
		var LTE_CAND = [ 1, 3, 5, 8, 34, 38, 39, 40, 41 ];
		this.lockSel = { nr: {}, lte: {} };
		this.lockCand = { nr: NR_CAND, lte: LTE_CAND };

		var apply = function(kind, val, what) {
			if (!window.confirm('应用「' + what + '」？\n协议栈会重启（SFUN），蜂窝断开约半分钟。')) return;
			v('lock-note').textContent = '正在后台应用 ' + what + ' …（SFUN 重启 + 重新驻网，约半分钟）';
			L.resolveDefault(callLockSet(kind, val)).then(function(r) {
				r = r || {};
				v('lock-note').textContent = r.ok ? '已后台执行：' + (r.op || kind) + '。约半分钟后点「刷新锁定状态」确认。' : ('失败：' + (r.error || '未知错误'));
				setTimeout(function() { self.refreshLocks(); }, 35000);
			}, function() { v('lock-note').textContent = '调用失败'; });
		};

		q('lock-modes').innerHTML = MODES.map(function(m) {
			return '<button class="mud-btn" data-mode="' + m[0] + '">' + m[1] + '</button>';
		}).join('');
		root.querySelectorAll('#mud-lock-modes .mud-btn').forEach(function(b) {
			b.onclick = function() {
				var m = b.getAttribute('data-mode');
				var cur = self.lastLock && self.lastLock.mode && self.lastLock.mode.label;
				if (m === cur) return;
				apply('mode', m, '网络模式：' + b.textContent);
			};
		});

		q('lock-endc').onclick = function() {
			var on = self.lastLock && self.lastLock.endc === '1';
			apply('endc', on ? 'off' : 'on', on ? '关闭 EN-DC（NSA 锚点）' : '开启 EN-DC（NSA 锚点）');
		};
		q('lock-refresh').onclick = function() { self.refreshLocks(); };

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
			if (!sel.length) return apply('nr', '', 'NR 频段：自动（解除锁定）');
			apply('nr', sel.join(','), 'NR 频段锁定：n' + sel.join(' n'));
		};
		q('lock-lte-apply').onclick = function() {
			var sel = selBands('lte');
			if (!sel.length) return apply('lte', '', 'LTE 频段：自动（解除锁定）');
			apply('lte', sel.join(','), 'LTE 频段锁定：B' + sel.join(' B'));
		};
		q('lock-cell').onclick = function() {
			apply('cell', 'auto', '锁定当前服务小区');
		};
		q('lock-cell-off').onclick = function() {
			apply('cell', 'off', '解除小区锁定');
		};

		this.refreshLocks();
	},

	refreshLocks: function() {
		var self = this;
		L.resolveDefault(callLockGet()).then(function(l) { self.lastLock = l || {}; self.paintLocks(); });
	},

	paintLocks: function() {
		var l = this.lastLock || {};
		var self = this;
		if (l.error) { set('lock-modeline', l.error); return; }
		var MODE_TXT = { auto: '自动（5G/4G）', '4g': '仅 4G', sa: '仅 5G SA', nsa: '仅 5G NSA' };
		set('lock-modeline', MODE_TXT[l.mode && l.mode.label] || '--');
		document.querySelectorAll('#mud-lock-modes .mud-btn').forEach(function(b) {
			b.className = (b.getAttribute('data-mode') === (l.mode && l.mode.label)) ? 'mud-btn on' : 'mud-btn';
		});
		var eb = document.getElementById('mud-lock-endc');
		if (eb) { eb.className = 'mud-btn' + (l.endc === '1' ? ' on' : ''); eb.textContent = l.endc === '1' ? 'EN-DC ✓' : 'EN-DC'; }

		/* 频段行：掩码全零 = 自动；读出的“全集”也是自动（本机的支持列表） */
		[ 'nr', 'lte' ].forEach(function(rat) {
			var locked = (l[rat] && l[rat].locked) || '';
			var arr = locked ? locked.split(',').map(Number) : [];
			var isAuto = arr.length === 0 || arr.length >= self.lockCand[rat].length;
			set('lock-' + rat + 'line', isAuto
				? '自动（支持 ' + self.lockCand[rat].length + ' 个）'
				: '已锁 ' + arr.length + ' 个：' + (rat === 'nr' ? 'n' : 'B') + arr.join(' ' + (rat === 'nr' ? 'n' : 'B')));
			var box = document.getElementById('mud-lock-' + rat);
			if (box) Array.prototype.forEach.call(box.children, function(ch) {
				var b = ch.getAttribute('data-b');
				var on = !isAuto && arr.indexOf(Number(b)) >= 0;
				self.lockSel[rat][b] = on;
				ch.className = on ? 'mud-chip on' : 'mud-chip';
			});
		});
		set('lock-cellline', l.cell || '未锁定');
	},

	/* ------------------------------------------------------------- 刷新 */
	paintIdent: function(cell) {
		var id = cell && cell.ident, mask = function(s) {
			if (!s) return '--';
			return this.identShown ? s : s.substring(0, 4) + '****' + s.substring(s.length - 3);
		}.bind(this);
		set('imei', mask(id && id.imei));
		set('imsi', mask(id && id.imsi));
		set('iccid', mask(id && id.iccid));
		set('fw', id ? ((id.model || '--') + ' · ' + (id.fw || '--')) : '--');
	},

	update: function(st) {
		var i = st.info || {};
		this.lastInfo = i;
		var c = st.cell || null;
		this.lastCell = c;

		/* -- 头部 */
		set('host', i.host);
		set('uptime', i.uptime ? '已运行 ' + fmtUptime(i.uptime) : '');
		v('dot').className = 'mud-dot' + (i.modem && i.modem.alive ? ' on' : '');

		var sig = c && !c.error ? (c.sig || {}) : {};
		var rsrp = sig.rsrp, rsrq = sig.rsrq, sinr = sig.sinr;
		var label = qLabel(rsrp, rsrq, sinr), score = qScore({ rsrp: rsrp, rsrq: rsrq, sinr: sinr });
		var col = QCOL[label];

		/* RAT：NR+LTE -> 5G NSA；仅 NR -> 5G SA；仅 LTE 按 COPS AcT */
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
		if (c && c.error) { rat = '无应答'; col = QCOL['较差']; }
		var ratEl = v('rat');
		ratEl.firstChild.nodeValue = rat;
		ratEl.style.color = col;
		var bars = v('bars');
		if (bars) {
			var n = score == null ? 0 : Math.max(1, Math.round(score / 2));
			Array.prototype.forEach.call(bars.children, function(b, idx) { b.className = idx < n ? 'on' : ''; });
		}

		var oper = carrierName(c && c.operator);
		set('carr', oper + (c && c.operator && c.operator.plmn ? ' · ' + c.operator.plmn : ''));
		set('op', oper + (score != null ? ' · 信号 ' + label + ' ' + score.toFixed(1) + ' 分' : ' · 信号 ' + label));

		/* 驻网行：频段 / PCI / 频点 / 频宽 */
		var cl = [];
		if (c && c.nr && c.nr.band) cl.push('n' + c.nr.band + (c.nr.bw_mhz ? ' · ' + c.nr.bw_mhz + ' MHz' : '') + ' · PCI ' + c.nr.pci + ' · ARFCN ' + c.nr.arfcn);
		if (c && c.lte && c.lte.band) cl.push('锚点 B' + c.lte.band + ' · PCI ' + c.lte.pci + ' · EARFCN ' + c.lte.earfcn +
			(c.lte.sinr != null ? ' · SINR ' + c.lte.sinr.toFixed(1) + ' dB' : ''));
		v('cellline').innerHTML = cl.map(esc).join('<br>') || '<span style="color:var(--c-sub)">未驻留小区</span>';

		set('rsrp', '--');
		if (rsrp != null) v('rsrp').innerHTML = rsrp.toFixed(1) + '<small> dBm</small>';
		v('rsrp').style.color = col;
		v('metric-chips').innerHTML =
			'<span class="mud-q" style="background:' + col + '">' + label + '</span>' +
			(rsrq != null ? '<span class="mud-tag">RSRQ ' + rsrq.toFixed(1) + '</span>' : '') +
			(sinr != null ? '<span class="mud-tag">SINR ' + sinr.toFixed(1) + '</span>' : '') +
			(c && c.lte && !c.nr && c.lte.sinr != null ? '<span class="mud-tag">LTE SINR ' + c.lte.sinr.toFixed(1) + '</span>' : '') +
			(st.refreshing ? '<span class="mud-tag" style="opacity:.6">采集中…</span>' : '') +
			(st.cell_age >= 0 ? '<span class="mud-tag" style="opacity:.6"> cellular ' + st.cell_age + 's</span>' : '');

		/* -- 链路质量 */
		var nr = (c && c.nr) || null;
		set('mcs', nr && nr.dl_mcs != null ? nr.dl_mcs + ' / ' + (nr.ul_mcs != null ? nr.ul_mcs : '--') : '--');
		set('bler', nr && nr.dl_bler != null ? nr.dl_bler + '% / ' + (nr.ul_bler != null ? nr.ul_bler : '--') + '%' : '--');
		set('bw', nr && nr.bw_mhz ? nr.bw_mhz + ' MHz' : (c && c.lte && c.lte.bw) || '--');
		var qos = c && c.qos;
		set('qci', qos && qos.qci != null ? qos.qci + (qos.dl != null ? ' · ' + qos.dl + '/' + qos.ul + ' Mbps' : '') : '--');
		var anchor = (c && c.lte && c.lte.band) ? c.lte : null;
		v('lteanchor').innerHTML = (anchor && c.nr && c.nr.band) ?
			'<div class="mud-r"><span class="mud-k">LTE 锚点</span><span class="mud-v">B' + esc(anchor.band) +
			' · RSRP ' + (anchor.rsrp != null ? anchor.rsrp.toFixed(1) + ' dBm' : '--') +
			(anchor.sinr != null ? ' · SINR ' + anchor.sinr.toFixed(1) : '') +
			(anchor.dl_mcs != null ? ' · MCS ' + anchor.dl_mcs + (anchor.dl_bler != null ? ' · BLER ' + anchor.dl_bler + '%' : '') : '') +
			(anchor.ca ? ' · ' + anchor.ca : '') + '</span></div>' :
			(anchor ? '<div class="mud-r"><span class="mud-k">LTE 链路</span><span class="mud-v">MCS ' +
			(anchor.dl_mcs != null ? anchor.dl_mcs : '--') + ' / ' + (anchor.ul_mcs != null ? anchor.ul_mcs : '--') +
			' · BLER ' + (anchor.dl_bler != null ? anchor.dl_bler : '--') + '% / ' + (anchor.ul_bler != null ? anchor.ul_bler : '--') + '%' +
			(anchor.ca ? ' · ' + anchor.ca : '') + '</span></div>' : '');

		/* -- 网络与流量（差分速率） */
		var net = (i.net && i.net.sipa_eth0) || null;
		if (net && this.lastNet && i.ts && this.lastNet.ts) {
			var dt = i.ts - this.lastNet.ts;
			if (dt > 0) {
				var dl = (net.rx - this.lastNet.rx) / dt, ul = (net.tx - this.lastNet.tx) / dt;
				set('dl', fmtRate(dl)); set('ul', fmtRate(ul));
				this.dlHist.push(dl); this.ulHist.push(ul);
				if (this.dlHist.length > RATE_WIN) { this.dlHist.shift(); this.ulHist.shift(); }
				var peak = Math.max(1, Math.max.apply(null, this.dlHist.concat(this.ulHist)));
				spark(v('spark-dl'), this.dlHist, 0, peak);
				spark(v('spark-ul'), this.ulHist, 0, peak);
			}
		}
		if (net) {
			set('rx', fmtBytes(net.rx)); set('tx', fmtBytes(net.tx));
			this.lastNet = { ts: i.ts, rx: net.rx, tx: net.tx };
		}
		var w = i.wan || {};
		v('ip').innerHTML = esc(w.ip4 || '--') + (w.ip6 ? '<br>' + esc(w.ip6) : '');
		set('dns', w.dns || '--');
		set('apn', (w.apn || '--') + (w.uptime ? ' · ' + fmtUptime(w.uptime) : ''));
		var regmap = { 0: '未注册', 1: '已注册', 2: '搜索中', 3: '注册被拒', 4: '未知', 5: '已注册（漫游）', 7: '仅紧急', 8: '仅紧急', 10: '已注册' };
		var reg = '--';
		if (c && c.reg) {
			reg = regmap[c.reg.stat] || ('状态 ' + c.reg.stat);
			if (c.reg.tac) reg += ' · TAC ' + c.reg.tac;
			if (c.reg5g && c.reg5g.stat == 1) reg += ' · 5G ' + regmap[c.reg5g.stat];
		} else if (c && c.error) reg = c.error;
		set('reg', reg);

		/* -- 邻区 */
		var nb = (c && c.neigh) || [];
		nb.sort(function(a, b) {
			if ((a.rat == 'nr') != (b.rat == 'nr')) return a.rat == 'nr' ? -1 : 1;
			return (b.rsrp || -999) - (a.rsrp || -999);
		});
		v('neigh').innerHTML = nb.length ? nb.map(function(n) {
			var l = qLabel(n.rsrp, n.rsrq, n.sinr);
			return '<tr><td>' + (n.rat == 'nr' ? 'NR' : 'LTE') + ' ' + bandTag(n.rat, n.band) + '</td>' +
				'<td>' + esc(n.pci != null ? n.pci : '--') + '</td>' +
				'<td>' + esc(n.arfcn != null ? n.arfcn : '--') + '</td>' +
				'<td style="color:' + QCOL[l] + '">' + (n.rsrp != null ? n.rsrp.toFixed(1) : '--') + '</td>' +
				'<td>' + (n.rsrq != null ? n.rsrq.toFixed(1) : '--') + '</td>' +
				'<td>' + (n.sinr != null ? n.sinr.toFixed(1) : '--') + '</td></tr>';
		}).join('') : '<tr><td colspan="6" style="color:var(--c-sub)">暂无邻区数据</td></tr>';

		/* -- Wi-Fi */
		var wf = i.wifi || {};
		set('ssid', (wf.ssid || '--') + (wf.channel ? ' · Ch ' + wf.channel + (wf.band ? ' (' + wf.band + ')' : '') : ''));
		set('wcl', wf.clients_n != null ? wf.clients_n + ' 台' : '--');
		set('leases', i.lan ? i.lan.leases : '--');
		set('conns', i.conns != null ? i.conns + ' 条' : '--');
		v('clist').innerHTML = (wf.clients || []).map(function(cl) {
			var l = cl.signal != null ? (cl.signal >= -55 ? '优秀' : cl.signal >= -67 ? '良好' : cl.signal >= -80 ? '一般' : '较差') : '未知';
			return '<div class="mud-r"><span class="mud-k">' + esc(cl.host || cl.mac) + '</span>' +
				'<span class="mud-v">' + esc(cl.mac) + (cl.signal != null ? ' · <span style="color:' + QCOL[l] + '">' + cl.signal + ' dBm</span>' : '') + '</span></div>';
		}).join('');

		/* -- 设备 */
		var t = i.temps || {};
		v('temps').innerHTML = [ [ 'SoC', t.soc ], [ 'CPU', t.cpu ], [ '调制解调器', t.modem ], [ '主板', t.board ] ]
			.filter(function(x) { return x[1] != null; })
			.map(function(x) {
				var col = x[1] >= 75 ? QCOL['较差'] : x[1] >= 60 ? QCOL['一般'] : QCOL['良好'];
				return '<span style="color:' + col + '">' + x[0] + ' ' + x[1] + '°C</span>';
			}).join('') || '<span style="color:var(--c-sub)">无温度读数</span>';

		if (i.cpu && this.lastCpu && i.cpu.total != null && this.lastCpu.total != null) {
			var dt2 = i.cpu.total - this.lastCpu.total, di = i.cpu.idle - this.lastCpu.idle;
			var pct = dt2 > 0 ? Math.round((dt2 - di) * 100 / dt2) : null;
			set('cpu', pct != null ? pct + '%' : '--');
			v('cpu-bar').style.width = (pct || 0) + '%';
			this.freqTxt(i.cpu.freqs);
		}
		this.lastCpu = i.cpu || null;

		if (i.mem && i.mem.total_kb) {
			var used = i.mem.total_kb - i.mem.avail_kb, pct = Math.round(used * 100 / i.mem.total_kb);
			set('ram', pct + '%');
			v('ram-bar').style.width = pct + '%';
		}
		if (i.storage && i.storage.total_kb) {
			var pct2 = Math.round(i.storage.used_kb * 100 / i.storage.total_kb);
			set('disk', pct2 + '%');
			v('disk-bar').style.width = pct2 + '%';
		}
		var p = i.power || {};
		if (p.present && p.capacity != null) {
			set('batt', p.capacity + '%');
			set('batt-l', '电源 · ' + (p.status || '') + (p.volt != null ? ' · ' + p.volt + ' V' : '') + (p.usb ? ' · USB' : ''));
		} else {
			set('batt', p.usb ? 'USB' : '--');
			set('batt-l', '电源' + (p.volt != null ? ' · ' + p.volt + ' V' : ''));
		}
		set('model', (i.model || '--') + ' · ' + (i.fw || ''));
		set('modem', (i.modem && i.modem.alive ? '在线' : '无应答') + (i.modem && i.modem.atd ? '' : ' · mu300-atd 未运行'));

		/* -- 控制按钮状态 */
		var b;
		b = v('btn-data'); b.className = 'mud-btn' + (w.up ? ' on' : ''); b.textContent = w.up ? '数据连接 ✓' : '数据连接';
		b = v('btn-radio'); b.className = 'mud-btn' + (c && c.cfun === 1 ? ' on' : ''); b.textContent = c && c.cfun === 1 ? '无线电 ✓' : '无线电';
		b = v('btn-wifi'); b.className = 'mud-btn' + (wf.up ? ' on' : ''); b.textContent = wf.up ? 'Wi-Fi 热点 ✓' : 'Wi-Fi 热点';
		var vp = i.vpn || {};
		b = v('btn-vpn'); b.className = 'mud-btn' + (vp.up ? ' on' : ''); b.textContent = vp.up ? 'VPN ✓' : 'VPN';

		this.paintIdent(c);
	},

	freqTxt: function(freqs) {
		if (!freqs || !freqs.length) return;
		var s = freqs.map(function(f) {
			if (f.cur == null || f.max == null) return null;
			return (f.cur / 1000).toFixed(0) + '/' + (f.max / 1000).toFixed(0) + ' MHz';
		}).filter(Boolean);
		if (s.length) v('cpu').textContent = v('cpu').textContent + ' · ' + s.join(' ');
	}
});
