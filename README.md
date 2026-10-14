# luci-app-mu300-cpusimple（MU300 CPU 简易设置）

蜂窝 → **CPU简易设置**：五个一键模式 + “默认生效”勾选框（默认不勾） + 真关核（热插拔）开关。

## 模式

| 模式 | 可用核（cpuset） | 频率 | 调速器 | 性能 / 功耗 |
|---|---|---|---|---|
| OpenWrt 默认 | 8 核（0–7） | 恢复开机基线 | 基线（schedutil） | 官方默认，随负载升降频 |
| Android 默认 | 4 核（0–3，仅小核） | 小核 ≤ 1.4 GHz，大核压最低 | schedutil | 最省电、发热最低；吞吐明显下降，适合轻载常开 |
| 小核省电模式 | 4 核（0–3，仅小核） | 小核不锁频，大核压最低 | schedutil | 省电但小核可全速，响应好于 Android 默认 |
| 适中模式 | 5 核（0–3 小核 + CPU 7） | 小核与 CPU 7 不锁频，CPU 4–6 压最低 | schedutil | 兼顾性能与功耗，适合中等负载 |
| 性能模式 | 8 核（0–7） | 三簇锁最高（2002 / 2301 / 2210 MHz） | performance | 最高性能；发热功耗最大；本机满载可能断网（机器固有），慎用 |

## 勾选语义（与内置“CPU 设置”页一致）

- 勾选“默认生效”：写入 `/etc/mu300/cpusimple/config.json`（模式 + cpuset），频率经内置 `cpu.uc` 持久到 `/etc/unisoc-modem/cpu.json`；开机由 `S98 mu300-cpusimple` 与 `S99 unisoc-cpu` 回放。
- 不勾：仅本次生效，不写配置；重启回到上次持久设置，无则回系统默认。
- 勾选“OpenWrt 默认”+持久 = 清除所有持久覆盖（等同 forget）。

## 真关核（热插拔）开关

- 默认关闭；包在每次应用/开机都探测 `cpuN/online`。
- 当前内核（无 `CONFIG_HOTPLUG_CPU`）下**禁用**，自动回退为 cpuset 限制。
- 重编内核开启 `CONFIG_HOTPLUG_CPU` 后，打开此开关可让“Android 默认/小核省电”真正 `cpu4–7 online=0`，“适中模式”真正 `cpu4–6 online=0`。

## 与内置页的关系

- 频率复用 `/usr/libexec/unisoc-modem/cpu`（`cpu.uc`），与内置 `admin/modem/cpu` 共享 `/etc/unisoc-modem/cpu.json`，最后操作者生效。
- 核心限制（cpuset）由本包独立管理，不碰温控。

## 安装 / 构建

- 活体调试：直接把 `root/` 与 `htdocs/` 拷贝到设备对应位置，`chmod +x`，重启 `rpcd` 并清 luci 缓存。
- 正式包：`cloud/build.sh`（OpenWrt SDK + Docker，`PKGARCH:=all`）输出 `.apk`。