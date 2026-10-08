# 本 fork 的定制层（kano 永远碰不到 custom/）

跟踪：`tf-7.2` 分支跟随 `kanoqwq/mu300-linux clean-tf-7.2`，
`sync-kano.yml` 每天 02:00（UTC）合并。定制只放在 `custom/` 和
我们自己的 workflow 里，合并保持干净；同步变红就是真冲突，手动解。
`main` 分支不动。

构建按源码变更触发（kano 不发 release）：`tf-magisk-build.yml`
分四段：裁决（输入没变直接跳过）→ 5.4 驱动预编一次 →
双内核并行编（主线内核 + ksmbd 合片、rootfs 烘焙、TF 打包）→
统一发版。发版说明来自 `custom/release-notes.md`（改中文只动它），
机器标记另起段落附后，裁决按标记行精确匹配。

产出：一个 release 里四个包（6.18/7.2 × 普通版/sysupgrade 版），
外加校验文件。ksmbd.ko 随 TF 包里的内核模块一起走，不再单独发版。
fragment 挂载覆盖合并，kano 的配置文件一个字不动，它自带的校验会
连我们的行一起查。

以前 fork 保留的功能，在这条线上的去处：
- ksmbd：本 CI 编内核模块 + 设备上装用户态（`apk add ksmbd-server`）。
  kano 和上游都没开它。
- wsdd2 预装：TF 包烘焙时装好（`custom/post-rootfs.sh`，跑在
  `tools/build-openwrt-tf-magisk.sh` 的 `MU300_POST_ROOTFS` 钩子上，
  该钩子是本 fork 对 kano 脚本唯一的 3 行改动）。
- 中文/时区/默认密码：同上，在烘焙里一次写好（kano 安装器不管密码；
  密码只在全新安装生效，更新保留旧密码）。
