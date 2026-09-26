#!/bin/bash
# Inner build script, runs inside the mu300-kbuild container.
# Source: /src/zte-u30air (WSL ~/mu300-kernel/zte-u30air, from the pinned tarball).
# /work = the repo's kernel/ directory (patches, configs, module-order, map-builtin.py).
set -eu
cd /src/zte-u30air

# patches: idempotent enough with patch -N; no .git here (tarball), scmversion is fixed
PATCHES="bluetooth-marlin3-link-policy of-reserved-mem-skip of-reserved-mem-add regdb-wens-certificate builtin-vendor-objy"
sum=$(cat $(for p in $PATCHES; do echo /work/patches/$p.patch; done) | sha256sum | cut -d' ' -f1)
if [ "$(cat .mu300-patches 2>/dev/null)" != "$sum" ]; then
  for p in $PATCHES; do
    patch -p1 -N -s -f < /work/patches/$p.patch
  done
  echo "$sum" > .mu300-patches
fi
echo -gb50db5b6224c > .scmversion

# 85 module names -> CONFIG symbols -> =y fragment
python3 /work/map-builtin.py /work/builtin.fragment
# symbols the mapped code references but that sit outside the list (found by the linker:
# cm_notify_event lives in charger-manager.c, sprd_musb_dma_* in sprd_musbhsdma.o - both
# were =m while their callers went built-in, leaving vmlinux with undefined symbols)
cat >> /work/builtin.fragment <<'E'
CONFIG_USB_CONFIGFS_F_VSERIAL=y
CONFIG_CHARGER_MANAGER=y
CONFIG_USB_SPRD_DMA=y
E

OUT=/src/out-builtin
mkdir -p $OUT
cp /work/f50-stock-B09.config $OUT/.config
./scripts/config --file $OUT/.config --enable THINLTO
for f in /work/mu300-linux.fragment /work/builtin.fragment; do
  KCONFIG_CONFIG=$OUT/.config ./scripts/kconfig/merge_config.sh -m -O $OUT $OUT/.config $f > /work/merge-builtin.log 2>&1
done
make O=$OUT ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- LLVM=1 LLVM_IAS=1 CC=clang LD=ld.lld -j"$(nproc)" olddefconfig

# Kconfig demotes tristate symbols to m when a dependency is only m; force the mapped
# set back to y and re-resolve, twice - whatever still refuses is a hard dependency
# block that must be fixed in the fragment, not forced
for round in 1 2; do
  for s in $(grep -oE 'CONFIG_[A-Z0-9_]+' /work/builtin.fragment); do
    grep -q "^$s=y" $OUT/.config || ./scripts/config --file $OUT/.config --set-val $s y
  done
  make O=$OUT ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- LLVM=1 LLVM_IAS=1 CC=clang LD=ld.lld olddefconfig >/dev/null
done

python3 - <<'P'
import re
want = {l.split("=")[0] for l in open("/work/builtin.fragment") if "=" in l}
got = dict(re.findall(r"^(CONFIG_[A-Z0-9_]+)=(.*)$", open("/src/out-builtin/.config").read(), re.M))
bad = sorted(k for k in want if got.get(k) != "y")
print("builtin kept as y:", len(want) - len(bad), "of", len(want))
if bad:
    print("NOT y:", " ".join(bad))
    open("/work/builtin-rejected.txt", "w").write("\n".join(bad) + "\n")
P

start=$(date +%s)
make O=$OUT ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- LLVM=1 LLVM_IAS=1 CC=clang LD=ld.lld -j"$(nproc)" Image modules 2>&1 | grep -E "error|Error|LTO|^make" | tail -30 || true
echo "BUILD_SECONDS $(( $(date +%s) - start ))"
[ -f $OUT/arch/arm64/boot/Image ] || { echo "NO IMAGE - build failed" >&2; exit 1; }
ls -la $OUT/arch/arm64/boot/Image
echo "remaining .ko count: $(find $OUT -name '*.ko' | wc -l)"
