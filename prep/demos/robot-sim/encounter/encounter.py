#!/usr/bin/env python3
"""Two simulated drones meet, and each signs the same encounter record. Checked afterwards.

Simulation: no flight happened. Two quadcopters, flown by two operators, cross each other's path.
When they come within LINK_RANGE_M, they talk over a simulated direct link (messages are lost and
delayed at random) and build a two-party encounter record:

  1. HELLO   each sends the other a fresh random number (its nonce).
  2. SEEN    each signs "I see you": its own key id, the other's key id, its own position and altitude
             as it believes them, its own nonce and the other's nonce. Kind tag
             tet_demo_encounter_seen_v1.
  3. COSIGN  both build the same encounter record from the two SEEN messages (their SHA-256, in key-id
             order; kind tag tet_demo_encounter_v1), each signs it, and each sends its signature to
             the other.

Each aircraft then writes the pair into its own notebook: one record `encounter <sha256> peer=<key id>`
through the real notebook tool (tools/machine-notebook/notebook.py record), and the two SEEN messages,
the encounter record and both signatures in encounters/<sha256>/ beside it. Every signature is
`tet-cli agent sign` (Ed25519 and ML-DSA-44) with the notebook's own key; every signature check is
`tet-cli agent verify` against a pin kept outside the folder being checked.

A receiver refuses a SEEN that is not signed by the pinned key of the aircraft it names, that is not
addressed to it, or that does not carry the nonce it sent in this exchange (an old message replayed).

The checker (check_log, compare) holds one log or both. It shows: which keys signed each encounter,
that both signed the same record, built from messages that each carried the other's fresh number,
and, with both logs, whether the two copies agree. It does NOT judge that either position was true,
the distance between the aircraft (only whether the two believed positions are within 100 m of each
other), who held which key, an encounter absent from both copies, or anything in real time. This is evidence
afterwards, not collision avoidance.

Positions are metres east and north of a made-up origin; nothing here is a place.

    TET_CLI=/path/to/tet-cli python3 encounter.py run --work EMPTY_DIR [--seed 3]
    TET_CLI=/path/to/tet-cli python3 encounter.py check --dir LOG_DIR --pin LOG.pin --registry REG_DIR [--other LOG_DIR --other-pin LOG.pin]
"""

import argparse
import hashlib
import json
import math
import os
import random
import re
import shutil
import stat
import subprocess
import tempfile
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NOTEBOOK_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "tools", "machine-notebook"))
NOTEBOOK = os.path.join(NOTEBOOK_DIR, "notebook.py")
sys.path.insert(0, NOTEBOOK_DIR)
import notebook as nb  # noqa: E402

CHAIN = {"TET_CHAIN_ID": "tet-robot-sim-demo", "TET_GENESIS_HASH": hashlib.sha256(b"robot-sim demo chain").hexdigest()}
SEEN_KIND = "tet_demo_encounter_seen_v1"
ENC_KIND = "tet_demo_encounter_v1"
SEEN_TYPE = "application/vnd.tet.demo-encounter-seen+json"
ENC_TYPE = "application/vnd.tet.demo-encounter+json"
UNIT = "encounter"
LINE = re.compile(r"encounter ([0-9a-f]{64}) peer=(tet-ed25519:[0-9a-f]{64})")

LINK_RANGE_M = 80.0
LOSS = 0.3                 # chance that one message is lost
DELAY_S = (0.03, 0.25)     # one-way delay, uniform
RESEND_S = 0.5
DT = 0.1
# Two operators, crossing missions: (start x, y), (end x, y), altitude, speed. Metres, east and north.
MISSIONS = {
    "A": {"from": (-300.0, 10.0), "to": (300.0, -10.0), "alt": 60.0, "speed": 10.0},
    "B": {"from": (15.0, -250.0), "to": (-15.0, 350.0), "alt": 72.0, "speed": 9.0},
}
GPS_SIGMA = (1.5, 3.0)     # horizontal, vertical, metres: what each aircraft believes is truth plus this


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha(b):
    return hashlib.sha256(b).hexdigest()


