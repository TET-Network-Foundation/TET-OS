#!/usr/bin/env python3
"""Sample records for the two-party sketch, and a one-command check of one sample folder.

Simulation, design sketch: not a format. Throwaway test keys, made-up content, a made-up chain.

    python3 samples.py make <dir>         write a sample set: three honest records and six broken ones
    python3 samples.py check <folder>     check one sample folder; exit 0 only when there is no problem
    python3 samples.py check-all <dir>    check every folder against its WHAT.txt; exit 1 on any DIFFERS

`check` is a thin door to twoparty.check() and twoparty.report(): it reads a folder and prints what
they print, wording unchanged. There is no check logic in this file.

A sample folder holds what a third party needs, and no private key:

    record.bin            the record's exact bytes
    sig-a.json, sig-b.json  each party's envelope (Ed25519 and ML-DSA-44 halves), by party letter
    pin-1.txt, pin-2.txt  the two pins (both key ids of each party), as handed over outside the folder
    chain.json            the made-up chain every envelope is bound to
    export-1/, export-2/  each party's notebook export (notebook.py export: device.key is never in it)
    WHAT.txt              line 1: what was done to it; then the exact lines check must print before
                          "Shows:"

`make` writes the expected lines of WHAT.txt from what was done to the sample, never by running the
check. Keys, hashes and permit ids are new in every run; the folder names, the WHAT.txt first lines and
the verdict lines repeat.
"""

import argparse
import contextlib
import datetime as dt
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import twoparty as tp  # noqa: E402

nb = tp.nb
CHAIN = {"TET_CHAIN_ID": "tet-two-party-samples",
         "TET_GENESIS_HASH": hashlib.sha256(b"two-party samples, a made-up chain").hexdigest()}
FILES = {"record.bin", "sig-a.json", "sig-b.json", "pin-1.txt", "pin-2.txt", "chain.json", "WHAT.txt"}
EXPORTS = ("export-1", "export-2")
# tet-cli agent verify's own words when one half is bad and the other is valid, and when the record's
# bytes are not the ones signed (the first FAIL line it prints).
ED_REFUSAL = "ed25519 signature verification failed: Ed25519Failed"
ML_REFUSAL = "ml-dsa-44 signature verification failed: invalid ml-dsa signature"
BYTES_REFUSAL = "record is not the {n} bytes this envelope signed"


# ── check ─────────────────────────────────────────────────────────────────────────────────────


def read_folder(folder):
    """(record, sigs, pins, chain_env, exports) from a sample folder."""
    with open(os.path.join(folder, "record.bin"), "rb") as f:
        record = f.read()
    sigs = {}
    for p in ("a", "b"):
        path = os.path.join(folder, f"sig-{p}.json")
        if os.path.exists(path):
            with open(path, "rb") as f:
                sigs[p] = f.read()
    pins = []
    for i in (1, 2):
        pins.append(nb.read_pin(os.path.join(folder, f"pin-{i}.txt")))
    exports = {i: os.path.join(folder, n) for i, n in enumerate(EXPORTS) if os.path.isdir(os.path.join(folder, n))}
    return record, sigs, pins, nb.chain_env(folder), exports


def check_folder(folder):
    """(exit code, printed text): twoparty.check() over the folder, printed by twoparty.report()."""
    record, sigs, pins, cenv, exports = read_folder(folder)
    problems, notes = tp.check(record, sigs, pins, cenv, exports)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        tp.report(problems, notes)
    return (0 if not problems else 1), out.getvalue()


def before_shows(text):
    lines = text.splitlines()
    return lines[:lines.index("Shows:")] if "Shows:" in lines else lines


def cmd_check(folder):
    rc, text = check_folder(folder)
    sys.stdout.write(text)
    return rc


def cmd_check_all(d):
    names = sorted(n for n in os.listdir(d) if os.path.isfile(os.path.join(d, n, "WHAT.txt")))
    if not names:
        print(f"no sample folders in {d}")
        return 1
    differs = 0
    for n in names:
        with open(os.path.join(d, n, "WHAT.txt"), encoding="utf-8") as f:
            expected = f.read().splitlines()[1:]
        got = before_shows(check_folder(os.path.join(d, n))[1])
        same = got == expected
        differs += not same
        print(f"{n}: expected {' / '.join(expected[:2])}; got {' / '.join(got[:2])}; {'MATCH' if same else 'DIFFERS'}")
    return 1 if differs else 0


