# OpenWrt Installer

## 中文

完整解压 ZIP 后，双击根目录 **OpenWrt-Installer.exe**。请保留旁边的 `tools/`、`files/` 或 `payload/`、`desktop/`、`scripts/` 等目录。Windows 用户无需安装 Python、Node 或 Rust。程序使用系统 Microsoft Edge WebView2 Evergreen Runtime；缺失时会显示原生提示和安装地址：<https://developer.microsoft.com/microsoft-edge/webview2/>。不包含独立浏览器，不安装 Docker。

`OpenWrt-Installer.py` 是兼容的命令行入口，需要 Python 及相应模块。Windows 的 `launchers/*.cmd` 优先使用随包解释器运行 CLI，普通用户应从根目录 EXE 开始。Magisk 用户仍可直接刷入同一个 ZIP；根目录 `module.prop`、`customize.sh` 和 Magisk 必需文件保留原用途。桌面依赖不会进入设备系统镜像。整个包只有一份系统载荷。

### 选择用途

- **安装 OpenWrt**：TF 卡或独立内置分区。先校验包，再明确选择 USB 设备并检查。即使连接多台设备，后续 ADB 操作也只发送到所选序列号。最终确认前会再次检查实际机型、槽位、闪存身份和计划。
- **更新 OpenWrt**：从运行中的 OpenWrt 通过 SSH 上传，输入设备管理地址及 root 密码。密码仅在本次进程内存中使用，不写入事务或日志。保留设置、已有容量及本机固件；设备端升级互斥和校验继续有效，不要求 SFTP。请先手动连接设备网络。
- **继续未完成的安装**：选择本机事务，使用原包或兼容修复版。按真实机型、系统/启动载荷和文件系统工具哈希验证，不按目录名判断；可以移动或重命名包。载荷不一致会明确列出差异。
- **临时启动已安装的 OpenWrt**：检查启动签名及启动链后，只修改 misc 试启动信息。与“设为默认启动”不同，不修改默认值，不为探测安装状态挂载或写入 OpenWrt 根分区。现有设备端默认启动管理入口继续可用。
- **高级选项**：重装已有内置分区会替换其中的 OpenWrt 与设置，保留 Android；userdata 镜像属于**实验性功能，可能损坏 Android F2FS 文件系统**。镜像大小受真实可用空间、Android 预留及上传/生成临时空间限制。

### TF 卡

按仓库原有规则选择第一分区；只有确实没有分区时才选择整卡。不会重划 TF 卡，也没有 32 GiB 上限。请核对计划中的准确块设备与容量。安装前校验载荷、提取本机固件、释放 Android 对目标卡的挂载；释放失败就停止。所选目标会被格式化并使用其容量，其他分区不参与。原 Magisk TF 部署入口保留。

### 独立内置分区

优先使用已验证 GPT 未分配区域，足够时不缩容或清空 userdata。没有合适区域时使用既有离线缩容逻辑。计划显示 Android 保留空间、OpenWrt 分配大小及数据影响。

“使用全部已分配的 OpenWrt 分区容量”默认开启，意思是扩满选定大小的 OpenWrt 分区，**不是占用设备所有剩余空间**。设备端写入后检查文件系统块数，进入 OpenWrt 后再次读取 ext4 超级块验证实际容量。验证没通过不会显示安装成功。

首次启动会进行离线分区准备，可能需要数分钟，完成后设备会自动重启一次。数据较多或存储较慢时可能更久，请一直供电。检查、缩容、格式化、扩容显示阶段与耗时，不显示虚构百分比。

### 加密 userdata：重置后自动续装

检测到 FBE/FDE 或映射加密 data，且必须缩容时，计划会明确说明 Android 用户数据全部清空。仅在最终确认后继续。安装器将事务与必要备份先写入电脑，再准备 initramfs 交接。第一阶段依靠启动镜像中的请求及准备标记，系统载荷留在电脑，不依赖即将被清空的 `/data` 文件。

1. 保持设备供电，等待离线分区准备和原厂 recovery 清空数据。
2. 设备回到 Android 后完成初始设置。
3. 开启开发者选项、USB 调试，在设备上允许这台电脑调试。
4. 若 root 不存在，安装或恢复 Magisk；若出现 root 请求，请允许。已经可用的 root 会被直接接受，不要求重复安装。
5. 安装器验证同一设备、实际 `su` 权限、原槽位、分区几何与准备标记，然后继续传输安装。

