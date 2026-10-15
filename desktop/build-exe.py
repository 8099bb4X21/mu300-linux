#!/usr/bin/env python3
"""Build the optional Windows desktop launcher (pip install pyinstaller paramiko lz4)."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
out=HERE.parent/'work/desktop-exe';out.mkdir(parents=True,exist_ok=True)
source={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ('installer.py','boot_image.py')}
subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onefile',
    '--name','OpenWrt-Installer','--distpath',str(out),'--workpath',str(out/'build'),
    '--specpath',str(out),'--hidden-import','lz4.block','--hidden-import','tarfile','--collect-all','paramiko',
    str(HERE/'installer.py')],check=True)
if source!={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in source}:
    raise RuntimeError('Installer source changed during EXE compilation; rebuild before packaging')
(out/'OpenWrt-Installer.exe.json').write_text(json.dumps({'source':source},indent=2)+'\n')
print(out/'OpenWrt-Installer.exe')
