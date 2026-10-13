#!/bin/sh
# Build the standalone mu300-smsfwd APK inside the OpenWrt SDK container.
# Pure shell (PKGARCH:=all): no feeds, no patches, no toolchain needed.
set -eu
sdk=openwrt-sdk-25.12.5-armsr-armv8_gcc-14.3.0_musl.Linux-x86_64
sdk_sha=1b0316604a3e820b2b008a1baff3f9dac6716af942bef800930e58c7de98c98b
cd /cache
# Serialize the shared SDK when parallel builds run on one runner.
exec 9>/cache/build.lock
flock 9
if [ ! -d "$sdk" ]; then
    if [ ! -s sdk.tar.zst ]; then
        curl -fL --retry 3 -o sdk.tar.zst.part "https://downloads.openwrt.org/releases/25.12.5/targets/armsr/armv8/$sdk.tar.zst"
        echo "$sdk_sha  sdk.tar.zst.part" | sha256sum -c -
        mv sdk.tar.zst.part sdk.tar.zst
    fi
    echo "$sdk_sha  sdk.tar.zst" | sha256sum -c -
    tar --zstd -xf sdk.tar.zst
fi
cd "$sdk"
[ -f scripts/feeds ] || { echo 'not an OpenWrt SDK, refusing to clean package/' >&2; exit 1; }
rm -rf package/mu300-smsfwd
mkdir -p package/mu300-smsfwd
cp -a /srcpkg/Makefile /srcpkg/htdocs /srcpkg/root package/mu300-smsfwd/
export FORCE_UNSAFE_CONFIGURE=1
printf '%s\n' 'CONFIG_ALL_NONSHARED=n' 'CONFIG_ALL_KMODS=n' 'CONFIG_ALL=n' \
    'CONFIG_BUILDBOT=n' 'CONFIG_PACKAGE_mu300-smsfwd=m' 'CONFIG_SIGNED_PACKAGES=n' > .config
make defconfig
make -j4 package/mu300-smsfwd/compile V=s
apk=$(find bin -name 'mu300-smsfwd-*.apk' -type f)
[ -n "$apk" ] && [ "$(printf '%s\n' "$apk" | wc -l)" = 1 ] || {
    echo 'expected exactly one mu300-smsfwd APK' >&2; exit 1;
}
cp "$apk" "/out/$OUT_NAME.part"
mv "/out/$OUT_NAME.part" "/out/$OUT_NAME"
sha256sum "/out/$OUT_NAME" | cut -d' ' -f1 > "/out/$OUT_NAME.sha256"
printf '%s\n' "$BUILD_ID" > "/out/$OUT_NAME.build-id"
