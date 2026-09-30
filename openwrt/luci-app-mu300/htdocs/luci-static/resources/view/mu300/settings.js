'use strict';
'require form';
'require view';

return view.extend({
	render: function() {
		var m = new form.Map('unisoc_modem', '适配设置',
			'这里定义插件与当前紫光 OpenWrt 的边界。修改后无需改动看板、AT、锁定或短信页面。');
		var s = m.section(form.NamedSection, 'main', 'core', '平台适配');
		s.addremove = false;

		var o = s.option(form.ListValue, 'at_backend', 'AT 后端');
		o.value('auto', '自动检测');
		o.value('mu300', 'mu300-at');
		o.value('atinout', 'atinout + 串口');
		o.value('custom', '自定义适配器');

		o = s.option(form.Value, 'at_port', 'AT 串口');
		o.placeholder = '/dev/stty_nr1';
		o.depends('at_backend', 'atinout');

		o = s.option(form.Value, 'at_command', '自定义 AT 适配器');
		o.placeholder = '/usr/libexec/my-platform/at';
		o.description = '可执行文件依次接收超时秒数和完整 AT 命令。它必须与平台拨号程序共享串口锁。';
		o.depends('at_backend', 'custom');

		o = s.option(form.Value, 'sms_command', '短信适配器');
		o.placeholder = '/usr/bin/mu300-sms';
		o.description = '实现 list、show、send、delete、sync 子命令；留空时自动查找 mu300-sms。';

		o = s.option(form.Value, 'sms_pool', '短信池目录');
		o.placeholder = '/etc/unisoc-modem/sms';

		o = s.option(form.Value, 'data_interface', '蜂窝逻辑接口');
		o.placeholder = 'wan';
		o = s.option(form.Value, 'data_interface_v6', '蜂窝 IPv6 接口');
		o.placeholder = 'wan6';
		o = s.option(form.Value, 'data_device', '蜂窝网卡');
		o.placeholder = '留空则从 netifd 自动获取';
		o = s.option(form.Value, 'lan_device', 'LAN 网桥');
		o.placeholder = 'br-lan';
		o = s.option(form.Value, 'wifi_device', 'Wi-Fi 网卡');
		o.placeholder = 'wlan0';
		o = s.option(form.Value, 'usb_device', 'USB 网卡');
		o.placeholder = 'usb0';

		o = s.option(form.Value, 'replay_timeout', '等待 AT 就绪上限（秒）');
		o.datatype = 'uinteger';
		o.placeholder = '90';
		o = s.option(form.Value, 'state_dir', '持久化状态目录');
		o.placeholder = '/etc/unisoc-modem/lock-state.d';

		return m.render();
	}
});
