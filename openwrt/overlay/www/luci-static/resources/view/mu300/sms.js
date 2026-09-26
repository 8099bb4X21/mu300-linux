'use strict';
'require view';
'require mu300.common as M';

/* 短信 -- 收发都在设备本地的短信池（/etc/mu300/sms，mu300-smsd 常驻与 SIM 同步）。
 * 页面只与池子打交道：列表/查看是纯文件读（快），发送/同步走 rpcd -> mu300-sms
 * （后者经 mu300-at 排队，不干扰拨号）。列表格式：
 *   pool: 3 message(s), 1 unread - page 1/1 (10 per page)
 *   000007  read    mt  +8613800138000  26/09/26 12:34:56  preview... */

return view.extend({
	load: function() { return Promise.resolve(); },

	render: function() {
		M.injectCss();
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = `
<div class="mud-grid">
  <div class="mud-card">
    <h3>发送短信</h3>
    <div class="mud-at-in">
      <input id="mud-sms-num" placeholder="号码，如 10086 或 +86..." style="max-width:180px" spellcheck="false"/>
      <input id="mud-sms-text" placeholder="内容（UCS-2 提交，中文可直接发）" spellcheck="false"/>
      <button class="mud-btn" id="mud-sms-send">发送</button>
    </div>
    <div class="mud-note" id="mud-sms-note">发送走 AT+CMGS（PDU 模式），大约需要几秒；通道忙会提示重试。</div>
  </div>

  <div class="mud-card" style="grid-column:1/-1">
    <h3>收件箱 <span id="mud-sms-stat" style="font-weight:400"></span></h3>
    <div class="mud-ctl" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:8px">
      <button class="mud-btn" id="mud-sms-refresh">刷新</button>
      <button class="mud-btn" id="mud-sms-sync">从 SIM 同步</button>
      <button class="mud-btn" id="mud-sms-prev">上一页</button>
      <button class="mud-btn" id="mud-sms-next">下一页</button>
      <button class="mud-btn warn" id="mud-sms-clear">清空本地池</button>
    </div>
    <div id="mud-sms-list" style="margin-top:4px"><div class="mud-note">加载中…</div></div>
    <div class="mud-out" id="mud-sms-detail" style="display:none"></div>
  </div>
</div>`;
		this.page = 1;
		this.root = root;
		this.Q = function(id) { return root.querySelector('#mud-' + id); };
		this.wire(root);
		this.load();
		return root;
	},

	wire: function(root) {
		var self = this;
		var q = function(id) { return root.querySelector('#mud-' + id); };

		q('sms-send').onclick = function() {
			var num = (M.v('sms-num').value || '').trim();
			var text = (M.v('sms-text').value || '').trim();
			if (!num || !text) { M.v('sms-note').textContent = '号码和内容都要填。'; return; }
			M.v('sms-note').textContent = '发送中…';
			this.disabled = true;
			L.resolveDefault(M.callSmsSend(num, text)).then(function(r) {
				r = r || {};
				self.buttons();
				if (r.ok) {
					M.v('sms-note').textContent = '已发送' + (r.warn ? '（' + r.warn + '）' : '') + '，稍后刷新列表。';
					M.v('sms-text').value = '';
					setTimeout(function() { self.load(); }, 3000);
				} else {
					M.v('sms-note').textContent = '发送失败：' + (r.error || '未知错误') + (r.busy ? '（AT 通道正忙，稍后重试）' : '');
				}
			}, function() { self.buttons(); M.v('sms-note').textContent = '调用失败'; });
		};
		q('sms-refresh').onclick = function() { self.load(); };
		q('sms-sync').onclick = function() {
			M.v('sms-note').textContent = '已在后台开始从 SIM 同步（AT+CMGL，需要一点时间）…';
			L.resolveDefault(M.callSmsSync()).then(function() {
				M.v('sms-note').textContent = 'SIM 同步已开始，几秒后点「刷新」。';
				setTimeout(function() { self.load(); }, 10000);
			});
		};
		q('sms-prev').onclick = function() { if (self.page > 1) { self.page--; self.load(); } };
		q('sms-next').onclick = function() { self.page++; self.load(); };
		q('sms-clear').onclick = function() {
			if (!window.confirm('清空本地短信池？（只删本地文件，SIM 上的不动；删 SIM 需在设备上执行 mu300-sms delete --sim）')) return;
			L.resolveDefault(M.callSmsDel('all')).then(function() { self.load(); });
		};
	},

	buttons: function() {
		var b = this.root.querySelector('#mud-sms-send');
		if (b) b.disabled = false;
	},

	load: function() {
		var self = this;
		L.resolveDefault(M.callSmsList(this.page)).then(function(r) { self.paint(r || {}); });
	},

	paint: function(r) {
		var self = this;
		var box = this.Q('sms-list');
		if (r.error) { box.innerHTML = '<div class="mud-note">' + M.esc(r.error) + '</div>'; return; }
		var stat = this.root ? this.root.querySelector('#mud-sms-stat') : document.getElementById('mud-sms-stat');
		if (stat) stat.textContent = r.total ? ('· ' + r.total + ' 条' + (r.unread ? '，' + r.unread + ' 条未读' : '') + ' · 第 ' + r.page + '/' + r.pages + ' 页') : '· 空';
		if (!r.msgs || !r.msgs.length) {
			box.innerHTML = '<div class="mud-note">池子是空的：收到/发出的短信会在这里，或点「从 SIM 同步」把 SIM 上的拉下来。</div>';
			return;
		}
		box.innerHTML = r.msgs.map(function(m) {
			var who = (m.dir === 'mt') ? '来自' : '发给';
			return '<div class="mud-sms-item" data-id="' + m.esc_id + '">' +
				'<div class="mud-sms-top"><span>' +
					(m.status === 'unread' ? '<span class="mud-badge">未读</span> ' : '') +
					'<b>' + M.esc(m.peer) + '</b> <span style="color:var(--text-muted,var(--text-light,#777));font-size:.74rem">' + who + ' · ' + M.esc(m.time) + '</span>' +
				'</span><span><button class="mud-btn warn" style="padding:1px 8px;font-size:.72rem" data-del="' + m.esc_id + '">删除</button></span></div>' +
				'<div style="margin-top:3px;font-size:.82rem;color:var(--text-muted,var(--text-light,#888))" class="mud-preview">' + M.esc(m.preview) + '</div>' +
			'</div>';
		}).join('');
		box.querySelectorAll('.mud-sms-item').forEach(function(el) {
			el.addEventListener('click', function(ev) {
				if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-del')) return;
				self.show(el.getAttribute('data-id'));
			});
		});
		box.querySelectorAll('[data-del]').forEach(function(btn) {
			btn.addEventListener('click', function(ev) {
				ev.stopPropagation();
				if (!window.confirm('删除这条短信（本地池）？')) return;
				L.resolveDefault(M.callSmsDel(btn.getAttribute('data-del'))).then(function() { self.load(); });
			});
		});
	},

	show: function(id) {
		var self = this;
		var det = this.root.querySelector('#mud-sms-detail');
		det.style.display = 'block';
		det.textContent = '读取中…';
		L.resolveDefault(M.callSmsShow(id)).then(function(r) {
			r = r || {};
			det.textContent = r.ok ? (r.text || '(空)') : ('读取失败：' + (r.error || ''));
			if (r.ok) setTimeout(function() { self.load(); }, 1500); /* show 会把未读标为已读 */
		});
	}
});
