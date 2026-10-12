#!/bin/sh
# own: SMS hotfix 独立文件——直收/长短信/LuCI 三处上游 bug 的包内修复。
# 在镜像容器内执行（路径均为容器内路径），由 post-rootfs-container.sh 调一次。
# 上游修好后的删除动作：删本文件 + custom/sms/ 目录 +
#   post-rootfs-container.sh 里调用本文件的 1 行（搜 sms-hotfix）。
# 跟踪：操作/mu300-sms-fix/README.md（部署源 md5 清单），
#   test/mu300-短信问题记录.md（P0/P1/P2），test/mu300-短信源码修复方案.md。
set -eu

# --- 块1：cmt-spool 执行位（P0-1；上游 git 里 100644，从 373e191 起） ---
# 上游修好标志：git ls-files -s 显示 100755。届时删本块。
[ -f /opt/mu300/bin/mu300-cmt-spool ] || { echo "sms-hotfix: cmt-spool missing, upstream moved it?" >&2; exit 1; }
[ -f /opt/mu300/bin/mu300-sms ] || { echo "sms-hotfix: mu300-sms missing, upstream moved it?" >&2; exit 1; }
[ -f /opt/mu300/bin/mu300-smsd ] || { echo "sms-hotfix: mu300-smsd missing, upstream moved it?" >&2; exit 1; }
chmod 0755 /opt/mu300/bin/mu300-cmt-spool /opt/mu300/bin/mu300-sms /opt/mu300/bin/mu300-smsd

# --- 块2：部署验证过的两脚本（P1；上游 mu300-sms 无分组显示/暂存凑齐） ---
# 上游修好标志：上游 mu300-sms 自带分组显示 + pending/sweep。届时删本块及 custom/sms/。
# 载荷一致性（线上验证版 md5，见 mu300-sms-fix/README.md 文件清单）：
md5sum /in/custom/sms/mu300-sms | grep -q '^304efa5bb060acd1bffb8a3c4c68d7dc ' \
    || { echo "sms-hotfix: payload mu300-sms mismatch" >&2; exit 1; }
md5sum /in/custom/sms/mu300-smsd | grep -q '^6783fd2a13b177c91323a42782fa8fa2 ' \
    || { echo "sms-hotfix: payload mu300-smsd mismatch" >&2; exit 1; }
cp /in/custom/sms/mu300-sms /opt/mu300/bin/mu300-sms
cp /in/custom/sms/mu300-smsd /opt/mu300/bin/mu300-smsd
chmod 0755 /opt/mu300/bin/mu300-sms /opt/mu300/bin/mu300-smsd

# --- 块3：UI 默认池指向 kano 池（P0-2；上游默认 /etc/unisoc-modem/sms） ---
# 上游修好标志：root/etc/config/unisoc_modem 出厂即 /etc/mu300/sms。届时删本块。
# 注：直接改出厂配置，新刷机生效；sysupgrade 保留配置时沿用旧值
#（那台机器用运行时 uci set 处理，不在本文件范围）。
if grep -q "option sms_pool '/etc/unisoc-modem/sms'" /etc/config/unisoc_modem 2>/dev/null; then
    sed -i "s|option sms_pool '/etc/unisoc-modem/sms'|option sms_pool '/etc/mu300/sms'|" /etc/config/unisoc_modem
fi
grep -q "option sms_pool '/etc/mu300/sms'" /etc/config/unisoc_modem \
    || { echo "sms-hotfix: sms_pool not pointing at kano pool" >&2; exit 1; }

echo "sms-hotfix: done"
