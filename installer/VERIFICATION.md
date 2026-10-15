# Windows installer verification — 2026-10-15

Implemented in both repositories with one canonical shared source and a hash-checked generated MU300 mirror. Existing unrelated working-tree changes were preserved. FM_U20 support was not restored.

## Executed

| Check | Result |
|---|---|
| Persistent protocol/state/recovery/routing/diagnostic/backup/helper tests | E5: 79 passed. MU300: 79 run, 77 passed and two E5-source-specific tests skipped. Includes adapter/routing/recovery/backup/converter tests, endpoint correction, mandatory capacity checks, pre-update boot capture, commit without replay, old-runtime rejection before reboot, manual confirmation retaining reboot proof, missing/invalid evidence, frozen phase clocks, connection refusal/timeout/absent interface/EOF/SSH-banner loss as neutral waits, disconnect during remote reads and SSH close without a command exit status |
| e5 targeted installer suites | 65 passed across entrypoints (7), installed detection (3), diagnostics (22), two-stage preparation (9), TF growth (5), partition boot (5), userdata size/failure ordering (6), hybrid package/Magisk fixtures (8) |
| MU300 desktop suites | 43 run in WSL; 39 passed, 4 environment-dependent checks skipped |
| Expanded device-script regression | 27 suites pass in WSL (12 E5 and 15 MU300). One additional E5 GPT allocation-plan suite is environment-blocked because its required local Docker image is missing. No Docker/image was installed. `verification/flow-posix.json` records exact outputs/skips. MU300 BusyBox fault injection initially bypassed PATH; the fixture now explicitly invokes its injected dd, and all 33 boot-chain tests pass |
| React/TypeScript/Vite release | Passed; main JS about 430 kB (138 kB gzip), help module about 184 kB (61 kB gzip), CSS about 26 kB; help/Markdown code loads on demand |
| Tauri Windows x64 release | Passed with Rust 1.90.0/MSVC, size optimization, LTO and strip |
| Native Windows launch | Passed using system WebView2; real native window captured in `screenshots/native-home.png` |
| UI interaction smoke | Passed: fixed 1120×900 and 800×650 viewport; 120 recovery records; 500-line bounded log; independent scrolling; fixed titles/actions/footer; bottom sidebar reminder; Sonner results/errors and repeated-state deduplication; native dialog/export error handling; light/dark/system themes, Chinese/English, reduced motion, explicit multi-device selection, confirmation, waiting states and completion |
| Onboarding/help smoke | Passed: first launch, three steps/back/finish/skip/replay, persistent acknowledgement, saved-record suppression, offline manual/search/no matches, keyboard focus trapping/restoration, Escape/F1, contextual help during a waiting transaction without sending backend commands, English/Chinese, dark/light and minimum-window bounds |
| Device refresh/copy regression | Passed: refresh before package verification, repeated empty results and errors leave retry enabled, multiple/unauthorized devices, stale root inspection cleared, install/advanced/boot views, bounded layout and selective text copying |
| Installation method UI regression | Passed: Advanced defaults to reinstall; explicit internal/TF/image choices survive device inspection; no-card reinstall sends reinstall to probe and plan; review names the internal method/target/impact; returning preserves origin and method; no start command sent |
| Ordering/debug/progress UI regression | Passed: older responses/events cannot replace newer checkpoints; unconfirmed saved plans reopen confirmation; rejected pause has no success toast; DEBUG logs automatically open and collapse/reopen; real-byte backup bar; activity bar without fake percentages; actionable exception and one-click persisted diagnostics; all six browser suites pass |
| M8 physical backup and metadata verification | Saved identity matched VIPME M8. All 13 misc/A-B boot-chain backups, 159,387,648 bytes, completed in 17.70 s via dd to a private `/data/local/tmp/` directory plus adb pull. Source, staged and PC SHA-256 agree; staging cleaned. Original backup preserved. GPT/model/slot/root/existing 10 GiB partition inspected read-only. No device partition writes. See `verification/m8-readonly-backup.json` |
| Visible button contrast | Home/install pages: minimum 4.91:1 in light mode and 8.76:1 in dark mode (computed colors with alpha compositing; hidden/disabled controls excluded) |
| Frozen backend and CLI | All five final package folders pass real NDJSON hello/package/list and bundled CLI package verification; stdout is strict UTF-8 |
| Frozen MU300 boot builder | Both kernel families pass `--check-boot`, constructing actual boot images for Android A/B on the computer without device access |
| Final ZIP integrity | ZIP CRC tested, exactly one system payload per archive, separate SHA256 and size reports |
| Payload invariance | Existing validated 20261015-all-r5 system/boot/filesystem-tool payload hashes retained; desktop changes stay outside them |
| Source synchronization | `installer/sync.py <mu300-repository> --check` passes |

