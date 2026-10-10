#!/bin/sh
# Build a Magisk-installable OpenWrt-on-TF package with Linux 6.18 or 7.2.
# Usage: MU300_KERNEL=6.18|7.2 MU300_INPUTS=work tools/build-openwrt-tf-magisk.sh [OUT.zip]
# The TF image includes the standalone LuCI package from openwrt/luci-app-mu300.
set -eu
TOP=$(cd "$(dirname "$0")/.." && pwd)
IN=${MU300_INPUTS:-$TOP/work}
KERNEL=${MU300_KERNEL:-7.2}
case $KERNEL in
    6.18) DEFAULT_UO=$TOP/upstream/out ;;
    7.2) DEFAULT_UO=$TOP/upstream/out-7.2 ;;
    *) echo "unsupported kernel: $KERNEL (expected 6.18 or 7.2)" >&2; exit 1 ;;
esac
UO=${MU300_UPSTREAM_OUT:-$DEFAULT_UO}
PLUGIN=${MU300_LUCI_PLUGIN_SRC:-$TOP/openwrt/luci-app-mu300}
[ -s "$PLUGIN/Makefile" ] || { echo "standalone LuCI plugin missing: $PLUGIN (set MU300_LUCI_PLUGIN_SRC)" >&2; exit 1; }
OUT=${1:-$TOP/mu300-linux-openwrt-tf-$KERNEL.zip}
case $OUT in /*) ;; *) OUT=$TOP/$OUT ;; esac
ROOTFS=$TOP/openwrt/mu300-openwrt-tf-$KERNEL-rootfs.tar.gz
BOOT=$TOP/work/boot-linux-tf-$KERNEL.img
GENERIC=$TOP/work/ramdisk-$KERNEL-tf.lz4
WRAPPED=$TOP/work/Image-$KERNEL.lk
VERSION=${MU300_VERSION:-}
[ -n "$VERSION" ] || VERSION=$(git -c safe.directory="$TOP" -C "$TOP" rev-parse --short HEAD 2>/dev/null || true)
[ -n "$VERSION" ] || VERSION=clean-tf-$KERNEL
mkdir -p "$TOP/work"

for f in dumps/boot_a.img dumps/misc-head.bin busybox tools/logdw/logdw; do
    [ -s "$IN/$f" ] || { echo "missing $IN/$f" >&2; exit 1; }
done
for f in firmware android-subset tools/bt-init/mu300-bt-init tools/keys/mu300-keys; do
    [ -e "$IN/$f" ] || { echo "required device input missing: $IN/$f" >&2; exit 1; }
done
file "$IN/tools/keys/mu300-keys" | grep -q 'ELF 64-bit.*ARM aarch64' || {
    echo "mu300-keys must be an AArch64 executable" >&2; exit 1;
}
for f in wcn_bsp.ko sprd_wlan_combo.ko sprdbt_tty.ko mali_kbase.ko; do
    [ -s "$IN/out/modules/$f" ] || { echo "missing $IN/out/modules/$f" >&2; exit 1; }
done
[ -s "$UO/Image" ] || { echo "missing Linux $KERNEL Image in $UO" >&2; exit 1; }
python3 "$TOP/upstream/check-container-support.py" "$UO"
rel=$(strings "$UO/Image" | sed -n 's/^Linux version \([^ ]*\) .*/\1/p' | head -n1)
case $rel in "$KERNEL".*) ;; *) echo "$UO is kernel '$rel', expected $KERNEL.x" >&2; exit 1 ;; esac
for m in $(cat "$TOP/upstream/module-order.txt"); do
    [ -s "$UO/modules/$m" ] || { echo "missing $KERNEL module $m" >&2; exit 1; }
done
for m in "$UO"/modules/*.ko; do
    v=$(strings "$m" | sed -n 's/^vermagic=\([^ ]*\) .*/\1/p' | head -n1)
    [ "$v" = "$rel" ] || { echo "$m is built for '$v', Image is '$rel'" >&2; exit 1; }
done
# The TF path packages modules directly rather than going through make-bundle.sh.
# Check both shared wireless modules: matching vermagic does not prove that
# the IPv6 checksum or TX-pressure logging fixes reached the built binaries.
for wireless_driver in sprd_wlan_combo wcn_bsp mu300_thermal; do
    wireless_module=$UO/modules/$wireless_driver.ko
    [ -s "$wireless_module" ] || { echo "missing $wireless_module" >&2; exit 1; }
    if [ -n "$(find "$TOP/upstream/modules/$wireless_driver" -type f -newer "$wireless_module" -print -quit)" ]; then
        echo "$wireless_driver source is newer than $wireless_module; rebuild it for $rel" >&2
        exit 1
    fi
