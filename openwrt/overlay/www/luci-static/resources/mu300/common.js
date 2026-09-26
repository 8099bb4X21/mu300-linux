'use strict';
'require rpc';
'require baseclass';
/* mu300 面板共享模块：rpc 声明、格式化/信号质量助手、主题感知的样式表。
 * 页面通过 'require mu300.common' 引用（LuCI 的 dotted require 映射到
 * /luci-static/resources/mu300/common.js）。
 *
 * 样式只引用主题令牌：本机装的是 luci-theme-aurora（--surface/--hairline/
 * --brand/--text-muted/--success 等，html[data-darkmode] 一键翻转深浅色），
 * 其它主题时逐级回退到 LuCI 标准变量（--background-alt/--border/--primary...）。
 * 质量色不用写死的色值，走 --success/--warning/--danger 与 color-mix，
 * 深浅两套模式都跟随主题。 */

var callStatus = rpc.declare({ object: 'mu300dash', method: 'status', expect: { '': {} } });
var callAct    = rpc.declare({ object: 'mu300dash', method: 'act', params: [ 'op', 'arg' ], expect: { '': {} } });
var callAt     = rpc.declare({ object: 'mu300dash', method: 'at', params: [ 'cmd' ], expect: { '': {} } });
var callAtHist = rpc.declare({ object: 'mu300dash', method: 'at_history', expect: { '': {} } });
var callLockGet = rpc.declare({ object: 'mu300dash', method: 'lock_get', expect: { '': {} } });
var callLockSet = rpc.declare({ object: 'mu300dash', method: 'lock_set', params: [ 'kind', 'val' ], expect: { '': {} } });
var callSmsList = rpc.declare({ object: 'mu300dash', method: 'sms_list', params: [ 'page' ], expect: { '': {} } });
var callSmsShow = rpc.declare({ object: 'mu300dash', method: 'sms_show', params: [ 'id' ], expect: { '': {} } });
var callSmsSend = rpc.declare({ object: 'mu300dash', method: 'sms_send', params: [ 'num', 'text' ], expect: { '': {} } });
var callSmsDel  = rpc.declare({ object: 'mu300dash', method: 'sms_delete', params: [ 'id' ], expect: { '': {} } });
var callSmsSync = rpc.declare({ object: 'mu300dash', method: 'sms_sync', expect: { '': {} } });

/* 大陆运营商 PLMN -> 名称；COPS 给数字格式时用它还原 */
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

/* 信号质量分级（阈值来自 ufi_tools 的 SignalQuality.kt），返回 CSS 颜色表达式 */
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
function qCol(label) {
	switch (label) {
		case '优秀': return 'var(--success, #2FBF71)';
		case '良好': return 'color-mix(in oklab, var(--success, #7BC96F) 62%, var(--text, #444))';
		case '一般': return 'var(--warning, #F2B544)';
		case '较差': return 'var(--danger, #E25555)';
		default:     return 'var(--text-subtle, var(--text-light, #8A8F98))';
	}
}
/* 10 分制：RSRP 40% / RSRQ 25% / SINR 35%，锚点插值，缺项权重重分配 */
function interp(v, pts) {
	if (v == null) return null;
	for (var i = 0; i < pts.length - 1; i++)
		if (v <= pts[i][0])
			return pts[i][1] + (v - pts[i][0]) * (pts[i+1][1] - pts[i][1]) / (pts[i+1][0] - pts[i][0]);
	return pts[pts.length - 1][1];
}
function qScore(s) {
	var parts = [
		[ interp(s.rsrp, [ [ -120, 0 ], [ -110, 3.5 ], [ -100, 6.5 ], [ -90, 8.5 ], [ -80, 10 ] ]), 0.40 ],
		[ interp(s.rsrq, [ [ -20, 0 ], [ -14, 3.5 ], [ -11, 6.5 ], [ -8, 8.5 ], [ -3, 10 ] ]), 0.25 ],
		[ interp(s.sinr, [ [ -5, 0 ], [ 0, 3.5 ], [ 13, 6.5 ], [ 20, 8.5 ], [ 30, 10 ] ]), 0.35 ]
	];
	var sum = 0, w = 0;
	parts.forEach(function(p) { if (p[0] != null) { sum += p[0] * p[1]; w += p[1]; } });
	return w == 0 ? null : Math.max(0, Math.min(10, sum / w));
}

/* ---------------------------------------------------------------- 格式化 */
function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
	});
}
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

