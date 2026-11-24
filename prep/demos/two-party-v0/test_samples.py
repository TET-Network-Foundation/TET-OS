#!/usr/bin/env python3
"""Tests for samples.py, through the real notebook.py and tet-cli; nothing mocked.

One sample set is made per run. Each broken sample must be refused for the reason it is named for and
no other: every test asserts the exact problem list, written here from the sample's own files, not
read from its WHAT.txt. Keys, hashes and permit ids are new in every run, so no test compares them with
a fixed value.

    TET_CLI=/path/to/tet-cli python3 -m unittest prep/demos/two-party-v0/test_samples.py
"""

import getpass
import json
import os
import re
import socket
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import samples  # noqa: E402
import twoparty as tp  # noqa: E402

nb = tp.nb
SAMPLES = os.path.join(HERE, "samples.py")
# tet-cli agent verify's own words (the first FAIL line), typed out here, not taken from samples.py.
ED_REFUSAL = "ed25519 signature verification failed: Ed25519Failed"
ML_REFUSAL = "ml-dsa-44 signature verification failed: invalid ml-dsa signature"
HONEST = ("honest-1", "honest-2-permit", "honest-3")
BROKEN = ("broken-a-ed25519-half", "broken-b-ml-dsa-half", "broken-c-summary-changed",
          "broken-d-permit-used-twice", "broken-e-number-skipped", "broken-f-one-key-both-parties")
# The only files a sample folder may hold. An export holds only the log's own files.
TOP = {"record.bin", "sig-a.json", "sig-b.json", "pin-1.txt", "pin-2.txt", "chain.json", "WHAT.txt"}
IN_EXPORT = re.compile(r"chain\.json|chain\.txt|records/[1-9][0-9]*\.json(\.sig\.json)?|permits/[0-9a-f]{32}\.json(\.sig\.json)?")
# A line that is a 12- to 24-word phrase of short lowercase words, as device.key holds.
PHRASE = re.compile(rb"(?m)^\s*[a-z]{3,8}( [a-z]{3,8}){11,23}\s*$")
# The one time a sample set may carry: the Unix epoch, typed out here, not taken from samples.py.
SAMPLE_TIME = "1970-01-01T00:00:00Z"
# A date with a year after 1970 written as digits, as a clock time is.
DATE = re.compile(rb"(?<![0-9])(197[1-9]|19[89][0-9]|2[0-9]{3})-[01][0-9]-[0-3][0-9]")