# ── make ──────────────────────────────────────────────────────────────────────────────────────


def notebook(*argv, stdin=None):
    r = subprocess.run([sys.executable, tp.NOTEBOOK, "--tet-cli", tp.cli()] + list(argv), input=stdin,
                       capture_output=True, text=True, env={**os.environ, **CHAIN})
    if r.returncode != 0:
        raise SystemExit(f"notebook.py {argv[0]} failed: {r.stderr.strip()[-300:]}")
    return r.stdout.strip()


def raw_signature(d, record, scratch):
    """The key holder's own signature over any bytes, made with tet-cli directly. sign() would refuse
    the records this is used for; the key holder does not need sign()."""
    p = os.path.join(scratch, "raw-" + tp.sha(record)[:16] + "-" + tp.pin_of(d)[0][12:20])
    with open(p, "wb") as f:
        f.write(record)
    nb.sign(tp.cli(), d, p, tp.PAYLOAD_TYPE, out=p + ".sig.json")
    with open(p + ".sig.json", "rb") as f:
        return f.read()


def hand_entry(d, record, permit=None):
    """The key holder writes a notebook entry for the record by hand, with tet-cli, at the notebook's
    next number: what append() would write, without append()'s checks or notebook.py's permit check."""
    chain = nb.chain_lines(d)
    seq = len(chain) + 1
    entry = {"v": 1, "kind": nb.KIND, "seq": seq, "prev": chain[-1] if chain else nb.ZERO,
             "reading": {"value": f"two-party {tp.sha(record)}", "unit": tp.UNIT},
             "clock_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")}
    if permit:
        entry["permit"] = permit
    body = nb.canonical(entry)
    path = os.path.join(d, "records", f"{seq}.json")
    with open(path, "xb") as f:
        f.write(body)
    nb.write_head(d, seq, tp.sha(body))
    nb.sign(tp.cli(), d, path, nb.PAYLOAD_TYPE)
    with open(os.path.join(d, "chain.txt"), "a") as f:
        f.write(tp.sha(body) + "\n")
    return seq


def swap_half(env_bytes, other_bytes, prefix):
    """env with its `prefix` half replaced by the same key's VALID half from other (another record)."""
    env, oenv = json.loads(env_bytes), json.loads(other_bytes)
    i = next(i for i, s in enumerate(env["signatures"]) if s["keyid"].startswith(prefix))
    j = next(j for j, s in enumerate(oenv["signatures"]) if s["keyid"].startswith(prefix))
    if env["signatures"][i]["keyid"] != oenv["signatures"][j]["keyid"]:
        raise SystemExit("swap_half: the two envelopes are not by the same key")
    env["signatures"][i] = oenv["signatures"][j]
    return json.dumps(env).encode()


def verdict_lines(sig_problems=(), log_problems=(), notes=()):
    """The lines report() prints before "Shows:" for these problems, written from what was done to the
    sample (the same two-line wording as twoparty.verdict, typed out here, not called)."""
    if log_problems:
        second = "LOGS: conflict at " + ", ".join(sorted({x.split(":")[0] for x in log_problems})) + " (cause not shown)"
    elif sig_problems:
        second = "LOGS: not checked"
    else:
        second = "LOGS: as promised"  # every sample here without a problem has both exports
    first = "SIGNATURES: invalid" if sig_problems else "SIGNATURES: valid"
    return [first, second] + ["  " + x for x in list(sig_problems) + list(log_problems) + list(notes)]


