和上游的区别：
- 内核多编了 ksmbd 模块（两个内核都有），配合预装的 ksmbd 用户态
- 预装 wsdd2（Windows 网络发现）
- LuCI 默认中文、Aurora 主题、时区东八区
- root 默认密码 password（kano 原版不设密码）
- 无预置共享，自己在 LuCI 里建
- 普通版：格卡全新安装；sysupgrade 版：保留数据升级（卡里没系统会直接报错退出，不会乱写）

和上游Kano的区别：
- 不包括任何VPN模块
- 内核有 ksmbd 模块，预装 wsdd2（方便使用SMB网络共享）

- LuCI 默认中文、Aurora 主题、时区东八区
- 默认用户名 root 默认密码 password

- 普通版：格卡全新安装；sysupgrade 版：保留数据升级（未测试）
