#!/system/bin/sh
# Device side of install.sh (runs as root on Android). Settings come from /data/local/tmp/mu300-install.env:
#   SD_MODE=0          rootfs in the free eMMC region after the last GPT partition
#   SD_MODE=1 SD_DEV   rootfs on the full selected TF partition, ext4 mu300sd
#   OFF SIZE           free eMMC region (bytes) after the last GPT partition, as strings (SD_MODE=0)
#   OFF_S SIZE_S       the same in 512-byte sectors (Android's mksh has 32-bit arithmetic: never compute with bytes)
#   FORMAT=0|1         create ext4 mu300root internally or mu300sd on TF
#   OSES="ubuntu openwrt"  systems to (re)install from /data/local/tmp/mu300-<os>.tar.gz
#                      (plus mu300-vendor-<os>.tar.gz with the device's own vendor files for prebuilt images)
#   WIPE_LEGACY=0|1    remove a first-generation Ubuntu that lives directly in the filesystem root
#   UPDATE=0|1         keep the settings and user data of the systems being reinstalled
#   BOOT_OS            system started by the initramfs
#   DEFAULT_LINUX=0|1  keep booting Linux (otherwise every Linux boot is one-shot and returns to Android)
#   BOOT_ATTEMPTS=1-6  with DEFAULT_LINUX=1: failed boots in a row before Android (.mu300/boot-attempts)
#   PWHASH             SHA-512 crypt hash for the "ubuntu" (Ubuntu) and "root" (OpenWrt) accounts
#   IMPORT_HOTSPOT=0|1 copy Android's hotspot SSID/passphrase into each system
#   KERNEL=5.4|6.18|7.2  the kernel in the new boot image; mu300-update keeps installing that one (boot/kernel)
set -e
T=${MU300_INSTALL_TMP:-/data/local/tmp}
P=${MU300_PAYLOAD_DIR:-$T}
. "$P/mu300-install.env"
M=$T/mu300root
say() { echo "[device] $*"; }
say_i18n() { if [ "${MU300_INSTALL_LANG:-en}" = zh ]; then say "$1"; else say "$2"; fi; }

if [ "${SD_MODE:-0}" = 1 ]; then
    . "$P/tf-storage.sh"
    mkdir -p "$T"
    if [ -n "${MU300_TF_STATE:-}" ]; then
        read -r required_kib required_inodes < "$P/rootfs.requirements"
    fi
    R=${SD_DEV:?SD_DEV is not set}
    [ -b "$R" ] || { say_i18n "找不到块设备 $R（TF 卡是否已插入？）" \
                                    "no block device $R (is the TF card inserted?)"; exit 1; }
    # Never touch an eMMC free-region candidate from the SD branch.
    tf_release "$R"
    tf_read_super "$R" || { tf_die 'failed/short TF superblock read'; exit 1; }
    magic=$(dd if="$T/tf-super" bs=1 skip=1080 count=2 2>/dev/null | od -An -tx1 | tr -d ' \n')
    label=$(dd if="$T/tf-super" bs=1 skip=1144 count=16 2>/dev/null | tr -d '\000')
    if [ "$FORMAT" = 1 ]; then
        [ "$magic" != 53ef ] || [ "$label" = mu300sd ] || {
            say_i18n "拒绝格式化非 mu300sd 的 ext4 文件系统 '$label'" \
                     "refusing to format foreign ext4 filesystem '$label'"; exit 1; }
        say_i18n "正在 $R 创建 ext4 mu300sd（使用所选分区全部容量）" \
                 "creating ext4 mu300sd on $R (full selected partition capacity)"
        # make_ext4fs creates large cards very slowly and can fail on 128 GiB
        # media. Use e2fsprogs' lazy metadata initialization and one inode per
        # MiB (still plenty for OpenWrt) so formatting touches only metadata,
        # not the whole card. nodiscard avoids a full-card erase on slow TFs.
        # Magisk runs customize.sh in BusyBox standalone mode: bare mke2fs
        # resolves to BusyBox's ext2-only applet, even when Android's real
        # e2fsprogs is installed. An absolute path bypasses that interception.
        if [ -x /system/bin/mke2fs ]; then
            # Explicit minimum inode count for small TFs; large cards retain
            # the sparse 1 MiB/inode layout. No filesystem-size argument/cap.
            inode_args=
            if [ -n "${MU300_TF_STATE:-}" ]; then
                read -r required_kib required_inodes < "$P/rootfs.requirements"
                [ $((tf_sectors / 2048)) -ge $((required_inodes + 1024)) ] || inode_args="-N $((required_inodes + 1024))"
            fi
            /system/bin/mke2fs -t ext4 -F -b 4096 -m 0 -i 1048576 \
                $inode_args \
                -E lazy_itable_init=1,lazy_journal_init=1,nodiscard \
                -L mu300sd "$R" || { say_i18n '快速创建 ext4 文件系统失败' \
                                                         'optimized ext4 format failed'; exit 1; }
        else
            say_i18n '缺少 Android 的 /system/bin/mke2fs，无法可靠地格式化 TF 卡' \
                     'Android /system/bin/mke2fs is required for reliable TF formatting'
            exit 1
        fi
    elif [ "$magic" != 53ef ] || [ "$label" != mu300sd ]; then
        say_i18n "$R 上没有 mu300sd 文件系统（需要 FORMAT=1）" \
                 "no mu300sd filesystem on $R (FORMAT=1 is required)"; exit 1
    fi
    mkdir -p "$M"
    mount -t ext4 -o noatime "$R" "$M"
    # On failure do not global-sync or launch a second I/O request into a
    # possibly wedged card. The bounded Magisk worker leaves a reboot lock.
    if [ -n "${MU300_TF_STATE:-}" ]; then
        free_kib=$(df -Pk "$M" | awk 'END {print $4}')
        free_inodes=$(df -Pi "$M" | awk 'END {print $4}')
        [ "$free_kib" -ge "$required_kib" ] && [ "$free_inodes" -ge "$required_inodes" ] || {
            tf_die 'insufficient usable space/inodes after format'; exit 1;
        }
    fi
