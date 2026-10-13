#!/bin/sh
# mu300-smsfwd channel backend (sourced by ./forward, never executed).
# Ported from the built-in forwarding: same four channels, same validation,
# same state/result/history discipline. Differences: single shared profile,
# no sender-number blacklist (lists live in separate text files), and the
# SMS body itself passes through the regex rewriter (except test and power
# kinds) for every human-readable channel; the generic webhook keeps the raw
# body and stable keys. The WeCom channel follows the plugin: template, then
# rewrite, then text post.
#
# Globals provided by the caller: BASE CONFIG STATE RESULT HISTORY POOL
# RENDERER SMS MSF_RX MSF_RXJQ. Config values via load_config.

NL='
'
CR=$(printf '\r')

reply_error() {
    json_init
    json_add_int ok 0
    json_add_string error "$1"
    json_dump
}
reply_ok() { printf '{"ok":1}\n'; }
number() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
bool() { [ "$1" = 0 ] || [ "$1" = 1 ]; }

webhook_fields() {
    json_add_string webhook_method "$webhook_method"
    json_add_string webhook_content_type "$webhook_content_type"
    json_add_string webhook_body "$webhook_body"
    json_add_string webhook_headers "$webhook_headers"
    json_add_int webhook_timeout "$webhook_timeout"
}
render_webhook() { # JSON input, no eval or shell expansion of templates
    json_init; json_add_object config
    json_add_string webhook_url "$webhook_url"; webhook_fields; json_close_object
    json_add_object values
    json_add_string from "${_from:-}"; json_add_string text "${_text:-}"
    json_add_string time "${_date:-}"
    json_add_string phone "${OWN_MSISDN:-}"
    json_add_string sim "SIM$((${MU300_SIM_SLOT:-0} + 1))"
    json_add_string device "${nickname:-$(cat /proc/sys/kernel/hostname 2>/dev/null)}"
    json_add_string kind "${_kind:-sms}"; json_close_object
    json_dump | ucode "$RENDERER" 2>/dev/null
}
render_message_template() { # shared plain-text template; uses _from _text _date
    json_init
    json_add_string template "$message_template"
    json_add_object values
    json_add_string from "${_from:-}"
    json_add_string text "${_text:-}"
    json_add_string time "${_date:-}"
    json_add_string phone "${OWN_MSISDN:-}"
    json_add_string sim "SIM$((${MU300_SIM_SLOT:-0} + 1))"
    json_add_string device "${nickname:-$(cat /proc/sys/kernel/hostname 2>/dev/null)}"
    json_add_string kind "${_kind:-sms}"
    json_close_object
    json_dump | ucode "$MSGTEMPLATE" 2>/dev/null
}
one_line() {
    case "$1" in *"$NL"*|*"$CR"*) return 1 ;; esac
    [ -z "$(printf '%s' "$1" | LC_ALL=C tr -d '\040-\176\200-\377')" ]
}
phone() {
    _digits=${1#+}
    number "$_digits" && [ ${#_digits} -ge 3 ] && [ ${#_digits} -le 32 ]
}
host_name() {
    case "$1" in ''|*[!a-zA-Z0-9.-]*|.*|*.|*..*|-*|*-|*.-*|*-.*|localhost|*.localhost|*.local|*.internal) return 1 ;; esac
    case "$1" in *.*) ;; *) return 1 ;; esac
    # Literal IPv4 addresses and numeric pseudo-hostnames are not destinations.
    case "$1" in *[a-zA-Z]*) return 0 ;; *) return 1 ;; esac
}
mailbox() {
    case "$1" in *'@'*) ;; *) return 1 ;; esac
    _local=${1%%@*}; _domain=${1#*@}
    case "$_local" in ''|.*|*.|*..*|*[!a-zA-Z0-9._%+-]*) return 1 ;; esac
    [ ${#1} -le 254 ] && host_name "$_domain"
}
public_ip() {
    case "$1" in
        *:*)
            _ip_lc=$(printf '%s' "$1" | tr 'A-F' 'a-f')
            case "$_ip_lc" in 2001:db8:*|2001:0db8:*) return 1 ;; esac
            case "$_ip_lc" in [23]*) return 0 ;; *) return 1 ;; esac ;;
        *)
            _oldifs=$IFS; IFS=.; set -- $1; IFS=$_oldifs
            [ "$#" -eq 4 ] || return 1
            for _octet in "$@"; do
                number "$_octet" && [ "$_octet" -le 255 ] || return 1
            done
            case "$1" in 0|10|127|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|24[0-9]|25[0-5]) return 1 ;; esac
            [ "$1" = 169 ] && [ "$2" = 254 ] && return 1
            [ "$1" = 192 ] && { [ "$2" = 168 ] || [ "$2" = 0 ]; } && return 1
            [ "$1" = 172 ] && [ "$2" -ge 16 ] && [ "$2" -le 31 ] && return 1
            [ "$1" = 100 ] && [ "$2" -ge 64 ] && [ "$2" -le 127 ] && return 1
            [ "$1" = 198 ] && { [ "$2" = 18 ] || [ "$2" = 19 ]; } && return 1
            [ "$1" = 198 ] && [ "$2" = 51 ] && [ "$3" = 100 ] && return 1
            [ "$1" = 192 ] && [ "$2" = 0 ] && [ "$3" = 2 ] && return 1
            [ "$1" = 203 ] && [ "$2" = 0 ] && [ "$3" = 113 ] && return 1
            return 0 ;;
    esac
}
resolve_public() { # hostname, port -> pinned curl --resolve argument
    _resolved=$(nslookup "$1" 2>/dev/null | awk '/^Name:/ {answer=1} answer && /^Address:/ {print $2}')
    [ -n "$_resolved" ] || return 1
    _picked=
    while IFS= read -r _ip || [ -n "$_ip" ]; do
        public_ip "$_ip" || return 1
        case "$_ip" in *:*) [ -n "$_picked" ] || { _picked="[$_ip]"; PICKED_IP=$_ip; } ;;
            *) _picked=$_ip; PICKED_IP=$_ip ;;
        esac
    done <<EOF_RESOLVED