这些等待**没有总超时**。预期重启或 USB 消失属于等待状态，不是 EOF 失败。无 ADB 时电脑无法区分“Android 仍在开机”和“尚未开启调试”；界面同时给出初始化、开启调试与允许授权的具体步骤。未加密 userdata 保留离线保数据缩容，不默认清空。

### 暂停、关闭与失败恢复

事务默认位于 `%LOCALAPPDATA%\OpenWrt-Installer\transactions\<transaction-id>\`。通过“打开事务目录”查看，通过“导出事务与备份”生成 ZIP。备份含设备身份和可能含无线配置的旧后端记录，请妥善保管，不要公开上传。默认日志不包含原终端输出、密码、短信正文或完整设备标识。

“在安全边界暂停”会等待正在进行的存储操作结束，不会直接杀进程。任务执行中关闭窗口会被阻止并提示先暂停。暂停后可以关闭、重启电脑或移动包；重新打开 EXE，选择“继续未完成的安装”。若已提交离线准备，暂停不会撤销设备已收到的启动请求，仍须保持设备供电。完成页保持显示，不会自动关闭。

意外断线时保留完整事务和备份，从原记录复核并继续；不要重新创建一次首次分区任务。已经确认完成的操作有独立检查点，不重复执行。若在写分区表或启动信息中断，且无法凭回读证明完成，会停止并要求用备份恢复，而不会猜测并盲写。设备端旧标记本身不能替代缺失的电脑身份、布局、哈希及备份证据。

从另一台电脑恢复：先解压导出的事务 ZIP，使用“导入恢复目录”选择含 `transaction.json` 的完整目录。仅有孤立 JSON、缺少备份或标记不匹配时不能保证自动恢复。修复版包必须保留相同的机型、布局、关键系统/启动载荷与工具；仅改 GUI、提示、上传逻辑允许续装。损坏或不同版本系统载荷需另行评估，不会自动接受。

安装完成后手动连接设备 USB 网络或热点。默认管理地址：E5/M8/T551M 为 `http://192.168.9.1`；MU300/F50/V50 为 `http://192.168.77.1`；U30Air 为 `http://192.168.78.1`。GUI 会验证同一闪存 CID 后再报告结果。修改过设备地址或 SSH 密码时，请在对应维护页面提供实际值。安装器不启停电脑网卡、不改路由、不自动连接热点。请在首启后修改管理员和无线密码。

窗口顶部、步骤导航和底部操作按钮保持固定；安装内容、续装列表和展开的日志各自滚动。侧栏底部可打开事务目录。操作结果、错误与阶段变化统一通过右上角通知提示；错误通知可以手动关闭，详细信息仍可在日志或对应事务页面查阅。通知不会覆盖底部最终确认按钮。数据影响、等待操作指引和完成结果会持续显示在页面中。界面动效会遵循 Windows 的“动画效果/减少动态效果”设置。

### 连接与常见问题

#### 第一次使用，从哪里开始？

首次打开且没有安装记录时会显示三个步骤的新手引导，可以跳过；首页可随时重看。窗口右上角“帮助与使用指南”或 F1 打开可搜索的离线指南。安装中查看帮助不会暂停、重新开始或取消任务；关闭帮助会回到原来的安装页面。界面语言决定指南语言。所有引导都只作说明，不会连接、格式化或写入设备。

#### 没有发现设备，或者同时连接了多台设备？

先完成安装包校验，再刷新设备。确认 USB 线支持数据传输、设备供电正常；必要时更换线缆或 USB 口，并在 Windows 设备管理器检查设备及其 USB 驱动。Android 中开启开发者选项和 USB 调试。多台设备会列在下拉列表中，请核对型号和序列号末四位，明确选择目标后检查；后续操作绑定所选设备，不会任选另一台。

#### 显示“等待调试授权”或“离线”？

解锁 Android，查看是否出现“允许 USB 调试”提示并允许此电脑。没有提示时确认 USB 调试已开启，再重新插拔数据线并刷新。离线时先确认设备是否正在预期重启；等待它开机后重新连接。已有安装进行中时保留原记录，不要另开一个分区任务。

#### 已经安装 Magisk，为什么还在等待 root？

安装了 Magisk 应用不等于 `su` 已可用。打开 Magisk 确认 root 环境，留意并允许 root 授权请求；若 root 环境在重置后丢失，再恢复 Magisk。工作正常的 root 会直接使用，不会要求重复安装。完成初始化和授权没有固定的几分钟时限。

#### 续装一定要手动创建“事务”吗？

