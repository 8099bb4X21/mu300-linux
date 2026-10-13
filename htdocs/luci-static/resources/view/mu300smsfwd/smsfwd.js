'use strict';
'require view';
'require poll';
'require mu300.common as M';

/* Sidecar forwarding: same four channels as the built-in page, plus an
 * own-number whitelist, content keyword lists and regex rewriting.
 * Status polls never include a URL, number, password or SMS body; the
 * list editor loads the plain lists only while this page is open. */
var METHODS = { webhook: 'Webhook', dingtalk: '钉钉机器人', wecom: '企业微信群', smtp: '邮件 SMTP', sms: '本机短信' };
var RESULTS = {
	idle: '暂无投递', sent: '发送成功', disabled: '转发未开启',
	self_forward_blocked: '已拦截向原发件人转发',
	message_too_long: '短信过长，未发送', storage_failed: '设备保存失败',
	source_unavailable: '短信服务暂不可用', power_unavailable: '设备暂未提供有效电池状态',
	invalid_config: '配置无效', invalid_forward_config: '配置无效',
	invalid_destination: '目标地址无效', delivery_failed: '投递失败，请检查配置和设备网络',
	smtp_auth_failed: '邮箱服务器拒绝登录，请检查授权码'
};
var ERRORS = {
	forward_busy: '转发正在执行，请稍后再试', disabled: '转发未开启',
	invalid_config: '配置无效', invalid_forward_config: '配置无效',
	invalid_destination: '目标地址无效', forward_storage_failed: '设备保存失败',
	sms_list_unavailable: '短信服务暂不可用', power_unavailable: '设备暂未提供有效电池状态'
};
var callGet = rpc.declare({ object: 'mu300smsfwd', method: 'get', expect: { '': {} } });
var callStatus = rpc.declare({ object: 'mu300smsfwd', method: 'status', expect: { '': {} } });
var callSet = rpc.declare({ object: 'mu300smsfwd', method: 'set', params: [ 'payload' ], expect: { '': {} } });
var callTest = rpc.declare({ object: 'mu300smsfwd', method: 'test', expect: { '': {} } });
var callListsGet = rpc.declare({ object: 'mu300smsfwd', method: 'lists_get', expect: { '': {} } });
var callListsSet = rpc.declare({ object: 'mu300smsfwd', method: 'lists_set', params: [ 'payload' ], expect: { '': {} } });
function result(code) { return M.translate(RESULTS[code] || '暂无投递'); }
function lines(value) { return String(value || '').split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean); }
function preset(name) {
	var title = M.translate('短信') + ' {from}', content = '{text}\n{time} · {sim} · {device}';
	var presets = {
		json: ['https://example.com/sms', { from: '{from}', text: '{text}', time: '{time}', sim: '{sim}', device: '{device}' }],
		bark: ['https://api.day.app/push', { device_key: 'YOUR_KEY', title: title, body: content, group: 'MU300' }],
		pushplus: ['https://www.pushplus.plus/send', { token: 'YOUR_TOKEN', title: title, content: content, template: 'txt' }],
		serverchan: ['https://sctapi.ftqq.com/YOUR_SENDKEY.send', 'title={from}&desp={text}%0A{time}%20{sim}'],
		telegram: ['https://api.telegram.org/botYOUR_TOKEN/sendMessage', { chat_id: 'YOUR_CHAT_ID', text: title + '\n' + content }],
		wecom: ['https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY', { msgtype: 'text', text: { content: title + '\n' + content } }],
		dingtalk: ['https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN', { msgtype: 'text', text: { content: title + '\n' + content } }]
	};
	return presets[name];
}
function validPhones(value, max) {
	var a = lines(value), seen = {};
	return a.length <= max && a.every(function(p) {
		var key = p.replace(/^\+/, '');
		if (!/^\+?[0-9]{3,32}$/.test(p) || seen[key]) return false;
		seen[key] = true; return true;
	});
}