$_resolved
EOF_RESOLVED
    [ -n "$_picked" ] || return 1
    RESOLVE="$1:$2:$_picked"
}
https_url() {
    case "$1" in https://*) ;; *) return 1 ;; esac
    case "$1" in *'#'*) return 1 ;; esac
    _authority=${1#https://}; _authority=${_authority%%/*}; _authority=${_authority%%\?*}
    case "$_authority" in *'@'*|'') return 1 ;; esac
    _url_host=${_authority%%:*}
    _url_port=443
    if [ "$_authority" != "$_url_host" ]; then
        _url_port=${_authority#*:}
        number "$_url_port" && [ "$_url_port" -gt 0 ] && [ "$_url_port" -le 65535 ] || return 1
    fi
    host_name "$_url_host" && [ ${#1} -le 2048 ] && one_line "$1"
}
list_valid() { # newline-delimited phone list, max count
    [ -z "$1" ] && return 0
    _count=0; _seen=$NL
    while IFS= read -r _entry || [ -n "$_entry" ]; do
        [ -n "$_entry" ] || return 1
        _count=$((_count + 1)); [ "$_count" -le "$2" ] || return 1
        phone "$_entry" || return 1
        _key=${_entry#+}
        case "$_seen" in *"$NL$_key$NL"*) return 1 ;; esac
        _seen="$_seen$_key$NL"
    done <<EOF_LIST
$1
EOF_LIST
}
load_config() {
    enabled=0 method=webhook webhook_url= dingtalk_webhook= dingtalk_secret=
    sms_to_phone= smtp_host= smtp_port=465 smtp_username= smtp_to= smtp_password=
    wecom_key=
    message_template=
    power_forward_enabled=0 nickname= template_language=
    smtp_forward_device_info=0 dingtalk_forward_device_info=0 sms_forward_device_info=0
    wecom_forward_device_info=0
    webhook_method=POST webhook_content_type=application/json webhook_body= webhook_headers= webhook_timeout=12
    [ -s "$CONFIG" ] || return 0
    json_load_file "$CONFIG" 2>/dev/null || return 1
    json_get_vars enabled method webhook_url dingtalk_webhook dingtalk_secret sms_to_phone
    json_get_vars smtp_host smtp_port smtp_username smtp_to smtp_password
    json_get_var wecom_key wecom_key ''
    json_get_var message_template message_template ''
    json_get_vars power_forward_enabled nickname
    json_get_vars smtp_forward_device_info dingtalk_forward_device_info sms_forward_device_info
    json_get_var wecom_forward_device_info wecom_forward_device_info 0
    json_get_var template_language template_language ''
    json_get_var webhook_method webhook_method POST
    json_get_var webhook_content_type webhook_content_type application/json
    json_get_var webhook_body webhook_body ''
    json_get_var webhook_headers webhook_headers ''
    json_get_var webhook_timeout webhook_timeout 12
}
load_state() {
    last_id=0 since=0 power_percent=-1 power_status=none
    [ -s "$STATE" ] || return 0
    IFS='|' read -r last_id since power_percent power_status _legacy < "$STATE" || :
    number "$last_id" || last_id=0
    number "$since" || since=0
}
ensure_base() { mkdir -p "$BASE" && chmod 700 "$BASE"; }
save_state() {
    ensure_base || return 1
    printf '%s|%s|%s|%s\n' "$last_id" "$since" "$power_percent" "$power_status" > "$STATE.tmp.$$" || return 1
    mv -f "$STATE.tmp.$$" "$STATE"
}
save_config() {
    ensure_base || return 1
    json_init
    json_add_boolean enabled "$enabled"
    json_add_string method "$method"
    json_add_string template_language "$template_language"
    json_add_string webhook_url "$webhook_url"
    webhook_fields
    json_add_string message_template "$message_template"
    json_add_string dingtalk_webhook "$dingtalk_webhook"
    json_add_string dingtalk_secret "$dingtalk_secret"
    json_add_string wecom_key "$wecom_key"
    json_add_string sms_to_phone "$sms_to_phone"
    json_add_string smtp_host "$smtp_host"
    json_add_int smtp_port "$smtp_port"
    json_add_string smtp_username "$smtp_username"
    json_add_string smtp_to "$smtp_to"
    json_add_string smtp_password "$smtp_password"
    json_add_boolean power_forward_enabled "$power_forward_enabled"
    json_add_string nickname "$nickname"
    json_add_boolean smtp_forward_device_info "$smtp_forward_device_info"
    json_add_boolean dingtalk_forward_device_info "$dingtalk_forward_device_info"
    json_add_boolean wecom_forward_device_info "$wecom_forward_device_info"
    json_add_boolean sms_forward_device_info "$sms_forward_device_info"
    json_dump > "$CONFIG.tmp.$$" || return 1
    mv -f "$CONFIG.tmp.$$" "$CONFIG"
}
write_result() { printf '%s|%s\n' "$1" "$2" > "$RESULT.tmp.$$" && mv -f "$RESULT.tmp.$$" "$RESULT"; }
record_delivery() { # kind only; never store destination, source or message content
    case "$1" in sms|power|test) ;; *) return 1 ;; esac
    case "$method" in webhook|dingtalk|wecom|smtp|sms) ;; *) return 1 ;; esac
    case "$DELIVER_RESULT" in sent|disabled|self_forward_blocked|message_too_long|storage_failed|source_unavailable|power_unavailable|invalid_config|invalid_forward_config|invalid_destination|delivery_failed|smtp_auth_failed) ;; *) return 1 ;; esac
    # Writers already hold state.lock. Keep 30 small records in RAM, newest first.
    {
        printf '%s|%s|%s|%s' "$(date +%s)" "$1" "$method" "$DELIVER_RESULT"
        case "${MU300_SIM_SLOT:-}" in 0|1)
            case "${HTTP_CODE:-0}" in [1-5][0-9][0-9]) _http=$HTTP_CODE ;; *) _http=0 ;; esac
            printf '|%s|%s' "$MU300_SIM_SLOT" "$_http" ;;
        esac
        printf '\n'
        [ ! -r "$HISTORY" ] || head -n 29 "$HISTORY"
    } > "$HISTORY.tmp.$$" && mv -f "$HISTORY.tmp.$$" "$HISTORY"
}
add_history() {
    json_add_array history
    if [ -r "$HISTORY" ]; then
        _history_n=0
        while IFS='|' read -r _when _kind _method _result _slot _http _extra; do
            _history_n=$((_history_n + 1)); [ "$_history_n" -le 30 ] || break
            number "$_when" && [ ${#_when} -le 11 ] || continue
            case "$_kind" in sms|power|test) ;; *) continue ;; esac
            case "$_method" in webhook|dingtalk|wecom|smtp|sms) ;; *) continue ;; esac
            case "$_result" in sent|disabled|self_forward_blocked|message_too_long|storage_failed|source_unavailable|power_unavailable|invalid_config|invalid_forward_config|invalid_destination|delivery_failed|smtp_auth_failed) ;; *) continue ;; esac
            [ -z "$_extra" ] || continue
            case "$_slot" in ''|0|1) ;; *) continue ;; esac
            case "$_http" in ''|0|[1-5][0-9][0-9]) ;; *) continue ;; esac
            json_add_object ''
            json_add_int time "$_when"
            json_add_string kind "$_kind"
            json_add_string method "$_method"
            json_add_string result "$_result"
            [ -z "$_slot" ] || json_add_int slot "$_slot"
            [ -z "$_http" ] || json_add_int http_code "$_http"
            json_close_object
        done < "$HISTORY"
    fi
    json_close_array
}
read_result() {
    last_result=idle power_last_result=idle
    [ -r "$RESULT" ] && IFS='|' read -r last_result power_last_result < "$RESULT" || :
}
power_read() {
    power_ok=0 current_percent=-1 current_status=none
    [ -r "$BATTERY/present" ] && [ "$(cat "$BATTERY/present" 2>/dev/null)" = 1 ] || return 0
    current_percent=$(cat "$BATTERY/capacity" 2>/dev/null)
    current_status=$(cat "$BATTERY/status" 2>/dev/null)
    number "$current_percent" && [ "$current_percent" -le 100 ] || return 0
    case "$current_status" in Charging|Discharging|Not\ charging|Full) power_ok=1 ;; esac
}
add_status() {
    power_read; read_result
    json_add_object status
    json_add_boolean supported 1
    json_add_boolean enabled "$enabled"
    json_add_string method "$method"
    json_add_boolean power_supported "$power_ok"
    json_add_boolean power_forward_enabled "$power_forward_enabled"
    json_add_string last_result "$last_result"
    json_add_string power_last_result "$power_last_result"
    add_history
    json_close_object
}
template_strings() {
    # Missing language in an existing config preserves the Chinese templates.
    case "${template_language:-zh}" in
        en)
            T_SUBJECT_TEST='MU300 forwarding test'; T_TEST='MU300 SMS forwarding test'
            T_SUBJECT_SMS='MU300 SMS notification'; T_FROM='SMS from'
            T_SUBJECT_POWER='MU300 power notification'; T_POWER='Power status notification'
            T_DEVICE='Device'; T_FIRMWARE='Firmware'; T_UPTIME='Uptime'; T_SECONDS='seconds'
            T_CHARGE_STATUS='Charging status'; T_LEVEL='Battery level'; T_THRESHOLD='Battery alert'
            T_CHARGING='Charging'; T_DISCHARGING='Discharging'; T_NOT_CHARGING='Not charging'; T_FULL='Full'
            ;;
        tr)
            T_SUBJECT_TEST='MU300 yönlendirme testi'; T_TEST='MU300 SMS yönlendirme testi'
            T_SUBJECT_SMS='MU300 SMS bildirimi'; T_FROM='SMS gönderen:'
            T_SUBJECT_POWER='MU300 güç bildirimi'; T_POWER='Güç durumu bildirimi'
            T_DEVICE='Cihaz'; T_FIRMWARE='Yazılım'; T_UPTIME='Çalışma süresi'; T_SECONDS='saniye'
            T_CHARGE_STATUS='Şarj durumu'; T_LEVEL='Pil seviyesi'; T_THRESHOLD='Pil uyarısı'
            T_CHARGING='Şarj oluyor'; T_DISCHARGING='Pil kullanılıyor'; T_NOT_CHARGING='Şarj olmuyor'; T_FULL='Dolu'
            ;;
        *)
            T_SUBJECT_TEST='MU300 转发测试'; T_TEST='MU300 短信转发测试'
            T_SUBJECT_SMS='MU300 短信通知'; T_FROM='短信来自'
            T_SUBJECT_POWER='MU300 电源通知'; T_POWER='电源状态通知'
            T_DEVICE='设备'; T_FIRMWARE='固件'; T_UPTIME='运行时间'; T_SECONDS='秒'
            T_CHARGE_STATUS='充电状态'; T_LEVEL='当前电量'; T_THRESHOLD='电量提醒'
            T_CHARGING='充电中'; T_DISCHARGING='放电中'; T_NOT_CHARGING='未充电'; T_FULL='已充满'
            ;;
    esac
}
format_message() { # kind, sender, original body (never translate user content)
    template_strings
    case "$1" in
        test) _subject=$T_SUBJECT_TEST; _content=$T_TEST ;;
        power) _subject=$T_SUBJECT_POWER; _content="$T_POWER$NL$3" ;;
        *) _subject=$T_SUBJECT_SMS; _content="$T_FROM $2$NL$3" ;;
    esac
}
power_message() { # current status, percent, crossed threshold, previous status
    template_strings
    case "$1" in
        Charging) _charge=$T_CHARGING ;;
        Discharging) _charge=$T_DISCHARGING ;;
        'Not charging') _charge=$T_NOT_CHARGING ;;
        Full) _charge=$T_FULL ;;
        *) return 1 ;;
    esac
    if [ "$1" != "$4" ]; then
        printf '%s: %s\n%s: %s%%' "$T_CHARGE_STATUS" "$_charge" "$T_LEVEL" "$2"
    else
        printf '%s: %s%%\n%s: %s%%\n%s: %s' "$T_THRESHOLD" "$3" "$T_LEVEL" "$2" "$T_CHARGE_STATUS" "$_charge"
    fi
}
mime_subject() {
    # RFC 2047 protects both Chinese and Turkish subjects on non-SMTPUTF8 servers.
    printf '=?UTF-8?B?%s?=' "$(printf '%s' "$1" | openssl base64 -A)"
}
device_info() {
    _model=$(cat /tmp/sysinfo/model 2>/dev/null)
    _uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)
    printf '%s: %s%s\n%s: %s\n%s: %s %s' "$T_DEVICE" "$_model" "${nickname:+ ($nickname)}" \
        "$T_FIRMWARE" "$(sed -n "s/^DISTRIB_DESCRIPTION='\(.*\)'$/\1/p" /etc/openwrt_release 2>/dev/null)" \
        "$T_UPTIME" "$_uptime" "$T_SECONDS"
}
device_info_sms() {
    _model=$(cat /tmp/sysinfo/model 2>/dev/null)
    printf '%s%s' "$_model" "${nickname:+ ($nickname)}"
}
sms_units() {
    printf '%s' "$1" | LC_ALL=C awk '
        BEGIN { for (i=1; i<256; i++) ord[sprintf("%c",i)]=i; count=0 }
        NR>1 { count++ }
        {
            for (i=1; i<=length($0); ) {
                b=ord[substr($0,i,1)]
                if (b<128) { i++; count++ }
                else if (b<224) { i+=2; count++ }
                else if (b<240) { i+=3; count++ }
                else if (b<245) { i+=4; count+=2 }
                else { i++; count++ }
            }
        }
        END { print count }'
}
deliver() { # kind, sender, body, date. Returns a finite result code in DELIVER_RESULT.
    _kind=$1 _from=$2 _text=$3 _date=${4:-}; DELIVER_RESULT=delivery_failed
    HTTP_CODE=0
    [ "$enabled" = 1 ] || { DELIVER_RESULT=disabled; return 1; }
    # Regex rewriting applies to the SMS body itself (kind=sms), before it is
    # embedded in a human-readable channel. The generic webhook keeps the raw
    # body. Test and power text are never rewritten.
    if [ "$_kind" = sms ] && [ "$method" != webhook ]; then
        _text=$(msf_apply_rx "$MSF_RX" "$MSF_RXJQ" "$_text")
    fi
    format_message "$_kind" "$_from" "$_text"
    # Webhooks keep stable JSON keys; only generated test
    # and power text is localized, just like the human-readable channels.
    [ "$_kind" != test ] || _text=$_content
    _include=0
    case "$method" in
        smtp) _include=$smtp_forward_device_info ;;
        dingtalk) _include=$dingtalk_forward_device_info ;;
        wecom) _include=$wecom_forward_device_info ;;
        sms) _include=$sms_forward_device_info ;;
    esac
    # One shared template, universal placeholders, each channel interprets it.
    # With a template set the body IS the template (device info is a
    # placeholder there, not appended); the generic webhook keeps its own body.
    if [ "$_kind" = sms ] && [ "$method" != webhook ] && [ -n "$message_template" ]; then
        _content=$(render_message_template)
    elif [ "$_include" = 1 ]; then
        if [ "$method" = sms ]; then _content="$_content$NL$(device_info_sms)"
        else _content="$_content

