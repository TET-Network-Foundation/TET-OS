#!/usr/bin/env python3
"""Simulation: no robot moved. The home-permit scene, one input for the two-party sketch.

Two simulated machines, each with its own machine notebook (tools/machine-notebook/notebook.py) and its
own test key on a made-up chain:

    H  a home helper robot's notebook. It holds one one-time permit.
    N  a visiting-care tablet's notebook.

N asks H to "take the medicine box from shelf 2 and hand it over". The record R is made, checked field
by field and signed by both sides, and appended to both notebooks, all by the two-party sketch
(../two-party-v0/twoparty.py, unchanged). H's entry cites the permit. A second request citing the same
permit is refused by H's notebook. Then an outside check, with no key and no network: R, both
signatures, both exports and two pins copied out before the scene starts.

Two tampers, each on its own copy: N's side changes the summary and signs again; H's side hands over
an export cut back to before R.

Nothing here is a new signed format: the record, the signatures and the permit citation are the
sketch's and the notebook's. Nothing moves anything: the record is about an agreement, not an action.

    TET_CLI=/path/to/tet-cli python3 prep/demos/home-permit/scene.py [--out DIR]

writes DIR/scene.json (default: out/ beside this file) for page.html, and prints the same lines.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import tetcli_path  # noqa: E402

os.environ["TET_CLI"] = tetcli_path.tet_cli()  # the sketch reads TET_CLI as given; hand it the absolute path
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "two-party-v0"))
import twoparty as tp  # noqa: E402

nb = tp.nb
CHAIN = {"TET_CHAIN_ID": "tet-home-permit-sim", "TET_GENESIS_HASH": hashlib.sha256(b"home permit simulation").hexdigest()}
REQUEST = "take the medicine box from shelf 2 and hand it over"
OTHER = "take the document box from shelf 2 and hand it over"
ACTION = "hand-over.shelf-2"
EXPIRES_SEQ = 10
NAMES = {"H": "home helper robot (simulated)", "N": "visiting-care tablet (simulated)"}
FORGERY_LINE = "a conflict is not a verdict of forgery"
BANNER = "simulation: no robot moved"


class SceneError(Exception):
    pass


def notebook(*argv, stdin=None):
    r = subprocess.run([sys.executable, tp.NOTEBOOK, "--tet-cli", tp.cli()] + list(argv), input=stdin,
                       capture_output=True, text=True, env={**os.environ, **CHAIN})
    if r.returncode != 0:
        raise SceneError(f"notebook.py {argv[0]}: {r.stderr.strip()[-300:]}")
    return r.stdout


def read_pin_file(path):
    with open(path) as f:
        m = nb.PIN_RE.fullmatch(f.read())
    if not m:
        raise SceneError(f"{path} is not a pin")
    return m.group(1), m.group(2)


def named(line, letters):
    """The sketch's verdict line with party letters shown as H and N (the sketch itself prints a / b)."""
    if line.startswith("LOGS: conflict at "):
        rest = line[len("LOGS: conflict at "):]
        who, tail = rest.split(" (", 1)
        return "LOGS: conflict at " + ", ".join(letters[p] for p in who.split(", ")) + " (" + tail
    return line


