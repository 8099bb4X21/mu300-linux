#!/usr/bin/env python3
"""Round 3: hammer the ENDPOINTS THE REAL USER HAS OPEN. The user keeps the
home dashboard polling `status` (which embeds cell.json - neighbour/operator
data written by collectors that may run THROUGH a modem restart) while the
locks page polls signal + lock_get. Curl repro never called status during an
apply - that combination is the remaining suspect."""
import json
import threading
import time
import urllib.request

UBUS = "http://192.168.77.1/ubus/"


def call(params, timeout=40):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "call",
                       "params": params}).encode()
    req = urllib.request.Request(UBUS, data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return -1, repr(e)


def main() -> None:
    st, body = call(["00000000000000000000000000000000", "session", "login",
                     {"username": "root", "password": "mu300-f50"}])
    token = json.loads(body)["result"][1]["ubus_rpc_session"]
    print("token:", token, flush=True)
    t0 = time.time()

    def fire(method, params, tag):
        st, body = call([token, "mu300dash", method, params])
        print(f"{time.time()-t0:6.1f}s {tag}: http={st} {body[:100]}", flush=True)

    def apply_thread():
        time.sleep(4)
        fire("lock_set", {"kind": "mode", "val": "4g"}, "lock_set")

    threading.Thread(target=apply_thread).start()

    n = 0
    end = time.time() + 75
    while time.time() < end:
        # both pages at once: status (home) + signal & lock_get (locks page)
        ts = [threading.Thread(target=fire, args=(m, p, f"{m}{n}"))
              for m, p in (("status", {}), ("signal", {}), ("lock_get", {}))]
        for t in ts: t.start()
        for t in ts: t.join()
        n += 1
        time.sleep(2)

    st, body = call([token, "mu300dash", "signal", {}])
    print("final:", st, body[:80])


if __name__ == "__main__":
    main()
