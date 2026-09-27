#!/usr/bin/env python3
"""Map boot/module-order.txt module names to their CONFIG symbols and emit a
built-in fragment (=y) so the vendor modules compile into the Image instead
of being insmod'ed one by one in the initramfs (~40 s of serial loading).

Run inside the kernel tree: python3 scripts/map-builtin.py /work/builtin.fragment
"""
import re
import sys
from pathlib import Path

order = Path("/work/module-order.txt")
tree = Path("/src/zte-u30air")
# out-of-tree modules (realme drop) never appear in the tree; skip them loudly
SKIP = {"sprd_wlan_combo", "sprdbt_tty", "trusty-log"}
# built unconditionally by a dedicated patch (the Makefile line carries no CONFIG)
PATCHED_IN = {"sprd_manufacturer_model"}

makefiles = {}
for mk in tree.rglob("Makefile"):
    try:
        text = mk.read_text(errors="ignore")
    except OSError:
        continue
    # obj-$(CONFIG_X) += a.o b.o  (multi-target lines included; plain obj-m/obj-y skipped)
    for m in re.finditer(r"obj-\$\((CONFIG_[A-Z0-9_]+)\)\s*\+=\s+(.+)", text):
        for mod in m.group(2).split():
            if mod.endswith(".o"):
                makefiles.setdefault(mod[:-2], m.group(1)[len("CONFIG_"):])

lines, missing = [], []
for name in order.read_text().split():
    name = name[:-3] if name.endswith(".ko") else name
    if name in SKIP:
        continue
    if name in PATCHED_IN:
        continue
    cfg = makefiles.get(name)
    if cfg:
        lines.append(f"CONFIG_{cfg}=y")
    else:
        missing.append(name)

dest = Path(sys.argv[1] if len(sys.argv) > 1 else "/work/builtin.fragment")
dest.write_text("\n".join(sorted(set(lines))) + "\n")
print(f"mapped {len(set(lines))} CONFIG symbols; unmapped: {missing or 'none'}")
if missing:
    sys.exit(1)
