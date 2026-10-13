#!/bin/sh
# own: Wi-Fi 热点开关 hotfix —— network.reload 空应答被误判失败。
# 现象：LuCI 开/关热点都报"热点配置已保存，但应用失败，请重试"，但 uci 其实已
# 提交、netifd 也已重载。根因见 hotspot.uc set() 的 reload 回调要求 ubus 回非
# null JSON，而 netifd 的 network.reload 成功时 vốn 回空（ucode 探针实证：
# bus 正常连接、reply 为 null；且 bus.call 失败也不抛异常只回 null）。
# 修法：只认"bus 还活着 + 调用已发出"为成功，与 radio/data 两路 fire-and-forget
# 对齐；真死 bus 仍返回 false。UI 收到 pending 后本来就会轮询真实状态自纠。
# 在镜像容器内执行（路径均为容器内路径），由 post-rootfs-container.sh 调一次。
# 上游修好后的删除动作：删本文件 + post-rootfs-container.sh 里调用本文件的
#   1 行（搜 wifi-hotfix）。两块可分别摘除：
#   块A（dispatcher 空应答）修好标志：上游不再要求 reload 回非 null。
#   块B（uc 开关对等）修好标志：上游关也写 radio disabled。
set -eu

# --- 块A：dispatcher 空应答（见文件头） ---

F=/usr/libexec/unisoc-modem/hotspot
[ -f "$F" ] || { echo "wifi-hotfix: hotspot dispatcher missing, upstream moved it?" >&2; exit 1; }
# 已打过补丁则跳过本块（幂等；重刷/重跑不叠加；不早退，后面各块各自判断）
if ! grep -qF 'if (bus==null) return false;' "$F" 2>/dev/null; then
# 锚点断言（上游改写回调即炸，不静默）：两行必须各出现恰好一次
[ "$(grep -cF "let result=bus?.call('network','reload',{});" "$F" 2>/dev/null)" = 1 ] \
    || { echo "wifi-hotfix: reload anchor gone" >&2; exit 1; }
[ "$(grep -cF 'return result!=null;' "$F" 2>/dev/null)" = 1 ] \
    || { echo "wifi-hotfix: return anchor gone" >&2; exit 1; }
prog=$(mktemp) || exit 1
cat > "$prog" <<'WIFIFIX'
$0 == "                let result=bus?.call('network','reload',{});" {
    print "                // network.reload answers empty on success, so a null reply"
    print "                // is not a failure (ubus never throws here); only a dead"
    print "                // bus is. Matches the fire-and-forget radio/data ops."
    print "                if (bus==null) return false;"
    print "                bus.call('network','reload',{});"
    print "                return true;"
    next
}
$0 == "                return result!=null;" { next }
{ print }
WIFIFIX
awk -f "$prog" "$F" > "$F.new" || { rm -f "$prog" "$F.new"; echo "wifi-hotfix: awk patch failed" >&2; exit 1; }
rm -f "$prog"
[ "$(grep -cF 'if (bus==null) return false;' "$F.new" 2>/dev/null)" = 1 ] \
    || { echo "wifi-hotfix: patched block not exactly once" >&2; rm -f "$F.new"; exit 1; }
grep -qF 'return result!=null;' "$F.new" 2>/dev/null \
    && { echo "wifi-hotfix: old line still present" >&2; rm -f "$F.new"; exit 1; }
chmod --reference="$F" "$F.new" 2>/dev/null || chmod 0755 "$F.new"
mv "$F.new" "$F"
fi

# --- 块B：hotspot.uc 开关对等（关也写 radio disabled=1） ---
# 原来关只写 section，不断 radio 会留下半开状态（section 关、radio 开）。
# 注意：同 radio 若有其他启用的接口会被连带关闭，本机只有一个 AP，可接受。
FU=/usr/libexec/unisoc-modem/hotspot.uc
[ -f "$FU" ] || { echo "wifi-hotfix: hotspot.uc missing, upstream moved it?" >&2; exit 1; }
grep -qF 'on/off 对等' "$FU" 2>/dev/null && { echo "wifi-hotfix: uc already patched" >&2; }
if ! grep -qF 'on/off 对等' "$FU" 2>/dev/null; then
[ "$(grep -cF "    if(!c.set('wireless',ap.section,'disabled',on?'0':'1') ||" "$FU" 2>/dev/null)" = 1 ] \
    || { echo "wifi-hotfix: uc if anchor gone" >&2; exit 1; }
[ "$(grep -cF "(on && disabled && !c.set('wireless',ap.radio,'disabled','0'))) {" "$FU" 2>/dev/null)" = 1 ] \
    || { echo "wifi-hotfix: uc anchor gone" >&2; exit 1; }
uprog=$(mktemp) || exit 1
cat > "$uprog" <<'WIFIUC'
# buffered two-line replace: keep the `if(...section...) ||` line, swap only the
# radio half, and put the note above the whole statement (byte-identical to the
# live-proven layout). Adjacency is enforced: anything else between them aborts.
$0 == "    if(!c.set('wireless',ap.section,'disabled',on?'0':'1') ||" { first=$0; next }
{
    if (first != "") {
        if ($0 != "        (on && disabled && !c.set('wireless',ap.radio,'disabled','0'))) {") { print "wifi-hotfix: uc anchor drift" > "/dev/stderr"; exit 1 }
        print "    // on/off 对等：开关同时写 section 与 radio，关不断 radio 会留下半开状态"
        print first
        print "        !c.set('wireless',ap.radio,'disabled',on?'0':'1')) {"
        first=""; next
    }
    print
}
END { if (first != "") { print "wifi-hotfix: uc anchor drift" > "/dev/stderr"; exit 1 } }
WIFIUC
awk -f "$uprog" "$FU" > "$FU.new" || { rm -f "$uprog" "$FU.new"; echo "wifi-hotfix: uc awk patch failed" >&2; exit 1; }
rm -f "$uprog"
[ "$(grep -cF 'on/off 对等' "$FU.new" 2>/dev/null)" = 1 ] \
    || { echo "wifi-hotfix: uc patched block not exactly once" >&2; rm -f "$FU.new"; exit 1; }
grep -qF "(on && disabled && !c.set('wireless',ap.radio,'disabled','0'))) {" "$FU.new" 2>/dev/null \
    && { echo "wifi-hotfix: uc old line still present" >&2; rm -f "$FU.new"; exit 1; }
chmod --reference="$FU" "$FU.new" 2>/dev/null || chmod 0755 "$FU.new"
mv "$FU.new" "$FU"
fi
echo "wifi-hotfix: done"