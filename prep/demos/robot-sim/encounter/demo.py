#!/usr/bin/env python3
"""The encounter demo: fly both aircraft, exchange and record, then check every case, and write what
the page draws (data.js beside page.html). Every verdict in a case on the page is one this script got
from encounter.check_log / encounter.compare on a checker's copy without a key; the two in-the-air
refusals are accept_seen's.

    TET_CLI=/path/to/tet-cli python3 demo.py --work EMPTY_DIR [--seed 3]

Then open page.html in a browser (it reads data.js; nothing is fetched).
"""

import argparse
import json
import os
import random
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import encounter as E  # noqa: E402
import tamper as T  # noqa: E402


def lines(r):
    out = [f"{r['verdict']}  log of {E.short(r['keyid'])}: notebook {r['notebook']}, {len(r['encounters'])} encounter record(s)"]
    out += [f"  {p}" for p in r["problems"]]
    for e in r["encounters"]:
        out.append(f"  record {e['record']}: encounter {(e['sha256'] or '?')[:12]}" + (" checked" if not e["problems"] else ""))
        out += [f"    {p}" for p in e["problems"]]
    return out


def case(work, name, tamper_fn, both=True):
    w = os.path.join(work, "cases", name)
    shutil.copytree(os.path.join(work, "flight"), w)
    note = tamper_fn(w) if tamper_fn else None
    reg = os.path.join(w, "registry")
    res = {}
    for k in ("A", "B"):
        copy = T.checker_copy(os.path.join(w, f"aircraft-{k}"), os.path.join(w, f"checker-{k}"))
        res[k] = E.check_log(copy, os.path.join(reg, f"{k}.pin"), reg)
    out = {"name": name, "note": note, "A": lines(res["A"]), "verdictA": res["A"]["verdict"]}
    if both:
        c = E.compare(res["A"], res["B"])
        out.update({"B": lines(res["B"]), "verdictB": res["B"]["verdict"], "compare": c["verdict"],
                    "met": c["met"], "rows": [f"{r['sha256'][:12]}: {r['status']}: {r['why']}" for r in c["rows"]]})
        alts = {}
        for k in ("A", "B"):
            for e in res[k]["encounters"]:
                if e.get("body") and k not in alts:
                    alts[k] = {E.short(kk): s["pos"]["alt_m"] for kk, s in e["body"]["seen"].items()}
        out["alts"] = alts
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args()
    os.environ.update(E.CHAIN)
    flight = os.path.join(a.work, "flight")
    os.makedirs(flight, exist_ok=False)
    sim = E.simulate(flight, a.seed)
    h = sim["events"][0]["sha256"]
    A = lambda w: os.path.join(w, "aircraft-A")  # noqa: E731
    B = lambda w: os.path.join(w, "aircraft-B")  # noqa: E731

    def removed(w):
        T.remove_encounter(A(w), h)
        return "Operator A rebuilt its own log without the encounter and signed it again with A's key."

    def altitude(w):
        s = json.loads(E.rd(os.path.join(A(w), "encounters", h, "encounter.json")))
        i = s["parties"].index(E.keyid_of(A(w)))
        old = json.loads(E.rd(os.path.join(A(w), "encounters", h, f"seen.{i}.json")))["pos"]["alt_m"]
        T.edit_altitude(A(w), h, round(old + 30, 2))
        return f"Operator A changed its own altitude in the encounter from {old} m to {round(old + 30, 2)} m and re-signed everything A's key can sign."

    def replay(w):
        T.replay(A(w), h)
        return "Operator A recorded the same encounter a second time, later in its log, as if they had met twice."

    def forged(w):
        c = os.path.join(w, "aircraft-C")
        E.run_notebook(["init", "--dir", c])
        T.forge_with_key(B(w), c, E.keyid_of(A(w)), {"east_m": 5.0, "north_m": 5.0, "alt_m": 66.0})
        return "Operator B added a second meeting with A that never happened; A's parts are signed by a third aircraft's key (C)."

    cases = [case(a.work, "honest", None), case(a.work, "removed", removed), case(a.work, "altitude", altitude),
             case(a.work, "replay", replay), case(a.work, "forged", forged)]
    one = case(a.work, "removed-one-log", removed, both=False)
    cases.append(one)

    # In the air: B, in a new exchange, is sent A's old SEEN message; and a SEEN claiming to be A, signed by C.
    w = os.path.join(a.work, "cases", "air")
    shutil.copytree(flight, w)
    known = E.read_registry(os.path.join(w, "registry"))
    i = json.loads(E.rd(os.path.join(A(w), "encounters", h, "encounter.json")))["parties"].index(E.keyid_of(A(w)))
    old = (E.rd(os.path.join(A(w), "encounters", h, f"seen.{i}.json")), E.rd(os.path.join(A(w), "encounters", h, f"seen.{i}.json.sig.json")))
    b = E.Aircraft("B", B(w), known, random.Random(99), w)
    b.outgoing(40.0, sim["track"]["B"][400])
    air = {"replay": b.accept_seen(*old)}
    c = os.path.join(w, "aircraft-C")
    E.run_notebook(["init", "--dir", c])
    body = E.canonical({"kind": E.SEEN_KIND, "from": E.keyid_of(A(w)), "to": b.keyid, "nonce_mine": "3" * 32,
                        "nonce_yours": b.nonce, "t_s": 40.0, "pos": {"east_m": 0.0, "north_m": 0.0, "alt_m": 60.0}})
    air["impostor"] = b.accept_seen(body, T.sign_file(c, body, E.SEEN_TYPE))

    data = {"seed": a.seed, "range_m": E.LINK_RANGE_M, "loss": E.LOSS, "delay_s": E.DELAY_S, "dt": E.DT,
            "keyids": {k: E.short(v) for k, v in sim["keyids"].items()}, "closest": sim["closest"],
            "sent": sim["sent"], "lost": sim["lost"], "events": [{**e, "sha256": e["sha256"][:12]} for e in sim["events"]],
            "track": {k: [[p["t"], p["x"], p["y"], p["alt"], p["bx"], p["by"], p["balt"]] for p in v] for k, v in sim["track"].items()},
            "cases": cases, "air": air}
    with open(os.path.join(HERE, "data.js"), "w") as f:
        f.write("// Written by demo.py from one run; case verdicts: check_log and compare; in-the-air refusals: accept_seen.\nwindow.ENC = ")
        json.dump(data, f)
        f.write(";\n")
    print(f"closest {sim['closest']['m']} m at {sim['closest']['t']} s; {sim['sent']} sent, {sim['lost']} lost; "
          f"recorded: {', '.join(e['who'] + '@' + str(e['t']) for e in sim['events'])}")
    for cs in cases:
        print(f"{cs['name']}: A {cs['verdictA']}" + (f", B {cs['verdictB']}, compare {cs['compare']}" if "compare" in cs else ""))
    print(f"in the air: replay -> {air['replay']}; impostor -> {air['impostor']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
