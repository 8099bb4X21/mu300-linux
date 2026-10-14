#!/bin/sh
# Unit test for mu300-smsfwd/lib.sh (sourced, no device needed).
# Run under any POSIX shell with jq on PATH for the regex cases:
#   dash tests/test_msfwd_lib.sh; bash tests/test_msfwd_lib.sh
# Fails loudly on the first mismatch (exit 1); prints ok lines otherwise.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=$HERE/../root/usr/libexec/mu300-smsfwd/lib.sh
RXJQ=$HERE/../root/usr/libexec/mu300-smsfwd/rx.jq
[ -f "$LIB" ] || { echo "SKIP: lib.sh missing at $LIB" >&2; exit 1; }
# shellcheck disable=SC1090
. "$LIB"
T=$(mktemp -d) || exit 1
trap 'rm -rf "$T"' EXIT INT TERM
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass: $1"; }
fail() { echo "FAIL: $1 (expected [$2], got [$3])" >&2; exit 1; }
expect_eq() { [ "$2" = "$3" ] && ok "$1" || fail "$1" "$2" "$3"; }
expect_rc() { # name want_rc... (command + args follow after --)
    _name=$1; _want=$2; shift 2
    "$@" >/dev/null 2>&1; _rc=$?
    [ "$_rc" = "$_want" ] && ok "$_name" || fail "$_name" "$_want" "$_rc"
}

# --- norm_phone: digits only, last 11 ---------------------------------------
expect_eq norm-plus86 18566098412 "$(msf_norm_phone '+8618566098412')"
expect_eq norm-plain 18566098412 "$(msf_norm_phone '18566098412')"
expect_eq norm-noise 18566098412 "$(msf_norm_phone '+86 185-6609-8412')"
expect_eq norm-short 10086 "$(msf_norm_phone '10086')"
expect_eq norm-empty '' "$(msf_norm_phone '')"
expect_eq norm-us-kept 14155552671 "$(msf_norm_phone '+14155552671')"
expect_eq norm-uk-kept 442071234567 "$(msf_norm_phone '+44 20 7123 4567')"
expect_eq norm-86-no-plus-kept 8618566098412 "$(msf_norm_phone '8618566098412')"

# --- time display: one shape for real and simulated SMS ----------------------
expect_eq fmt-iso '2026-10-14 08:50:05' "$(msf_fmt_time '2026-10-14 08:50:05+08:00')"
expect_eq fmt-iso-T '2026-10-14 08:50:05' "$(msf_fmt_time '2026-10-14T08:50:05+08:00')"
expect_eq fmt-at '2026-10-14 08:50:05' "$(msf_fmt_time '26/10/14,08:50:05+32')"
expect_eq fmt-local '2026-10-14 08:50:05' "$(msf_fmt_time '26/10/14,08:50:05')"
expect_eq fmt-passthrough 'tomorrow' "$(msf_fmt_time 'tomorrow')"

# --- byte length (channel hard-limit helper) --------------------------------
expect_eq bytelen-ascii 3 "$(msf_byte_len 'abc')"
expect_eq bytelen-cn 6 "$(msf_byte_len '中文')"

# --- whitelist: normalized literal match, comments/blank skipped -------------
printf '# comment\n\n18566098412\n+8613800000000\n' > "$T/wl"
expect_rc wl-hit 0 msf_list_has "$T/wl" 18566098412
expect_rc wl-hit-plus 0 msf_list_has "$T/wl" 13800000000
expect_rc wl-miss 1 msf_list_has "$T/wl" 13900000000
expect_rc wl-empty-needle 1 msf_list_has "$T/wl" ''
expect_rc wl-missing-file 1 msf_list_has "$T/nope" 18566098412
expect_rc own-in-wl 0 msf_own_in_wl "$T/wl" '+8618566098412'
expect_rc own-not-in-wl 1 msf_own_in_wl "$T/wl" '+8617600000000'
expect_rc own-empty 1 msf_own_in_wl "$T/wl" ''
printf '+14155552671\n' > "$T/wl_us"
expect_rc own-us-hit 0 msf_own_in_wl "$T/wl_us" '+14155552671'
expect_rc own-us-no-collide 1 msf_own_in_wl "$T/wl_us" '+4155552671'