$(device_info)"; fi
    fi
    # Channel hard limits: WeCom text 2048 bytes (official), DingTalk text
    # about 4000 characters (capped here at 12000 bytes). The local SMS
    # adapter's 70-unit cap is checked in its branch below.
    case "$method" in
        wecom) [ "$(msf_byte_len "$_content")" -le 2048 ] || { DELIVER_RESULT=message_too_long; return 1; } ;;
        dingtalk) [ "$(msf_byte_len "$_content")" -le 12000 ] || { DELIVER_RESULT=message_too_long; return 1; } ;;
    esac
    if [ "$method" = sms ]; then
        [ -n "$SMS" ] && [ -x "$SMS" ] || { DELIVER_RESULT=source_unavailable; return 1; }
        # The local SMS adapter only supports one 70-unit UCS-2 part. Do not
        # submit a message longer than that adapter supports.
        [ "$(sms_units "$_content")" -le 70 ] ||
            { DELIVER_RESULT=message_too_long; return 1; }
        _delivered=0
        while IFS= read -r _to || [ -n "$_to" ]; do
            [ -n "$_to" ] || continue
            [ "${_to#+}" = "${_from#+}" ] && continue
            "$SMS" send "$_to" "$_content" >/dev/null 2>&1 ||
                { DELIVER_RESULT=delivery_failed; return 1; }
            _delivered=1
        done <<EOF_TARGET
