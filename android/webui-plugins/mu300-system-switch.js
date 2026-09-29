//<script>
/*
 * 【插件】mu300 系统切换器
 * 运行环境：设备 Android 侧的网页管理面板（与飞猫系列插件同一宿主）
 *
 * 功能：一键从 Android 切换到 Linux（当前 boot-os 指向的系统，本机为 OpenWrt）。
 * 方法：向 misc 分区 2048 偏移写入 32 字节 slot-b 引导块（与本仓库
 *       boot/android-boot-linux.sh、mu300-next-boot linux 使用的是同一份块数据），
 *       回读校验通过后才重启，校验失败绝不重启。
 *
 * 安全设计：
 *   1. 写入前先读 ro.boot.slot_suffix，仅当 Android 正运行于 slot _a 时才允许
 *      切换（本机布局 Android=a / Linux=b；其它布局直接拒绝，防止误写）。
 *   2. 写入后回读 misc 并与期望的 32 字节逐字节比对，一致才 reboot。
 *   3. 块数据 CRC 由 LK 校验，写坏的最坏结果是引导选择不变，不会变砖。
 */
(() => {
    // slot-b 试验引导块（tries=2）：本仓库 work/boot-linux-slotb.misc-slot-b-trial.bin 的字节
    const BC_BLOCK_HEX = '5f62000042434142010200009e002f000000000000000000000000009bf8546d';
    const MISC_PATH = '/dev/block/by-name/misc';

    const run = async (command, timeout = 15000) => {
        try {
            const res = await runShellWithRoot(command, timeout);
            return { ok: Boolean(res && res.success), text: String((res && res.content) || '').trim() };
        } catch (e) {
            return { ok: false, text: '' };
        }
    };

    const hexToPrintf = (hex) =>
        hex.match(/../g).map((b) => '\\x' + b).join('');

    const readSlot = async () => {
        const r = await run('getprop ro.boot.slot_suffix');
        return r.ok ? r.text : '';
    };

    const readMiscBlock = async () => {
        const r = await run(
            `dd if=${MISC_PATH} bs=1 skip=2048 count=32 2>/dev/null | od -An -tx1 -v | tr -d ' \\n'`
        );
        return r.ok ? r.text.replace(/[\r\n ]/g, '') : '';
    };

    const btns = document.createElement('button');
    btns.textContent = '系统切换器';
    btns.onclick = () => {
        const { el, close } = createFixedToast('mu300_os_switch', `
            <div style="pointer-events:all;width:80vw;max-width:300px">
                <div class="title" style="margin:0">系统切换器</div>
                <div style="margin:6px 0;font-size:.65rem;color:var(--dark-text-sub-color,#999)">
                    切换到 Linux（OpenWrt）需要重启设备
                </div>
                <div style="margin:6px 0;font-size:.65rem">
                    当前槽位：<span id="mu300_os_slot" style="font-family:monospace">检测中…</span>
                </div>
                <div style="margin:10px 0;display:flex;justify-content:space-around" class="mu300_os_content">
                </div>
                <div style="text-align:right">
                    <button style="font-size:.64rem" id="mu300_os_close" data-i18n="close_btn">${t('close_btn')}</button>
                </div>
            </div>
        `);

        const switchBtn = document.createElement('button');
        const rebootBtn = document.createElement('button');
        const content = el.querySelector('.mu300_os_content');
        const slotEl = el.querySelector('#mu300_os_slot');
        const closeBtn = el.querySelector('#mu300_os_close');
        if (!closeBtn) { close(); return; }
        closeBtn.onclick = () => close();

        const lockUI = (lock, except) => {
            [switchBtn, rebootBtn].forEach((b) => {
                if (b === except) return;
                b.disabled = lock;
                b.style.background = lock ? 'var(--dark-btn-disabled-color)' : '';
            });
        };

        switchBtn.textContent = '切换到 OpenWrt';
        switchBtn.onclick = async () => {
            lockUI(true, switchBtn);
            switchBtn.disabled = true;
            createToast('正在检查槽位…');
            // 安全检查：Android 必须正运行于 slot a（本机布局 a=Android / b=Linux）
            const slot = await readSlot();
            if (slot !== '_a') {
                createToast(`槽位布局异常（${slot || '未知'}），为防误写已取消；请反馈此值`, 'red');
                lockUI(false);
                return;
            }
            createToast('正在写入引导块…');
            const r = await run(
                `printf '${hexToPrintf(BC_BLOCK_HEX)}' | dd of=${MISC_PATH} bs=1 seek=2048 conv=notrunc && sync`
            );
            if (!r.ok) {
                createToast('引导块写入失败，未重启', 'red');
                lockUI(false);
                return;
            }
            createToast('正在校验…');
            const back = await readMiscBlock();
            if (back !== BC_BLOCK_HEX) {
                createToast('校验不一致，已放弃（设备未重启）', 'red');
                lockUI(false);
                return;
            }
            createToast('校验通过，即将重启进入 OpenWrt…', 'green');
            setTimeout(async () => {
                await run('reboot', 3000);
                createToast('重启中…', 'green');
            }, 1500);
        };

        rebootBtn.textContent = '仅重启';
        rebootBtn.onclick = async () => {
            lockUI(true, rebootBtn);
            createToast('重启中…');
            await run('reboot', 3000);
        };

        content.appendChild(switchBtn);
        content.appendChild(rebootBtn);

        // 打开面板即检测当前槽位并显示（非 _a 时禁用切换按钮）
        (async () => {
            const slot = await readSlot();
            slotEl.textContent = slot || '读取失败';
            if (slot !== '_a') {
                switchBtn.disabled = true;
                switchBtn.style.background = 'var(--dark-btn-disabled-color)';
                slotEl.style.color = 'var(--red-color,#E25555)';
            }
        })();
    };

    const collapseBtn_menu = document.querySelector('#collapseBtn_menu');
    collapseBtn_menu.nextElementSibling.querySelector('.collapse_box').appendChild(btns);
})();
//</script>
