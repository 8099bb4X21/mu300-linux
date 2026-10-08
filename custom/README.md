# own layer on kano/clean-tf-7.2 (fork only, kano never touches custom/)

Tracking: branch `tf-7.2` follows `kanoqwq/mu300-linux clean-tf-7.2`,
merged daily by `sync-kano.yml` (02:00 UTC). Custom files live only in
`custom/` and our workflows, so merges stay clean; a red sync run means
a real conflict to fix by hand. `main` is untouched.

Builds trigger on SOURCE changes, not releases (kano cuts none):
`ksmbd-build.yml` runs on pushes to `tf-7.2` (sync merges included),
daily schedule, or dispatch; a run whose kernel version + kano SHA +
fragment SHA match an existing `own-kernel-*` release skips.

What it produces: `ksmbd.ko` for the pinned kernel (default 6.18.54 =
the device kernel) with `CONFIG_SMB_SERVER=m` merged after kano's
config (shadow mount, kano's file unedited, its own verifier checks
our line too). Verify vermagic against the running kernel before
installing on the device.

Retained features from the old fork, mapped to this line:
- ksmbd: this CI (kernel module) + feed userspace on device
  (`apk add ksmbd-server`). Neither kano nor upstream enable it.
- wsdd2 preinstall: feed package, one line on device
  (`apk add wsdd2`); nothing to build.
- Chinese/timezone defaults: kano deliberately does not register
  zh_cn (auto-locale); set once on device via LuCI or uci.
- Default password: kano's installer is password-neutral (manages no
  passwords); set with `passwd` on device after install.
