"""Build the portable Tauri release and bundled Python backend on Windows."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

from package_gui import sources, digest

HERE = Path(__file__).resolve().parent


def run(*args, cwd=HERE):
    subprocess.run(list(map(str,args)),cwd=cwd,check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--skip-ui', action='store_true')
    p.add_argument('--adb-dir', type=Path, help='optional pre-fetched platform-tools directory')
    a = p.parse_args()
    if os.name != 'nt':
        raise SystemExit('Build Windows binaries on Windows (MSVC, Rust 1.90, Node and Python are build dependencies only).')
    if not a.skip_ui:
        run('npm.cmd','ci','--no-audit','--no-fund','--registry=https://registry.npmjs.org',cwd=HERE/'ui')
        run('npm.cmd','run','tauri','--','build','--no-bundle',cwd=HERE/'ui')
    before = sources()
    work = HERE.parent/'work/installer-backend'
    run(sys.executable,'-m','PyInstaller','--noconfirm','--clean','--noupx','--optimize','2','--onedir','--console',
        '--name','openwrt-backend','--distpath',work/'dist','--workpath',work/'build','--specpath',work,
        '--hidden-import','lz4.block','--hidden-import','xml.etree.ElementTree','--hidden-import','xml.parsers.expat',
        '--hidden-import','tarfile','--hidden-import','gzip','--hidden-import','zlib','--hidden-import','lzma',
        '--hidden-import','bz2','--hidden-import','http.server','--hidden-import','decimal',
        '--collect-all','paramiko',HERE/'backend_entry.py')
    artifact = HERE/'artifacts/windows'
    artifact.mkdir(parents=True,exist_ok=True)
    tools = artifact/'tools'
    tools.mkdir(exist_ok=True)
    names = ('adb.exe','AdbWinApi.dll','AdbWinUsbApi.dll','NOTICE.txt')
    if a.adb_dir:
        for name in names:
            shutil.copy2(a.adb_dir/name, tools/('ADB-NOTICE.txt' if name=='NOTICE.txt' else name))
    else:
        dependency = json.loads((HERE/'platform-tools.json').read_text())
        cache = HERE.parent/'work/installer-platform-tools/platform-tools-pinned.zip'
        cache.parent.mkdir(parents=True,exist_ok=True)
        if not cache.is_file() or digest(cache) != dependency['sha256']:
            urllib.request.urlretrieve(dependency['url'],cache)
        if digest(cache) != dependency['sha256']:
            raise ValueError('Platform-tools download checksum mismatch')
        with zipfile.ZipFile(cache) as archive:
            for name in names:
                (tools/('ADB-NOTICE.txt' if name=='NOTICE.txt' else name)).write_bytes(archive.read('platform-tools/'+name))
    shutil.copy2(HERE/'ui/src-tauri/target/release/openwrt-installer.exe',artifact/'OpenWrt-Installer.exe')
    destination = artifact/'tools/backend'
    # Use a clean build directory so removed dependencies cannot survive a rebuild.
    if destination.exists():
        resolved = destination.resolve()
        if not resolved.is_relative_to(artifact.resolve()): raise ValueError('Invalid artifact target')
        shutil.rmtree(resolved)
    shutil.copytree(work/'dist/openwrt-backend',destination)
    subprocess.run([str(tools/'adb.exe'),'version'],check=True,stdout=subprocess.DEVNULL)
    if sources() != before:
        raise ValueError('Source changed during compilation; rebuild before packaging')
    files = {p.relative_to(artifact).as_posix():digest(p) for p in artifact.rglob('*') if p.is_file() and p.name!='build.json'}
    (artifact/'build.json').write_text(json.dumps({'protocol':1,'source':before,'files':files},indent=2)+'\n',encoding='utf-8')
    print(artifact)


if __name__ == '__main__':
    main()
