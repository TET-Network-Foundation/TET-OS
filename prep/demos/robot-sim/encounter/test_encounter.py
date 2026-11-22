#!/usr/bin/env python3
"""Tests for the two-party encounter record: the honest flight, and what an operator or a third
aircraft would try. Each tamper test asserts the one reason its check gives.

Needs a tet-cli build (TET_CLI=..., or target/release/tet-cli in the repository). Signs for a demo
chain with test keys made in a temporary folder; contacts nothing.

    TET_CLI=... python3 prep/demos/robot-sim/encounter/test_encounter.py

ENCOUNTER_CONTROL=<name> removes one tamper step (see controls.py); the test named for it must then
fail on its assertion.
"""

import json
import os
import random
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import encounter as E  # noqa: E402
sys.path.insert(0, os.path.dirname(HERE))
import copy_cases as C  # noqa: E402
import tamper as T  # noqa: E402

CONTROL = os.environ.get("ENCOUNTER_CONTROL", "")


class Encounter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.update(E.CHAIN)
        cls.tmp = tempfile.mkdtemp(prefix="encounter-test-")
        cls.base = os.path.join(cls.tmp, "base")
        os.makedirs(cls.base)
        cls.sim = E.simulate(cls.base, seed=3)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.w = tempfile.mkdtemp(dir=self.tmp)
        self.work = os.path.join(self.w, "work")
        shutil.copytree(self.base, self.work)
        self.A = os.path.join(self.work, "aircraft-A")
        self.B = os.path.join(self.work, "aircraft-B")
        self.reg = os.path.join(self.work, "registry")
        self.h = E.notebook_records(self.A)[1][1].split()[1]

    def check(self, which):
        d = {"A": self.A, "B": self.B}[which]
        copy = T.checker_copy(d, os.path.join(self.w, f"checker-{which}-{len(os.listdir(self.w))}"))
        self.assertFalse(os.path.exists(os.path.join(copy, "device.key")))
        return E.check_log(copy, os.path.join(self.reg, f"{which}.pin"), self.reg)

    def test_honest_flight_both_logs_hold_the_same_encounter_signed_by_both_keys(self):
        self.assertEqual([e["who"] for e in self.sim["events"]], ["A", "B"])
        a, b = self.check("A"), self.check("B")
        self.assertEqual((a["verdict"], b["verdict"]), ("VALID", "VALID"))
        self.assertEqual([e["sha256"] for e in a["encounters"]], [self.h])
        c = E.compare(a, b)
        self.assertEqual((c["verdict"], c["met"]), ("AGREE", True))
        # both copies hold each aircraft's own altitude as it believed it, the same bytes
        alt = {k: s["pos"]["alt_m"] for k, s in a["encounters"][0]["body"]["seen"].items()}
        self.assertEqual(alt, {k: s["pos"]["alt_m"] for k, s in b["encounters"][0]["body"]["seen"].items()})
        self.assertGreater(self.sim["lost"], 0, "the link lost no message: the retries were never needed")

    def test_encounter_removed_from_one_log_is_shown_by_the_other_copy(self):
        if CONTROL != "removed":
            T.remove_encounter(self.A, self.h)
        a, b = self.check("A"), self.check("B")
        # one log alone: the check judges its own records, and does not judge a removal; the comparison below does.
        self.assertEqual((a["verdict"], len(a["encounters"])), ("VALID", 0))
        c = E.compare(a, b)
        self.assertEqual(c["verdict"], "MISMATCH")
        self.assertEqual([(r["sha256"], r["status"]) for r in c["rows"]], [(self.h, "mismatch")])
        self.assertTrue(c["rows"][0]["why"].startswith(f"only in {E.short(b['keyid'])}'s log; {E.short(a['keyid'])}'s log has no record of it"))

    def test_altitude_edited_and_resigned_by_its_operator_is_refused_by_the_other_counter_signature(self):
        old_alt = self.check("B")["encounters"][0]["body"]["seen"][E.keyid_of(self.A)]["pos"]["alt_m"]
        new_alt = old_alt + 30.0 if CONTROL != "altitude" else old_alt
        nh = T.edit_altitude(self.A, self.h, new_alt)
        a = self.check("A")
        self.assertEqual(a["notebook"], "VALID")  # signed throughout by A's own key
        probs = a["encounters"][0]["problems"]
        self.assertEqual(len(probs), 1, probs)
        self.assertTrue(probs[0].startswith(f"counter-signature of the other aircraft ({E.short(E.keyid_of(self.B))}): encounter.json is not the "), probs)
        # and the other copy still holds the altitude as it was signed
        b = self.check("B")
        self.assertEqual(b["encounters"][0]["body"]["seen"][E.keyid_of(self.A)]["pos"]["alt_m"], old_alt)
        self.assertNotEqual(nh, self.h)

    def test_an_encounter_recorded_twice_is_refused_as_a_replay(self):
        if CONTROL != "replay":
            T.replay(self.A, self.h)
        a = self.check("A")
        self.assertEqual(a["notebook"], "VALID")
        self.assertEqual([e["problems"] for e in a["encounters"]],
                         [[], ["replay: this encounter is already recorded at record 2"]])

    def test_a_record_file_verify_does_not_read_gives_no_encounter_and_no_agreement(self):
        if CONTROL != "unread":
            T.unread_copy(self.A, self.h)
        a, b = self.check("A"), self.check("B")
        self.assertEqual((a["notebook"], a["encounters"]), ("VALID", []))
        c = E.compare(a, b)
        self.assertEqual(c["verdict"], "MISMATCH")
        self.assertEqual([(r["sha256"], r["status"]) for r in c["rows"]], [(self.h, "mismatch")])

    def test_a_record_verify_refused_gives_no_encounter_line(self):
        seq = T.unsign_record(self.B, self.h) if CONTROL != "refused" else 2
        b = self.check("B")
        self.assertEqual(b["notebook"], "INVALID")
        self.assertEqual(b["encounters"], [])
        self.assertIn(f"record {seq}: notebook.py verify refused it, so no encounter is read from it", b["problems"])
        c = E.compare(self.check("A"), b)
        self.assertEqual([(r["sha256"], r["status"]) for r in c["rows"]], [(self.h, "mismatch")])

    def test_a_record_rewritten_after_verify_read_it_is_not_what_the_checker_reads(self):
        # A's log is rebuilt without the encounter (its bundle kept); right after the real verify
        # returns, the record that held it is written back into the folder handed to the checker.
        seq = [n for n, v, _ in E.notebook_records(self.A) if isinstance(v, str) and v.startswith(f"encounter {self.h} ")][0]
        body = E.rd(os.path.join(self.A, "records", f"{seq}.json"))
        bundle = os.path.join(self.A, "encounters", self.h)
        shutil.copytree(bundle, bundle + ".kept")
        T.remove_encounter(self.A, self.h)
        shutil.move(bundle + ".kept", bundle)
        copy = T.checker_copy(self.A, os.path.join(self.w, "checker-A-late"))
        real = E.run_notebook

        def late_writer(args, stdin=None):
            r = real(args, stdin)
            if args[0] == "verify":
                with open(os.path.join(copy, "records", f"{seq}.json"), "wb") as f:
                    f.write(body)
            return r

        E.run_notebook = late_writer
        self.addCleanup(setattr, E, "run_notebook", real)
        a = E.check_log(copy, os.path.join(self.reg, "A.pin"), self.reg)
        E.run_notebook = real
        self.assertEqual((a["notebook"], a["encounters"]), ("VALID", []))
        c = E.compare(a, self.check("B"))
        self.assertEqual([(r["sha256"], r["status"]) for r in c["rows"]], [(self.h, "mismatch")])

    def _receiver(self, name):
        known = E.read_registry(self.reg)
        return E.Aircraft(name, {"A": self.A, "B": self.B}[name], known, random.Random(99), self.w)

    def _old_seen_of_A(self):
        bundle = os.path.join(self.A, "encounters", self.h)
        i = json.loads(E.rd(os.path.join(bundle, "encounter.json")))["parties"].index(E.keyid_of(self.A))
        return (E.rd(os.path.join(bundle, f"seen.{i}.json")),
                E.rd(os.path.join(bundle, f"seen.{i}.json.sig.json")))

    def test_an_old_seen_message_replayed_in_the_air_is_refused_by_its_nonce(self):
        body, env = self._old_seen_of_A()
        b = self._receiver("B")
        b.outgoing(40.0, self.sim["track"]["B"][400])        # a new exchange: B draws a fresh nonce
        if CONTROL == "replay_air":
            b.nonce = json.loads(body)["nonce_yours"]      # the control: B reuses its old number
        self.assertEqual(b.accept_seen(body, env), "nonce: does not carry the fresh number this aircraft sent (an old message)")

    def _third_aircraft(self):
        c = os.path.join(self.work, "aircraft-C")
        rc, _, err = E.run_notebook(["init", "--dir", c])
        self.assertEqual(rc, 0, err[-200:])
        return c

    def test_a_third_aircraft_pretending_to_be_A_is_refused_in_the_air(self):
        c = self._third_aircraft()
        b = self._receiver("B")
        b.outgoing(40.0, self.sim["track"]["B"][400])
        a_id = E.keyid_of(self.A)
        body = E.canonical({"kind": E.SEEN_KIND, "from": a_id, "to": b.keyid, "nonce_mine": "3" * 32,
                            "nonce_yours": b.nonce, "t_s": 40.0, "pos": {"east_m": 0.0, "north_m": 0.0, "alt_m": 60.0}})
        env = T.sign_file(self.A if CONTROL == "impostor" else c, body, E.SEEN_TYPE)
        self.assertEqual(b.accept_seen(body, env), f"key: signed by {E.keyid_of(c)}, not the pinned {a_id}")

    def test_an_encounter_forged_with_a_third_key_is_refused_by_the_checker(self):
        c = self._third_aircraft()
        a_id = E.keyid_of(self.A)
        T.forge_with_key(self.B, self.A if CONTROL == "forge" else c, a_id, {"east_m": 5.0, "north_m": 5.0, "alt_m": 66.0})
        b = self.check("B")
        self.assertEqual(b["notebook"], "VALID")
        forged = b["encounters"][1]["problems"]
        who = f"the other aircraft ({E.short(a_id)})"
        want = f"signed by {E.keyid_of(c)}, not the pinned {a_id}"
        self.assertEqual(forged, [f"counter-signature of {who}: {want}", f"seen of {who}: {want}"])

    def _swap(self, prefix, half):
        bundle = os.path.join(self.A, "encounters", self.h)
        i = json.loads(E.rd(os.path.join(bundle, "encounter.json")))["parties"].index(E.keyid_of(self.B))
        if CONTROL != "half":
            T.swap_half(bundle, i, prefix)
        probs = self.check("A")["encounters"][0]["problems"]
        self.assertEqual(len(probs), 1, probs)
        self.assertTrue(probs[0].startswith(f"counter-signature of the other aircraft ({E.short(E.keyid_of(self.B))}): {half} signature verification failed"), probs)

    def test_counter_signature_with_only_its_ed25519_half_from_another_payload_is_refused(self):
        self._swap("tet-ed25519:", "ed25519")

    def test_counter_signature_with_only_its_mldsa44_half_from_another_payload_is_refused(self):
        self._swap("tet-mldsa44:", "ml-dsa-44")


    def test_a_folder_the_checker_finds_valid_is_valid_to_verify_on_the_folder_handed_in_with_the_same_record_bytes(self):
        # Over every generated folder (copy_cases.py): when the checker says VALID, notebook.py verify
        # on the folder handed in says VALID, and the record files the checker read hold the bytes
        # verify read there. The honest folder must come out VALID, so the guard is not vacuous.
        base = T.checker_copy(self.A, os.path.join(self.w, "base"))
        pin = os.path.join(self.reg, "A.pin")
        real, seen = E.check_copy, {}

        def spy(*a):
            seen.clear()
            seen.update(C.record_bytes(a[0]))
            return real(*a)

        n, valid = 0, []
        with mock.patch.object(E, "check_copy", spy):
            for label, handed in C.generate(base, os.path.join(self.w, "cases"), top=("chain.json", "chain.txt", "records", "encounters"), sub=("records", os.path.join("encounters", self.h)),
                                            record="records/1.json"):
                n += 1
                seen.clear()
                if E.check_log(handed, pin, self.reg)["verdict"] != "VALID":
                    continue
                valid.append(label)
                rc, out, err = E.run_notebook(["verify", "--dir", handed, "--pin", pin])
                self.assertEqual(out.split()[:1], ["VALID"], label)
                self.assertEqual(seen, C.record_bytes(handed), label)
                self.assertTrue(seen, label)
        sys.stderr.write(f"\n  generated folders: {n}; checker VALID on {len(valid)}: {valid}\n")
        self.assertIn("the honest folder", valid)
        self.assertGreaterEqual(n, 100)