/* ------------------------------------------------------------------ 样式 */
var CSS = `
.mud{color:var(--text,#222);font-size:.85rem;line-height:1.45}
.mud *{box-sizing:border-box}
.mud-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:10px;margin-top:6px}
.mud-card{background:var(--surface,var(--background-alt,var(--background,#fff)));border:1px solid var(--hairline,var(--border,#e3e6ea));border-radius:calc(var(--radius-base,.5rem) + .375rem);padding:10px 12px;box-shadow:var(--app-shadow-sm,0 1px 3px rgba(0,0,0,.04));transition:border-color .15s}
.mud-card:hover{border-color:color-mix(in oklab,var(--brand,var(--primary,#2f7bf6)) 30%,var(--hairline,var(--border,#e3e6ea)))}
.mud-card>h3{margin:0 0 8px;font-size:.7rem;font-weight:600;color:var(--text-muted,var(--text-light,#787d85));letter-spacing:.08em}
.mud-card>h3::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--brand,var(--primary,#2f7bf6));margin-right:7px;vertical-align:1px}
.mud-hero{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:14px;align-items:center;background:var(--brand-subtle,var(--surface,#fff))}
.mud-hero-l{flex:1 1 240px;min-width:0}
.mud-hero-r{flex:0 0 auto;text-align:right}
.mud-rat{font-size:1.7rem;font-weight:700;line-height:1.15;letter-spacing:.02em}
.mud-op{color:var(--text-muted,var(--text-light,#777));margin-top:1px;font-size:.85rem}
.mud-cellline{margin-top:5px;font-size:.78rem;color:var(--text-muted,var(--text-light,#777));font-variant-numeric:tabular-nums}
.mud-rsrp{font-size:2.3rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.mud-rsrp small{font-size:.9rem;font-weight:500}
.mud-chips{display:flex;gap:5px;justify-content:flex-end;margin-top:6px;flex-wrap:wrap}
.mud-tag{display:inline-block;padding:1px 8px;border-radius:99px;background:var(--surface-sunken,rgba(127,127,127,.1));font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums}
.mud-q{display:inline-block;min-width:3em;padding:1px 8px;border-radius:99px;font-size:.74rem;font-weight:600;text-align:center}
.mud-rows{display:grid;gap:2px}
.mud-r{display:flex;justify-content:space-between;gap:10px;padding:2px 0;border-bottom:1px dashed color-mix(in oklab,var(--hairline,var(--border,#ddd)) 55%,transparent)}
.mud-r:last-child{border-bottom:none}
.mud-k{color:var(--text-muted,var(--text-light,#777));flex:0 0 auto}
.mud-v{font-variant-numeric:tabular-nums;text-align:right;word-break:break-all;font-weight:500}
.mud-bars{display:inline-flex;align-items:flex-end;gap:2px;height:16px;margin-left:8px;vertical-align:baseline}
.mud-bars i{width:3px;border-radius:1px;background:var(--hairline,var(--border,#ccc))}
.mud-bars i.on{background:currentColor}
.mud-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:8px;margin-bottom:4px}
.mud-kpi{background:var(--surface-sunken,rgba(127,127,127,.06));border-radius:var(--radius-base,.5rem);padding:6px 9px 6px 10px;border-left:3px solid color-mix(in oklab,var(--brand,var(--primary,#2f7bf6)) 55%,transparent)}
.mud-kpi b{display:block;font-size:1.05rem;font-variant-numeric:tabular-nums;font-weight:700;line-height:1.25}
.mud-kpi span{font-size:.68rem;color:var(--text-muted,var(--text-light,#777))}
.mud-meter{height:5px;border-radius:3px;background:var(--surface-sunken,rgba(127,127,127,.15));overflow:hidden;margin:3px 0 1px}
.mud-meter i{display:block;height:100%;border-radius:3px}
.mud-freq{display:flex;align-items:center;font-size:.76rem;font-variant-numeric:tabular-nums;padding:1px 0}
.mud-freq .mud-k{flex:0 0 2.4em}
.mud-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:6px 10px;border:1px solid var(--hairline,var(--border,#ccc));border-radius:var(--radius-base,.5rem);background:var(--surface,var(--background,#fff));color:var(--text,#222);font-size:.82rem;cursor:pointer;user-select:none}
.mud-btn:active{transform:scale(.97)}
.mud-btn.on{background:var(--brand,var(--primary,#2f7bf6));border-color:var(--brand,var(--primary,#2f7bf6));color:var(--on-brand,#fff)}
.mud-btn.warn{border-color:color-mix(in oklab,var(--danger,#E25555) 55%,transparent);color:var(--danger,#E25555)}
.mud-btn[disabled]{opacity:.4;pointer-events:none}
.mud-ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:7px}
.mud-note{font-size:.72rem;color:var(--text-subtle,var(--text-light,#999));margin-top:7px}
.mud-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:.8rem}
.mud-table th{font-weight:500;color:var(--text-muted,var(--text-light,#777));text-align:right;padding:1px 4px;border-bottom:1px solid var(--hairline,var(--border,#ddd));font-size:.72rem;position:sticky;top:0;background:var(--surface,var(--background-alt,var(--background,#fff)))}
.mud-table td{text-align:right;padding:2px 4px;border-bottom:1px dashed color-mix(in oklab,var(--hairline,var(--border,#ddd)) 5%,transparent)}
.mud-table th:first-child,.mud-table td:first-child{text-align:left}
.mud-scroll{max-height:230px;overflow:auto}
.mud-cli{padding:4px 8px;border-radius:var(--radius-base,.5rem);border:1px solid color-mix(in oklab,var(--hairline,var(--border,#ddd)) 55%,transparent);margin-bottom:5px}
.mud-cli .t{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.mud-cli .s{font-size:.72rem;color:var(--text-muted,var(--text-light,#888));font-variant-numeric:tabular-nums;margin-top:1px}
.mud-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--text-subtle,#8A8F98);margin-right:6px;vertical-align:1px}
.mud-dot.on{background:var(--success,#2FBF71)}
.mud-temp{display:inline-flex;gap:5px;flex-wrap:wrap}
.mud-temp span{padding:1px 8px;border-radius:var(--radius-base,.5rem);background:var(--surface-sunken,rgba(127,127,127,.08));font-variant-numeric:tabular-nums;font-size:.76rem}
.mud-at-in{display:flex;gap:7px;margin-bottom:7px}
.mud-at-in input{flex:1;min-width:0;padding:6px 10px;border:1px solid var(--hairline,var(--border,#ccc));border-radius:var(--radius-base,.5rem);background:var(--surface,var(--background,#fff));color:var(--text,#222);font-family:var(--font-mono,monospace)}
.mud-out{font-family:var(--font-mono,monospace);font-size:.78rem;white-space:pre-wrap;background:var(--surface-sunken,rgba(127,127,127,.07));border-radius:var(--radius-base,.5rem);padding:9px;max-height:260px;overflow:auto;margin:7px 0 0}
.mud-chiprow{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.mud-chip{padding:2px 9px;border-radius:99px;border:1px solid var(--hairline,var(--border,#ccc));font-size:.72rem;font-family:var(--font-mono,monospace);cursor:pointer}
.mud-chip.on{background:var(--brand,var(--primary,#2f7bf6));border-color:var(--brand,var(--primary,#2f7bf6));color:var(--on-brand,#fff)}
.mud-sms-item{padding:6px 8px;border-radius:var(--radius-base,.5rem);border:1px solid color-mix(in oklab,var(--hairline,var(--border,#ddd)) 60%,transparent);margin-bottom:6px;cursor:pointer}
.mud-sms-item:hover{background:var(--hover-faint,rgba(127,127,127,.05))}
.mud-sms-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.mud-badge{font-size:.68rem;padding:0 7px;border-radius:99px;background:var(--brand,var(--primary,#2f7bf6));color:var(--on-brand,#fff)}
@media(max-width:600px){.mud-hero-r{text-align:left}.mud-chips{justify-content:flex-start}.mud-rsrp{font-size:1.9rem}}
`;