def cli():
    return os.environ.get("TET_CLI") or nb.tet_cli(argparse.Namespace(tet_cli=None))


def run_notebook(args, stdin=None):
    r = subprocess.run([sys.executable, NOTEBOOK] + args, input=stdin, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def keyid_of(d):
    with open(os.path.join(d, "device.keyid")) as f:
        return f.read().strip()


def rd(path):
    with open(path, "rb") as f:
        return f.read()


def short(keyid):
    return keyid.split(":")[1][:8]


def verify_env(d, sig_path, payload_path, payload_type, pin):
    """Why the envelope is not the pinned signer's signature over exactly this file, or None.
    tet-cli agent verify checks both halves; then both key ids are compared with the pin."""
    rc, out, _ = nb.run_cli(cli(), ["agent", "verify", "--sig", sig_path, "--payload", payload_path], nb.chain_env(d))
    if rc != 0:
        plain = re.sub(r"\x1b\[[0-9;]*m", "", out)
        why = next((ln.split(":", 1)[1].strip() for ln in plain.splitlines() if ln.startswith("FAIL")), "tet-cli agent verify refused it")
        # the reason names the file by its path; a report names it by its own name only
        return why.replace(payload_path, os.path.basename(payload_path))
    try:
        with open(sig_path) as f:
            env = json.load(f)
    except (OSError, ValueError):
        return "not an envelope"
    if env.get("payloadType") != payload_type:
        return f"payload type is {env.get('payloadType')!r}, not {payload_type}"
    why = nb.pin_problem(nb.half_keyids(env), pin)
    return why.replace("this device's", "the pinned") if why else None


# ── flight ───────────────────────────────────────────────────────────────────────────────────


def fly(seed):
    """Both aircraft, every DT: true position and the position each believes (GPS noise)."""
    rng = random.Random(seed)
    out = {k: [] for k in MISSIONS}
    for k, m in MISSIONS.items():
        (x0, y0), (x1, y1) = m["from"], m["to"]
        length = math.hypot(x1 - x0, y1 - y0)
        n = int(length / m["speed"] / DT)
        bias = (rng.gauss(0, 1.0), rng.gauss(0, 1.0), rng.gauss(0, 2.0))
        for i in range(n + 1):
            f = i / n
            x, y = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
            alt = m["alt"] + 2.0 * math.sin(i * DT / 4.0)
            bx = x + bias[0] + rng.gauss(0, GPS_SIGMA[0])
            by = y + bias[1] + rng.gauss(0, GPS_SIGMA[0])
            balt = alt + bias[2] + rng.gauss(0, GPS_SIGMA[1])
            out[k].append({"t": round(i * DT, 2), "x": round(x, 2), "y": round(y, 2), "alt": round(alt, 2),
                           "bx": round(bx, 2), "by": round(by, 2), "balt": round(balt, 2)})
    return out


# ── one aircraft's side of the exchange ──────────────────────────────────────────────────────


class Aircraft:
    """One aircraft's side: its notebook folder (its key), the pins it knows, and the exchange state."""

    def __init__(self, name, d, known, rng, work):
        self.name, self.d, self.known, self.rng = name, d, known, rng
        self.keyid = keyid_of(d)
        self.scratch = os.path.join(work, f"scratch-{name}")
        os.makedirs(self.scratch, exist_ok=True)
        self.reset()
        self.refused = []      # (t, why) for every message refused
        self.done = []         # encounter hashes recorded

    def reset(self):
        self.nonce = None
        self.peer = None
        self.peer_nonce = None
        self.seen_mine = None   # (bytes, envelope bytes)
        self.seen_peer = None
        self.enc = None         # encounter record bytes
        self.cosig_mine = None
        self.cosig_peer = None
        self.recorded = False

    def sign_bytes(self, body, payload_type, name):
        p = os.path.join(self.scratch, name)
        with open(p, "wb") as f:
            f.write(body)
        nb.sign(cli(), self.d, p, payload_type, out=p + ".sig.json")
        with open(p + ".sig.json", "rb") as f:
            return f.read()

    def check_env(self, body, env, payload_type, keyid, name):
        """Why this envelope is not `keyid`'s signature over `body`, by the pin this aircraft knows."""
        if keyid not in self.known:
            return f"key: {keyid} is not a known aircraft"
        p = os.path.join(self.scratch, "in-" + name)
        with open(p, "wb") as f:
            f.write(body)
        with open(p + ".sig.json", "wb") as f:
            f.write(env)
        why = verify_env(self.d, p + ".sig.json", p, payload_type, self.known[keyid])
        return f"key: {why}" if why else None

    def outgoing(self, t, pos):
        """Messages to send now (called every RESEND_S while the other is in range)."""
        if self.nonce is None:
            self.nonce = "%032x" % self.rng.getrandbits(128)
        msgs = [{"type": "HELLO", "from": self.keyid, "nonce": self.nonce}]
        if self.peer_nonce and self.seen_mine is None:
            seen = {"kind": SEEN_KIND, "from": self.keyid, "to": self.peer, "nonce_mine": self.nonce,
                    "nonce_yours": self.peer_nonce, "t_s": t,
                    "pos": {"east_m": pos["bx"], "north_m": pos["by"], "alt_m": pos["balt"]}}
            body = canonical(seen)
            self.seen_mine = (body, self.sign_bytes(body, SEEN_TYPE, "seen.json"))
            self.build()
        if self.seen_mine and self.cosig_peer is None:
            msgs.append({"type": "SEEN", "body": self.seen_mine[0], "env": self.seen_mine[1]})
        if self.cosig_mine:
            msgs.append({"type": "COSIGN", "from": self.keyid, "env": self.cosig_mine})
        return msgs

    def receive(self, t, m):
        if m["type"] == "HELLO":
            if self.peer is None:
                self.peer = m["from"]
            if m["from"] == self.peer:
                self.peer_nonce = m["nonce"]
            return
        if m["type"] == "SEEN":
            why = self.accept_seen(m["body"], m["env"])
            if why:
                self.refused.append((t, why))
            return
        if m["type"] == "COSIGN" and self.enc and self.cosig_peer is None:
            why = self.check_env(self.enc, m["env"], ENC_TYPE, self.peer, "enc.json")
            if why:
                self.refused.append((t, f"counter-signature: {why}"))
            else:
                self.cosig_peer = m["env"]

    def accept_seen(self, body, env):
        """Why a SEEN is refused, or None (and then the encounter record is built and signed)."""
        try:
            s = json.loads(body)
        except ValueError:
            return "seen: not JSON"
        if not isinstance(s, dict) or s.get("kind") != SEEN_KIND or canonical(s) != body:
            return f"seen: not a {SEEN_KIND} message"
        if s.get("to") != self.keyid:
            return "seen: addressed to another aircraft"
        why = self.check_env(body, env, SEEN_TYPE, s.get("from"), "seen.json")
        if why:
            return why
        if self.nonce is None or s.get("nonce_yours") != self.nonce:
            return "nonce: does not carry the fresh number this aircraft sent (an old message)"
        if self.seen_peer is None:
            self.peer = s["from"]
            self.seen_peer = (body, env)
        self.build()
        return None

    def build(self):
        """Once both SEEN messages are here: the encounter record, signed with this aircraft's key."""
        if self.seen_mine and self.seen_peer and self.enc is None:
            self.enc = encounter_record(self.seen_mine[0], self.seen_peer[0])
            self.cosig_mine = self.sign_bytes(self.enc, ENC_TYPE, "enc.json")

    def complete(self):
        return bool(self.enc and self.cosig_mine and self.cosig_peer)

    def write(self):
        """Into the notebook: the record, through notebook.py record; the bundle beside it."""
        if self.recorded or not self.complete():
            return None
        h = sha(self.enc)
        save_bundle(self.d, self.enc, {self.keyid: self.seen_mine, self.peer: self.seen_peer},
                    {self.keyid: self.cosig_mine, self.peer: self.cosig_peer})
        record_line(self.d, f"encounter {h} peer={self.peer}")
        self.recorded = True
        self.done.append(h)
        return h


def encounter_record(seen_a, seen_b):
    """The one record both sign: both SEEN messages by hash, in key-id order, so both build the same bytes."""
    pair = sorted([(json.loads(seen_a)["from"], sha(seen_a)), (json.loads(seen_b)["from"], sha(seen_b))])
    return canonical({"kind": ENC_KIND, "parties": [k for k, _ in pair], "seen_sha256": [h for _, h in pair]})


def save_bundle(d, enc, seens, cosigs):
    """encounters/<sha256>/: encounter.json, sig.<i>.json per party, seen.<i>.json(+.sig.json) per party,
    i being the party's place in the record."""
    h = sha(enc)
    out = os.path.join(d, "encounters", h)
    os.makedirs(out, exist_ok=True)
    parties = json.loads(enc)["parties"]
    with open(os.path.join(out, "encounter.json"), "wb") as f:
        f.write(enc)
    for i, k in enumerate(parties):
        if k in cosigs:
            with open(os.path.join(out, f"sig.{i}.json"), "wb") as f:
                f.write(cosigs[k])
        if k in seens:
            body, env = seens[k]
            with open(os.path.join(out, f"seen.{i}.json"), "wb") as f:
                f.write(body)
            with open(os.path.join(out, f"seen.{i}.json.sig.json"), "wb") as f:
                f.write(env)
    return out


def record_line(d, value):
    rc, _, err = run_notebook(["record", "--dir", d, "--source", "stdin-json"], json.dumps({"value": value, "unit": UNIT}))
    if rc != 0:
        raise nb.Fail(f"notebook.py record failed (exit {rc}): {err.strip()[-200:]}")


# ── the simulated flight with the link ───────────────────────────────────────────────────────


def simulate(work, seed=3):
    """Init both notebooks, fly, exchange over the lossy link, record. Returns the run summary."""
    os.environ.update(CHAIN)
    rng = random.Random(seed * 7919 + 1)
    dirs, pins = {}, {}
    reg = os.path.join(work, "registry")
    os.makedirs(reg, exist_ok=True)
    for k in MISSIONS:
        d = os.path.join(work, f"aircraft-{k}")
        if not os.path.exists(os.path.join(d, "device.key")):
            rc, _, err = run_notebook(["init", "--dir", d])
            if rc != 0:
                raise nb.Fail(f"notebook.py init failed: {err.strip()[-200:]}")
        dirs[k] = d
        pins[k] = os.path.join(reg, f"{k}.pin")
        shutil.copyfile(os.path.join(d, "device.pin"), pins[k])
    known = {}
    for k in MISSIONS:
        p = nb.read_pin(pins[k])
        known[p[0]] = p
    for k in MISSIONS:
        record_line(dirs[k], f"takeoff mission={k}")
    track = fly(seed)
    craft = {k: Aircraft(k, dirs[k], known, random.Random(rng.getrandbits(64)), work) for k in MISSIONS}
    queue = []   # (deliver_at, to, message)
    sent = lost = 0
    events = []
    n = min(len(v) for v in track.values())
    next_send = 0.0
    for i in range(n):
        t = round(i * DT, 2)
        pa, pb = track["A"][i], track["B"][i]
        dist = math.dist((pa["x"], pa["y"], pa["alt"]), (pb["x"], pb["y"], pb["alt"]))
        for item in [q for q in queue if q[0] <= t]:
            queue.remove(item)
            if dist <= LINK_RANGE_M:
                craft[item[1]].receive(t, item[2])
        for k, c in craft.items():
            h = c.write()
            if h:
                events.append({"t": t, "who": k, "what": "recorded", "sha256": h})
        if dist <= LINK_RANGE_M and t >= next_send:
            next_send = t + RESEND_S
            for k, other in (("A", "B"), ("B", "A")):
                if craft[k].recorded and craft[other].recorded:
                    continue
                for m in craft[k].outgoing(t, track[k][i]):
                    sent += 1
                    if rng.random() < LOSS:
                        lost += 1
                        continue
                    queue.append((round(t + rng.uniform(*DELAY_S), 2), other, m))
    for k in MISSIONS:
        record_line(dirs[k], f"landed mission={k}")
    closest = min(range(n), key=lambda i: math.dist((track["A"][i]["x"], track["A"][i]["y"], track["A"][i]["alt"]),
                                                    (track["B"][i]["x"], track["B"][i]["y"], track["B"][i]["alt"])))
    return {"seed": seed, "dirs": dirs, "pins": pins, "registry": reg, "track": track, "events": events,
            "sent": sent, "lost": lost, "refused": {k: c.refused for k, c in craft.items()},
            "keyids": {k: c.keyid for k, c in craft.items()},
            "closest": {"t": round(closest * DT, 2), "m": round(math.dist(
                (track["A"][closest]["x"], track["A"][closest]["y"], track["A"][closest]["alt"]),
                (track["B"][closest]["x"], track["B"][closest]["y"], track["B"][closest]["alt"])), 1)}}


# ── the checker ──────────────────────────────────────────────────────────────────────────────


# A log folder handed in for checking is copied once, into a private folder, before anything reads
# it; notebook.py verify and every later read in this checker read that copy.# The checker may refuse a folder verify would accept; it never accepts one that verify on the
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


def read_registry(reg):
    known = {}
    for name in sorted(os.listdir(reg)):
        if name.endswith(".pin"):
            p = nb.read_pin(os.path.join(reg, name))
            known[p[0]] = p
    return known


def notebook_records(d):
    """(seq, value, unit) of every record file notebook.py verify reads: names listed exactly as its
    check_chain lists them (ASCII digits, then .json), in the same order. A file verify does not
    read is not read here either."""
    rec = os.path.join(d, "records")
    names = sorted(
        (int(m.group(1)), n) for n in os.listdir(rec) if (m := re.fullmatch(r"([0-9]+)\.json", n))
    ) if os.path.isdir(rec) else []
    out = []
    for seq, name in names:
        try:
            with open(os.path.join(rec, name), "rb") as f:
                r = json.loads(f.read())
            out.append((seq, r["reading"]["value"], r["reading"]["unit"]))
        except (OSError, ValueError, KeyError, TypeError):
            out.append((seq, None, None))
    return out


def parse_verify(out):
    """notebook.py verify prints VALID or INVALID, then one line per problem ('record N: why' or
    'log: why'), then 'Shows:'. Returns the verdict and the records it refused, by seq."""
    lines = re.sub(r"\x1b\[[0-9;]*m", "", out).splitlines()
    verdict = lines[0].strip() if lines else ""
    refused = set()
    for ln in lines[1:]:
        if ln.startswith("Shows:"):
            break
        m = re.fullmatch(r"  record ([0-9]+): .*", ln)
        if m:
            refused.add(int(m.group(1)))
    return verdict, refused


def check_bundle(d, h, own, peer, known):
    """Problems with encounters/<h>/ in log folder d, whose notebook names `peer`. Each reason names the
    one check that refused it."""
    out = os.path.join(d, "encounters", h)
    enc_p = os.path.join(out, "encounter.json")
    try:
        with open(enc_p, "rb") as f:
            enc = f.read()
    except OSError:
        return ["encounter: no encounter.json for this record"], None
    if sha(enc) != h:
        return ["encounter: the file differs from the hash the notebook signed"], None
    try:
        e = json.loads(enc)
    except ValueError:
        return ["encounter: not JSON"], None
    if not isinstance(e, dict) or e.get("kind") != ENC_KIND or canonical(e) != enc:
        return [f"encounter: not a {ENC_KIND} record"], None
    parties = e.get("parties")
    if not (isinstance(parties, list) and len(parties) == 2 and sorted(parties) == parties and own in parties and peer in parties and own != peer):
        return ["encounter: its two parties are not this aircraft and the one its notebook names"], None
    problems = []
    seens = {}
    for i, k in enumerate(parties):
        who = "this aircraft" if k == own else f"the other aircraft ({short(k)})"
        if k not in known:
            problems.append(f"key: {k} is not in the registry")
            continue
        sig = os.path.join(out, f"sig.{i}.json")
        if not os.path.exists(sig):
            problems.append(f"counter-signature of {who}: missing")
        else:
            why = verify_env(d, sig, enc_p, ENC_TYPE, known[k])
            if why:
                problems.append(f"counter-signature of {who}: {why}")
        sp = os.path.join(out, f"seen.{i}.json")
        try:
            with open(sp, "rb") as f:
                body = f.read()
        except OSError:
            problems.append(f"seen of {who}: missing")
            continue
        if sha(body) != e["seen_sha256"][i]:
            problems.append(f"seen of {who}: differs from the message the encounter record names")
            continue
        why = verify_env(d, sp + ".sig.json", sp, SEEN_TYPE, known[k])
        if why:
            problems.append(f"seen of {who}: {why}")
        s = json.loads(body)
        if s.get("kind") != SEEN_KIND or s.get("from") != k or s.get("to") != parties[1 - i]:
            problems.append(f"seen of {who}: not from {short(k)} to the other party")
        seens[k] = s
    if len(seens) == 2:
        a, b = seens[parties[0]], seens[parties[1]]
        if a.get("nonce_yours") != b.get("nonce_mine") or b.get("nonce_yours") != a.get("nonce_mine"):
            problems.append("nonce: the two messages do not carry each other's fresh numbers")
        pa, pb = a["pos"], b["pos"]
        gap = math.dist((pa["east_m"], pa["north_m"], pa["alt_m"]), (pb["east_m"], pb["north_m"], pb["alt_m"]))
        if gap > LINK_RANGE_M + 20:
            problems.append(f"positions: the two believed positions are {gap:.0f} m apart, more than the link reaches")
    return problems, {"parties": parties, "seen": seens}


def check_log(d, pin_path, reg):
    """One log: the notebook (notebook.py verify), then every encounter in it, both on one private
    copy of the folder (snapshot)."""
    known = read_registry(reg)
    pin = nb.read_pin(pin_path, d)
    with tempfile.TemporaryDirectory(prefix="encounter-check-") as tmp:
        try:
            copy = snapshot(d, os.path.join(tmp, "log"))
        except SnapshotRefused as e:
            return {"dir": d, "keyid": pin[0], "notebook": "ERROR", "problems": [f"log: {e}"], "encounters": [], "verdict": "INVALID"}
        res = check_copy(copy, pin_path, pin, known)
    # reasons name the folder that was handed in, not the private copy
    res["problems"] = [w.replace(copy, d) for w in res["problems"]]
    for e in res["encounters"]:
        e["problems"] = [w.replace(copy, d) for w in e["problems"]]
    res["dir"] = d
    return res


def check_copy(d, pin_path, pin, known):
    rc, out, err = run_notebook(["verify", "--dir", d, "--pin", pin_path])
    verdict, refused = parse_verify(out)
    if rc not in (0, 1) or verdict not in ("VALID", "INVALID"):
        verdict = "ERROR"
    res = {"dir": d, "keyid": pin[0], "notebook": verdict, "problems": [], "encounters": []}
    if res["notebook"] != "VALID":
        res["problems"].append("notebook: " + ("; ".join(ln.strip() for ln in out.splitlines()[1:4]) or err.strip()[-200:]))
    if verdict == "ERROR":
        # verify did not finish: no record of this log counts as read, so none is taken.
        res["verdict"] = "INVALID"
        return res
    first = {}
    # Encounter lines come only from records verify read and did not refuse.
    for seq, value, unit in notebook_records(d):
        if seq in refused:
            res["problems"].append(f"record {seq}: notebook.py verify refused it, so no encounter is read from it")
            continue
        if unit != UNIT or not isinstance(value, str) or not value.startswith("encounter "):
            continue
        m = LINE.fullmatch(value)
        if not m:
            res["encounters"].append({"record": seq, "sha256": None, "problems": ["record: not an encounter line"]})
            continue
        h, peer = m.group(1), m.group(2)
        problems, body = check_bundle(d, h, pin[0], peer, known)
        if h in first:
            problems.append(f"replay: this encounter is already recorded at record {first[h]}")
        first.setdefault(h, seq)
        res["encounters"].append({"record": seq, "sha256": h, "peer": peer, "problems": problems, "body": body})
    res["verdict"] = "VALID" if not res["problems"] and all(not e["problems"] for e in res["encounters"]) else "INVALID"
    return res


def compare(ra, rb):
    """Both logs: every encounter between the two, and whether both copies hold it, byte for byte."""
    a_k, b_k = ra["keyid"], rb["keyid"]
    rows = []
    in_a = {e["sha256"]: e for e in ra["encounters"] if e.get("peer") == b_k and not e["problems"]}
    in_b = {e["sha256"]: e for e in rb["encounters"] if e.get("peer") == a_k and not e["problems"]}
    for h in sorted(set(in_a) | set(in_b)):
        if h in in_a and h in in_b:
            rows.append({"sha256": h, "status": "agree", "why": "both logs hold this encounter, signed by both keys"})
        elif h in in_a:
            rows.append({"sha256": h, "status": "mismatch",
                         "why": f"only in {short(a_k)}'s log; {short(b_k)}'s log has no record of it, though {short(b_k)}'s key signed it"})
        else:
            rows.append({"sha256": h, "status": "mismatch",
                         "why": f"only in {short(b_k)}'s log; {short(a_k)}'s log has no record of it, though {short(a_k)}'s key signed it"})
    met = any(r["status"] == "agree" for r in rows)
    return {"met": met, "rows": rows,
            "verdict": "AGREE" if rows and all(r["status"] == "agree" for r in rows) and ra["verdict"] == rb["verdict"] == "VALID" else "MISMATCH"}


def print_log(r):
    print(f"{r['verdict']}  log of {short(r['keyid'])}: notebook {r['notebook']}, {len(r['encounters'])} encounter record(s)")
    for p in r["problems"]:
        print(f"  {p}")
    for e in r["encounters"]:
        print(f"  record {e['record']}: encounter {(e['sha256'] or '?')[:12]}" + (" checked" if not e["problems"] else ""))
        for p in e["problems"]:
            print(f"    {p}")


def cmd_check(a):
    ra = check_log(a.dir, a.pin, a.registry)
    print_log(ra)
    if not a.other:
        print("One log only: an encounter removed from it cannot be seen here; the other aircraft's copy is what shows that.")
        return 0 if ra["verdict"] == "VALID" else 1
    rb = check_log(a.other, a.other_pin, a.registry)
    print_log(rb)
    c = compare(ra, rb)
    print(f"{c['verdict']}  " + ("both keys signed the same record" if c["met"] else "no record signed by both keys is in both copies"))
    for r in c["rows"]:
        print(f"  {r['sha256'][:12]}: {r['status']}: {r['why']}")
    print("Shows: which keys signed each encounter, with each other's fresh numbers; whether the two copies agree. "
          "Does not show: that a position was true, that the aircraft were near each other, which aircraft held a key, "
          "an encounter both operators dropped, when it happened (each time is the aircraft's own claim), anything in real time.")
    return 0 if c["verdict"] == "AGREE" else 1


def cmd_run(a):
    s = simulate(a.work, a.seed)
    print(f"closest approach {s['closest']['m']} m at t={s['closest']['t']} s; {s['sent']} messages sent, {s['lost']} lost")
    for e in s["events"]:
        print(f"t={e['t']} s: aircraft {e['who']} recorded encounter {e['sha256'][:12]}")
    for k, rs in s["refused"].items():
        for t, why in rs:
            print(f"t={t} s: aircraft {k} refused a message: {why}")
    with open(os.path.join(a.work, "run.json"), "w") as f:
        json.dump({k: v for k, v in s.items() if k != "dirs"}, f)
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("run")
    s.add_argument("--work", required=True)
    s.add_argument("--seed", type=int, default=3)
    s = sub.add_parser("check")
    s.add_argument("--dir", required=True)
    s.add_argument("--pin", required=True)
    s.add_argument("--registry", required=True)
    s.add_argument("--other")
    s.add_argument("--other-pin")
    a = ap.parse_args()
    try:
        return cmd_run(a) if a.cmd == "run" else cmd_check(a)
    except nb.Fail as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
