#!/usr/bin/env python3
"""Simulation, design sketch: not a format. One record two parties both sign, kept in both notebooks (v0.2).

A throwaway prototype for the design paper two-party-record-v0. Two machine notebooks
(tools/machine-notebook/notebook.py), each with its own key, agree on something (named here by a
SHA-256 and a short summary), sign the SAME bytes with tet-cli agent sign (Ed25519 and ML-DSA-44),
and each appends the record to its own notebook at the log position written into those bytes. A third
party holding the record, both signatures, both pins and (optionally) both exports checks it with no
key.

The pre-image is netstrings (<decimal length>:<bytes>,), in this fixed order:

    tag            tet-demo/two-party-record/v0.1
    a.ed, a.ml     party a's pin: both key ids (a is the party whose Ed25519 key id sorts lower;
                   the two parties name two different Ed25519 keys and two different ML-DSA-44 keys)
    a.seq, a.prev  the notebook record number a will write it at, and the hash of a's record before it
    b.ed, b.ml, b.seq, b.prev
    agreed         agreed_of(document, random value): SHA-256 over netstrings of AGREED_TAG, a fresh
                   32-byte random value and the document. The value is kept beside the document, not
                   in the record, so a guessable document cannot be found by hashing guesses
    summary        a short plain summary, NFC, at most 200 bytes, no control characters, single spaces
    permit.party   "", "a" or "b": whose notebook holds a cited one-time permit
    permit.id      "" or the permit id (32 hex); that party's notebook record cites it

No time, no place and no name is in the record. The record shows order inside each log, never a date.

v0.2, the signer's side (the record bytes are unchanged from v0.1):
- sign() reserves the position it signs at, in the notebook folder, for that one record. Until the
  record is appended or an abort entry is written, this sketch's sign() and append() refuse any other
  record at that position. An ordinary notebook entry or a copied folder is not stopped by it.
- sign() refuses a record whose summary, or whose permit (none, or which side holds it and its id), is
  not the one this side was given.
- append() checks after writing that the entry landed at the position the record names.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
NOTEBOOK_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "..", "tools", "machine-notebook"))
NOTEBOOK = os.path.join(NOTEBOOK_DIR, "notebook.py")
sys.path.insert(0, NOTEBOOK_DIR)
import notebook as nb  # noqa: E402

TAG = b"tet-demo/two-party-record/v0.1"
AGREED_TAG = b"tet-demo/two-party-agreed/v0.1"
RANDOM_LEN = 32
PAYLOAD_TYPE = "application/vnd.tet.demo-two-party-v0.1"
UNIT = "two-party-v0.1"
FIELDS = ("a.ed", "a.ml", "a.seq", "a.prev", "b.ed", "b.ml", "b.seq", "b.prev",
          "agreed", "summary", "permit.party", "permit.id")
MAX_FIELD = 1024
MAX_SUMMARY = 200
HEX64 = re.compile(r"[0-9a-f]{64}")
ED_RE = re.compile(r"tet-ed25519:[0-9a-f]{64}")
ML_RE = re.compile(r"tet-mldsa44:[0-9a-f]{64}")
SEQ_RE = re.compile(r"[1-9][0-9]{0,17}")
PID_RE = re.compile(r"[0-9a-f]{32}")


class Refused(Exception):
    pass


class LogConflict(str):
    """A problem found in a party's export, not in the signatures: what the export holds differs from
    what the record promised. It says nothing about who caused it (a side can be framed)."""


def sha(b):
    return hashlib.sha256(b).hexdigest()


def cli():
    return os.environ.get("TET_CLI") or "target/release/tet-cli"


# ── encoding ──────────────────────────────────────────────────────────────────────────────────


def netstring(b):
    return str(len(b)).encode() + b":" + b + b","


def encode_fields(fields):
    """Length-prefixed, so no two field lists give the same bytes, whatever the fields contain."""
    return b"".join(netstring(f.encode("utf-8")) for f in fields)


def new_random_value():
    return os.urandom(RANDOM_LEN)


def agreed_of(document, random_value):
    """The agreed hash: the document with a fresh random value, so that the hash of a guessable
    document cannot be matched by hashing guesses. Both parties keep the value beside the document."""
    if len(random_value) != RANDOM_LEN:
        raise Refused(f"agreed: the random value is {len(random_value)} bytes, not {RANDOM_LEN}")
    return sha(netstring(AGREED_TAG) + netstring(random_value) + netstring(document))


def encode(rec):
    return netstring(TAG) + encode_fields([rec[k] for k in FIELDS])


def decode_netstrings(b):
    out, i = [], 0
    while i < len(b):
        m = re.compile(rb"(0|[1-9][0-9]{0,3}):").match(b, i)
        if not m:
            raise Refused("record: not netstrings")
        n = int(m.group(1))
        if n > MAX_FIELD:
            raise Refused(f"record: a field is longer than {MAX_FIELD} bytes")
        start = m.end()
        if b[start + n:start + n + 1] != b",":
            raise Refused("record: not netstrings")
        out.append(b[start:start + n])
        i = start + n + 1
    return out


def summary_problem(s):
    if len(s.encode("utf-8")) > MAX_SUMMARY:
        return f"summary is longer than {MAX_SUMMARY} bytes"
    if unicodedata.normalize("NFC", s) != s:
        return "summary is not in Unicode NFC form"
    if any(unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp") for c in s):
        return "summary holds a control or format character"
    if any(c.isspace() and c != " " for c in s):
        return "summary holds a space other than U+0020"
    if s != s.strip(" ") or "  " in s:
        return "summary has a leading, trailing or double space"
    return None


def field_problem(rec):
    """Why these fields are not a v0 record, or None. One reason, in field order."""
    for p in ("a", "b"):
        if not ED_RE.fullmatch(rec[p + ".ed"]):
            return f"{p}.ed is not an Ed25519 key id"
        if not ML_RE.fullmatch(rec[p + ".ml"]):
            return f"{p}.ml is not an ML-DSA-44 key id"
        if not SEQ_RE.fullmatch(rec[p + ".seq"]):
            return f"{p}.seq is not a record number"
        if not HEX64.fullmatch(rec[p + ".prev"]):
            return f"{p}.prev is not a SHA-256"
    if not rec["a.ed"] < rec["b.ed"]:
        return "parties are not two keys in key-id order"
    if rec["a.ml"] == rec["b.ml"]:
        return "the two parties name the same ML-DSA-44 key"
    if not HEX64.fullmatch(rec["agreed"]):
        return "agreed is not a SHA-256"
    why = summary_problem(rec["summary"])
    if why:
        return why
    if (rec["permit.party"], rec["permit.id"]) != ("", "") and not (
        rec["permit.party"] in ("a", "b") and PID_RE.fullmatch(rec["permit.id"])
    ):
        return "permit is not empty or a party and a permit id"
    return None


def decode(b):
    """The record's fields, or Refused. Decoding is checked by encoding again: equal bytes only."""
    parts = decode_netstrings(b)
    if not parts or parts[0] != TAG:
        raise Refused("record: not a two-party v0 record")
    if len(parts) != 1 + len(FIELDS):
        raise Refused(f"record: {len(parts) - 1} fields, not {len(FIELDS)}")
    try:
        rec = dict(zip(FIELDS, (p.decode("utf-8") for p in parts[1:])))
    except UnicodeDecodeError:
        raise Refused("record: a field is not UTF-8")
    why = field_problem(rec)
    if why:
        raise Refused(f"record: {why}")
    if encode(rec) != b:
        raise Refused("record: does not encode back to the same bytes")
    return rec


