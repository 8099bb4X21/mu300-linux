#!/bin/sh
# Regression harness for luci-app-mu300-cpusimple (mock sysfs, no device).
# Runs under dash/bash/busybox ash. Uses real jsonfilter when present,
# otherwise tests/fakebin/jsonfilter (python3). Fake built-in cpu.uc needs python3.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
BIN=$HERE/root/usr/libexec/mu300-cpusimple/cpusimple
pass=0
fail=0
expect() {
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        echo "FAIL: $1 (got [$2] want [$3])"
    fi
}
# Every backend reply must be parseable JSON (offline clusters must not
# produce bare empty numbers). Returns 0 when valid.
valid_json() { printf '%s' "$1" | python3 -c 'import sys,json; json.load(sys.stdin)' 2>/dev/null; }
expect_valid() {
    if valid_json "$2"; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        echo "FAIL: $1 (invalid JSON)"
    fi
}

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 missing"; exit 0; }
if command -v jsonfilter >/dev/null 2>&1; then
    :
else
    PATH=$HERE/tests/fakebin:$PATH
    export PATH
fi
command -v jsonfilter >/dev/null 2>&1 || { echo "SKIP: no jsonfilter and no python fake"; exit 0; }

T=$(mktemp -d 2>/dev/null || { mkdir -p /tmp/cstest$$ && echo /tmp/cstest$$; })
trap 'rm -rf "$T"' EXIT INT TERM

# --- fake sysfs (real MU300 values) -------------------------------------------
mkpol() { # id cpus hwmin hwmax "freqs"
    d=$T/cpufreq/$1
    mkdir -p "$d"
    printf '%s' "$2" > "$d/affected_cpus"
    printf '%s' "$3" > "$d/cpuinfo_min_freq"
    printf '%s' "$4" > "$d/cpuinfo_max_freq"
    printf 'schedutil' > "$d/scaling_governor"
    printf 'ondemand userspace powersave performance schedutil' > "$d/scaling_available_governors"
    printf '%s' "$3" > "$d/scaling_min_freq"
    printf '%s' "$4" > "$d/scaling_max_freq"
    printf '%s' "$3" > "$d/scaling_cur_freq"
    printf '%s' "$5" > "$d/scaling_available_frequencies"
}
mkpol policy0 "0 1 2 3" 614400 2002000 "614400 768000 936000 1105000 1228800 1404000 1560000 1703000 1846000 2002000"
mkpol policy4 "4 5 6" 768000 2301000 "768000 1157000 1228800 1326000 1536000 1703000 1755000 2054000 2171000 2301000"
mkpol policy7 "7" 614400 2210000 "614400 768000 936000 1105000 1228800 1378000 1536000 1703000 1872000 2041000 2210000"
# Pristine copy to restore fake policy files after offline-unreadable tests.
cp -r "$T/cpufreq" "$T/cpufreq.pristine"

mkdir -p "$T/cgroup/services" "$T/cpu" "$T/etc/mu300/cpusimple" "$T/etc/unisoc-modem"
: > "$T/cgroup/cgroup.subtree_control"
printf '0-7' > "$T/cgroup/services/cpuset.cpus"
# effective must faithfully follow cpuset.cpus (else the mock lies).
# Prefer a hardlink (truncate+write propagates); fall back to symlink.
if ln "$T/cgroup/services/cpuset.cpus" "$T/cgroup/services/cpuset.cpus.effective" 2>/dev/null; then
    :
elif ln -s cpuset.cpus "$T/cgroup/services/cpuset.cpus.effective" 2>/dev/null; then
    :
else
    echo "SETUP FAIL: cannot link effective"; exit 1
fi
printf '0-3' > "$T/cgroup/services/cpuset.cpus"
[ "$(cat "$T/cgroup/services/cpuset.cpus.effective")" = "0-3" ] || { echo "SETUP FAIL: effective not following cpuset.cpus"; exit 1; }
printf '0-7' > "$T/cgroup/services/cpuset.cpus"
printf '0' > "$T/cgroup/services/cpuset.mems"

