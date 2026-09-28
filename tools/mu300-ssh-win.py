#!/usr/bin/env python3
"""Run shell commands on the MU300 OpenWrt over SSH (dropbear, password auth).
Windows-friendly (paramiko) sibling of tools/mu300-ssh.py (which needs a pty).

usage: MU300_PASS=... mu300-ssh-win.py 'command'
       MU300_PASS=... mu300-ssh-win.py --put LOCAL REMOTE"""
import argparse
import os
import sys

import paramiko

HOST = os.environ.get("MU300_HOST", "192.168.77.1")
USER = os.environ.get("MU300_USER", "root")


def connect() -> paramiko.SSHClient:
    pw = os.environ.get("MU300_PASS")
    if not pw:
        sys.exit("set MU300_PASS first")
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, username=USER, password=pw, timeout=8,
                look_for_keys=False, allow_agent=False)
    return cli


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--put", nargs=2, metavar=("LOCAL", "REMOTE"),
                    help="upload via 'cat > REMOTE' over an exec channel "
                         "(dropbear here has no SFTP)")
    ap.add_argument("command", nargs="*")
    a = ap.parse_args()
    cli = connect()
    try:
        if a.put:
            local, remote = a.put
            _, out, err = cli.exec_command(f"cat > {remote}", timeout=30)
            out.channel.sendall(open(local, "rb").read())
            out.channel.shutdown_write()
            rc = out.channel.recv_exit_status()
            e = err.read().decode("utf-8", "replace")
            print(f"put {local} -> {remote} (rc={rc})")
            if e:
                sys.stderr.write(e)
        if a.command:
            _, out, err = cli.exec_command(" ".join(a.command), timeout=120)
            sys.stdout.write(out.read().decode("utf-8", "replace"))
            e = err.read().decode("utf-8", "replace")
            if e:
                sys.stderr.write(e)
    finally:
        cli.close()


if __name__ == "__main__":
    main()