# ── one side ──────────────────────────────────────────────────────────────────────────────────


def pin_of(d):
    with open(os.path.join(d, "device.pin")) as f:
        m = nb.PIN_RE.fullmatch(f.read())
    return m.group(1), m.group(2)


def next_position(d):
    seq, h = nb.read_head(d)
    return str(seq + 1), h


def make(dir1, dir2, agreed, summary, permit=None):
    """The record two notebooks would agree on now: both pins, each side's next position. permit is
    (folder holding it, permit id) or None."""
    sides = sorted([dir1, dir2], key=lambda d: pin_of(d)[0])
    rec = {}
    for p, d in zip(("a", "b"), sides):
        rec[p + ".ed"], rec[p + ".ml"] = pin_of(d)
        rec[p + ".seq"], rec[p + ".prev"] = next_position(d)
    rec["agreed"], rec["summary"] = agreed, summary
    rec["permit.party"], rec["permit.id"] = "", ""
    if permit:
        rec["permit.party"] = "a" if os.path.samefile(permit[0], sides[0]) else "b"
        rec["permit.id"] = permit[1]
    why = field_problem(rec)
    if why:
        raise Refused(f"record: {why}")
    return encode(rec)


RESERVED = "reserved"


def reservation_path(d):
    return os.path.join(d, "two-party", RESERVED)


