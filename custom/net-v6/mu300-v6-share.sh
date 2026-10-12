#!/bin/sh
# mu300-v6-share: 镜像 sipa_eth0 的 GUA /64 前缀到 br-lan，作为下游网关地址；
# 同时维护策略路由表，实现"同前缀挂双接口"下的正确分流（对标 Android 的
# br0 挂 ::25 + iif 策略路由）。前缀轮换时自动跟随。
#
# 触发方式（二选一，未决定仅作记录）：
#   1. 集成进 /lib/netifd/proto/mu300cell-v6.sh 的 report() 末尾调用本脚本（推荐，实时）。
#   2. 挂 /etc/hotplug.d/iface/ 的 ifup lan/wan 事件（备选，reload 后补一次）。
# 本脚本幂等：单次调用即可把状态同步到当前前缀，重复调用无副作用。
#
# 部署：复制到 /usr/local/bin/mu300-v6-share，chmod +x

SIPA_IF="sipa_eth0"
LAN_IF="br-lan"
GW_IID="25"           # 网关地址 ::25，对齐 Android（网关 + RDNSS 同址）
TABLE_WAN6="100"      # 上行表：default 走蜂窝（对标 Android sipa_eth0 表）
TABLE_LAN6="101"      # 回程表：同前缀点到下游（对标 Android local_network 表）
RULE_UP_PREF="21000"  # iif br-lan  -> wan6（对齐 Android 21000）
RULE_DN_PREF="20000"  # iif sipa_eth0 -> landev6（对齐 Android 20000 系列）

log() { logger -t mu300-v6-share "$*"; }

# 取 sipa_eth0 的 GUA 地址：只认 2000::/3（首段 2xxx/3xxx），排除 fe80 与 ULA(fdxx)
get_gua() {
    ip -6 -o addr show dev "$SIPA_IF" scope global 2>/dev/null \
        | awk '{print $4}' | cut -d/ -f1 \
        | grep -E '^2[0-9a-fA-F]{3}:|^3[0-9a-fA-F]{3}:' | head -1
}

# 取某接口已挂的 GUA 前缀（截前 4 段，即 /64 网络号）
get_old_prefix() {
    local iface="$1" addr
    addr=$(ip -6 -o addr show dev "$iface" scope global 2>/dev/null \
        | awk '{print $4}' | cut -d/ -f1 \
        | grep -E '^2[0-9a-fA-F]{3}:|^3[0-9a-fA-F]{3}:' | head -1)
    [ -n "$addr" ] && echo "$addr" | cut -d: -f1-4
}

# 保证两条策略路由规则存在（幂等：失败忽略，因为规则可能已存在）
ensure_rules() {
    ip -6 rule add iif "$LAN_IF" lookup "$TABLE_WAN6" pref "$RULE_UP_PREF" 2>/dev/null
    ip -6 rule add iif "$SIPA_IF" lookup "$TABLE_LAN6" pref "$RULE_DN_PREF" 2>/dev/null
}

gua=$(get_gua)

if [ -z "$gua" ]; then
    # 拨号丢失 IPv6：清掉 br-lan 网关地址与两个表，退回纯 ULA，不做更差
    old_prefix=$(get_old_prefix "$LAN_IF")
    if [ -n "$old_prefix" ]; then
        ip -6 addr del "${old_prefix}::${GW_IID}/64" dev "$LAN_IF" 2>/dev/null
        ip -6 route flush table "$TABLE_WAN6" 2>/dev/null
        ip -6 route flush table "$TABLE_LAN6" 2>/dev/null
        log "no GUA, removed ${old_prefix}::${GW_IID}"
    fi
    exit 0
fi

new_prefix=$(echo "$gua" | cut -d: -f1-4)
old_prefix=$(get_old_prefix "$LAN_IF")

[ "$new_prefix" = "$old_prefix" ] && exit 0

# 加新网关地址；同前缀下 ::25 若被占（DAD 冲突）则依次尝试 26..100
add_ok=0
iid="$GW_IID"
while [ "$iid" -le 100 ]; do
    if ip -6 addr add "${new_prefix}::${iid}/64" dev "$LAN_IF" 2>/dev/null; then
        add_ok=1
        new_addr="${new_prefix}::${iid}"
        break
    fi
    iid=$((iid + 1))
done
[ "$add_ok" -ne 1 ] && { log "DAD failed for ${new_prefix}::*"; exit 1; }

# 删旧前缀网关地址与旧表路由（若有），避免前缀轮换后旧 /64 路由在两张表中堆积
if [ -n "$old_prefix" ]; then
    ip -6 addr del "${old_prefix}::${GW_IID}/64" dev "$LAN_IF" 2>/dev/null
    ip -6 route del "${old_prefix}::/64" dev "$SIPA_IF" table "$TABLE_WAN6" 2>/dev/null
    ip -6 route del "${old_prefix}::/64" dev "$LAN_IF" table "$TABLE_LAN6" 2>/dev/null
fi

# 更新两张策略路由表的内容（prefix 动态，不能写死）
ip -6 route replace default via fe80::1 dev "$SIPA_IF" table "$TABLE_WAN6" 2>/dev/null
ip -6 route replace "${new_prefix}::/64" dev "$SIPA_IF" table "$TABLE_WAN6" 2>/dev/null
ip -6 route replace "${new_prefix}::/64" dev "$LAN_IF" table "$TABLE_LAN6" 2>/dev/null

ensure_rules

log "prefix ${old_prefix:-none} -> ${new_prefix}, gateway ${new_addr}"