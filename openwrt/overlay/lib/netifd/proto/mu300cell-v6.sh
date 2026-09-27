#!/bin/sh
# Keep netifd's view of the cellular SLAAC address in sync with the kernel.
# The carrier supplies IPv6 only by RA; it can arrive after the v4 PDP setup has
# completed.  Listen for netlink address events instead of delaying WAN startup.
. /lib/functions.sh
. /lib/netifd/netifd-proto.sh

config=$1
ifname=$2
ip4=$3
prefix4=$4
dns1=$5
dns2=$6
peerdns=$7

current_v6() {
	ip -6 addr show "$ifname" scope global 2>/dev/null |
		awk '/inet6 / { print $2; exit }'
}

report() {
	local cidr addr prefix
	cidr=$(current_v6)
	proto_init_update "$ifname" 1
	proto_add_ipv4_address "$ip4" "${prefix4:-32}"
	proto_add_ipv4_route "0.0.0.0" 0
	if [ -n "$cidr" ]; then
		addr=${cidr%/*}
		prefix=${cidr#*/}
		proto_add_ipv6_address "$addr" "${prefix:-64}"
		proto_add_ipv6_route "::" 0 "" "" 4096
	fi
	if [ "${peerdns:-1}" != 0 ]; then
		[ -n "$dns1" ] && proto_add_dns_server "$dns1"
		[ -n "$dns2" ] && proto_add_dns_server "$dns2"
	fi
	proto_send_update "$config"
}

last=$(current_v6)
report
[ "${8:-}" = --once ] && exit 0

events=/run/mu300cell-v6.$$.events
rm -f "$events"
mkfifo -m 600 "$events" || exit 1
ip -6 monitor address dev "$ifname" > "$events" &
monitor=$!
trap 'kill "$monitor" 2>/dev/null; rm -f "$events"; exit 0' INT TERM EXIT
while read -r _; do
	now=$(current_v6)
	[ "$now" = "$last" ] && continue
	last=$now
	report
done < "$events"
