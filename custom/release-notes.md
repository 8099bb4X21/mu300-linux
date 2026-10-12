和上游 Kano 的区别（上游基线：kanoqwq/mu300-linux clean-tf-7.2 @ 33640d0，2026-10-12；custom/ 内 hotfix 均对应该基线验证）：

- 不含任何 VPN 模块（上游自带约百兆的 VPN 引擎，本包已精简）
- 内核内置 ksmbd 模块、预装 wsdd2，开箱即可用 SMB 共享文件
- LuCI 默认中文、Aurora 主题、东八区时区
- 短信：修复直收链路（cmt-spool 执行位）、LuCI 短信可见（默认池改指 kano 池）、时间显示统一为 AT 式
- IPv6 与安卓端一致：单 /64 前缀共享 + 策略路由，不做 NAT66，下游设备拿真公网地址
- 默认账号 root，默认密码 password

本发布含四个包：6.18、7.2 两个内核，各有普通版与升级版两种：

- 普通版：格式化 TF 卡，全新安装
- sysupgrade 版：保留数据升级（尚未实测）。保留 /etc/config、SSH 密钥等
  配置，但 root 密码会回到默认的 password；卡内没有系统时会直接报错退出，
  不会破坏数据

刷机：在 Magisk 中刷入对应内核的包，重启即进入 OpenWrt。