不需要。安装记录由程序自动保存在电脑，里面保存设备身份、分区计划、载荷哈希、备份和已完成阶段。关掉程序、重启电脑或移动安装包后，从“继续未完成的安装”读取原记录即可。换电脑前导出完整事务与备份；在另一台电脑解压并导入完整目录。**电脑记录和导出备份都丢失时，当前版本不能仅凭设备自动重建续装记录。** 不要用新建首次分区任务代替丢失的记录。已经装好后进行更新或临时启动，不需要上一次安装的记录。

#### 什么时候会清空数据？等待时能关闭吗？

以最终安装计划为准。TF 安装格式化选定目标；重装替换已有 OpenWrt；必须缩容的加密 userdata 会明确提示 Android 重置。未加密 userdata 保留原有保数据缩容路径，足够的未分配空间优先使用。先读清楚计划，再作一次最终确认。写入中保持供电；需要退出时点击“在安全边界暂停”，等任务实际暂停后关闭。暂停不能撤销已提交给设备的离线启动请求。

## English

Extract the complete ZIP and run **OpenWrt-Installer.exe** at its root. Keep all adjacent folders. Windows users need no separate Python, Node or Rust. The application uses the system **Microsoft Edge WebView2 Evergreen Runtime**. If missing, a native dialog provides <https://developer.microsoft.com/microsoft-edge/webview2/>. No standalone browser or Docker is included.

**OpenWrt-Installer.py** remains the Python CLI. Windows command launchers prefer the bundled interpreter. Magisk can still install the same ZIP through its original root entry files. Desktop code and dependencies stay outside device payloads, and there is only one system payload in the package.

### Choose your purpose

- **Install OpenWrt**: use a TF card or an independent internal partition. Verify the package, explicitly select a USB device, inspect it, then review the final plan. All later ADB operations are serial bound, including when multiple devices are connected.
- **Update OpenWrt**: provide the management host and SSH root password. Passwords stay in process memory. Existing update locks, checksum checks, SSH compatibility, settings, capacity and local firmware are retained. SFTP is not required. Connect to the device network manually.
- **Continue an unfinished installation**: select a saved transaction. Moving/renaming the package is supported. A repair release is accepted when the model, layout, system/boot payloads and filesystem tools are compatible; incompatibilities name the changed fields or files.
- **Boot installed OpenWrt once**: validate the boot signature/chain and change only the trial information in misc. Do not mount or write the OpenWrt root or change its default boot setting. Existing on-device default-boot controls remain available.
- **Advanced options**: reinstall replaces an existing internal OpenWrt partition and its settings while keeping Android. **Userdata image installation is experimental and may damage Android F2FS**. Image size is constrained by actual free space, Android reserve, uploads and temporary image preparation.

### Storage and capacity

TF installation follows the existing first-partition preference, using the raw card only when it has no partitions. It does not repartition cards or impose a 32 GiB ceiling. Check the exact target and capacity. The payload and local firmware are prepared before releasing Android mounts and formatting. A release failure stops installation. Magisk TF installation remains supported.

Internal installation first checks validated GPT gaps. A sufficient gap avoids shrinking/resetting userdata. Otherwise the existing offline resize is used. The plan displays retained Android space, allocated OpenWrt space and data impact. **Use all allocated OpenWrt partition capacity** is enabled by default: it fills the chosen allocation, not all remaining device storage. Device-side block-count checks and final ext4 superblock verification prevent a 10 GiB partition with an unexpanded 2 GiB filesystem from being reported as success.

The first boot performs offline partition preparation. This may take several minutes; the device reboots automatically once it finishes. Keep power connected. Checks, formatting, shrink and growth use phase/elapsed indicators without invented percentages. Transfer progress uses actual acknowledged bytes and elapsed speed.

### Encrypted userdata and reset

When encrypted userdata must be resized, the final plan explicitly warns that all Android apps, accounts, photos and internal storage are erased. Back up personal data before confirming. The installer saves its computer transaction and essential backups before preparing initramfs. Stage-one handoff lives in the boot request and verified preparation marker; the system payload remains on the computer and is not lost with `/data`.

Wait for offline preparation and stock recovery to finish. Complete Android setup, enable developer options and USB debugging, then authorize this computer. Restore/install Magisk only when root is unavailable, and allow the root request. Working root is accepted immediately. The installer rechecks the same hardware identity, original slot, partition geometry and preparation marker before continuing.

There is **no overall deadline** for user setup or authorization. Expected reboots and missing USB are waiting states. Without ADB the computer cannot distinguish Android still booting from USB debugging not yet enabled; the UI provides both instructions. Unencrypted userdata retains its preserving offline-shrink path.