else
# --- the region must not overlap any partition (checked again here, on the device itself)
end=0
for p in /sys/block/mmcblk0/mmcblk0p*; do
    e=$(( $(cat $p/start) + $(cat $p/size) ))
    [ $e -gt $end ] && end=$e
done
disk=$(cat /sys/block/mmcblk0/size)
[ "$SIZE_S" -ge 8 ] && [ "$OFF_S" -ge $end ] && [ "$OFF_S" -lt "$disk" ] && \
    [ "$SIZE_S" -le $((disk - 34 - OFF_S)) ] || { say "region overlaps partitions or the backup GPT"; exit 1; }

attach() {
    for o in /sys/block/loop*/loop/offset; do
        [ "$(cat $o 2>/dev/null)" = "$OFF" ] && { say "region already attached (${o%/loop/offset})"; exit 1; }
    done
    f=$(losetup -f 2>&1 | grep -o '/dev/block/loop[0-9]*' | head -1); n=${f##*loop}
    L=/dev/block/loop$n
    [ -b "$L" ] || mknod "$L" b $(cut -d: -f1 /sys/block/loop$n/dev) $(cut -d: -f2 /sys/block/loop$n/dev) 2>/dev/null || [ -b "$L" ]
    losetup -o $OFF -S $SIZE "$L" /dev/block/mmcblk0
    [ "$(cat /sys/block/loop$n/loop/offset)" = "$OFF" ] && [ "$(blockdev --getsize64 $L)" = "$SIZE" ] || { losetup -d $L; say "loop setup mismatch"; exit 1; }
}

sb() { dd if=/dev/block/mmcblk0 bs=512 skip=$OFF_S count=4 2>/dev/null | dd bs=1 skip=$1 count=$2 2>/dev/null; }
magic=$(sb 1080 2 | od -An -tx1 | tr -d ' \n')
label=$(sb 1144 16 | tr -d '\000')
if [ "$FORMAT" = 1 ]; then
    if [ "$magic" = 53ef ] && [ "$label" != mu300root ]; then say "refusing to format: foreign ext4 ($label) in the region"; exit 1; fi
    attach
    say "creating ext4 mu300root on $L ($((SIZE_S / 2048)) MiB)"
    mke2fs -t ext4 -L mu300root -F "$L" >/dev/null
    losetup -d "$L"
elif [ "$magic" != 53ef ] || [ "$label" != mu300root ]; then
    say "no mu300root filesystem in the region (run with FORMAT=1)"; exit 1
fi

MU300_OFF=$OFF MU300_SIZE=$SIZE sh $T/android-mount-mu300root.sh $M
trap 'sync; sh $T/android-mount-mu300root.sh -u $M >/dev/null 2>&1; true' EXIT
fi

if [ "$WIPE_LEGACY" = 1 ] && { [ -x $M/lib/systemd/systemd ] || [ -L $M/lib ]; }; then
    say "removing the root-level Ubuntu"
    for e in $M/* $M/.[!.]*; do
        case "${e##*/}" in lost+found|.mu300|ubuntu|openwrt) ;; *) rm -rf "$e" ;; esac
    done
fi

