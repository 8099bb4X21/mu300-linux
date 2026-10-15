# Android stores block nodes under /dev/block, whereas BusyBox losetup -f
# prints /dev/loopN. Source this helper before attaching an image.
desktop_loop_is_block() { [ -b "$1" ]; }
desktop_free_loop() {
    local candidate name index devno major minor node
    candidate=$(losetup -f) || return 1
    case "$candidate" in /dev/loop[0-9]*|/dev/block/loop[0-9]*) name=${candidate##*/} ;;
        *) echo 'cannot identify a free loop device' >&2; return 1 ;;
    esac
    index=${name#loop}
    case "$index" in ''|*[!0-9]*) echo 'invalid loop index' >&2; return 1 ;; esac
    if desktop_loop_is_block "/dev/block/$name"; then
        echo "/dev/block/$name"
    elif desktop_loop_is_block "$candidate"; then
        echo "$candidate"
    else
        # ueventd may not have created a newly allocated loop node yet. Keep
        # our fallback in private staging rather than altering global /dev.
        devno=$(cat "/sys/class/block/$name/dev") || return 1
        major=${devno%:*}; minor=${devno#*:}
        case "$major:$minor" in *[!0-9:]*|:*) return 1 ;; esac
        [ "$major" = 7 ] && [ "$minor" = "$((index * 8))" ] || return 1
        node=${MU300_INSTALL_TMP:?}/$name
        [ ! -e "$node" ] || { echo "loop staging node already exists: $node" >&2; return 1; }
        mknod "$node" b "$major" "$minor" || return 1
        desktop_loop_is_block "$node" || return 1
        echo "$node"
    fi
}