$sms_to_phone
EOF_TARGET
        [ "$_delivered" = 1 ] || { DELIVER_RESULT=self_forward_blocked; return 1; }
        DELIVER_RESULT=sent; return 0
    fi
    _tmp=${MU300_FORWARD_RUNTIME:-/run}/mu300-smsfwd.$$
    if [ "$method" = smtp ]; then
        command -v msmtp >/dev/null 2>&1 || { DELIVER_RESULT=delivery_failed; return 1; }
        resolve_public "$smtp_host" "$smtp_port" ||
            { DELIVER_RESULT=invalid_destination; return 1; }
        # msmtp pins the public DNS answer as the connection host, while
        # tls_host_override verifies the original DNS name against the cert.
        # Password lives only in a mode-0600 tmpfs file, never argv or logs.
        printf '%s\n' "$smtp_password" > "$_tmp.pass"
        {
            printf 'defaults\nauth on\ntls on\ntls_certcheck on\n'
            printf 'tls_trust_file /etc/ssl/certs/ca-certificates.crt\n'
            printf 'timeout 20\naccount mu300_smsfwd\n'
            printf 'host %s\nport %s\ntls_host_override %s\n' "$PICKED_IP" "$smtp_port" "$smtp_host"
            [ "$smtp_port" = 465 ] && printf 'tls_starttls off\n' || printf 'tls_starttls on\n'
            printf 'from %s\nuser %s\npasswordeval cat %s\n' "$smtp_username" "$smtp_username" "$_tmp.pass"
        } > "$_tmp.config"
        {
            printf 'From: <%s>\r\nTo: <%s>\r\nSubject: %s\r\n' "$smtp_username" "$smtp_to" "$(mime_subject "$_subject")"
            printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'
            printf '%s' "$_content" | openssl base64
        } > "$_tmp.body"
        _err=$(msmtp -C "$_tmp.config" -a mu300_smsfwd "$smtp_to" < "$_tmp.body" 2>&1)
        _rc=$?
        rm -f "$_tmp.config" "$_tmp.pass" "$_tmp.body"
        case "$_err" in *'authentication failed'*|*'535 '*)
            DELIVER_RESULT=smtp_auth_failed ;;
        esac
    else
        command -v curl >/dev/null 2>&1 || { DELIVER_RESULT=delivery_failed; return 1; }
        if [ "$method" = dingtalk ]; then _host=oapi.dingtalk.com; _port=443
        elif [ "$method" = wecom ]; then _host=qyapi.weixin.qq.com; _port=443
        else
            _authority=${webhook_url#https://}; _authority=${_authority%%/*}; _authority=${_authority%%\?*}
            _host=${_authority%%:*}; _port=443
            [ "$_authority" = "$_host" ] || _port=${_authority#*:}
        fi
        resolve_public "$_host" "$_port" ||
            { DELIVER_RESULT=invalid_destination; return 1; }
        json_init
        if [ "$method" = dingtalk ]; then
            json_add_string msgtype text
            json_add_object text; json_add_string content "$_content"; json_close_object
            _url=$dingtalk_webhook
            if [ -n "$dingtalk_secret" ]; then
                _stamp="$(date +%s)000"
                _sig=$(printf '%s\n%s' "$_stamp" "$dingtalk_secret" |
                    openssl dgst -sha256 -hmac "$dingtalk_secret" -binary 2>/dev/null |
                    openssl base64 -A 2>/dev/null |
                    sed -e 's/+/%2B/g' -e 's|/|%2F|g' -e 's/=/%3D/g')
                [ -n "$_sig" ] || { DELIVER_RESULT=delivery_failed; return 1; }
                case "$_url" in *\?*) _url="$_url&timestamp=$_stamp&sign=$_sig" ;;
                    *) _url="$_url?timestamp=$_stamp&sign=$_sig" ;; esac
            fi
        elif [ "$method" = wecom ]; then
            [ -n "$wecom_key" ] || { DELIVER_RESULT=invalid_forward_config; return 1; }
            json_add_string msgtype text
            json_add_object text; json_add_string content "$_content"; json_close_object
            _url="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=$wecom_key"
        else
            [ "$_kind" = power ] && json_add_string kind power
            json_add_string from "$_from"
            json_add_string text "$_text"
            json_add_string date "$_date"
            [ "$_include" = 1 ] && json_add_string device_info "$(device_info)"
            _url=$webhook_url
        fi
        json_dump > "$_tmp.body"
        _request_method=POST _request_type=application/json _request_timeout=12 _request_headers=
        [ "$method" = wecom ] && _request_timeout=15
        if [ "$method" = webhook ]; then
            _request=$(render_webhook) && json_load "$_request" || {
                rm -f "$_tmp.body"; DELIVER_RESULT=invalid_forward_config; return 1;
            }
            json_get_var _url url
            json_get_var _request_method method
            json_get_var _request_type content_type
            json_get_var _request_timeout timeout
            json_get_var _request_headers headers
            if [ -n "$webhook_body" ] || [ "$_request_type" != application/json ]; then
                json_get_var _request_body body
                printf '%s' "$_request_body" > "$_tmp.body"
            fi
        fi
        printf '%s\n' "$_request_headers" > "$_tmp.headers"
        set -- -q --noproxy '*' --proto '=https' --resolve "$RESOLVE" --max-redirs 0 --connect-timeout 4 \
            --max-time "$_request_timeout" --max-filesize 4096 --fail -sS \
            -H "Content-Type: $_request_type; charset=utf-8" -H "@$_tmp.headers" \
            -X "$_request_method" -o "$_tmp.reply" -w '%{http_code}'
        [ "$_request_method" = GET ] || set -- "$@" --data-binary "@$_tmp.body"
        HTTP_CODE=$(curl "$@" "$_url" 2>/dev/null)
        _rc=$?
        case "$HTTP_CODE" in 2[0-9][0-9]) ;; *) _rc=1 ;; esac
        if [ "$_rc" -eq 0 ] && { [ "$method" = dingtalk ] || [ "$method" = wecom ]; }; then
            [ "$(jsonfilter -i "$_tmp.reply" -e '@.errcode' 2>/dev/null)" = 0 ] || _rc=1
        fi
        rm -f "$_tmp.body" "$_tmp.reply" "$_tmp.headers"
    fi
    [ "$_rc" -eq 0 ] && { DELIVER_RESULT=sent; return 0; }
    return 1
}
scts_epoch() {
    # Text-mode AT timestamps use signed quarter-hours; the PDU adapter emits
    # ISO timestamps with an explicit UTC offset. Pure POSIX awk avoids GNU
    # date/mktime dependencies and the router's unrelated local timezone.
    printf '%s\n' "$1" | LC_ALL=C awk '
        function leap(y) { return y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) }
        {
            if ($0 ~ /^[0-9][0-9]\/[0-9][0-9]\/[0-9][0-9],[0-9][0-9]:[0-9][0-9]:[0-9][0-9][+-][0-9][0-9]$/) {
                y=2000+substr($0,1,2); mo=substr($0,4,2)+0; d=substr($0,7,2)+0
                h=substr($0,10,2)+0; mi=substr($0,13,2)+0; s=substr($0,16,2)+0
                sign=substr($0,18,1); offset=substr($0,19,2)*15
            } else if ($0 ~ /^20[0-9][0-9]-[0-9][0-9]-[0-9][0-9][ T][0-9][0-9]:[0-9][0-9]:[0-9][0-9][+-][0-9][0-9]:[0-9][0-9]$/) {
                y=substr($0,1,4)+0; mo=substr($0,6,2)+0; d=substr($0,9,2)+0
                h=substr($0,12,2)+0; mi=substr($0,15,2)+0; s=substr($0,18,2)+0
                sign=substr($0,20,1); om=substr($0,24,2)+0
                if (om > 59) exit 1
                offset=substr($0,21,2)*60+om
            } else exit 1
            split("31 28 31 30 31 30 31 31 30 31 30 31", days, " ")
            days[2]+=leap(y)
            if (mo<1 || mo>12 || d<1 || d>days[mo] || h>23 || mi>59 || s>59 || offset>840) exit 1
            n=10957 # days from 1970-01-01 to 2000-01-01
            for (i=2000; i<y; i++) n+=365+leap(i)
            for (i=1; i<mo; i++) n+=days[i]
            printf "%.0f\n", ((n+d-1)*24+h)*3600+mi*60+s-(sign=="-" ? -offset : offset)*60
        }
    '
}
sms_is_new() { # source, original timestamp, local import time
    number "$3" && [ "$3" -ge "$since" ] || return 1
    # Explicit direct delivery is a live event, even if the SMSC timestamp is
    # old (delayed delivery). SIM/legacy imports must prove their original age.
    [ "$1" = direct ] && return 0
    _sent=$(scts_epoch "$2") || return 1
    number "$_sent" && [ "$_sent" -ge "$since" ]
}
process_power() {
    power_read
    [ "$power_ok" = 1 ] || return 0
    [ "$power_percent" = "$current_percent" ] && [ "$power_status" = "$current_status" ] && return 0
    _old_percent=$power_percent; _old_status=$power_status
    power_percent=$current_percent; power_status=$current_status
    save_state || return 1
    # Establish a power baseline on first observation, not a synthetic alert.
    [ "$_old_status" != none ] || return 0
    [ "$enabled" = 1 ] && [ "$power_forward_enabled" = 1 ] || return 0
    # Match the built-in power policy: a status transition, or one
    # notification when crossing any threshold (including a jump over
    # several points).
    _point=
    if number "$_old_percent" && [ "$_old_percent" -le 100 ]; then
        for _threshold in 5 20 40 60 80 100; do
            if [ "$current_percent" -gt "$_old_percent" ] &&
                [ "$_old_percent" -lt "$_threshold" ] &&
                [ "$current_percent" -ge "$_threshold" ]; then
                _point=$_threshold
            elif [ "$current_percent" -lt "$_old_percent" ] &&
                [ "$_old_percent" -gt "$_threshold" ] &&
                [ "$current_percent" -le "$_threshold" ] && [ -z "$_point" ]; then
                _point=$_threshold
            fi
        done
    fi
    [ "$_old_status" != "$current_status" ] || [ -n "$_point" ] || return 0
    _detail=$(power_message "$current_status" "$current_percent" "$_point" "$_old_status")
    deliver power PowerMonitor "$_detail" || :
    record_delivery power || :
    write_result "$last_result" "$DELIVER_RESULT" || :
}
