# Sourced by lock. Interactive writes only; the early boot replay deliberately
# keeps its established short AT path and MU300-specific encodings.
fail_apply() { printf '%s\n' "$1" >&2; return 1; }

validate_apply() {
    local kind=$1 val=$2 cap encoded pair fr pc
    case "$kind:$val" in
        mode:auto|mode:4g|mode:sa|mode:nsa|endc:on|endc:off|auto_apply:on|auto_apply:off) return 0 ;;
        cell:auto|cell:off|cell:off-nr|cell:off-lte) return 0 ;;
    esac
    case "$kind" in
        lte|nr)
            [ -z "$val" ] && return 0
            printf '%s\n' "$val" | grep -Eq '^[1-9][0-9]*(,[1-9][0-9]*)*$' ||
                { fail_apply '无效的频段列表'; return 1; }
            [ "$kind" = lte ] && cap=$LTE_SUP || cap=$(nr_sup)
            [ "$(canonical_bands "$val")" = "$(canonical_bands "$(filter_bands "$val" "$cap")")" ] ||
                { fail_apply '所选频段不受此模组支持'; return 1; }
            if [ "$kind" = nr ]; then
                encoded=$(nr_bands "$(nr_masks "$(canonical_bands "$val")")")
                [ "$(canonical_bands "$encoded")" = "$(canonical_bands "$val")" ] ||
                    { fail_apply '所选频段无法用当前模组指令编码'; return 1; }
            fi
            ;;
        cell)
            printf '%s\n' "$val" | grep -Eq '^(nr|lte):[0-9]{1,7},[0-9]{1,4}$' ||
                { fail_apply '无效的小区参数'; return 1; }
            pair=${val#*:}; fr=${pair%,*}; pc=${pair#*,}
            # Decimal comparisons via awk also reject leading-zero surprises.
            printf '%s\n' "$fr,$pc" | awk -F, -v rat="${val%%:*}" '
                { exit !($1 > 0 && $1 <= (rat=="nr" ? 3279165 : 262143) &&
                         $2 >= 0 && $2 <= (rat=="nr" ? 1007 : 503)) }' ||
                { fail_apply '无效的小区参数'; return 1; }
            ;;
        *) fail_apply '无效的网络设置'; return 1 ;;
    esac
}

# A number of vendor setters omit OK after applying. Silence is NOT success:
# allow a fresh readback to prove it, but never accept an explicit modem ERROR.
write_setting() {
    local reply
    reply=$(lock_at "$1" "${2:-6}") || true
    if printf '%s\n' "$reply" | tr -d '\r' | grep -Eq '^(ERROR|\+CME ERROR|\+CMS ERROR)(:|$)'; then
        fail_apply '模组拒绝了设置'; return 1
    fi
}

restart_write() {
    if [ "${INTERACTIVE_APPLY:-0}" = 1 ]; then
        write_setting "$1" "$2" || restart_failed=1
    else
        at "$1" "$2" >/dev/null
    fi
}

read_field() {
    at "$1" 4 | sed -n "s/^+$2: *//p" | head -n1 | tr -d ' \t'
}

read_cells() {
    local rat=$1 p raw
    [ "$rat" = nr ] && p=16 || p=12
    raw=$(read_field "AT+SPFORCEFRQ=$p,3" SPFORCEFRQ)
    printf '%s\n' "$raw" | grep -Eq "^$p,3(,[0-9]+,[0-9]+)*$" || return 1
    printf '%s\n' "$raw" | awk -F, -v rat="$rat" '{for(i=3;i<NF;i+=2) print rat ":" $i "," $(i+1)}' | sort -u
}

verify_apply() {
    local raw got nr3
    case "$kind" in
        mode)
            raw=$(read_field 'AT+SPTESTMODE?' SPTESTMODE)
            [ "$(printf '%s' "$raw" | cut -d, -f1-3)" = "$m0,$m1,$prim" ] &&
                [ "$(read_field 'AT+SP5GRAN?' SP5GRAN)" = "$gran" ] ;;
        endc) endc_matches "$val" "$(read_field 'AT+SPENDC?' ENDC)" ;;
        lte)
            raw=$(read_field 'AT+SPLBAND=0' SPLBAND)
            printf '%s\n' "$raw" | grep -Eq '^[0-9]+(,[0-9]+){4}$' || return 1
            got=$(canonical_bands "$(lte_bands "$raw")")
            [ "$got" = "$val" ] || { [ -z "$val" ] && [ "$got" = "$(canonical_bands "$LTE_SUP")" ]; } ;;
        nr)
            raw=$(read_field 'AT+SPLBAND=3' SPLBAND)
            printf '%s\n' "$raw" | grep -Eq '^[0-9]+,0,[0-9]+(,[0-9]+)?$' || return 1
            nr3=$(printf '%s\n' "$raw" | awk -F, '{print $1","$3","(NF>=4?$4:0)}')
            got=$(canonical_bands "$(nr_bands "$nr3")")
            [ "$got" = "$val" ] || { [ -z "$val" ] && [ "$got" = "$(canonical_bands "$(nr_sup)")" ]; } ;;
        cell)
            got=$(read_cells lte) || return 1
            [ "$got" = "$want_lte" ] || return 1
            got=$(read_cells nr) || return 1
            [ "$got" = "$want_nr" ] ;;
    esac
}

