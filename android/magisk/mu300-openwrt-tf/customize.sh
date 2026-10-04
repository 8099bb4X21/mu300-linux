#!/system/bin/sh
# Magisk sources this file into its own installer shell. Restore its original
# options before returning, or our nounset/errexit can break Magisk cleanup
# after the TF and boot slot were already written successfully.
MU300_INSTALLER_SHELLOPTS=$-
set -eu
SKIPUNZIP=0
. "$MODPATH/locale.sh"
MU300_INSTALL_LANG=$(mu300_install_lang)
export MU300_INSTALL_LANG
ui_msg() { if [ "$MU300_INSTALL_LANG" = zh ]; then ui_print "$1"; else ui_print "$2"; fi; }
ui_fail() { if [ "$MU300_INSTALL_LANG" = zh ]; then abort "$1"; else abort "$2"; fi; }
ui_print "********************************"
ui_msg " MU300 OpenWrt TF 卡部署 + Linux 7.2" " MU300 OpenWrt TF + Linux 7.2"
ui_print "********************************"
ui_msg "- 仅写入 TF 卡、Android 当前槽位的另一槽及 misc 中的 32 字节" \
       "- Writes only the TF card, the slot opposite Android and 32 bytes of misc"
BB=$MODPATH/busybox
chmod 755 "$BB" "$MODPATH"/*.sh
[ "$(id -u)" = 0 ] || ui_fail "! 需要 root 权限" "! root is required"
slot=$(getprop ro.boot.slot_suffix | "$BB" tr -d _)
case $slot in a) linux_slot=b ;; b) linux_slot=a ;; *) ui_fail "! 无法识别 Android 启动槽位：$slot" "! Android boot slot is unknown: $slot" ;; esac
bootdev=/dev/block/by-name/boot_$linux_slot
[ -b "$bootdev" ] || ui_fail "! 找不到 boot_$linux_slot 分区" "! boot_$linux_slot was not found"
R=/dev/block/mmcblk1p1
[ -b "$R" ] || R=/dev/block/mmcblk1
[ -b "$R" ] || ui_fail "! 未找到 TF 卡" "! TF card was not found"
cat > "$MODPATH/mu300-install.env" <<EOF
SD_MODE=1
SD_DEV=$R
FORMAT=1
OSES="openwrt"
WIPE_LEGACY=0
UPDATE=0
BOOT_OS=openwrt
DEFAULT_LINUX=1
BOOT_ATTEMPTS=5
IMPORT_HOTSPOT=1
KERNEL=7.2
PWHASH=''
EOF
ui_msg "- 正在将 OpenWrt 根文件系统安装到 $R" "- Installing OpenWrt rootfs to $R"
MU300_PAYLOAD_DIR="$MODPATH" MU300_INSTALL_TMP=/data/local/tmp/mu300-tf-install \
MU300_VENDOR_FROM_DEVICE=1 MU300_KEEP_PAYLOAD=1 \
    sh "$MODPATH/android-install.sh" || ui_fail "! TF 卡根文件系统安装失败；启动分区未改动" \
                                                  "! TF rootfs installation failed; boot partitions were not changed"
IMG=$MODPATH/boot-linux.img
want=$(cat "$MODPATH/boot-linux.sha256")
have=$("$BB" sha256sum "$IMG" | "$BB" cut -d' ' -f1)
[ "$have" = "$want" ] || ui_fail "! 安装包中的启动镜像校验失败" "! packaged boot image checksum mismatch"
ui_msg "- 正在写入并校验 boot_$linux_slot" "- Writing and verifying boot_$linux_slot"
"$BB" dd if="$IMG" of="$bootdev" bs=4M 2>/dev/null || ui_fail "! 写入 boot_$linux_slot 失败" "! writing boot_$linux_slot failed"
sync
bytes=$("$BB" stat -c %s "$IMG")
back=$("$BB" dd if="$bootdev" bs=1M count=$(( (bytes + 1048575) / 1048576 )) 2>/dev/null | \
       "$BB" head -c "$bytes" | "$BB" sha256sum | "$BB" cut -d' ' -f1)
[ "$back" = "$want" ] || ui_fail "! boot_$linux_slot 校验失败；misc 未改动" \
                                "! boot_$linux_slot verification failed; misc was not changed"
ui_msg "- 正在设置下次从 $linux_slot 槽位启动" "- Arming slot $linux_slot"
MU300_BUSYBOX="$BB" MAGISKTMP=${MAGISKTMP:-/data/adb/magisk} \
    sh "$MODPATH/switch.sh" --no-reboot || ui_fail "! 无法设置启动槽位" "! boot slot could not be armed"
ui_msg "- 安装完成；重启后进入 OpenWrt" "- Installation complete; reboot to enter OpenWrt"
ui_msg "- 如果 Linux 启动失败，设备会自动返回 Android" \
       "- A failed Linux boot automatically returns to Android"
rm -f "$MODPATH/mu300-openwrt.tar.gz" "$MODPATH/boot-linux.img" "$MODPATH/busybox"
case $MU300_INSTALLER_SHELLOPTS in *e*) ;; *) set +e ;; esac
case $MU300_INSTALLER_SHELLOPTS in *u*) ;; *) set +u ;; esac
unset MU300_INSTALLER_SHELLOPTS
