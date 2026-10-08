#!/bin/sh
# own: post-process a freshly built OpenWrt rootfs tarball (runner side).
# Usage: sh custom/post-rootfs.sh ROOTFS.tar.gz
# Imports the tarball as a container image, runs the container script
# (custom/post-rootfs-container.sh, kept as a file so YAML/shell quoting
# can never break it), and writes the result back over the tarball.
set -eu
TARBALL=${1:?usage: post-rootfs.sh ROOTFS.tar.gz}
CUSTOM=$(cd "$(dirname "$0")" && pwd)
OUTD=$(mktemp -d); trap 'rm -rf "$OUTD"' EXIT
docker import "$TARBALL" own-post-base:latest >/dev/null
docker run --rm -v "$CUSTOM:/in/custom:ro" -v "$OUTD:/out" \
    own-post-base:latest /bin/sh -eu /in/custom/post-rootfs-container.sh
mv "$OUTD/own-rootfs.tar.gz" "$TARBALL"
ls -la "$TARBALL"
