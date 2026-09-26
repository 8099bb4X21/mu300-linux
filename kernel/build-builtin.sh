#!/bin/sh
# Build the MU300 kernel with the vendor modules built in (=y): the 85 insmod calls
# in the initramfs become kernel initcalls, removing ~40 s of serial loading and
# every one of its failure modes. Out-of-tree modules (Wi-Fi/BT/GPU) stay modules -
# they come from the release tarball unchanged.
# Usage: sh kernel/build-builtin.sh          (needs docker; ~40-90 min first time)
set -eu
TOP=$(cd "$(dirname "$0")/.." && pwd)
VOL=${MU300_KBUILD_VOLUME:-mu300-kernel}
KERNEL_REV=b50db5b6224c11db42a246e8fcdaad1e1d59f478

docker build -q -t mu300-kbuild "$TOP/kernel" >/dev/null

# source + patches (idempotent; the tree is pinned to one commit plus exactly these)
docker run --rm -v "$VOL":/src -v "$TOP/kernel":/work \
  mu300-kbuild bash -euc '
if [ ! -d /src/zte-u30air/.git ]; then
  echo "kernel source missing in volume $VOL - clone it first:" >&2
  echo "  docker run --rm -v $VOL:/src alpine/git clone --depth 1 <repo> /src/zte-u30air" >&2
  exit 1
fi
cd /src/zte-u30air
KPATCHES="bluetooth-marlin3-link-policy of-reserved-mem-skip of-reserved-mem-add regdb-wens-certificate"
sum=$(cd /work/patches && cat $(for p in $KPATCHES; do echo $p.patch; done) | sha256sum | cut -d" " -f1)
if [ "$(cat .mu300-patches 2>/dev/null)" != "$sum" ]; then
  git checkout -q -f HEAD && git clean -q -fdx -e .mu300-patches
  for p in $KPATCHES; do patch -p1 -s -f < /work/patches/$p.patch; done
  echo "$sum" > .mu300-patches
fi
echo -g$(git rev-parse --short=12 HEAD) > .scmversion

# module names -> CONFIG symbols -> a =y fragment on top of the stock config
cp /work/module-order.txt /work/module-order.txt
python3 /work/map-builtin.py /work/builtin.fragment

OUT=/src/out-builtin
mkdir -p $OUT
cp /work/f50-stock-B09.config $OUT/.config
./scripts/config --file $OUT/.config --enable THINLTO
for f in /work/mu300-linux.fragment /work/builtin.fragment; do
  KCONFIG_CONFIG=$OUT/.config ./scripts/kconfig/merge_config.sh -m -O $OUT $OUT/.config $f >> /work/merge-builtin.log 2>&1
done
make O=$OUT ARCH=arm64 LLVM=1 LLVM_IAS=1 CC=clang LD=ld.lld -j"$(nproc)" olddefconfig

# how many of the mapped symbols did Kconfig keep as y?
python3 - <<P
import re
want = {l.split("=")[0]: "y" for l in open("/work/builtin.fragment") if "=" in l}
got = {}
for l in open("$OUT/.config"):
    m = re.match(r"(CONFIG_[A-Z0-9_]+)=(.*)", l)
    if m: got[m.group(1)] = m.group(2)
bad = [k for k, v in want.items() if got.get(k) != "y"]
print("builtin symbols kept as y:", len(want) - len(bad), "of", len(want))
if bad:
    print("NOT y (dependency or tristate):", " ".join(bad))
    open("/work/builtin-rejected.txt", "w").write("\n".join(bad) + "\n")
P

start=$(date +%s)
make O=$OUT ARCH=arm64 LLVM=1 LLVM_IAS=1 CC=clang LD=ld.lld -j"$(nproc)" Image modules 2>&1 | grep -E "error|Error|LTO|^make" | tail -30
echo "BUILD_SECONDS $(( $(date +%s) - start ))"
ls -la $OUT/arch/arm64/boot/Image
echo "remaining modules: $(find $OUT -name "*.ko" | wc -l)"
'

mkdir -p "$TOP/work/builtin"
docker run --rm -v "$VOL":/src -v "$TOP/work/builtin":/o mu300-kbuild bash -c '
cp /src/out-builtin/arch/arm64/boot/Image /o/
cp /src/out-builtin/modules.builtin /o/ 2>/dev/null || true
find /src/out-builtin -name "*.ko" -exec cp {} /o/modules/ \; 2>/dev/null || true
mkdir -p /o/modules
find /src/out-builtin -name "*.ko" -exec cp {} /o/modules/ \;
'
echo "outputs in work/builtin/:"
ls -la "$TOP/work/builtin/"
