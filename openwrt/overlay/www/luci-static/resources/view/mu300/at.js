'use strict';
'require view';
'require mu300.common as M';

/* AT 终端 -- 手动调试口。所有命令经 rpcd -> mu300-at 走设备的 AT 通道（与短信、
 * 拨号看门狗共用一把锁，自动排队）。守卫在后端：必须是 AT 开头、禁止 ";" 级联、
 * AT+SPENGMD=0,1,0 直接拒绝（它会把 AT 口切进流模式，直到重启才能救回来）。 */

var CHIPS = [
	'AT+CSQ', 'AT+CEREG?', 'AT+C5GREG?', 'AT+COPS?', 'AT+CGACT?', 'AT+CGCONTRDP=1',
	'AT+CFUN?', 'AT+CPIN?', 'AT+CGMR', 'AT+CCID', 'AT+SPENDC?', 'AT+SPTESTMODE?',
	'AT+SPENGMD=0,14,1', 'AT+SPQ5GNCELLEX'
];

return view.extend({
	load: function() { return Promise.resolve(); },

	render: function() {
		M.injectCss();
		var root = document.createElement('div');
		root.className = 'mud';
		root.innerHTML = `
<div class="mud-grid">
  <div class="mud-card" style="grid-column:1/-1">
    <h3>AT 命令</h3>
    <div class="mud-at-in">
      <input id="mud-at-cmd" placeholder="AT 命令，如 AT+CSQ" spellcheck="false"/>
      <button class="mud-btn" id="mud-at-go">发送</button>
      <button class="mud-btn" id="mud-at-hist-btn">历史</button>
    </div>
    <div class="mud-chiprow" id="mud-at-chips"></div>
    <div class="mud-out" id="mud-at-out">就绪。命令经 mu300-at 排队发出，不会干扰拨号。</div>
    <div class="mud-out" id="mud-at-hist" style="display:none"></div>
  </div>
</div>`;
		this.wire(root);
		return root;
	},

	wire: function(root) {
		var q = function(id) { return root.querySelector('#mud-' + id); };
		var self = this;

		q('at-chips').innerHTML = CHIPS.map(function(c) { return '<span class="mud-chip">' + c + '</span>'; }).join('');
		root.querySelectorAll('.mud-chip').forEach(function(ch) {
			ch.onclick = function() { M.v('at-cmd').value = ch.textContent; self.send(); };
		});

		this.send = function() {
			var cmd = (M.v('at-cmd').value || '').trim();
			if (!cmd) return;
			M.v('at-out').textContent = '> ' + cmd + '\n…';
			L.resolveDefault(M.callAt(cmd)).then(function(r) {
				r = r || {};
				M.v('at-out').textContent = '> ' + cmd + '\n' +
					(r.ok ? (r.reply || '(无输出)') : ('错误：' + (r.error || '失败') + (r.busy ? '（AT 通道正忙，命令未发出）' : '')));
			}, function() { M.v('at-out').textContent = '调用失败'; });
		};
		q('at-go').onclick = this.send;
		q('at-cmd').addEventListener('keydown', function(ev) { if (ev.key == 'Enter') self.send(); });
		q('at-hist-btn').onclick = function() {
			var h = document.getElementById('mud-at-hist');
			if (h.style.display == 'none') {
				h.style.display = 'block';
				h.textContent = '读取中…';
				L.resolveDefault(M.callAtHist()).then(function(r) {
					r = r || {};
					h.textContent = r.history || '(还没有历史)';
				});
			} else h.style.display = 'none';
		};
	}
});
