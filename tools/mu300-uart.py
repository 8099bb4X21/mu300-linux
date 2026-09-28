#!/usr/bin/env python3
"""Run shell commands on the MU300 OpenWrt console over the UART (COM58).

usage: mu300-uart.py [--port COM58] [--timeout 30] [--login] 'command'
Prints everything the console printed after the command echo up to a marker.
--login: the console sits at a getty/login prompt; press Enter and log in as
root first (no password on this build)."""
import argparse
import re
import sys
import time

import serial

MARKER = "__MU300_DONE__"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM58")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--timeout", type=float, default=30)
    ap.add_argument("--login", action="store_true")
    ap.add_argument("--raw", action="store_true",
                    help="dump the whole transcript, not just post-marker")
    ap.add_argument("command", nargs="*")
    a = ap.parse_args()

    ser = serial.Serial(a.port, a.baud, timeout=0.2)
    try:
        def drain(t: float) -> str:
            out = ""
            end = time.time() + t
            while time.time() < end:
                chunk = ser.read(4096).decode("utf-8", "replace")
                out += chunk
            return out

        def send(line: str) -> None:
            ser.reset_input_buffer()
            ser.write((line + "\r\n").encode())
            ser.flush()

        drain(0.5)

        if a.login:
            send("")
            hello = drain(1.5)
            if "login:" in hello:
                send("root")
                drain(2.0)

        cmd = " ".join(a.command)
        send("stty -echo 2>/dev/null; " + cmd + "; echo " + MARKER)
        transcript = ""
        end = time.time() + a.timeout
        while time.time() < end:
            transcript += ser.read(4096).decode("utf-8", "replace")
            if re.search(re.escape(MARKER) + r"\s*[\r\n]", transcript):
                break
            time.sleep(0.05)
        transcript = transcript.replace("\r", "")
        if a.raw:
            sys.stdout.write(transcript)
        else:
            m = re.search(re.escape(MARKER) + r"\s*[\r\n]", transcript)
            if m:
                sys.stdout.write(transcript[:m.start()])
            else:
                sys.stdout.write(transcript)
                sys.stderr.write("\n[marker not seen]\n")
                sys.exit(1)
    finally:
        ser.close()


if __name__ == "__main__":
    main()