The new coordinator tests cover expected reboot disconnects, stale pre-reboot ADB sessions, unauthorized ADB, Android setup, missing Magisk, pending su authorization, accepting already-working root, multiple devices, application restart, host record import/export, moved/compatible repair packages, incompatible payload rejection, failed safe-operation retry, nonrepeatable-write refusal, deferred cancellation, OS mutex ownership, stage-specific boot-chain checkpoints, and measured filesystem capacity mismatch.

Device-script tests ran in WSL Ubuntu 22.04 with disposable files and mock block/transport commands. Initial attempts to run POSIX shell fixtures directly with Windows paths failed from path syntax/missing BusyBox; the listed results are the successful Linux/WSL runs. One stale userdata-size fixture was updated to stub its read-only encryption probe so it cannot accidentally reach a real device.

## Screenshots

- [Native desktop home](screenshots/native-home.png): actual Windows Tauri/WebView2 application.
- [Light home, Chinese](screenshots/home-light-zh.png).
- [Final destructive plan, Chinese](screenshots/plan-light-zh.png).
- [Android setup wait, Chinese](screenshots/wait-setup-light-zh.png).
- [Root authorization wait, dark English](screenshots/wait-root-dark-en.png).
- [Completed result and actual capacity, dark English](screenshots/complete-dark-en.png).
- [Recovery list and expanded log at 800×650](screenshots/resume-small-light-zh.png).
- [Scrollable installation form with fixed actions at 800×650](screenshots/install-small-light-zh.png).
- [Final plan at 800×650, dark English](screenshots/plan-small-dark-en.png).
- [Getting started, Chinese](screenshots/onboarding-light-zh.png).
- [Offline help and recovery FAQ, Chinese](screenshots/help-recovery-light-zh.png).
- [Help at 800×650, dark English](screenshots/help-small-dark-en.png).
- [Getting started at 800×650, dark English](screenshots/onboarding-small-dark-en.png).
- [No-device state with enabled refresh before package verification](screenshots/no-device-refresh-light-zh.png).
- [Reinstall internal partition plan without a TF card](screenshots/reinstall-no-card-plan-zh.png).
- [Measured backup byte progress and DEBUG log](screenshots/backup-progress-debug-zh.png).
- [Installation activity bar and DEBUG log](screenshots/install-activity-debug-zh.png).
- [Failure details and one-click diagnostic copying](screenshots/failure-copy-diagnostics-zh.png).
- [Named firmware conversion stage with stale transfer progress cleared](screenshots/firmware-convert-debug-zh.png).
- [Manual restart guidance and explicit OpenWrt confirmation with logs expanded](screenshots/manual-restart-log-zh.png).
- [Correcting a management address belonging to another device](screenshots/openwrt-endpoint-mismatch-zh.png).
- [Automatic restart guidance and editable verification target, dark English](screenshots/automatic-restart-log-en.png).
- [Update submitted and automatic restart guidance](screenshots/update-reboot-zh.png).
- [Expected update reboot disconnect as a neutral reconnection wait](screenshots/update-reconnecting-zh.png).
- [Author, copyable group numbers and repository in the sidebar](screenshots/author-sidebar-zh.png).
- [First-launch optional donation notice](screenshots/support-first-launch-zh.png).
- [Bundled donation image after online failure, dark English](screenshots/support-offline-dark-en.png).
- [Native Windows donation dialog and sidebar](screenshots/native-support.png).
- [Update verified with a stopped phase clock, dark English](screenshots/update-complete-clock-en.png).

