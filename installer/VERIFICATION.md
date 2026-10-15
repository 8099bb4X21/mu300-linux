# Windows installer verification — 2026-10-15

Implemented in both repositories with one canonical shared source and a hash-checked generated MU300 mirror. Existing unrelated working-tree changes were preserved. FM_U20 support was not restored.

## Executed

| Check | Result |
|---|---|
| Persistent protocol/state/recovery tests | 27 passed on Windows; real temporary journals, CLI selection among multiple devices and a separate-process OS lock contender |
| e5 targeted installer suites | 65 passed across entrypoints (7), installed detection (3), diagnostics (22), two-stage preparation (9), TF growth (5), partition boot (5), userdata size/failure ordering (6), hybrid package/Magisk fixtures (8) |
| MU300 desktop suites | 43 run in WSL; 39 passed, 4 environment-dependent checks skipped |
| React/TypeScript/Vite release | Passed; main JS about 430 kB (138 kB gzip), help module about 184 kB (61 kB gzip), CSS about 26 kB; help/Markdown code loads on demand |
| Tauri Windows x64 release | Passed with Rust 1.90.0/MSVC, size optimization, LTO and strip |
| Native Windows launch | Passed using system WebView2; real native window captured in `screenshots/native-home.png` |
| UI interaction smoke | Passed: fixed 1120×900 and 800×650 viewport; 120 recovery records; 500-line bounded log; independent scrolling; fixed titles/actions/footer; bottom sidebar reminder; Sonner results/errors and repeated-state deduplication; native dialog/export error handling; light/dark/system themes, Chinese/English, reduced motion, explicit multi-device selection, confirmation, waiting states and completion |
| Onboarding/help smoke | Passed: first launch, three steps/back/finish/skip/replay, persistent acknowledgement, saved-record suppression, offline manual/search/no matches, keyboard focus trapping/restoration, Escape/F1, contextual help during a waiting transaction without sending backend commands, English/Chinese, dark/light and minimum-window bounds |
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

The browser screenshots use the production React bundle with a **test-only** protocol fixture in `tests/ui_smoke.py` and `tests/help_smoke.py`. That fixture is not imported into production, does not exist in the firmware packages, and does not open ADB/SSH. These screenshots verify rendering and interaction, not a completed hardware installation. The native screenshot verifies an actual Windows launch.

The UI polish pass also cleared stale device inspection results on package/view changes, disabled device selection during inspection, preserved an explicitly chosen serial on refresh among multiple devices, caught rejected native and clipboard operations, moved focus to the new page heading without scrolling the document, distinguished waiting from execution icons, and prevented prior-phase transfer counters from appearing in a later phase. Motion honors reduced motion without weakening the final confirmation or safe-pause rules.

Onboarding and help use the same source in both repositories. The detailed manual is generated from the same bilingual `GUIDE.md` copied to `START-HERE.md`, and that document is now fingerprinted with the compiled sources. The FAQ explicitly states that no manual transaction creation is needed, records are automatic, full exported backups can be imported elsewhere, and this version cannot reconstruct a record from device state alone if both host records and exported backups are lost. Help never starts, pauses or cancels an installation.

## Hardware boundary and recovery limitations

No connected-device installation, formatting, GPT mutation, userdata reset/shrink, boot-chain synchronization, misc write, live SSH upgrade or Magisk flash was performed in this task. ADB enumeration during read-only package smoke found zero devices. Hardware behavior of those paths is therefore **not newly hardware-validated**. Their existing device code is reused; automatic tests exercise the host protocol and recovery logic with simulated transports.

Uncertain interrupted writes do not automatically repeat partition preparation. A trusted host transaction plus matching hardware/geometry/token is required to enter stage two. A completed effect is skipped; a started nonrepeatable effect without conclusive completion stops for recovery. Missing host records with insufficient backups/markers stop rather than infer a partition layout. This is deliberate fail-closed behavior, not a guarantee that every power-loss point can recover without manual backup-based repair.

Without ADB, the host cannot know whether Android is still booting or USB debugging is disabled. The UI presents the full concrete setup/debugging steps and does not time out the transaction. Management verification requires the user to connect the USB network/hotspot and supply the correct SSH credentials. The application never modifies the computer's adapters/routes or joins a hotspot.

Release payloads were taken from the repositories' existing `20261015-all-r5` validated package directories. Unrelated in-progress kernel/UI changes were not rebuilt into these firmware images or reverted. Future normal packaging uses current repository payloads and requires a matching portable GUI artifact.

## Artifacts and sizes

Use the `*-windows.zip` archives and matching `.zip.sha256`/`.size.json` in:

- e5: `out/gui-releases/20261015/` (E5, M8, T551M).
- MU300: `release/gui-20261015/` (6.18.54 and 7.2.8; F50/MU300, V50, U30Air via the existing profile adapter).

The polished UI refresh is delivered separately in e5 `out/gui-releases/20261015-ui2/` and MU300 `release/gui-20261015-ui2/`, keeping the same validated firmware. The old M8 GUI was running during the refresh, so its executable and original release were left in place. The refreshed GUI executable is 3,451,904 bytes (3.29 MiB). The version remains 1.0.0 for this local, unpublished UI revision; use the `ui2` paths for the updated builds.

The subsequent onboarding/offline-help revision is in e5 `out/gui-releases/20261015-guide/` and MU300 `release/gui-20261015-guide/`. It retains the same system/boot payloads and independent package directories. Use these `guide` paths for the latest local build. Per-package sizes and frozen-backend checks are recorded under `verification/help-*.json`.

Each extracted folder contains `OpenWrt-Installer.exe`, compatible `OpenWrt-Installer.py`, bilingual `START-HERE.md`, Magisk root entries and subdirectories for tools/resources. The EXE must be kept with its package. `verification/windows-packages.json` contains actual frozen-backend/CLI results. Machine-readable per-archive size reports distinguish root GUI executable, host backend/tools (`tools/`, `scripts/`, `desktop/`), firmware payload (`files/` or `payload/`) and compressed ZIP bytes. Counts do not include build caches or development dependencies.

See [build instructions](README.md), [user guide](GUIDE.md) and [protocol contract](PROTOCOL.md).