do_apply() {
    local kind=$1 val=$2 m0 m1 prim gran tm v rat p fr pc pair want_lte want_nr c INTERACTIVE_APPLY=1
    validate_apply "$kind" "$val" || return 1
    _t0=$(date +%s)
    if [ "$kind" = auto_apply ]; then
        save_state auto_apply "$val" && [ "$(cat "$STATE_DIR/auto_apply")" = "$val" ] ||
            { fail_apply '设置保存失败'; return 1; }
        return 0
    fi
    apply_lock || return 1
    trap 'rm -f "$APPLY_DIR/pid"; rmdir "$APPLY_DIR" 2>/dev/null' EXIT
    trap 'exit 1' INT TERM
    [ ! -d /run/unisoc-data-sim-switch ] || { fail_apply '另一项网络设置仍在执行，请稍后重试'; return 1; }
    case "$kind" in
        mode)
            set -- $(mode_pair "$val"); m0=$1; gran=$2
            tm=$(read_field 'AT+SPTESTMODE?' SPTESTMODE)
            printf '%s\n' "$tm" | grep -Eq '^[0-9]+,[0-9]+,[01](,[0-9]+)*$' ||
                { fail_apply '无法读取当前 SIM 模式，未发送设置'; return 1; }
            m1=$(printf '%s' "$tm" | cut -d, -f2); prim=$(printf '%s' "$tm" | cut -d, -f3)
            write_setting "AT+SP5GRAN=$gran" && write_setting "AT+SPTESTMODE=$m0,$m1,$prim" || return 1
            ;;
        endc)
            [ "$val" = on ] && v=1 || v=2
            write_setting "AT+SPENDC=$v" || return 1 ;;
        lte)
            val=$(canonical_bands "$val")
            write_setting "AT+SPLBAND=1,$(lte_masks "$val")" || return 1 ;;
        nr)
            val=$(canonical_bands "$val")
            write_setting "AT+SPLBAND=2,$(nr_masks "$val" | awk -F, '{print $1",0,"$2","$3}')" || return 1 ;;
        cell)
            want_lte=$(read_cells lte) && want_nr=$(read_cells nr) ||
                { fail_apply '无法读取当前小区锁定，未发送设置'; return 1; }
            if [ "$val" = auto ]; then
                c=$RUNDIR/cell.json
                fr=$(jsonfilter -i "$c" -e '@.nr.arfcn' 2>/dev/null)
                pc=$(jsonfilter -i "$c" -e '@.nr.pci' 2>/dev/null)
                val="nr:$fr,$pc"
                if ! validate_apply cell "$val" 2>/dev/null; then
                    fr=$(jsonfilter -i "$c" -e '@.lte.earfcn' 2>/dev/null)
                    pc=$(jsonfilter -i "$c" -e '@.lte.pci' 2>/dev/null)
                    val="lte:$fr,$pc"
                fi
                validate_apply cell "$val" || return 1
            fi
            case "$val" in
                off|off-lte) write_setting 'AT+SPFORCEFRQ=12,4' || return 1; want_lte= ;;
            esac
            case "$val" in
                off|off-nr) write_setting 'AT+SPFORCEFRQ=16,4' || return 1; want_nr= ;;
                nr:*|lte:*)
                    rat=${val%%:*}; pair=${val#*:}
                    [ "$rat" = nr ] && p=16 || p=12
                    write_setting "AT+SPFORCEFRQ=$p,6,$pair" || return 1
                    if [ "$rat" = nr ]; then want_nr=$(printf '%s\n%s\n' "$want_nr" "$val" | sed '/^$/d' | sort -u)
                    else want_lte=$(printf '%s\n%s\n' "$want_lte" "$val" | sed '/^$/d' | sort -u); fi ;;
            esac
            ;;
    esac
    verify_apply || { fail_apply '模组回读与请求设置不一致，未保存'; return 1; }
    if [ "$kind" != endc ]; then
        sfun_restart || { fail_apply '协议栈重启被拒绝，请检查模组状态'; return 1; }
        at 'AT+CFUN?' 4 | grep -q '+CFUN: 1' ||
            { fail_apply '设置已写入，但射频未恢复，请检查模组状态'; return 1; }
        verify_apply || { fail_apply '协议栈重启后设置不一致，未保存'; return 1; }
    fi
    if [ "$kind" = cell ]; then
        val=$(printf '%s\n%s\n' "$want_lte" "$want_nr" | sed '/^$/d' | sort -u)
        # Replay consumes lines, including the final entry.
        [ -z "$val" ] || val="$val
"
    fi
    save_state "$kind" "$val" || { fail_apply '设置保存失败'; return 1; }
    say "verified apply $kind=$val"
    # One refresh, not the previous ten rounds that never terminated for auto.
    # The task outcome is based on the targeted fresh verification above.
    "$0" get fresh >/dev/null 2>&1
    return 0
}
