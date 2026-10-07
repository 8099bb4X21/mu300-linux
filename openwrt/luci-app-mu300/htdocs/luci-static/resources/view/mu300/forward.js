'use strict';
'require view';
'require poll';
'require mu300.common as M';

/* All destinations and rules are private to this authenticated editor. The
 * status poll never includes a URL, phone number, password or SMS body. */
var METHODS = { webhook: 'Webhook', dingtalk: '钉钉机器人', smtp: '邮件 SMTP', sms: '本机短信' };
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
	invalid_config: '配置无效', invalid_forward_config: '配置无效',
	invalid_destination: '目标地址无效', forward_storage_failed: '设备保存失败',
	sms_list_unavailable: '短信服务暂不可用', power_unavailable: '设备暂未提供有效电池状态'
};
function result(code) { return M.translate(RESULTS[code] || '暂无投递'); }
function lines(value) { return String(value || '').split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean); }
function count(value) { return lines(value).length; }
function validPhones(value, max) {
	var a = lines(value), seen = {};
	return a.length <= max && a.every(function(p) {
		var key = p.replace(/^\+/, '');
		if (!/^\+?[0-9]{3,32}$/.test(p) || seen[key]) return false;
		seen[key] = true; return true;
	});
}

return view.extend({
	load: function() { return L.resolveDefault(M.callForwardGet(), {}); },
	render: function(data) {
		M.injectCss();
		M.localizeMenu();
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = `
<style>
.mud-fwd-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.mud-fwd-grid>.mud-card,.mud-fwd-channel{min-width:0}
.mud-fwd-field{display:flex;flex-direction:column;min-width:0;gap:6px;margin:12px 0}
.mud-fwd-field>label,.mud-fwd-label{font-size:.79rem;overflow-wrap:anywhere;color:var(--text-muted,var(--text-light,#777))}
.mud .mud-fwd-field input,.mud .mud-fwd-field textarea,.mud .mud-fwd-field select{box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:38px;margin:0;border:1px solid var(--hairline,var(--border,#ccc));border-radius:var(--radius-base,.5rem);padding:8px 10px;background:var(--surface,var(--background,#fff));color:var(--text,#222);font:inherit}
.mud-fwd-field textarea{min-height:90px;resize:vertical}
.mud-fwd-toggle{display:flex;align-items:center;gap:9px;margin:10px 0;font-size:.82rem;line-height:1.45;cursor:pointer}
.mud-fwd-toggle input{accent-color:var(--brand,var(--primary,#2f7bf6))}
.mud-fwd-row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.mud-fwd-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.mud-fwd-state{font-weight:650}.mud-fwd-state.on{color:var(--success,#2fbf71)}
.mud-fwd-channel[hidden],.mud-fwd-error[hidden]{display:none}
.mud-fwd-error{color:var(--danger,#d45);margin-top:10px}
.mud-fwd-pair{display:flex;flex-wrap:wrap;align-items:flex-end;gap:0 12px}
.mud-fwd-pair>.mud-fwd-field{flex:1 1 14rem}
.mud-fwd-pair>.mud-fwd-field:last-child{flex:1 1 10rem}
@media(max-width:760px){.mud-fwd-grid{grid-template-columns:minmax(0,1fr)}.mud-fwd-pair{display:grid;grid-template-columns:minmax(0,1fr)}.mud-fwd-actions .mud-btn{flex:1}}
</style>
<div class="mud-fwd-grid">
 <section class="mud-card">
  <div class="mud-fwd-row"><h3>短信转发</h3><span class="mud-fwd-state" id="mud-fwd-state">--</span></div>
  <div class="mud-note" id="mud-fwd-last">暂无投递</div>
  <label class="mud-fwd-toggle"><input type="checkbox" id="mud-fwd-enabled">开启短信转发</label>
  <div class="mud-fwd-field"><label for="mud-fwd-method">转发方式</label>
   <select id="mud-fwd-method"><option value="webhook">Webhook</option><option value="dingtalk">钉钉机器人</option><option value="smtp">邮件 SMTP</option><option value="sms">本机短信</option></select></div>
  <div class="mud-fwd-field"><label for="mud-fwd-template_language">模板语言</label>
   <select id="mud-fwd-template_language"><option value="zh">简体中文</option><option value="en">English</option><option value="tr">Türkçe</option></select></div>
  <div class="mud-note">保存后用于转发标题、提示文字和电源通知；短信原文及设备备注保持不变。</div>
  <div class="mud-fwd-channel" data-method="webhook">
   <div class="mud-fwd-field"><label for="mud-fwd-webhook_url">HTTPS 地址</label><input id="mud-fwd-webhook_url" type="url" autocomplete="off" placeholder="https://example.com/hook"></div>
   <div class="mud-note">以固定 JSON 格式发送，不执行自定义命令。</div>
  </div>
  <div class="mud-fwd-channel" data-method="dingtalk">
   <div class="mud-fwd-field"><label for="mud-fwd-dingtalk_webhook">机器人 Webhook 地址</label><input id="mud-fwd-dingtalk_webhook" type="url" autocomplete="off" placeholder="https://oapi.dingtalk.com/robot/send?..."></div>
   <div class="mud-fwd-field"><label for="mud-fwd-dingtalk_secret">加签密钥 · 留空保留</label><input id="mud-fwd-dingtalk_secret" type="password" autocomplete="new-password"></div>
   <label class="mud-fwd-toggle"><input id="mud-fwd-clear_dingtalk_secret" type="checkbox">清除加签密钥</label>
   <label class="mud-fwd-toggle"><input id="mud-fwd-dingtalk_forward_device_info" type="checkbox">附带设备信息</label>
  </div>
  <div class="mud-fwd-channel" data-method="smtp">
   <div class="mud-fwd-pair">
    <div class="mud-fwd-field"><label for="mud-fwd-smtp_host">SMTP 服务器域名</label><input id="mud-fwd-smtp_host" autocomplete="off"></div>
    <div class="mud-fwd-field"><label for="mud-fwd-smtp_port">端口 · 465 / 587</label><select id="mud-fwd-smtp_port"><option value="465">465 TLS</option><option value="587">587 STARTTLS</option></select></div>
   </div>
   <div class="mud-fwd-field"><label for="mud-fwd-smtp_username">发件邮箱</label><input id="mud-fwd-smtp_username" type="email" autocomplete="off"></div>
   <div class="mud-fwd-field"><label for="mud-fwd-smtp_to">收件邮箱</label><input id="mud-fwd-smtp_to" type="email" autocomplete="off"></div>
   <div class="mud-fwd-field"><label for="mud-fwd-smtp_password">授权码 / 密码 · 留空保留</label><input id="mud-fwd-smtp_password" type="password" autocomplete="new-password"></div>
   <label class="mud-fwd-toggle"><input id="mud-fwd-clear_smtp_password" type="checkbox">清除邮件配置</label>
   <label class="mud-fwd-toggle"><input id="mud-fwd-smtp_forward_device_info" type="checkbox">附带设备信息</label>
   <div class="mud-note">使用邮箱提供的 SMTP 授权码；始终验证 TLS 证书。</div>
  </div>
  <div class="mud-fwd-channel" data-method="sms">
   <div class="mud-fwd-field"><label for="mud-fwd-sms_to_phone">短信接收号码 · 每行一个，最多 3 个</label><textarea id="mud-fwd-sms_to_phone" placeholder="+8613800000000"></textarea></div>
   <label class="mud-fwd-toggle"><input id="mud-fwd-sms_forward_device_info" type="checkbox">附带设备信息</label>
   <div class="mud-note">经本机 SIM 转发，可能产生短信费用；每条最多 70 个 UCS-2 单元，不限制每日转发条数。</div>
  </div>
 </section>
 <section class="mud-card">
  <h3>电源通知</h3>
  <label class="mud-fwd-toggle"><input id="mud-fwd-power_forward_enabled" type="checkbox">电源状态通知</label>
  <div class="mud-note" id="mud-fwd-power-note">充电状态变化，或电量跨过 5%、20%、40%、60%、80%、100% 时通知。</div>
  <div class="mud-note" id="mud-fwd-power-last"></div>
  <div class="mud-fwd-field"><label for="mud-fwd-nickname">设备备注</label><input id="mud-fwd-nickname" maxlength="255" autocomplete="off"></div>
  <h3 style="margin-top:22px">黑名单</h3>
  <div class="mud-fwd-field"><label for="mud-fwd-blacklist_phone">号码黑名单 · 每行一个，最多 64 个</label><textarea id="mud-fwd-blacklist_phone"></textarea></div>
  <div class="mud-fwd-field"><label for="mud-fwd-blacklist_keywords">关键词黑名单 · 每行一个，最多 32 个</label><textarea id="mud-fwd-blacklist_keywords"></textarea></div>
  <div class="mud-note">命中的新短信只记为已处理，不会转发；清空规则后不会补发。规则不影响电源通知。</div>
 </section>
</div>
<section class="mud-card" style="margin-top:14px">
 <div class="mud-fwd-row"><h3>测试与状态</h3></div>
 <div class="mud-note">设备独立执行，关闭页面仍生效；仅转发新短信，失败不自动重发。</div>
 <div class="mud-fwd-error" id="mud-fwd-error" hidden></div>
 <div class="mud-fwd-actions">
  <button class="mud-btn on" id="mud-fwd-save">保存设置</button>
  <button class="mud-btn" id="mud-fwd-test">发送测试消息</button>
  <button class="mud-btn" id="mud-fwd-refresh">刷新状态</button>
 </div>
</section>`;
		M.localize(root);
		this.root = root;
		this.data = data || {};
		this.saved = this.data.config || null;
		this.status = this.data.status || {};
		this.wire();
		if (this.saved) this.fill(this.saved);
		else this.error(this.data.error || '读取失败，请刷新页面');
		// A legacy config has no saved template language. The UI offers its
		// current locale, but it must be saved before a matching test can run.
		this.savedPayload = this.saved && this.saved.template_language ? JSON.stringify(this.payload()) : null;
		this.paintStatus();
		this.paintMethod();
		var self = this;
		poll.add(function() { return self.refreshStatus(); }, 5);
		return root;
	},
	q: function(id) { return this.root.querySelector('#mud-fwd-' + id); },
	error: function(s) {
		this.q('error').textContent = s ? M.translate(ERRORS[s] || s) : '';
		this.q('error').hidden = !s;
	},
	fill: function(c) {
		var self = this;
		[ 'enabled', 'power_forward_enabled', 'smtp_forward_device_info',
			'dingtalk_forward_device_info', 'sms_forward_device_info' ].forEach(function(k) { self.q(k).checked = !!c[k]; });
		[ 'method', 'webhook_url', 'dingtalk_webhook', 'sms_to_phone', 'blacklist_phone',
			'blacklist_keywords', 'nickname' ].forEach(function(k) { self.q(k).value = c[k] || ''; });
		this.q('template_language').value = c.template_language || M.uiLanguage();
		[ 'host', 'port', 'username', 'to' ].forEach(function(k) { self.q('smtp_' + k).value = c.smtp && c.smtp[k] || (k === 'port' ? '465' : ''); });
		[ 'smtp_password', 'dingtalk_secret' ].forEach(function(k) { self.q(k).value = ''; self.q('clear_' + k).checked = false; });
		this.q('smtp_password').placeholder = M.translate(c.smtp && c.smtp.password_configured ? '已配置，留空保留' : '请输入授权码');
		this.q('dingtalk_secret').placeholder = M.translate(c.dingtalk_secret_configured ? '已配置，留空保留' : '可选');
		this.paintMethod();
	},
	payload: function() {
		var self = this, p = {};
		[ 'enabled', 'power_forward_enabled', 'smtp_forward_device_info',
			'dingtalk_forward_device_info', 'sms_forward_device_info',
			'clear_smtp_password', 'clear_dingtalk_secret' ].forEach(function(k) { p[k] = self.q(k).checked ? 1 : 0; });
		[ 'method', 'template_language', 'webhook_url', 'dingtalk_webhook', 'dingtalk_secret', 'sms_to_phone',
			'smtp_host', 'smtp_port', 'smtp_username', 'smtp_to', 'smtp_password',
			'blacklist_phone', 'blacklist_keywords', 'nickname' ].forEach(function(k) { p[k] = self.q(k).value.trim(); });
		[ 'sms_to_phone', 'blacklist_phone', 'blacklist_keywords' ].forEach(function(k) { p[k] = lines(p[k]).join('\n'); });
		if (p.clear_smtp_password) {
			p.smtp_host = ''; p.smtp_username = ''; p.smtp_to = ''; p.smtp_password = ''; p.smtp_port = '465';
		}
		return p;
	},
	validate: function(p) {
		if (!validPhones(p.sms_to_phone, 3) || !validPhones(p.blacklist_phone, 64)) return '号码无效、重复或超过数量上限';
		var words = lines(p.blacklist_keywords);
			if (words.length > 32 || words.some(function(w) { return unescape(encodeURIComponent(w)).length > 128; }) ||
			new Set(words).size !== words.length) return '关键词无效、重复或超过数量上限';
		if (p.power_forward_enabled && !this.status.power_supported) return '设备暂未提供有效电池状态';
		if (p.enabled && ((p.method === 'webhook' && !p.webhook_url) ||
			(p.method === 'dingtalk' && !p.dingtalk_webhook) ||
			(p.method === 'sms' && !p.sms_to_phone) ||
			(p.method === 'smtp' && !p.smtp_host))) return '请先配置当前转发渠道';
		return '';
	},
	paintMethod: function() {
		var method = this.q('method').value;
		this.root.querySelectorAll('.mud-fwd-channel').forEach(function(el) { el.hidden = el.getAttribute('data-method') !== method; });
	},
	paintStatus: function() {
		var s = this.status || {};
		this.q('state').textContent = M.translate(s.enabled ? '转发已开启' : '转发未开启');
		this.q('state').classList.toggle('on', !!s.enabled);
		this.q('last').textContent = M.translate('最近转发：') + result(s.last_result);
		this.q('power-last').textContent = M.translate('最近电源通知：') + result(s.power_last_result);
		this.q('power_forward_enabled').disabled = !s.power_supported && !this.q('power_forward_enabled').checked;
		this.q('power-note').textContent = M.translate(s.power_supported ?
			'充电状态变化，或电量跨过 5%、20%、40%、60%、80%、100% 时通知。' : '设备暂未提供有效电池状态');
	},
	refreshStatus: function() {
		var self = this;
		return L.resolveDefault(M.callForwardStatus(), {}).then(function(r) {
			if (r.status) { self.status = r.status; self.paintStatus(); }
		});
	},
	wire: function() {
		var self = this;
		this.q('method').onchange = function() { self.paintMethod(); };
		this.q('save').onclick = function() {
			var p = self.payload(), error = self.validate(p);
			if (error) { self.error(error); return; }
			M.confirmBox('保存短信转发设置？', '开启后只处理新收到的短信；历史短信不会补发。', { okText: '保存' }).then(function(yes) {
				if (!yes) return;
				var btn = self.q('save'), toast = M.toast('正在保存短信转发设置…', { type: 'busy', timeout: 0 });
				M.busy(btn, true); self.error('');
				L.resolveDefault(M.callForwardSet(JSON.stringify(p)), {}).then(function(r) {
					M.busy(btn, false);
					if (!r.ok) { self.error(r.error || '保存失败'); toast.update('保存失败', 'error'); }
					else {
						self.savedPayload = null;
						L.resolveDefault(M.callForwardGet(), {}).then(function(v) {
							if (v.config) {
								self.saved = v.config;
								self.status = v.status || {};
								self.fill(v.config);
								self.savedPayload = JSON.stringify(self.payload());
								self.paintStatus();
							}
						});
						toast.update('已保存', 'success');
					}
					setTimeout(function() { toast.close(); }, 3000);
				});
			});
		};
		this.q('test').onclick = function() {
			var p = self.payload();
			if (JSON.stringify(p) !== self.savedPayload) {
				self.error('请先保存修改再测试'); return;
			}
			if (!self.status.enabled) { self.error('请先开启并保存短信转发'); return; }
			var msg = p.method === 'sms' ? '将使用本机 SIM 向已保存号码发送，可能产生短信费用。' :
				'将向当前已保存渠道发送一条固定测试消息。';
			M.confirmBox('发送测试消息？', msg, { okText: '发送' }).then(function(yes) {
				if (!yes) return;
				var btn = self.q('test'); M.busy(btn, true);
				L.resolveDefault(M.callForwardTest(), {}).then(function(r) {
					M.busy(btn, false);
					M.toast(r.ok ? '测试已开始，请稍后刷新状态' : '测试失败：' + (r.error || '未知错误'),
						{ type: r.ok ? 'success' : 'error' });
					setTimeout(function() { self.refreshStatus(); }, 1500);
				});
			});
		};
		this.q('refresh').onclick = function() { self.refreshStatus(); };
	}
});