done

echo "==> OpenWrt rootfs ($rel modules included)"
MU300_GPU=0 MU300_INPUTS="$IN" MU300_MAINLINE_OUT="$UO" MU300_LUCI_PLUGIN_SRC="$PLUGIN" \
  MU300_VERSION="$VERSION-tf-$KERNEL" \
  sh "$TOP/openwrt/build-rootfs.sh" "$(basename "$ROOTFS")"
# own: post-process the built rootfs (extra packages, defaults) when asked
[ -z "${MU300_POST_ROOTFS:-}" ] || sh "$MU300_POST_ROOTFS" "$ROOTFS"
for f in ./lib/netifd/proto/mu300cell.sh ./lib/netifd/proto/mu300cell-v6.sh \
    ./opt/mu300/bin/mu300-keys ./opt/mu300/bin/mu300-bt-init ./opt/mu300/bin/mu300-atd ./opt/mu300/bin/mu300-at \
    ./opt/mu300/bin/mu300-usb ./opt/mu300/bin/mu300-sim-env ./opt/mu300/bin/mu300-data-sim ./opt/mu300/bin/mu300-dual-radio ./etc/init.d/mu300-post ./etc/init.d/mu300-atd \
    ./etc/init.d/mu300-smsd ./opt/mu300/bin/mu300-smsd ./opt/mu300/bin/mu300-sms ./etc/sysctl.d/99-mu300-console.conf \
    ./usr/share/luci/menu.d/luci-app-mu300.json \
    ./www/luci-static/resources/view/mu300/home.js \
    ./www/luci-static/resources/mu300/refresh.js \
    ./www/luci-static/resources/view/mu300/sms.css \
    ./usr/libexec/unisoc-modem/dashboard-rates \
    ./usr/libexec/unisoc-modem/lock ./usr/libexec/unisoc-modem/boot-replay ./usr/libexec/unisoc-modem/sim-scope.sh \
    ./usr/libexec/unisoc-modem/lock-apply.sh ./usr/libexec/unisoc-modem/lock-jobs.sh \
    ./usr/libexec/unisoc-modem/traffic ./usr/libexec/unisoc-modem/traffic-core.uc \
    ./usr/libexec/unisoc-modem/hotspot ./usr/libexec/unisoc-modem/hotspot.uc \
    ./www/luci-static/resources/view/mu300/traffic.js ./etc/init.d/unisoc-traffic \
    ./www/luci-static/resources/view/mu300/cpu.js ./etc/init.d/unisoc-cpu \
    ./usr/libexec/unisoc-modem/cpu ./usr/libexec/unisoc-modem/cpu.uc \
    ./usr/libexec/unisoc-modem/cpu-thermal.uc \
    ./usr/libexec/unisoc-modem/cpu-voltage ./usr/libexec/unisoc-modem/cpu-voltage.uc \
    ./opt/mu300/bin/cpu-voltage-platform ./etc/init.d/mu300-cpu-driver \
    ./etc/rc.d/S08mu300-cpu-driver ./etc/rc.d/K89unisoc-cpu \
    ./usr/libexec/unisoc-modem/sms-forward ./usr/libexec/unisoc-modem/forward-template.uc \
    ./www/luci-static/resources/view/mu300/forward.js ./etc/init.d/unisoc-sms-forward \
    ./usr/libexec/unisoc-modem/data-sim ./www/luci-static/resources/view/mu300/sim.js \
    ./usr/libexec/unisoc-modem/operator.uc ./usr/libexec/unisoc-modem/refresh-config \
    ./www/luci-static/resources/view/mu300/device.js \
    ./usr/libexec/unisoc-modem/device-usb \
    ./etc/hotplug.d/net/90-unisoc-usb-host \
    ./etc/hotplug.d/iface/90-unisoc-usb-host \
    ./usr/lib/lua/luci/i18n/mu300.en.lmo ./usr/lib/lua/luci/i18n/mu300.tr.lmo \
    ./etc/init.d/unisoc-modem-ui ./etc/rc.d/S95unisoc-modem-ui \
    ./www/luci-static/aurora/main.css \
    ./www/luci-static/resources/view/aurora/studio.js \
    ./www/luci-static/resources/view/aurora/marketplace.js \
    ./usr/share/luci/menu.d/luci-app-aurora.json ./usr/share/rpcd/acl.d/luci-app-aurora.json \
    ./usr/lib/lua/luci/i18n/aurora-config.zh-cn.lmo ./usr/lib/lua/luci/i18n/aurora-config.tr.lmo \
    ./usr/share/ucode/luci/template/themes/aurora/header.ut; do
    tar -tzf "$ROOTFS" "$f" >/dev/null || { echo "built rootfs missing required file: $f" >&2; exit 1; }
