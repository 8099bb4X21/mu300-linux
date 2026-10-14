#!/bin/sh
# Dev-only: push the working tree to a running device and restart, instead of
# rebuilding the APK. Config files under /etc/mu300/smsfwd are NEVER touched
# (they are conffiles / user data). For iteration; the APK is the release.
#   cloud/dev-sync.sh [user@host]   (default root@192.168.77.1)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PKG=$(cd "$HERE/.." && pwd)
HOST=${1:-root@192.168.77.1}
# Dev-only default: skip host-key checking against a throwaway lab device.
# Set MSF_SSH_OPTS="" (or your own -i/-o flags) to verify host keys as usual.
SSH="ssh ${MSF_SSH_OPTS:--o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8}"
$SSH "$HOST" 'mkdir -p /usr/libexec/mu300-smsfwd /usr/libexec/rpcd /usr/sbin /etc/init.d /usr/share/luci/menu.d /usr/share/rpcd/acl.d /www/luci-static/resources/view/mu300smsfwd'
tar -C "$PKG/root" --exclude='./etc/mu300/smsfwd' -cf - . | $SSH "$HOST" 'tar -C / -xf -'
tar -C "$PKG/htdocs" -cf - . | $SSH "$HOST" 'tar -C /www -xf -'
$SSH "$HOST" '
chmod 0755 /etc/init.d/mu300-smsfwd /usr/libexec/rpcd/mu300smsfwd /usr/libexec/mu300-smsfwd/forward /usr/sbin/mu300-smsfwd
chmod 0644 /usr/libexec/mu300-smsfwd/lib.sh /usr/libexec/mu300-smsfwd/channels.sh /usr/libexec/mu300-smsfwd/own-template.uc /usr/libexec/mu300-smsfwd/msg-template.uc /usr/libexec/mu300-smsfwd/rx.jq
/etc/init.d/mu300-smsfwd restart >/dev/null 2>&1
/etc/init.d/rpcd restart >/dev/null 2>&1
rm -f /tmp/luci-indexcache
echo "dev-sync done to " $(cat /proc/sys/kernel/hostname)'