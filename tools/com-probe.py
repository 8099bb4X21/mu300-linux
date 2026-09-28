#!/usr/bin/env python3
"""Classify the ACM pipe: does a write complete, does anything echo back?"""
import sys
import time

import serial

ser = serial.Serial(sys.argv[1] if len(sys.argv) > 1 else "COM58", 115200, timeout=0.2)
try:
    for i in range(3):
        ser.write(b"\r")  # no flush of input first: see leftover output too
        ser.flush()
        print(f"write {i + 1} ok")
        sys.stdout.flush()
        time.sleep(0.8)
        print(f"read {i + 1}: {ser.read(4096)!r}")
        sys.stdout.flush()
finally:
    ser.close()