done
tar -xOzf "$ROOTFS" ./etc/config/luci | grep -q "mediaurlbase .*/luci-static/aurora" || {
    echo "built rootfs does not enable Aurora by default" >&2; exit 1;
}
tar -tzf "$ROOTFS" "./lib/modules/$rel/sprd_wlan_combo.ko" >/dev/null || {
    echo "built rootfs missing $rel Wi-Fi module" >&2; exit 1;
}

echo "==> Linux $KERNEL boot image (installer selects the opposite slot)"
python3 "$TOP/upstream/wrap-image.py" "$UO/Image" "$WRAPPED"
python3 "$TOP/boot/build-boot-image.py" --generic-ramdisk --modules "$UO/modules" \
  --module-order "$TOP/upstream/module-order.txt" --busybox "$IN/busybox" \
  --logdw "$IN/tools/logdw/logdw" --ueventd-perms "$TOP/android-vendor/ueventd-perms.sh" \
  --out "$GENERIC" >/dev/null
python3 "$TOP/boot/build-boot-image.py" \
  --stock-boot "$IN/dumps/boot_a.img" --misc-head "$IN/dumps/misc-head.bin" \
  --kernel "$WRAPPED" --append-ramdisk "$GENERIC" --modules "$IN/out/modules" \
  --init "$TOP/boot/init" --busybox "$IN/busybox" --logdw "$IN/tools/logdw/logdw" \
  --ueventd-perms "$TOP/android-vendor/ueventd-perms.sh" \
  --android-subset "$IN/android-subset" --root-target sd --out "$BOOT" >/dev/null

STAGE=$(mktemp -d "$TOP/work/tf-magisk-stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
cp "$TOP/android/magisk/mu300-openwrt-tf/module.prop" \
   "$TOP/android/magisk/mu300-openwrt-tf/customize.sh" \
   "$TOP/android/magisk/mu300-openwrt-tf/locale.sh" \
   "$TOP/android/magisk/mu300-linux-switch/switch.sh" \
   "$TOP/tools/android-install.sh" "$TOP/tools/mu300-vendor-from-device.sh" \
   "$TOP/tools/tf-storage.sh" "$TOP/tools/tf-stage.sh" "$TOP/tools/tf-install-worker.sh" "$STAGE/"
sed -i "s/Linux 7\.2/Linux $KERNEL/g; s/KERNEL=7\.2/KERNEL=$KERNEL/g" "$STAGE/customize.sh"
sed -i "s/7\.2/$KERNEL/g" "$STAGE/module.prop"
cp "$IN/busybox" "$STAGE/busybox"
cp "$ROOTFS" "$STAGE/mu300-openwrt.tar.gz"
cp "$BOOT" "$STAGE/boot-linux.img"
(cd "$STAGE" && sha256sum boot-linux.img | cut -d' ' -f1 > boot-linux.sha256)
python3 "$TOP/tools/tf-payload-manifest.py" "$STAGE"
chmod 755 "$STAGE"/*.sh "$STAGE/busybox"
rm -f "$OUT"
python3 - "$STAGE" "$OUT" <<'PY'
import os, sys, zipfile
src, out = map(os.path.abspath, sys.argv[1:])
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for name in sorted(files):
            p = os.path.join(root, name)
            z.write(p, os.path.relpath(p, src).replace(os.sep, '/'))
PY
echo "built $OUT (kernel $rel)"
# own: sysupgrade twin (same payloads; the marker flips the installer to keep
# data instead of formatting, and the name tells the two apart in Magisk)
SYSOUT=${OUT%.zip}-sysupgrade.zip
touch "$STAGE/sysupgrade"
sed -i 's/^name=MU300 Linux OpenWrt TF deployer$/name=MU300 Linux OpenWrt TF deployer (sysupgrade)/' "$STAGE/module.prop"
sed -i 's/^version=\(.*\)$/version=\1-sysupgrade/' "$STAGE/module.prop"
rm -f "$SYSOUT"
python3 - "$STAGE" "$SYSOUT" <<'PY'
import os, sys, zipfile
src, out = map(os.path.abspath, sys.argv[1:])
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for name in sorted(files):
            p = os.path.join(root, name)
            z.write(p, os.path.relpath(p, src).replace(os.sep, '/'))
PY
echo "built $SYSOUT (kernel $rel, sysupgrade)"