The browser screenshots use the production React bundle with a **test-only** protocol fixture in `tests/ui_smoke.py` and `tests/help_smoke.py`. That fixture is not imported into production, does not exist in the firmware packages, and does not open ADB/SSH. These screenshots verify rendering and interaction, not a completed hardware installation. The native screenshot verifies an actual Windows launch.

The UI polish pass also cleared stale device inspection results on package/view changes, disabled device selection during inspection, preserved an explicitly chosen serial on refresh among multiple devices, caught rejected native and clipboard operations, moved focus to the new page heading without scrolling the document, distinguished waiting from execution icons, and prevented prior-phase transfer counters from appearing in a later phase. Motion honors reduced motion without weakening the final confirmation or safe-pause rules.

Onboarding and help use the same source in both repositories. The detailed manual is generated from the same bilingual `GUIDE.md` copied to `START-HERE.md`, and that document is now fingerprinted with the compiled sources. The FAQ explicitly states that no manual transaction creation is needed, records are automatic, full exported backups can be imported elsewhere, and this version cannot reconstruct a record from device state alone if both host records and exported backups are lost. Help never starts, pauses or cancels an installation.

## Hardware boundary and recovery limitations

No connected-device installation, formatting, GPT mutation, userdata reset/shrink, boot-chain synchronization, misc write, live SSH upgrade or Magisk flash was performed. The physical M8 validation was limited to identity/root/GPT inspection and source-partition reads for backup. As explicitly requested, dd wrote ordinary temporary files under `/data/local/tmp/`; adb pulled and verified them, then removed those files and their private directory. Device partitions were not written. Installation/update/reset behavior remains **not newly hardware-validated**; automatic tests use simulated transports.

The supplied M8 failure record stopped at `backup`, with no effects/completed writes. The old whole-boot Base64 read reproduced a 120-second timeout on 64 MiB `boot_a`, which was hidden by the generic interruption message. The final implementation removes Base64 and custom compressed/raw-stream backup paths entirely. It uses staged dd/adb pull, reports actual local bytes, preserves verified files on failed download, and records the concrete exception/traceback. DEBUG logs persist across restarts and are redacted before disk/UI emission. Copy diagnostics reads the persisted report rather than only the UI's recent 500 entries.

Uncertain interrupted writes do not automatically repeat partition preparation. A trusted host transaction plus matching hardware/geometry/token is required to enter stage two. A completed effect is skipped; a started nonrepeatable effect without conclusive completion stops for recovery. Missing host records with insufficient backups/markers stop rather than infer a partition layout. This is deliberate fail-closed behavior, not a guarantee that every power-loss point can recover without manual backup-based repair.

Without ADB, the host cannot know whether Android is still booting or USB debugging is disabled. The UI presents the full concrete setup/debugging steps and does not time out the transaction. Management verification requires the user to connect the USB network/hotspot and supply the correct SSH credentials. The application never modifies the computer's adapters/routes or joins a hotspot.

Release payloads were taken from the repositories' existing `20261015-all-r5` validated package directories. Unrelated in-progress kernel/UI changes were not rebuilt into these firmware images or reverted. Future normal packaging uses current repository payloads and requires a matching portable GUI artifact.

## Artifacts and sizes

Use the `*-windows.zip` archives and matching `.zip.sha256`/`.size.json` in:

- e5: `out/gui-releases/20261015/` (E5, M8, T551M).
- MU300: `release/gui-20261015/` (6.18.54 and 7.2.8; F50/MU300, V50, U30Air via the existing profile adapter).

The polished UI refresh is delivered separately in e5 `out/gui-releases/20261015-ui2/` and MU300 `release/gui-20261015-ui2/`, keeping the same validated firmware. The old M8 GUI was running during the refresh, so its executable and original release were left in place. The refreshed GUI executable is 3,451,904 bytes (3.29 MiB). The version remains 1.0.0 for this local, unpublished UI revision; use the `ui2` paths for the updated builds.