def read_reservation(d):
    """(seq, prev, record hash) this notebook reserved, or None."""
    try:
        with open(reservation_path(d)) as f:
            seq, prev, h = f.read().split()
        return seq, prev, h
    except FileNotFoundError:
        return None


def reserve(d, seq, prev, h):
    """Reserve (seq, prev) for the record with hash h, or Refused if it is reserved for another one.
    A reservation for a position this notebook has already left is stale and is replaced."""
    os.makedirs(os.path.join(d, "two-party"), exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(reservation_path(d), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            held = read_reservation(d)
            if held == (seq, prev, h):
                return
            if held is not None and (held[0], held[1]) == (seq, prev):
                raise Refused(f"sign: record {seq} is reserved for another record")
            os.remove(reservation_path(d))
            continue
        with os.fdopen(fd, "w") as f:
            f.write(f"{seq} {prev} {h}\n")
        return
    raise Refused("sign: could not reserve the position")


def reserved_for_another(d, seq, prev, h):
    held = read_reservation(d)
    return held is not None and (held[0], held[1]) == (seq, prev) and held[2] != h


def permit_meant(me, permit):
    """The (permit.party, permit.id) this side means, from permit = None or ("me" | "them", id)."""
    if permit is None:
        return ("", "")
    who, pid = permit
    them = "b" if me == "a" else "a"
    return (me if who == "me" else them, pid)


def sign(d, record, scratch, peer_pin, agreed, summary, permit):
    """This notebook's signature (both halves) over the record's exact bytes, only if the record names
    this notebook at the position it is at now, names the counterparty this side pinned, carries the
    agreed hash this side computed, the summary this side was given and the permit this side means
    (None, or ("me" | "them", permit id)), and the position is not reserved for another record."""
    rec = decode(record)
    me = party_of(rec, pin_of(d))
    if me is None:
        raise Refused("sign: the record does not name this notebook")
    them = "b" if me == "a" else "a"
    if (rec[them + ".ed"], rec[them + ".ml"]) != tuple(peer_pin):
        raise Refused("sign: the record does not name the pinned counterparty")
    if rec["agreed"] != agreed:
        raise Refused("sign: the record does not carry the agreed hash this side computed")
    if rec["summary"] != summary:
        raise Refused("sign: the record does not carry the summary this side was given")
    if (rec["permit.party"], rec["permit.id"]) != permit_meant(me, permit):
        raise Refused("sign: the record does not name the permit this side means")
    if next_position(d) != (rec[me + ".seq"], rec[me + ".prev"]):
        raise Refused(f"sign: this notebook is not at record {rec[me + '.seq']} after the record the record names")
    reserve(d, rec[me + ".seq"], rec[me + ".prev"], sha(record))
    p = os.path.join(scratch, "record-" + sha(record)[:16] + "-" + pin_of(d)[0][12:20])
    with open(p, "wb") as f:
        f.write(record)
    nb.sign(cli(), d, p, PAYLOAD_TYPE, out=p + ".sig.json")
    with open(p + ".sig.json", "rb") as f:
        return f.read()


def party_of(rec, pin):
    for p in ("a", "b"):
        if (rec[p + ".ed"], rec[p + ".ml"]) == tuple(pin):
            return p
    return None


def signature_problem(record, env_bytes, pin, chain_env):
    """Why env_bytes is not the pinned signer's signature (both halves) over exactly record."""
    rc, out = nb.verify_bytes(cli(), chain_env, env_bytes, record, "record")
    if rc != 0:
        return f"signature: {nb.refusal(out)}"
    env = nb.parse_env(env_bytes)
    if env.get("payloadType") != PAYLOAD_TYPE:
        return f"signature: payload type is {env.get('payloadType')!r}, not {PAYLOAD_TYPE}"
    why = key_problem(nb.half_keyids(env), pin)
    return "signature: " + why if why else None


def key_problem(got, pin):
    """Why an envelope's two key ids are not the pin's, or None; one line per half, so each half has
    its own check (a valid half of another key must be refused by name)."""
    if got[0] != pin[0]:
        return f"signed by {got[0]}, not the pinned {pin[0]}"
    if got[1] != pin[1]:
        return f"its ML-DSA-44 half is signed by {got[1]}, not the pinned {pin[1]}"
    return None


def append(d, record, sigs, peer_pin):
    """Write the record into this notebook at the position it names, after checking both signatures.
    sigs maps "a"/"b" to envelope bytes. Refused, and nothing written, if this notebook moved on."""
    rec = decode(record)
    me = party_of(rec, pin_of(d))
    if me is None:
        raise Refused("append: the record does not name this notebook")
    them = "b" if me == "a" else "a"
    if (rec[them + ".ed"], rec[them + ".ml"]) != tuple(peer_pin):
        raise Refused("append: the record does not name the pinned counterparty")
    cenv = nb.chain_env(d)
    for p, pin in ((me, pin_of(d)), (them, tuple(peer_pin))):
        why = signature_problem(record, sigs[p], pin, cenv)
        if why:
            raise Refused(f"append: {p}: {why}")
    if next_position(d) != (rec[me + ".seq"], rec[me + ".prev"]):
        raise Refused(f"append: this notebook is no longer at record {rec[me + '.seq']}; the record cannot be written where it says")
    h = sha(record)
    if reserved_for_another(d, rec[me + ".seq"], rec[me + ".prev"], h):
        raise Refused(f"append: record {rec[me + '.seq']} is reserved for another record")
    out = os.path.join(d, "two-party", h)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "record.bin"), "wb") as f:
        f.write(record)
    for p in ("a", "b"):
        with open(os.path.join(out, f"sig.{p}.json"), "wb") as f:
            f.write(sigs[p])
    argv = ["record", "--dir", d, "--source", "stdin-json"]
    if rec["permit.party"] == me:
        argv += ["--permit", rec["permit.id"]]
    before_write(d)
    r = subprocess.run([sys.executable, NOTEBOOK, "--tet-cli", cli()] + argv,
                       input=json.dumps({"value": f"two-party {h}", "unit": UNIT}), capture_output=True, text=True)
    if r.returncode != 0:
        raise Refused(f"append: notebook.py record refused: {r.stderr.strip()[-200:]}")
    landed = nb.read_head(d)[0]
    if str(landed) != rec[me + ".seq"]:
        raise Refused(f"append: the record landed at record {landed}, not {rec[me + '.seq']}: another write came between")
    if read_reservation(d) == (rec[me + ".seq"], rec[me + ".prev"], h):
        os.remove(reservation_path(d))
    return h


