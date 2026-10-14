# MU300 CPU 简易设置：模式与性能影响详述

> 包：`luci-app-mu300-cpusimple`（蜂窝 → CPU简易设置）。本文是页面内联说明的详细版。
> 实测机：中兴 F50（MU300，Unisoc UMS9620 / T760，4×A55 + 4×A76），OpenWrt 25.12.5，内核 6.18.54。

## 硬件基线（三个调频簇）

| 簇 | CPU | 核心 | 硬件频率 |
|---|---|---|---|
| policy0 | 0–3 | Cortex-A55（小核） | 614400 ~ 2002000 |
| policy4 | 4–6 | Cortex-A76（大核） | 768000 ~ 2301000 |
| policy7 | 7 | Cortex-A76（大核） | 614400 ~ 2210000 |

调度容量实测：小核 363，大核 1024/985。调速器默认 `schedutil`。

## 五个模式

| 模式 | 服务可用核（cpuset） | 频率设置 | 调速器 | 性能 / 功耗 / 适用 |
|---|---|---|---|---|
| OpenWrt 默认 | 0–7（8 核） | 恢复开机基线（不锁频） | 基线（schedutil） | 官方默认，随负载升降；通用 |
| Android 默认 | 0–3（仅 4 小核） | 小核 ≤ 1404000，大核两簇压最低 | schedutil | 最省电、发热最低；吞吐明显下降；轻载常开 |
| 小核省电模式 | 0–3（仅 4 小核） | 小核不锁频，大核两簇压最低 | schedutil | 省电但小核可全速，响应好于 Android 默认 |
| 适中模式 | 0–3,7（4 小核 + CPU 7） | 小核与 CPU 7 不锁频，CPU 4–6 压最低 | schedutil | 兼顾性能与功耗；中等负载 |
| 性能模式 | 0–7（8 核） | 三簇锁最高（2002 / 2301 / 2210 MHz） | performance | 最高性能；发热功耗最大，注意散热 |

说明：

- “可用核”指系统服务（procd `services` 树）被 cgroup v2 `cpuset` 限制到的核；PID 1 与内核线程不受限（本就很轻）。
- 大核“压最低”指 `scaling_min=max=硬件最低`；小核“不锁频”指 `min=硬件最低、max=硬件最高`。
- 性能模式把频率钉死，空载也跑满，功耗与发热显著高于 `schedutil` 放开上限的做法。

## 持久语义（与内置“CPU 设置”页一致）

- 勾选“默认生效”（页面默认**不勾**）：模式 + cpuset 写入 `/etc/mu300/cpusimple/config.json`，频率经内置 `cpu.uc` 持久到 `/etc/unisoc-modem/cpu.json`；开机由 `S98 mu300-cpusimple`（cpuset/热插拔）与 `S99 unisoc-cpu`（频率）回放。
- 不勾：仅本次生效，不写配置；重启回到上次持久设置，无则回系统默认。
- 勾选“OpenWrt 默认”+持久 = 清除所有持久覆盖（等同 `forget`）。
- 页面显示“当前生效模式”（上次实际应用，存 `/run`，重启失效）与“已存默认”两个字段，避免 session-only 后误读。

## 真关核（热插拔）开关

- 默认关闭；每次应用/开机都探测 `cpuN/online` 是否存在。
- 当前内核（未开 `CONFIG_HOTPLUG_CPU`）下**禁用**，自动回退为 cpuset。
- 重编内核开启后：Android 默认/小核省电真正 `cpu4–7 offline`；适中模式 `cpu4–6 offline`（**并把 CPU 7 重新上线**，防止从纯小核模式切过来时它还关着）；性能/OpenWrt 默认全上线。
- 彻底程度：不改内核时，开机即把 services 树限到小核（用户态彻底只用小核），但大核仍在线；改内核后可开机真正下线大核，等价 Android。

## 与内置页的关系

- 频率复用 `/usr/libexec/unisoc-modem/cpu`（`cpu.uc`），与 `admin/modem/cpu` 共享存储，最后操作者生效；本包不存第二份频率状态。
- 核心限制（cpuset）与 `active` 跟踪由本包独立管理；不碰温控阈值。

## 验证

- 回归环 `tests/test_cpusimple.sh`（mock sysfs + 假 `cpu.uc`）：dash/bash 各 **79/79**，覆盖 5 模式 × 持久/本次、非法输入、热插拔有/无、boot 回放、forget。
- 活体（192.168.77.1）：5 模式 sysfs 落点、cpuset（`0-3` / `0-3,7` 精确匹配）、持久/本次、boot 回放、ubus、LuCI 路由与 JS 均验证。
- 回归环曾抓到真 bug：`balanced`+热插拔必须把 CPU 7 重新上线（已修）。