class Maker:
    def __init__(self, out):
        self.out = out
        self.t = tempfile.mkdtemp(prefix="two-party-samples-")
        self.scratch = os.path.join(self.t, "scratch")
        os.makedirs(self.scratch)
        os.environ.update(CHAIN)
        self.A = self.new_notebook("A")
        self.B = self.new_notebook("B")
        self.counter = 0

    def new_notebook(self, n):
        d = os.path.join(self.t, n)
        notebook("init", "--dir", d)
        notebook("record", "--dir", d, "--source", "stdin-json", stdin='{"value": "start", "unit": "note"}')
        return d

    def fork(self, name):
        """A copy of both notebooks, so a broken log never reaches the honest samples' exports."""
        a, b = os.path.join(self.t, name + "-A"), os.path.join(self.t, name + "-B")
        shutil.copytree(self.A, a)
        shutil.copytree(self.B, b)
        return a, b

    def agreed(self):
        self.counter += 1
        doc = f"made-up sample document {self.counter}".encode()
        return tp.agreed_of(doc, tp.new_random_value())

    def signed(self, A, B, summary, permit=None):
        """Both sides sign through twoparty.sign(); permit is (folder holding it, id) or None."""
        agreed = self.agreed()
        rec = tp.make(A, B, agreed, summary, permit)
        r = tp.decode(rec)
        sigs = {}
        for d, other in ((A, B), (B, A)):
            meant = None if permit is None else ("me" if os.path.samefile(permit[0], d) else "them", permit[1])
            sigs[tp.party_of(r, tp.pin_of(d))] = tp.sign(d, rec, self.scratch, tp.pin_of(other), agreed, summary, meant)
        return rec, sigs

    def letter(self, rec, d):
        return tp.party_of(tp.decode(rec), tp.pin_of(d))

    def export(self, d):
        out = os.path.join(self.t, f"export-{len(os.listdir(self.t))}")
        notebook("export", "--dir", d, "--out", out)
        return out

    def write(self, name, what, rec, sigs, pins_from, exports, expected):
        f = os.path.join(self.out, name)
        os.makedirs(f)
        with open(os.path.join(f, "record.bin"), "wb") as o:
            o.write(rec)
        for p, b in sigs.items():
            with open(os.path.join(f, f"sig-{p}.json"), "wb") as o:
                o.write(b)
        for i, d in enumerate(pins_from, start=1):
            shutil.copyfile(os.path.join(d, "device.pin"), os.path.join(f, f"pin-{i}.txt"))
        shutil.copyfile(os.path.join(self.A, "chain.json"), os.path.join(f, "chain.json"))
        for n, e in zip(EXPORTS, exports):
            if e:
                shutil.copytree(e, os.path.join(f, n))
        with open(os.path.join(f, "WHAT.txt"), "w", encoding="utf-8") as o:
            o.write(what + "\n" + "\n".join(expected) + "\n")

    def run(self):
        A, B = self.A, self.B
        honest = []
        rec, sigs = self.signed(A, B, "sample: box 7 handed over")
        tp.append(A, rec, sigs, tp.pin_of(B))
        tp.append(B, rec, sigs, tp.pin_of(A))
        honest.append(("honest-1", "honest: both sides signed and logged it", rec, sigs))

        pid = notebook("permit", "--dir", A, "--action", "hand-over", "--expires-seq", "20")
        rec, sigs = self.signed(A, B, "sample: box 8 handed over under a one-time permit", permit=(A, pid))
        tp.append(A, rec, sigs, tp.pin_of(B))
        tp.append(B, rec, sigs, tp.pin_of(A))
        permit_seq = int(tp.decode(rec)[self.letter(rec, A) + ".seq"])
        honest.append(("honest-2-permit", "honest: both sides signed and logged it; it cites a one-time permit held by the side whose pin is pin-1.txt", rec, sigs))

        rec, sigs = self.signed(A, B, "sample: box 9 handed over")
        tp.append(A, rec, sigs, tp.pin_of(B))
        tp.append(B, rec, sigs, tp.pin_of(A))
        honest.append(("honest-3", "honest: both sides signed and logged it", rec, sigs))
        third, third_sigs = rec, sigs

        exp = (self.export(A), self.export(B))
        for name, what, rec, sigs in honest:
            self.write(name, what, rec, sigs, (A, B), exp, verdict_lines())

        # (a), (b): one half of the side at pin-1.txt replaced by that key's valid half over another record.
        other = tp.make(A, B, self.agreed(), "sample: another record")
        other_sig = raw_signature(A, other, self.scratch)
        pa = self.letter(third, A)
        sigs_a = dict(third_sigs)
        sigs_a[pa] = swap_half(sigs_a[pa], other_sig, nb.ED)
        self.write("broken-a-ed25519-half",
                   "broken: the Ed25519 half of the signature by the side at pin-1.txt is that key's valid Ed25519 half over another record",
                   third, sigs_a, (A, B), exp, verdict_lines([f"{pa}: signature: {ED_REFUSAL}"]))
        sigs_b = dict(third_sigs)
        sigs_b[pa] = swap_half(sigs_b[pa], other_sig, nb.ML)
        self.write("broken-b-ml-dsa-half",
                   "broken: the ML-DSA-44 half of the signature by the side at pin-1.txt is that key's valid ML-DSA-44 half over another record",
                   third, sigs_b, (A, B), exp, verdict_lines([f"{pa}: signature: {ML_REFUSAL}"]))

        # (c): the summary changed after both signed. No exports: with them the logs would also say the
        # record is not the one logged, which is the same change seen twice, not a log conflict.
        r = tp.decode(third)
        r["summary"] = "sample: box 6 handed over"  # same length: the bytes differ, not their count
        changed = tp.encode(r)
        sig_lines = [f"{self.letter(third, d)}: signature: " + BYTES_REFUSAL.format(n=len(third)) for d in (A, B)]
        notes = [f"{p}: no export, so nothing here shows that {p} kept this record" for p in (self.letter(third, A), self.letter(third, B))]
        self.write("broken-c-summary-changed",
                   "broken: the summary was changed after both sides signed; no exports are given (see README)",
                   changed, third_sigs, (A, B), (None, None), verdict_lines(sig_lines, (), notes))

        # (d): a second record citing the permit honest-2-permit already used. Both sides sign it through
        # sign(); notebook.py refuses the second use, so the permit holder writes its entry by hand.
        dA, dB = self.fork("d")
        rec, sigs = self.signed(dA, dB, "sample: box 10 handed over under the same permit", permit=(dA, pid))
        tp.append(dB, rec, sigs, tp.pin_of(dA))
        seq = hand_entry(dA, rec, permit=pid)
        p = self.letter(rec, dA)
        self.write("broken-d-permit-used-twice",
                   "broken: the side at pin-1.txt logged a second record citing the one-time permit its export already shows used",
                   rec, sigs, (dA, dB), (self.export(dA), self.export(dB)),
                   verdict_lines((), [f"{p}: log: record {seq}: permit: {pid} was already used by record {permit_seq}"]))

        # (e): the record names, for the side at pin-1.txt, a number one past its next one. That side
        # signs with tet-cli directly (sign() refuses it) and writes the entry by hand at its real next number.
        eA, eB = self.fork("e")
        rec0 = tp.make(eA, eB, self.agreed(), "sample: box 11 handed over")
        r = tp.decode(rec0)
        p = self.letter(rec0, eA)
        r[p + ".seq"] = str(int(r[p + ".seq"]) + 1)
        rec = tp.encode(r)
        q = "b" if p == "a" else "a"
        sigs = {p: raw_signature(eA, rec, self.scratch),
                q: tp.sign(eB, rec, self.scratch, tp.pin_of(eA), r["agreed"], r["summary"], None)}
        tp.append(eB, rec, sigs, tp.pin_of(eA))
        landed = hand_entry(eA, rec)
        self.write("broken-e-number-skipped",
                   "broken: the record names, for the side at pin-1.txt, a record number one past the next one in its export",
                   rec, sigs, (eA, eB), (self.export(eA), self.export(eB)),
                   verdict_lines((), [f"{p}: log ends at record {landed}, before record {landed + 1}"]))

        # (f): one key named for both parties. make() refuses it, so the fields are encoded by hand; the
        # one key signs it with tet-cli directly, and both pins are that key's.
        r = tp.decode(tp.make(A, B, self.agreed(), "sample: box 12 handed over"))
        mine = "a" if r["a.ed"] == tp.pin_of(A)[0] else "b"
        for k in ("ed", "ml", "seq", "prev"):
            r[("b" if mine == "a" else "a") + "." + k] = r[mine + "." + k]
        rec = tp.encode(r)
        s = raw_signature(A, rec, self.scratch)
        self.write("broken-f-one-key-both-parties",
                   "broken: the record names the same key for both parties, and both pins are that key's",
                   rec, {"a": s, "b": s}, (A, A), (self.export(A), self.export(A)),
                   verdict_lines(["record: parties are not two keys in key-id order"]))

    def close(self):
        shutil.rmtree(self.t)


def cmd_make(out):
    if os.path.lexists(out):
        print(f"{out} exists; make writes a new folder")
        return 2
    os.makedirs(out)
    m = Maker(out)
    try:
        m.run()
    finally:
        m.close()
    print(f"wrote {len(os.listdir(out))} sample folders to {out}; no private key is among them")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c, h in (("make", "dir"), ("check", "folder"), ("check-all", "dir")):
        sub.add_parser(c).add_argument(h)
    a = ap.parse_args(argv)
    if a.cmd == "make":
        return cmd_make(a.dir)
    if a.cmd == "check":
        return cmd_check(a.folder)
    return cmd_check_all(a.dir)


if __name__ == "__main__":
    sys.exit(main())