export MU300_CPU_BIN=$HERE/tests/fake-cpu
export MU300_CPUSIMPLE_CGROUP=$T/cgroup
export MU300_CPUSIMPLE_CPUFREQ=$T/cpufreq
export MU300_CPUSIMPLE_CPUDIR=$T/cpu
export MU300_CPUSIMPLE_CFG=$T/etc/mu300/cpusimple/config.json
export MU300_CPUSIMPLE_RUN=$T/run-active
export FAKE_CPUFREQ=$T/cpufreq
export FAKE_CPU_JSON=$T/etc/unisoc-modem/cpu.json

rd() { cat "$T/cpufreq/$1/$2" 2>/dev/null; }
# NOTE: product stderr is intentionally NOT suppressed so CI shows real errors.
apply() { printf '%s' "$1" | "$BIN" apply; }
okof() { printf '%s' "$1" | jsonfilter -e '@.ok' 2>/dev/null; }

# --- 1. get on a clean tree ----------------------------------------------------
g=$("$BIN" get)
expect "get ok" "$(okof "$g")" "1"
expect "get cpus" "$(printf '%s' "$g" | jsonfilter -e '@.cpus_effective')" "0-7"
expect "get hotplug unsupported" "$(printf '%s' "$g" | jsonfilter -e '@.hotplug_supported')" "false"

# --- 2. all five modes, session-only -------------------------------------------
check_mode() { # mode exp_p0min exp_p0max exp_p4max exp_p7max exp_cpuset exp_gov
    r=$(apply "{\"mode\":\"$1\",\"persist\":false,\"hotplug\":false}")
    expect "$1 ok" "$(okof "$r")" "1"
    expect_valid "$1 json" "$r"
    expect "$1 active" "$(printf '%s' "$r" | jsonfilter -e '@.active')" "$1"
    expect "$1 p0min" "$(rd policy0 scaling_min_freq)" "$2"
    expect "$1 p0max" "$(rd policy0 scaling_max_freq)" "$3"
    expect "$1 p4max" "$(rd policy4 scaling_max_freq)" "$4"
    expect "$1 p7max" "$(rd policy7 scaling_max_freq)" "$5"
    expect "$1 cpuset" "$(cat "$T/cgroup/services/cpuset.cpus.effective")" "$6"
    expect "$1 gov" "$(rd policy0 scaling_governor)" "$7"
    expect "$1 no cfg" "$([ -f "$MU300_CPUSIMPLE_CFG" ] && echo yes || echo no)" "no"
}
check_mode openwrt-default 614400 2002000 2301000 2210000 0-7 schedutil
check_mode android-default 614400 1404000 768000 614400 0-3 schedutil
check_mode little-save 614400 2002000 768000 614400 0-3 schedutil
check_mode balanced 614400 2002000 768000 2210000 0-3,7 schedutil
check_mode performance 2002000 2002000 2301000 2210000 0-7 performance

# --- 3. persist writes config + fake cpu.json -----------------------------------
r=$(apply '{"mode":"android-default","persist":true,"hotplug":false}')
expect "persist ok" "$(okof "$r")" "1"
expect "persist cfg mode" "$(jsonfilter -e '@.mode' < "$MU300_CPUSIMPLE_CFG")" "android-default"
expect "persist cpu.json" "$([ -f "$FAKE_CPU_JSON" ] && echo yes || echo no)" "yes"

# --- 4. persisting openwrt-default clears everything -----------------------------
r=$(apply '{"mode":"openwrt-default","persist":true,"hotplug":false}')
expect "default-persist ok" "$(okof "$r")" "1"
expect "default-persist cfg gone" "$([ -f "$MU300_CPUSIMPLE_CFG" ] && echo yes || echo no)" "no"
expect "default-persist cpu.json gone" "$([ -f "$FAKE_CPU_JSON" ] && echo yes || echo no)" "no"

# --- 5. invalid inputs ------------------------------------------------------------
expect "bad mode" "$(okof "$(apply '{"mode":"nope","persist":false}')" )" "0"
expect "bad json" "$(okof "$(printf 'not json' | "$BIN" apply)")" "0"
expect "empty" "$(okof "$(printf '' | "$BIN" apply)")" "0"

# --- 6. hotplug requested but unsupported -> forced off, still ok -------------------
r=$(apply '{"mode":"android-default","persist":false,"hotplug":true}')
expect "hotplug-unsupported ok" "$(okof "$r")" "1"
expect "hotplug-unsupported cpuset" "$(cat "$T/cgroup/services/cpuset.cpus.effective")" "0-3"