The subsequent onboarding/offline-help revision is in e5 `out/gui-releases/20261015-guide/` and MU300 `release/gui-20261015-guide/`. It retains the same system/boot payloads and independent package directories. Use these `guide` paths for the latest local build. Per-package sizes and frozen-backend checks are recorded under `verification/help-*.json`.

The device-refresh and text-selection fix is in e5 `out/gui-releases/20261015-refresh/` and MU300 `release/gui-20261015-refresh/`. Use these `refresh` paths for the latest build; earlier local packages remain separate. The refresh button no longer depends on payload verification. Enumeration is read-only; device inspection and writing retain the payload gate. Per-package checks and sizes are under `verification/refresh-*.json`.

The internal-reinstall/method-routing fix is in e5 `out/gui-releases/20261015-routing/` and MU300 `release/gui-20261015-routing/`. Root cause: the shared E5 probe called the mandatory SD detector for every mode and caught `SystemExit`, while GUI-mode `die()` raises `ValueError`. The fix removes that detector/capacity check from non-TF modes rather than swallowing errors. A separate UI issue that replaced selected methods with recommendations was removed, and Advanced's hidden `part` default and review-back reset were corrected.

The debug/progress/fast-backup revision is in e5 `out/gui-releases/20261015-debug/` and MU300 `release/gui-20261015-debug/`. It includes the routing fixes, recovery checkpoint fixes, detailed diagnostic sharing and staged dd/adb pull. Earlier local releases and the user's original backup ZIP are left intact. Firmware payload hashes remain unchanged. Per-archive sizes, checksums and frozen-backend checks use `verification/debug-*.json`.

The latest local build fixes host firmware conversion: e5 `out/gui-releases/20261015-helpers/` and MU300 `release/gui-20261015-helpers/`. The optimized frozen backend stripped the VBC helper's module docstring, causing its argparse initialization to fail. The old unbounded, uncaptured child execution also left the UI displaying the preceding transfer's 100%. Helpers now run with source docstrings/assertions preserved, detached stdin, captured diagnostics, named stages, safe host-child cancellation and a 120-second converter timeout. The exact internal reason the original child remained alive is not established; the missing-docstring exception was reproduced independently.

Both real converters were executed by the rebuilt frozen backend against six preserved M8 input files, with no device access. All five generated files matched normal-Python reference bytes, completing together in 0.547 seconds in the first run. Only output sizes and pass/fail evidence appear in `verification/helper-real-m8.json`; private input files and Bluetooth addresses are excluded. Backend tests include an optimized-host regression, timeout/cancellation/errors, and the actual extraction-to-conversion path with simulated ADB. Browser regression verifies that structured activity clears stale transfer percentages within a stage. `verification/helpers-*.json` records the new package sizes and frozen-package checks. A real reinstall remains unperformed.

Each extracted folder contains `OpenWrt-Installer.exe`, compatible `OpenWrt-Installer.py`, bilingual `START-HERE.md`, Magisk root entries and subdirectories for tools/resources. The EXE must be kept with its package. `verification/windows-packages.json` contains actual frozen-backend/CLI results. Machine-readable per-archive size reports distinguish root GUI executable, host backend/tools (`tools/`, `scripts/`, `desktop/`), firmware payload (`files/` or `payload/`) and compressed ZIP bytes. Counts do not include build caches or development dependencies.

The newest-first log/restart/explicit-verification revision is in e5 `out/gui-releases/20261015-boot-confirm/` and MU300 `release/gui-20261015-boot-confirm/`. Use these paths for the latest build. Manual restart instructions remain above the scrolling content; phase 4 includes editable host/password and a boot-confirmation button. Multiple routers with the same default address cannot be disambiguated by clicking confirmation alone: the computer must reach the intended endpoint, whose CID is checked before root-device/capacity reads. Wrong-device/authentication/connection failures allow retargeting while the original worker keeps the device mutex. UI logs reverse whole entries, preserving multiline tracebacks; copied/exported diagnostics remain chronological. Tests use simulated SSH only; no device restart or installation was performed for this revision. Evidence uses `verification/boot-confirm-*.json` and `verification/ui-regression.json`.

