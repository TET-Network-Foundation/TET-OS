#!/usr/bin/env python3
"""Tests for the two-party record sketch, all through the real notebook.py and tet-cli; nothing mocked.
Every refusal test asserts the exact list of problems, so another check answering instead fails it.

    TET_CLI=/path/to/tet-cli python3 -m unittest prep/demos/two-party-v0/test_twoparty.py
"""

import contextlib
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import twoparty as tp  # noqa: E402

nb = tp.nb
CHAIN = {"TET_CHAIN_ID": "tet-two-party-sketch", "TET_GENESIS_HASH": hashlib.sha256(b"two-party sketch").hexdigest()}
DOCUMENT = b"hand-over of box 7, lid sealed"
RANDOM = bytes(range(32))  # a fixed test value; a real one comes from tp.new_random_value()
AGREED = tp.agreed_of(DOCUMENT, RANDOM)


def notebook(*argv, stdin=None):
    r = subprocess.run([sys.executable, tp.NOTEBOOK, "--tet-cli", tp.cli()] + list(argv), input=stdin,
                       capture_output=True, text=True, env={**os.environ, **CHAIN})
    return r.returncode, r.stdout, r.stderr


def meant(d, permit):
    """The permit a side at folder d means, in sign()'s form, from make()'s (folder, id) or None."""
    if permit is None:
        return None
    return ("me" if os.path.samefile(permit[0], d) else "them", permit[1])


class Base(unittest.TestCase):
    def setUp(self):
        os.environ.update(CHAIN)
        self.t = tempfile.mkdtemp(prefix="two-party-test-")
        self.scratch = os.path.join(self.t, "scratch")
        os.makedirs(self.scratch)
        self.dirs = {}
        for n in ("A", "B", "C"):
            self.dirs[n] = self.new_notebook(n)

    def tearDown(self):
        shutil.rmtree(self.t)

    def new_notebook(self, n):
        d = os.path.join(self.t, n)
        rc, _, err = notebook("init", "--dir", d)
        self.assertEqual(rc, 0, err)
        rc, _, err = notebook("record", "--dir", d, "--source", "stdin-json", stdin='{"value": "start", "unit": "note"}')
        self.assertEqual(rc, 0, err)
        shutil.copy(os.path.join(d, "device.pin"), os.path.join(self.t, n + ".pin"))
        return d

    def pin(self, n):
        return tp.pin_of(self.dirs[n])

    def party(self, rec_bytes, n):
        return tp.party_of(tp.decode(rec_bytes), self.pin(n))

    def signed(self, x="A", y="B", summary="box 7 handed over", permit=None, agreed=AGREED):
        rec = tp.make(self.dirs[x], self.dirs[y], agreed, summary, permit)
        sigs = {self.party(rec, n): tp.sign(self.dirs[n], rec, self.scratch, self.pin(m), agreed, summary,
                                            meant(self.dirs[n], permit))
                for n, m in ((x, y), (y, x))}
        return rec, sigs

    def both_append(self, rec, sigs, x="A", y="B"):
        tp.append(self.dirs[x], rec, sigs, self.pin(y))
        tp.append(self.dirs[y], rec, sigs, self.pin(x))

    def export(self, n):
        out = os.path.join(self.t, "export-" + n + "-" + str(len(os.listdir(self.t))))
        rc, _, err = notebook("export", "--dir", self.dirs[n], "--out", out)
        self.assertEqual(rc, 0, err)
        return out

    def check(self, rec, sigs, names=("A", "B"), exports=None):
        return tp.check(rec, sigs, [self.pin(n) for n in names], nb.chain_env(self.dirs["A"]), exports)


