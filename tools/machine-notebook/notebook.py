#!/usr/bin/env python3
"""Machine notebook v1: a device keeps its own signed, chained log of readings, and can sign
one-time permits that a record may cite. Prototype.

    python3 notebook.py init    --dir DIR
    python3 notebook.py record  --dir DIR --source loadavg|cpu-temp|stdin-json [--permit PERMIT_ID]
    python3 notebook.py permit  --dir DIR --action NAME --expires-seq N
    python3 notebook.py run     --dir DIR --source ... --every SECONDS [--until HH:MM]
    python3 notebook.py verify  --dir DIR [--node URL]
    python3 notebook.py publish --dir DIR --seq N --node URL

No new cryptography: every signature is `tet-cli agent sign` (the agent envelope in
docs/AGENT_IDENTITY.md) and every check is `tet-cli agent verify`. The device phrase reaches tet-cli
only through the TET_MNEMONIC environment variable, never as an argument (an argument is visible to
every process via `ps`). Stdlib only.

Layout of DIR:
  device.key              the device's own 12-word phrase, mode 0600. Never the owner's.
  device.keyid            its public key id (tet-ed25519:<hex>)
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
import datetime as dt
import glob
import hashlib
import json
import os
import re
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
    "that each record existed before the next one in the same chain",
    "that a permit limits how often this key's log accepts an action: no permit is cited twice, or after it expires",
]
DOES_NOT_SHOW = [
    "that the reading is true",
    "that the device clock was right",
    "where the device was",
    "who operates the device",
    "that the key was not copied",
    "that a permit was used only here: it does not stop a copied key from writing a second log",
]


class Fail(Exception):
    pass


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def tet_cli(args):
    return args.tet_cli or os.environ.get("TET_CLI") or "target/release/tet-cli"


def chain_env(d):
    """The chain binding from chain.json, so signing and verifying always use the same one."""
    try:
        with open(os.path.join(d, "chain.json")) as f:
            c = json.load(f)
        return {"TET_CHAIN_ID": c["chain_id"], "TET_GENESIS_HASH": c["genesis_hash"]}
    except (OSError, ValueError, KeyError):
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
        raise Fail(f"tet-cli not found at {cli} (build it: cargo build -p tet-cli --release, or pass --tet-cli)")
    return p.returncode, p.stdout, p.stderr


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
    os.makedirs(os.path.join(d, "records"), exist_ok=True)
    print(keyid)


# ── permits ───────────────────────────────────────────────────────────────────────────────────


def device_keyid(d):
    p = os.path.join(d, "device.keyid")
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return f.read().strip()


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
    record that already cited it; `device` is the key id this log belongs to. Returns (reason, permit).

    One reason per citation, in this order, so each has exactly one check that can give it: the permit
    is in the notebook; its envelope verifies over exactly these bytes (tet-cli agent verify); this
    device's key signed it; it is a permit, and the one the record names; it is still open at this
    seq; nothing cited it before."""
    if not isinstance(pid, str) or not re.fullmatch(r"[0-9a-f]{32}", pid):
        return "permit: not a permit id (32 hex)", None
    path = os.path.join(d, "permits", f"{pid}.json")
    sig = path + ".sig.json"
    if not os.path.exists(path) or not os.path.exists(sig):
        return f"permit: {pid} is not in this notebook", None
    rc, out, _ = run_cli(cli, ["agent", "verify", "--sig", sig, "--payload", path], chain_env(d))
    if rc != 0:
        plain = re.sub(r"\x1b\[[0-9;]*m", "", out)
        why = next((ln.split(":", 1)[1].strip() for ln in plain.splitlines() if ln.startswith("FAIL")), "tet-cli agent verify refused it")
        return f"permit: {pid}: signature: {why}", None
    # Only after tet-cli accepted the envelope: it has checked that each keyid names the key that signed.
    with open(sig) as f:
        env = json.load(f)
    if env.get("payloadType") != PERMIT_PAYLOAD_TYPE:
        return f"permit: {pid}: payload type is {env.get('payloadType')!r}, not {PERMIT_PAYLOAD_TYPE}", None
    signer = ed_keyid(env)
    if device is None or signer != device:
        return f"permit: {pid} is signed by {signer}, not this device's {device}", None
    with open(path, "rb") as f:
        body = f.read()
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
            with open(os.path.join(rec_dir, f"{seq}.json"), "rb") as f:
                pid = json.loads(f.read()).get("permit")
        except (ValueError, AttributeError):
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
        try:
            r = json.loads(sys.stdin.read())
        except ValueError:
            raise Fail('stdin-json wants one JSON object: {"value": ..., "unit": "..."}')
        # Exactly these two keys, so nothing else (a name, a place) can ride along into the record.
        if not isinstance(r, dict) or set(r) != {"value", "unit"} or not isinstance(r["unit"], str):
            raise Fail('stdin-json wants exactly {"value": <number|string|bool>, "unit": "<string>"}')
        if not isinstance(r["value"], (int, float, str, bool)):
            raise Fail("stdin-json value must be a number, string or bool")
        return {"source": "stdin-json", "value": r["value"], "unit": r["unit"]}
    raise Fail(f"unknown source {source}")