### Recovery and results

Transactions live in `%LOCALAPPDATA%\OpenWrt-Installer\transactions\<transaction-id>\`. Open this directory or export the full transaction/backup ZIP from the application. Backups include private hardware identity and may contain wireless settings in legacy records; do not publish them. Default logs omit legacy terminal output, passwords, SMS bodies and full hardware identifiers.

Pause takes effect at a safe boundary. A partition or boot write is not killed. Closing an active window is blocked until a safe pause. Pausing cannot undo an already submitted offline boot request: keep the device powered. After closing the application, restarting the computer or moving the package, reopen it and choose **Continue an unfinished installation**. The completed page stays open.

After an unexpected disconnect, use the saved record instead of creating another first-install transaction. Completed effects have checkpoints. An uncertain GPT/boot write that cannot be proved complete stops for backup-based recovery; it is not guessed or blindly replayed. A device marker alone cannot replace missing host identity, geometry, payload hashes and backup evidence.

To move recovery to another computer, extract the exported transaction ZIP and import the complete folder containing `transaction.json`. An isolated JSON or insufficient backups may not be recoverable automatically. Compatible repair releases may change UI/prompts/upload logic while keeping model, root layout, critical system/boot payloads and tools unchanged.

Connect to USB networking or the device hotspot manually. Default management addresses: E5/M8/T551M `http://192.168.9.1`; MU300/F50/V50 `http://192.168.77.1`; U30Air `http://192.168.78.1`. Final verification checks the eMMC CID before reporting success. Supply actual management details when previously changed. The installer does not modify adapters/routes or join hotspots. Change administrator and wireless passwords after first boot.

The header, step navigation and bottom actions stay fixed. Installation content, recovery records and expanded logs scroll independently. The transaction-folder shortcut stays at the bottom of the sidebar. Results, errors and phase changes share the notification area at the upper right, away from the final confirmation buttons. Dismiss error notifications manually; consult the log or transaction page for details. Data-impact warnings, waiting instructions and completed results remain on the page. Interface motion follows the Windows animation/reduced-motion preference.

### Connection and troubleshooting

#### Where should a beginner start?

The three-step getting-started guide appears on first launch when no installation records exist. You can skip it and replay it from the home page. Open the searchable offline manual with Help and user guide at the upper right, or F1. Reading help during installation does not pause, restart or cancel the task. Closing help returns to the original installation page. The interface language selects the manual language. The guide itself does not connect to, format or write a device.

#### No devices, or several devices connected?

Verify the package before refreshing devices. Use a data-capable USB cable, keep power connected and try another cable or USB port if necessary. Check the device and USB driver in Windows Device Manager. Enable Android developer options and USB debugging. With multiple devices, check the model and last four serial characters in the list, explicitly select your target and inspect it. Later operations remain bound to that device.

#### Awaiting debugging authorization, or offline?

Unlock Android and allow this computer in the USB debugging prompt. If no prompt appears, verify USB debugging, reconnect the cable and refresh. An offline device may be in an expected reboot; let it finish starting and reconnect. Keep an existing installation record instead of creating another partitioning task.

#### Magisk is installed, but root is still pending?

Having the Magisk app installed does not prove that `su` works. Check the root environment in Magisk and grant any root request. Restore Magisk if the root environment was lost after a reset. Already-working root is accepted immediately without reinstalling Magisk. Setup and authorization have no fixed deadline of a few minutes.

#### Must I create a transaction manually to resume?

No. The installer automatically saves a record on the computer, including device identity, partition plan, payload hashes, backups and completed phases. Reopen the application and choose Continue an unfinished installation after closing, restarting the computer or moving the package. Export the full transaction and backups before moving to another computer, then extract and import the full directory there. **If both computer records and exported backups are lost, this version cannot reconstruct a record from the device alone.** Do not substitute a fresh partitioning task for missing records. Updating or temporarily booting an already-installed system does not need its previous installation record.

#### When is data erased, and can I close while waiting?

Read the final plan. TF installation formats the selected target; reinstallation replaces existing OpenWrt; encrypted userdata that must shrink requires an explicitly warned Android reset. Unencrypted userdata keeps its preserving shrink path, and sufficient unallocated space is preferred first. Confirm once after reviewing the plan. Keep power connected during writes. To exit, request Pause at a safe boundary and close only after it actually pauses. Pausing cannot undo an offline boot request already submitted to the device.
