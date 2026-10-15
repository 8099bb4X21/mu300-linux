# Building the desktop installer

Build dependencies (users do not need these): Windows x64, MSVC C++ Build Tools and Windows SDK, Rust 1.90.0, Node 22+, Python 3.12, PyInstaller, Paramiko, lz4. A system WebView2 Runtime is required to run the GUI. See the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) and [portable WebView2 configuration](https://v2.tauri.app/reference/config/).

```powershell
python -m pip install pyinstaller paramiko lz4
python -m unittest discover -s installer/tests -v
python installer/build.py
```

`ui/rust-toolchain.toml`, Cargo.lock and package-lock.json pin the build graph. `build.py` runs a Tauri release build with size optimization/LTO/strip and builds a console-protocol Python sidecar. The Tauri host spawns it with CREATE_NO_WINDOW. `installer/artifacts/windows` contains `OpenWrt-Installer.exe`, `tools/backend/`, and `build.json` with source/binary hashes. No browser runtime, Node, Rust, Python installation, cache, large fonts or development dependencies are shipped. The bundled interpreter is private to the sidecar.

The artifact also includes ADB and its two Windows USB DLLs under `tools/`, plus `ADB-NOTICE.txt`. `platform-tools.json` pins Google's 37.0.1 archive URL and SHA256; only these necessary files are extracted. `--adb-dir` accepts a pre-fetched official platform-tools folder for offline builds. Normal packaging therefore does not rely on ADB installed on the end user's PATH or an optional environment variable.

The host uses fixed Rust commands for dialogs, protocol requests and opening the application-data directory. CSP restricts remote content and scripts. Window-close handling prevents killing an active backend. A missing WebView2 Runtime produces native installation instructions. Portable distribution requires the complete adjacent `tools/backend` directory; the root EXE by itself is not the complete package.

`OPENWRT_GUI_ARTIFACT` can point to an extracted Windows build artifact while packaging on Linux. Existing e5 `install-entrypoints.py` and MU300 `desktop/package.py` call `package_gui.attach` before generating final manifests. GUI sources and binaries are fingerprinted; missing/stale artifacts fail normal packaging. `OPENWRT_GUI_OPTIONAL=1` permits source-only/test fixtures and must not be used for a GUI release. Old optional console EXEs are stored under `tools/legacy`; the root EXE is always Tauri.

MU300's `--exe` packaging option accepts the GUI artifact **directory**. Legacy console EXE input remains accepted under `tools/legacy`. `tools/build-openwrt-tf-magisk.sh` still calls the same package assembler; set `OPENWRT_GUI_ARTIFACT` (or its existing MU300_DESKTOP_EXE to the directory). e5's profile builder and make-flash-bundle paths use the same attachment. Root Magisk files and a single rootfs remain intact; desktop code is not added to any device initramfs or rootfs.

To refresh the generated MU300 mirror:

```powershell
python installer/sync.py D:\Git\mu300-linux-clean-tf-7.2
python installer/sync.py D:\Git\mu300-linux-clean-tf-7.2 --check
```

`package_gui.size_report(package, archive)` reports GUI, backend/tools, device firmware payload and final compressed archive bytes separately. `release.py` augments an existing validated package into a new output directory, refreshes only host installer sources/manifests, preserves the firmware payload, then tests ZIP CRCs. Never overwrite an existing published package.

Validation uses fake transports and disposable files. Run POSIX device-script tests in Linux/WSL; Windows path syntax is not valid in those shell test fixtures. Actual hardware erase, resize, boot synchronization and Magisk installation require a separate authorized hardware run. See the verification report for what was actually executed.

## Desktop layout, feedback and motion

The window has a fixed viewport: header, sidebar, primary actions and footer stay visible. Purpose lists, recovery records, installation content and expanded logs have independent scroll areas. The package extraction reminder and transaction-folder shortcut stay at the bottom of the sidebar. Recovery controls remain compact at the minimum 800×650 window size, including when the log is open.

[Sonner](https://sonner.emilkowal.ski/) is the single notification surface for request results, native/clipboard errors and transaction changes. Transaction snapshots are deduplicated by identity, stage, status and error; repeated polling does not reset elapsed time or flood notifications. Destructive warnings, actionable waiting guidance, failures and final results also remain in context. Notifications appear above the content, away from the bottom confirmation controls. Loading notifications transition to their result; cancelling a save dialog does not report a successful export.

[Motion for React](https://motion.dev/docs/react) supplies short page entrances/exits, purpose-row interactions, phase/result entrances and log expansion. `LazyMotion` loads the DOM animation feature set without layout/drag features. `MotionConfig`, `useReducedMotion` and CSS respect the operating system's reduced-motion preference; waiting for the user uses a static device icon rather than an endless execution spinner. No transfer percentages are synthesized.

To exercise the production UI without ADB/SSH, install Playwright on the development machine, build the frontend, serve `installer/ui/dist` on `127.0.0.1:1420`, and run `python -X utf8 installer/tests/ui_smoke.py`. This test injects its transport fixture only into the browser test context. It checks bounded scrolling, large record/log lists, notifications and deduplication, device binding, confirmation controls, themes/languages and reduced motion, and refreshes the screenshots.

## Onboarding and offline help

The three-step getting-started guide appears after a successful startup when no saved transactions exist and `onboarding-v1` has not been acknowledged in this application's local storage. Completing, skipping or closing it remembers that choice. Home can replay it at any time. Existing records suppress automatic onboarding so recovery remains the priority. The guide performs no backend operations.

The header help button and F1 open an independent help dialog without navigating away from the current plan, password fields or running task. Waiting phases link to the relevant setup/authorization topic. Closing with Escape or the close button restores focus to the originating control. Radix Dialog provides modal keyboard focus management; topic lists and article bodies scroll independently within the minimum 800×650 window. Help and onboarding honor the existing theme/language/reduced-motion preferences.

`ui/src/help-data.ts` imports the bilingual `GUIDE.md` as text at build time and selects localized topics, so root `START-HERE.md`, the packaged guide and in-app detailed help share one source. Search matches topic titles and full content. Markdown is rendered with `react-markdown`, without raw HTML or remote content; displayed URLs are selectable text. The help module/Markdown renderer loads on demand. `GUIDE.md` is part of the source fingerprint: a guide change requires rebuilding the GUI artifact.

Run `python -X utf8 installer/tests/help_smoke.py` against the same production-bundle test server to cover first launch, replay, skip/persistence, saved-record suppression, search/no-match state, focus trapping/restoration, F1/Escape, relevant help during installation, bilingual bounded dialogs and the absence of help-driven backend commands. This is browser automation with a test-only bridge, not device installation validation.