if command -v "$MSF_JQ" >/dev/null 2>&1; then
    # --- keyword hit/miss, (?i) and comments --------------------------------
    printf '# comment\n\n(?i)验证码|动态密码\n' > "$T/kw"
    expect_rc kw-hit 0 msf_rx_hit "$T/kw" '您的验证码是223366'
    expect_rc kw-hit-ci 0 msf_rx_hit "$T/kw" '【test】动态密码：9988'
    expect_rc kw-miss 1 msf_rx_hit "$T/kw" '明晚一起吃饭'
    printf '(?i)广告|推销\n' > "$T/bl"
    expect_rc bl-hit 0 msf_rx_hit "$T/bl" '最新贷款广告来袭'
    expect_rc bl-miss 1 msf_rx_hit "$T/bl" '您的验证码是223366'
    # --- a broken pattern never matches, never aborts the file -------------
    printf '([broken\n(?i)验证码\n' > "$T/kw2"
    expect_rc broken-skipped 0 msf_rx_hit "$T/kw2" '验证码 1122'

    # --- decision table: filtered_out WL KW BL FROM BODY MSISDN -------------
    # 0 = skip, 1 = forward.
    : > "$T/empty"
    # keyword bypass wins over everything (unknown own number, blacklist hit)
    expect_rc bypass-unknown-own 1 msf_filtered_out "$T/empty" "$T/kw" "$T/bl" '10086' '验证码 1122' ''
    expect_rc bypass-over-blacklist 1 msf_filtered_out "$T/wl" "$T/kw" "$T/bl" '10086' '验证码广告 1122' '+8618566098412'
    # whitelisted own number, clean content -> forward
    expect_rc wl-clean-forward 1 msf_filtered_out "$T/wl" "$T/empty" "$T/bl" '10086' '余额 12.5 元' '+8618566098412'
    # whitelisted own number, blacklisted content -> skip
    expect_rc wl-black-skip 0 msf_filtered_out "$T/wl" "$T/empty" "$T/bl" '10086' '贷款广告来袭' '+8618566098412'
    # own number not listed -> skip (default-deny)
    expect_rc notwl-skip 0 msf_filtered_out "$T/wl" "$T/empty" "$T/bl" '10086' '余额 12.5 元' '+8617600000000'
    # unknown own number -> skip
    expect_rc unknown-skip 0 msf_filtered_out "$T/wl" "$T/empty" "$T/bl" '10086' '余额 12.5 元' ''

    # --- rewriting: pattern===replacement, $N and order ----------------------
    if [ -f "$RXJQ" ]; then
        printf '验证码是(\\d{4,8})===验证码：$1\n# c\n' > "$T/rx"
        expect_eq rx-extract '您的验证码：223366' \
            "$(msf_apply_rx "$T/rx" "$RXJQ" '您的验证码是223366')"
        printf 'foo===bar\nbar===BAZ\n' > "$T/rx2"
        expect_eq rx-order 'BAZ' "$(msf_apply_rx "$T/rx2" "$RXJQ" 'foo')"
        printf '([broken===x\n' > "$T/rx3"
        expect_eq rx-broken-kept 'plain text' "$(msf_apply_rx "$T/rx3" "$RXJQ" 'plain text')"
    else
        echo "SKIP: rx.jq missing"
    fi
else
    echo "SKIP: jq not on PATH, regex cases skipped"
fi

# --- cnum parsing (no modem needed) -------------------------------------------
expect_eq cnum-intl '+8618566098412' \
    "$(printf '+CNUM: "","8618566098412",145\r\nOK\r\n' | msf_cnum_parse)"
expect_eq cnum-label '+8613800000000' \
    "$(printf '+CNUM: "SIM, voice","+8613800000000",145,,,4\nOK\n' | msf_cnum_parse)"
expect_eq cnum-empty '' \
    "$(printf '+CNUM: "","",129\nOK\n' | msf_cnum_parse)"
expect_eq cnum-noise '' \
    "$(printf 'AT+CNUM\r\r\nOK\r\n' | msf_cnum_parse)"

echo "PASS: $pass checks"
