# 本 fork 的定制层（kano 永远碰不到 custom/）

跟踪：`tf-7.2` 分支跟随 `kanoqwq/mu300-linux clean-tf-7.2`，
`sync-kano.yml` 每天 02:00（UTC）合并。定制只放在 `custom/` 和
我们自己的 workflow 里，合并保持干净；同步变红就是真冲突，手动解。
`main` 分支不动。

构建按源码变更触发（kano 不发 release）：`ksmbd-build.yml` 在
`tf-7.2` 有推送（含同步合并）、每天定时或手动时跑；内核版本 +
kano 提交 + fragment 都没变就跳过。

产出：给两个内核线各编带 `CONFIG_SMB_SERVER=m` 的 `ksmbd.ko`
（6.18 定死 6.18.54，即设备在跑的版本，保证能装上；
7.2 取当时最新的 7.2.x，设备还没跑它，先备着）。fragment 挂载覆盖合并，
kano 的配置文件一个字不动，它自带的校验会连我们的行一起查。
装机前先对 vermagic（必须和运行中内核一致），再拷到
`/lib/modules/<版本>/`、`depmod`、`modprobe ksmbd`。

以前 fork 保留的功能，在这条线上的去处：
- ksmbd：本 CI 编内核模块 + 设备上装用户态（`apk add ksmbd-server`）。
  kano 和上游都没开它。
- wsdd2 预装：TF 包烘焙时装好（`custom/post-rootfs.sh`，跑在
  `tools/build-openwrt-tf-magisk.sh` 的 `MU300_POST_ROOTFS` 钩子上，
  该钩子是本 fork 对 kano 脚本唯一的 3 行改动）。
- 中文/时区/默认密码：同上，在烘焙里一次写好（kano 安装器不管密码；
  密码只在全新安装生效，更新保留旧密码）。
- TF 整包（6.18 + 7.2）：`tf-magisk-build.yml` 全流程重打，需要
  私有设备料仓。触发同上（源码一动就编）。
