#!/bin/sh
# own: IPv6 安卓对齐 hotfix（10-07 方案进包：单 /64 共享 + 策略路由 + 关 NAT66）。
# 在镜像容器内执行（路径均为容器内路径），由 post-rootfs-container.sh 调一次。
# 上游修好后的删除动作：删本文件 + custom/net-v6/ 目录 +
#   post-rootfs-container.sh 里调用本文件的 1 行（搜 net-v6-hotfix）。
# 跟踪：操作/网络同步与安卓端一致/（00-README、04-变更记录）。
#
# 拆分原因（必读）：kano 90-mu300 首启会重写 dhcp relay 与 masq6，
# 所以文件类（脚本/hook）放这里容器期处理，uci 配置类放
# custom/net-v6/96-net-v6-defaults（编号在 90 之后，首启覆盖它）。
set -eu

# --- 块1：部署脚本（v6-share 供 cell hook 调；monitor 供 cron 调） ---
# 上游修好标志：官方提供同等前缀镜像/监控机制。届时删本块。
# 载荷一致性（线上验证版 md5）：
md5sum /in/custom/net-v6/mu300-v6-share.sh | grep -q '^6434f10c5f14678a97a1d7983dfe6058 ' \
    || { echo "net-v6-hotfix: payload mu300-v6-share.sh mismatch" >&2; exit 1; }
md5sum /in/custom/net-v6/mu300-ipv6-monitor.sh | grep -q '^46f07b119bdacefabb545a9f32bb83bc ' \
    || { echo "net-v6-hotfix: payload mu300-ipv6-monitor.sh mismatch" >&2; exit 1; }
mkdir -p /usr/script
cp /in/custom/net-v6/mu300-v6-share.sh /usr/sbin/mu300-v6-share
cp /in/custom/net-v6/mu300-ipv6-monitor.sh /usr/script/mu300-ipv6-monitor
chmod 0755 /usr/sbin/mu300-v6-share /usr/script/mu300-ipv6-monitor

# --- 块2：mu300cell hook（幂等追加；禁整文件覆盖：上游已加双 SIM，覆盖会杀掉它） ---
# 上游修好标志：官方 report() 自带前缀镜像触发。届时删本块。
# hook 行与线上验证一致（缩进省略，shell 不敏感；内容逐字节对 10-07 线上版）：
[ -f /lib/netifd/proto/mu300cell-v6.sh ] || { echo "net-v6-hotfix: mu300cell-v6.sh missing" >&2; exit 1; }
grep -q "mu300-v6-share" /lib/netifd/proto/mu300cell-v6.sh 2>/dev/null || {
    [ "$(grep -cF 'proto_send_update "$config"' /lib/netifd/proto/mu300cell-v6.sh 2>/dev/null)" = 1 ] \
        || { echo "net-v6-hotfix: report anchor changed" >&2; exit 1; }
    printf '%s\n' '[ -x /usr/sbin/mu300-v6-share ] && /usr/sbin/mu300-v6-share 2>/dev/null || true' > /tmp/net-v6-hookline
    # 无 ^ 锚（行首有 tab 缩进）：唯一性由上面的计数断言保证，多一行就炸。
    sed -i '/proto_send_update "\$config"$/r /tmp/net-v6-hookline' /lib/netifd/proto/mu300cell-v6.sh
    rm -f /tmp/net-v6-hookline
    sh -n /lib/netifd/proto/mu300cell-v6.sh || { echo "net-v6-hotfix: hooked script broken" >&2; exit 1; }
    grep -q "mu300-v6-share" /lib/netifd/proto/mu300cell-v6.sh \
        || { echo "net-v6-hotfix: hook missing after insert" >&2; exit 1; }
}

# --- 块3：安装 96 uci-defaults（dhcp/firewall 默认值，90-mu300 之后生效） ---
# 上游修好标志：官方默认即 server/无 masq6。届时删本块及 96 文件。
# 注意：配置类故意不在这里直接改——90-mu300 首启会重写它们，容器期改等于白改。
[ -f /in/custom/net-v6/96-net-v6-defaults ] || { echo "net-v6-hotfix: 96 defaults missing" >&2; exit 1; }
cp /in/custom/net-v6/96-net-v6-defaults /etc/uci-defaults/96-net-v6-defaults
chmod 0755 /etc/uci-defaults/96-net-v6-defaults

# --- 块4：cron 注释行 + 启用 cron（monitor 改由 cron 调；默认注释，用户自启用） ---
# 上游修好标志：官方自带等效机制。届时删本块。
# 注意：OpenWrt 的 /etc/init.d/cron 在 /etc/crontabs 为空时 start_service 直接
# return 1 不启动，所以必须建出这个（非空的）文件，cron 才会随 S50cron 起。
CR=/etc/crontabs/root
mkdir -p /etc/crontabs
[ -f "$CR" ] || : > "$CR"
grep -q "mu300-ipv6-monitor" "$CR" 2>/dev/null || \
    printf '%s\n' \
      '# IPv6 断线监控：取消下一行注释即启用（每 4 分钟检测一次；一次运行内含最多 3 次、间隔 30s 复检，连续失败自动重拨，重拨无效过冷却则重启）' \
      '#*/4 * * * * /usr/script/mu300-ipv6-monitor' >> "$CR"
grep -q '/usr/script/mu300-ipv6-monitor' "$CR" \
    || { echo "net-v6-hotfix: crontab line missing" >&2; exit 1; }
# cron 开机自启（rc.common enable 需 ubus，容器内直接链 rc.d，仿 ksmbd 段）
if [ -e /etc/init.d/cron ] && [ ! -e /etc/rc.d/S50cron ]; then
    n=$(sed -n 's/^START=//p' /etc/init.d/cron)
    [ -n "$n" ] && ln -sf ../init.d/cron "/etc/rc.d/S${n}cron"
fi

echo "net-v6-hotfix: done"
