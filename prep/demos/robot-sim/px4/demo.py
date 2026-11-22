#!/usr/bin/env python3
"""The PX4 demo: fly, sign the ULog in chunks, check a copy in a folder with no key, replay it in 3D.

    TET_CLI=/path/to/tet-cli python3 demo.py --work EMPTY_DIR [--ulog PX4_LOG.ulg] [--port 8766]

Without --ulog it flies flight.py's simulated mission (a stand-in: the file is in PX4's format but
not written by PX4). With --ulog it signs the given file instead, e.g. one PX4 SITL wrote under
build/px4_sitl_sih/rootfs/log/. Then open http://127.0.0.1:8766/.

Layout of the work folder:
  device/            the notebook (key, mode 0600), and flight.ulg as written
  device.pin         the pin, outside both folders
  checker/log/       a copy of the records (chain.json, chain.txt, records/); no key. This is the
                     folder given to the check with --dir
  checker/flight.ulg a copy of the ULog, beside that folder, not inside it: a folder holding a file
                     over 1 MiB is refused whole, and a flight log is larger than that
  contact.json       MuJoCo's contact results, if contact.py was run into this folder

The page's buttons change only the checker's copy of the ULog, then check it again. Everything is
on 127.0.0.1; nothing is contacted.
"""

import argparse
import hashlib
import http.server
import json
import os
import shutil
import struct
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import flight  # noqa: E402
import ulog  # noqa: E402
import ulogsign  # noqa: E402

CHAIN = {"TET_CHAIN_ID": "tet-robot-sim-demo", "TET_GENESIS_HASH": hashlib.sha256(b"robot-sim demo chain").hexdigest()}


def _write_at(path, offset, fmt, value):
    with open(path, "r+b") as f:
        f.seek(offset)
        f.write(struct.pack(fmt, value))


def _read(path):
    with open(path, "rb") as f:
        log = ulog.ULog(f.read())
    return log, flight.track(log)


def tamper_near_miss(path):
    """In the copy: lower the highest altitude sample to 118 m, under the 120 m ceiling. Returns
    the byte offset of the message changed. The field's place is read from the file's own format."""
    log, track = _read(path)
    peak = max(track, key=lambda p: p["alt"])
    _write_at(path, peak["off"] + log.field_offset("vehicle_local_position", "z"), "<f", -118.0)
    return [peak["off"]]


def tamper_geofence(path):
    """In the copy: move every sample outside the west fence to 1 m inside it. Returns the byte
    offsets of the messages changed."""
    log, track = _read(path)
    y_at = log.field_offset("vehicle_local_position", "y")
    out = [p for p in track if p["y"] < flight.FENCE["y_min"]]
    for p in out:
        _write_at(path, p["off"] + y_at, "<f", flight.FENCE["y_min"] + 1.0)
    return [p["off"] for p in out]


def source_of(path, result):
    """Who wrote the log, as the checker's copy says it (sys_name and ver_hw in chunk 0), and only
    when chunk 0 is checked: otherwise those words are not the signed ones."""
    chunk0 = next((r for r in result.get("chunks", []) if r.get("off") == 0), None)
    if not chunk0 or chunk0["status"] != "checked":
        return "unknown: the chunk holding the log's header is not checked"
    try:
        log, _ = _read(path)
    except ulog.ULogError:
        return "unknown: the copy is not a ULog file"
    name, hw = log.info.get("sys_name", b"?"), log.info.get("ver_hw", b"?")
    if name == b"PX4" and hw == b"PX4_SITL":
        return "the PX4 autopilot flying a simulated vehicle (PX4 SITL; sys_name PX4, ver_hw PX4_SITL)"
    if name == b"PX4":
        return f"PX4 (ver_hw {hw.decode('ascii', 'replace')})"
    return f"not PX4: {name.decode('ascii', 'replace')} (flight.py, a stand-in)"


TAMPERS = {"near_miss": tamper_near_miss, "geofence": tamper_geofence}


def checker_paths(checker):
    """(the folder given to the check with --dir, the ULog copy beside it)."""
    return os.path.join(checker, "log"), os.path.join(checker, "flight.ulg")