class PrivateCopy(unittest.TestCase):
    """The private copy is taken from the folder handed in and nothing else."""

    def folders(self):
        tmp = tempfile.mkdtemp(prefix="snapshot-test-")
        self.addCleanup(shutil.rmtree, tmp, True)
        handed, outside = os.path.join(tmp, "handed"), os.path.join(tmp, "outside")
        for root, body in ((handed, b"inside"), (outside, b"outside")):
            os.makedirs(os.path.join(root, "records"))
            for i in range(3):
                with open(os.path.join(root, "records", f"{i}.json"), "wb") as f:
                    f.write(body)
        return tmp, handed, outside

    def copy_while_records_is_replaced(self, at_listing):
        # at the given listing (1: the folder handed in, 2: records/), records/ is renamed away and a
        # link to another folder's records/ is put in its place
        tmp, handed, outside = self.folders()
        real, calls = os.listdir, []

        def listdir(p):
            calls.append(p)
            if len(calls) == at_listing:
                os.rename(os.path.join(handed, "records"), os.path.join(tmp, "moved"))
                os.symlink(os.path.join(outside, "records"), os.path.join(handed, "records"))
            return real(p)

        copy = os.path.join(tmp, "copy")
        with mock.patch("os.listdir", listdir):
            try:
                E.snapshot(handed, copy)
            except E.SnapshotRefused as e:
                self.assertEqual(str(e), E.ENTRY_REFUSED)
                self.assertFalse(os.path.exists(copy))
                return None
        self.assertGreaterEqual(len(calls), at_listing)
        got = {}
        for root, _, files in os.walk(copy):
            for n in files:
                p = os.path.join(root, n)
                if not os.path.islink(p):
                    with open(p, "rb") as f:
                        got[os.path.relpath(p, copy)] = f.read()
        return got

    def test_the_private_copy_reads_nothing_outside_the_handed_in_folder_while_it_changes(self):
        got = self.copy_while_records_is_replaced(at_listing=2)
        self.assertEqual(got, {os.path.join("records", f"{i}.json"): b"inside" for i in range(3)})

    def test_the_private_copy_enters_no_folder_replaced_by_a_link_after_listing(self):
        # the whole folder is refused, so nothing is copied from the folder the link names
        self.assertIsNone(self.copy_while_records_is_replaced(at_listing=1))

    def test_a_handed_in_link_to_a_folder_is_refused(self):
        tmp, handed, outside = self.folders()
        link = os.path.join(tmp, "link")
        os.symlink(outside, link)
        with self.assertRaises(E.SnapshotRefused):
            E.snapshot(link, os.path.join(tmp, "copy"))
        self.assertFalse(os.path.exists(os.path.join(tmp, "copy")))

    def refused_reason(self, tmp, handed_in):
        copy = os.path.join(tmp, "copy")
        with self.assertRaises(E.SnapshotRefused) as cm:
            E.snapshot(handed_in, copy)
        self.assertFalse(os.path.exists(copy), handed_in)
        return str(cm.exception)

    def test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled(self):
        tmp, handed, outside = self.folders()
        link = os.path.join(tmp, "link")
        os.symlink(outside, link)
        for spelling in ("", "/", "/.", "//", "/./", "/./.", "/.//./"):
            self.assertEqual(self.refused_reason(tmp, link + spelling), E.TOP_REFUSED, spelling)

    def test_a_handed_in_path_ending_in_dotdot_is_refused(self):
        tmp, handed, outside = self.folders()
        link = os.path.join(tmp, "link")
        os.symlink(outside, link)
        for handed_in in (link + "/records/..", link + "/records/../", link + "/records/../.",
                          handed + "/records/.."):
            self.assertEqual(self.refused_reason(tmp, handed_in), E.TOP_REFUSED, handed_in)

    def test_a_handed_in_folder_spelled_with_a_trailing_slash_is_copied(self):
        tmp, handed, outside = self.folders()
        for spelling in ("/", "/.", "/./"):
            copy = os.path.join(tmp, "copy")
            E.snapshot(handed + spelling, copy)
            for i in range(3):
                with open(os.path.join(copy, "records", f"{i}.json"), "rb") as f:
                    self.assertEqual(f.read(), b"inside", spelling)
            shutil.rmtree(copy)

    @unittest.skip("a folder holding a link is refused whole; replaced by "
                   "test_a_folder_holding_an_entry_that_is_not_a_plain_folder_or_file_is_refused_whole")
    def test_a_link_to_nothing_in_the_copy_resolves_to_nothing_whatever_the_folder_holds(self):
        # records/ is a link to another folder; the copy's records/ must be a link that reaches
        # nothing, whatever names the folder holds.
        tmp, handed, outside = self.folders()
        os.rename(os.path.join(handed, "records"), os.path.join(handed, "not-a-regular-file"))
        os.symlink(os.path.join(outside, "records"), os.path.join(handed, "records"))
        copy = os.path.join(tmp, "copy")
        E.snapshot(handed, copy)
        self.assertTrue(os.path.islink(os.path.join(copy, "records")))
        self.assertFalse(os.path.exists(os.path.join(copy, "records")))
        self.assertFalse(os.path.exists(os.path.join(copy, "records", "0.json")))


    def refused_whole(self, handed):
        copy = os.path.join(os.path.dirname(handed), "copy")
        with self.assertRaises(E.SnapshotRefused) as cm:
            E.snapshot(handed, copy)
        self.assertFalse(os.path.exists(copy))
        return str(cm.exception)

    def test_a_folder_holding_an_entry_that_is_not_a_plain_folder_or_file_is_refused_whole(self):
        for kind in C.EXTRA_KINDS[2:]:
            tmp, handed, outside = self.folders()
            C._extra(os.path.join(handed, "records"), "x", kind, outside, os.path.join(handed, "records", "0.json"))
            self.assertEqual(self.refused_whole(handed), E.ENTRY_REFUSED, kind)

    def test_a_folder_holding_an_entry_whose_name_is_not_plain_is_refused_whole(self):
        for name in C.NAMES + ("RECORDS",):
            tmp, handed, outside = self.folders()
            if name == "RECORDS":
                os.rename(os.path.join(handed, "records"), os.path.join(handed, "r.tmp"))
                os.rename(os.path.join(handed, "r.tmp"), os.path.join(handed, name))
            else:
                C._extra(os.path.join(handed, "records"), name, "file", None, None)
            self.assertEqual(self.refused_whole(handed), E.ENTRY_REFUSED, name)


if __name__ == "__main__":
    unittest.main()
