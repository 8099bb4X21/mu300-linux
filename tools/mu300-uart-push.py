#!/usr/bin/env python3
"""Push work/persist-live/new/mu300cell*.sh to the MU300 over the UART console.
The console shell has no base64 applet, so files travel as the raw text of a
quoted heredoc (no expansion); transmission is chunked with pauses so the tty
flip buffers never fill. Verifies md5, installs to /lib/netifd/proto/."""
import hashlib
import re
import sys
import time

import serial

PORT = "COM58"
DELIM = "MU300_EOF_9Q"
FILES = [
    ("work/persist-live/new/mu300cell.sh", "/tmp/mu300cell.new"),
    ("work/persist-live/new/mu300cell-v6.sh", "/tmp/mu300cell-v6.new"),
]
CHUNK = 1500
PAUSE = 0.25


def main() -> None:
    ser = serial.Serial(PORT, 115200, timeout=0.2)
    ok = True
    try:
        def drain(t: float) -> str:
            out = ""
            end = time.time() + t
            while time.time() < end:
                out += ser.read(4096).decode("utf-8", "replace")
            return out

        def wait_marker(tag: str, tmo: float = 20) -> str:
            buf = ""
            end = time.time() + tmo
            while time.time() < end:
                buf += ser.read(4096).decode("utf-8", "replace")
                if re.search(r"^" + tag + r"\s*$", buf, re.M):
                    return buf
                time.sleep(0.02)
            sys.stderr.write(f"[timeout waiting for {tag}]\n{buf[-400:]}\n")
            return buf

        drain(0.5)
        ser.write(b"\r\nstty -echo\r\n")
        drain(0.6)

        for local, remote in FILES:
            text = open(local, "r", encoding="utf-8").read()
            assert "\r" not in text, f"{local} has CR"
            want = hashlib.md5(text.encode()).hexdigest()
            tag = "UP" + re.sub(r"[^A-Za-z0-9]", "", remote)[-8:]
            payload = (f"cat > {remote} <<'{DELIM}'\n"
                       + text.rstrip("\n") + "\n"
                       + f"{DELIM}\nmd5sum {remote}; echo {tag}\n")
            # bare \n only: the console tty maps CR->NL (ICRNL), so \r\n would
            # inject a blank line after every heredoc line
            data = payload.encode()
            for i in range(0, len(data), CHUNK):
                ser.write(data[i:i + CHUNK])
                ser.flush()
                time.sleep(PAUSE)
            out = wait_marker(tag, 30)
            m = re.search(r"([0-9a-f]{32})\s+" + re.escape(remote), out)
            got = m.group(1) if m else "none"
            status = "OK" if got == want else "MISMATCH"
            if got != want:
                ok = False
            print(f"{local}: want {want} got {got} -> {status}")
        if ok:
            cmd = ("cp /tmp/mu300cell.new /lib/netifd/proto/mu300cell.sh; "
                   "cp /tmp/mu300cell-v6.new /lib/netifd/proto/mu300cell-v6.sh; "
                   "chmod +x /lib/netifd/proto/mu300cell.sh /lib/netifd/proto/mu300cell-v6.sh; "
                   "md5sum /lib/netifd/proto/mu300cell.sh /lib/netifd/proto/mu300cell-v6.sh; "
                   "echo INSTALLED")
            ser.write((cmd + "\n").encode())
            ser.flush()
            print(wait_marker("INSTALLED", 15))
        else:
            print("md5 mismatch, NOT installed")
            sys.exit(1)
    finally:
        ser.close()


if __name__ == "__main__":
    main()
