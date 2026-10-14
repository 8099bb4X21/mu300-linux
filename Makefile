include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-mu300-cpusimple
PKG_VERSION:=1.0.0
PKG_RELEASE:=2
PKG_LICENSE:=MIT
PKG_MAINTAINER:=mu300-cpusimple contributors
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-mu300-cpusimple
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=MU300 CPU 简易设置（模式 / cpuset / 频率）
  # NOTE: no DEPENDS on luci-app-mu300. That package is baked into the image by
  # file copy, not registered in the apk database. The LuCI page reuses its
  # mu300.common helpers at runtime; postinst warns if they are absent.
  # Frequency is applied through the built-in /usr/libexec/unisoc-modem/cpu.
  DEPENDS:=+luci-base +rpcd +jsonfilter
endef

define Package/luci-app-mu300-cpusimple/description
 Three one-click CPU modes for the MU300 (OpenWrt):
   OpenWrt 默认 / Android 默认 / 性能模式.
 Frequency is reused from the built-in cpu.uc (single source of truth,
 shared with the "CPU 设置" page). Core confinement uses cgroup v2 cpuset
 on the procd services subtree; real core offlining is used only when the
 kernel exposes cpuN/online (CONFIG_HOTPLUG_CPU). Pure shell + LuCI JS,
 no arch.
endef

define Package/luci-app-mu300-cpusimple/conffiles
/etc/mu300/cpusimple/config.json
endef

define Build/Compile
endef

define Package/luci-app-mu300-cpusimple/install
	$(INSTALL_DIR) $(1)/www
	$(CP) ./htdocs/. $(1)/www/
	$(CP) ./root/. $(1)/
	chmod 0755 $(1)/etc/init.d/mu300-cpusimple
	chmod 0755 $(1)/usr/libexec/rpcd/mu300cpusimple
	chmod 0755 $(1)/usr/libexec/mu300-cpusimple/cpusimple
endef

define Package/luci-app-mu300-cpusimple/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	[ -x /usr/libexec/unisoc-modem/cpu ] || echo "mu300-cpusimple: built-in cpu.uc not found; frequency control will fail" >&2
	[ -f /www/luci-static/resources/mu300/common.js ] || echo "mu300-cpusimple: luci-app-mu300 helpers not found; the LuCI page needs them" >&2
	/etc/init.d/mu300-cpusimple enable 2>/dev/null || true
	/etc/init.d/rpcd restart 2>/dev/null || true
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
}
exit 0
endef

define Package/luci-app-mu300-cpusimple/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/mu300-cpusimple disable 2>/dev/null || true
	# Undo any active override with built-ins only (our own files may
	# already be gone when postrm runs). Best effort, never fail removal.
	rm -f /etc/mu300/cpusimple/config.json 2>/dev/null || true
	[ -e /sys/fs/cgroup/services/cpuset.cpus ] && printf '0-7' > /sys/fs/cgroup/services/cpuset.cpus 2>/dev/null || true
	for c in 4 5 6 7; do [ -e /sys/devices/system/cpu/cpu$c/online ] && printf '1' > /sys/devices/system/cpu/cpu$c/online 2>/dev/null || true; done
	[ -x /usr/libexec/unisoc-modem/cpu ] && /usr/libexec/unisoc-modem/cpu forget >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd restart 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-mu300-cpusimple))