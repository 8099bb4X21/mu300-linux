'use strict';
'require view';
'require mu300.common as M';

/* 短信 -- 聊天式界面。数据在设备本地池（mu300-smsd 与 SIM 同步）：
 *   左列会话列表（按联系人分组，最新时间排序，未读徽标）
 *   右侧对话区：气泡（收到的左侧灰底 / 发出的右侧品牌底）+ 时间戳
 *   底部输入栏：号码 + 内容，Enter 发送、Shift+Enter 换行
 * 打开会话时逐条取全文（sms_show 顺带把未读标记已读）。列表/取文都是纯文件读，
 * 发送与 SIM 同步走 AT（后者后台执行）。删除单条：气泡上右键或长按。 */

var MAX_PAGES = 5;   /* 一次聚合的池子页数（每页 10 条），纯文件读，很便宜 */

return view.extend({
	load: function() { return Promise.resolve(); },

	render: function() {
		M.injectCss();
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = `
<div class="mud-sec" style="margin-top:0">
  <h3>短信 <span id="mud-sms-stat" style="font-weight:400"></span></h3>
  <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
    <input id="mud-sms-num" placeholder="发送到：号码，如 10086 或 +86..." spellcheck="false"
      style="flex:1 1 260px;padding:7px 11px;border:1px solid var(--hairline,var(--border,#ccc));border-radius:var(--radius-base,.5rem);background:var(--surface,var(--background,#fff));color:var(--text,#222)"/>
    <button class="mud-btn" id="mud-sms-send" style="padding:7px 20px">发送</button>
  </div>
  <div class="mud-ctl" style="max-width:460px;margin-bottom:8px">
    <button class="mud-btn" id="mud-sms-refresh">刷新</button>
    <button class="mud-btn" id="mud-sms-sync">从 SIM 同步</button>
    <button class="mud-btn warn" id="mud-sms-clear">清空本地池</button>
  </div>
  <div class="mud-chat">
    <div class="mud-convs" id="mud-sms-convs"><div class="mud-note">加载中…</div></div>
    <div class="mud-thread">
      <div class="mud-msgs" id="mud-sms-msgs"><div class="mud-note" style="margin:8px 2px">选择左侧会话，或直接在下方输入号码发送。</div></div>
      <div class="mud-comp">
        <textarea id="mud-sms-text" placeholder="内容（UCS-2 提交，中文可直接发；Enter 发送，Shift+Enter 换行）" rows="1"></textarea>
      </div>
    </div>
  </div>
  <div class="mud-note" id="mud-sms-note">发送走 AT+CMGS（PDU 模式）；通道忙会提示重试。删除单条：在气泡上右键（手机长按）。</div>
</div>`;
		this.Q = function(id) { return root.querySelector('#mud-' + id); };
		this.sel = null;          /* 当前会话的 peer */
		this.convs = {};          /* peer -> {msgs:[], unread:n} */
		this.wire(root);
		this.reload();
		return root;
	},

	wire: function(root) {
		var self = this;

		this.Q('sms-refresh').onclick = function() { self.reload(); };
		this.Q('sms-sync').onclick = function() {
			self.note('已在后台开始从 SIM 同步（AT+CMGL）…');
			L.resolveDefault(M.callSmsSync()).then(function() {
				self.note('SIM 同步已开始，几秒后自动刷新。');
				setTimeout(function() { self.reload(); }, 8000);
			});
		};
		this.Q('sms-clear').onclick = function() {
			if (!window.confirm('清空本地短信池？（只删本地文件，SIM 上的不动）')) return;
			L.resolveDefault(M.callSmsDel('all')).then(function() { self.sel = null; self.reload(); });
		};
		this.Q('sms-send').onclick = function() { self.send(); };
		var txt = this.Q('sms-text');
		txt.addEventListener('keydown', function(ev) {
			if (ev.key == 'Enter' && !ev.shiftKey) { ev.preventDefault(); self.send(); }
		});
		txt.addEventListener('input', function() {
			this.style.height = 'auto';
			this.style.height = Math.min(120, this.scrollHeight) + 'px';
		});
		/* 气泡上删除（右键 / 长按） */
		var msgBox = this.Q('sms-msgs');
		msgBox.addEventListener('contextmenu', function(ev) {
			var bub = ev.target.closest ? ev.target.closest('[data-id]') : null;
			if (!bub) return;
			ev.preventDefault();
			self.delMsg(bub.getAttribute('data-id'));
		});
		var pressTimer = null;
		msgBox.addEventListener('touchstart', function(ev) {
			var bub = ev.target.closest ? ev.target.closest('[data-id]') : null;
			if (!bub) return;
			pressTimer = setTimeout(function() { self.delMsg(bub.getAttribute('data-id')); }, 650);
		});
		msgBox.addEventListener('touchend', function() { clearTimeout(pressTimer); });
	},

	delMsg: function(id) {
		var self = this;
		if (!window.confirm('删除这条短信（本地池）？')) return;
		L.resolveDefault(M.callSmsDel(id)).then(function() { self.reload(); });
	},

	note: function(t) { var e = this.Q('sms-note'); if (e) e.textContent = t; },

	send: function() {
		var self = this;
		var num = (this.Q('sms-num').value || '').trim();
		var text = (this.Q('sms-text').value || '').replace(/\s+$/, '');
		if (!num || !text) { this.note('号码和内容都要填。'); return; }
		var btn = this.Q('sms-send');
		btn.disabled = true;
		this.note('发送中…');
		L.resolveDefault(M.callSmsSend(num, text)).then(function(r) {
			r = r || {};
			btn.disabled = false;
			if (r.ok) {
				self.note('已发送，稍后自动刷新。');
				self.Q('sms-text').value = '';
				setTimeout(function() { self.reload(); }, 2500);
			} else {
				self.note('发送失败：' + (r.error || '未知错误') + (r.busy ? '（AT 通道正忙，稍后重试）' : ''));
			}
		}, function() { btn.disabled = false; self.note('调用失败'); });
	},

	/* 聚合池子里的几页，按联系人分组 */
	reload: function() {
		var self = this;
		var all = [], page = 1;
		var step = function() {
			L.resolveDefault(M.callSmsList(page)).then(function(r) {
				r = r || {};
				if (r.error) {
					self.Q('sms-convs').innerHTML = '<div class="mud-note">' + M.esc(r.error) + '</div>';
					return;
				}
				all = all.concat(r.msgs || []);
				var pages = r.pages || 1;
				if (page < pages && page < MAX_PAGES) { page++; return step(); }
				self.stat = r;
				self.build(all);
			});
		};
		step();
	},

	build: function(all) {
		var self = this;
		this.convs = {};
		all.forEach(function(m) {
			var peer = m.peer || '?';
			if (!self.convs[peer]) self.convs[peer] = { msgs: [], unread: 0 };
			self.convs[peer].msgs.push(m);
			if (m.status === 'unread') self.convs[peer].unread++;
		});
		var peers = Object.keys(this.convs).sort(function(a, b) {
			var ma = self.convs[a].msgs[0], mb = self.convs[b].msgs[0];
			return (mb && mb.time || '').localeCompare(ma && ma.time || '');
		});
		var st = this.stat || {};
		this.Q('sms-stat').textContent = '· ' + (st.total || all.length) + ' 条' +
			(st.unread ? '，' + st.unread + ' 条未读' : '') + ' · ' + peers.length + ' 个会话';
		var box = this.Q('sms-convs');
		if (!peers.length) {
			box.innerHTML = '<div class="mud-note" style="margin:6px">池子是空的：收到/发出的短信会出现在这里，或点「从 SIM 同步」。</div>';
			return;
		}
		box.innerHTML = peers.map(function(p) {
			var cv = self.convs[p];
			var last = cv.msgs[0];
			return '<div class="mud-conv' + (p === self.sel ? ' sel' : '') + '" data-peer="' + M.esc(p) + '">' +
				'<div class="n"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + M.esc(p) + '</span>' +
				(cv.unread ? '<span class="mud-badge">' + cv.unread + '</span>' : '') + '</div>' +
				'<div class="p">' + M.esc((last.dir === 'mo' ? '我: ' : '') + (last.preview || '')) + '</div>' +
				'<div class="p" style="opacity:.7">' + M.esc(last.time || '') + '</div></div>';
		}).join('');
		box.querySelectorAll('.mud-conv').forEach(function(el) {
			el.onclick = function() { self.open(el.getAttribute('data-peer')); };
		});
		if (this.sel && this.convs[this.sel]) this.open(this.sel);
	},

	/* 打开会话：渲染气泡并逐条取全文（未读的顺带标记已读） */
	open: function(peer) {
		var self = this;
		this.sel = peer;
		this.Q('sms-num').value = peer.replace(/[^+0-9]/g, '');
		this.Q('sms-convs').querySelectorAll('.mud-conv').forEach(function(el) {
			el.className = (el.getAttribute('data-peer') === peer ? 'mud-conv sel' : 'mud-conv');
		});
		var cv = this.convs[peer];
		var msgsEl = this.Q('sms-msgs');
		msgsEl.innerHTML = '';
		cv.msgs.slice().reverse().forEach(function(m) {   /* 旧 -> 新 */
			var div = document.createElement('div');
			div.className = 'mud-bub' + (m.dir === 'mo' ? ' out' : '');
			div.setAttribute('data-id', m.id);
			div.innerHTML = '<span class="bd">' + M.esc(m.preview || '') + (m.preview && m.preview.length >= 44 ? '…' : '') + '</span>' +
				'<span class="tm">' + M.esc((m.time || '').split(' ').pop() || '') + '</span>';
			msgsEl.appendChild(div);
			if (m.status === 'unread') div.querySelector('.bd').style.fontWeight = '600';
			/* 需要全文或未读时取整条（sms_show 同时把未读标已读） */
			if ((m.preview || '').length >= 44 || m.status === 'unread') {
				L.resolveDefault(M.callSmsShow(m.id)).then(function(r) {
					r = r || {};
					if (!r.ok) return;
					var body = (r.text || '').split('\n\n').slice(1).join('\n\n').trim();
					var bd = div.querySelector('.bd');
					if (bd) { bd.textContent = body; bd.style.fontWeight = ''; }
				});
			}
		});
		msgsEl.scrollTop = msgsEl.scrollHeight;
	}
});
