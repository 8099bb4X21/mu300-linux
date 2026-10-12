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

# --- 块1：部署脚本（上游无这些文件；若上游自带同名则复核冲突） ---
# 上游修好标志：官方提供同等前缀镜像/监控机制。届时删本块。
# 载荷一致性（10-07 验证版 md5）：
md5sum /in/custom/net-v6/mu300-v6-share.sh | grep -q '^6434f10c5f14678a97a1d7983dfe6058 ' \
    || { echo "net-v6-hotfix: payload mu300-v6-share.sh mismatch" >&2; exit 1; }
md5sum /in/custom/net-v6/mu300-ipv6-monitor.sh | grep -q '^cebd5fe1611e2ff6a55bf76753402404 ' \
    || { echo "net-v6-hotfix: payload mu300-ipv6-monitor.sh mismatch" >&2; exit 1; }
md5sum /in/custom/net-v6/mu300-ipv6-monitor.init | grep -q '^574052adc434fee693ecb70ea8ec48da ' \
    || { echo "net-v6-hotfix: payload mu300-ipv6-monitor.init mismatch" >&2; exit 1; }
cp /in/custom/net-v6/mu300-v6-share.sh /usr/sbin/mu300-v6-share
cp /in/custom/net-v6/mu300-ipv6-monitor.sh /usr/sbin/mu300-ipv6-monitor
cp /in/custom/net-v6/mu300-ipv6-monitor.init /etc/init.d/mu300-ipv6-monitor
chmod 0755 /usr/sbin/mu300-v6-share /usr/sbin/mu300-ipv6-monitor /etc/init.d/mu300-ipv6-monitor
# monitor 开机自启（容器内无 procd/ubus，直接链 rc.d，仿 ksmbd 段）：
n=$(sed -n "s/^START=//p" /etc/init.d/mu300-ipv6-monitor)
[ -n "$n" ] || { echo "net-v6-hotfix: no START in monitor init" >&2; exit 1; }
ln -sf ../init.d/mu300-ipv6-monitor "/etc/rc.d/S${n}mu300-ipv6-monitor"

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

echo "net-v6-hotfix: done"