def before_write(d):
    """Nothing; a test puts another write here to show the check after writing."""


def abort(d, record):
    """Give up a record this notebook reserved and never appended: write an abort entry at its position
    and release the reservation. A counterparty already holding this side's signature can still complete
    the record; its check then shows a conflict at this side (there is no fair exchange)."""
    rec = decode(record)
    me = party_of(rec, pin_of(d))
    if me is None:
        raise Refused("abort: the record does not name this notebook")
    h = sha(record)
    if read_reservation(d) != (rec[me + ".seq"], rec[me + ".prev"], h):
        raise Refused("abort: this notebook holds no reservation for this record")
    if next_position(d) != (rec[me + ".seq"], rec[me + ".prev"]):
        raise Refused(f"abort: this notebook is no longer at record {rec[me + '.seq']}; the abort entry cannot be written there")
    r = subprocess.run([sys.executable, NOTEBOOK, "--tet-cli", cli(), "record", "--dir", d, "--source", "stdin-json"],
                       input=json.dumps({"value": f"two-party-abort {h}", "unit": UNIT}), capture_output=True, text=True)
    if r.returncode != 0:
        raise Refused(f"abort: notebook.py record refused: {r.stderr.strip()[-200:]}")
    os.remove(reservation_path(d))


# ── third party ───────────────────────────────────────────────────────────────────────────────

