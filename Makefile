include $(TOPDIR)/rules.mk

PKG_NAME:=mu300-smsfwd
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=mu300-smsfwd contributors
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/mu300-smsfwd
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=MU300 SMS forwarding with own-number whitelist
  # NOTE: no DEPENDS on luci-app-mu300. That package is baked into the image
  # by file copy, not registered in the apk database, so depending on it
  # would make this package uninstallable. The LuCI page reuses its
  # mu300.common helpers at runtime; postinst warns if they are absent.
  DEPENDS:=+luci-base +rpcd +jq-full +jshn +jsonfilter +curl +ca-bundle +openssl-util +msmtp +ucode +ucode-mod-fs
  # NOTE: jq-full, not jq. The feed jq is the noregex variant (no Oniguruma),
  # which silently disables every keyword/regex rule. jq-full PROVIDES jq.
endef

define Package/mu300-smsfwd/description
 Sidecar SMS forwarding for the MU300: the same four channels as the built-in
 forwarding (webhook, DingTalk, SMTP, local SMS), but every new message first
 passes an own-number whitelist, a content allow-keyword bypass and a content
 block-keyword list (regex, jq). Installs, disables the built-in forwarding
 service while present, and restores it on removal. Pure shell, no arch.
endef

define Package/mu300-smsfwd/conffiles
/etc/mu300/smsfwd/config.json
/etc/mu300/smsfwd/whitelist.txt
/etc/mu300/smsfwd/keywords.txt
/etc/mu300/smsfwd/blacklist.txt
/etc/mu300/smsfwd/regex.txt
endef

define Build/Compile
endef

define Package/mu300-smsfwd/install
	$(INSTALL_DIR) $(1)/www
	$(CP) ./htdocs/. $(1)/www/
	$(CP) ./root/. $(1)/
	chmod 0755 $(1)/etc/init.d/mu300-smsfwd $(1)/usr/libexec/rpcd/mu300smsfwd $(1)/usr/libexec/mu300-smsfwd/forward $(1)/usr/sbin/mu300-smsfwd
	chmod 0644 $(1)/usr/libexec/mu300-smsfwd/lib.sh $(1)/usr/libexec/mu300-smsfwd/channels.sh $(1)/usr/libexec/mu300-smsfwd/own-template.uc $(1)/usr/libexec/mu300-smsfwd/msg-template.uc $(1)/usr/libexec/mu300-smsfwd/rx.jq
	chmod 0700 $(1)/etc/mu300/smsfwd
	chmod 0600 $(1)/etc/mu300/smsfwd/*
endef

define Package/mu300-smsfwd/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	[ -x /etc/init.d/unisoc-sms-forward ] && {
		/etc/init.d/unisoc-sms-forward stop 2>/dev/null || true
		/etc/init.d/unisoc-sms-forward disable 2>/dev/null || true
	}
	/etc/init.d/mu300-smsfwd enable 2>/dev/null || true
	/etc/init.d/mu300-smsfwd start 2>/dev/null || true
	[ -x /usr/libexec/rpcd/mu300dash ] || echo "mu300-smsfwd: luci-app-mu300 helpers not found; the LuCI page needs them" >&2
	/etc/init.d/rpcd restart 2>/dev/null || true
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
}
exit 0
endef

define Package/mu300-smsfwd/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	if [ "$$1" = remove ]; then
		/etc/init.d/mu300-smsfwd stop 2>/dev/null || true
		/etc/init.d/mu300-smsfwd disable 2>/dev/null || true
		[ -x /etc/init.d/unisoc-sms-forward ] && {
			/etc/init.d/unisoc-sms-forward enable 2>/dev/null || true
			/etc/init.d/unisoc-sms-forward start 2>/dev/null || true
		}
	fi
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd restart 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,mu300-smsfwd))
