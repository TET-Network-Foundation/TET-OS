#!/usr/bin/env python3
"""Machine notebook v1: a device keeps its own signed, chained log of readings, and can sign
one-time permits that a record may cite. Prototype.

    python3 notebook.py init    --dir DIR
    python3 notebook.py record  --dir DIR --source loadavg|cpu-temp|stdin-json [--permit PERMIT_ID]
    python3 notebook.py permit  --dir DIR --action NAME --expires-seq N
    python3 notebook.py run     --dir DIR --source ... --every SECONDS [--until HH:MM]
    python3 notebook.py verify  --dir DIR --pin PINFILE [--node URL]
    python3 notebook.py publish --dir DIR --seq N --node URL
    python3 notebook.py export  --dir DIR --out NEWDIR

No new cryptography: every signature is `tet-cli agent sign` (the agent envelope in
docs/AGENT_IDENTITY.md) and every check is `tet-cli agent verify`. The device phrase reaches tet-cli
only through the TET_MNEMONIC environment variable, never as an argument (an argument is visible to
every process via `ps`). Stdlib only.

Layout of DIR:
  device.key              the device's own 12-word phrase, mode 0600. Never the owner's.
  device.keyid            its Ed25519 key id (tet-ed25519:<hex>)
  device.head             "<seq> <sha256>" of the last record this device signed, mode 0600. record
                          appends only to a log that still ends there, so the device never signs a
                          second record under a number it has already used.
  device.pin              both of its key ids, one per line: tet-ed25519:<hex>, tet-mldsa44:<hex>.
                          verify takes the pin from --pin, a copy kept OUTSIDE the folder: the check
                          pins both keys of the expected signer.
  chain.json              the chain every envelope is bound to: {"chain_id", "genesis_hash"} (public)
  records/<seq>.json      one reading, canonical JSON (sorted keys, no spaces)
  records/<seq>.json.sig.json   its envelope (payload type application/vnd.tet.machine-log+json)
  records/<seq>.hash.sig.json   only after `publish`: the hash-only record the node stores
  chain.txt               the SHA-256 of each record, one per line, in order
  permits/<permit_id>.json           a one-time permit, canonical JSON
  permits/<permit_id>.json.sig.json  its envelope (payload type application/vnd.tet.machine-permit+json)

Privacy: a record holds the reading, its unit, a sequence number, the previous record's hash and
the device clock in UTC. No hostname, IP, location or name is written to a record or printed.
"""

import argparse
import base64
import contextlib
import datetime as dt
import glob
import hashlib
import json
import math
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

KIND = "tet_machine_log_v1"
PAYLOAD_TYPE = "application/vnd.tet.machine-log+json"
# A one-time permit: the device key signs it, a record may cite its id, and verify refuses a log that
# cites one twice, after expires_seq, or that this device's key did not sign.
PERMIT_KIND = "tet_machine_permit_v1"
PERMIT_PAYLOAD_TYPE = "application/vnd.tet.machine-permit+json"
PERMIT_KEYS = {"kind", "permit_id", "action", "expires_seq"}
# The node's registry (tet-core/src/sigs.rs): a published record is a hash-only envelope, and the
# node accepts it only with its signer's consent over that record's exact SHA-256.
HASH_PAYLOAD_TYPE = "application/vnd.tet.sha256"
CONSENT_PAYLOAD_TYPE = "tet sig publish v1"
ZERO = "0" * 64
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

SHOWS = [
    "which key signed each record",
    "that the records are in this order",
    "that each record names the hash of the one before it",
    "that no one-time permission was used twice in this log, or after it ran out",
]
DOES_NOT_SHOW = [
    "that the reading is true",
    "that the machine's clock was right",
    "where the machine was",
    "who runs the machine",
    "that the key was not copied",
    "that a copied key did not use the same permission in another log",
    "that the signature format is final: it is in outside review, and logs from this test may need re-signing",
]


class Fail(Exception):
    pass


class Unreadable(Exception):
    """A file in the folder that is not a regular file of a sane size; the message says which."""


# A record or envelope is a few KiB. Every file verify reads goes through read_file, once, so that a
# FIFO, a device or a symlink cannot hang it, feed it without end, or give one read different bytes
# from the next; chain.txt holds one 65-byte line per record.
MAX_FILE = 1 << 20
MAX_CHAIN_TXT = 16 << 20


