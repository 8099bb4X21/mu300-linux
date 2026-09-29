#!/bin/sh
# Build a complete Magisk-installable OpenWrt-on-TF package.
# Usage: MU300_INPUTS=work tools/build-openwrt-tf-magisk.sh [OUT.zip]
set -eu
TOP=$(cd "$(dirname "$0")/.." && pwd)
IN=${MU300_INPUTS:-$TOP/work}
OUT=${1:-$TOP/mu300-linux-openwrt-tf.zip}
STAGE=$TOP/work/tf-magisk-stage
ROOTFS=$TOP/openwrt/mu300-openwrt-tf-rootfs.tar.gz
BOOT=$TOP/work/boot-linux-slotb-tf.img

for f in dumps/boot_a.img dumps/misc-head.bin builtin/Image busybox tools/logdw/logdw; do
    [ -s "$IN/$f" ] || { echo "missing $IN/$f" >&2; exit 1; }
done
for f in wcn_bsp.ko sprd_wlan_combo.ko sprdbt_tty.ko mali_kbase.ko; do
    [ -s "$IN/out/modules/$f" ] || { echo "missing $IN/out/modules/$f" >&2; exit 1; }
done

echo "==> OpenWrt rootfs"
if [ "${MU300_REUSE_BUILD:-0}" = 1 ] && [ -s "$ROOTFS" ]; then
    echo "reusing $ROOTFS"
else
    MU300_GPU=0 MU300_INPUTS="$IN" MU300_VERSION="$(git -c safe.directory="$TOP" -C "$TOP" rev-parse --short HEAD)-tf" \
        sh "$TOP/openwrt/build-rootfs.sh" "$(basename "$ROOTFS")"
fi

echo "==> boot_b image"
if [ "${MU300_REUSE_BUILD:-0}" = 1 ] && [ -s "$BOOT" ]; then
    echo "reusing $BOOT"
else
    python3 "$TOP/boot/build-boot-image.py" \
      --stock-boot "$IN/dumps/boot_a.img" --misc-head "$IN/dumps/misc-head.bin" \
      --kernel "$IN/builtin/Image" --modules "$IN/out/modules" --init "$TOP/boot/init" \
      --busybox "$IN/busybox" --logdw "$IN/tools/logdw/logdw" \
      --ueventd-perms "$TOP/android-vendor/ueventd-perms.sh" \
      --android-subset "$IN/android-subset" --out "$BOOT"
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$TOP/android/magisk/mu300-openwrt-tf/module.prop" \
   "$TOP/android/magisk/mu300-openwrt-tf/customize.sh" \
   "$TOP/android/magisk/mu300-linux-switch/switch.sh" \
   "$TOP/tools/android-install.sh" "$TOP/tools/mu300-vendor-from-device.sh" "$STAGE/"
cp "$IN/busybox" "$STAGE/busybox"
cp "$ROOTFS" "$STAGE/mu300-openwrt.tar.gz"
cp "$BOOT" "$STAGE/boot-linux-slotb.img"
(cd "$STAGE" && sha256sum boot-linux-slotb.img | cut -d' ' -f1 > boot-linux-slotb.sha256)
chmod 755 "$STAGE"/*.sh "$STAGE/busybox"

rm -f "$OUT"
if command -v zip >/dev/null 2>&1; then
    (cd "$STAGE" && zip -qr "$OUT" .)
else
    python3 - "$STAGE" "$OUT" <<'PY'
import os, sys, zipfile
src, out = map(os.path.abspath, sys.argv[1:])
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for name in sorted(files):
            path = os.path.join(root, name)
            z.write(path, os.path.relpath(path, src).replace(os.sep, '/'))
PY
fi
echo "built $OUT"
unzip -l "$OUT"
