#!/bin/bash
# End-to-end test for mu300-sms / mu300-smsd against a fake mu300-atd. Run from the repo root:
#   bash tools/sms-pool-test.sh
# The fake daemon owns a command fifo and answers with canned modem replies, including the
# ">" prompt path of AT+CMGS. The CMGL listing is read from $TD/cmgl.txt so the test can
# change what "the SIM" holds between syncs, and $TD/mode picks the listing dialect:
# cmgl-string ("AT+CMGL=\"ALL\""), cmgl-numeric (only "AT+CMGL=4" works), cmgr-only (no
# listing at all - the daemon must fall back to scanning slots with AT+CMGR).
set -u
BIN=$(cd "$(dirname "$0")/.." && pwd)/rootfs/overlay/opt/mu300/bin
TD=$(mktemp -d)
export MU300_AT_DIR=$TD/at MU300_SMS_POOL=$TD/pool
export MU300_SMS_STORE_CACHE=$TD/store
export PATH="$BIN:$PATH"
mkdir -p "$TD/at" "$TD/pool" "$TD/at/urc"
rm -f "$TD/at/cmd"; mkfifo "$TD/at/cmd"
echo cmgl-string > "$TD/mode"

cat > "$TD/cmgl.txt" <<'EOF'
+CMGL: 3,"REC UNREAD","+8613800138000",,"26/09/26,19:05:12+08"
6D4B8BD5
+CMGL: 4,"REC READ","10086",,"26/09/26,18:00:00+08"
hello there
EOF

