#!/bin/sh
# mu300-smsfwd filter library. Sourceable and side-effect free: every helper
# takes explicit arguments (files, text, numbers). The daemon passes the real
# paths; the unit test points them at fixtures.
#
# Filtering semantics (mirrors the Android sms_fwd V3 plugin):
#   1. content hits a whitelist keyword  -> forward at once (highest priority)
#   2. own number not in the whitelist   -> skip
#   3. content hits a blacklist keyword  -> skip
#   4. otherwise                          -> forward
# An unknown own number therefore blocks (default-deny), unless a whitelist
# keyword hits.

# jq engine (Oniguruma, same as the plugin). Missing jq means no keyword
# ever matches (safe default-deny) and rewriting is identity.
MSF_JQ=${MSF_JQ:-jq}

# Keep digits, last 11 (ignore a country code): 8618566098412 -> 18566098412.
msf_norm_phone() {
    printf '%s' "$1" | tr -cd '0-9' | awk '{ if (length($0)>11) print substr($0, length($0)-10); else print }'
}

# msf_list_has FILE NORMALIZED -> 0 when present. Empty lines and # comments
# are skipped; entries are normalized the same way as the own number.
msf_list_has() {
    [ -f "$1" ] || return 1
    [ -n "$2" ] || return 1
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in ''|\#*) continue ;; esac
        [ "$(msf_norm_phone "$_line")" = "$2" ] && return 0
    done < "$1"
    return 1
}

# msf_rx_hit FILE TEXT -> 0 on the first regex hit. One pattern per line,
# empty lines and # comments skipped. A pattern that fails to compile never
# matches (kept, not fatal).
msf_rx_hit() {
    [ -f "$1" ] || return 1
    command -v "$MSF_JQ" >/dev/null 2>&1 || return 1
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in ''|\#*) continue ;; esac
        if printf '%s' "$2" | "$MSF_JQ" -Rsr --arg p "$_line" 'test($p)' 2>/dev/null | grep -q true; then
            return 0
        fi
    done < "$1"
    return 1
}

# msf_own_in_wl WLFILE MSISDN -> 0 when the own number is whitelisted.
msf_own_in_wl() {
    [ -n "$2" ] || return 1
    msf_list_has "$1" "$(msf_norm_phone "$2")"
}

# msf_filtered_out WL KW BL FROM BODY MSISDN -> 0 skip, 1 forward.
# FROM is accepted for future sender rules; today only the body is matched.
msf_filtered_out() {
    msf_rx_hit "$2" "$5" && return 1
    msf_own_in_wl "$1" "$6" || return 0
    msf_rx_hit "$3" "$5" && return 0
    return 1
}

# msf_apply_rx RXFILE RXJQ TEXT -> rewritten text. Rules are
# pattern===replacement (first === splits), run in order, global; $1..$9
# and \n work like the plugin. Broken rules are skipped; without files or
# jq this is identity.
msf_apply_rx() {
    _rx_text=$3
    if [ ! -f "$1" ] || [ ! -f "$2" ]; then printf '%s' "$_rx_text"; return 0; fi
    command -v "$MSF_JQ" >/dev/null 2>&1 || { printf '%s' "$_rx_text"; return 0; }
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in ''|\#*) continue ;; esac
        case "$_line" in *===*) ;; *) continue ;; esac
        _pat=${_line%%===*}; _rep=${_line#*===}
        [ -n "$_pat" ] || continue
        _out=$(printf '%s' "$_rx_text" | "$MSF_JQ" -Rsr --arg p "$_pat" --arg rp "$_rep" -f "$2" 2>/dev/null) || continue
        if [ -n "$_out" ] && [ "$_out" != "$_rx_text" ]; then _rx_text=$_out; fi
    done < "$1"
    printf '%s' "$_rx_text"
}

# msf_cnum_parse: +CNUM reply lines -> the first usable number (the same
# rule as the dashboard collector). An unprovisioned SIM legitimately
# yields nothing.
msf_cnum_parse() {
    awk -F '"' '/^\+CNUM:/ {
        n=$4; gsub(/[ ()-]/, "", n)
        if (n !~ /^\+?[0-9]+$/ || length(n) > 32) next
        if ($5 ~ /^[[:space:]]*,[[:space:]]*145([[:space:]]*,|[[:space:]]*$)/ && n !~ /^\+/) n="+" n
        print n; exit
    }'
}

# msf_refresh_msisdn CACHE TTL -> the own number (cached). Refreshes over AT
# only when the cache is older than TTL seconds. Never overwrites a good
# cache with a failed read; an unreadable SIM yields empty (= default-deny).
msf_refresh_msisdn() {
    _cache=$1; _ttl=${2:-300}
    if [ -s "$_cache" ]; then
        _age=$(( $(date +%s) - $(date -r "$_cache" +%s 2>/dev/null || echo 0) ))
        if [ "$_age" -lt "$_ttl" ]; then cat "$_cache"; return 0; fi
    fi
    if command -v mu300-at >/dev/null 2>&1; then
        _reply=$(mu300-at -t 6 'AT+CNUM' 2>/dev/null || true)
        _num=$(printf '%s\n' "$_reply" | msf_cnum_parse)
        if [ -n "$_num" ]; then
            printf '%s\n' "$_num" > "$_cache.tmp.$$" && mv -f "$_cache.tmp.$$" "$_cache"
            printf '%s\n' "$_num"
            return 0
        fi
    fi
    cat "$_cache" 2>/dev/null || true
    return 0
}

# msf_byte_len TEXT -> byte length (UTF-8). Used for channel hard limits
# (WeCom text 2048 bytes; the local SMS 70-unit cap is a different measure).
msf_byte_len() { printf '%s' "$1" | wc -c | tr -d ' '; }