SHOWS = [
    "that both pinned keys signed exactly this record, each with both halves",
    "which two keys the record names, that they are the two pins given, and that the parties name two different keys of each kind",
    "with a party's export: that this export holds the record at the named number, after the named record",
    "with a cited permit and that party's export: that this export cites the permit once, from that record",
]
DOES_NOT_SHOW = [
    "that what was agreed is true, or what the agreed document says (only its hash is here)",
    "that either side still holds the agreed document and its random value, or that anyone received them; without the value nobody can open the agreed hash in a dispute",
    "that the random value was fresh: nothing enforces it, and one document and value used for two deals link their records",
    "when anything happened: the record shows order inside each log, never a date",
    "who signed before the other, that either side received the other's signature, or that both logged it at about the same time",
    "which person or organisation holds a key, that a key was not copied, or that a person and not software decided to sign",
    "with one signature: only that one key signed; it is not a deal, and it does not show that the other side saw it",
    "without a party's export: that it kept its copy",
    "that a party keeps only one log: its key holder can copy the folder and write another record at the same number",
    "who caused two records at one number: there is no fair exchange, so a side that held back its signature can complete an old record later",
    "that a key signed only one record per number: the reservation binds this sketch's sign() and append(), not the key; a signature made with another tool, an ordinary notebook entry or a copied folder can still take the number",
    "that a log was not cut back or rewritten after the last position a counterparty holds; before it, only if the counterparty brings its record",
    "that anyone but the device allowed anything: the permit is signed by the same key that cites it, and its terms are not in the record",
    "that a permit was not used in another notebook: once is once per notebook",
    "privacy of the rest of the log: an export holds the whole log, and the same two key ids link every record of one pair",
    "that the summary looks like what it says: control and format characters are refused, but look-alike letters and other invisible fillers pass",
    "that the summary holds no name: the tool cannot tell",
    "anything against a quantum forger for a checker whose pins came over a channel such a forger can fake",
    "that the format is final: this is a design sketch in review",
]


def log_problems(p, rec, h, export, pin):
    problems, _, _, bodies = nb.check_chain(export, cli(), tuple(pin))
    if problems:
        seq, why = problems[0]
        return [LogConflict(f"{p}: log: {'record ' + str(seq) if seq is not None else 'log'}: {why}")]
    seq = int(rec[p + ".seq"])
    if seq not in bodies:
        return [LogConflict(f"{p}: log ends at record {max(bodies)}, before record {seq}")]
    entry = json.loads(bodies[seq])
    if entry.get("prev") != rec[p + ".prev"]:
        return [LogConflict(f"{p}: record {seq} follows {entry.get('prev')[:16]}, not the {rec[p + '.prev'][:16]} the record names")]
    if entry.get("reading", {}).get("value") != f"two-party {h}" or entry["reading"].get("unit") != UNIT:
        return [LogConflict(f"{p}: record {seq} is not this record")]
    if rec["permit.party"] == p and entry.get("permit") != rec["permit.id"]:
        return [LogConflict(f"{p}: record {seq} does not cite permit {rec['permit.id']}")]
    return []


def check(record, sigs, pins, chain_env, exports=None):
    """(problems, notes). pins: the two pins given from outside; exports: {pin index: folder}."""
    exports = exports or {}
    try:
        rec = decode(record)
    except Refused as e:
        return [str(e)], []
    h = sha(record)
    parties = []
    for i, pin in enumerate(pins):
        p = party_of(rec, pin)
        if p is None:
            return [f"record: does not name the pinned party {pin[0]}"], []
        parties.append(p)
    if parties[0] == parties[1]:
        return ["record: the two pins are the same party"], []
    problems, notes = [], []
    for i, p in enumerate(parties):
        why = signature_problem(record, sigs.get(p, b""), pins[i], chain_env) if sigs.get(p) else "signature: missing"
        if why:
            problems.append(f"{p}: {why}")
    for i, p in enumerate(parties):
        if i in exports:
            problems += log_problems(p, rec, h, exports[i], pins[i])
        else:
            notes.append(f"{p}: no export, so nothing here shows that {p} kept this record")
    return problems, notes


def verdict(problems, notes):
    """Two lines: the signatures, and what the exports say about the logs. A log conflict is not an
    invalid signature, and says nothing about who caused it."""
    sig = [x for x in problems if not isinstance(x, LogConflict)]
    logs = [x for x in problems if isinstance(x, LogConflict)]
    sig_line = "SIGNATURES: invalid" if sig else "SIGNATURES: valid"
    if logs:
        second = "LOGS: conflict at " + ", ".join(sorted({x.split(":")[0] for x in logs})) + " (cause not shown)"
    elif sig:
        second = "LOGS: not checked"
    elif notes:
        second = "LOGS: as promised where an export was given; no export for " + ", ".join(
            sorted({x.split(":")[0] for x in notes}))
    else:
        second = "LOGS: as promised"
    return sig_line, second


def report(problems, notes):
    for ln in verdict(problems, notes):
        print(ln)
    for ln in problems + notes:
        print("  " + ln)
    print("Shows:")
    for s in SHOWS:
        print("  - " + s)
    print("Does not show:")
    for s in DOES_NOT_SHOW:
        print("  - " + s)
