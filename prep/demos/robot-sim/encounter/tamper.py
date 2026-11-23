"""What an operator, or a third aircraft, would try against the encounter record. Used by the tests and
by the page. Each works on folders that hold the key it needs; `checker_copy` then makes the copy a
checker gets, without the key.
"""

import json
import os
import shutil

import encounter as E
import notebook as nb


def checker_copy(d, out):
    """The log as a checker receives it: records, chain, encounters; no key and no device.head."""
    shutil.copytree(d, out, ignore=shutil.ignore_patterns("device.key", "device.head"))
    return out


def rebuild_log(d, values):
    """The operator writes its notebook again from the start, with its own key, holding `values`
    (each an encounter or flight line). The notebook check judges the signatures against the
    operator's own key; it does not judge whether records were dropped."""
    shutil.rmtree(os.path.join(d, "records"))
    os.remove(os.path.join(d, "chain.txt"))
    os.makedirs(os.path.join(d, "records"))
    nb.write_head(d, 0, nb.ZERO)
    for v in values:
        E.record_line(d, v)


def values(d):
    return [v for _, v, _ in E.notebook_records(d)]


def remove_encounter(d, h):
    """The operator drops one encounter from its own log and re-signs the rest."""
    rebuild_log(d, [v for v in values(d) if not v.startswith(f"encounter {h} ")])
    shutil.rmtree(os.path.join(d, "encounters", h))


def unread_copy(d, h):
    """As remove_encounter, plus one more file in records/ holding the removed record, under a name
    that verify does not list; the encounter checker must not read it either."""
    rec = os.path.join(d, "records")
    seq = [s for s, v, _ in E.notebook_records(d) if isinstance(v, str) and v.startswith(f"encounter {h} ")][0]
    body = E.rd(os.path.join(rec, f"{seq}.json"))
    bundle = os.path.join(d, "encounters", h)
    keep = bundle + ".kept"
    shutil.copytree(bundle, keep)
    remove_encounter(d, h)
    shutil.move(keep, bundle)
    name = f"{seq}.json.unread"
    with open(os.path.join(rec, name), "wb") as f:
        f.write(body)
    return name


def unsign_record(d, h):
    """The record that holds encounter h is written again with the same reading but other bytes
    (indented JSON), and not signed again: verify refuses that record."""
    rec = os.path.join(d, "records")
    seq = [s for s, v, _ in E.notebook_records(d) if isinstance(v, str) and v.startswith(f"encounter {h} ")][0]
    p = os.path.join(rec, f"{seq}.json")
    rec_obj = json.loads(E.rd(p))
    with open(p, "w") as f:
        json.dump(rec_obj, f, indent=1)
    return seq


def sign_file(d, body, payload_type):
    p = os.path.join(d, "scratch-tamper")
    with open(p, "wb") as f:
        f.write(body)
    nb.sign(E.cli(), d, p, payload_type, out=p + ".sig.json")
    with open(p + ".sig.json", "rb") as f:
        env = f.read()
    os.remove(p)
    os.remove(p + ".sig.json")
    return env


def edit_altitude(d, h, new_alt):
    """The operator changes the altitude in its own SEEN message, re-signs it, builds the encounter
    record again and signs that too: all it can sign. The other party's counter-signature it can
    only copy over. Returns the new encounter hash."""
    src = os.path.join(d, "encounters", h)
    own = E.keyid_of(d)
    enc = json.loads(E.rd(os.path.join(src, "encounter.json")))
    i = enc["parties"].index(own)
    seens = {}
    for j, k in enumerate(enc["parties"]):
        body = E.rd(os.path.join(src, f"seen.{j}.json"))
        env = E.rd(os.path.join(src, f"seen.{j}.json.sig.json"))
        if j == i:
            s = json.loads(body)
            s["pos"]["alt_m"] = new_alt
            body = E.canonical(s)
            env = sign_file(d, body, E.SEEN_TYPE)
        seens[k] = (body, env)
    new = E.encounter_record(*[seens[k][0] for k in enc["parties"]])
    peer = enc["parties"][1 - i]
    cosigs = {own: sign_file(d, new, E.ENC_TYPE),
              peer: E.rd(os.path.join(src, f"sig.{1 - i}.json"))}
    shutil.rmtree(src)
    E.save_bundle(d, new, seens, cosigs)
    nh = E.sha(new)
    rebuild_log(d, [v.replace(h, nh) for v in values(d)])
    return nh


def replay(d, h):
    """The operator records an encounter it already holds once more, later in its log (as a second meeting)."""
    peer = json.loads(E.rd(os.path.join(d, "encounters", h, "encounter.json")))["parties"]
    peer = [k for k in peer if k != E.keyid_of(d)][0]
    E.record_line(d, f"encounter {h} peer={peer}")


def forge_with_key(victim_dir, forger_dir, pretend_keyid, pos):
    """The operator of `victim_dir`'s aircraft invents a meeting with `pretend_keyid`, whose parts it
    signs with the key in `forger_dir` (a third aircraft's). Returns the encounter hash."""
    own = E.keyid_of(victim_dir)
    n1, n2 = "1" * 32, "2" * 32
    mine = E.canonical({"kind": E.SEEN_KIND, "from": own, "to": pretend_keyid, "nonce_mine": n1, "nonce_yours": n2,
                        "t_s": 30.0, "pos": pos})
    theirs = E.canonical({"kind": E.SEEN_KIND, "from": pretend_keyid, "to": own, "nonce_mine": n2, "nonce_yours": n1,
                          "t_s": 30.0, "pos": pos})
    enc = E.encounter_record(mine, theirs)
    E.save_bundle(victim_dir, enc,
                  {own: (mine, sign_file(victim_dir, mine, E.SEEN_TYPE)),
                   pretend_keyid: (theirs, sign_file(forger_dir, theirs, E.SEEN_TYPE))},
                  {own: sign_file(victim_dir, enc, E.ENC_TYPE), pretend_keyid: sign_file(forger_dir, enc, E.ENC_TYPE)})
    h = E.sha(enc)
    E.record_line(victim_dir, f"encounter {h} peer={pretend_keyid}")
    return h


def swap_half(bundle, i, prefix):
    """In party i's counter-signature, put that party's own valid `prefix` half taken from its SEEN
    envelope: a real signature by the right key, over another payload. Only that half is wrong."""
    sig_p = os.path.join(bundle, f"sig.{i}.json")
    env = json.loads(E.rd(sig_p))
    donor = json.loads(E.rd(os.path.join(bundle, f"seen.{i}.json.sig.json")))
    good = next(s["sig"] for s in donor["signatures"] if s["keyid"].startswith(prefix))
    for s in env["signatures"]:
        if s["keyid"].startswith(prefix):
            assert s["sig"] != good
            s["sig"] = good
    with open(sig_p, "w") as f:
        json.dump(env, f)