def run(*argv):
    r = subprocess.run([sys.executable, SAMPLES] + list(argv), capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


class Samples(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t = tempfile.mkdtemp(prefix="two-party-samples-test-")
        cls.set = os.path.join(cls.t, "set")
        cls.made_from = time.time()
        rc, out, err = run("make", cls.set)
        cls.made_to = time.time()
        assert rc == 0, err

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.t)

    def folder(self, name):
        return os.path.join(self.set, name)

    def load(self, name):
        return samples.read_folder(self.folder(name))

    def checked(self, name):
        record, sigs, pins, cenv, exports = self.load(name)
        return tp.check(record, sigs, pins, cenv, exports)

    def what(self, name):
        with open(os.path.join(self.folder(name), "WHAT.txt"), encoding="utf-8") as f:
            return f.read().splitlines()

    def letter(self, name, i):
        """The party letter of the pin at pin-<i>.txt in this sample's record."""
        record, _, pins, _, _ = self.load(name)
        return tp.party_of(tp.decode(record), pins[i - 1])

    def assert_refused(self, name, problems, notes=()):
        """check() gives exactly these problems and notes; `check` prints the verdict and them and exits
        1; WHAT.txt names the same lines."""
        got = self.checked(name)
        self.assertEqual(got, (list(problems), list(notes)))
        rc, out, _ = run("check", self.folder(name))
        self.assertEqual(rc, 1 if problems else 0)
        lines = out.splitlines()
        shown = lines[:lines.index("Shows:")]
        self.assertEqual(shown[2:], ["  " + x for x in list(problems) + list(notes)])
        self.assertEqual(self.what(name)[1:], shown)
        return shown[:2]

    # ── the set ──

    def test_the_set_holds_exactly_the_nine_samples(self):
        self.assertEqual(sorted(os.listdir(self.set)), sorted(HONEST + BROKEN))

    def test_check_all_matches_every_folder(self):
        rc, out, _ = run("check-all", self.set)
        self.assertEqual(rc, 0, out)
        lines = out.splitlines()
        self.assertEqual(len(lines), 9)
        self.assertTrue(all(ln.endswith("; MATCH") for ln in lines), out)

    def test_check_all_says_differs_when_a_verdict_is_not_the_expected_one(self):
        d = os.path.join(self.t, "edited")
        shutil.copytree(self.set, d)
        what = os.path.join(d, "honest-1", "WHAT.txt")
        with open(what, encoding="utf-8") as f:
            text = f.read()
        with open(what, "w", encoding="utf-8") as f:
            f.write(text.replace("SIGNATURES: valid", "SIGNATURES: invalid"))
        rc, out, _ = run("check-all", d)
        self.assertEqual(rc, 1)
        self.assertIn("honest-1: expected SIGNATURES: invalid / LOGS: as promised; got SIGNATURES: valid / LOGS: as promised; DIFFERS", out)
        self.assertEqual(sum(ln.endswith("; DIFFERS") for ln in out.splitlines()), 1)

    def test_no_private_key_anywhere_in_the_set(self):
        seen = 0
        for root, dirs, files in os.walk(self.set):
            for n in files:
                path = os.path.join(root, n)
                rel = os.path.relpath(path, self.set).split(os.sep)
                inner = "/".join(rel[1:])
                if len(rel) == 2:
                    self.assertIn(inner, TOP)
                else:
                    self.assertIn(rel[1], samples.EXPORTS, inner)
                    self.assertRegex("/".join(rel[2:]), IN_EXPORT)
                with open(path, "rb") as f:
                    self.assertIsNone(PHRASE.search(f.read()), path)
                seen += 1
        self.assertGreater(seen, 100)

    def records(self):
        """(path, parsed JSON) of every notebook record in every export of the set."""
        out = []
        for root, _, files in os.walk(self.set):
            if os.path.basename(root) == "records":
                for n in files:
                    if re.fullmatch(r"[1-9][0-9]*\.json", n):
                        with open(os.path.join(root, n), encoding="utf-8") as f:
                            out.append((os.path.join(root, n), json.load(f)))
        return out

    def test_every_record_carries_the_sample_time_and_not_the_clock_at_make_time(self):
        records = self.records()
        self.assertGreater(len(records), 50)
        made = (time.strftime("%Y-%m-%dT%H:%M", time.gmtime(t)) for t in (self.made_from, self.made_to))
        made = set(made)
        for path, r in records:
            self.assertEqual(r["clock_utc"], SAMPLE_TIME, path)
            self.assertNotIn(r["clock_utc"][:16], made, path)

    def test_nothing_of_the_machine_that_made_it_is_in_the_set(self):
        """No user name, home path, host name, temporary folder or date after 1970 in any file; no number
        within two days of make time (in seconds or milliseconds) in any JSON; every file and folder
        carries the sample time as its modification time."""
        marks = {getpass.getuser(), os.path.expanduser("~"), socket.gethostname(),
                 socket.gethostname().split(".")[0], os.path.realpath(tempfile.gettempdir()), tempfile.gettempdir()}
        marks = {m.lower().encode() for m in marks if len(m) >= 3}
        near = (self.made_from - 2 * 86400, self.made_to + 2 * 86400)

        def numbers(v):
            if isinstance(v, bool):
                return
            if isinstance(v, (int, float)):
                yield v
            elif isinstance(v, dict):
                for x in v.values():
                    yield from numbers(x)
            elif isinstance(v, list):
                for x in v:
                    yield from numbers(x)

        seen = 0
        for root, dirs, files in os.walk(self.set):
            for n in dirs + files:
                path = os.path.join(root, n)
                self.assertEqual(os.lstat(path).st_mtime, 0, path)
            for n in files:
                path = os.path.join(root, n)
                with open(path, "rb") as f:
                    b = f.read()
                for m in marks:
                    self.assertNotIn(m, b.lower(), path)
                self.assertIsNone(DATE.search(b), path)
                if n.endswith(".json"):
                    for x in numbers(json.loads(b)):
                        self.assertFalse(near[0] <= x <= near[1] or near[0] <= x / 1000 <= near[1], (path, x))
                seen += 1
        self.assertEqual(os.lstat(self.set).st_mtime, 0)
        self.assertGreater(seen, 100)

    # ── honest ──

    def test_honest_samples_have_no_problem(self):
        for name in HONEST:
            with self.subTest(name):
                self.assertEqual(self.assert_refused(name, []), ["SIGNATURES: valid", "LOGS: as promised"])

    def test_honest_2_cites_a_permit_held_by_the_side_at_pin_1(self):
        rec = tp.decode(self.load("honest-2-permit")[0])
        self.assertEqual(rec["permit.party"], self.letter("honest-2-permit", 1))
        self.assertRegex(rec["permit.id"], r"^[0-9a-f]{32}$")
        for name in ("honest-1", "honest-3"):
            self.assertEqual(tp.decode(self.load(name)[0])["permit.id"], "")

    # ── broken, one reason each ──

    def one_half_swapped(self, name, prefix):
        """The sample's signatures are honest-3's except one half of the side at pin-1.txt, which is a
        different, validly made half by the same key."""
        record, sigs, _, _, _ = self.load(name)
        h3_record, h3_sigs, _, _, _ = self.load("honest-3")
        self.assertEqual(record, h3_record)
        p = self.letter(name, 1)
        q = "b" if p == "a" else "a"
        self.assertEqual(sigs[q], h3_sigs[q])
        env, h3 = json.loads(sigs[p]), json.loads(h3_sigs[p])
        for s, t in zip(env["signatures"], h3["signatures"]):
            self.assertEqual(s["keyid"], t["keyid"])
            if s["keyid"].startswith(prefix):
                self.assertNotEqual(s["sig"], t["sig"])
            else:
                self.assertEqual(s["sig"], t["sig"])
        return p

    def test_a_ed25519_half_of_another_record_is_refused_for_that_half(self):
        p = self.one_half_swapped("broken-a-ed25519-half", nb.ED)
        self.assertEqual(self.assert_refused("broken-a-ed25519-half", [f"{p}: signature: {ED_REFUSAL}"]),
                         ["SIGNATURES: invalid", "LOGS: not checked"])

    def test_b_ml_dsa_half_of_another_record_is_refused_for_that_half(self):
        p = self.one_half_swapped("broken-b-ml-dsa-half", nb.ML)
        self.assertEqual(self.assert_refused("broken-b-ml-dsa-half", [f"{p}: signature: {ML_REFUSAL}"]),
                         ["SIGNATURES: invalid", "LOGS: not checked"])

    def test_c_summary_changed_after_signing_is_refused_by_both_signatures(self):
        record, sigs, _, _, exports = self.load("broken-c-summary-changed")
        h3_record, h3_sigs, _, _, _ = self.load("honest-3")
        rec, h3 = tp.decode(record), tp.decode(h3_record)
        self.assertNotEqual(rec["summary"], h3["summary"])
        self.assertEqual({k: v for k, v in rec.items() if k != "summary"}, {k: v for k, v in h3.items() if k != "summary"})
        self.assertEqual(sigs, h3_sigs)
        self.assertEqual(exports, {})
        a, b = self.letter("broken-c-summary-changed", 1), self.letter("broken-c-summary-changed", 2)
        why = f"signature: record is not the {len(h3_record)} bytes this envelope signed"
        self.assertEqual(self.assert_refused("broken-c-summary-changed", [f"{a}: {why}", f"{b}: {why}"],
                                             [f"{p}: no export, so nothing here shows that {p} kept this record" for p in (a, b)]),
                         ["SIGNATURES: invalid", "LOGS: not checked"])

    def test_d_second_use_of_a_permit_is_a_log_conflict_at_the_permit_holder(self):
        name = "broken-d-permit-used-twice"
        rec = tp.decode(self.load(name)[0])
        first = tp.decode(self.load("honest-2-permit")[0])
        p = self.letter(name, 1)
        self.assertEqual((rec["permit.party"], rec["permit.id"]), (p, first["permit.id"]))
        self.assertEqual(self.assert_refused(name, [
            f"{p}: log: record {rec[p + '.seq']}: permit: {rec['permit.id']} was already used by record {first[p + '.seq']}"]),
            ["SIGNATURES: valid", f"LOGS: conflict at {p} (cause not shown)"])

    def test_e_record_number_past_the_next_one_is_a_log_conflict_at_that_side(self):
        name = "broken-e-number-skipped"
        record, _, _, _, exports = self.load(name)
        rec = tp.decode(record)
        p = self.letter(name, 1)
        last = len(nb.chain_lines(exports[0]))
        self.assertEqual(int(rec[p + ".seq"]), last + 1)
        with open(os.path.join(exports[0], "records", f"{last}.json"), "rb") as f:
            self.assertEqual(json.loads(f.read())["reading"]["value"], f"two-party {tp.sha(record)}")
        self.assertEqual(self.assert_refused(name, [f"{p}: log ends at record {last}, before record {last + 1}"]),
                         ["SIGNATURES: valid", f"LOGS: conflict at {p} (cause not shown)"])

    def test_f_one_key_for_both_parties_is_refused_as_a_record(self):
        name = "broken-f-one-key-both-parties"
        record, sigs, pins, _, _ = self.load(name)
        fields = tp.decode_netstrings(record)
        self.assertEqual(fields[1:5], fields[5:9])
        self.assertEqual(pins[0], pins[1])
        self.assertEqual(self.assert_refused(name, ["record: parties are not two keys in key-id order"]),
                         ["SIGNATURES: invalid", "LOGS: not checked"])

    def test_make_refuses_an_existing_folder(self):
        rc, out, _ = run("make", self.set)
        self.assertEqual((rc, out.strip()), (2, f"{self.set} exists; make writes a new folder"))


if __name__ == "__main__":
    unittest.main()
