#!/bin/sh
# mu300-ipv6-monitor: 监控 sipa_eth0 公网 IPv6,丢失则重拨,重拨无效则重启
#
# 策略对标 Android 版 ipv6_monitor 插件(OK 120s / FAIL 30s / 连续 3 次进恢复):
#   L1 先 ifdown/ifup wan 重新拨号(对等 Android 的 killall dhcp6c 续约);
#   10s 后复查仍无则 reboot(30 分钟冷却防反复重启)。
#
# 与 Android 版的关键差异: 只认 sipa_eth0 上的 GUA,排除 fd66 ULA/fe80。
# (br-lan 常驻 fd66 ULA,若只查 scope global 会永远误判"有 IPv6"。)
#
# 用法: mu300-ipv6-monitor        # 常驻循环(由 procd 启动)
#       mu300-ipv6-monitor check  # 单次检测:输出 HAS/NO,供验证用

WAN_IF="sipa_eth0"
WAN_NET="wan"
MAX_FAIL=3
OK_INTERVAL=120
FAIL_INTERVAL=30
REDIAL_WAIT=10
COOLDOWN=1800
START_AFTER=${MU300_IPV6_MONITOR_START_AFTER:-300}   # 开机后满这么多秒才开始检测
LOG_DIR="/mnt/mu300-disk/share/Log"
LOG="${LOG_DIR}/mu300-ipv6-monitor.log"
STAMP="/etc/mu300/ipv6-monitor-stamp"
LOCKDIR="/var/run/mu300-ipv6-monitor.lock"

log() {
    mkdir -p "$LOG_DIR" 2>/dev/null
    echo "[$(date '+%F %T')] $*" >> "$LOG" 2>/dev/null
    logger -t mu300-ipv6-monitor "$*" 2>/dev/null || true
}

# 可打断的 sleep：直接 sleep N 时 SIGTERM 要等 N 秒（最长 120s）才进 trap，
# procd 5s 等不及就 SIGKILL（logread 可见 "not stopped on SIGTERM"），trap 跑不到，
# 于是 stale lock + 重启抖动。sleep 放后台 + wait：信号一到 wait 即返，trap 立刻跑。
pause() { sleep "$1" & wait $!; }

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

if ! mkdir "$LOCKDIR" 2>/dev/null; then
    owner=$(cat "$LOCKDIR/pid" 2>/dev/null || true)
    if [ -n "$owner" ] && [ -d "/proc/$owner" ] &&
       tr '\0' ' ' < "/proc/$owner/cmdline" 2>/dev/null | grep -q mu300-ipv6-monitor; then
        echo "already running (pid $owner), exit"
        exit 0
    fi
    echo "taking over stale lock (ex-holder ${owner:-unknown})" >&2
    rm -rf "$LOCKDIR"
    mkdir "$LOCKDIR" 2>/dev/null || { echo "cannot take lock" >&2; exit 1; }
fi
echo $$ > "$LOCKDIR/pid"
trap 'rm -f "$LOCKDIR/pid" 2>/dev/null; rmdir "$LOCKDIR" 2>/dev/null; exit 0' EXIT INT TERM

log "IPv6 监控启动 (watch $WAN_IF GUA, fail ${FAIL_INTERVAL}s x${MAX_FAIL})"

# own: 开机后先等满 START_AFTER 秒再检测。modem 冷启动/首次注册期间 sipa_eth0
# 尚无 GUA，立刻检测会误判并在 boot 阶段就 ifdown/ifup wan，干扰 modem bring-up，
# 甚至与看门狗叠加成重启循环。按 /proc/uptime 算剩余：5 分钟内启动补足到 5 分钟；
# 之后启动（进程重启）不再等待。
up=$(cut -d. -f1 /proc/uptime 2>/dev/null)
case $up in ''|*[!0-9]*) up=0 ;; esac
if [ "$up" -lt "$START_AFTER" ]; then
    log "开机 ${up}s，先等 $((START_AFTER - up))s（满 ${START_AFTER}s）再开始检测"
    pause $((START_AFTER - up))
fi

fail=0
while true; do
    if has_v6; then
        if [ "$fail" -gt 0 ]; then
            log "IPv6 已恢复"
        fi
        fail=0
        pause "$OK_INTERVAL"
    else
        fail=$((fail + 1))
        log "无公网 IPv6 (${fail}/${MAX_FAIL})"
        if [ "$fail" -ge "$MAX_FAIL" ]; then
            log "尝试重新拨号 (ifdown/ifup $WAN_NET)"
            ifdown "$WAN_NET" 2>/dev/null
            pause 5
            ifup "$WAN_NET" 2>/dev/null
            pause "$REDIAL_WAIT"
            if has_v6; then
                log "重拨成功,取消重启"
            else
                now=$(date +%s)
                last=$(cat "$STAMP" 2>/dev/null || echo 0)
                case "$last" in ''|*[!0-9]*) last=0 ;; esac
                if [ $((now - last)) -lt "$COOLDOWN" ]; then
                    log "冷却期内跳过重启 (距上次 $((now - last))s)"
                else
                    echo "$now" > "$STAMP"
                    log "连续 ${MAX_FAIL} 次无 IPv6 且重拨无效,重启设备"
                    reboot
                fi
            fi
            fail=0
        fi
        pause "$FAIL_INTERVAL"
    fi
done