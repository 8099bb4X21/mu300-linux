# luci-app-mu300

One installable LuCI application owns the MU300 web surface:

- dashboard and quick actions;
- live cellular status and persistent network locks;
- guarded raw AT terminal;
- local SMS inbox, send, delete and SIM synchronisation.

The package owns only presentation, RPC dispatch and read-side collectors. The
base firmware continues to own modem startup, `mu300-atd`, mobile data and the
SMS pool daemon. Its stable boundary is `/opt/mu300/bin/mu300-at` and
`/opt/mu300/bin/mu300-sms`, so removing this package cannot stop the modem or
WAN service.

To include it in an OpenWrt buildroot, copy or link this directory under
`package/luci-app-mu300`, select `LuCI -> Applications -> luci-app-mu300`, and
build it normally. The repository rootfs builder installs the same `root/` and
`htdocs/` trees directly, keeping packaged and built-in installations
byte-identical.