# --- 7. boot replays persisted cpuset ----------------------------------------------
apply '{"mode":"balanced","persist":true,"hotplug":false}' >/dev/null
printf '0-7' > "$T/cgroup/services/cpuset.cpus"
rm -f "$T/run-active"
"$BIN" boot >/dev/null
expect "boot restores cpuset" "$(cat "$T/cgroup/services/cpuset.cpus.effective")" "0-3,7"
expect "boot active" "$("$BIN" get | jsonfilter -e '@.active')" "balanced"

# --- 8. forget ----------------------------------------------------------------------
r=$("$BIN" forget)
expect "forget ok" "$(okof "$r")" "1"
expect "forget active" "$(printf '%s' "$r" | jsonfilter -e '@.active')" "openwrt-default"
expect "forget cfg gone" "$([ -f "$MU300_CPUSIMPLE_CFG" ] && echo yes || echo no)" "no"
expect "forget cpuset" "$(cat "$T/cgroup/services/cpuset.cpus.effective")" "0-7"
expect "forget cpu.json gone" "$([ -f "$FAKE_CPU_JSON" ] && echo yes || echo no)" "no"

# --- 9. hotplug-capable kernel --------------------------------------------------------
for c in 4 5 6 7; do mkdir -p "$T/cpu/cpu$c"; printf '1' > "$T/cpu/cpu$c/online"; done
g=$("$BIN" get)
expect "hotplug detected" "$(printf '%s' "$g" | jsonfilter -e '@.hotplug_supported')" "true"
apply '{"mode":"android-default","persist":false,"hotplug":true}' >/dev/null
for c in 4 5 6 7; do expect "offline cpu$c" "$(cat "$T/cpu/cpu$c/online")" "0"; done
apply '{"mode":"balanced","persist":false,"hotplug":true}' >/dev/null
for c in 4 5 6; do expect "balanced offline cpu$c" "$(cat "$T/cpu/cpu$c/online")" "0"; done
expect "balanced keeps cpu7" "$(cat "$T/cpu/cpu7/online")" "1"
apply '{"mode":"performance","persist":false,"hotplug":true}' >/dev/null
for c in 4 5 6 7; do expect "online cpu$c" "$(cat "$T/cpu/cpu$c/online")" "1"; done

# --- 10. offline clusters unreadable -> get stays valid JSON with nulls ---------------
# Emulate kernel "Resource busy" by removing fake policy files of offlined clusters.
apply '{"mode":"android-default","persist":false,"hotplug":true}' >/dev/null
for p in policy4 policy7; do
    rm -f "$T/cpufreq/$p/scaling_min_freq" "$T/cpufreq/$p/scaling_max_freq" \
        "$T/cpufreq/$p/scaling_cur_freq" "$T/cpufreq/$p/scaling_governor" \
        "$T/cpufreq/$p/affected_cpus" "$T/cpufreq/$p/cpuinfo_min_freq" \
        "$T/cpufreq/$p/cpuinfo_max_freq" "$T/cpufreq/$p/scaling_available_frequencies" \
        "$T/cpufreq/$p/scaling_available_governors"
done
g=$("$BIN" get)
expect_valid "offline get json" "$g"
expect "offline null" "$(printf '%s' "$g" | python3 -c 'import sys,json; d=json.load(sys.stdin); print([p["min"] for p in d["policies"] if p["id"]=="policy4"][0] is None)')" "True"
# Restore readability (kernel restores nodes once onlined).
for p in policy4 policy7; do cp "$T/cpufreq.pristine/$p/"* "$T/cpufreq/$p/"; done

# --- 11. any apply recovers previously-offlined cores (pre-online) ----------------------
apply '{"mode":"little-save","persist":false,"hotplug":true}' >/dev/null
expect "stuck offline cpu4" "$(cat "$T/cpu/cpu4/online")" "0"
r=$(apply '{"mode":"performance","persist":false,"hotplug":false}')
expect "recover ok" "$(okof "$r")" "1"
expect_valid "recover json" "$r"
for c in 4 5 6 7; do expect "recover online cpu$c" "$(cat "$T/cpu/cpu$c/online")" "1"; done

echo "pass=$pass fail=$fail"
[ "$fail" = "0" ]