# fake mu300-atd: answers "T answerfile CMD" lines, writing .part + mv like the real one
(
    while IFS= read -r line < "$TD/at/cmd"; do
        t=${line%% *}; rest=${line#* }
        case $rest in
            /*) ans=${rest%% *}; cmd=${rest#* } ;;
            *) cmd=$rest; ans=$TD/at/direct.$$ ;;
        esac
        cr=$(printf '\r'); ctrlz=$(printf '\032')
        case "$cmd" in
            'AT+CPIN?')            r=$'+CPIN: READY\nOK' ;;
            AT+CMGF=*)             r=OK ;;
            'AT+CMGL="ALL"')       [ "$(cat "$TD/mode")" = cmgl-string ] &&
                                       r="$(cat "$TD/cmgl.txt")
OK" || r='+CMS ERROR: 302' ;;
            AT+CMGL=4)             [ "$(cat "$TD/mode")" = cmgl-numeric ] &&
                                       r="$(cat "$TD/cmgl.txt")
OK" || r='+CMS ERROR: 302' ;;
            AT+CMGR=*)             if [ "$(cat "$TD/mode")" = cmgr-only ]; then
                                       i=${cmd#AT+CMGR=}
                                       got=$(awk -v i="$i" '/^\+CMGL:/{p = (index($0, "+CMGL: " i ",") == 1)} p' "$TD/cmgl.txt" |
                                             sed 's/^+CMGL: [0-9]*,/+CMGR: /')
                                       if [ -n "$got" ]; then r="$got
OK"; else r='+CMS ERROR: 302'; fi
                                   else
                                       r='+CMS ERROR: 302'
                                   fi ;;
            AT+CMGS=*)             payload=${cmd#*"$cr"}
                                   if [ "$payload" != "$cmd" ]; then
                                       printf '%s' "${payload%$ctrlz}" > "$TD/pdu.log"
                                       r=$'+CMGS: 7\nOK'
                                   else
                                       r='> '             # legacy two-stage prompt
                                   fi ;;
            0001*)                 printf '%s' "$cmd" | tr -d '\032' > "$TD/pdu.log"
                                   [ "${cmd%$(printf '\032')*}" != "$cmd" ] || r='+CMS ERROR: 500'
                                   [ "$r" = '> ' ] && r=$'+CMGS: 7\nOK' ;;
            AT+CMGD=*)             r=OK; echo "$cmd" >> "$TD/cmgd.log" ;;
            *)                     r=OK ;;
        esac
        printf '%s\n' "$r" > "$ans.part" && mv "$ans.part" "$ans"
    done
) &
FAKE=$!
trap 'kill $FAKE 2>/dev/null; rm -rf "$TD"; exit' EXIT INT TERM

fail() { echo "FAIL: $*"; exit 1; }
try() { echo "--- $*"; }
pool_count() { ls "$TD/pool/msg" 2>/dev/null | wc -l; }

try "sync pulls both SIM messages, UCS-2 body decoded"
mu300-sms sync || fail "sync exited $?"
mu300-sms list | tee "$TD/l1"
grep -q '2 message(s), 1 unread' "$TD/l1" || fail "count line: $(cat "$TD/l1")"
mu300-sms show 1 > "$TD/s1"; grep -q '测试' "$TD/s1" || fail "UCS-2 body: $(cat "$TD/s1")"
grep -q 'coding:    UCS-2' "$TD/s1" || fail "coding header"

try "show marked it read; unread count drops to 0"
mu300-sms list | grep -q '0 unread' || fail "unread after show"

try "sync is idempotent (no duplicates)"
mu300-sms sync >/dev/null; mu300-sms sync >/dev/null
[ "$(pool_count)" = 2 ] || fail "pool has $(pool_count) files"

try "send builds a correct PDU, restores text mode, stores the MO entry"
mu300-sms send 10086 测试 | tee "$TD/send.out"
grep -q 'sent (7)' "$TD/send.out" || fail "send output: $(cat "$TD/send.out")"
[ "$(pool_count)" = 3 ] || fail "MO entry not stored"
mu300-sms show 3 | grep -q '^to:        10086' || fail "MO entry direction"
# 00(SMSC) 01(submit,no VP) 00(MR) 05 81 0180F6(DA=10086) 00 08(UCS2) 04 6D4B8BD5(测试)
grep -q '14 octets, 2 UCS-2 units' "$TD/send.out" || fail "length line"
grep -q '^00010005810180F60008046D4B8BD5$' "$TD/pdu.log" || fail "PDU bytes: $(cat "$TD/pdu.log")"

try "paging: one per page"
MU300_SMS_PAGE=1 mu300-sms list 1 | grep -q '000003' || fail "page 1 shows newest"
MU300_SMS_PAGE=1 mu300-sms list 2 | grep -q '000002' || fail "page 2 shows second newest"
MU300_SMS_PAGE=1 mu300-sms list 3 | grep -q 'page 3/3' || fail "page count"

try "mark unread again"
mu300-sms mark 1 unread && mu300-sms list | grep -q '1 unread' || fail "mark"

try "delete pool-only leaves the SIM alone"
rm -f "$TD/cmgd.log"
mu300-sms delete 2 || fail "delete exited $?"
[ ! -f "$TD/pool/msg/000002" ] || fail "file still there"
[ ! -f "$TD/cmgd.log" ] || fail "CMGD ran without --sim"

try "delete --sim CMGDs the matching slot"
mu300-sms delete 1 --sim | tee "$TD/d1"
grep -q 'deleted SIM slot 3' "$TD/d1" || fail "sim delete: $(cat "$TD/d1")"
grep -q 'AT+CMGD=3' "$TD/cmgd.log" || fail "wrong slot deleted"

try "fallback: numeric stat when CMGL=\"ALL\" is refused (+CMS ERROR: 302)"
rm -f "$TD/pool/msg"/[0-9]* "$TD/pool/deleted"
echo cmgl-numeric > "$TD/mode"
mu300-sms sync >/dev/null || fail "numeric sync exited $?"
[ "$(pool_count)" = 2 ] || fail "numeric fallback pooled $(pool_count)"
mu300-sms list | grep -q '测试' || fail "numeric fallback lost the UCS-2 body"

try "fallback: CMGR slot scan when no listing exists at all"
rm -f "$TD/pool/msg"/[0-9]* "$TD/pool/deleted" "$TD/cmgd.log"
echo cmgr-only > "$TD/mode"
mu300-sms sync >/dev/null || fail "scan sync exited $?"
[ "$(pool_count)" = 2 ] || fail "scan pooled $(pool_count)"
mu300-sms list | grep -q '测试' || fail "scan lost the UCS-2 body"
mu300-sms delete 6 --sim | tee "$TD/d6"   # id 6 = the UCS-2 message in this scan round (next_id keeps counting across resets)
grep -q 'deleted SIM slot 3' "$TD/d6" || fail "scan-path sim delete: $(cat "$TD/d6")"
grep -q 'AT+CMGD=3' "$TD/cmgd.log" || fail "scan-path wrong slot"

try "smsd triggers on a new +CMTI in the URC log"
echo cmgl-string > "$TD/mode"
rm -f "$TD/pool/msg"/[0-9]* "$TD/pool/deleted"
: > "$TD/at/urc/nr0.log"
MU300_SMS_LOCK=$TD/smsd.lock mu300-smsd > "$TD/smsd.log" 2>&1 &
SMSD=$!
for _ in $(seq 1 20); do
    [ "$(pool_count)" = 2 ] && break
    sleep 1
done
[ "$(pool_count)" = 2 ] || \
    fail "initial sync: $(pool_count) files; $(tr '\n' ' ' < "$TD/smsd.log" 2>/dev/null)"
cat >> "$TD/cmgl.txt" <<'EOF'
+CMGL: 5,"REC UNREAD","+8613912345678",,"26/09/26,20:01:00+08"
00480065006C006C006F
EOF
printf '+CMTI: "SM",5\r\n' >> "$TD/at/urc/nr0.log"
sleep 12
kill -TERM $SMSD 2>/dev/null; wait $SMSD 2>/dev/null
grep -q 'AT+CMGD=5' "$TD/cmgd.log" && fail "smsd deleted from the SIM"
new_id=$(cat "$TD/pool/next_id")
mu300-sms show "$new_id" > "$TD/new-message"
grep -q 'Hello' "$TD/new-message" || fail "triggered sync missed the new message: $(cat "$TD/smsd.log")"
grep -q 'unread' "$TD/new-message" || fail "new message not unread"
mu300-sms show "$new_id" | grep -q 'status:    read' || fail "second show did not mark it read"

echo "ALL TESTS PASSED"
