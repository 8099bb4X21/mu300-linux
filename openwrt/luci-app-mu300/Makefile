include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-mu300
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=MU300 Linux contributors
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-mu300
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=MU300 control center
  DEPENDS:=+luci-base +rpcd +jsonfilter
endef

define Package/luci-app-mu300/description
 A single LuCI application for the MU300 dashboard, cellular locks, raw AT
 terminal and SMS. It talks to the base system only through mu300-at and
 mu300-sms; installing or removing the UI does not own the modem lifecycle.
endef

define Build/Compile
endef

define Package/luci-app-mu300/install
	$(INSTALL_DIR) $(1)/www
	$(CP) ./htdocs/. $(1)/www/
	$(CP) ./root/. $(1)/
endef

define Package/luci-app-mu300/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd restart 2>/dev/null || true
}
exit 0
endef

define Package/luci-app-mu300/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd restart 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-mu300))
