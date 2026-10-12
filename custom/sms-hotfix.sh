#!/bin/sh
# own: SMS hotfix 独立文件——上游未修的两处 + 时间显示外科补丁。
# 在镜像容器内执行（路径均为容器内路径），由 post-rootfs-container.sh 调一次。
# 上游修好后的删除动作：删本文件 + post-rootfs-container.sh 里调用本文件的
#   1 行（搜 sms-hotfix）；三块可分别摘除。
#   块1 修好标志：git ls-files -s cmt-spool 显示 100755。
#   块2 修好标志：mu300-sms 自带显示时间重排（含 fmt_time 或等价）。
#   块3 修好标志：出厂 unisoc_modem 的 sms_pool 即 /etc/mu300/sms。
#
# 历史：2026-10-12 上游 a5bd3e0 已自行重组长短信（import_multipart），比本文件
#   原先的载荷（分组/暂存/扫尾）更严，该载荷与其冲突且落后，已随该更新删除；
#   这里只保留上游仍未修的两处 + 上表第 2 块（显示补丁，上游 P2 遗留）。
# 跟踪：操作/mu300-sms-fix/README.md；问题证据见 test/mu300-短信问题记录.md。
set -eu

# --- 块1：cmt-spool 执行位（上游仍 100644，自 373e191 起） ---
[ -f /opt/mu300/bin/mu300-cmt-spool ] || { echo "sms-hotfix: cmt-spool missing, upstream moved it?" >&2; exit 1; }
chmod 0755 /opt/mu300/bin/mu300-cmt-spool
[ -x /opt/mu300/bin/mu300-cmt-spool ] || { echo "sms-hotfix: cmt-spool not executable" >&2; exit 1; }

# --- 块2：时间显示统一为 AT 式 yy/MM/dd,HH:MM:SS（上游无；外科补丁，非快照） ---
# 只动显示：入库 scts 与 fingerprint 指纹一律不变。锚点：cmd_list() { 与两处
# scts=$(hdr "$f" scts)（cmd_list / cmd_show）。用 awk 字符串比较，免正则转义。
SMS=/opt/mu300/bin/mu300-sms
[ -f "$SMS" ] || { echo "sms-hotfix: mu300-sms missing, upstream moved it?" >&2; exit 1; }
if grep -q "^fmt_time() {" "$SMS" 2>/dev/null; then
    echo "sms-hotfix: fmt_time already present, block 2 skipped" >&2
else
    [ "$(grep -cF 'cmd_list() {' "$SMS" 2>/dev/null)" = 1 ] \
        || { echo "sms-hotfix: cmd_list anchor count != 1" >&2; exit 1; }
    [ "$(grep -cF 'scts=$(hdr "$f" scts)' "$SMS" 2>/dev/null)" = 2 ] \
        || { echo "sms-hotfix: scts anchor count != 2" >&2; exit 1; }
    fn=$(mktemp) || exit 1
    prog=$(mktemp) || { rm -f "$fn"; exit 1; }
    cat > "$fn" <<'FMTFN'
# 收发时间统一显示为 AT 式 yy/MM/dd,HH:MM:SS（发送侧形状）。
# MT 的 PDU SCTS 自带时区（"YYYY-MM-DD HH:MM:SS±HH:MM"），此处仅重排版式、
# 不做换算（同一运营商网络时区，壁钟即本地时间）；已是 AT 式的原样返回。
# 注意：只用于 list/show 显示，入库的 scts 与 fingerprint 指纹一律不动。
fmt_time() {
    case $1 in
        ????-??-??' '??:??:??*)
            printf '%s' "$1" | sed 's/^..\(..\)-\(..\)-\(..\) \(..\):\(..\):\(..\).*/\1\/\2\/\3,\4:\5:\6/' ;;
        *) printf '%s' "$1" ;;
    esac
}
FMTFN
    cat > "$prog" <<'FMTOSW'
FNR==NR { fn = fn $0 "\n"; next }
$0 == "cmd_list() {" && !done { printf "%s", fn; done=1 }
$0 == "        scts=$(hdr \"$f\" scts)" { print "        scts=$(fmt_time \"$(hdr \"$f\" scts)\")"; next }
{
    p = "    scts=$(hdr \"$f\" scts)"
    if (index($0, p) == 1) { print "    scts=$(fmt_time \"$(hdr \"$f\" scts)\")" substr($0, length(p)+1); next }
}
{ print }
FMTOSW
    awk -f "$prog" "$fn" "$SMS" > "$SMS.new" || { rm -f "$fn" "$prog" "$SMS.new"; echo "sms-hotfix: awk patch failed" >&2; exit 1; }
    rm -f "$fn" "$prog"
    sh -n "$SMS.new" || { echo "sms-hotfix: patched mu300-sms broken" >&2; rm -f "$SMS.new"; exit 1; }
    [ "$(grep -c '^fmt_time() {' "$SMS.new" 2>/dev/null)" = 1 ] || { echo "sms-hotfix: fmt_time not inserted once" >&2; rm -f "$SMS.new"; exit 1; }
    [ "$(grep -c 'fmt_time "' "$SMS.new" 2>/dev/null)" = 2 ] || { echo "sms-hotfix: fmt_time call sites != 2" >&2; rm -f "$SMS.new"; exit 1; }
    mv "$SMS.new" "$SMS"
fi

# --- 块3：UI 默认池指向 kano 池（上游仍 /etc/unisoc-modem/sms） ---
# 直接改出厂配置：新刷机生效；sysupgrade 保留配置时沿用旧值（那台机器用运行时
# uci set 处理，不在本文件范围）。
if grep -q "option sms_pool '/etc/unisoc-modem/sms'" /etc/config/unisoc_modem 2>/dev/null; then
    sed -i "s|option sms_pool '/etc/unisoc-modem/sms'|option sms_pool '/etc/mu300/sms'|" /etc/config/unisoc_modem
fi
grep -q "option sms_pool '/etc/mu300/sms'" /etc/config/unisoc_modem \
    || { echo "sms-hotfix: sms_pool not pointing at kano pool" >&2; exit 1; }

echo "sms-hotfix: done"