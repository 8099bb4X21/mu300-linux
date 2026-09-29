#!/system/bin/sh
# Boot the Linux system on the other slot, from Android.
#
#   mu300-linux            arm the one-shot trial and reboot
#   mu300-linux status     show what is on each slot, change nothing
#   mu300-linux --dry-run  do everything except writing and rebooting
#
# The Linux slot is derived from the slot Android is currently running on
# (getprop ro.boot.slot_suffix): Linux is always on the other one. The
# bootloader_control block is built dynamically from the current misc
# contents - no hardcoded slot letters, works on any A/B layout.
#
# The only thing written is the 32-byte AOSP bootloader_control block at
# offset 0x800 of the misc partition. boot_a, the GPT, userdata and every
# other partition are never touched.

DRY=0
DO_REBOOT=1
case ${1:-} in
    status) ACTION=status ;;
    --dry-run|-n) DRY=1; ACTION=switch ;;
    --no-reboot) DO_REBOOT=0; ACTION=switch ;;
    ''|switch) ACTION=switch ;;
    -h|--help|help) sed -n '2,14s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "usage: mu300-linux [status|--dry-run|--no-reboot]" >&2; exit 2 ;;
esac

die() { echo "mu300-linux: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (su -c mu300-linux)"

for b in "${MU300_BUSYBOX:-}" "$MAGISKTMP/busybox" /data/adb/magisk/busybox /data/adb/busybox; do
    [ -x "$b" ] && { BB=$b; break; }
done
[ -n "${BB:-}" ] || die "Magisk's busybox was not found"
AWK="$BB awk"

by_name=/dev/block/by-name
[ -e "$by_name/misc" ] || by_name=$(dirname "$(ls -d /dev/block/platform/*/by-name/misc 2>/dev/null | head -n1)" 2>/dev/null)
MISC=$by_name/misc
[ -e "$MISC" ] || die "no misc partition at $MISC"

hex_of() { dd if="$1" bs=1 skip="$2" count="$3" 2>/dev/null | od -An -tx1 -v | tr -d ' \n'; }

live=$(hex_of "$MISC" 2048 32)
[ ${#live} -eq 64 ] || die "could not read the bootloader_control block"
[ "$(echo "$live" | cut -c9-16)" = "42434142" ] || die "misc does not hold an AOSP bootloader_control block ($live)"

# ---- detect slots -----------------------------------------------------------
android_slot=$(getprop ro.boot.slot_suffix | tr -d _)
[ -n "$android_slot" ] || android_slot=$(echo "$live" | cut -c1-4 | sed 's/^5f//')
case "$android_slot" in
    a) linux_slot=b ;;
    b) linux_slot=a ;;
    *) die "cannot determine Android's slot (got '$android_slot')" ;;
esac

a_meta=$(echo "$live" | cut -c25-26)
b_meta=$(echo "$live" | cut -c29-30)

if [ "$ACTION" = status ]; then
    echo "running slot   ${android_slot:-unknown} (Android)"
    echo "linux slot     $linux_slot"
    echo "slot a         priority $((0x$a_meta & 15)), tries $(( (0x$a_meta >> 4) & 7 )), successful $(( (0x$a_meta >> 7) & 1 ))"
    echo "slot b         priority $((0x$b_meta & 15)), tries $(( (0x$b_meta >> 4) & 7 )), successful $(( (0x$b_meta >> 7) & 1 ))"
    boot_other=$by_name/boot_$linux_slot
    [ -e "$boot_other" ] && echo "boot_$linux_slot   $(hex_of "$boot_other" 0 8)" \
                          || echo "boot_$linux_slot   not found"
    exit 0
fi

# ---- build the block that arms the Linux slot --------------------------------
# armed: priority 15, tries 2, successful 0;  idle: priority 14, tries 1, successful 1
ARMED=$(( 0x0f | (2 << 4) ))            # 47  = 0x2f
IDLE=$((  0x0e | (1 << 4) | (1 << 7) )) # 158 = 0x9e

if [ "$linux_slot" = a ]; then
    SUFFIX_HEX=5f61   # "_a"
    T_OFF=24          # slot a metadata at hex chars 24-25 (byte 12)
    O_OFF=28          # slot b metadata at hex chars 28-29 (byte 14)
else
    SUFFIX_HEX=5f62   # "_b"
    T_OFF=28
    O_OFF=24
fi

new=$($AWK -v live="$live" -v suffix="$SUFFIX_HEX" \
     -v t_off=$T_OFF -v o_off=$O_OFF -v armed=$ARMED -v idle=$IDLE '
function xor32(a, b,   i, r, p, x, y) {
    r = 0; p = 1
    for (i = 0; i < 32; i++) {
        x = a % 2; y = b % 2; a = int(a / 2); b = int(b / 2)
        if (x != y) r += p
        p *= 2
    }
    return r
}
function h2i(s,   i, v) {
    v = 0
    for (i = 1; i <= length(s); i++) v = v * 16 + index("0123456789abcdef", tolower(substr(s, i, 1))) - 1
    return v
}
function crc32(bytes, n,   c, i, k) {
    c = 4294967295
    for (i = 1; i <= n; i++) {
        c = xor32(c, bytes[i])
        for (k = 0; k < 8; k++) c = (c % 2) ? xor32(int(c / 2), 3988292384) : int(c / 2)
    }
    return xor32(c, 4294967295)
}
BEGIN {
    for (i = 0; i < 32; i++) b[i + 1] = h2i(substr(live, i * 2 + 1, 2))
    b[1] = h2i(substr(suffix, 1, 2))
    b[2] = h2i(substr(suffix, 3, 2))
    b[t_off / 2 + 1] = armed
    b[o_off / 2 + 1] = idle
    c = crc32(b, 28)
    for (i = 0; i < 4; i++) { b[29 + i] = c % 256; c = int(c / 256) }
    out = ""
    for (i = 1; i <= 32; i++) out = out sprintf("%02x", b[i])
    print out
}')
[ ${#new} -eq 64 ] || die "could not build the bootloader_control block (awk gave '$new')"

echo "android slot:  $android_slot"
echo "linux slot:    $linux_slot"
echo "misc  now: $live"
echo "misc  new: $new"
if [ "$DRY" = 1 ]; then
    echo "dry run: nothing was written"
    exit 0
fi

tmp=${TMPDIR:-/data/local/tmp}/mu300-bc.bin
$BB printf "$(echo "$new" | sed 's/../\\x&/g')" > "$tmp" || die "could not build the block file"
[ "$($BB stat -c %s "$tmp")" = 32 ] || { rm -f "$tmp"; die "the block file is not 32 bytes"; }

dd if="$tmp" of="$MISC" bs=1 seek=2048 conv=notrunc 2>/dev/null || { rm -f "$tmp"; die "writing misc failed"; }
sync
rm -f "$tmp"

back=$(hex_of "$MISC" 2048 32)
[ "$back" = "$new" ] || die "misc verify failed ($back) - reboot normally, Android is unaffected"

echo
echo "slot $linux_slot armed for one boot."
echo "If it does not boot, the device returns to Android by itself."
[ "$DO_REBOOT" = 0 ] && exit 0
echo "Rebooting into Linux."
sleep 3
reboot