class Agreed(Base):
    def test_both_signed_both_kept_checks_with_both_exports(self):
        rec, sigs = self.signed()
        self.both_append(rec, sigs)
        self.assertEqual(self.check(rec, sigs, exports={0: self.export("A"), 1: self.export("B")}), ([], []))

    def test_one_export_checks_and_says_what_it_cannot_show(self):
        rec, sigs = self.signed()
        self.both_append(rec, sigs)
        b = self.party(rec, "B")
        self.assertEqual(self.check(rec, sigs, exports={0: self.export("A")}),
                         ([], [f"{b}: no export, so nothing here shows that {b} kept this record"]))

    def test_record_holds_no_clock_and_no_name(self):
        rec, _ = self.signed()
        fields = tp.decode(rec)
        self.assertEqual(sorted(fields), sorted(tp.FIELDS))
        for v in fields.values():
            self.assertNotRegex(v, r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class Threats(Base):
    def test_withheld_copy_shows_with_its_export(self):
        rec, sigs = self.signed()
        tp.append(self.dirs["A"], rec, sigs, self.pin("B"))  # B never appends
        b = self.party(rec, "B")
        self.assertEqual(self.check(rec, sigs, exports={0: self.export("A"), 1: self.export("B")}),
                         ([f"{b}: log ends at record 1, before record 2"], []))

    def test_other_text_at_the_same_position_shows(self):
        # B signs the record with A, then writes a different record (other agreed hash) at that number,
        # by hand: append() would refuse it, because that position is reserved for rec.
        rec, sigs = self.signed()
        tp.append(self.dirs["A"], rec, sigs, self.pin("B"))
        other = tp.make(self.dirs["A"], self.dirs["B"], tp.agreed_of(b"something else", RANDOM), "box 7 handed over")
        rc, _, err = notebook("record", "--dir", self.dirs["B"], "--source", "stdin-json",
                              stdin=json.dumps({"value": f"two-party {tp.sha(other)}", "unit": tp.UNIT}))
        self.assertEqual(rc, 0, err)
        b = self.party(rec, "B")
        self.assertEqual(self.check(rec, sigs, exports={0: self.export("A"), 1: self.export("B")}),
                         ([f"{b}: record 2 is not this record"], []))

    def test_replayed_to_another_counterparty_is_refused_by_the_check(self):
        rec, sigs = self.signed()
        self.assertEqual(self.check(rec, sigs, names=("A", "C")),
                         ([f"record: does not name the pinned party {self.pin('C')[0]}"], []))

    def test_replayed_into_another_notebook_is_refused_at_append(self):
        rec, sigs = self.signed()
        with self.assertRaises(tp.Refused) as e:
            tp.append(self.dirs["C"], rec, sigs, self.pin("A"))
        self.assertEqual(str(e.exception), "append: the record does not name this notebook")

    def test_replayed_into_the_same_notebook_later_is_refused(self):
        rec, sigs = self.signed()
        self.both_append(rec, sigs)
        with self.assertRaises(tp.Refused) as e:
            tp.append(self.dirs["A"], rec, sigs, self.pin("B"))
        self.assertEqual(str(e.exception),
                         f"append: this notebook is no longer at record 2; the record cannot be written where it says")

    def test_signing_a_position_this_notebook_has_left_is_refused(self):
        rec = tp.make(self.dirs["A"], self.dirs["B"], AGREED, "box 7 handed over")
        rc, _, err = notebook("record", "--dir", self.dirs["A"], "--source", "stdin-json", stdin='{"value": "other", "unit": "note"}')
        self.assertEqual(rc, 0, err)
        with self.assertRaises(tp.Refused) as e:
            tp.sign(self.dirs["A"], rec, self.scratch, self.pin("B"), AGREED, "box 7 handed over", None)
        self.assertEqual(str(e.exception), "sign: this notebook is not at record 2 after the record the record names")

    def test_wrong_counterparty_pin_is_refused_at_append(self):
        rec, sigs = self.signed()
        with self.assertRaises(tp.Refused) as e:
            tp.append(self.dirs["A"], rec, sigs, self.pin("C"))
        self.assertEqual(str(e.exception), "append: the record does not name the pinned counterparty")

    def test_copied_key_checks_as_the_owner(self):
        # A limit, not a defence: whoever holds a copy of A's key signs as A, and the check passes.
        shutil.copytree(self.dirs["A"], os.path.join(self.t, "A-copy"))
        self.dirs["A2"] = os.path.join(self.t, "A-copy")
        rec, sigs = self.signed(x="A2", y="B")
        self.assertEqual(self.pin("A2"), self.pin("A"))
        self.assertEqual(self.check(rec, sigs)[0], [])

    def test_signature_by_the_other_party_in_this_slot_is_refused(self):
        rec, sigs = self.signed()
        a = self.party(rec, "A")
        b = self.party(rec, "B")
        sigs = {a: sigs[b], b: sigs[b]}
        pa, pb = self.pin("A"), self.pin("B")
        self.assertEqual(self.check(rec, sigs)[0], [f"{a}: signature: signed by {pb[0]}, not the pinned {pa[0]}"])


class OneHalf(Base):
    """Each half broken alone, with a VALID half by the same key over another record (CLAUDE.md C4)."""

    def swapped(self, prefix):
        rec, sigs = self.signed()
        # A's valid signature over another record at the same position, made by hand: sign() would
        # refuse it, because that position is reserved for rec.
        other = tp.make(self.dirs["A"], self.dirs["B"], AGREED, "another record")
        a = self.party(rec, "A")
        env, oenv = json.loads(sigs[a]), raw_signature(self, "A", other)
        idx = next(i for i, s in enumerate(env["signatures"]) if s["keyid"].startswith(prefix))
        oidx = next(i for i, s in enumerate(oenv["signatures"]) if s["keyid"].startswith(prefix))
        self.assertNotEqual(env["signatures"][idx]["sig"], oenv["signatures"][oidx]["sig"])
        env["signatures"][idx] = oenv["signatures"][oidx]
        sigs = dict(sigs)
        sigs[a] = json.dumps(env).encode()
        return rec, sigs, a

    def test_ml_dsa_half_from_another_record_is_refused(self):
        rec, sigs, a = self.swapped(nb.ML)
        self.assertEqual(self.check(rec, sigs)[0], [f"{a}: signature: {ML_REFUSAL}"])

    def test_ed25519_half_from_another_record_is_refused(self):
        rec, sigs, a = self.swapped(nb.ED)
        self.assertEqual(self.check(rec, sigs)[0], [f"{a}: signature: {ED_REFUSAL}"])


class Text(Base):
    def test_nfd_summary_is_refused_not_normalised(self):
        nfc = "café handed over"
        nfd = unicodedata.normalize("NFD", nfc)
        self.assertNotEqual(nfc, nfd)
        self.signed(summary=nfc)  # accepted
        with self.assertRaises(tp.Refused) as e:
            self.signed(summary=nfd)
        self.assertEqual(str(e.exception), "record: summary is not in Unicode NFC form")

    def test_whitespace_variants_are_refused(self):
        cases = {
            "box  7": "record: summary has a leading, trailing or double space",
            "box 7 ": "record: summary has a leading, trailing or double space",
            "box\t7": "record: summary holds a control or format character",
            "box 7": "record: summary holds a space other than U+0020",
            "box​7": "record: summary holds a control or format character",
        }
        for s, why in cases.items():
            with self.subTest(s=s), self.assertRaises(tp.Refused) as e:
                self.signed(summary=s)
            self.assertEqual(str(e.exception), why)

    def test_hand_built_nfd_record_is_refused_by_decode(self):
        rec, _ = self.signed(summary="café")
        fields = tp.decode(rec)
        fields["summary"] = unicodedata.normalize("NFD", "café")
        with self.assertRaises(tp.Refused) as e:
            tp.decode(tp.encode(fields))
        self.assertEqual(str(e.exception), "record: summary is not in Unicode NFC form")


class Separator(unittest.TestCase):
    """Inputs that contain the separator (CLAUDE.md C5b): ',' ends a field and ':' ends a length."""

    def test_field_lists_that_differ_only_in_where_a_separator_falls_do_not_collide(self):
        pairs = [
            (["a", "b,c"], ["a,b", "c"]),
            (["a", "1:b,"], ["a,1:b", ""]),
            (["2:ab,", "c"], ["", "2:ab,c"]),
            (["x:", "y"], ["x", ":y"]),
        ]
        for left, right in pairs:
            with self.subTest(left=left, right=right):
                self.assertNotEqual(tp.encode_fields(left), tp.encode_fields(right))

    def test_summary_that_imitates_a_field_decodes_to_itself(self):
        fields = {k: "" for k in tp.FIELDS}
        fields.update({"a.ed": nb.ED + "1" * 64, "a.ml": nb.ML + "1" * 64, "a.seq": "2", "a.prev": "0" * 64,
                       "b.ed": nb.ED + "2" * 64, "b.ml": nb.ML + "2" * 64, "b.seq": "5", "b.prev": "f" * 64,
                       "agreed": AGREED, "summary": "ok,1:a,1:b,"})
        self.assertEqual(tp.decode(tp.encode(fields)), fields)

    def test_extra_field_such_as_a_time_is_refused(self):
        fields = {k: "" for k in tp.FIELDS}
        fields.update({"a.ed": nb.ED + "1" * 64, "a.ml": nb.ML + "1" * 64, "a.seq": "2", "a.prev": "0" * 64,
                       "b.ed": nb.ED + "2" * 64, "b.ml": nb.ML + "2" * 64, "b.seq": "5", "b.prev": "f" * 64,
                       "agreed": AGREED, "summary": "ok"})
        raw = tp.encode(fields) + tp.netstring(b"2026-11-20T17:00:00Z")
        with self.assertRaises(tp.Refused) as e:
            tp.decode(raw)
        self.assertEqual(str(e.exception), "record: 13 fields, not 12")


class Permit(Base):
    def permit(self, n="A"):
        rc, out, err = notebook("permit", "--dir", self.dirs[n], "--action", "hand-over", "--expires-seq", "10")
        self.assertEqual(rc, 0, err)
        return out.strip()

    def test_cited_permit_checks_once(self):
        pid = self.permit()
        rec, sigs = self.signed(permit=(self.dirs["A"], pid))
        self.both_append(rec, sigs)
        self.assertEqual(self.check(rec, sigs, exports={0: self.export("A"), 1: self.export("B")}), ([], []))

    def test_permit_cited_twice_is_refused_at_append(self):
        pid = self.permit()
        rec, sigs = self.signed(permit=(self.dirs["A"], pid))
        self.both_append(rec, sigs)
        rec2, sigs2 = self.signed(summary="second use", permit=(self.dirs["A"], pid))
        with self.assertRaises(tp.Refused) as e:
            tp.append(self.dirs["A"], rec2, sigs2, self.pin("B"))
        self.assertEqual(str(e.exception), f"append: notebook.py record refused: error: not recorded: permit: {pid} was already used by record 2")

    def test_record_naming_a_permit_its_log_does_not_cite_shows(self):
        pid = self.permit()
        rec, sigs = self.signed(permit=(self.dirs["A"], pid))
        # A writes the line without citing the permit (not through append).
        h = tp.sha(rec)
        rc, _, err = notebook("record", "--dir", self.dirs["A"], "--source", "stdin-json",
                              stdin=json.dumps({"value": f"two-party {h}", "unit": tp.UNIT}))
        self.assertEqual(rc, 0, err)
        a = self.party(rec, "A")
        self.assertEqual(self.check(rec, sigs, exports={0: self.export("A")})[0],
                         [f"{a}: record 2 does not cite permit {pid}"])


def raw_signature(test, n, record):
    """n's envelope over record, signed directly with the notebook key: what a party can make by hand,
    with no check of what the record says."""
    p = os.path.join(test.scratch, "raw-" + n + "-" + tp.sha(record)[:12])
    with open(p, "wb") as f:
        f.write(record)
    nb.sign(tp.cli(), test.dirs[n], p, tp.PAYLOAD_TYPE, out=p + ".sig.json")
    with open(p + ".sig.json", "rb") as f:
        return json.loads(f.read())


def half(env, prefix):
    return next(s for s in env["signatures"] if s["keyid"].startswith(prefix))


def mixed(ed_env, ml_env):
    """An envelope with the Ed25519 half of one and the ML-DSA-44 half of the other, both valid."""
    env = json.loads(json.dumps(ed_env))
    env["signatures"] = [half(ed_env, nb.ED), half(ml_env, nb.ML)]
    env["tet"]["agent_mldsa44_pubkey_b64"] = ml_env["tet"]["agent_mldsa44_pubkey_b64"]
    return json.dumps(env).encode()


def record_fields(a_dir, a_pin, b_dir, b_pin, agreed=AGREED, summary="box 7 handed over"):
    """Fields of a record built by hand, with any pins: a and b are put in Ed25519 key-id order."""
    sides = sorted([(a_dir, a_pin), (b_dir, b_pin)], key=lambda x: x[1][0])
    rec = {}
    for p, (d, pin) in zip(("a", "b"), sides):
        rec[p + ".ed"], rec[p + ".ml"] = pin
        rec[p + ".seq"], rec[p + ".prev"] = tp.next_position(d)
    rec.update({"agreed": agreed, "summary": summary, "permit.party": "", "permit.id": ""})
    return rec


class SameKey(Base):
    def test_one_ml_dsa_key_named_for_both_parties_is_refused(self):
        # B publishes a pin pairing its own Ed25519 key with A's ML-DSA-44 key, and reuses A's
        # ML-DSA-44 half over the same record as its own. Every signature here is real and valid.
        pa, pb = self.pin("A"), self.pin("B")
        fake_b = (pb[0], pa[1])
        rec = tp.encode(record_fields(self.dirs["A"], pa, self.dirs["B"], fake_b))
        env_a, env_b = raw_signature(self, "A", rec), raw_signature(self, "B", rec)
        a, b = ("a", "b") if pa[0] < fake_b[0] else ("b", "a")
        sigs = {a: json.dumps(env_a).encode(), b: mixed(env_b, env_a)}
        got = tp.check(rec, sigs, [pa, fake_b], nb.chain_env(self.dirs["A"]))
        self.assertEqual(got, (["record: the two parties name the same ML-DSA-44 key"], []))


class SignChecks(Base):
    def test_ml_dsa_half_of_the_other_party_in_this_slot_is_refused(self):
        # A's valid Ed25519 half with B's valid ML-DSA-44 half over the same record: only the
        # ML-DSA-44 key-id comparison can refuse it.
        rec, sigs = self.signed()
        a = self.party(rec, "A")
        b = self.party(rec, "B")
        pa, pb = self.pin("A"), self.pin("B")
        sigs = dict(sigs)
        sigs[a] = mixed(json.loads(sigs[a]), json.loads(sigs[b]))
        self.assertEqual(self.check(rec, sigs)[0],
                         [f"{a}: signature: its ML-DSA-44 half is signed by {pb[1]}, not the pinned {pa[1]}"])

    def test_sign_refuses_a_record_naming_another_counterparty(self):
        rec = tp.make(self.dirs["A"], self.dirs["C"], AGREED, "box 7 handed over")
        with self.assertRaises(tp.Refused) as e:
            tp.sign(self.dirs["A"], rec, self.scratch, self.pin("B"), AGREED, "box 7 handed over", None)
        self.assertEqual(str(e.exception), "sign: the record does not name the pinned counterparty")

    def test_sign_refuses_a_record_with_another_agreed_hash(self):
        rec = tp.make(self.dirs["A"], self.dirs["B"], tp.agreed_of(b"another document", RANDOM), "box 7 handed over")
        with self.assertRaises(tp.Refused) as e:
            tp.sign(self.dirs["A"], rec, self.scratch, self.pin("B"), AGREED, "box 7 handed over", None)
        self.assertEqual(str(e.exception), "sign: the record does not carry the agreed hash this side computed")


class Logs(Base):
    def test_log_rewritten_before_the_record_shows(self):
        # D and its copy D2 share one key; record 1 differs. A record names D's record 1 as prev;
        # D2 holds that record at number 2 but after its own record 1.
        d = os.path.join(self.t, "D")
        rc, _, err = notebook("init", "--dir", d)
        self.assertEqual(rc, 0, err)
        d2 = os.path.join(self.t, "D2")
        shutil.copytree(d, d2)
        for x, v in ((d, "start"), (d2, "rewritten")):
            rc, _, err = notebook("record", "--dir", x, "--source", "stdin-json", stdin=json.dumps({"value": v, "unit": "note"}))
            self.assertEqual(rc, 0, err)
        self.dirs["D"], self.dirs["D2"] = d, d2
        rec, sigs = self.signed(x="D", y="B")
        prev_d, prev_d2 = tp.next_position(d)[1], tp.next_position(d2)[1]
        self.assertNotEqual(prev_d, prev_d2)
        rc, _, err = notebook("record", "--dir", d2, "--source", "stdin-json",
                              stdin=json.dumps({"value": f"two-party {tp.sha(rec)}", "unit": tp.UNIT}))
        self.assertEqual(rc, 0, err)
        p = self.party(rec, "D")
        self.assertEqual(self.check(rec, sigs, names=("D", "B"), exports={0: self.export("D2")})[0],
                         [f"{p}: record 2 follows {prev_d2[:16]}, not the {prev_d[:16]} the record names"])

    def report_lines(self, problems, notes):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            tp.report(problems, notes)
        return out.getvalue().splitlines()[:2]

    def test_report_says_signatures_valid_and_a_log_conflict_for_a_withheld_copy(self):
        rec, sigs = self.signed()
        tp.append(self.dirs["A"], rec, sigs, self.pin("B"))
        b = self.party(rec, "B")
        got = self.check(rec, sigs, exports={0: self.export("A"), 1: self.export("B")})
        self.assertEqual(self.report_lines(*got), ["SIGNATURES: valid", f"LOGS: conflict at {b} (cause not shown)"])

    def test_report_without_an_export_says_so_and_not_as_promised(self):
        rec, sigs = self.signed()
        self.both_append(rec, sigs)
        b = self.party(rec, "B")
        got = self.check(rec, sigs, exports={0: self.export("A")})
        self.assertEqual(self.report_lines(*got),
                         ["SIGNATURES: valid", f"LOGS: as promised where an export was given; no export for {b}"])

    def test_report_with_a_bad_signature_says_invalid(self):
        rec, sigs = self.signed()
        a, b = self.party(rec, "A"), self.party(rec, "B")
        got = self.check(rec, {a: sigs[b], b: sigs[b]})
        self.assertEqual(self.report_lines(*got), ["SIGNATURES: invalid", "LOGS: not checked"])


class RandomValue(unittest.TestCase):
    GUESSES = [b"hand-over of box %d, lid sealed" % i for i in range(1, 50)]

    def test_limit_a_hash_without_the_random_value_is_found_by_guessing(self):
        # Why the random value is there: v0's plain hash of a guessable document is read by hashing guesses.
        plain = hashlib.sha256(DOCUMENT).hexdigest()
        self.assertIn(plain, [hashlib.sha256(g).hexdigest() for g in self.GUESSES])

    def test_guessing_does_not_find_the_agreed_hash_with_the_random_value(self):
        self.assertIn(DOCUMENT, self.GUESSES)
        self.assertNotIn(AGREED, [hashlib.sha256(g).hexdigest() for g in self.GUESSES])
        self.assertNotIn(AGREED, [tp.sha(tp.netstring(tp.AGREED_TAG) + tp.netstring(g)) for g in self.GUESSES])
        self.assertEqual(AGREED, tp.agreed_of(DOCUMENT, RANDOM))

    def test_a_random_value_of_another_length_is_refused(self):
        for n in (0, 16, 31, 33):
            with self.subTest(n=n), self.assertRaises(tp.Refused) as e:
                tp.agreed_of(DOCUMENT, b"x" * n)
            self.assertEqual(str(e.exception), f"agreed: the random value is {n} bytes, not 32")

    def test_new_random_values_differ(self):
        self.assertEqual(len({tp.new_random_value() for _ in range(8)}), 8)


class Limits(Base):
    """Each asserts that a stated limit is real: these pass BECAUSE the record cannot stop the case."""

    def test_limit_framing_blames_the_side_that_moved_on(self):
        # B holds A's signature and withholds its own; A moves on and writes another record at 2;
        # B completes the old record. The check names A, the honest side.
        rec, sigs = self.signed()
        rc, _, err = notebook("record", "--dir", self.dirs["A"], "--source", "stdin-json", stdin='{"value": "moved on", "unit": "note"}')
        self.assertEqual(rc, 0, err)
        tp.append(self.dirs["B"], rec, sigs, self.pin("A"))
        a = self.party(rec, "A")
        self.assertEqual(self.check(rec, sigs, exports={0: self.export("A"), 1: self.export("B")}),
                         ([f"{a}: record 2 is not this record"], []))

    def test_limit_a_forked_log_checks_in_both_copies(self):
        fork = os.path.join(self.t, "A-fork")
        shutil.copytree(self.dirs["A"], fork)
        self.dirs["AF"] = fork
        rec1, sigs1 = self.signed(x="A", y="B")
        self.both_append(rec1, sigs1, x="A", y="B")
        rec2, sigs2 = self.signed(x="AF", y="C", summary="box 9 handed over")
        self.both_append(rec2, sigs2, x="AF", y="C")
        self.assertEqual(tp.decode(rec1)[self.party(rec1, "A") + ".seq"], tp.decode(rec2)[self.party(rec2, "AF") + ".seq"])
        self.assertEqual(self.check(rec1, sigs1, exports={0: self.export("A")})[0], [])
        self.assertEqual(self.check(rec2, sigs2, names=("AF", "C"), exports={0: self.export("AF")})[0], [])

    def test_limit_two_records_of_one_pair_carry_the_same_four_key_ids(self):
        rec1, sigs1 = self.signed()
        self.both_append(rec1, sigs1)
        rec2, _ = self.signed(summary="box 9 handed over")
        ids = lambda r: sorted(v for k, v in tp.decode(r).items() if k.endswith((".ed", ".ml")))
        self.assertEqual(ids(rec1), ids(rec2))

    def test_limit_look_alike_letters_and_other_fillers_pass(self):
        for s in ("b\u043ex 7 handed over", "box\u31647", "box\u28007", "box 7\u034f"):
            with self.subTest(s=s):
                rec, _ = self.signed(summary=s)  # accepted: the text rules do not catch these
                for n in ("A", "B"):  # give the position up, so the next summary can be signed
                    tp.abort(self.dirs[n], rec)


class FormatFillers(Base):
    def test_format_fillers_are_refused(self):
        for s in ("box\ufeff7", "box\u00ad7", "box\u200d7", "box\u200b7"):
            with self.subTest(s=s), self.assertRaises(tp.Refused) as e:
                self.signed(summary=s)
            self.assertEqual(str(e.exception), "record: summary holds a control or format character")

    def test_hand_built_whitespace_record_is_refused_by_decode(self):
        rec, _ = self.signed()
        for s, why in (("box\t7", "record: summary holds a control or format character"),
                       ("box\u00a07", "record: summary holds a space other than U+0020"),
                       ("box  7", "record: summary has a leading, trailing or double space")):
            fields = tp.decode(rec)
            fields["summary"] = s
            with self.subTest(s=s), self.assertRaises(tp.Refused) as e:
                tp.decode(tp.encode(fields))
            self.assertEqual(str(e.exception), why)


class PrintedList(unittest.TestCase):
    def bullets(self, heading):
        with open(os.path.join(HERE, "README.md"), encoding="utf-8") as f:
            text = f.read()
        part = text.split(f"## {heading}\n", 1)[1].split("\n## ", 1)[0]
        return [ln[2:] for ln in part.splitlines() if ln.startswith("- ")]

    def test_readme_lists_exactly_what_the_check_prints(self):
        self.assertEqual(self.bullets("Shows"), tp.SHOWS)
        self.assertEqual(self.bullets("Does not show"), tp.DOES_NOT_SHOW)


# tet-cli agent verify's own words for one bad half (the other half is valid).
ML_REFUSAL = "ml-dsa-44 signature verification failed: invalid ml-dsa signature"
ED_REFUSAL = "ed25519 signature verification failed: Ed25519Failed"


def load_v01(test):
    """twoparty.py as it was at v0.1 (commit 1d3186a0), from git, beside a link to this repo's tools."""
    import importlib.util
    root = os.path.join(test.t, "v01")
    d = os.path.join(root, "prep", "demos", "two-party-v0")
    os.makedirs(d)
    os.symlink(os.path.normpath(os.path.join(HERE, "..", "..", "..", "tools")), os.path.join(root, "tools"))
    reason = "needs commit 1d3186a0 of the sketch's own branch, which this repository does not hold"
    if subprocess.run(["git", "cat-file", "-e", "1d3186a0^{commit}"], cwd=HERE, capture_output=True).returncode != 0:
        test.skipTest(reason)
    shown = subprocess.run(["git", "show", "1d3186a0:prep/demos/two-party-v0/twoparty.py"], cwd=HERE,
                           capture_output=True)
    if shown.returncode != 0:
        test.skipTest(reason)
    src = shown.stdout
    path = os.path.join(d, "twoparty_v01.py")
    with open(path, "wb") as f:
        f.write(src)
    spec = importlib.util.spec_from_file_location("twoparty_v01", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Reservation(Base):
    """Two deals signed at one position: on v0.1 the honest side is framed; v0.2 refuses the second."""

    def test_on_v01_two_deals_at_one_position_frame_the_honest_side(self):
        v01 = load_v01(self)
        self.assertEqual(v01.TAG, tp.TAG)
        A, B, C = self.dirs["A"], self.dirs["B"], self.dirs["C"]
        r1 = v01.make(A, B, AGREED, "box 7 handed over")
        r2 = v01.make(A, C, AGREED, "box 8 handed over")
        s1 = {self.party(r1, "A"): v01.sign(A, r1, self.scratch, self.pin("B"), AGREED),
              self.party(r1, "B"): v01.sign(B, r1, self.scratch, self.pin("A"), AGREED)}
        s2 = {self.party(r2, "A"): v01.sign(A, r2, self.scratch, self.pin("C"), AGREED),  # v0.1 signs it
              self.party(r2, "C"): v01.sign(C, r2, self.scratch, self.pin("A"), AGREED)}
        v01.append(A, r1, s1, self.pin("B"))
        v01.append(B, r1, s1, self.pin("A"))
        v01.append(C, r2, s2, self.pin("A"))
        a = self.party(r2, "A")
        problems, notes = self.check(r2, s2, names=("A", "C"), exports={0: self.export("A"), 1: self.export("C")})
        self.assertEqual((problems, notes), ([f"{a}: record 2 is not this record"], []))
        self.assertEqual(tp.verdict(problems, notes), ("SIGNATURES: valid", f"LOGS: conflict at {a} (cause not shown)"))

    def test_sign_refuses_a_second_record_at_a_reserved_position(self):
        A = self.dirs["A"]
        r1 = tp.make(A, self.dirs["B"], AGREED, "box 7 handed over")
        tp.sign(A, r1, self.scratch, self.pin("B"), AGREED, "box 7 handed over", None)
        r2 = tp.make(A, self.dirs["C"], AGREED, "box 8 handed over")
        with self.assertRaises(tp.Refused) as e:
            tp.sign(A, r2, self.scratch, self.pin("C"), AGREED, "box 8 handed over", None)
        self.assertEqual(str(e.exception), "sign: record 2 is reserved for another record")

    def test_signing_the_reserved_record_again_is_allowed(self):
        A = self.dirs["A"]
        r1 = tp.make(A, self.dirs["B"], AGREED, "box 7 handed over")
        for _ in range(2):
            tp.sign(A, r1, self.scratch, self.pin("B"), AGREED, "box 7 handed over", None)

    def test_append_refuses_another_record_at_a_reserved_position(self):
        # A's key signed r2 by hand (not through sign()), while sign() had reserved record 2 for r1.
        A, C = self.dirs["A"], self.dirs["C"]
        r1 = tp.make(A, self.dirs["B"], AGREED, "box 7 handed over")
        tp.sign(A, r1, self.scratch, self.pin("B"), AGREED, "box 7 handed over", None)
        r2 = tp.make(A, C, AGREED, "box 8 handed over")
        s2 = {self.party(r2, "A"): json.dumps(raw_signature(self, "A", r2)).encode(),
              self.party(r2, "C"): tp.sign(C, r2, self.scratch, self.pin("A"), AGREED, "box 8 handed over", None)}
        with self.assertRaises(tp.Refused) as e:
            tp.append(A, r2, s2, self.pin("C"))
        self.assertEqual(str(e.exception), "append: record 2 is reserved for another record")

    def test_abort_gives_the_position_up_and_a_completed_record_then_shows_a_conflict(self):
        A, B = self.dirs["A"], self.dirs["B"]
        r1, s1 = self.signed()
        tp.abort(A, r1)
        r2, s2 = self.signed(x="A", y="C", summary="box 8 handed over")
        self.assertEqual(tp.decode(r2)[self.party(r2, "A") + ".seq"], "3")
        tp.append(B, r1, s1, self.pin("A"))  # B completes r1 after A gave it up: no fair exchange
        a = self.party(r1, "A")
        self.assertEqual(self.check(r1, s1, exports={0: self.export("A"), 1: self.export("B")}),
                         ([f"{a}: record 2 is not this record"], []))


class SignMeant(Base):
    """sign() refuses a summary or a permit this side was not given; the permit's two halves (which side
    holds it, its id) are broken one at a time."""

    def permits(self, n="A", k=1):
        out = []
        for _ in range(k):
            rc, o, err = notebook("permit", "--dir", self.dirs[n], "--action", "hand-over", "--expires-seq", "10")
            self.assertEqual(rc, 0, err)
            out.append(o.strip())
        return out

    def refusal(self, rec, summary, permit):
        with self.assertRaises(tp.Refused) as e:
            tp.sign(self.dirs["A"], rec, self.scratch, self.pin("B"), AGREED, summary, permit)
        return str(e.exception)

    def test_sign_refuses_a_record_with_another_summary(self):
        rec = tp.make(self.dirs["A"], self.dirs["B"], AGREED, "box 8 handed over")
        self.assertEqual(self.refusal(rec, "box 7 handed over", None),
                         "sign: the record does not carry the summary this side was given")

    def test_sign_refuses_a_record_naming_its_own_permit_it_did_not_mean(self):
        (pid,) = self.permits()
        rec = tp.make(self.dirs["A"], self.dirs["B"], AGREED, "box 7 handed over", (self.dirs["A"], pid))
        self.assertEqual(self.refusal(rec, "box 7 handed over", None),
                         "sign: the record does not name the permit this side means")

    def test_sign_refuses_a_record_naming_another_permit_id_of_this_side(self):
        p1, p2 = self.permits(k=2)
        rec = tp.make(self.dirs["A"], self.dirs["B"], AGREED, "box 7 handed over", (self.dirs["A"], p2))
        self.assertEqual(self.refusal(rec, "box 7 handed over", ("me", p1)),
                         "sign: the record does not name the permit this side means")

    def test_sign_refuses_a_record_naming_the_meant_permit_id_as_the_other_sides(self):
        (pid,) = self.permits()
        rec = tp.make(self.dirs["A"], self.dirs["B"], AGREED, "box 7 handed over", (self.dirs["B"], pid))
        self.assertEqual(self.refusal(rec, "box 7 handed over", ("me", pid)),
                         "sign: the record does not name the permit this side means")

    def test_sign_accepts_the_meant_permit(self):
        (pid,) = self.permits()
        rec = tp.make(self.dirs["A"], self.dirs["B"], AGREED, "box 7 handed over", (self.dirs["A"], pid))
        tp.sign(self.dirs["A"], rec, self.scratch, self.pin("B"), AGREED, "box 7 handed over", ("me", pid))


class Landing(Base):
    def test_append_refuses_when_another_write_came_between_its_check_and_its_write(self):
        rec, sigs = self.signed()

        def other_write(d):
            rc, _, err = notebook("record", "--dir", d, "--source", "stdin-json", stdin='{"value": "between", "unit": "note"}')
            self.assertEqual(rc, 0, err)

        old = tp.before_write
        tp.before_write = other_write
        self.addCleanup(setattr, tp, "before_write", old)
        with self.assertRaises(tp.Refused) as e:
            tp.append(self.dirs["A"], rec, sigs, self.pin("B"))
        self.assertEqual(str(e.exception), "append: the record landed at record 3, not 2: another write came between")


class AbortPosition(Base):
    def test_abort_refuses_when_the_notebook_has_left_the_reserved_number(self):
        rec, _ = self.signed()
        rc, _, err = notebook("record", "--dir", self.dirs["A"], "--source", "stdin-json", stdin='{"value": "moved on", "unit": "note"}')
        self.assertEqual(rc, 0, err)
        with self.assertRaises(tp.Refused) as e:
            tp.abort(self.dirs["A"], rec)
        self.assertEqual(str(e.exception), "abort: this notebook is no longer at record 2; the abort entry cannot be written there")


if __name__ == "__main__":
    unittest.main()