ssid=; psk=
if [ "$IMPORT_HOTSPOT" = 1 ]; then
    X=/data/misc/apexdata/com.android.wifi/WifiConfigStoreSoftAp.xml
    ssid=$(sed -n 's/.*<string name="WifiSsid">&quot;\(.*\)&quot;<\/string>.*/\1/p; s/.*<string name="WifiSsid">\([^&<]*\)<\/string>.*/\1/p' $X 2>/dev/null | head -1)
    psk=$(sed -n 's/.*<string name="Passphrase">\(.*\)<\/string>.*/\1/p' $X 2>/dev/null | head -1 | sed "s/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/\"/g; s/&apos;/'/g")
    [ -n "$ssid" ] && [ ${#psk} -ge 8 ] || { say_i18n "无法读取可用的 Android 热点配置，将生成随机密码" \
                                                    "no usable Android hotspot config, a random password will be generated"; ssid=; psk=; }
fi

for os in $OSES; do
    tarball=$P/mu300-$os.tar.gz
    [ -f $tarball ] || { say_i18n "缺少 $tarball" "missing $tarball"; exit 1; }
    say_i18n "正在安装 $os" "installing $os"
    rm -rf $M/$os.new && mkdir $M/$os.new
    tar -xzpf $tarball -C $M/$os.new
    if [ -n "${MU300_TF_STATE:-}" ]; then
        (cd "$M/$os.new" && sha256sum -c "$P/rootfs-critical.sha256")
        [ -L "$M/$os.new/sbin/init" ] || [ -x "$M/$os.new/sbin/init" ]
    fi
    # prebuilt images: firmware and Android userspace pulled from this device by install.sh (tools/vendor-overlay.py)
    if [ -f $P/mu300-vendor-$os.tar.gz ]; then
        tar -xzpf $P/mu300-vendor-$os.tar.gz -C $M/$os.new
        [ "${MU300_KEEP_PAYLOAD:-0}" = 1 ] || rm -f $P/mu300-vendor-$os.tar.gz
    elif [ -n "${MU300_PREPARED_VENDOR:-}" ]; then
        # Do not merge stale property snapshots/libraries from the build device
        # with this device's vendor tree.
        rm -rf "$M/$os.new/opt/mu300/android"
        cp -a "$MU300_PREPARED_VENDOR/." "$M/$os.new/"
        (cd "$M/$os.new" && sha256sum -c "$MU300_TF_STATE/vendor.sha256" >/dev/null)
    elif [ "${MU300_VENDOR_FROM_DEVICE:-0}" = 1 ]; then
        sh "$P/mu300-vendor-from-device.sh" "$M/$os.new" "$os"
    fi
    # update: carry the settings and user data of the previous installation over to the new system
    if [ "${UPDATE:-0}" = 1 ] && [ -d $M/$os ]; then
        case $os in
            ubuntu) keep="etc/mu300 etc/ssh etc/hostname etc/localtime etc/timezone etc/fstab home root srv usr/local var/lib/bluetooth" ;;
            openwrt) keep="etc/config etc/mu300 etc/dropbear etc/rc.local root" ;;
        esac
        kept=
        for k in $keep; do
            [ -e "$M/$os/$k" ] || continue
            mkdir -p "$M/$os.new/$(dirname $k)"
            rm -rf "$M/$os.new/$k"
            cp -a "$M/$os/$k" "$M/$os.new/$k" && kept="$kept $k"
        done
        # services the user enabled or disabled themselves: copy the extra symlinks over, but only when the unit
        # they point at exists in the new system (stale units from an older release must not come back)
        extra=
        case $os in
            ubuntu)
                for w in $M/$os/etc/systemd/system/*.wants; do
                    [ -d "$w" ] || continue
                    t=${w##*/}
                    for l in "$w"/*; do
                        # -L, not -e: the links point at absolute paths inside the Linux root, so from Android
                        # they all look broken
                        [ -L "$l" ] || [ -e "$l" ] || continue
                        u=${l##*/}
                        if [ -L "$M/$os.new/etc/systemd/system/$t/$u" ]; then continue; fi
                        [ -e "$M/$os.new/etc/systemd/system/$u" ] || [ -e "$M/$os.new/usr/lib/systemd/system/$u" ] || continue
                        mkdir -p "$M/$os.new/etc/systemd/system/$t"
                        cp -a "$l" "$M/$os.new/etc/systemd/system/$t/$u" && extra="$extra $u"
                    done
                done ;;
            openwrt)
                for l in $M/$os/etc/rc.d/*; do
                    [ -L "$l" ] || [ -e "$l" ] || continue
                    u=${l##*/}
                    if [ -L "$M/$os.new/etc/rc.d/$u" ]; then continue; fi
                    [ -x "$M/$os.new/etc/init.d/${u#S??}" ] || [ -x "$M/$os.new/etc/init.d/${u#K??}" ] || continue
                    cp -a "$l" "$M/$os.new/etc/rc.d/$u" && extra="$extra $u"
                done ;;
        esac
        say_i18n "已保留先前 $os 的配置：$kept" "kept from the previous $os:$kept"
        [ -n "$extra" ] && say_i18n "已保留启用的服务：$extra" "kept enabled services:$extra"
    fi
    # Configure and validate the staged tree before publishing its name.
    R=$M/$os.new
    [ "${SD_MODE:-0}" = 1 ] && [ -f $R/etc/fstab ] && \
        sed -i 's|LABEL=mu300root|LABEL=mu300sd|' $R/etc/fstab
    mkdir -p $R/etc/mu300
    if [ -n "$ssid" ] && ! { [ "${UPDATE:-0}" = 1 ] && [ -s $R/etc/mu300/hotspot.conf ]; }; then
        umask 077
        printf 'SSID=%s\nPSK=%s\nBAND=5\nCHANNEL=auto\nCOUNTRY=TR\n' "$ssid" "$psk" > $R/etc/mu300/hotspot.conf
        chmod 600 $R/etc/mu300/hotspot.conf
        umask 022
    fi
    if [ "$DEFAULT_LINUX" = 1 ]; then echo linux > $R/etc/mu300/default-boot; else rm -f $R/etc/mu300/default-boot; fi
    if [ -n "$PWHASH" ]; then
        rm -f $R/etc/.mu300-accounts-from-image   # the password is the one just chosen, not one to carry over
        case $os in
            ubuntu) sed -i "s|^ubuntu:[^:]*:|ubuntu:$PWHASH:|" $R/etc/shadow ;;
            openwrt) sed -i "s|^root:[^:]*:|root:$PWHASH:|" $R/etc/shadow ;;
        esac
    fi
    rm -rf "$M/$os" && mv "$M/$os.new" "$M/$os"
    [ "${MU300_KEEP_PAYLOAD:-0}" = 1 ] || rm -f $tarball