class Scene:
    def __init__(self, work):
        os.environ.update(CHAIN)
        self.work = work
        self.scratch = os.path.join(work, "scratch")
        os.makedirs(self.scratch)
        self.dirs = {n: os.path.join(work, n) for n in ("H", "N")}
        self.steps = []
        for n, d in self.dirs.items():
            notebook("init", "--dir", d)
            notebook("record", "--dir", d, "--source", "stdin-json", stdin='{"value": "start", "unit": "note"}')
        # The pins the checker holds a week later, copied out now: they never come from the folders checked.
        self.pins_dir = os.path.join(work, "pins-held-outside")
        os.makedirs(self.pins_dir)
        for n, d in self.dirs.items():
            shutil.copy(os.path.join(d, "device.pin"), os.path.join(self.pins_dir, n + ".pin"))
        self.pin = {n: tp.pin_of(d) for n, d in self.dirs.items()}

    def step(self, sid, en, ja, lines, **extra):
        self.steps.append({"id": sid, "en": en, "ja": ja, "lines": list(lines), **extra})

    def letters(self, rec_bytes):
        rec = tp.decode(rec_bytes)
        return {tp.party_of(rec, self.pin[n]): n for n in ("H", "N")}

    def party(self, rec_bytes, n):
        return tp.party_of(tp.decode(rec_bytes), self.pin[n])

    # ── the story ────────────────────────────────────────────────────────────────────────────

    def give_permit(self):
        self.permit_id = notebook("permit", "--dir", self.dirs["H"], "--action", ACTION,
                                  "--expires-seq", str(EXPIRES_SEQ)).strip()
        self.step("permit", "Morning. H's notebook holds one one-time permit.",
                  "朝。H のノートに、一回だけの許可が1つ用意される。",
                  [f"permit {self.permit_id} ({ACTION}) in H's notebook"], permit="unused")

    def request(self, summary):
        """Make R, check it field by field on both sides, both sign. Returns (record, sigs, random value)."""
        value = tp.new_random_value()
        agreed = tp.agreed_of(summary.encode("utf-8"), value)  # both sides hold the request text and the value
        rec = tp.make(self.dirs["H"], self.dirs["N"], agreed, summary, (self.dirs["H"], self.permit_id))
        sigs = {}
        for me, them in (("N", "H"), ("H", "N")):
            permit = ("me" if me == "H" else "them", self.permit_id)
            sigs[self.party(rec, me)] = tp.sign(self.dirs[me], rec, self.scratch, self.pin[them], agreed, summary, permit)
        return rec, sigs

    def agree(self):
        rec, sigs = self.request(REQUEST)
        tp.append(self.dirs["H"], rec, sigs, self.pin["N"])
        tp.append(self.dirs["N"], rec, sigs, self.pin["H"])
        self.R, self.sigs = rec, sigs
        fields = tp.decode(rec)
        h, n = self.party(rec, "H"), self.party(rec, "N")
        self.step("agree", "The visit. N asks: take the medicine box from shelf 2 and hand it over. "
                  "Both check R field by field, both sign, each keeps R in its own log; H's entry cites the permit.",
                  "訪問。N が命令を出す: 「棚2の薬箱を取って渡す」。H と N が記録 R を項目ごとに確かめ、両方が署名し、"
                  "それぞれ自分のログに R を置く。H のログの項目は、その許可を1回引用する。",
                  [f"summary: {fields['summary']}",
                   f"H: record {fields[h + '.seq']} after {fields[h + '.prev'][:16]}…",
                   f"N: record {fields[n + '.seq']} after {fields[n + '.prev'][:16]}…",
                   f"agreed: {fields['agreed'][:16]}…",
                   f"permit: in H's notebook, {fields['permit.id']}",
                   "the care tablet's key signed; the home robot's key signed"],
                  permit="used by this record")
        self.step("hand", "The drawing shows the medicine box handed over. A drawing only: no robot moved, and an action is not what is checked.",
                  "絵: 薬箱が渡される様子。絵だけで、ロボットは動いていない。動作そのものは確認の対象ではない。", [])

    def second_request(self):
        """The same permit again. H's notebook writes before N's and refuses; both sides then abort."""
        rec, sigs = self.request(REQUEST)
        try:
            tp.append(self.dirs["H"], rec, sigs, self.pin["N"])
        except tp.Refused as e:
            self.refusal = str(e)
        else:
            raise SceneError("H's notebook took a second record citing the same permit")
        tp.abort(self.dirs["H"], rec)
        tp.abort(self.dirs["N"], rec)
        self.step("again", "N asks again with the same permit. H's notebook refuses.",
                  "N が同じ許可でもう一度命令を出す。H のノートは拒否する。", [self.refusal])

    # ── a week later, on another computer ────────────────────────────────────────────────────

    def handed_over(self):
        """What the checker receives: R, both signatures, both exports, and the two pins held outside."""
        box = tempfile.mkdtemp(prefix="checker-", dir=self.work)
        exports = {}
        for n, d in self.dirs.items():
            exports[n] = os.path.join(box, "export-" + n)
            notebook("export", "--dir", d, "--out", exports[n])
        pins = {n: read_pin_file(os.path.join(self.pins_dir, n + ".pin")) for n in ("H", "N")}
        return exports, pins

    def outside_check(self, record, sigs, exports, pins):
        """The sketch's own check, offline. Returns (problems, notes, the two verdict lines as the sketch
        prints them, the same with H / N for a / b)."""
        order = ("H", "N")
        problems, notes = tp.check(record, sigs, [pins[n] for n in order], nb.chain_env(exports["H"]),
                                   {i: exports[n] for i, n in enumerate(order)})
        raw = tp.verdict(problems, notes)
        letters = self.letters(record) if not any(p.startswith("record:") for p in problems) else {}
        return problems, notes, raw, tuple(named(x, letters) for x in raw)

    def permit_citations(self, export, pin):
        """How many records of this export cite the permit, from the notebook's own log check."""
        problems, _, uses, _ = nb.check_chain(export, tp.cli(), pin)
        if problems:
            return None
        return sum(1 for _, permit in uses if permit["permit_id"] == self.permit_id)

    def week_later(self):
        exports, pins = self.handed_over()
        problems, notes, raw, shown = self.outside_check(self.R, self.sigs, exports, pins)
        cited = self.permit_citations(exports["H"], pins["H"])
        self.honest = {"problems": problems, "notes": notes, "raw": raw, "shown": shown, "cited": cited}
        self.step("check", "One week later, on another computer, offline: R, both signatures, both exports and two pins "
                  "received from outside the two parties.",
                  "1週間後。別のPCで確かめる。受け取るもの: R、両方の署名、両方のログの書き出し、"
                  "そして二者の外から受け取った2つのピン。オフライン。",
                  list(shown) + [cited_line(cited)])

    def tamper_summary(self):
        """N's side changes the summary and signs the changed record again with N's key. H's signature is
        the one it gave for R."""
        rec = tp.decode(self.R)
        rec["summary"] = OTHER
        changed = tp.encode(rec)
        p = os.path.join(self.scratch, "tamper-summary.bin")
        with open(p, "wb") as f:
            f.write(changed)
        nb.sign(tp.cli(), self.dirs["N"], p, tp.PAYLOAD_TYPE, out=p + ".sig.json")
        with open(p + ".sig.json", "rb") as f:
            n_sig = f.read()
        sigs = dict(self.sigs)
        sigs[self.party(changed, "N")] = n_sig
        exports, pins = self.handed_over()
        problems, notes, raw, shown = self.outside_check(changed, sigs, exports, pins)
        self.tamper1 = {"record": changed, "sigs": sigs, "pins": pins, "exports": exports,
                        "problems": problems, "notes": notes, "raw": raw, "shown": shown}
        self.step("tamper-1", "Tamper 1: N's side changes the summary to another item and signs again.",
                  "書き換え1: N 側が要約を別の物に変えて署名し直す。", list(shown) + ["  " + as_named(x, self.letters(changed)) for x in problems])

    def tamper_drop(self):
        """H's side hands over an export cut back to before R: R and every later record are gone. N's copy
        still holds H's valid signature on R."""
        exports, pins = self.handed_over()
        cut_back(exports["H"], int(tp.decode(self.R)[self.party(self.R, "H") + ".seq"]))
        problems, notes, raw, shown = self.outside_check(self.R, self.sigs, exports, pins)
        self.tamper2 = {"problems": problems, "notes": notes, "raw": raw, "shown": shown}
        self.step("tamper-2", "Tamper 2: H's side drops the record from its log. N's copy still holds H's valid signature.",
                  "書き換え2: H 側が記録を消す → N の控えに H の有効な署名が残っている。",
                  list(shown) + ["  " + as_named(x, self.letters(self.R)) for x in problems] + [FORGERY_LINE + " / 食い違いは偽造の判定ではありません"])

    def run(self):
        self.give_permit()
        self.agree()
        self.second_request()
        self.week_later()
        self.tamper_summary()
        self.tamper_drop()
        return {"banner": BANNER, "names": NAMES, "steps": self.steps}