return view.extend({
	load: function() {
		return L.resolveDefault(callGet(), {}).then(function(g) {
			return L.resolveDefault(callListsGet(), {}).then(function(l) {
				return { get: g, lists: l };
			});
		});
	},
	render: function(data) {
		M.injectCss();
		M.localizeMenu();
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = `
<style>
.msf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.msf-grid>.mud-card,.msf-channel{min-width:0}
.msf-field{display:flex;flex-direction:column;min-width:0;gap:6px;margin:12px 0}
.msf-field>label,.msf-label{font-size:.79rem;overflow-wrap:anywhere;color:var(--text-muted,var(--text-light,#777))}
.mud .msf-field input,.mud .msf-field textarea,.mud .msf-field select{box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:38px;margin:0;border:1px solid var(--hairline,var(--border,#ccc));border-radius:var(--radius-base,.5rem);padding:8px 10px;background:var(--surface,var(--background,#fff));color:var(--text,#222);font:inherit}
.msf-field textarea{min-height:90px;resize:vertical}
.msf-toggle{display:flex;align-items:center;gap:9px;margin:10px 0;font-size:.82rem;line-height:1.45;cursor:pointer}
.msf-toggle input{accent-color:var(--brand,var(--primary,#2f7bf6))}
.msf-row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.msf-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.msf-state{font-weight:650}.msf-state.on{color:var(--success,#2fbf71)}
.msf-channel[hidden],.msf-error[hidden]{display:none}
.msf-error{color:var(--danger,#d45);margin-top:10px}
.msf-pair{display:flex;flex-wrap:wrap;align-items:flex-end;gap:0 12px}
.msf-pair>.msf-field{flex:1 1 14rem}
.msf-pair>.msf-field:last-child{flex:1 1 10rem}
.msf-history{max-height:20rem;overflow:auto;overscroll-behavior:contain;margin-top:12px}
.msf-event{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(6rem,1fr) minmax(0,2fr);gap:8px;padding:10px 0;border-bottom:1px solid var(--hairline,var(--border,#8883));font-size:.82rem;overflow-wrap:anywhere}
@media(max-width:480px){.msf-event{grid-template-columns:1fr 1fr}.msf-event>:last-child{grid-column:1/-1}}
@media(max-width:760px){.msf-grid{grid-template-columns:minmax(0,1fr)}.msf-pair{display:grid;grid-template-columns:minmax(0,1fr)}.msf-actions .mud-btn{flex:1}}
</style>
<section class="mud-card" style="margin-bottom:14px">
 <h3>旁挂转发状态</h3>
 <div class="mud-note">本包独立运行，安装时已停用内置短信转发；卸载后自动恢复。本机号取自 AT+CNUM，读不到时默认不转发。</div>
 <div class="msf-row"><span class="msf-state" id="msf-state">--</span><span class="mud-note" id="msf-msisdn">本机号：--</span></div>
 <div class="mud-note" id="msf-last">暂无投递</div>
 <div class="mud-note" id="msf-lists-note"></div>
</section>
<div class="msf-grid">
 <section class="mud-card">
  <div class="msf-row"><h3>短信转发</h3></div>
  <label class="msf-toggle"><input type="checkbox" id="msf-enabled">启用转发</label>
  <div class="msf-field"><label for="msf-method">转发方式</label>
   <select id="msf-method"><option value="webhook">Webhook</option><option value="dingtalk">钉钉机器人</option><option value="wecom">企业微信群</option><option value="smtp">邮件 SMTP</option><option value="sms">本机短信</option></select></div>
  <div class="msf-field"><label for="msf-template_language">模板语言</label>
   <select id="msf-template_language"><option value="zh">简体中文</option><option value="en">English</option><option value="tr">Türkçe</option></select></div>
  <div class="mud-note">保存后用于转发标题、提示文字和电源通知；短信原文及设备备注保持不变。</div>
  <div class="msf-channel" data-method="webhook">
   <div class="msf-field"><label for="msf-webhook_url">HTTPS 地址</label><input id="msf-webhook_url" type="url" autocomplete="off" placeholder="https://example.com/hook"></div>
   <div class="msf-field"><label for="msf-preset">填入推送预设</label><select id="msf-preset"><option value="">自定义</option><option value="json">JSON Webhook</option><option value="bark">Bark</option><option value="pushplus">PushPlus</option><option value="serverchan">ServerChan</option><option value="telegram">Telegram</option><option value="wecom">企业微信</option><option value="dingtalk">钉钉 Webhook</option></select></div>
   <div class="mud-note">预设只填入表单，请替换密钥后保存；需要钉钉加签时请选择“钉钉机器人”。</div>
   <div class="msf-pair">
    <div class="msf-field"><label for="msf-webhook_method">请求方法</label><select id="msf-webhook_method"><option>POST</option><option>GET</option></select></div>
    <div class="msf-field"><label for="msf-webhook_timeout">请求超时（秒，1–120）</label><input type="number" min="1" max="120" step="1" id="msf-webhook_timeout"></div>
   </div>
   <div class="msf-field"><label for="msf-webhook_content_type">正文格式</label><select id="msf-webhook_content_type"><option value="application/json">JSON</option><option value="application/x-www-form-urlencoded">Form URL-encoded</option><option value="text/plain">纯文本</option></select></div>
   <div class="msf-field"><label for="msf-webhook_body">正文模板</label><textarea rows="6" id="msf-webhook_body" spellcheck="false"></textarea></div>
   <div class="mud-note">占位符：{from}、{text}、{time}、{sim}、{device}、{kind}。JSON 占位符放在字符串内；按格式自动转义，绝不执行命令。</div>
   <div class="mud-note">GET 只发送 URL 参数；JSON 模板留空时沿用旧版 from/text/date 格式。仅支持公网 HTTPS，验证证书且不跟随重定向。Webhook 收到的原文不受正则改写影响。</div>
   <div class="msf-field"><label for="msf-webhook_headers">附加请求头（每行 Name: value）</label><textarea rows="3" id="msf-webhook_headers" autocomplete="off" spellcheck="false"></textarea></div>
  </div>
  <div class="msf-channel" data-method="dingtalk">
   <div class="msf-field"><label for="msf-dingtalk_webhook">机器人 Webhook 地址</label><input id="msf-dingtalk_webhook" type="url" autocomplete="off" placeholder="https://oapi.dingtalk.com/robot/send?..."></div>
   <div class="msf-field"><label for="msf-dingtalk_secret">加签密钥 · 留空保留</label><input id="msf-dingtalk_secret" type="password" autocomplete="new-password"></div>
   <label class="msf-toggle"><input id="msf-clear_dingtalk_secret" type="checkbox">清除加签密钥</label>
   <label class="msf-toggle"><input id="msf-dingtalk_forward_device_info" type="checkbox">附带设备信息</label>
  </div>
  <div class="msf-channel" data-method="wecom">
   <div class="msf-field"><label for="msf-wecom_key">群机器人 Key · 留空保留</label><input id="msf-wecom_key" type="password" autocomplete="new-password" placeholder="send?key= 后面的那串"></div>
   <label class="msf-toggle"><input id="msf-clear_wecom_key" type="checkbox">清除 Key</label>
   <label class="msf-toggle"><input id="msf-wecom_forward_device_info" type="checkbox">附带设备信息</label>
   <div class="mud-note">只发文本消息（最长 2048 字节），服务端返回 errcode 0 才算成功；每分钟最多 20 条。</div>
  </div>
  <div class="msf-channel" data-method="smtp">
   <div class="msf-pair">
    <div class="msf-field"><label for="msf-smtp_host">SMTP 服务器域名</label><input id="msf-smtp_host" autocomplete="off"></div>
    <div class="msf-field"><label for="msf-smtp_port">端口 · 465 / 587</label><select id="msf-smtp_port"><option value="465">465 TLS</option><option value="587">587 STARTTLS</option></select></div>
   </div>
   <div class="msf-field"><label for="msf-smtp_username">发件邮箱</label><input id="msf-smtp_username" type="email" autocomplete="off"></div>
   <div class="msf-field"><label for="msf-smtp_to">收件邮箱</label><input id="msf-smtp_to" type="email" autocomplete="off"></div>
   <div class="msf-field"><label for="msf-smtp_password">授权码 / 密码 · 留空保留</label><input id="msf-smtp_password" type="password" autocomplete="new-password"></div>
   <label class="msf-toggle"><input id="msf-clear_smtp_password" type="checkbox">清除邮件配置</label>
   <label class="msf-toggle"><input id="msf-smtp_forward_device_info" type="checkbox">附带设备信息</label>
   <div class="mud-note">使用邮箱提供的 SMTP 授权码；始终验证 TLS 证书。</div>
  </div>
  <div class="msf-channel" data-method="sms">
   <div class="msf-field"><label for="msf-sms_to_phone">短信接收号码 · 每行一个，最多 3 个</label><textarea id="msf-sms_to_phone" placeholder="+8613800000000"></textarea></div>
   <label class="msf-toggle"><input id="msf-sms_forward_device_info" type="checkbox">附带设备信息</label>
   <div class="mud-note">经本机 SIM 转发，可能产生短信费用；每条最多 70 个 UCS-2 单元，不限制每日转发条数。</div>
  </div>
 </section>
 <section class="mud-card">
  <h3>筛选名单</h3>
  <div class="mud-note">白名单关键词命中即转发（最高优先级）；否则本机号必须在白名单；再命中黑名单关键词则不转。关键词均为正则（支持 (?i)/(?s)/前瞻）。改写只作用正文，通用 Webhook 收原文。</div>
  <div class="msf-field"><label for="msf-whitelist">白名单（本机卡号）· 每行一个</label><textarea id="msf-whitelist" placeholder="18566098412"></textarea></div>
  <div class="msf-field"><label for="msf-keywords">白名单关键词（正则，命中即转发）</label><textarea id="msf-keywords" placeholder="(?i)验证码|动态密码"></textarea></div>
  <div class="msf-field"><label for="msf-blacklist">黑名单关键词（正则，命中则不转发）</label><textarea id="msf-blacklist" placeholder="(?i)广告|推销"></textarea></div>
  <div class="msf-field"><label for="msf-regex">正则改写（pattern===replacement，顺序执行）</label><textarea id="msf-regex" placeholder="验证码.{0,4}(\d{4,8})===验证码：$1"></textarea></div>
   <div class="mud-note">改写作用于短信正文本身（各渠道通用），不改发件人/时间/设备信息、测试与电源消息。</div>
  <h3 style="margin-top:22px">电源通知与备注</h3>
  <label class="msf-toggle"><input id="msf-power_forward_enabled" type="checkbox">电源状态通知</label>
  <div class="mud-note" id="msf-power-note">充电状态变化，或电量跨过 5%、20%、40%、60%、80%、100% 时通知。</div>
  <div class="mud-note" id="msf-power-last"></div>
  <div class="msf-field"><label for="msf-nickname">设备备注</label><input id="msf-nickname" maxlength="255" autocomplete="off"></div>
 </section>
</div>
<section class="mud-card" style="margin-top:14px">
 <div class="msf-row"><h3>测试与状态</h3></div>
 <div class="mud-note">设备独立执行，关闭页面仍生效；仅转发新短信，失败不自动重发。</div>
 <h3 style="margin-top:16px">最近投递记录</h3>
 <div class="mud-note">仅保留本次开机最近 30 次投递结果，不记录号码、地址或短信内容。</div>
 <div class="msf-history" id="msf-history" tabindex="0"></div>
 <div class="msf-error" id="msf-error" hidden></div>
 <div class="msf-actions">
  <button class="mud-btn on" id="msf-save">保存设置</button>
  <button class="mud-btn" id="msf-test">发送测试消息</button>
  <button class="mud-btn" id="msf-refresh">刷新状态</button>
 </div>
</section>`;
		M.localize(root);
		this.root = root;
		this.data = (data && data.get) || {};
		this.lists = (data && data.lists) || {};
		this.saved = this.data.config || null;
		this.status = this.data.status || {};
		this.counts = this.data.lists || {};
		this.wire();
		if (this.saved) { this.fill(this.saved); this.fillLists(this.lists); }
		else this.error(this.data.error || '读取失败，请刷新页面');
		this.savedPayload = this.saved ? JSON.stringify(this.payload()) : null;
		this.savedLists = JSON.stringify(this.listsPayload());
		this.paintStatus();
		this.paintMethod();
		var self = this;
		this._refresh = function() {
			if (document.hidden || !root.isConnected) return Promise.resolve();
			return self.refreshStatus();
		};
		poll.add(this._refresh, 5);
		return root;
	},
	q: function(id) { return this.root.querySelector('#msf-' + id); },
	error: function(s) {
		this.q('error').textContent = s ? M.translate(ERRORS[s] || s) : '';
		this.q('error').hidden = !s;
	},
	fill: function(c) {
		var self = this;
		[ 'enabled', 'power_forward_enabled', 'smtp_forward_device_info',
			'dingtalk_forward_device_info', 'wecom_forward_device_info', 'sms_forward_device_info' ].forEach(function(k) { self.q(k).checked = !!c[k]; });
		[ 'method', 'webhook_url', 'dingtalk_webhook', 'sms_to_phone', 'nickname' ].forEach(function(k) { self.q(k).value = c[k] || ''; });
		this.q('method').value = c.method || 'webhook';
		this.q('webhook_method').value = c.webhook_method || 'POST';
		this.q('webhook_content_type').value = c.webhook_content_type || 'application/json';
		this.q('webhook_timeout').value = c.webhook_timeout || 12;
		this.q('webhook_body').value = c.webhook_body || '';
		this.q('webhook_headers').value = c.webhook_headers || '';
		this.q('preset').value = '';
		this.q('template_language').value = c.template_language || M.uiLanguage();
		[ 'host', 'port', 'username', 'to' ].forEach(function(k) { self.q('smtp_' + k).value = c.smtp && c.smtp[k] || (k === 'port' ? '465' : ''); });
		[ 'smtp_password', 'dingtalk_secret', 'wecom_key' ].forEach(function(k) { self.q(k).value = ''; self.q('clear_' + k).checked = false; });
		this.q('smtp_password').placeholder = M.translate(c.smtp && c.smtp.password_configured ? '已配置，留空保留' : '请输入授权码');
		this.q('dingtalk_secret').placeholder = M.translate(c.dingtalk_secret_configured ? '已配置，留空保留' : '可选');
		this.q('wecom_key').placeholder = M.translate(c.wecom_key_configured ? '已配置，留空保留' : '请输入 Key');
		this.paintMethod();
	},
	fillLists: function(l) {
		[ 'whitelist', 'keywords', 'blacklist', 'regex' ].forEach(function(k) {
			var el = document.querySelector('#msf-' + k);
			if (el) el.value = l[k] || '';
		});
	},
	payload: function() {
		var self = this, p = {};
		[ 'enabled', 'power_forward_enabled', 'smtp_forward_device_info',
			'dingtalk_forward_device_info', 'wecom_forward_device_info', 'sms_forward_device_info',
			'clear_smtp_password', 'clear_dingtalk_secret', 'clear_wecom_key' ].forEach(function(k) { p[k] = self.q(k).checked ? 1 : 0; });
		[ 'method', 'template_language', 'webhook_url', 'dingtalk_webhook', 'dingtalk_secret', 'wecom_key', 'sms_to_phone',
			'smtp_host', 'smtp_port', 'smtp_username', 'smtp_to', 'smtp_password', 'nickname' ].forEach(function(k) { p[k] = self.q(k).value.trim(); });
		[ 'sms_to_phone' ].forEach(function(k) { p[k] = lines(p[k]).join('\n'); });
		[ 'webhook_method', 'webhook_content_type', 'webhook_timeout', 'webhook_headers', 'webhook_body' ].forEach(function(k) { p[k] = self.q(k).value; });
		if (p.clear_smtp_password) {
			p.smtp_host = ''; p.smtp_username = ''; p.smtp_to = ''; p.smtp_password = ''; p.smtp_port = '465';
		}
		return p;
	},
	listsPayload: function() {
		var l = {}, self = this;
		[ 'whitelist', 'keywords', 'blacklist', 'regex' ].forEach(function(k) { l[k] = self.q(k).value.replace(/\r\n/g, '\n'); });
		return l;
	},
	validate: function(p, l) {
		if (!validPhones(p.sms_to_phone, 3)) return '号码无效、重复或超过数量上限';
		if (p.power_forward_enabled && !this.status.power_supported) return '设备暂未提供有效电池状态';
		if (!/^\d+$/.test(p.webhook_timeout) || +p.webhook_timeout < 1 || +p.webhook_timeout > 120) return '请求超时必须为 1–120 秒';
		if (p.webhook_body && p.webhook_content_type === 'application/json') {
			try { JSON.parse(p.webhook_body); } catch (e) { return '正文模板必须是有效 JSON'; }
		}
		var hasWecom = p.wecom_key || ((this.saved && this.saved.wecom_key_configured) && !p.clear_wecom_key);
		if (p.wecom_key && !/^[A-Za-z0-9_-]{1,128}$/.test(p.wecom_key)) return '企业微信 Key 格式无效';
		if (p.enabled && ((p.method === 'webhook' && !p.webhook_url) ||
			(p.method === 'dingtalk' && !p.dingtalk_webhook) ||
			(p.method === 'wecom' && !hasWecom) ||
			(p.method === 'sms' && !p.sms_to_phone) ||
			(p.method === 'smtp' && !p.smtp_host))) return '请先配置当前转发渠道';
		var total = ['whitelist', 'keywords', 'blacklist', 'regex'].reduce(function(n, k) { return n + (l[k] || '').length; }, 0);
		if (total > 4 * 32768) return '名单内容过长';
		return '';
	},
	paintMethod: function() {
		var method = this.q('method').value;
		this.root.querySelectorAll('.msf-channel').forEach(function(el) { el.hidden = el.getAttribute('data-method') !== method; });
		this.q('webhook_body').disabled = this.q('webhook_method').value === 'GET';
	},
	paintStatus: function() {
		var s = this.status || {};
		this.q('state').textContent = M.translate(s.enabled ? '转发已开启' : '转发未开启');
		this.q('state').classList.toggle('on', !!s.enabled);
		this.q('last').textContent = M.translate('最近转发：') + result(s.last_result);
		this.q('power-last').textContent = M.translate('最近电源通知：') + result(s.power_last_result);
		this.q('msisdn').textContent = M.translate('本机号：') + (this.msisdn || M.translate('(未读到)'));
		var c = this.counts || {};
		this.q('lists-note').textContent = M.translate('名单行数：白名单 ') + (c.whitelist || 0) + ' · ' + M.translate('白名单关键词 ') + (c.keywords || 0) + ' · ' + M.translate('黑名单 ') + (c.blacklist || 0) + ' · ' + M.translate('改写 ') + (c.regex || 0);
		var history = this.q('history');
		history.replaceChildren();
		(s.history || []).slice(0, 30).forEach(function(item) {
			var row = document.createElement('div'); row.className = 'msf-event';
			var kind = { sms: '短信', power: '电源通知', test: '测试消息' }[item.kind] || '短信';
			[new Date(Number(item.time) * 1000).toLocaleString(), M.translate(kind) + ' · ' + M.translate(METHODS[item.method] || '未知'), result(item.result) + (item.http_code ? ' · HTTP ' + item.http_code : '')].forEach(function(value) {
				var el = document.createElement('span'); el.textContent = value; row.appendChild(el);
			});
			history.appendChild(row);
		});
		if (!history.childNodes.length) history.textContent = M.translate('暂无投递');
		this.q('power_forward_enabled').disabled = !s.power_supported && !this.q('power_forward_enabled').checked;
		this.q('power-note').textContent = M.translate(s.power_supported ?
			'充电状态变化，或电量跨过 5%、20%、40%、60%、80%、100% 时通知。' : '设备暂未提供有效电池状态');
	},
	refreshStatus: function() {
		var self = this;
		if (this._inflight) return this._inflight;
		this._inflight = L.resolveDefault(callStatus(), {}).then(function(r) {
			if (self.root.isConnected && r.status) {
				self.status = r.status; self.msisdn = r.msisdn;
				self.counts = r.lists || self.counts;
				self.paintStatus();
			}
		}).finally(function() { self._inflight = null; });
		return this._inflight;
	},
	unload: function() { poll.remove(this._refresh); },
	wire: function() {
		var self = this;
		this.msisdn = this.data.msisdn || '';
		this.q('webhook_method').onchange = function() { self.paintMethod(); };
		this.q('preset').onchange = function() {
			var p = preset(this.value); if (!p) return;
			M.confirmBox('填入推送预设？', '将替换当前 Webhook 地址、正文及请求头，保存后才会生效。', { okText: '确定' }).then(function(yes) {
				if (!yes) return;
				self.q('webhook_url').value = p[0];
				self.q('webhook_method').value = 'POST';
				self.q('webhook_content_type').value = typeof p[1] === 'string' ? 'application/x-www-form-urlencoded' : 'application/json';
				self.q('webhook_body').value = typeof p[1] === 'string' ? p[1] : JSON.stringify(p[1], null, 2);
				self.q('webhook_headers').value = ''; self.paintMethod();
			});
		};
		this.q('method').onchange = function() { self.paintMethod(); };
		this.q('save').onclick = function() {
			var p = self.payload(), l = self.listsPayload(), error = self.validate(p, l);
			if (error) { self.error(error); return; }
			M.confirmBox('保存旁挂转发设置？', '开启后只处理新收到的短信；历史短信不会补发。', { okText: '保存' }).then(function(yes) {
				if (!yes) return;
				var btn = self.q('save'), toast = M.toast('正在保存…', { type: 'busy', timeout: 0 });
				M.busy(btn, true); self.q('test').disabled = true; self.error('');
				L.resolveDefault(callSet(JSON.stringify(p)), {}).then(function(r) {
					if (!r.ok) { self.error(r.error || '保存失败'); toast.update('保存失败', 'error'); return; }
					return L.resolveDefault(callListsSet(JSON.stringify(l)), {}).then(function(r2) {
						if (!r2.ok) { self.error(r2.error || '名单保存失败'); toast.update('名单保存失败', 'error'); return; }
						self.savedPayload = null; self.savedLists = null;
						return L.resolveDefault(callGet(), {}).then(function(v) {
							if (v.config) {
								self.saved = v.config;
								self.status = v.status || {};
								self.msisdn = v.msisdn || '';
								self.fill(v.config);
								self.savedPayload = JSON.stringify(self.payload());
							}
							return L.resolveDefault(callListsGet(), {}).then(function(vl) {
								self.fillLists(vl || {});
								self.savedLists = JSON.stringify(self.listsPayload());
								self.paintStatus();
								toast.update('已保存', 'success');
							});
						});
					});
				}).finally(function() {
					M.busy(btn, false); self.q('test').disabled = false;
					setTimeout(function() { toast.close(); }, 3000);
				});
			});
		};
		this.q('test').onclick = function() {
			var p = self.payload(), l = self.listsPayload();
			if (JSON.stringify(p) !== self.savedPayload || JSON.stringify(l) !== self.savedLists) {
				self.error('请先保存修改再测试'); return;
			}
			if (!self.status.enabled) { self.error('请先开启并保存短信转发'); return; }
			var msg = p.method === 'sms' ? '将使用本机 SIM 向已保存号码发送，可能产生短信费用。' :
				'将向当前已保存渠道发送一条固定测试消息。';
			M.confirmBox('发送测试消息？', msg, { okText: '发送' }).then(function(yes) {
				if (!yes) return;
				var btn = self.q('test'); M.busy(btn, true);
				L.resolveDefault(callTest(), {}).then(function(r) {
					M.busy(btn, false);
					M.toast(r.ok ? '测试已开始，请稍后刷新状态' : M.translate('测试失败：') + M.translate(ERRORS[r.error] || '未知错误'),
						{ type: r.ok ? 'success' : 'error' });
					setTimeout(function() { self.refreshStatus(); }, 1500);
				});
			});
		};
		this.q('refresh').onclick = function() { self.refreshStatus(); };
	}
});