done
mkdir -p $M/.mu300
echo "$BOOT_OS" > $M/.mu300/boot-os
case ${BOOT_ATTEMPTS:-} in [1-6]) echo "$BOOT_ATTEMPTS" > $M/.mu300/boot-attempts ;; esac
case ${KERNEL:-5.4} in
    5.4|6.18|7.2) mkdir -p $M/boot; echo "${KERNEL:-5.4}" > $M/boot/kernel; echo "${KERNEL:-5.4}" > $M/boot/installed.kernel ;;
esac
# the boot image is the installer's now: a release tag left by an earlier mu300-update would describe another one
rm -f $M/boot/installed.tag
[ -n "$ssid" ] && say_i18n "热点：已导入 SSID $ssid（密码 ${#psk} 位）" \
                             "hotspot: SSID $ssid imported (passphrase ${#psk} chars)"
installed=$(ls -d $M/ubuntu $M/openwrt 2>/dev/null | sed "s|$M/||g" | tr '\n' ' ')
say_i18n "已安装：${installed}启动系统=$BOOT_OS 默认启动 Linux=$DEFAULT_LINUX" \
         "installed: ${installed}boot-os=$BOOT_OS default-linux=$DEFAULT_LINUX"
[ "${MU300_KEEP_PAYLOAD:-0}" = 1 ] || rm -f $P/mu300-install.env
if [ "${SD_MODE:-0}" = 1 ]; then
    say_i18n '正在刷盘、卸载并回读 TF 文件系统' 'flushing, unmounting and reading back TF filesystem'
    # umount performs filesystem writeback and reports failure. A read-only
    # remount checks the published tree before any boot partition is written.
    umount "$M"
    if [ -n "${MU300_TF_STATE:-}" ]; then
        mount -t ext4 -o ro,noload "$SD_DEV" "$M"
        (cd "$M/openwrt" && sha256sum -c "$P/rootfs-critical.sha256")
        if [ -n "${MU300_PREPARED_VENDOR:-}" ]; then
            (cd "$M/openwrt" && sha256sum -c "$MU300_TF_STATE/vendor.sha256" >/dev/null)
        fi
        [ "$(cat "$M/.mu300/boot-os")" = "$BOOT_OS" ]
        [ "$(cat "$M/openwrt/etc/mu300/default-boot")" = linux ]
        umount "$M"
    fi
else
    # Also make the legacy path's success marker mean unmount has finished.
    sh "$T/android-mount-mu300root.sh" -u "$M"
    trap - EXIT
fi
echo MU300-INSTALL-OK   # install.sh checks for this line (set -e stops before it on any failure)
