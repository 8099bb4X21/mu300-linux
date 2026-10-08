和上游 Kano 的区别：

- 不含任何 VPN 模块（上游自带约百兆的 VPN 引擎，本包已精简）
- 内核内置 ksmbd 模块、预装 wsdd2，开箱即可用 SMB 共享文件
- LuCI 默认中文、Aurora 主题、东八区时区
- 默认账号 root，默认密码 password

本发布含四个包：6.18、7.2 两个内核，各有普通版与升级版两种：

- 普通版：格式化 TF 卡，全新安装
- sysupgrade 版：保留数据升级（尚未实测）。保留 /etc/config、SSH 密钥等
  配置，但 root 密码会回到默认的 password；卡内没有系统时会直接报错退出，
  不会破坏数据

刷机：在 Magisk 中刷入对应内核的包，重启即进入 OpenWrt。