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
var callLockFresh = rpc.declare({ object: 'mu300dash', method: 'lock_get', params: [ 'fresh' ], expect: { '': {} } });
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
.mud-card{background:var(--surface,var(--background-alt,var(--background,#fff)));border:1px solid var(--hairline,var(--border,#e3e6ea));border-radius:calc(var(--radius-base,.5rem) + .375rem);padding:14px 16px;box-shadow:var(--app-shadow-sm,0 1px 3px rgba(0,0,0,.04));transition:border-color .15s}
.mud-card:hover{border-color:color-mix(in oklab,var(--brand,var(--primary,#2f7bf6)) 30%,var(--hairline,var(--border,#e3e6ea)))}
.mud-card>h3{margin:0 0 8px;font-size:.7rem;font-weight:600;color:var(--text-muted,var(--text-light,#787d85));letter-spacing:.08em}
.mud-card>h3::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--brand,var(--primary,#2f7bf6));margin-right:7px;vertical-align:1px}
.mud-hero{display:flex;flex-wrap:wrap;gap:12px 28px;align-items:center;background:var(--brand-subtle,var(--surface,#fff));margin-bottom:12px;padding:16px 20px}
.mud-sec{padding:2px 2px 6px}
.mud-sec>h3{margin:16px 0 10px;font-size:.7rem;font-weight:600;color:var(--text-muted,var(--text-light,#787d85));letter-spacing:.08em}
.mud-sec>h3::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--brand,var(--primary,#2f7bf6));margin-right:7px;vertical-align:1px}
.mud-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 28px}
.mud-body>.mud-sec+.mud-sec{border-top:1px dashed color-mix(in oklab,var(--hairline,var(--border,#ddd)) 60%,transparent);margin-top:14px;padding-top:2px}
/* 紧凑键值行：键与值相邻排布（不两端对齐拉开），用于驻网参照等 */
.mud-srvline{display:flex;flex-wrap:wrap;gap:4px 10px;padding:2px 0;font-size:.84rem}
.mud-srvline .k{color:var(--text-muted,var(--text-light,#777));flex:0 0 auto}
.mud-srvline .v{font-variant-numeric:tabular-nums;font-weight:500}
.mud-charts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.mud-chart{background:transparent;border-radius:var(--radius-base,.5rem);padding:2px 4px 0}
.mud-chart .t{display:flex;align-items:baseline;gap:8px}
.mud-chart .t b{font-size:1.2rem;font-weight:700;font-variant-numeric:tabular-nums}
.mud-chart .t span{font-size:.72rem;color:var(--text-muted,var(--text-light,#777))}
.mud-chart .c{height:40px;margin-top:2px}
.mud-chart .c svg{display:block;width:100%;height:100%}
.mud-lockbtn{padding:0 10px;border-radius:99px;border:1px solid var(--hairline,var(--border,#ccc));background:var(--surface,var(--background,#fff));color:var(--text,#222);font-size:.72rem;cursor:pointer;line-height:1.7}
.mud-lockbtn.on,.mud-lockbtn:active{background:var(--brand,var(--primary,#2f7bf6));border-color:var(--brand,var(--primary,#2f7bf6));color:var(--on-brand,#fff)}
.mud-lockbtn.locked{opacity:.45;pointer-events:none;background:var(--surface-sunken,rgba(127,127,127,.1));color:var(--text-muted,var(--text-light,#888));border-color:transparent}
.mud-hero-l{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:5px}
.mud-hero-r{flex:0 0 auto;text-align:right;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.mud-rat{font-size:1.7rem;font-weight:700;line-height:1.1;letter-spacing:.01em}
.mud-op{color:var(--text-muted,var(--text-light,#777));font-size:.85rem}
.mud-cellline{font-size:.78rem;color:var(--text-muted,var(--text-light,#777));font-variant-numeric:tabular-nums;line-height:1.55}
.mud-rsrp{font-size:2.3rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.mud-rsrp small{font-size:.9rem;font-weight:500}
.mud-chips{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.mud-tag{display:inline-block;padding:1px 8px;border-radius:99px;background:var(--surface-sunken,rgba(127,127,127,.1));font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums}
.mud-q{display:inline-block;min-width:3em;padding:1px 8px;border-radius:99px;font-size:.74rem;font-weight:600;text-align:center}
.mud-rows{display:grid;gap:2px}
.mud-r{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed color-mix(in oklab,var(--hairline,var(--border,#ddd)) 55%,transparent)}
.mud-r:last-child{border-bottom:none}
.mud-k{color:var(--text-muted,var(--text-light,#777));flex:0 0 auto}
.mud-v{font-variant-numeric:tabular-nums;text-align:right;word-break:break-all;font-weight:500}
.mud-bars{display:inline-flex;align-items:flex-end;gap:2px;height:16px;margin-left:8px;vertical-align:baseline}
.mud-bars i{width:3px;border-radius:1px;background:var(--hairline,var(--border,#ccc))}
.mud-bars i.on{background:currentColor}
.mud-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(122px,1fr));gap:10px;margin-bottom:10px}
.mud-kpi{background:var(--surface-sunken,rgba(127,127,127,.06));border-radius:var(--radius-base,.5rem);padding:9px 12px}
.mud-kpi b{display:block;font-size:1.05rem;font-variant-numeric:tabular-nums;font-weight:700;line-height:1.25}
.mud-kpi span{font-size:.68rem;color:var(--text-muted,var(--text-light,#777))}
.mud-sub{font-size:.68rem;color:var(--text-muted,var(--text-light,#777));font-variant-numeric:tabular-nums;margin-top:3px}
.mud-meter{height:5px;border-radius:3px;background:var(--surface-sunken,rgba(127,127,127,.15));overflow:hidden;margin:3px 0 1px}
.mud-meter i{display:block;height:100%;border-radius:3px}
.mud-freq{display:flex;align-items:center;font-size:.76rem;font-variant-numeric:tabular-nums;padding:1px 0}
.mud-freq .mud-k{flex:0 0 2.4em}
.mud-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;border:1px solid var(--hairline,var(--border,#ccc));border-radius:var(--radius-base,.5rem);background:var(--surface,var(--background,#fff));color:var(--text,#222);font-size:.82rem;cursor:pointer;user-select:none}
.mud-btn:active{transform:scale(.97)}
.mud-btn.on{background:var(--brand,var(--primary,#2f7bf6));border-color:var(--brand,var(--primary,#2f7bf6));color:var(--on-brand,#fff)}
.mud-btn.warn{border-color:color-mix(in oklab,var(--danger,#E25555) 55%,transparent);color:var(--danger,#E25555)}
.mud-btn[disabled]{opacity:.4;pointer-events:none}
.mud-ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:7px}
.mud-note{font-size:.72rem;color:var(--text-subtle,var(--text-light,#999));margin-top:7px}
.mud-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:.8rem}
.mud-table th{font-weight:500;color:var(--text-muted,var(--text-light,#777));text-align:right;padding:1px 4px;border-bottom:1px solid var(--hairline,var(--border,#ddd));font-size:.72rem;position:sticky;top:0;background:var(--surface,var(--background-alt,var(--background,#fff)))}
.mud-table td{text-align:right;padding:3px 6px;border-bottom:1px dashed color-mix(in oklab,var(--hairline,var(--border,#ddd)) 5%,transparent)}
.mud-table th:first-child,.mud-table td:first-child{text-align:left}
.mud-scroll{max-height:230px;overflow:auto;border:1px solid color-mix(in oklab,var(--hairline,var(--border,#ddd)) 45%,transparent);border-radius:var(--radius-base,.5rem);padding:4px}
.mud-cli{padding:4px 8px;border-radius:var(--radius-base,.5rem);border:1px solid color-mix(in oklab,var(--hairline,var(--border,#ddd)) 55%,transparent);margin-bottom:5px}
.mud-cli .t{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.mud-cli .s{font-size:.72rem;color:var(--text-muted,var(--text-light,#888));font-variant-numeric:tabular-nums;margin-top:1px}
/* ---- 聊天式短信 ---- */
.mud-chat{display:flex;gap:12px;min-height:420px}
.mud-convs{flex:0 0 240px;overflow:auto;max-height:520px}
.mud-conv{padding:7px 9px;border-radius:var(--radius-base,.5rem);cursor:pointer;margin-bottom:4px;border:1px solid transparent}
.mud-conv:hover{background:var(--hover-faint,rgba(127,127,127,.06))}
.mud-conv.sel{background:var(--brand-subtle,var(--surface-sunken,rgba(127,127,127,.08)));border-color:color-mix(in oklab,var(--brand,var(--primary,#2f7bf6)) 30%,transparent)}
.mud-conv .n{display:flex;justify-content:space-between;gap:6px;font-weight:600;font-size:.84rem}
.mud-conv .p{font-size:.74rem;color:var(--text-muted,var(--text-light,#888));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.mud-thread{flex:1;display:flex;flex-direction:column;min-width:0;border-left:1px solid var(--hairline,var(--border,#ddd));padding-left:12px}
.mud-msgs{flex:1;overflow:auto;max-height:460px;padding:4px 2px;display:flex;flex-direction:column;gap:6px}
.mud-bub{max-width:78%;padding:6px 11px;border-radius:calc(var(--radius-base,.5rem) + .25rem);font-size:.85rem;white-space:pre-wrap;word-break:break-word;align-self:flex-start;background:var(--surface-sunken,rgba(127,127,127,.08))}
.mud-bub.out{align-self:flex-end;background:var(--brand,var(--primary,#2f7bf6));color:var(--on-brand,#fff)}
.mud-bub .tm{display:block;font-size:.64rem;opacity:.65;margin-top:2px;text-align:right;font-variant-numeric:tabular-nums}
.mud-comp{display:flex;gap:8px;margin-top:8px}
.mud-comp input,.mud-comp textarea{padding:7px 11px;border:1px solid var(--hairline,var(--border,#ccc));border-radius:var(--radius-base,.5rem);background:var(--surface,var(--background,#fff));color:var(--text,#222);font-family:inherit}
.mud-comp input{flex:0 0 170px}
.mud-comp textarea{flex:1;resize:none;min-height:40px;max-height:120px}
@media(max-width:700px){.mud-chat{flex-direction:column}.mud-convs{flex:none;max-height:150px}.mud-thread{border-left:none;padding-left:0;border-top:1px solid var(--hairline,var(--border,#ddd));padding-top:8px}}
/* ---- 专业 AT 终端 ---- */
.mud-at-grid{display:grid;grid-template-columns:1fr 220px;gap:10px}
.mud-at-grid .mud-scroll{max-height:340px}
@media(max-width:700px){.mud-at-grid{grid-template-columns:1fr}.mud-term{height:300px}.mud-at-grid .mud-scroll{max-height:120px}}
.mud-term{font-family:var(--font-mono,monospace);font-size:.8rem;line-height:1.5;background:color-mix(in oklab,var(--surface,#14161a) 92%,var(--brand,#2f7bf6) 3%);color:var(--text,#d5d9de);border:1px solid var(--hairline,var(--border,#2a2d33));border-radius:var(--radius-base,.5rem);padding:12px;height:380px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.mud-term .ln-cmd{color:var(--brand,#6ab0ff);font-weight:600}
.mud-term .ln-ok{color:var(--success,#57c98a);font-weight:600}
.mud-term .ln-err{color:var(--danger,#ff7b72);font-weight:600}
.mud-term .ln-data{color:var(--text,#d5d9de)}
.mud-term .ln-meta{color:var(--text-subtle,#7d8590);font-style:italic}
.mud-term .ln-ms{float:right;color:var(--text-subtle,#7d8590);font-size:.7rem}
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
	var w = 100, h = 34, pts = [];
	for (var i = 0; i < arr.length; i++) {
		pts.push([ i / (win - 1) * w,
			h - Math.max(0, Math.min(1, (arr[i] - min) / (max - min || 1))) * (h - 3) - 1.5 ]);
	}
	/* Catmull-Rom 转三次贝塞尔：折线变平滑曲线 */
	var d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
	for (var i = 0; i < pts.length - 1; i++) {
		var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
		d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ',' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
			' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ',' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
			' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
	}
	var last = pts.length - 1;
	var area = d + ' L' + pts[last][0].toFixed(1) + ',' + h + ' L' + pts[0][0].toFixed(1) + ',' + h + ' Z';
	var gid = 'mudg-' + (el.id || Math.floor(Math.random() * 1e6));
	el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
		'<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
		'<stop offset="0" stop-color="currentColor" stop-opacity=".32"/>' +
		'<stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
		'<path d="' + area + '" fill="url(#' + gid + ')"/>' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
}

/* 邻区表（主页与网络锁定页共用）：NR 置顶按 RSRP 排序，行尾带锁定按钮。
 * lockedCell 是 lock_get 的 cell 字段（如 "nr:627264,501"），命中行显示灰色"已锁定"。
 * 点击事件由页面用事件委托绑定（[data-lock] 属性："<rat>:<arfcn>,<pci>"）。 */
function neighborRows(c, lockedCell) {
	var nb = (c && c.neigh) || [];
	nb.sort(function(a, b) {
		if ((a.rat == 'nr') != (b.rat == 'nr')) return a.rat == 'nr' ? -1 : 1;
		return (b.rsrp || -999) - (a.rsrp || -999);
	});
	if (!nb.length)
		return '<tr><td colspan="7" style="color:var(--text-muted,var(--text-light,#777))">暂无邻区数据</td></tr>';
	var lk = lockedCell || '';
	return nb.map(function(n) {
		var l = qLabel(n.rsrp, n.rsrq, n.sinr);
		var key = n.rat + ':' + n.arfcn + ',' + n.pci;
		var isLocked = (lk == key);
		return '<tr><td>' + (n.rat == 'nr' ? 'NR n' + esc(n.band) : 'LTE B' + esc(n.band)) + '</td>' +
			'<td>' + esc(n.pci != null ? n.pci : '--') + '</td>' +
			'<td>' + esc(n.arfcn != null ? n.arfcn : '--') + '</td>' +
			'<td style="color:' + qCol(l) + '">' + (n.rsrp != null ? n.rsrp.toFixed(1) : '--') + '</td>' +
			'<td>' + (n.rsrq != null ? n.rsrq.toFixed(1) : '--') + '</td>' +
			'<td>' + (n.sinr != null ? n.sinr.toFixed(1) : '--') + '</td>' +
			'<td><button class="mud-lockbtn' + (isLocked ? ' locked' : '') + '" data-lock="' + key + '"' +
			(isLocked ? ' disabled' : '') + '>' + (isLocked ? '已锁定' : '锁定') + '</button></td></tr>';
	}).join('');
}

/* LuCI 的 require 把模块当类工厂：必须返回 baseclass 派生的类，加载后拿到的是它的实例 */
return baseclass.extend({
	callStatus: callStatus, callAct: callAct, callAt: callAt, callAtHist: callAtHist,
	callLockGet: callLockGet, callLockFresh: callLockFresh, callLockSet: callLockSet,
	callSmsList: callSmsList, callSmsShow: callSmsShow, callSmsSend: callSmsSend,
	callSmsDel: callSmsDel, callSmsSync: callSmsSync,
	carrierName: carrierName, qLabel: qLabel, qCol: qCol, qScore: qScore,
	esc: esc, fmtBytes: fmtBytes, fmtRate: fmtRate, fmtUptime: fmtUptime,
	injectCss: injectCss, v: v, set: set, spark: spark, neighborRows: neighborRows
});