def copy_to_checker(device, checker, ulg):
    if os.path.isdir(checker):
        shutil.rmtree(checker)
    d, copy = checker_paths(checker)
    os.makedirs(os.path.join(d, "records"))
    for n in ("chain.json", "chain.txt"):
        shutil.copyfile(os.path.join(device, n), os.path.join(d, n))
    for n in os.listdir(os.path.join(device, "records")):
        shutil.copyfile(os.path.join(device, "records", n), os.path.join(d, "records", n))
    shutil.copyfile(ulg, copy)


class Demo:
    def __init__(self, work, source_ulog=None):
        self.work = os.path.abspath(work)
        self.device = os.path.join(self.work, "device")
        self.checker = os.path.join(self.work, "checker")
        self.checker_dir, self.checker_ulg = checker_paths(self.checker)
        self.pin = os.path.join(self.work, "device.pin")
        self.ulg = os.path.join(self.device, "flight.ulg")
        self.lock = threading.Lock()
        self.tampered = None
        os.environ.update(CHAIN)
        if not os.path.exists(self.pin):
            rc, out, err = ulogsign.notebook(["init", "--dir", self.device])
            if rc != 0:
                sys.exit(f"notebook.py init failed (exit {rc}): {err.strip()[-200:]}")
            shutil.copyfile(os.path.join(self.device, "device.pin"), self.pin)
            if source_ulog:
                shutil.copyfile(source_ulog, self.ulg)
            else:
                with open(self.ulg, "wb") as f:
                    f.write(flight.write(flight.fly(7)))
            r = ulogsign.subprocess.run([sys.executable, os.path.join(HERE, "ulogsign.py"), "sign", "--ulog", self.ulg, "--dir", self.device],
                                        capture_output=True, text=True, env=ulogsign.tetcli_path.tool_env())
            if r.returncode != 0:
                sys.exit(r.stderr[-300:])
            print(r.stdout.strip())
        self.reset()

    def reset(self):
        with self.lock:
            copy_to_checker(self.device, self.checker, self.ulg)
            self.tampered = None
            self.result = ulogsign.check(self.checker_ulg, self.checker_dir, self.pin)

    def tamper(self, name):
        with self.lock:
            offs = TAMPERS[name](self.checker_ulg)
            self.tampered = {"name": name, "messages": len(offs)}
            self.result = ulogsign.check(self.checker_ulg, self.checker_dir, self.pin)

    def state(self):
        contact = None
        p = os.path.join(self.work, "contact.json")
        if os.path.exists(p):
            with open(p) as f:
                contact = json.load(f)
                for r in contact.get("landing", []):
                    r.pop("trace", None)
        with self.lock:
            return {"source": source_of(self.checker_ulg, self.result), "tampered": self.tampered, "check": self.result, "contact": contact,
                    "ceiling_m": flight.CEILING_M, "fence": flight.FENCE}


def serve(demo, port):
    files = {"/": ("replay.html", "text/html; charset=utf-8"), "/replay.js": ("replay.js", "text/javascript"),
             "/vendor/three/three.module.js": ("vendor/three/three.module.js", "text/javascript"),
             "/vendor/three/three.core.js": ("vendor/three/three.core.js", "text/javascript"),
             "/vendor/three/addons/OrbitControls.js": ("vendor/three/addons/OrbitControls.js", "text/javascript")}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/state":
                return self.send(200, json.dumps(demo.state()).encode(), "application/json")
            if path in files:
                name, ctype = files[path]
                with open(os.path.join(HERE, name), "rb") as f:
                    return self.send(200, f.read(), ctype)
            self.send(404, b"not found", "text/plain")

        def do_POST(self):
            name = self.path.strip("/").removeprefix("tamper/")
            if self.path == "/reset":
                demo.reset()
            elif self.path.startswith("/tamper/") and name in TAMPERS:
                demo.tamper(name)
            else:
                return self.send(404, b"not found", "text/plain")
            self.send(200, json.dumps(demo.state()).encode(), "application/json")

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"http://127.0.0.1:{port}/")
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--ulog")
    ap.add_argument("--port", type=int, default=8766)
    a = ap.parse_args()
    serve(Demo(a.work, a.ulog), a.port)


if __name__ == "__main__":
    main()