def chain_lines(d):
    p = os.path.join(d, "chain.txt")
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return [ln.strip() for ln in f if ln.strip()]


def record_once(a):
    d = a.dir
    if not os.path.exists(os.path.join(d, "device.key")):
        raise Fail(f"no device key in {d}; run init before this")
    chain = chain_lines(d)
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
        why, _ = permit_problem(d, tet_cli(a), pid, seq, cited_permits(d), device_keyid(d))
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
    print(f"seq {seq}: {record['reading']['value']} {record['reading']['unit']}" + (f" (permit {pid})" if pid else ""))


def cmd_record(a):
    record_once(a)


def cmd_run(a):
    hh, mm = (int(x) for x in a.until.split(":"))
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


def check_chain(d, cli):
    """Every problem found, as (seq or None, reason). Empty means the log checks out."""
    problems = []
    rec_dir = os.path.join(d, "records")
    names = sorted(
        (int(m.group(1)), n) for n in os.listdir(rec_dir) if (m := re.fullmatch(r"(\d+)\.json", n))
    ) if os.path.isdir(rec_dir) else []
    if not names:
        return [(None, "no records")], [], []
    chain = chain_lines(d)
    if len(chain) != len(names):
        problems.append((None, f"chain.txt lists {len(chain)} records, records/ holds {len(names)}"))
    want_keyid = None
    kp = os.path.join(d, "device.keyid")
    if os.path.exists(kp):
        with open(kp) as f:
            want_keyid = f.read().strip()
    signers = []
    used = {}  # permit id -> the record that cited it first
    uses = []  # (seq, permit) for every citation that checked out
    prev_hash = ZERO
    for i, (n, name) in enumerate(names, start=1):
        k = None
        path = os.path.join(rec_dir, name)
        with open(path, "rb") as f:
            body = f.read()
        h = sha256_hex(body)
        if n != i:
            problems.append((n, f"seq: file {name} where record {i} should be (a record is missing)"))
        # 1. the envelope: both signature halves, and the payload is exactly this file
        sig = path + ".sig.json"
        if not os.path.exists(sig):
            problems.append((n, "signature: no envelope"))
        else:
            rc, out, _ = run_cli(cli, ["agent", "verify", "--sig", sig, "--payload", path], chain_env(d))
            if rc != 0:
                plain = re.sub(r"\x1b\[[0-9;]*m", "", out)
                why = next((ln.split(":", 1)[1].strip() for ln in plain.splitlines() if ln.startswith("FAIL")), "tet-cli agent verify refused it")
                problems.append((n, f"signature: {why}"))
            try:
                with open(sig) as f:
                    env = json.load(f)
            except ValueError:
                env = {}
            if env.get("payloadType") != PAYLOAD_TYPE:
                problems.append((n, f"signature: payload type is {env.get('payloadType')!r}, not {PAYLOAD_TYPE}"))
            k = ed_keyid(env)
            signers.append(k)
            if want_keyid and k != want_keyid:
                problems.append((n, f"key: signed by {k}, not this device's {want_keyid}"))
        # 2. the record itself
        try:
            rec = json.loads(body)
        except ValueError:
            problems.append((n, "record: not JSON"))
            prev_hash = h
            continue
        if canonical(rec) != body:
            problems.append((n, "record: not canonical JSON"))
        if rec.get("v") != 1 or rec.get("kind") != KIND:
            problems.append((n, "record: not a tet_machine_log_v1 record"))
        if rec.get("seq") != i:
            problems.append((n, f"seq: says {rec.get('seq')}, is record {i} in order"))
        if rec.get("prev") != prev_hash:
            problems.append((n, "prev: does not name the record before it"))
        if i <= len(chain) and chain[i - 1] != h:
            problems.append((n, "chain.txt: hash differs from the record"))
        # 3. the permit it cites, if any: this device's own, still open at this seq, not cited before
        if isinstance(rec, dict) and "permit" in rec:
            pid = rec["permit"]
            why, permit = permit_problem(d, cli, pid, i, used, want_keyid or k)
            if why:
                problems.append((n, why))
            else:
                uses.append((n, permit))
            if isinstance(pid, str):
                used.setdefault(pid, n)
        prev_hash = h
    if len(set(signers)) > 1:
        problems.append((None, f"key: {len(set(signers))} different keys signed this log"))
    return problems, signers, uses


