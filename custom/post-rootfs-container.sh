#!/bin/sh
# own: bake extras into a built OpenWrt rootfs.
# Runs INSIDE the image container (any quoting allowed); the runner copies
# the tree back out and repacks it (bind mounts would leak host files).
set -eu
mkdir -p /var/lock /var/run /tmp
apk update >/dev/null
apk add wsdd2 ksmbd-server >/dev/null
i18n=
for c in base ksmbd; do
for l in tr zh-cn; do
    apk search "luci-i18n-$c-$l" | grep -q "^luci-i18n-$c-$l-[0-9]" && i18n="$i18n luci-i18n-$c-$l"
done
done
[ -n "$i18n" ] && apk add $i18n >/dev/null
echo "translations:$i18n"
# only the feed's wrong-kernel modules go: 6.18/7.2 shipped by kano stay
rm -rf /lib/modules/6.12*
# image defaults (kano ships neither file nor sections: create as needed)
uci -q get luci.main >/dev/null 2>&1 || uci set luci.main='core'
uci set luci.main.lang='zh_cn'
uci -q get luci.languages >/dev/null 2>&1 || uci set luci.languages='internal'
uci -q get luci.languages.zh_cn >/dev/null 2>&1 || uci set luci.languages.zh_cn='简体中文 (Simplified Chinese)'
uci commit luci
[ -s /etc/config/system ] || printf 'config system\n' > /etc/config/system
uci set system.@system[0].timezone='CST-8'
uci set system.@system[0].zonename='Asia/Shanghai'
uci commit system
# fork default root password (kano's installer manages none): only when empty
[ -s /etc/shadow ] || { echo "no /etc/shadow to preseed" >&2; exit 1; }
command -v openssl >/dev/null || { echo "no openssl for password hash" >&2; exit 1; }
PWHASH=$(openssl passwd -6 -salt ownfork password)
sed -i "s|^root::|root:$PWHASH:|;s|^root:[!*]:|root:$PWHASH:|" /etc/shadow
grep -q '^root:\$6\$ownfork\$' /etc/shadow || { echo "root password not set" >&2; exit 1; }
# enable ksmbd + wsdd2 (rc.common enable needs ubus: link rc.d directly)
for s in ksmbd wsdd2; do
    n=$(sed -n "s/^START=//p" /etc/init.d/$s)
    ln -sf ../init.d/$s /etc/rc.d/S$n$s
done
apk list --installed | sort > /etc/mu300/packages.txt
R=/build/root; mkdir -p $R
for e in /*; do
    case "$e" in /proc|/sys|/dev|/build|/in|/out|/tmp) continue ;; esac
    cp -a "$e" $R/
done
mkdir -p $R/proc $R/sys $R/dev $R/tmp $R/run
ln -sf /tmp/resolv.conf $R/etc/resolv.conf
printf "127.0.0.1\tlocalhost\n\n::1\tlocalhost ip6-localhost ip6-loopback\nff02::1\tip6-allnodes\nff02::2\tip6-allrouters\n" > $R/etc/hosts
printf "mu300\n" > $R/etc/hostname
mkdir -p /out
tar -czf /out/own-rootfs.tar.gz -C $R .
ls -la /out/
