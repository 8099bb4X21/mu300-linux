#!/bin/sh
# mu300-ipv6-monitor: 单次检测 sipa_eth0 公网 IPv6。设计为由 cron 每 4 分钟调用一次
# （默认在 /etc/crontabs/root 里是注释行，用户取消注释即启用）。
#
# 一次运行内含"最多 MAX_FAIL 次、每次间隔 FAIL_INTERVAL 秒"的复检；连续失败才
# ifdown/ifup wan 重拨，重拨无效且过了冷却窗则 reboot（冷却防反复重启）。
# 健康时完全静默（不写日志），只有异常才记，避免 cron 每次都留痕。
#
# 用法: mu300-ipv6-monitor        # 单次检测并按需重拨/重启（默认动作）
#       mu300-ipv6-monitor check  # 只输出 HAS/NO，不做任何动作（人工验证）

WAN_IF="sipa_eth0"
WAN_NET="wan"
MAX_FAIL=${MU300_IPV6_MONITOR_MAX_FAIL:-3}
FAIL_INTERVAL=${MU300_IPV6_MONITOR_FAIL_INTERVAL:-30}
REDIAL_WAIT=${MU300_IPV6_MONITOR_REDIAL_WAIT:-10}
COOLDOWN=${MU300_IPV6_MONITOR_COOLDOWN:-1800}
START_AFTER=${MU300_IPV6_MONITOR_START_AFTER:-300}     # 开机后满这么多秒才检测
LOG_DIR=${MU300_IPV6_MONITOR_LOG_DIR:-/mnt/mu300-disk/share/Log}
LOG=${MU300_IPV6_MONITOR_LOG:-${LOG_DIR}/mu300-ipv6-monitor.log}
STAMP=${MU300_IPV6_MONITOR_STAMP:-/etc/mu300/ipv6-monitor-stamp}
LOCKDIR=${MU300_IPV6_MONITOR_LOCK:-/var/run/mu300-ipv6-monitor.lock}

log() {
    mkdir -p "$LOG_DIR" 2>/dev/null
    echo "[$(date '+%F %T')] $*" >> "$LOG" 2>/dev/null
    logger -t mu300-ipv6-monitor "$*" 2>/dev/null || true
}

# 有公网 IPv6(GUA=2000::/3,即首段 2xxx/3xxx)才算有;排除 ULA(fd66)与链路本地
has_v6() {
    ip -6 addr show dev "$WAN_IF" scope global 2>/dev/null | grep 'inet6 ' | grep -v ' fd66:' | grep -v ' fe80:' | grep -q 'inet6 [23]'
}

if [ "$1" = "check" ]; then
    if has_v6; then
        echo "HAS: $(ip -6 addr show dev "$WAN_IF" scope global 2>/dev/null | grep 'inet6 ' | grep -v ' fd66:' | grep -v ' fe80:')"
        exit 0
    else
        echo "NO: no GUA on $WAN_IF"
        exit 1
    fi
fi

# 可打断的 sleep：SIGTERM 时 wait 即返，不必等满整个 sleep
pause() { sleep "$1" & wait $!; }

# 单实例：某拍还在跑（重拨/复查耗时长）时，下一拍直接退出，不并发。
# 锁带 pid + 探活，SIGKILL 留下的陈旧锁会被接管。
if ! mkdir "$LOCKDIR" 2>/dev/null; then
    owner=$(cat "$LOCKDIR/pid" 2>/dev/null || true)
    if [ -n "$owner" ] && [ -d "/proc/$owner" ] &&
       tr '\0' ' ' < "/proc/$owner/cmdline" 2>/dev/null | grep -q mu300-ipv6-monitor; then
        exit 0
    fi
    echo "taking over stale lock (ex-holder ${owner:-unknown})" >&2
    rm -rf "$LOCKDIR"
    mkdir "$LOCKDIR" 2>/dev/null || exit 0
fi
echo $$ > "$LOCKDIR/pid"
trap 'rm -f "$LOCKDIR/pid" 2>/dev/null; rmdir "$LOCKDIR" 2>/dev/null; exit 0' EXIT INT TERM

# 开机护栏：modem 冷启动/首注册期间 sipa_eth0 尚无 GUA，别误判。按 uptime 补足。
up=$(cut -d. -f1 /proc/uptime 2>/dev/null)
case $up in ''|*[!0-9]*) up=0 ;; esac
[ "$up" -lt "$START_AFTER" ] && pause $((START_AFTER - up))

fail=0
while [ "$fail" -lt "$MAX_FAIL" ]; do
    fail=$((fail + 1))
    if has_v6; then
        [ "$fail" -gt 1 ] && log "IPv6 已恢复"
        exit 0
    fi
    log "无公网 IPv6 (${fail}/${MAX_FAIL})"
    [ "$fail" -lt "$MAX_FAIL" ] && pause "$FAIL_INTERVAL"
done

# 连续 MAX_FAIL 次无 GUA：重拨一次，等 REDIAL_WAIT 后复查
log "尝试重新拨号 (ifdown/ifup $WAN_NET)"
ifdown "$WAN_NET" 2>/dev/null
pause 5
ifup "$WAN_NET" 2>/dev/null
pause "$REDIAL_WAIT"
if has_v6; then
    log "重拨成功,取消重启"
    exit 0
fi

# 仍无：冷却窗内只记一笔，过了才重启（防反复重启）
now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
case "$last" in ''|*[!0-9]*) last=0 ;; esac
if [ $((now - last)) -lt "$COOLDOWN" ]; then
    log "冷却期内跳过重启 (距上次 $((now - last))s)"
    exit 0
fi
echo "$now" > "$STAMP"
log "连续 ${MAX_FAIL} 次无 IPv6 且重拨无效,重启设备"
reboot