See [build instructions](README.md), [user guide](GUIDE.md) and [protocol contract](PROTOCOL.md).

The latest update/reboot/timer revision is in e5 `out/gui-releases/20261015-update-reboot/` and MU300 `release/gui-20261015-update-reboot/`. The prior version could verify the still-running old system during the three-second scheduled reboot delay. Update completion now requires a new boot UUID from the same CID before capacity reads, and committed updates resume verification without replaying uploads or writes. A missing pre-update boot UUID in an older saved update is reported explicitly rather than guessed. Plans, persistent progress guidance, notifications and update-specific results explain the automatic reboot. Completed/failed/paused clocks use saved phase bounds and do not keep ticking. Seven browser suites include these states; frozen-package simulation tests the old/new boot sequence for all five packages. This revision did not reboot, update or install any real device. Reports use `verification/update-reboot-*.json`.

The latest reconnection correction is in e5 `out/gui-releases/20261015-reboot-wait/` and MU300 `release/gui-20261015-reboot-wait/`. Expected transport loss now keeps automatic update reboot in `waiting_device`, clears stale verification errors and shows a neutral restarting/reconnecting heading. The old generic connection warning is removed from this wait; DEBUG retains the transport exception. Authentication and wrong-device errors remain actionable. Unit tests cover five connection-loss types in both adapters and SSH loss during command reads; browser tests check neutral toasts, deduplication and editable controls. Frozen-package tests inject EOF and refusal before an old/new boot sequence. No hardware access was performed. Evidence uses `verification/reboot-wait-*.json`.

The latest author/support revision is in e5 `out/gui-releases/20261015-support/` and MU300 `release/gui-20261015-support/`. It adds Minikano and the four supplied group numbers above the extraction reminder, exact-number clipboard copying with toast feedback, a fixed repository opener and an optional first-launch donation dialog. The dialog is acknowledged once, can be reopened from the sidebar, and precedes onboarding. The real downloaded PNG is embedded as a fallback; tests intercept the online URL for deterministic success, failure and stalled-request coverage. They do not initiate a payment or device command. At 800×650 the sidebar step list scrolls and keeps its current stage visible while credits/reminder stay at the bottom. Eight browser suites cover the combined UI. Donation PNG provenance is recorded in README; no device backend or firmware payload behavior changed in this revision. Reports use `verification/support-*.json`.

The latest support/Star revision is in e5 `out/gui-releases/20261015-support-star/` and MU300 `release/gui-20261015-support-star/`. The notice now appears on every application launch, ignoring prior dismissal flags, while still allowing immediate close. Both the sidebar and dialog show GitHub icons; the dialog includes the repository URL and an invitation to Star. The sidebar support entry has a heart and a visible text label. The image fallback and sequential onboarding remain intact. The support browser suite verifies a second launch with an existing old acknowledgement, the fixed native repository command from the Star link, labeled reopening, clipboard controls, online/error/timeout image paths and both themes/languages at 800×650. Other UI fixtures automatically dismiss this notice and intercept its image request to keep independent tests deterministic. Eight suites and frozen-package checks are recorded under `verification/ui-regression.json` and `verification/support-star-*.json`; no device or payment operation was performed.

The latest two-project credit revision is in e5 `out/gui-releases/20261015-projects/` and MU300 `release/gui-20261015-projects/`. Both the sidebar and support dialog link to `sprd-linux-devs/e5-linux` (Enceka and Minikano) and `dikeckaan/mu300-linux` (dikeckaan and Minikano), explicitly crediting Minikano as a co-author of both while retaining the installer credit. Each project has a GitHub icon and Star entry; support opens on every launch and has a labeled sidebar button. The native opener maps only two known project IDs to literal HTTPS URLs. UI tests exercise both entries/IDs, credits, launch/relaunch, imagery and bounded bilingual layouts. This supersedes the intermediate single-project `support-star` build. Evidence uses `verification/projects-*.json`; no real device or payment operation was performed.
