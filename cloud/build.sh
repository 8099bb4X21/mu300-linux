#!/bin/sh
# Build the standalone luci-app-mu300-cpusimple APK (PKGARCH:=all) via the OpenWrt SDK.
# Usage: cloud/build.sh [OUT.apk]   (run from the repo root)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PKG=$(cd "$HERE/.." && pwd)
OUT=${1:-$PKG/work/luci-app-mu300-cpusimple.apk}
mkdir -p "$(dirname "$OUT")"
OUT=$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")
payload_hash() {
    for d in htdocs root; do
        [ -d "$PKG/$d" ] || continue
        find "$PKG/$d" -type f | sort | while IFS= read -r f; do cat "$f"; done
    done
}
stamp=$( ( cat "$HERE"/Dockerfile "$HERE"/build.sh "$HERE"/build-inner.sh "$PKG"/Makefile; payload_hash ) | sha256sum | cut -d' ' -f1 )
if [ -s "$OUT" ] && [ -s "$OUT.build-id" ] && [ -s "$OUT.sha256" ] &&
   [ "$(cat "$OUT.build-id")" = "$stamp" ] &&
   [ "$(sha256sum "$OUT" | cut -d' ' -f1)" = "$(cat "$OUT.sha256")" ]; then
    echo "luci-app-mu300-cpusimple: verified APK cache"
    exit 0
fi
docker build --platform linux/amd64 -t mu300-cpusimple-sdk-build -f "$HERE/Dockerfile" "$HERE"
# A named volume keeps SDK builds off slow Windows bind mounts. An explicit
# cache directory can also be supplied by Linux/WSL developers.
cache=${MU300_CPUSIMPLE_SDK_CACHE:-mu300-cpusimple-sdk-25.12.5}
docker run --rm --platform linux/amd64 -v "$cache:/cache" -v "$PKG:/srcpkg:ro" \
    -v "$(dirname "$OUT"):/out" -e "OUT_NAME=$(basename "$OUT")" -e "BUILD_ID=$stamp" \
    mu300-cpusimple-sdk-build sh /srcpkg/cloud/build-inner.sh