def get_json(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return json.load(r)
    except (urllib.error.URLError, ValueError, OSError) as e:
        raise Fail(f"node: {url} did not answer ({e})")


def stamp_file_id(record_bytes):
    h = hashlib.sha256(record_bytes).hexdigest()[:32]
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def is_my_hash_record(d, cli, raw, log_sha):
    """A registry record made elsewhere counts only if it re-verifies here: this device's key, a
    hash-only envelope over exactly this log record's SHA-256, under the notebook's chain."""
    try:
        env = json.loads(raw)
        signer = env["tet"]["agent_ed25519_pubkey_hex"]
        payload = base64.b64decode(env["payload"])
    except (ValueError, KeyError, TypeError):
        return False
    kp = os.path.join(d, "device.keyid")
    if not os.path.exists(kp):
        return False
    with open(kp) as f:
        if f.read().strip() != f"tet-ed25519:{signer}":
            return False
    if env.get("payloadType") != HASH_PAYLOAD_TYPE or payload != log_sha:
        return False
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, "found.sig.json")
        with open(p, "wb") as f:
            f.write(raw)
        rc, _, _ = run_cli(cli, ["agent", "verify", "--sig", p], chain_env(d))
    return rc == 0


def check_stamps(d, node, cli):
    """Every record: is it in this node's registry, and is its anchor real? The anchor is
    re-checked the way checkStamp (lib/sign_anything.ts) does."""
    node = node.rstrip("/")
    lines = []
    rec_dir = os.path.join(d, "records")
    seqs = sorted(int(m.group(1)) for n in os.listdir(rec_dir) if (m := re.fullmatch(r"(\d+)\.json", n)))
    for seq in seqs:
        with open(os.path.join(rec_dir, f"{seq}.json"), "rb") as f:
            log_record = f.read()
        hp = os.path.join(rec_dir, f"{seq}.hash.sig.json")
        local = None
        if os.path.exists(hp):
            with open(hp, "rb") as f:
                local = f.read()
        found = get_json(f"{node}/sigs/search?file={sha256_hex(log_record)}").get("records") or []
        mine = []
        for r in found:
            try:
                raw = base64.b64decode(r.get("record_b64", ""))
            except ValueError:
                continue
            if raw == local or (local is None and is_my_hash_record(d, cli, raw, hashlib.sha256(log_record).digest())):
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
    problems, signers, uses = check_chain(a.dir, tet_cli(a))
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
    if a.node:
        for ln in check_stamps(a.dir, a.node, tet_cli(a)):
            print(ln)
    else:
        print("stamp: not checked (no node)")
    return 1 if problems else 0


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
    s.add_argument("--node", help="also check published records' anchors on this node")
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
        return {"init": cmd_init, "record": cmd_record, "permit": cmd_permit, "run": cmd_run, "verify": cmd_verify, "publish": cmd_publish}[a.cmd](a) or 0
    except Fail as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