function injectCss() {
	if (document.getElementById('mud-style')) return;
	var st = document.createElement('style');
	st.id = 'mud-style';
	st.textContent = CSS;
	document.head.appendChild(st);
}
function v(id) { return document.getElementById('mud-' + id); }
function set(id, text, color) {
	var e = v(id);
	if (!e) return;
	e.textContent = (text == null || text === '') ? '--' : text;
	if (color !== undefined) e.style.color = color;
}
function spark(el, arr, min, max, win) {
	if (!el || !arr || arr.length < 2) return;
	var w = 100, h = 24, pts = [];
	for (var i = 0; i < arr.length; i++) {
		var x = i / (win - 1) * w;
		var y = h - Math.max(0, Math.min(1, (arr[i] - min) / (max - min || 1))) * (h - 2) - 1;
		pts.push(x.toFixed(1) + ',' + y.toFixed(1));
	}
	el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
		'<polyline points="' + pts.join(' ') + '" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>';
}

/* LuCI 的 require 把模块当类工厂：必须返回 baseclass 派生的类，加载后拿到的是它的实例 */
return baseclass.extend({
	callStatus: callStatus, callAct: callAct, callAt: callAt, callAtHist: callAtHist,
	callLockGet: callLockGet, callLockSet: callLockSet,
	callSmsList: callSmsList, callSmsShow: callSmsShow, callSmsSend: callSmsSend,
	callSmsDel: callSmsDel, callSmsSync: callSmsSync,
	carrierName: carrierName, qLabel: qLabel, qCol: qCol, qScore: qScore,
	esc: esc, fmtBytes: fmtBytes, fmtRate: fmtRate, fmtUptime: fmtUptime,
	injectCss: injectCss, v: v, set: set, spark: spark
});