def cited_line(cited):
    if cited is None:
        return "the permit's citations are not counted: H's export does not check out"
    return "the permit is cited once in H's export" if cited == 1 else f"the permit is cited {cited} times in H's export"


def as_named(problem, letters):
    """A problem line with its party letter shown as H or N."""
    p, sep, rest = problem.partition(": ")
    return (letters[p] + sep + rest) if sep and p in letters else problem


def cut_back(export, seq):
    """Remove record `seq` and every later record from an export, and the same lines of chain.txt, so
    what is left is a well-formed shorter log."""
    rec_dir = os.path.join(export, "records")
    kept = 0
    for name in sorted(os.listdir(rec_dir)):
        n = int(name.split(".")[0])
        if n >= seq:
            os.remove(os.path.join(rec_dir, name))
        elif name.endswith(".json") and not name.endswith(".sig.json"):
            kept += 1
    path = os.path.join(export, "chain.txt")
    with open(path) as f:
        lines = [ln for ln in f.read().splitlines() if ln.strip()]
    with open(path, "w") as f:
        f.write("".join(ln + "\n" for ln in lines[:kept]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    a = ap.parse_args(argv)
    work = tempfile.mkdtemp(prefix="home-permit-")
    try:
        scene = Scene(work).run()
    finally:
        shutil.rmtree(work)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "scene.json"), "w") as f:
        json.dump(scene, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(BANNER)
    for s in scene["steps"]:
        print(f"[{s['id']}] {s['en']}")
        for ln in s["lines"]:
            print("    " + ln)
    return 0


if __name__ == "__main__":
    sys.exit(main())
