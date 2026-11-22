#!/usr/bin/env python3
"""Sign a ULog file in chunks through the machine notebook, and check a copy of it.

The flight controller's file stays exactly as it was written: standard ULog, which opens in the
usual tools. Beside it, a notebook (tools/machine-notebook/notebook.py) holds one signed record per
chunk of the file. A chunk is a run of whole ULog messages covering about one second of log time
(chunk 0 also holds the header and the definitions). Its record says:

    ulog-chunk <i> off=<first byte> len=<bytes> t0=<us> t1=<us> sha256=<hex of those bytes>

Every signature is `notebook.py record --source stdin-json`, which signs with `tet-cli agent sign`
(both halves, Ed25519 and ML-DSA-44); every signature check is `notebook.py verify`. This file only
cuts the file and compares hashes.

    python3 ulogsign.py sign  --ulog F.ulg --dir DEVICE_DIR [--seconds 1]
    python3 ulogsign.py check --ulog COPY.ulg --dir CHECKER_DIR --pin DEVICE.pin [--json OUT.json]

`check` prints VALID or INVALID, then one line per problem, 'chunk N: why' or 'file: why', and with
--json writes what the replay page reads: every chunk with its verdict, and the flight track taken
from the checked chunks only.

What it does not judge: that the flight happened (here it is a simulation), which machine held the
key, that a sensor told the truth, or whether the file is complete at its end.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import sys

import ulog

HERE = os.path.dirname(os.path.abspath(__file__))
NOTEBOOK = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "tools", "machine-notebook", "notebook.py"))
sys.path.insert(0, os.path.dirname(NOTEBOOK))
import notebook as nb  # noqa: E402

UNIT = "ulog-chunk"
LINE = re.compile(r"ulog-chunk ([0-9]+) off=([0-9]+) len=([0-9]+) t0=([0-9]+) t1=([0-9]+) sha256=([0-9a-f]{64})")


def chunks(buf, seconds=1.0):
    """Cut the file at message boundaries, about `seconds` of log time per chunk. Returns a list of
    (off, len, t0_us, t1_us). The chunks cover every byte of the file, in order, with no gap."""
    log_msgs = list(ulog.messages(buf))
    step = int(seconds * 1e6)
    out = []
    start = 0
    t0 = t1 = None
    boundary = None
    for off, t, body in log_msgs:
        ts = ulog.timestamp_of(body, t)
        if ts is not None:
            if boundary is None:
                boundary = (ts // step + 1) * step
            elif ts >= boundary and off > start:
                out.append((start, off - start, t0 or 0, t1 or 0))
                start = off
                t0 = None
                boundary = (ts // step + 1) * step
            t0 = ts if t0 is None else t0
            t1 = ts
    out.append((start, len(buf) - start, t0 or 0, t1 or 0))
    return out


def notebook(args, stdin=None):
    r = subprocess.run([sys.executable, NOTEBOOK] + args, input=stdin, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def cmd_sign(a):
    with open(a.ulog, "rb") as f:
        buf = f.read()
    ulog.read_header(buf)
    parts = chunks(buf, a.seconds)
    for i, (off, n, t0, t1) in enumerate(parts):
        h = hashlib.sha256(buf[off:off + n]).hexdigest()
        value = f"{UNIT} {i} off={off} len={n} t0={t0} t1={t1} sha256={h}"
        rc, out, err = notebook(["record", "--dir", a.dir, "--source", "stdin-json"], json.dumps({"value": value, "unit": UNIT}))
        if rc != 0:
            sys.exit(f"notebook.py record failed on chunk {i} (exit {rc}): {err.strip()[-200:]}")
    print(f"{len(parts)} chunks signed, {len(buf)} bytes")


def read_records(d):
    """The chunk lines of the checker's records, by record number (file name), and the names of
    files that give a record number twice. Only the names notebook.py verify reads (ASCII digits,
    then .json) are read, so no record is read here that verify did not check."""
    out, twice = {}, []
    rec_dir = os.path.join(d, "records")
    for name in sorted(os.listdir(rec_dir)) if os.path.isdir(rec_dir) else []:
        m = re.fullmatch(r"([0-9]+)\.json", name)
        if not m:
            continue
        if int(m.group(1)) in out:
            twice.append(name)
            continue
        try:
            with open(os.path.join(rec_dir, name), "rb") as f:
                rec = json.loads(f.read())
            value = rec["reading"]["value"]
        except (OSError, ValueError, KeyError, TypeError):
            value = None  # verify names why (e.g. not a regular file); the row is refused
        out[int(m.group(1))] = value
    return out, twice


def parse_verify(out):
    lines = re.sub(r"\x1b\[[0-9;]*m", "", out).splitlines()
    verdict = lines[0].strip() if lines else ""
    by_seq, log = {}, []
    for ln in lines[1:]:
        if ln.startswith("Shows:"):
            break
        m = re.fullmatch(r"  record ([0-9]+): (.*)", ln)
        if m:
            by_seq.setdefault(int(m.group(1)), []).append(m.group(2))
        elif ln.startswith("  log: "):
            log.append(ln[len("  log: "):])
    return verdict, by_seq, log


# A log folder handed in for checking is copied once, into a private folder, before anything reads
# it; notebook.py verify and the record reads in this checker read that copy. The ULog file is read
# once from the path given and judged against the copied records.# The checker may refuse a folder verify would accept; it never accepts one that verify on the
# folder handed in would not. So the copy holds only plain folders and plain regular files: each
# with a plain name (_PLAIN_NAME), on the volume of the folder handed in, a file with one link, each
# judged where it was found when its parent folder was opened. A folder holding any other entry
# (a link, a FIFO, a socket, a device, a second link to a file, another volume, a name that is not
# plain), is refused whole before verify runs, with one reason (ENTRY_REFUSED); so is an entry
# replaced between its lookup and its opening. The folder handed in is opened by its own last name, once any trailing
# "/" and "/." are taken off: a link handed in as the folder is refused however it is spelled, and
# so is a path that ends in "..", with TOP_REFUSED (a pin given inside the folder is refused before
# that). A file over SNAPSHOT_MAX_FILE bytes, or more than SNAPSHOT_MAX_ENTRIES entries, refuses
# the folder with that number named. Each entry is copied as it is when it is read. Not judged:
# changes made to the handed-in folder while it is copied or after.
SNAPSHOT_MAX_FILE = nb.MAX_FILE
SNAPSHOT_MAX_ENTRIES = 20000


class SnapshotRefused(Exception):
    pass


TOP_REFUSED = "the folder handed in is a link, or cannot be opened as a folder by its own name; not checked"
ENTRY_REFUSED = ("the folder holds an entry that is not a plain folder or a plain regular file with a plain name, "
                 "or an entry that changed while it was copied; not checked")
# A plain name: lowercase ASCII letters, digits, ".", "_" and "-" (not "." or "..").
_PLAIN_NAME = re.compile(r"[a-z0-9_.-]+")


def _top_name(src):
    """`src` with every trailing "/" and "/." taken off, so that its last part names the folder."""
    p = src
    while True:
        if len(p) > 1 and p.endswith("/"):
            p = p[:-1]
        elif p.endswith("/."):
            p = p[:-2] or "/"
        else:
            break
    if p == ".." or p.endswith("/.."):
        raise SnapshotRefused(TOP_REFUSED)
    return p


_SNAP_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK
_SNAP_FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


def _snap_open(dfd, name, dev):
    """Opens the entry `name` of the open folder `dfd` when it is a plain folder, or a plain regular
    file with one link, on the volume `dev`, and is still the entry found when it was looked up.
    Returns (fd, is_folder). Any other entry refuses the whole folder (ENTRY_REFUSED)."""
    if name in (".", "..") or not _PLAIN_NAME.fullmatch(name):
        raise SnapshotRefused(ENTRY_REFUSED)
    try:
        st = os.stat(name, dir_fd=dfd, follow_symlinks=False)
    except OSError:
        raise SnapshotRefused(ENTRY_REFUSED)
    is_dir = stat.S_ISDIR(st.st_mode)
    if st.st_dev != dev or not (is_dir or (stat.S_ISREG(st.st_mode) and st.st_nlink == 1)):
        raise SnapshotRefused(ENTRY_REFUSED)
    try:
        fd = os.open(name, _SNAP_DIR if is_dir else _SNAP_FILE, dir_fd=dfd)
    except OSError:
        raise SnapshotRefused(ENTRY_REFUSED)
    got = os.fstat(fd)
    if ((got.st_dev, got.st_ino, stat.S_IFMT(got.st_mode)) != (st.st_dev, st.st_ino, stat.S_IFMT(st.st_mode))
            or (not is_dir and got.st_nlink != 1)):
        os.close(fd)
        raise SnapshotRefused(ENTRY_REFUSED)
    return fd, is_dir


def _snap_read(fd):
    """The bytes of the open regular file `fd`, at most SNAPSHOT_MAX_FILE of them."""
    chunks, size = [], 0
    while True:
        b = os.read(fd, 65536)
        if not b:
            break
        size += len(b)
        if size > SNAPSHOT_MAX_FILE:
            raise SnapshotRefused(f"the folder holds a file larger than {SNAPSHOT_MAX_FILE} bytes; not checked")
        chunks.append(b)
    return b"".join(chunks)


def snapshot(src, dst):
    count = [0]

    def walk(dfd, t, dev):
        os.mkdir(t, 0o700)
        for name in sorted(os.listdir(dfd)):
            count[0] += 1
            if count[0] > SNAPSHOT_MAX_ENTRIES:
                raise SnapshotRefused(f"the folder holds more than {SNAPSHOT_MAX_ENTRIES} entries; not checked")
            fd, is_dir = _snap_open(dfd, name, dev)
            try:
                if is_dir:
                    walk(fd, os.path.join(t, name), dev)
                else:
                    body = _snap_read(fd)
                    with open(os.path.join(t, name), "xb") as f:
                        f.write(body)
            finally:
                os.close(fd)

    try:
        top = os.open(_top_name(src), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        raise SnapshotRefused(TOP_REFUSED)
    try:
        walk(top, dst, os.fstat(top).st_dev)
    except SnapshotRefused:
        shutil.rmtree(dst, ignore_errors=True)  # nothing of a refused folder is left in the copy
        raise
    finally:
        os.close(top)
    return dst



def check(ulog_path, d, pin):
    """Returns {"verdict", "chunks": [{i, record, off, len, t0, t1, status, reasons}], "file": [why],
    "track": [...]}. A chunk is 'checked' only when its record passed notebook.py verify AND the
    bytes it names hash to the signed value. Verify and the record reads run on one private copy of
    the folder (snapshot)."""
    try:
        nb.read_pin(pin, d)  # a pin inside the handed-in folder is refused here, as verify refuses it
    except nb.Fail as e:
        return {"verdict": "ERROR", "chunks": [], "file": [f"pin: {e}"], "track": []}
    with tempfile.TemporaryDirectory(prefix="ulogsign-check-") as tmp:
        try:
            copy = snapshot(d, os.path.join(tmp, "log"))
        except SnapshotRefused as e:
            return {"verdict": "ERROR", "chunks": [], "file": [f"log: {e}"], "track": []}
        res = check_copy(ulog_path, copy, pin)
    res["file"] = [w.replace(copy, d) for w in res["file"]]
    for r in res["chunks"]:
        r["reasons"] = [w.replace(copy, d) for w in r["reasons"]]
    return res


def check_copy(ulog_path, d, pin):
    rc, out, err = notebook(["verify", "--dir", d, "--pin", pin])
    verdict, by_seq, log = parse_verify(out)
    if rc not in (0, 1) or verdict not in ("VALID", "INVALID"):
        return {"verdict": "ERROR", "chunks": [], "file": [(err or out).strip()[-300:]], "track": []}
    with open(ulog_path, "rb") as f:
        buf = f.read()
    rows = []
    problems = [f"notebook: {w}" for w in log]
    expect_off = 0
    records, twice = read_records(d)
    problems += [f"records: {name} gives a record number another file already gives" for name in twice]
    for seq, value in sorted(records.items()):
        reasons = [f"record: {w}" for w in by_seq.get(seq, [])]
        m = LINE.fullmatch(value) if isinstance(value, str) else None
        if not m:
            rows.append({"i": None, "record": seq, "status": "refused", "reasons": reasons + ["record: not a ulog-chunk line"]})
            continue
        i, off, n, t0, t1, h = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)), m.group(6)
        if off != expect_off:
            reasons.append(f"range: starts at byte {off}, the previous chunk ended at {expect_off}")
        expect_off = off + n
        if off + n > len(buf):
            reasons.append(f"bytes: the file ends at {len(buf)}, before this chunk's end {off + n}")
        elif hashlib.sha256(buf[off:off + n]).hexdigest() != h:
            reasons.append("sha256: the file's bytes in this range are not the signed ones")
        rows.append({"i": i, "record": seq, "off": off, "len": n, "t0": t0, "t1": t1,
                     "status": "refused" if reasons else "checked", "reasons": reasons})
    if expect_off < len(buf):
        problems.append(f"file: {len(buf) - expect_off} bytes after byte {expect_off} are in no signed chunk")
    ok = verdict == "VALID" and not problems and all(r["status"] == "checked" for r in rows)
    return {"verdict": "VALID" if ok else "INVALID", "chunks": rows, "file": problems,
            "track": replay_track(buf, rows)}


# Messages that change how later data is decoded: formats, subscriptions, unsubscriptions, flags.
DECODING = {"F", "A", "R", "B"}


def replay_track(buf, rows):
    """The flight drawn from the log alone: every position sample, marked with the chunk that holds
    it and whether it may be shown as checked. Samples in a refused chunk are kept but marked, so the
    page can draw them red; nothing is drawn from outside the file.

    A sample is decoded with the formats and subscriptions written before it, so it counts as
    checked only when its own chunk AND every chunk holding such a message are checked: a changed format in chunk 0 then leaves no later sample shown as checked.

    A chunk's messages are read from its own bytes only when the file's message framing starts a
    message at the chunk's first byte and at the byte after its last (as signing cut it). A changed
    byte before it can move the framing; then its messages are not the signed ones, however its bytes
    hash, and its samples are not shown as checked.

    A sample's attitude (q) is taken only from attitude messages inside checked chunks, so the
    orientation drawn never comes from a refused chunk or from bytes in no chunk at all; q is None
    when no such message is at or before the sample."""
    try:
        log = ulog.ULog(buf)
    except ulog.ULogError:
        return []
    import flight
    spans = [(r["off"], r["off"] + r["len"], r) for r in rows if r.get("off") is not None]

    # where the framing puts a message, plus the file's first byte (chunk 0 starts with the header,
    # after which framing starts at a fixed place) and the byte after its last
    starts = {off for off, _, _ in log.msgs} | {0, len(buf)}

    def owner_of(off):
        return next((r for a, b, r in spans if a <= off < b), None)

    def trusted(r):
        return r is not None and r["status"] == "checked" and r["off"] in starts and r["off"] + r["len"] in starts

    decoding_ok = all(trusted(owner_of(off)) for off, t, _ in log.msgs if t in DECODING)
    out = []
    for p in flight.track(log, attitude_ok=lambda off: trusted(owner_of(off))):  # control:attitude
        owner = owner_of(p["off"])
        p["chunk"] = owner["i"] if owner else None
        p["checked"] = decoding_ok and trusted(owner)  # control:framing
        out.append(p)
    return out


def cmd_check(a):
    res = check(a.ulog, a.dir, a.pin)
    print(res["verdict"])
    for r in res["chunks"]:
        for why in r["reasons"]:
            print(f"  chunk {r['i']}: {why}")
    for why in res["file"]:
        print(f"  {why}")
    print(f"Shows: which key signed which chunk of this file, in the order of the log it is given; checked offline.")
    if a.json:
        with open(a.json, "w") as f:
            json.dump(res, f)
    return 0 if res["verdict"] == "VALID" else 1


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sign")
    s.add_argument("--ulog", required=True)
    s.add_argument("--dir", required=True)
    s.add_argument("--seconds", type=float, default=1.0)
    s = sub.add_parser("check")
    s.add_argument("--ulog", required=True)
    s.add_argument("--dir", required=True)
    s.add_argument("--pin", required=True)
    s.add_argument("--json")
    a = ap.parse_args()
    if a.cmd == "sign":
        cmd_sign(a)
        return 0
    return cmd_check(a)


if __name__ == "__main__":
    sys.exit(main())
