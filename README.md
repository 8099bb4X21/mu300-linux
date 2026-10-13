# mu300-smsfwd（独立选装包）

MU300 的旁挂短信转发：内置转发的 4 路渠道（Webhook / 钉钉 / SMTP /
本机短信）之外再加一路**企业微信群**，但每条新短信先过一道**本机号白名单
+ 内容关键词 + 正则改写**筛选（对标安卓短信转发插件的筛选逻辑）。

独立仓库、独立 `.apk`，刷机后上传安装；**不进 custom、不动固件仓库**。
云编译产出见 `.github/workflows/smsfwd-build.yml`（Artifacts only，无 Release）。

## 筛选语义（与插件一致）

1. 短信内容命中**白名单关键词** → 立即转发（最高优先级，无视其余规则）。
2. 本机号（`AT+CNUM`，与状态看板同一来源）**不在白名单** → 不转发。
3. 短信内容命中**黑名单关键词** → 不转发。
4. 其余 → 转发。

本机号读不到时按"不转发"处理（默认拒绝）。白名单条目只比数字（末 11 位，
国家码忽略）。关键词均为正则（Oniguruma，经 `jq`，支持 `(?i)`/`(?s)`/前瞻）；
编译失败的 pattern 永不命中。`regex.txt` 的 `pattern===replacement` 规则按序对**短信正文本身**做全局改写，
`$1..$9` 与 `\n` 可用；人读渠道（钉钉/邮件/本机短信/企业微信群）拿到的都是
改写后的正文，通用 Webhook 收原文。JSON 结构与发件人/时间/设备备注不受影响。
测试与电源消息不受改写影响。

企业微信群填机器人 Key（`send?key=` 后面的那串），只发文本（最长 2048 字节），
服务端返回 `errcode 0` 才算成功；注意官方限制每分钟最多 20 条。

除筛选外，沿用内置转发的全部纪律：`last_id|since` 游标与历史屏障（启用/
换渠道不补发历史）、指纹去重、失败不重试、投递记录最近 30 条（仅时间/
类型/渠道，不含号码与正文）、纯公网 HTTPS（TLS 校验、拒私网 DNS、不跟随
重定向）、密码只存 0600 文件。

## 安装 / 卸载（设备上，root）

```
apk add --allow-untrusted mu300-smsfwd-*.apk
apk del mu300-smsfwd
```

安装时自动停用内置 `unisoc-sms-forward` 服务并启用本包服务；
卸载时自动恢复内置服务。用户配置（见下）在升级/重装时保留
（`conffiles`）。依赖 `jq`（正则）等由 `apk` 从官方源自动安装。

## 文件与配置

```
安装后：
/usr/libexec/mu300-smsfwd/forward          守护（扫池→筛选→投递）
/usr/libexec/mu300-smsfwd/{lib.sh,channels.sh,own-template.uc,rx.jq}
/usr/libexec/rpcd/mu300smsfwd              ubus 对象（LuCI 调用）
/usr/sbin/mu300-smsfwd                     命令行：status|enable|disable|test|msisdn|lists
/etc/init.d/mu300-smsfwd                   服务（START=96，procd）
/etc/mu300/smsfwd/config.json              渠道配置（与内置同形，另有名单行数）
/etc/mu300/smsfwd/whitelist.txt            白名单（本机卡号，每行一个）
/etc/mu300/smsfwd/keywords.txt             白名单关键词（正则）
/etc/mu300/smsfwd/blacklist.txt            黑名单关键词（正则）
/etc/mu300/smsfwd/regex.txt                改写规则（pattern===replacement）
/run/mu300-smsfwd-result[.history]         本包独立的状态/记录（不碰内置的）
LuCI：蜂窝 → 短信转发+（/admin/modem/smsfwd）
```

`mu300-smsfwd status` 一眼看全：服务、开关、本机号、游标、最近结果、名单行数。

## 本机构造与云编译

```
cloud/Dockerfile      SDK 构建镜像（照搬固件仓库 block-mount）
cloud/build-inner.sh  下载 OpenWrt 25.12.5 SDK → 编 mu300-smsfwd → 出 .apk
cloud/build.sh        本地编包入口（含输入指纹缓存）：cloud/build.sh [OUT.apk]
tests/test_msfwd_lib.sh  筛选库单元测试（dash/bash，无需设备；有 jq 则跑正则）
```

推送到 `main`（或 `mu300-smsfwd`）分支即触发云编译，产物在 Artifacts
（`mu300-smsfwd-apk`）下载。包为 `PKGARCH:=all` 纯 shell，无需交叉编译。

## 与内置转发的关系

- 收信链（atd → cmt-spool → smsd → 短信池）完全复用，只读池、不碰 AT；
  本机号经带缓存的 `AT+CNUM` 在锁外刷新（默认 5 分钟），从不阻塞转发。
- 电源通知一并接管（与内置同策略：状态变化或跨 5/20/40/60/80/100% 阈值）。
- 单卡简化：不做按 SIM 独立配置（名单里可放多个本机号应对换卡）。