def read_file(path, cap=MAX_FILE):
    """The bytes of the regular file at `path`, read once. FileNotFoundError if there is none;
    Unreadable for a symlink, FIFO, device or directory (opened without following or blocking, then
    checked on the open descriptor), or for more than `cap` bytes."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        raise
    except OSError:
        raise Unreadable("not a regular file")
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise Unreadable("not a regular file")
        chunks, size = [], 0
        while True:
            b = os.read(fd, 65536)
            if not b:
                break
            size += len(b)
            if size > cap:
                raise Unreadable(f"larger than {cap} bytes")
            chunks.append(b)
        return b"".join(chunks)
    finally:
        os.close(fd)


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def tet_cli(args):
    return args.tet_cli or os.environ.get("TET_CLI") or "target/release/tet-cli"


def chain_env(d):
    """The chain binding from chain.json, so signing and verifying always use the same one."""
    try:
        c = json.loads(read_file(os.path.join(d, "chain.json")))
        return {"TET_CHAIN_ID": c["chain_id"], "TET_GENESIS_HASH": c["genesis_hash"]}
    except (OSError, Unreadable, ValueError, KeyError, TypeError):
        raise Fail(f"no chain.json in {d}; run init before this")


def run_cli(cli, argv, env_extra=None):
    """Run tet-cli. Its output is returned, never echoed: `keys generate` prints the phrase."""
    env = dict(os.environ)
    env.pop("TET_MNEMONIC", None)
    if env_extra:
        env.update(env_extra)
    try:
        p = subprocess.run([cli] + argv, capture_output=True, text=True, env=env, timeout=120)
    except FileNotFoundError:
        raise Fail(f"tet-cli not found at {cli} (build it: RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release, or pass --tet-cli)")
    return p.returncode, p.stdout, p.stderr


def verify_bytes(cli, cenv, sig_bytes, payload_bytes):
    """tet-cli agent verify over exactly these bytes, copied to a private temporary folder: the
    envelope and payload tet-cli checks are the ones the caller hashed and parses, never a second read
    of a file someone else can change. Returns (exit code, stdout)."""
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, "payload")
        with open(p, "wb") as f:
            f.write(payload_bytes)
        with open(p + ".sig.json", "wb") as f:
            f.write(sig_bytes)
        rc, out, _ = run_cli(cli, ["agent", "verify", "--sig", p + ".sig.json", "--payload", p], cenv)
    return rc, out


def refusal(out):
    """The FAIL line tet-cli agent verify printed, without colour codes."""
    plain = re.sub(r"\x1b\[[0-9;]*m", "", out)
    return next((ln.split(":", 1)[1].strip() for ln in plain.splitlines() if ln.startswith("FAIL")), "tet-cli agent verify refused it")


def parse_env(sig_bytes):
    try:
        env = json.loads(sig_bytes)
    except (ValueError, UnicodeDecodeError):
        return {}
    return env if isinstance(env, dict) else {}


def read_phrase(d):
    path = os.path.join(d, "device.key")
    if os.stat(path).st_mode & 0o077:
        raise Fail("device.key is readable by others; chmod 600 it")
    with open(path) as f:
        return f.read().strip()


def sign(cli, d, path, payload_type, out=None):
    argv = ["agent", "sign", "--in", path, "--payload-type", payload_type]
    if out:
        argv += ["--out", out]
    rc, _, err = run_cli(cli, argv, {**chain_env(d), "TET_MNEMONIC": read_phrase(d)})
    if rc != 0:
        # tet-cli's errors never contain the phrase; stdout (key ids) is not needed here.
        raise Fail(f"signing failed: {err.strip()[-300:]}")


# ── init ──────────────────────────────────────────────────────────────────────────────────────


def cmd_init(a):
    d = a.dir
    os.makedirs(d, mode=0o700, exist_ok=True)
    key = os.path.join(d, "device.key")
    if os.path.exists(key):
        raise Fail(f"{key} exists; refusing to replace a device key")
    chain_id = os.environ.get("TET_CHAIN_ID", "").strip()
    genesis = os.environ.get("TET_GENESIS_HASH", "").strip().lower()
    # Kept exactly as GET /chain gives it, "0x" included: the signed pre-image binds the genesis hash
    # as a string (tet-core agent.rs), so dropping the prefix would sign for a chain no node has.
    if not chain_id or not re.fullmatch(r"(0x)?[0-9a-f]{64}", genesis):
        raise Fail("set TET_CHAIN_ID and TET_GENESIS_HASH (64 hex, 0x allowed) for the chain to sign for; a node's GET /chain shows both")
    rc, out, _ = run_cli(tet_cli(a), ["keys", "generate", "--words", "12"])
    if rc != 0:
        raise Fail(f"tet-cli keys generate failed (exit {rc})")
    lines = [ln.strip() for ln in out.splitlines()]
    try:
        address = lines[lines.index("Public Address (ed25519 vk, hex):") + 1]
        # "Mnemonic (DO NOT SHARE):", then a warning line, then the phrase.
        phrase = lines[next(i for i, ln in enumerate(lines) if ln.startswith("Mnemonic")) + 2]
    except (ValueError, StopIteration, IndexError):
        raise Fail("could not read tet-cli keys generate output (format changed?)")
    if not re.fullmatch(r"[0-9a-f]{64}", address) or not re.fullmatch(r"[a-z]+( [a-z]+){11}", phrase):
        raise Fail("could not read tet-cli keys generate output (format changed?)")
    fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(phrase + "\n")
    with open(os.path.join(d, "chain.json"), "w") as f:
        json.dump({"chain_id": chain_id, "genesis_hash": genesis}, f)
        f.write("\n")
    keyid = f"tet-ed25519:{address}"
    with open(os.path.join(d, "device.keyid"), "w") as f:
        f.write(keyid + "\n")
    pin = derive_pin(tet_cli(a), d)
    if pin[0] != keyid:
        raise Fail("tet-cli signed with another key than keys generate printed")
    with open(os.path.join(d, "device.pin"), "w") as f:
        f.write(f"{pin[0]}\n{pin[1]}\n")
    os.makedirs(os.path.join(d, "records"), exist_ok=True)
    write_head(d, 0, ZERO)
    print(keyid)


# ── permits ───────────────────────────────────────────────────────────────────────────────────


ED = "tet-ed25519:"
ML = "tet-mldsa44:"
PIN_RE = re.compile(r"(tet-ed25519:[0-9a-f]{64})\n(tet-mldsa44:[0-9a-f]{64})\n?")


def half_keyids(env):
    """(Ed25519 key id, ML-DSA-44 key id) named in an envelope's signatures; None for a half that is
    missing or named twice. tet-cli agent verify has already checked that each names the key that
    signed it, so comparing both with the pin compares both keys."""
    sigs = env.get("signatures", []) if isinstance(env, dict) else []
    ids = [str(s.get("keyid", "")) for s in sigs if isinstance(s, dict)] if isinstance(sigs, list) else []

    def one(prefix):
        hits = [k for k in ids if k.startswith(prefix)]
        return hits[0] if len(hits) == 1 else None

    return one(ED), one(ML)


def pin_problem(got, pin):
    """Why an envelope with key ids `got` is not the pinned signer's, or None. One reason, Ed25519
    half first, so each half has exactly one line that can name it."""
    if got[0] != pin[0]:
        return f"signed by {got[0]}, not this device's {pin[0]}"
    if got[1] != pin[1]:
        return f"its ML-DSA-44 half is signed by {got[1]}, not this device's {pin[1]}"
    return None


MAX_LINKS = 40  # as the kernel's own limit; past it, opening the path fails anyway


def lookup_folders(path):
    """Every folder in which a part of `path` is looked up when the file system opens it: one part at
    a time, symlinks expanded where they are met (at most MAX_LINKS of them), `..` taken from the
    folder actually reached. A `..` is not a lookup a folder can redirect, so it adds none."""
    cur = os.sep if path.startswith(os.sep) else os.getcwd()
    todo = [p for p in path.split(os.sep)]
    links = 0
    while todo:
        part = todo.pop(0)
        if part in ("", "."):
            continue
        if part == "..":
            cur = os.path.dirname(cur)
            continue
        yield cur
        nxt = os.path.join(cur, part)
        try:
            st = os.lstat(nxt)
        except OSError:
            return
        if stat.S_ISLNK(st.st_mode):
            links += 1
            if links > MAX_LINKS:
                return
            target = os.readlink(nxt)
            if target.startswith(os.sep):
                cur = os.sep
            todo = target.split(os.sep) + todo
        else:
            cur = nxt


def pin_is_inside(path, d):
    """Does `path` lead into folder `d`, or is it one of the files there? Checked by identity, the
    (device, inode) pair, so that no spelling of either path matters (letter case or Unicode form on
    a file system that ignores them, symlinks to the folder, `..`):
    - any folder in which a part of `path` is looked up, followed one part at a time as the file
      system does (symlinks expanded, `..` taken after them), is `d` or a folder under it: then the
      folder can choose what `path` reads, e.g. with a symlink in it;
    - any folder on the way to `path` as written, before its last part is resolved, is one of those;
    - `path` itself (lstat) or what it points to (stat) is an entry under `d`: a hard link to it.
    Also by path with symlinks resolved."""
    real, root = os.path.realpath(path), os.path.realpath(d)
    if os.path.commonpath([real, root]) == root:
        return True
    try:
        st = os.stat(d)
    except OSError:
        return False
    dirs_in_d = {(st.st_dev, st.st_ino)}
    entries = set()
    for top, dirs, files in os.walk(d):
        for n in dirs + files:
            try:
                e = os.lstat(os.path.join(top, n))
            except OSError:
                continue
            entries.add((e.st_dev, e.st_ino))
            if n in dirs:
                dirs_in_d.add((e.st_dev, e.st_ino))
    up = os.path.dirname(os.path.abspath(path))
    while True:
        try:
            u = os.stat(up)
            if (u.st_dev, u.st_ino) in dirs_in_d:
                return True
        except OSError:
            pass
        if os.path.dirname(up) == up:
            break
        up = os.path.dirname(up)
    for where in lookup_folders(path):
        try:
            u = os.stat(where)
        except OSError:
            continue
        if (u.st_dev, u.st_ino) in dirs_in_d:
            return True
    for look in (os.lstat, os.stat):
        try:
            s = look(path)
        except OSError:
            continue
        if (s.st_dev, s.st_ino) in entries:
            return True
    return False


def read_pin(path, d=None):
    """Both key ids of the expected signer, from a pin file. With `d`, the file must lie outside it."""
    if d is not None and pin_is_inside(path, d):
        raise Fail(f"--pin {path} is inside the folder being checked; give a copy kept outside it")
    try:
        with open(path) as f:
            m = PIN_RE.fullmatch(f.read())
    except (OSError, UnicodeDecodeError):
        m = None
    if not m:
        raise Fail(f"--pin {path} is not a pin file: two lines, tet-ed25519:<64 hex> and tet-mldsa44:<64 hex>")
    return m.group(1), m.group(2)


def derive_pin(cli, d):
    """The pin of the key in this folder's device.key: sign a throwaway payload and read both key ids
    from the envelope. For the device's own side (init, and record checking a permit before it
    writes); verify never uses it."""
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, "pin-probe")
        with open(p, "wb") as f:
            f.write(b"")
        sign(cli, d, p, "application/vnd.tet.machine-pin-probe", out=p + ".sig.json")
        with open(p + ".sig.json") as f:
            pin = half_keyids(json.load(f))
    if None in pin:
        raise Fail("could not read both key ids from tet-cli agent sign (format changed?)")
    return pin


def cmd_permit(a):
    d = a.dir
    if not os.path.exists(os.path.join(d, "device.key")):
        raise Fail(f"no device key in {d}; run init before this")
    # A short name for the action, not a sentence: like a record, a permit carries no name or place.
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", a.action):
        raise Fail("--action is a short name: 1 to 64 of A-Z a-z 0-9 . _ -")
    if a.expires_seq < 1:
        raise Fail("--expires-seq is the last record number that may cite the permit; it must be 1 or more")
    pid = os.urandom(16).hex()
    permit = {"kind": PERMIT_KIND, "permit_id": pid, "action": a.action, "expires_seq": a.expires_seq}
    os.makedirs(os.path.join(d, "permits"), exist_ok=True)
    path = os.path.join(d, "permits", f"{pid}.json")
    with open(path, "xb") as f:
        f.write(canonical(permit))
    try:
        sign(tet_cli(a), d, path, PERMIT_PAYLOAD_TYPE)
    except Fail:
        os.remove(path)
        raise
    print(pid)


def permit_problem(d, cli, pid, seq, used, device):
    """Why record `seq` may not cite permit `pid`, or None if it may. `used` maps a permit id to the
    record that already cited it; `device` is the pin (both key ids) of the key this log belongs to.
    Returns (reason, permit).

    One reason per citation, in this order, so each has exactly one check that can give it: the permit
    is in the notebook; its envelope verifies over exactly these bytes (tet-cli agent verify); this
    device's key signed it, both halves; it is a permit, and the one the record names; it is still open at this
    seq; nothing cited it before."""
    if not isinstance(pid, str) or not re.fullmatch(r"[0-9a-f]{32}", pid):
        return "permit: not a permit id (32 hex)", None
    path = os.path.join(d, "permits", f"{pid}.json")
    try:
        body = read_file(path)
        sig_bytes = read_file(path + ".sig.json")
    except FileNotFoundError:
        return f"permit: {pid} is not in this notebook", None
    except Unreadable as e:
        return f"permit: {pid}: {e}", None
    rc, out = verify_bytes(cli, chain_env(d), sig_bytes, body)
    if rc != 0:
        return f"permit: {pid}: signature: {refusal(out)}", None
    # Only after tet-cli accepted these envelope bytes: it has checked that each keyid names the key
    # that signed. The key ids are read from the same bytes.
    env = parse_env(sig_bytes)
    if env.get("payloadType") != PERMIT_PAYLOAD_TYPE:
        return f"permit: {pid}: payload type is {env.get('payloadType')!r}, not {PERMIT_PAYLOAD_TYPE}", None
    why = pin_problem(half_keyids(env), device)
    if why:
        return f"permit: {pid} is {why}" if why.startswith("signed") else f"permit: {pid}: {why}", None
    try:
        permit = json.loads(body)
    except ValueError:
        permit = None
    if (
        not isinstance(permit, dict) or set(permit) != PERMIT_KEYS or permit["kind"] != PERMIT_KIND or canonical(permit) != body
        or not isinstance(permit["action"], str) or type(permit["expires_seq"]) is not int
    ):
        return f"permit: {pid} is not a {PERMIT_KIND} permit", None
    # The id inside the signed bytes, not the file name, is the permit: a copy of one permit under a
    # second name must not count as a second permit.
    if permit["permit_id"] != pid:
        return f"permit: {pid}.json holds permit {permit['permit_id']}", None
    if seq > permit["expires_seq"]:
        return f"permit: {pid} expired after seq {permit['expires_seq']}", permit
    if pid in used:
        return f"permit: {pid} was already used by record {used[pid]}", permit
    return None, permit


def cited_permits(d):
    """{permit id: seq of the first record citing it}, read from the records on disk."""
    used = {}
    rec_dir = os.path.join(d, "records")
    for seq in sorted(int(m.group(1)) for n in os.listdir(rec_dir) if (m := re.fullmatch(r"(\d+)\.json", n))):
        try:
            pid = json.loads(read_file(os.path.join(rec_dir, f"{seq}.json"))).get("permit")
        except (OSError, Unreadable, ValueError, AttributeError):
            continue
        if isinstance(pid, str):
            used.setdefault(pid, seq)
    return used


# ── record ────────────────────────────────────────────────────────────────────────────────────


def read_source(source):
    if source == "loadavg":
        # os.getloadavg works on macOS and Linux.
        return {"source": "loadavg", "value": round(os.getloadavg()[0], 2), "unit": "load-1m"}
    if source == "cpu-temp":
        if not sys.platform.startswith("linux"):
            raise Fail("cpu-temp reads /sys/class/thermal, which exists on Linux only")
        zones = sorted(glob.glob("/sys/class/thermal/thermal_zone*/temp"))
        if not zones:
            raise Fail("no /sys/class/thermal/thermal_zone*/temp on this device")
        with open(zones[0]) as f:
            return {"source": "cpu-temp", "value": round(int(f.read().strip()) / 1000, 1), "unit": "celsius"}
    if source == "stdin-json":
        def no_constant(name):
            raise ValueError(f"{name} is not JSON")

        try:
            # NaN and Infinity are not JSON (RFC 8259): a record holding one could not be read back by
            # other readers. parse_constant refuses the tokens; the isfinite check below refuses 1e400.
            r = json.loads(sys.stdin.read(), parse_constant=no_constant)
        except ValueError:
            raise Fail('stdin-json wants one JSON object: {"value": ..., "unit": "..."}')
        # Exactly these two keys, so nothing else (a name, a place) can ride along into the record.
        if not isinstance(r, dict) or set(r) != {"value", "unit"} or not isinstance(r["unit"], str):
            raise Fail('stdin-json wants exactly {"value": <number|string|bool>, "unit": "<string>"}')
        if not isinstance(r["value"], (int, float, str, bool)):
            raise Fail("stdin-json value must be a number, string or bool")
        if isinstance(r["value"], float) and not math.isfinite(r["value"]):
            raise Fail("stdin-json value must be a finite number")
        return {"source": "stdin-json", "value": r["value"], "unit": r["unit"]}
    raise Fail(f"unknown source {source}")


HEAD_RE = re.compile(r"(0|[1-9][0-9]{0,17}) ([0-9a-f]{64})\n")


def read_head(d):
    """(seq, sha256) of the last record this device signed, from device.head."""
    p = os.path.join(d, "device.head")
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        raise Fail(
            f"no device.head in {d}, so the device cannot tell where its log ended. A folder made before "
            "device.head existed: run verify, and if the log is VALID and whole, write "
            '"<number of records> <sha256 of the newest record>" to device.head, mode 600'
        )
    if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
        raise Fail("device.head must be a regular file only its owner can read and write; chmod 600 it")
    try:
        m = HEAD_RE.fullmatch(read_file(p, 128).decode("ascii"))
    except (OSError, Unreadable, UnicodeDecodeError):
        m = None
    if not m:
        raise Fail('device.head is not "<seq> <sha256>"')
    return int(m.group(1)), m.group(2)


def write_head(d, seq, h):
    """Replace device.head in one step: a crash leaves the old one or the new one, never half."""
    p = os.path.join(d, "device.head")
    tmp = p + ".tmp"
    with contextlib.suppress(FileNotFoundError):
        os.remove(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(f"{seq} {h}\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, p)


def chain_lines(d):
    """chain.txt's lines; [] if there is none. Unreadable if it is not a regular file."""
    try:
        text = read_file(os.path.join(d, "chain.txt"), MAX_CHAIN_TXT).decode("ascii", "replace")
    except FileNotFoundError:
        return []
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def record_once(a):
    d = a.dir
    if not os.path.exists(os.path.join(d, "device.key")):
        raise Fail(f"no device key in {d}; run init before this")
    try:
        chain = chain_lines(d)
    except Unreadable as e:
        raise Fail(f"chain.txt: {e}")
    # The device's own memory of where its log ended, not chain.txt's: chain.txt is not signed, and a
    # log that ends earlier than the device remembers is refused, not continued.
    head_seq, head_hash = read_head(d)
    if (len(chain), chain[-1] if chain else ZERO) != (head_seq, head_hash):
        raise Fail(
            f"not recorded: this device last signed record {head_seq}, and the log does not end with it "
            f"(chain.txt ends at record {len(chain)}); run verify"
        )
    seq = len(chain) + 1
    rec_dir = os.path.join(d, "records")
    os.makedirs(rec_dir, exist_ok=True)
    path = os.path.join(rec_dir, f"{seq}.json")
    if os.path.exists(path):
        raise Fail(f"{path} exists but chain.txt has {len(chain)} entries; run verify")
    record = {
        "v": 1,
        "kind": KIND,
        "seq": seq,
        "prev": chain[-1] if chain else ZERO,
        "reading": read_source(a.source),
        # UTC, so the record carries no time-zone offset (an offset narrows down where a device is).
        "clock_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    pid = getattr(a, "permit", None)
    if pid is not None:
        # The same check verify makes, before anything is written: a log is append-only, so one record
        # citing a used or expired permit would leave the whole log INVALID for good.
        why, _ = permit_problem(d, tet_cli(a), pid, seq, cited_permits(d), derive_pin(tet_cli(a), d))
        if why:
            raise Fail(f"not recorded: {why}")
        record["permit"] = pid
    body = canonical(record)
    with open(path, "wb") as f:
        f.write(body)
    try:
        sign(tet_cli(a), d, path, PAYLOAD_TYPE)
    except Fail:
        os.remove(path)
        raise
    with open(os.path.join(d, "chain.txt"), "a") as f:
        f.write(sha256_hex(body) + "\n")
    write_head(d, seq, sha256_hex(body))
    print(f"seq {seq}: {record['reading']['value']} {record['reading']['unit']}" + (f" (permit {pid})" if pid else ""))


def cmd_record(a):
    record_once(a)


def cmd_run(a):
    # A loop driven by an argument has a lower bound: 0 or less would record with no pause at all.
    if not math.isfinite(a.every) or a.every <= 0:
        raise Fail(f"--every is the pause between records in seconds; it must be more than 0, not {a.every}")
    m = re.fullmatch(r"([01]?[0-9]|2[0-3]):([0-5][0-9])", a.until)
    if not m:
        raise Fail(f"--until is a local time HH:MM, 00:00 to 23:59, not {a.until!r}")
    hh, mm = int(m.group(1)), int(m.group(2))
    now = dt.datetime.now()
    stop = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if stop <= now:
        print(f"already past {a.until}; nothing to do")
        return
    print(f"recording every {a.every}s until {a.until} (local)")
    while dt.datetime.now() < stop:
        record_once(a)
        time.sleep(max(0.0, min(a.every, (stop - dt.datetime.now()).total_seconds())))
    print(f"stopped at {a.until}")


# ── verify ────────────────────────────────────────────────────────────────────────────────────


def ed_keyid(env):
    ids = [s.get("keyid", "") for s in env.get("signatures", []) if str(s.get("keyid", "")).startswith("tet-ed25519:")]
    return ids[0] if len(ids) == 1 else None


def check_chain(d, cli, pin):
    """Every problem found, as (seq or None, reason). Empty means the log checks out. `pin` is both
    key ids of the expected signer, from outside the folder (read_pin). Each file is read once
    (read_file), and every check, tet-cli's included, sees those same bytes. Also returns the record
    bytes by seq, for check_stamps."""
    problems = []
    rec_dir = os.path.join(d, "records")
    names = sorted(
        (int(m.group(1)), n) for n in os.listdir(rec_dir) if (m := re.fullmatch(r"(\d+)\.json", n))
    ) if os.path.isdir(rec_dir) else []
    if not names:
        return [(None, "no records")], [], [], {}
    try:
        chain = chain_lines(d)
    except Unreadable as e:
        problems.append((None, f"chain.txt: {e}"))
        chain = []
    if len(chain) != len(names):
        problems.append((None, f"chain.txt lists {len(chain)} records, records/ holds {len(names)}"))
    cenv = chain_env(d)
    signers = []
    used = {}  # permit id -> the record that cited it first
    uses = []  # (seq, permit) for every citation that checked out
    bodies = {}
    prev_hash = ZERO
    for i, (n, name) in enumerate(names, start=1):
        k = None
        path = os.path.join(rec_dir, name)
        if n != i:
            problems.append((n, f"seq: file {name} where record {i} should be (a record is missing)"))
        try:
            body = read_file(path)
        except (FileNotFoundError, Unreadable) as e:
            problems.append((n, f"record: {e if isinstance(e, Unreadable) else 'gone while being read'}"))
            prev_hash = None  # nothing can chain to a record that could not be read
            continue
        bodies[n] = body
        h = sha256_hex(body)
        # 1. the envelope: both signature halves, and the payload is exactly these bytes
        try:
            sig_bytes = read_file(path + ".sig.json")
        except FileNotFoundError:
            problems.append((n, "signature: no envelope"))
        except Unreadable as e:
            problems.append((n, f"signature: envelope {e}"))
        else:
            rc, out = verify_bytes(cli, cenv, sig_bytes, body)
            if rc != 0:
                problems.append((n, f"signature: {refusal(out)}"))
            env = parse_env(sig_bytes)
            if env.get("payloadType") != PAYLOAD_TYPE:
                problems.append((n, f"signature: payload type is {env.get('payloadType')!r}, not {PAYLOAD_TYPE}"))
            k = ed_keyid(env)
            signers.append(k)
            why = pin_problem(half_keyids(env), pin)
            if why:
                problems.append((n, f"key: {why}"))
        # 2. the record itself
        try:
            rec = json.loads(body)
        except ValueError:
            problems.append((n, "record: not JSON"))
            prev_hash = h
            continue
        if canonical(rec) != body:
            problems.append((n, "record: not canonical JSON"))
        if not isinstance(rec, dict):
            rec = {}
        if rec.get("v") != 1 or rec.get("kind") != KIND:
            problems.append((n, "record: not a tet_machine_log_v1 record"))
        if rec.get("seq") != i:
            problems.append((n, f"seq: says {rec.get('seq')}, is record {i} in order"))
        if rec.get("prev") != prev_hash:
            problems.append((n, "prev: does not name the record before it"))
        if i <= len(chain) and chain[i - 1] != h:
            problems.append((n, "chain.txt: hash differs from the record"))
        # 3. the permit it cites, if any: this device's own, still open at this seq, not cited before
        if "permit" in rec:
            pid = rec["permit"]
            why, permit = permit_problem(d, cli, pid, i, used, pin)
            if why:
                problems.append((n, why))
            else:
                uses.append((n, permit))
            if isinstance(pid, str):
                used.setdefault(pid, n)
        prev_hash = h
    if len(set(signers)) > 1:
        problems.append((None, f"key: {len(set(signers))} different keys signed this log"))
    return problems, signers, uses, bodies


def get_json(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return json.load(r)
    except (urllib.error.URLError, ValueError, OSError) as e:
        raise Fail(f"node: {url} did not answer ({e})")


def stamp_file_id(record_bytes):
    h = hashlib.sha256(record_bytes).hexdigest()[:32]
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def is_my_hash_record(d, cli, raw, log_sha, pin):
    """A registry record made elsewhere counts only if it re-verifies here: this device's key (both
    halves, against the pin), a
    hash-only envelope over exactly this log record's SHA-256, under the notebook's chain."""
    try:
        env = json.loads(raw)
        payload = base64.b64decode(env["payload"])
    except (ValueError, KeyError, TypeError):
        return False
    if pin_problem(half_keyids(env), pin):
        return False
    if env.get("payloadType") != HASH_PAYLOAD_TYPE or payload != log_sha:
        return False
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, "found.sig.json")
        with open(p, "wb") as f:
            f.write(raw)
        rc, _, _ = run_cli(cli, ["agent", "verify", "--sig", p], chain_env(d))
    return rc == 0


def check_stamps(d, node, cli, pin, bodies):
    """Every record: is it in this node's registry, and is its anchor real? The anchor is
    re-checked the way checkStamp (lib/sign_anything.ts) does. `bodies` are the record bytes
    check_chain read and checked, by seq: the folder is not read a second time."""
    node = node.rstrip("/")
    lines = []
    for seq in sorted(bodies):
        log_record = bodies[seq]
        found = get_json(f"{node}/sigs/search?file={sha256_hex(log_record)}").get("records") or []
        mine = []
        for r in found:
            try:
                raw = base64.b64decode(r.get("record_b64", ""))
            except ValueError:
                continue
            # Every registry record is re-verified here, against the pin: a copy in this folder
            # (records/<n>.hash.sig.json) is not evidence of who signed it.
            if is_my_hash_record(d, cli, raw, hashlib.sha256(log_record).digest(), pin):
                mine.append((r, raw))
        if not mine:
            lines.append(f"stamp: record {seq}: not on this node")
            continue
        r, hash_record = mine[0]
        a = r.get("anchor") or {}
        tx = str(a.get("tx_hash", "")).lower().removeprefix("0x")
        if not re.fullmatch(r"[0-9a-f]{64}", tx):
            lines.append(f"stamp: record {seq}: published, not anchored")
            continue
        row = get_json(f"{node}/explorer/tx/{tx}")
        t = (row.get("tx") or {}).get("tx") or {}
        height = int(row.get("block_height") or 0)
        if row.get("found") is not True or row.get("canonical") is False:
            lines.append(f"stamp: record {seq}: anchor not on this node's chain")
        elif t.get("kind") != "file_fee" or str(t.get("file_id", "")).lower() != stamp_file_id(hash_record):
            lines.append(f"stamp: record {seq}: anchor stamps a different file")
        elif height <= 0:
            lines.append(f"stamp: record {seq}: anchor has no block height yet")
        else:
            lines.append(f"stamp: record {seq}: existed before block {height} (this node's chain)")
    return lines


def cmd_verify(a):
    pin = read_pin(a.pin, a.dir)
    problems, signers, uses, bodies = check_chain(a.dir, tet_cli(a), pin)
    print("INVALID" if problems else "VALID")
    for seq, why in problems:
        print(f"  {'record ' + str(seq) if seq is not None else 'log'}: {why}")
    if not problems:
        print(f"  {len(signers)} records, all signed by {signers[0]}")
        for seq, permit in uses:
            print(f"  permit {permit['permit_id']} ({permit['action']}): used once, by record {seq}; open until seq {permit['expires_seq']}")
    print("Shows:")
    for s in SHOWS:
        print(f"  - {s}")
    print("Does not show:")
    for s in DOES_NOT_SHOW:
        print(f"  - {s}")
    if not problems:
        # What verify can say about the end: which record is the newest here. Nothing in the folder
        # records how long the log was, so a reader who keeps this line can compare a later copy.
        last = max(bodies)
        print(f"end: record {last} is the newest in this folder, sha256 {sha256_hex(bodies[last])}; records after it, if any, cannot be seen here")
    if a.node:
        for ln in check_stamps(a.dir, a.node, tet_cli(a), pin, bodies):
            print(ln)
    else:
        print("stamp: not checked (no node)")
    if os.path.lexists(os.path.join(a.dir, "device.key")):
        print(KEY_NOTE)
    return 1 if problems else 0


# ── export: what to hand over ─────────────────────────────────────────────────────────────────

KEY_NOTE = "note: this folder holds device.key, and whoever has a copy can sign as this device; to hand the log over, give an export (notebook.py export), which leaves it out"
# Exactly what verify reads, and nothing of the device's own (device.key, device.head, device.pin,
# device.keyid): the reader takes the pin from a copy of their own.
EXPORT_TOP = ("chain.json", "chain.txt")
EXPORT_IN = {
    "records": re.compile(r"[0-9]+\.json(\.sig\.json)?|[0-9]+\.hash\.sig\.json"),
    "permits": re.compile(r"[0-9a-f]{32}\.json(\.sig\.json)?"),
}


def cmd_export(a):
    d, out = a.dir, a.out
    if os.path.lexists(out):
        raise Fail(f"{out} exists; export writes a new folder")
    files = [n for n in EXPORT_TOP if os.path.lexists(os.path.join(d, n))]
    for sub, pat in EXPORT_IN.items():
        if os.path.isdir(os.path.join(d, sub)):
            files += [os.path.join(sub, n) for n in sorted(os.listdir(os.path.join(d, sub))) if pat.fullmatch(n)]
    if "chain.json" not in files:
        raise Fail(f"no chain.json in {d}; nothing to export")
    try:
        data = {n: read_file(os.path.join(d, n), MAX_CHAIN_TXT if n == "chain.txt" else MAX_FILE) for n in files}
    except (OSError, Unreadable) as e:
        raise Fail(f"export: {e}")
    os.makedirs(out, mode=0o700)
    for sub in EXPORT_IN:
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    for n, b in data.items():
        with open(os.path.join(out, n), "xb") as f:
            f.write(b)
    print(f"exported {len(files)} files to {out}; device.key is not among them. Give the reader the pin (device.pin) separately.")


# ── publish ───────────────────────────────────────────────────────────────────────────────────


def proof_code(record_bytes):
    bits = int.from_bytes(hashlib.sha256(record_bytes).digest()[:5], "big")
    out = "".join(CROCKFORD[(bits >> (i * 5)) & 31] for i in range(7, -1, -1))
    return f"TET-{out[:4]}-{out[4:]}"


def build_publish_body(a):
    """The hash-only record and its consent, both from `tet-cli agent sign`; returns (record, body)."""
    d, cli = a.dir, tet_cli(a)
    rec = os.path.join(d, "records", f"{a.seq}.json")
    if not os.path.exists(rec):
        raise Fail(f"no record {a.seq}")
    with open(rec, "rb") as f:
        log_record = f.read()
    hash_record_path = os.path.join(d, "records", f"{a.seq}.hash.sig.json")
    with tempfile.TemporaryDirectory() as t:
        # The record the node stores: a hash-only envelope over the log record's SHA-256.
        digest = os.path.join(t, "digest")
        with open(digest, "wb") as f:
            f.write(hashlib.sha256(log_record).digest())
        if not os.path.exists(hash_record_path):
            sign(cli, d, digest, HASH_PAYLOAD_TYPE, out=hash_record_path)
        with open(hash_record_path, "rb") as f:
            hash_record = f.read()
        # The consent: the same key over the exact SHA-256 of those record bytes.
        cdigest, consent_path = os.path.join(t, "cdigest"), os.path.join(t, "consent.sig.json")
        with open(cdigest, "wb") as f:
            f.write(hashlib.sha256(hash_record).digest())
        sign(cli, d, cdigest, CONSENT_PAYLOAD_TYPE, out=consent_path)
        with open(consent_path, "rb") as f:
            consent = f.read()
    body = {"record_b64": base64.b64encode(hash_record).decode(), "consent_b64": base64.b64encode(consent).decode()}
    return hash_record, body


def cmd_publish(a):
    hash_record, body = build_publish_body(a)
    req = urllib.request.Request(a.node.rstrip("/") + "/sigs/publish", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        try:
            why = json.load(e).get("error", f"HTTP {e.code}")
        except ValueError:
            why = f"HTTP {e.code}"
        raise Fail(f"the node refused the record: {why}")
    except (urllib.error.URLError, OSError) as e:
        raise Fail(f"the node did not answer ({e})")
    if status != 202:
        raise Fail(f"the node refused the record: HTTP {status}")
    print(f"published record {a.seq}: {proof_code(hash_record)}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--tet-cli", help="path to tet-cli (else env TET_CLI, else target/release/tet-cli)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("init")
    s.add_argument("--dir", required=True)
    s = sub.add_parser("record")
    s.add_argument("--dir", required=True)
    s.add_argument("--source", required=True, choices=["loadavg", "cpu-temp", "stdin-json"])
    s.add_argument("--permit", help="cite this one-time permit; refused if it is unknown, expired, or already cited")
    s = sub.add_parser("permit")
    s.add_argument("--dir", required=True)
    s.add_argument("--action", required=True, help="a short name for what the permit allows once")
    s.add_argument("--expires-seq", type=int, required=True, help="the last record number that may cite it")
    s = sub.add_parser("run")
    s.add_argument("--dir", required=True)
    s.add_argument("--source", required=True, choices=["loadavg", "cpu-temp", "stdin-json"])
    s.add_argument("--every", type=float, required=True)
    s.add_argument("--until", default="22:00", help="HH:MM local; the loop stops by itself (default 22:00)")
    s = sub.add_parser("verify")
    s.add_argument("--dir", required=True)
    s.add_argument("--pin", required=True, help="the device's pin file (device.pin, written by init), kept OUTSIDE --dir")
    s.add_argument("--node", help="also check published records' anchors on this node")
    s = sub.add_parser("export")
    s.add_argument("--dir", required=True)
    s.add_argument("--out", required=True, help="a new folder: the records, permits and chain, without device.key")
    s = sub.add_parser("publish")
    s.add_argument("--dir", required=True)
    s.add_argument("--seq", type=int, required=True)
    s.add_argument("--node", required=True, help="publishing is off unless a node URL is given")
    for sp in sub.choices.values():
        sp.add_argument("--tet-cli", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    if a.cmd == "run" and a.source == "stdin-json":
        p.error("run reads a source repeatedly; stdin-json is for record")
    try:
        return {"init": cmd_init, "record": cmd_record, "permit": cmd_permit, "run": cmd_run, "verify": cmd_verify, "publish": cmd_publish, "export": cmd_export}[a.cmd](a) or 0
    except Fail as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
