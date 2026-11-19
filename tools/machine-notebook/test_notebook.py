#!/usr/bin/env python3
"""Guard for the machine notebook (notebook.py): a broken log must read INVALID, for the right reason.

    python3 tools/machine-notebook/test_notebook.py      (TET_CLI=path/to/tet-cli, else target/release/tet-cli)

Three records under a temporary device key, then:
  (a) untouched                                  -> VALID
  (b) one byte of record 2 flipped               -> INVALID, record 2's signature
  (c) records 2 and 3 swapped                    -> INVALID, record 2's seq
  (d) record 2 deleted                           -> INVALID, the gap in seq
  (e) record 2 re-signed with the device's own key, right seq, but a prev that doesn't name
      record 1, and chain.txt rewritten to match -> INVALID, record 2's prev
(e) is the only case that ONLY the prev check can catch: (b) to (d) also break a signature or the seq,
so without (e) the prev check could be deleted and every case would still go INVALID.
Each case asserts the reason it is named for, not just INVALID.

One-time permits (a permit the device key signs; a record may cite its id):
  (f) a permit cited once, at its last open seq   -> VALID, and verify names the use
  (g) the same permit cited by two records        -> INVALID, "was already used by record 4"
  (h) a permit cited one record after expires_seq -> INVALID, "expired after seq 3"
  (i) a permit another key signed, validly        -> INVALID, "is signed by <that key>, not this device's"
  (j) a permit whose expires_seq was edited after signing -> INVALID, the permit's signature
  (k) one permit copied under a second file name  -> INVALID, the second name "holds permit <first>"
  (l) a cited permit that is not in the notebook  -> INVALID, "is not in this notebook"
  (m) the permit's bytes signed as a log record   -> INVALID, the permit's payload type
  (n) `record --permit` on a used permit          -> refused (exit 2), nothing written, log still VALID

The pin (verify --pin: both key ids of the expected signer, from a file kept outside the folder). The
check pins both keys, so each half is tested on its own (CLAUDE.md C4): the envelope gets a VALID
signature over the same bytes from another device for ONE half, which tet-cli agent verify accepts, so
only the pin can refuse it.
  (o) a record's ML-DSA-44 half from another device -> INVALID, that one line
  (p) a record's Ed25519 half from another device   -> INVALID, that one line
  (q) a permit's ML-DSA-44 half from another device -> INVALID, that one line
  (r) a permit's Ed25519 half from another device   -> INVALID, that one line
  (s) another device's whole, intact log            -> INVALID against this device's pin, VALID against
      its own: the pin comes from --pin, never from the folder
  (t) --pin pointing inside the folder              -> refused (exit 2): by path, through .. or a
      symlink, as a hard link, and by another spelling of the path where the file system allows it;
      and a symlink in the folder to a correct pin outside it is refused too, so the folder cannot
      choose which outside file is read as the pin
  verify --node: a hash record with one half from another device does not count as this device's,
  and neither does another device's hash record saved in the folder.

What a handed-over folder holds:
  (y) export                                               -> chain, records and permits only, the
      same bytes, VALID; no device.key, device.head or pin
      verify on a folder holding device.key                -> its last line says to hand over an export
      export of a folder with a hard link to device.key or device.head -> refused, nothing written
      export of a folder where device.key was moved under a log file's name (with or without a
      stand-in device.key)                                  -> refused, nothing written: export copies
      only files that parse as what their name says
      export with that check turned off, and a hard link to the file a symlinked device.key points
      to                                                    -> refused: the device's own files are
      matched by the link and by its target

record continues a log only where the device last signed it (device.head, outside chain.txt):
  (x) the newest record removed, then record               -> refused, nothing written
      a permit's record removed, then record --permit       -> refused, the permit is not cited again
      chain.txt's last line changed, same length            -> refused
      record stopped after signing (chain.txt not writable), that record removed -> refused
      record --permit with an earlier record moved out of records/ -> refused, not cited again
      a record named in non-ASCII digits                     -> not a record (verify: count differs)
      no device.head                                         -> refused
      two record runs at once citing one permit (tet-cli slowed so both are inside the check)
                                                             -> one records, the other is refused
                                                                because the permit is used: one
                                                                record under each number
      a record run while another holds device.lock          -> waits, then refused, nothing written
      a record run waiting for its stdin                     -> does not hold up another run
      a record file that appears after record's own check   -> not overwritten, not signed
      a reading with a line break                            -> record prints it on one line
      verify names the newest record and its hash; with the newest removed it still reads VALID
      (nothing in the folder can tell) and names the one before

Every file verify reads is read once, and tet-cli checks those same bytes. A wrapper around the real
tet-cli changes ONE file in the folder on one call, so each input is broken on its own:
  (w) record 3's bytes changed just before tet-cli reads them   -> INVALID, record 3's signature
      record 3's envelope changed just after tet-cli read it    -> INVALID, record 3's key
      a permit's bytes changed just before tet-cli reads them   -> INVALID, the permit's signature
      a permit's envelope changed just after tet-cli read it    -> INVALID, the permit's key
      record 3 is a FIFO                                        -> INVALID, "not a regular file"
      tet-cli's reason names the record's path in the folder, not the temporary copy it was given

Text from the folder never begins a line of verify's report:
  (z) a permit signed by the device whose action is not a short name -> not a permit (one problem)
      a permit signed by the device whose permit_id is not 32 hex    -> not a permit (one problem)
      a record whose seq holds a line break                          -> printed as \u000a, on the
                                                                        problem's own line

The Shows / Does not show lists verify prints are pinned word for word, in notebook.py, in the
README and in QUICKSTART.md's verify output (the try page and /agents show the same words); a changed word, a dropped or swapped item and
swapped lists are each caught.
(g) to (m) build the bad log by hand, because `record` refuses a bad citation before writing it. In
each, the permit passes every check except the one the case is named for, and the case asserts that
verify reports exactly that one problem: a record that is INVALID for two reasons proves neither check.

publish is checked against a local stub (no node is contacted): the body is {record_b64, consent_b64},
the record is a hash-only envelope over the log record's SHA-256, and the consent is the same key
over the record's exact SHA-256 (tet-core/src/sigs.rs, verify_consent).

tet-cli is required: without it this fails, it does not skip.
"""

import base64
import contextlib
import fcntl
import hashlib
import http.server
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # no __pycache__ left in the tree
import notebook  # noqa: E402

CLI = os.environ.get("TET_CLI") or os.path.join(ROOT, "target", "release", "tet-cli")
CHAIN = {"TET_CHAIN_ID": "tet-notebook-test", "TET_GENESIS_HASH": hashlib.sha256(b"machine notebook test").hexdigest()}


def nb_err(*argv, stdin=""):
    """Run notebook.main in-process; returns (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    old_stdin = sys.stdin
    sys.stdin = io.StringIO(stdin)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = notebook.main(["--tet-cli", CLI, *argv])
    finally:
        sys.stdin = old_stdin
    return rc, out.getvalue(), err.getvalue()


def nb(*argv, stdin=""):
    """Run notebook.main in-process; returns (exit code, stdout)."""
    rc, out, _ = nb_err(*argv, stdin=stdin)
    return rc, out


class Notebook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.access(CLI, os.X_OK):
            raise RuntimeError(f"tet-cli not found at {CLI}: RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release, or set TET_CLI")
        cls.tmp = tempfile.mkdtemp()
        cls.base = os.path.join(cls.tmp, "base")
        old = {k: os.environ.get(k) for k in CHAIN}
        os.environ.update(CHAIN)
        try:
            rc, out = nb("init", "--dir", cls.base)
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        assert rc == 0, out
        cls.keyid = out.strip()
        # The pin, kept OUTSIDE the folder: verify must not take it from the folder it checks.
        cls.pin = os.path.join(cls.tmp, "base.pin")
        shutil.copy(os.path.join(cls.base, "device.pin"), cls.pin)
        cls.other = None
        for v in (20.5, 21.5, 22.5):
            rc, out = nb("record", "--dir", cls.base, "--source", "stdin-json", stdin=json.dumps({"value": v, "unit": "celsius"}))
            assert rc == 0, out

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def copy(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        shutil.rmtree(d)
        shutil.copytree(self.base, d)
        return d

    def rec(self, d, n):
        return os.path.join(d, "records", f"{n}.json")

    def assertInvalidBecause(self, d, reason):
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual(rc, 1, out)
        self.assertEqual(out.splitlines()[0], "INVALID", out)
        self.assertIn(reason, out, f"INVALID, but not for the reason this case is named for:\n{out}")

    def test_init_prints_only_the_key_id_and_keeps_the_phrase_private(self):
        self.assertRegex(self.keyid, r"^tet-ed25519:[0-9a-f]{64}$")
        with open(self.pin) as f:
            self.assertRegex(f.read(), r"^tet-ed25519:[0-9a-f]{64}\ntet-mldsa44:[0-9a-f]{64}\n$")
        self.assertEqual(notebook.read_pin(self.pin)[0], self.keyid)
        key = os.path.join(self.base, "device.key")
        self.assertEqual(os.stat(key).st_mode & 0o777, 0o600)
        with open(key) as f:
            phrase = f.read().strip()
        self.assertEqual(len(phrase.split()), 12)
        for root, _, files in os.walk(self.base):
            for name in files:
                if name != "device.key":
                    with open(os.path.join(root, name), "rb") as f:
                        self.assertNotIn(phrase.split()[0] + " " + phrase.split()[1], f.read().decode(errors="replace"), name)
        rc, _ = nb("init", "--dir", self.base)
        self.assertEqual(rc, 2, "init must refuse an existing device.key")

    def test_init_keeps_the_genesis_hash_exactly_as_get_chain_gives_it(self):
        # A node's GET /chain says "0x…", and the signature binds that exact string.
        d = os.path.join(self.tmp, "chain-0x")
        g = "0x" + hashlib.sha256(b"a node's genesis").hexdigest()
        old = {k: os.environ.get(k) for k in CHAIN}
        os.environ.update({"TET_CHAIN_ID": "tet-notebook-test", "TET_GENESIS_HASH": g})
        try:
            rc, out = nb("init", "--dir", d)
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        self.assertEqual(rc, 0, out)
        self.assertEqual(notebook.chain_env(d)["TET_GENESIS_HASH"], g)

    def test_a_record_carries_clock_utc_and_nothing_else(self):
        with open(self.rec(self.base, 1), "rb") as f:
            rec = json.loads(f.read())
        self.assertEqual(set(rec), {"v", "kind", "seq", "prev", "reading", "clock_utc"})
        self.assertRegex(rec["clock_utc"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_a_untouched_log_is_valid(self):
        rc, out = nb("verify", "--pin", self.pin, "--dir", self.copy())
        self.assertEqual(rc, 0, out)
        self.assertEqual(out.splitlines()[0], "VALID")
        self.assertIn(f"3 records, all signed by {self.keyid}", out)
        self.assertIn("stamp: not checked (no node)", out)
        for line in notebook.SHOWS + notebook.DOES_NOT_SHOW:
            self.assertIn(line, out)

    # The two lists are the claim the tool makes; the try page and /agents show them word for word.
    # PINNED here so a change to the wording is a reviewed change to this file too.
    PINNED_SHOWS = [
        "which key signed each record",
        "that the records are in this order",
        "that each record names the hash of the one before it",
        "that no one-time permission was used twice in this log, or after it ran out",
    ]
    PINNED_DOES_NOT_SHOW = [
        "that the reading is true",
        "that the machine's clock was right",
        "where the machine was",
        "who runs the machine",
        "that the key was not copied",
        "that a copied key did not use the same permission in another log",
        "that the log is complete: its newest records may be missing, or rewritten by whoever holds the key",
        "that the signature format is final: it is in outside review, and logs from this test may need re-signing",
    ]

    @staticmethod
    def printed_lists(text, shows_head, does_not_head, bullet):
        """The bullets under each heading, in order, from verify's stdout or the README."""
        lines = text.splitlines()

        def block(head):
            if head not in lines:
                return None
            out = []
            for ln in lines[lines.index(head) + 1:]:
                if not ln.startswith(bullet):
                    break
                out.append(ln[len(bullet):])
            return out

        return block(shows_head), block(does_not_head)

    def lists_problems(self, verify_out, readme, quickstart=None):
        """Every place the printed lists, the README's or QUICKSTART.md's differ from the pinned ones."""
        want = (self.PINNED_SHOWS, self.PINNED_DOES_NOT_SHOW)
        out = []
        if (notebook.SHOWS, notebook.DOES_NOT_SHOW) != want:
            out.append("notebook.py's SHOWS / DOES_NOT_SHOW differ from the pinned lists")
        if self.printed_lists(verify_out, "Shows:", "Does not show:", "  - ") != want:
            out.append("verify printed other lists")
        if self.printed_lists(readme, "Shows:", "Does not show:", "- ") != want:
            out.append("README.md quotes other lists")
        if quickstart is not None and self.printed_lists(quickstart, "Shows:", "Does not show:", "  - ") != want:
            out.append("QUICKSTART.md quotes other lists")
        return out

    def test_verify_prints_exactly_the_two_lists_and_the_readme_quotes_them(self):
        rc, out = nb("verify", "--pin", self.pin, "--dir", self.copy())
        self.assertEqual(rc, 0, out)
        with open(os.path.join(HERE, "README.md")) as f:
            readme = f.read()
        with open(os.path.join(HERE, "QUICKSTART.md")) as f:
            quick = f.read()
        self.assertEqual(self.lists_problems(out, readme, quick), [])
        # Control: a changed word, a dropped item, swapped items and swapped lists are each caught,
        # in the printed output and in the README.
        s, d = self.PINNED_SHOWS, self.PINNED_DOES_NOT_SHOW
        changed = out.replace(s[2], s[2].replace("before", "after"))
        dropped = out.replace(f"  - {d[-1]}\n", "")
        swapped_items = out.replace(f"  - {s[0]}\n  - {s[1]}\n", f"  - {s[1]}\n  - {s[0]}\n")
        swapped_lists = out.replace("Shows:", "X:").replace("Does not show:", "Shows:").replace("X:", "Does not show:")
        for name, bad in (("changed", changed), ("dropped", dropped), ("swapped items", swapped_items), ("swapped lists", swapped_lists)):
            self.assertNotEqual(bad, out, f"control {name} did not take")
            self.assertTrue(self.lists_problems(bad, readme), f"control {name} passed")
            bad_readme = {
                "changed": readme.replace(s[2], s[2].replace("before", "after")),
                "dropped": readme.replace(f"- {d[-1]}\n", ""),
                "swapped items": readme.replace(f"- {s[0]}\n- {s[1]}\n", f"- {s[1]}\n- {s[0]}\n"),
                "swapped lists": readme.replace("Shows:", "X:").replace("Does not show:", "Shows:").replace("X:", "Does not show:"),
            }[name]
            self.assertNotEqual(bad_readme, readme, f"README control {name} did not take")
            self.assertTrue(self.lists_problems(out, bad_readme), f"README control {name} passed")
            # QUICKSTART.md quotes verify's output inside a console block, with verify's own bullets.
            bad_quick = {
                "changed": quick.replace(s[2], s[2].replace("before", "after")),
                "dropped": quick.replace(f"  - {d[-2]}\n", ""),
                "swapped items": quick.replace(f"  - {s[0]}\n  - {s[1]}\n", f"  - {s[1]}\n  - {s[0]}\n"),
                "swapped lists": quick.replace("Shows:", "X:").replace("Does not show:", "Shows:").replace("X:", "Does not show:"),
            }[name]
            self.assertNotEqual(bad_quick, quick, f"QUICKSTART control {name} did not take")
            self.assertEqual(self.lists_problems(out, readme, bad_quick), ["QUICKSTART.md quotes other lists"], f"QUICKSTART control {name}")

    def test_b_one_flipped_byte_in_record_2_is_invalid(self):
        d = self.copy()
        with open(self.rec(d, 2), "rb") as f:
            b = bytearray(f.read())
        i = b.index(b"21.5")
        b[i + 1] ^= 0x01  # "21.5" -> "20.5": still canonical JSON, still parses
        with open(self.rec(d, 2), "wb") as f:
            f.write(b)
        self.assertInvalidBecause(d, "record 2: signature:")

    def test_c_records_2_and_3_swapped_is_invalid(self):
        d = self.copy()
        for suffix in ("", ".sig.json"):
            a, b = self.rec(d, 2) + suffix, self.rec(d, 3) + suffix
            os.rename(a, a + ".tmp")
            os.rename(b, a)
            os.rename(a + ".tmp", b)
        self.assertInvalidBecause(d, "record 2: seq: says 3")

    def test_d_record_2_deleted_is_invalid(self):
        d = self.copy()
        os.remove(self.rec(d, 2))
        os.remove(self.rec(d, 2) + ".sig.json")
        self.assertInvalidBecause(d, "seq: file 3.json where record 2 should be")

    def test_e_resigned_record_2_with_a_wrong_prev_is_invalid(self):
        d = self.copy()
        with open(self.rec(d, 2), "rb") as f:
            rec = json.loads(f.read())
        rec["prev"] = notebook.ZERO  # a validly signed record that does not chain to record 1
        body = notebook.canonical(rec)
        with open(self.rec(d, 2), "wb") as f:
            f.write(body)
        notebook.sign(CLI, d, self.rec(d, 2), notebook.PAYLOAD_TYPE)
        with open(os.path.join(d, "chain.txt")) as f:
            chain = f.read().split()
        chain[1] = hashlib.sha256(body).hexdigest()
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.write("\n".join(chain) + "\n")
        self.assertInvalidBecause(d, "record 2: prev:")

    # ── one-time permits ──────────────────────────────────────────────────────────────────────

    READING = json.dumps({"value": 1, "unit": "count"})

    def permit(self, d, expires_seq):
        rc, out = nb("permit", "--dir", d, "--action", "open-valve", "--expires-seq", str(expires_seq))
        self.assertEqual(rc, 0, out)
        return out.strip()

    def permit_path(self, d, pid):
        return os.path.join(d, "permits", f"{pid}.json")

    def cite(self, d, pid):
        """Append a record citing `pid`, signed with the device's own key, WITHOUT going through
        `record`: `record` refuses a bad citation up front, and verify must be shown the bad log."""
        chain = notebook.chain_lines(d)
        seq = len(chain) + 1
        rec = {"v": 1, "kind": notebook.KIND, "seq": seq, "prev": chain[-1], "permit": pid,
               "reading": {"source": "stdin-json", "value": 1, "unit": "count"}, "clock_utc": "2026-11-12T00:00:00Z"}
        body = notebook.canonical(rec)
        with open(self.rec(d, seq), "wb") as f:
            f.write(body)
        notebook.sign(CLI, d, self.rec(d, seq), notebook.PAYLOAD_TYPE)
        with open(os.path.join(d, "chain.txt"), "a") as f:
            f.write(hashlib.sha256(body).hexdigest() + "\n")
        notebook.write_head(d, seq, hashlib.sha256(body).hexdigest())  # as record does after signing
        return seq

    def assertOnlyProblem(self, d, reason, prefix=False):
        """verify says INVALID and lists exactly one problem: the one this case is named for."""
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual(rc, 1, out)
        lines = out.splitlines()
        self.assertEqual(lines[0], "INVALID", out)
        problems = [ln.strip() for ln in lines[1:lines.index("Shows:")]]
        self.assertEqual(len(problems), 1, f"not exactly the one problem this case is named for:\n{out}")
        if prefix:
            self.assertTrue(problems[0].startswith(reason), out)
        else:
            self.assertEqual(problems[0], reason, out)

    def test_f_a_permit_cited_once_before_it_expires_is_valid(self):
        d = self.copy()
        pid = self.permit(d, 4)  # open until record 4, and record 4 cites it: the last seq allowed
        self.assertRegex(pid, r"^[0-9a-f]{32}$")
        with open(self.permit_path(d, pid), "rb") as f:
            permit = json.loads(f.read())
        self.assertEqual(permit, {"kind": "tet_machine_permit_v1", "permit_id": pid, "action": "open-valve", "expires_seq": 4})
        with open(self.permit_path(d, pid) + ".sig.json") as f:
            env = json.load(f)
        self.assertEqual((env["payloadType"], notebook.ed_keyid(env)), (notebook.PERMIT_PAYLOAD_TYPE, self.keyid))
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=self.READING)
        self.assertEqual(rc, 0, out)
        with open(self.rec(d, 4), "rb") as f:
            self.assertEqual(json.loads(f.read())["permit"], pid)
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual(rc, 0, out)
        self.assertEqual(out.splitlines()[0], "VALID")
        self.assertIn(f"permit {pid} (open-valve): used once, by record 4; open until seq 4", out)

    def test_g_the_same_permit_cited_twice_is_invalid(self):
        d = self.copy()
        pid = self.permit(d, 9)  # open well past both records, so only the reuse can be wrong
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=self.READING)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.cite(d, pid), 5)
        self.assertOnlyProblem(d, f"record 5: permit: {pid} was already used by record 4")

    def test_h_a_permit_cited_after_expires_seq_is_invalid(self):
        d = self.copy()
        pid = self.permit(d, 3)  # the log already holds 3 records, so record 4 is one too late
        self.assertEqual(self.cite(d, pid), 4)
        self.assertOnlyProblem(d, f"record 4: permit: {pid} expired after seq 3")

    def test_i_a_permit_signed_by_another_key_is_invalid(self):
        d = self.copy()
        # Another device on the same chain signs a perfectly good permit: its envelope verifies, it is
        # open, it is cited once. Only "whose key is this?" can refuse it.
        other = os.path.join(self.tmp, "other-permit")
        old = {k: os.environ.get(k) for k in CHAIN}
        os.environ.update(CHAIN)
        try:
            rc, out = nb("init", "--dir", other)
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        self.assertEqual(rc, 0, out)
        other_keyid = out.strip()
        self.assertNotEqual(other_keyid, self.keyid)
        pid = self.permit(other, 9)
        os.makedirs(os.path.join(d, "permits"))
        for suffix in ("", ".sig.json"):
            shutil.copy(self.permit_path(other, pid) + suffix, self.permit_path(d, pid) + suffix)
        self.assertEqual(self.cite(d, pid), 4)
        self.assertOnlyProblem(d, f"record 4: permit: {pid} is signed by {other_keyid}, not this device's {self.keyid}")

    def test_j_a_permit_edited_after_signing_is_invalid(self):
        d = self.copy()
        pid = self.permit(d, 3)
        with open(self.permit_path(d, pid), "rb") as f:
            body = f.read()
        edited = body.replace(b'"expires_seq":3', b'"expires_seq":9')  # still canonical, now "open" at record 4
        self.assertNotEqual(edited, body)
        with open(self.permit_path(d, pid), "wb") as f:
            f.write(edited)
        self.assertEqual(self.cite(d, pid), 4)
        self.assertOnlyProblem(d, f"record 4: permit: {pid}: signature:", prefix=True)

    def test_k_one_permit_under_two_names_is_invalid(self):
        d = self.copy()
        pid = self.permit(d, 9)
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=self.READING)
        self.assertEqual(rc, 0, out)
        alias = hashlib.sha256(pid.encode()).hexdigest()[:32]
        for suffix in ("", ".sig.json"):
            shutil.copy(self.permit_path(d, pid) + suffix, self.permit_path(d, alias) + suffix)
        self.assertEqual(self.cite(d, alias), 5)  # a second citation of the same signed permit, by another name
        self.assertOnlyProblem(d, f"record 5: permit: {alias}.json holds permit {pid}")

    def test_l_a_cited_permit_that_is_not_in_the_notebook_is_invalid(self):
        d = self.copy()
        pid = "ab" * 16
        self.assertEqual(self.cite(d, pid), 4)
        self.assertOnlyProblem(d, f"record 4: permit: {pid} is not in this notebook")

    def test_m_permit_bytes_signed_as_a_log_record_are_not_a_permit(self):
        d = self.copy()
        pid = self.permit(d, 9)
        # The device's own key over the very same bytes, but as a log record: replaces the envelope.
        notebook.sign(CLI, d, self.permit_path(d, pid), notebook.PAYLOAD_TYPE)
        self.assertEqual(self.cite(d, pid), 4)
        self.assertOnlyProblem(d, f"record 4: permit: {pid}: payload type is '{notebook.PAYLOAD_TYPE}', not {notebook.PERMIT_PAYLOAD_TYPE}")

    def test_n_record_refuses_a_used_permit_and_writes_nothing(self):
        d = self.copy()
        pid = self.permit(d, 9)
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=self.READING)
        self.assertEqual(rc, 0, out)
        rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=self.READING)
        self.assertEqual(rc, 2, out)
        self.assertIn(f"not recorded: permit: {pid} was already used by record 4", err)
        self.assertFalse(os.path.exists(self.rec(d, 5)))
        self.assertEqual(len(notebook.chain_lines(d)), 4)
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)

    # ── the pin: both keys of the expected signer ─────────────────────────────────────────────

    def other_device(self):
        """A second device on the same chain (made once): the donor of one valid half."""
        if type(self).other is None:
            o = os.path.join(self.tmp, "other-halves")
            old = {k: os.environ.get(k) for k in CHAIN}
            os.environ.update(CHAIN)
            try:
                rc, out = nb("init", "--dir", o)
            finally:
                for k, v in old.items():
                    os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
            self.assertEqual(rc, 0, out)
            type(self).other = o
        return type(self).other

    @staticmethod
    def splice(env, donor, prefix, tet_field):
        """`env` with ONE half (its signature, key id and public key) taken from `donor`."""
        out = json.loads(json.dumps(env))
        out["signatures"] = [s for s in out["signatures"] if not s["keyid"].startswith(prefix)] + [
            next(s for s in donor["signatures"] if s["keyid"].startswith(prefix))
        ]
        out["tet"][tet_field] = donor["tet"][tet_field]
        return out

    HALVES = {"ml": (notebook.ML, "agent_mldsa44_pubkey_b64"), "ed": (notebook.ED, "agent_ed25519_pubkey_hex")}

    def splice_file(self, d, payload, payload_type, half):
        """Replace `payload`'s envelope half `half` with the other device's valid one over the same
        bytes; returns the other device's key id for that half. tet-cli must still accept the
        envelope, or the case would be measuring the signature check instead of the pin."""
        o = self.other_device()
        donor_path = os.path.join(self.tmp, "donor.sig.json")
        notebook.sign(CLI, o, payload, payload_type, out=donor_path)
        with open(donor_path) as f:
            donor = json.load(f)
        with open(payload + ".sig.json") as f:
            env = json.load(f)
        prefix, field = self.HALVES[half]
        spliced = self.splice(env, donor, prefix, field)
        self.assertNotEqual(spliced, env)
        with open(payload + ".sig.json", "w") as f:
            json.dump(spliced, f)
        rc, out, _ = notebook.run_cli(CLI, ["agent", "verify", "--sig", payload + ".sig.json", "--payload", payload], notebook.chain_env(d))
        self.assertEqual(rc, 0, f"tet-cli refused the spliced envelope, so the pin is never reached:\n{out}")
        return notebook.half_keyids(donor)[0 if half == "ed" else 1]

    def test_o_a_record_with_another_devices_mldsa_half_is_invalid(self):
        d = self.copy()
        other_ml = self.splice_file(d, self.rec(d, 2), notebook.PAYLOAD_TYPE, "ml")
        ml = notebook.read_pin(self.pin)[1]
        self.assertOnlyProblem(d, f"record 2: key: its ML-DSA-44 half is signed by {other_ml}, not this device's {ml}")

    def test_p_a_record_with_another_devices_ed25519_half_is_invalid(self):
        d = self.copy()
        other_ed = self.splice_file(d, self.rec(d, 2), notebook.PAYLOAD_TYPE, "ed")
        # Two lines, both named: the pin's, and the whole-log "different keys" line (it compares Ed25519
        # key ids). Asserting the exact list keeps the pin's line from being optional.
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (1, "INVALID"), out)
        lines = out.splitlines()
        self.assertEqual(
            [ln.strip() for ln in lines[1:lines.index("Shows:")]],
            [f"record 2: key: signed by {other_ed}, not this device's {self.keyid}", "log: key: 2 different keys signed this log"],
            out,
        )

    def test_q_a_permit_with_another_devices_mldsa_half_is_invalid(self):
        d = self.copy()
        pid = self.permit(d, 9)
        other_ml = self.splice_file(d, self.permit_path(d, pid), notebook.PERMIT_PAYLOAD_TYPE, "ml")
        self.assertEqual(self.cite(d, pid), 4)
        ml = notebook.read_pin(self.pin)[1]
        self.assertOnlyProblem(d, f"record 4: permit: {pid}: its ML-DSA-44 half is signed by {other_ml}, not this device's {ml}")
        # record refuses it before writing, with the same reason (its pin is the device's own key).
        rc, _, err = nb_err("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=self.READING)
        self.assertEqual(rc, 2, err)
        self.assertIn(f"its ML-DSA-44 half is signed by {other_ml}", err)

    def test_r_a_permit_with_another_devices_ed25519_half_is_invalid(self):
        d = self.copy()
        pid = self.permit(d, 9)
        other_ed = self.splice_file(d, self.permit_path(d, pid), notebook.PERMIT_PAYLOAD_TYPE, "ed")
        self.assertEqual(self.cite(d, pid), 4)
        self.assertOnlyProblem(d, f"record 4: permit: {pid} is signed by {other_ed}, not this device's {self.keyid}")

    # The cuts of tet-core/src/testdata/agent_halves_v1.json (one signature half removed, emptied or
    # relabelled), applied here to a record this notebook signed. Removing a half needs no key, so the
    # record is cut, not re-signed.
    HALVES_FIXTURE = os.path.join(ROOT, "tet-core", "src", "testdata", "agent_halves_v1.json")

    def test_u_a_record_cut_to_one_signature_half_is_invalid(self):
        ed, ml = notebook.ED, notebook.ML

        def half(env, prefix):
            return next(s for s in env["signatures"] if s["keyid"].startswith(prefix))

        def relabel(env, prefix, new):
            h = half(env, prefix)
            h["keyid"] = new + h["keyid"][len(prefix):]

        cuts = {
            "ed25519_only": lambda e: e.__setitem__("signatures", [half(e, ed)]),
            "mldsa44_only": lambda e: e.__setitem__("signatures", [half(e, ml)]),
            "ed25519_sig_empty": lambda e: half(e, ed).__setitem__("sig", ""),
            "mldsa44_sig_empty": lambda e: half(e, ml).__setitem__("sig", ""),
            "ed25519_label_changed": lambda e: relabel(e, ed, "tet-ed448:"),
            "mldsa44_label_changed": lambda e: relabel(e, ml, "tet-mldsa65:"),
        }
        with open(self.HALVES_FIXTURE) as f:
            names = [c["name"] for c in json.load(f)["cases"]]
        self.assertEqual(names, list(cuts), "the fixture's cases changed; add each new cut here")
        with open(self.pin) as f:
            pin_ed, pin_ml = f.read().split()
        count = "record 2: signature: expected exactly 2 signatures (ed25519 + ml-dsa-44), got 1"
        # tet-cli refuses the envelope, and the pin check refuses the half it cannot find: two checks,
        # each naming the half, so both lines are asserted. With no Ed25519 half, record 2 has no
        # signer, and the log reads as signed by two keys.
        two_keys = "log: key: 2 different keys signed this log"
        want = {
            "ed25519_only": [count, f"record 2: key: its ML-DSA-44 half is signed by None, not this device's {pin_ml}"],
            "mldsa44_only": [count, f"record 2: key: signed by None, not this device's {pin_ed}", two_keys],
            "ed25519_sig_empty": ["record 2: signature: ed25519 signature verification failed:"],
            "mldsa44_sig_empty": ["record 2: signature: ml-dsa-44 signature verification failed: mldsa signature must be 2420 bytes for this level (got 0)"],
            "ed25519_label_changed": ["record 2: signature: missing or duplicated ed25519 signature", f"record 2: key: signed by None, not this device's {pin_ed}", two_keys],
            "mldsa44_label_changed": ["record 2: signature: missing or duplicated ml-dsa-44 signature", f"record 2: key: its ML-DSA-44 half is signed by None, not this device's {pin_ml}"],
        }
        for name, cut in cuts.items():
            with self.subTest(name):
                d = self.copy()
                sig = self.rec(d, 2) + ".sig.json"
                with open(sig) as f:
                    env = json.load(f)
                cut(env)
                with open(sig, "w") as f:
                    json.dump(env, f)
                rc, out = nb("verify", "--pin", self.pin, "--dir", d)
                self.assertEqual(rc, 1, out)
                lines = out.splitlines()
                self.assertEqual(lines[0], "INVALID", out)
                problems = [ln.strip() for ln in lines[1:lines.index("Shows:")]]
                self.assertEqual(len(problems), len(want[name]), f"{name}:\n{out}")
                for got, expected in zip(problems, want[name]):
                    if expected.endswith(":"):
                        self.assertTrue(got.startswith(expected), f"{name}: {got!r}")
                    else:
                        self.assertEqual(got, expected, name)

    def test_s_the_pin_comes_from_outside_the_folder(self):
        # Another device's intact log, with its own device.keyid and device.pin inside: INVALID against
        # this pin, VALID against its own.
        o = os.path.join(self.tmp, "whole-other-log")
        shutil.copytree(self.other_device(), o)
        for v in (1, 2):
            rc, out = nb("record", "--dir", o, "--source", "stdin-json", stdin=json.dumps({"value": v, "unit": "count"}))
            self.assertEqual(rc, 0, out)
        other_ed = notebook.read_pin(os.path.join(o, "device.pin"))[0]
        rc, out = nb("verify", "--pin", self.pin, "--dir", o)
        self.assertEqual((rc, out.splitlines()[0]), (1, "INVALID"), out)
        self.assertIn(f"record 1: key: signed by {other_ed}, not this device's {self.keyid}", out)
        # Control: the same folder against its own pin, copied out, is VALID.
        own = os.path.join(self.tmp, "whole-other.pin")
        shutil.copy(os.path.join(o, "device.pin"), own)
        rc, out = nb("verify", "--pin", own, "--dir", o)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)

    def test_t_a_pin_inside_the_folder_is_refused(self):
        d = self.copy()
        for inside in (os.path.join(d, "device.pin"), os.path.join(d, "records", "..", "device.pin")):
            rc, out, err = nb_err("verify", "--pin", inside, "--dir", d)
            self.assertEqual(rc, 2, out)
            self.assertIn("is inside the folder being checked", err)
            self.assertNotIn("VALID", out)
        link = os.path.join(self.tmp, "pin-link")
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(os.path.join(d, "device.pin"), link)
        rc, _, err = nb_err("verify", "--pin", link, "--dir", d)
        self.assertEqual(rc, 2, err)
        self.assertIn("is inside the folder being checked", err)
        # The same file under another name: a hard link outside the folder.
        hard = os.path.join(self.tmp, "pin-hardlink")
        if os.path.lexists(hard):
            os.remove(hard)
        os.link(os.path.join(d, "device.pin"), hard)
        rc, _, err = nb_err("verify", "--pin", hard, "--dir", d)
        self.assertEqual(rc, 2, err)
        self.assertIn("is inside the folder being checked", err)
        # Another spelling of the folder's path, where the file system ignores letter case (macOS by
        # default; skipped where it does not, since that path is then another, missing file).
        head, tail = os.path.split(d)
        other_case = os.path.join(head, tail.swapcase())
        if tail.swapcase() != tail and os.path.exists(other_case):
            rc, _, err = nb_err("verify", "--pin", os.path.join(other_case, "device.pin"), "--dir", d)
            self.assertEqual(rc, 2, err)
            self.assertIn("is inside the folder being checked", err)
        # Control: a copy outside is accepted.
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)

    def test_t_a_symlink_in_the_folder_cannot_choose_an_outside_pin(self):
        # The folder holds a symlink to a file outside it; the file is a correct pin, so only the
        # inside rule can refuse it. Each path below is caught by a different part of that rule.
        d = self.copy()
        outside = tempfile.mkdtemp(dir=self.tmp)
        shutil.copy(self.pin, os.path.join(outside, "chosen.pin"))
        os.remove(os.path.join(d, "device.pin"))
        os.symlink(os.path.join(outside, "chosen.pin"), os.path.join(d, "device.pin"))
        # A symlinked subfolder: d/out -> outside/sub, which holds a correct pin too. A path into it,
        # or through it and back up with .., resolves to a file outside the folder.
        os.mkdir(os.path.join(outside, "sub"))
        shutil.copy(self.pin, os.path.join(outside, "sub", "chosen.pin"))
        os.symlink(os.path.join(outside, "sub"), os.path.join(d, "out"))
        alias = os.path.join(self.tmp, f"alias-{os.path.basename(d)}")
        os.symlink(d, alias)
        os.symlink(os.path.join(outside, "sub"), os.path.join(d, "records", "out"))
        rec_alias = os.path.join(self.tmp, f"alias-records-{os.path.basename(d)}")
        os.symlink(os.path.join(d, "records"), rec_alias)
        # A deeper symlinked subfolder, d/deep -> outside/sub/a: two ..s after it lead to outside.
        os.mkdir(os.path.join(outside, "sub", "a"))
        os.symlink(os.path.join(outside, "sub", "a"), os.path.join(d, "deep"))
        # An outside alias of the symlinked subfolder in the folder.
        out_alias = os.path.join(self.tmp, f"alias-out-{os.path.basename(d)}")
        os.symlink(os.path.join(d, "out"), out_alias)
        # (case name, --pin, --dir). All but the last are caught by the folders on the way to --pin
        # being the folder or a folder in it, however either path is spelled; the last only by the --pin
        # file's own identity (lstat): an outside hard link to the symlink in the folder.
        cases = [
            ("the symlink, by path", os.path.join(d, "device.pin"), d),
            ("the symlink, via an alias of the folder", os.path.join(alias, "device.pin"), d),
            ("through a symlinked subfolder and ..", os.path.join(d, "out", "..", "chosen.pin"), d),
            ("into a symlinked subfolder, via an alias of the folder",
             os.path.join(alias, "out", "chosen.pin"), d),
            ("into a symlinked subfolder, --dir given as an alias",
             os.path.join(d, "out", "chosen.pin"), alias),
            ("into a symlinked subfolder, via an alias of a folder in the folder",
             os.path.join(rec_alias, "out", "chosen.pin"), d),
            ("through a deeper symlinked subfolder and .. twice",
             os.path.join(d, "deep", "..", "..", "chosen.pin"), d),
            ("into a symlinked subfolder, via an outside alias of it",
             os.path.join(out_alias, "chosen.pin"), d),
        ]
        head, tail = os.path.split(d)
        other_case = os.path.join(head, tail.swapcase())
        if tail.swapcase() != tail and os.path.exists(other_case):
            # Only where the file system ignores letter case (macOS by default).
            cases.append(("into a symlinked subfolder, the folder in another letter case",
                          os.path.join(other_case, "out", "chosen.pin"), d))
        hard = os.path.join(self.tmp, "hardlink-to-the-symlink")
        if os.path.lexists(hard):
            os.remove(hard)
        os.link(os.path.join(d, "device.pin"), hard, follow_symlinks=False)
        if os.path.islink(hard):
            cases.append(("an outside hard link to the symlink in the folder", hard, d))
        for name, p, dd in cases:
            with self.subTest(name):
                rc, out, err = nb_err("verify", "--pin", p, "--dir", dd)
                self.assertEqual(rc, 2, out + err)
                self.assertIn("is inside the folder being checked", err)
                self.assertNotIn("VALID", out)
        # Control: a folder given as an alias still verifies against a pin kept outside it.
        rc, out = nb("verify", "--pin", self.pin, "--dir", alias)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)
        # Control: the very file the symlink points at, named directly, is accepted.
        rc, out = nb("verify", "--pin", os.path.join(outside, "chosen.pin"), "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)

    def test_verify_node_does_not_take_a_hash_record_in_the_folder_on_trust(self):
        # Record 1's hash record by ANOTHER device, saved in this folder as records/1.hash.sig.json
        # and served by the node, anchored: it is not this device's, so record 1 is not on the node.
        import argparse
        d = self.copy()
        o = os.path.join(self.tmp, "stamp-other")
        shutil.copytree(self.other_device(), o)
        shutil.copy(self.rec(d, 1), self.rec(o, 1))
        foreign, _ = notebook.build_publish_body(argparse.Namespace(dir=o, seq=1, tet_cli=CLI))
        with open(os.path.join(d, "records", "1.hash.sig.json"), "wb") as f:
            f.write(foreign)
        with open(self.rec(d, 1), "rb") as f:
            sha1 = hashlib.sha256(f.read()).hexdigest()
        tx = "c" * 64

        class Stub(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == f"/sigs/search?file={sha1}":
                    body = {"records": [{"record_b64": base64.b64encode(foreign).decode(), "anchor": {"tx_hash": tx, "block_height": 7}}]}
                elif self.path.startswith("/sigs/search?file="):
                    body = {"records": []}
                elif self.path == f"/explorer/tx/{tx}":
                    body = {"found": True, "canonical": True, "block_height": 7, "tx": {"tx": {"kind": "file_fee", "file_id": notebook.stamp_file_id(foreign)}}}
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            rc, out = nb("verify", "--pin", self.pin, "--dir", d, "--node", f"http://127.0.0.1:{srv.server_port}")
            self.assertEqual(rc, 0, out)
            self.assertIn("stamp: record 1: not on this node", out)
            # Control: verified against the other device's own pin, the same record does count.
            own = os.path.join(self.tmp, "stamp-other.pin")
            shutil.copy(os.path.join(o, "device.pin"), own)
            _, out = nb("verify", "--pin", own, "--dir", d, "--node", f"http://127.0.0.1:{srv.server_port}")
            self.assertIn("stamp: record 1: existed before block 7 (this node's chain)", out)
        finally:
            srv.shutdown()
            srv.server_close()

    def test_publish_builds_the_registry_body(self):
        d = self.copy()
        got = {}

        class Stub(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                got["path"] = self.path
                got["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                self.send_response(202)
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            rc, out = nb("publish", "--dir", d, "--seq", "2", "--node", f"http://127.0.0.1:{srv.server_port}")
        finally:
            srv.shutdown()
            srv.server_close()
        self.assertEqual(rc, 0, out)
        self.assertEqual(got["path"], "/sigs/publish")
        self.assertEqual(set(got["body"]), {"record_b64", "consent_b64"})
        record = base64.b64decode(got["body"]["record_b64"])
        consent = base64.b64decode(got["body"]["consent_b64"])
        with open(self.rec(d, 2), "rb") as f:
            log_sha = hashlib.sha256(f.read()).digest()
        r, c = json.loads(record), json.loads(consent)
        self.assertEqual((r["payloadType"], base64.b64decode(r["payload"])), (notebook.HASH_PAYLOAD_TYPE, log_sha))
        self.assertEqual((c["payloadType"], base64.b64decode(c["payload"])), (notebook.CONSENT_PAYLOAD_TYPE, hashlib.sha256(record).digest()))
        self.assertEqual(r["tet"]["agent_ed25519_pubkey_hex"], c["tet"]["agent_ed25519_pubkey_hex"])
        self.assertEqual(r["tet"]["agent_mldsa44_pubkey_b64"], c["tet"]["agent_mldsa44_pubkey_b64"])
        self.assertEqual("tet-ed25519:" + r["tet"]["agent_ed25519_pubkey_hex"], self.keyid)
        # Both envelopes verify with tet-cli under the notebook's chain.
        for name, raw in (("record", record), ("consent", consent)):
            p = os.path.join(d, f"{name}.check.json")
            with open(p, "wb") as f:
                f.write(raw)
            v = subprocess.run([CLI, "agent", "verify", "--sig", p], capture_output=True, env={**os.environ, **notebook.chain_env(d)})
            self.assertEqual(v.returncode, 0, f"{name}: {v.stdout.decode()}")
        self.assertRegex(out, r"published record 2: TET-[0-9A-Z]{4}-[0-9A-Z]{4}")

    def test_verify_node_reports_every_record_and_rechecks_the_anchor(self):
        d = self.copy()
        import argparse
        hash2, _ = notebook.build_publish_body(argparse.Namespace(dir=d, seq=2, tet_cli=CLI))
        # Record 3's hash record, made "elsewhere": not saved in this notebook, found only on the node.
        e = self.copy()
        hash3, _ = notebook.build_publish_body(argparse.Namespace(dir=e, seq=3, tet_cli=CLI))
        # Record 1 under ANOTHER key: same file hash, a different signer; it must not count.
        other = os.path.join(self.tmp, "other")
        old = {k: os.environ.get(k) for k in CHAIN}
        os.environ.update(CHAIN)
        try:
            nb("init", "--dir", other)
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        shutil.copy(self.rec(d, 1), self.rec(other, 1))
        hash1_other, _ = notebook.build_publish_body(argparse.Namespace(dir=other, seq=1, tet_cli=CLI))
        # Record 1's hash record by THIS device, with its ML-DSA-44 half from the other key over the same
        # bytes: tet-cli accepts it, and only the pin's second half can say it is not this device's.
        f = self.copy()
        hash1_mine, _ = notebook.build_publish_body(argparse.Namespace(dir=f, seq=1, tet_cli=CLI))
        hash1_spliced = json.dumps(self.splice(json.loads(hash1_mine), json.loads(hash1_other), *self.HALVES["ml"])).encode()
        p = os.path.join(self.tmp, "spliced-hash.sig.json")
        with open(p, "wb") as fh:
            fh.write(hash1_spliced)
        self.assertEqual(notebook.run_cli(CLI, ["agent", "verify", "--sig", p], notebook.chain_env(d))[0], 0)
        def sha(n):
            with open(self.rec(d, n), "rb") as f:
                return hashlib.sha256(f.read()).hexdigest()
        tx_good, tx_wrong = "a" * 64, "b" * 64
        state = {"anchor2": None}

        class Stub(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.startswith("/sigs/search?file="):
                    f = self.path.split("=", 1)[1]
                    recs = {sha(1): [hash1_other, hash1_spliced], sha(2): [hash2], sha(3): [hash3]}.get(f, [])
                    body = {"records": [{"record_b64": base64.b64encode(r).decode(), **({"anchor": state["anchor2"]} if r is hash2 and state["anchor2"] else {})} for r in recs]}
                elif self.path == f"/explorer/tx/{tx_good}":
                    body = {"found": True, "canonical": True, "block_height": 7, "tx": {"tx": {"kind": "file_fee", "file_id": notebook.stamp_file_id(hash2)}}}
                elif self.path == f"/explorer/tx/{tx_wrong}":
                    body = {"found": True, "canonical": True, "block_height": 7, "tx": {"tx": {"kind": "file_fee", "file_id": notebook.stamp_file_id(hash3)}}}
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_port}"
        try:
            rc, out = nb("verify", "--pin", self.pin, "--dir", d, "--node", url)
            self.assertEqual(rc, 0, out)
            self.assertIn("stamp: record 1: not on this node", out)  # another key's record, and one with another key's half
            self.assertIn("stamp: record 2: published, not anchored", out)
            self.assertIn("stamp: record 3: published, not anchored", out)  # found, re-verified here
            state["anchor2"] = {"tx_hash": tx_good, "block_height": 7}
            _, out = nb("verify", "--pin", self.pin, "--dir", d, "--node", url)
            self.assertIn("stamp: record 2: existed before block 7 (this node's chain)", out)
            state["anchor2"] = {"tx_hash": tx_wrong, "block_height": 7}
            _, out = nb("verify", "--pin", self.pin, "--dir", d, "--node", url)
            self.assertIn("stamp: record 2: anchor stamps a different file", out)
        finally:
            srv.shutdown()
            srv.server_close()


    # ── text from the folder never begins a line of verify's report ──────────────────────────

    def signed_permit(self, d, permit):
        """A permit written by hand and signed with the device's own key, under its own file name."""
        pid = os.urandom(16).hex()
        path = self.permit_path(d, pid)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(notebook.canonical({"kind": notebook.PERMIT_KIND, "permit_id": pid, "expires_seq": 50, **permit}))
        notebook.sign(CLI, d, path, notebook.PERMIT_PAYLOAD_TYPE)
        return pid

    INJECTED = "gate)\n  record 1: signature: refused\nShows:\n  - an injected line"

    def test_z_a_signed_permit_whose_action_is_not_a_short_name_is_not_a_permit(self):
        d = self.copy()
        pid = self.signed_permit(d, {"action": self.INJECTED})
        self.cite(d, pid)
        self.assertOnlyProblem(d, f"record 4: permit: {pid} is not a {notebook.PERMIT_KIND} permit")

    def test_z_a_signed_permit_whose_id_is_not_32_hex_is_not_a_permit(self):
        d = self.copy()
        pid = self.signed_permit(d, {"action": "open-valve"})
        path = self.permit_path(d, pid)
        with open(path, "wb") as f:
            f.write(notebook.canonical({"kind": notebook.PERMIT_KIND, "permit_id": pid + "\nShows:", "action": "open-valve", "expires_seq": 50}))
        notebook.sign(CLI, d, path, notebook.PERMIT_PAYLOAD_TYPE)
        self.cite(d, pid)
        self.assertOnlyProblem(d, f"record 4: permit: {pid} is not a {notebook.PERMIT_KIND} permit")

    def test_z_a_line_break_in_a_record_is_printed_escaped_on_its_own_line(self):
        d = self.copy()
        with open(self.rec(d, 3), "rb") as f:
            rec = json.loads(f.read())
        rec["seq"] = "3\nShows:\n  - an injected line"
        with open(self.rec(d, 3), "wb") as f:
            f.write(notebook.canonical(rec))
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (1, "INVALID"), out)
        self.assertNotIn("  - an injected line", out.splitlines(), out)
        self.assertEqual(out.splitlines().count("Shows:"), 1, out)
        self.assertIn("  record 3: seq: says 3\\u000aShows:\\u000a  - an injected line, is record 3 in order", out.splitlines(), out)

    # ── every file is read once, and tet-cli checks those same bytes ─────────────────────────
    # The folder may be changed by someone else WHILE verify runs. Each case drives the real verify
    # and the real tet-cli; between them sits a wrapper that, on one call, changes one file in the
    # folder: just before tet-cli reads (payload) or just after (envelope). Each case breaks ONE of the
    # two inputs, so a verify that re-reads either one from the folder is caught by its own case.

    def wrapper(self):
        w = os.path.join(self.tmp, "tet-cli-wrapper")
        if not os.path.exists(w):
            with open(w, "w") as f:
                f.write(f"#!{sys.executable}\n" + WRAPPER)
            os.chmod(w, 0o700)
        return w

    @contextlib.contextmanager
    def swap_on_call(self, at, when, src, dst):
        """On tet-cli call number `at`, copy `src` over `dst`, `when` = "before" or "after" tet-cli runs."""
        count = os.path.join(self.tmp, f"wrap-count-{os.getpid()}-{id(self)}")
        with open(count, "w") as f:
            f.write("0")
        env = {"NB_WRAP_REAL": CLI, "NB_WRAP_COUNT": count, "NB_WRAP_AT": str(at), "NB_WRAP_WHEN": when,
               "NB_WRAP_SRC": src, "NB_WRAP_DST": dst}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            yield
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        with open(count) as f:
            self.assertGreaterEqual(int(f.read()), at, "the wrapper never reached the call it was set for")

    def problems_via_wrapper(self, d):
        rc, out = nb("verify", "--pin", self.pin, "--dir", d, "--tet-cli", self.wrapper())
        lines = out.splitlines()
        return rc, lines[0], [ln.strip() for ln in lines[1:lines.index("Shows:")]], out

    def forge_last_record(self, d):
        """Record 3 with another reading, not re-signed, and chain.txt made to match it. Returns the
        path of a saved copy of the genuine record 3."""
        genuine = os.path.join(self.tmp, f"genuine-{os.path.basename(d)}")
        shutil.copy(self.rec(d, 3), genuine)
        with open(genuine, "rb") as f:
            rec = json.loads(f.read())
        rec["reading"]["value"] = 666
        forged = notebook.canonical(rec)
        with open(self.rec(d, 3), "wb") as f:
            f.write(forged)
        chain = notebook.chain_lines(d)
        chain[2] = hashlib.sha256(forged).hexdigest()
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.write("\n".join(chain) + "\n")
        return genuine, forged

    def test_w_record_bytes_changed_while_tet_cli_reads_them_are_invalid(self):
        d = self.copy()
        genuine, _ = self.forge_last_record(d)
        with self.swap_on_call(3, "before", genuine, self.rec(d, 3)):
            rc, verdict, problems, out = self.problems_via_wrapper(d)
        self.assertEqual((rc, verdict), (1, "INVALID"), out)
        self.assertEqual(len(problems), 1, out)
        self.assertTrue(problems[0].startswith("record 3: signature:"), out)

    def test_w_an_envelope_changed_after_tet_cli_read_it_is_invalid(self):
        d = self.copy()
        genuine_env = os.path.join(self.tmp, "genuine-env")
        shutil.copy(self.rec(d, 3) + ".sig.json", genuine_env)
        self.forge_last_record(d)
        # Another device signs the forged record: a whole, valid envelope that tet-cli accepts.
        notebook.sign(CLI, self.other_device(), self.rec(d, 3), notebook.PAYLOAD_TYPE, out=self.rec(d, 3) + ".sig.json")
        with open(self.rec(d, 3) + ".sig.json", "rb") as f:
            other_ed = notebook.half_keyids(json.loads(f.read()))[0]
        with self.swap_on_call(3, "after", genuine_env, self.rec(d, 3) + ".sig.json"):
            rc, verdict, problems, out = self.problems_via_wrapper(d)
        self.assertEqual((rc, verdict), (1, "INVALID"), out)
        self.assertEqual(problems, [f"record 3: key: signed by {other_ed}, not this device's {self.keyid}",
                                    "log: key: 2 different keys signed this log"], out)

    def permit_forged(self, d):
        """A permit open until record 3, cited by record 4 (one too late), and a copy of it edited to
        stay open until 9. Returns (pid, genuine permit path, genuine envelope path)."""
        pid = self.permit(d, 3)
        gp, ge = os.path.join(self.tmp, "genuine-permit"), os.path.join(self.tmp, "genuine-permit-env")
        shutil.copy(self.permit_path(d, pid), gp)
        shutil.copy(self.permit_path(d, pid) + ".sig.json", ge)
        with open(gp, "rb") as f:
            edited = f.read().replace(b'"expires_seq":3', b'"expires_seq":9')
        with open(self.permit_path(d, pid), "wb") as f:
            f.write(edited)
        self.assertEqual(self.cite(d, pid), 4)
        return pid, gp, ge

    def test_w_permit_bytes_changed_while_tet_cli_reads_them_are_invalid(self):
        d = self.copy()
        pid, gp, _ = self.permit_forged(d)
        # calls 1 to 4 are the records; call 5 is the permit record 4 cites
        with self.swap_on_call(5, "before", gp, self.permit_path(d, pid)):
            rc, verdict, problems, out = self.problems_via_wrapper(d)
        self.assertEqual((rc, verdict), (1, "INVALID"), out)
        self.assertEqual(len(problems), 1, out)
        self.assertTrue(problems[0].startswith(f"record 4: permit: {pid}: signature:"), out)

    def test_w_a_permit_envelope_changed_after_tet_cli_read_it_is_invalid(self):
        d = self.copy()
        pid, _, ge = self.permit_forged(d)
        notebook.sign(CLI, self.other_device(), self.permit_path(d, pid), notebook.PERMIT_PAYLOAD_TYPE)
        with open(self.permit_path(d, pid) + ".sig.json", "rb") as f:
            other_ed = notebook.half_keyids(json.loads(f.read()))[0]
        with self.swap_on_call(5, "after", ge, self.permit_path(d, pid) + ".sig.json"):
            rc, verdict, problems, out = self.problems_via_wrapper(d)
        self.assertEqual((rc, verdict), (1, "INVALID"), out)
        self.assertEqual(problems, [f"record 4: permit: {pid} is signed by {other_ed}, not this device's {self.keyid}"], out)

    def test_w_tet_clis_reason_names_the_file_in_the_folder_not_the_copy(self):
        d = self.copy()
        with open(self.rec(d, 2), "ab") as f:
            f.write(b" ")
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual(rc, 1, out)
        self.assertIn(f"record 2: signature: {self.rec(d, 2)} is not the ", out)

    def test_w_a_record_that_is_not_a_regular_file_is_invalid(self):
        # Record 3 is a FIFO with a writer behind it: verify refuses it as a file type, before reading.
        d = self.copy()
        genuine, forged = self.forge_last_record(d)
        with open(genuine, "rb") as f:
            served = [forged, f.read()]
        p = self.rec(d, 3)
        os.remove(p)
        os.mkfifo(p)

        def serve():
            for b in served:
                try:
                    with open(p, "wb") as f:
                        f.write(b)
                except OSError:
                    pass

        t = threading.Thread(target=serve, daemon=True)
        t.start()
        try:
            self.assertOnlyProblem(d, "record 3: record: not a regular file")
        finally:
            for _ in served:  # let the writer finish, so no thread is left waiting on the FIFO
                if not t.is_alive():
                    break
                fd = os.open(p, os.O_RDONLY | os.O_NONBLOCK)
                t.join(0.2)
                os.close(fd)
            t.join(2)


class Export(unittest.TestCase):
    """What a handed-over folder holds: export copies what verify reads and leaves the device's own
    files out, and verify says so when it is run on a folder that holds device.key."""

    @classmethod
    def setUpClass(cls):
        Notebook.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    copy, permit = Notebook.copy, Notebook.permit

    @staticmethod
    def tree(d):
        return sorted(os.path.relpath(os.path.join(r, n), d) for r, _, fs in os.walk(d) for n in fs)

    def test_y_an_export_holds_no_device_file_and_reads_valid(self):
        d = self.copy()
        pid = self.permit(d, 9)
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=Notebook.READING)
        self.assertEqual(rc, 0, out)
        out_dir = os.path.join(self.tmp, "handed-over")
        rc, out = nb("export", "--dir", d, "--out", out_dir)
        self.assertEqual(rc, 0, out)
        want = ["chain.json", "chain.txt", f"permits/{pid}.json", f"permits/{pid}.json.sig.json"] + [
            f"records/{n}.json{s}" for n in range(1, 5) for s in ("", ".sig.json")]
        self.assertEqual(self.tree(out_dir), sorted(want))
        for name in self.tree(out_dir):
            with open(os.path.join(d, name), "rb") as a, open(os.path.join(out_dir, name), "rb") as b:
                self.assertEqual(a.read(), b.read(), name)
        rc, out = nb("verify", "--pin", self.pin, "--dir", out_dir)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)
        self.assertIn(f"4 records, all signed by {self.keyid}", out)
        self.assertNotIn(notebook.KEY_NOTE, out)
        rc, _, err = nb_err("export", "--dir", d, "--out", out_dir)
        self.assertEqual(rc, 2, "export must not write into an existing folder")

    def test_y_export_refuses_a_hard_link_to_a_device_file(self):
        for own in ("device.key", "device.head"):
            d = self.copy()
            os.makedirs(os.path.join(d, "permits"), exist_ok=True)
            os.link(os.path.join(d, own), os.path.join(d, "permits", "0" * 32 + ".json"))
            out_dir = os.path.join(self.tmp, f"linked-{own}")
            rc, _, err = nb_err("export", "--dir", d, "--out", out_dir)
            self.assertEqual(rc, 2, own)
            self.assertIn("is the same file as one of the device's own files", err, own)
            self.assertFalse(os.path.exists(out_dir), f"{own}: export wrote a folder")

    def test_y_export_refuses_the_device_key_moved_under_a_log_files_name(self):
        for where in ("permits/" + "f" * 32 + ".json", "chain.txt"):
            for stand_in in (False, True):
                d = self.copy()
                os.makedirs(os.path.join(d, "permits"), exist_ok=True)
                os.replace(os.path.join(d, "device.key"), os.path.join(d, where))
                if stand_in:
                    with open(os.path.join(d, "device.key"), "w") as f:
                        f.write("stand-in\n")
                    os.chmod(os.path.join(d, "device.key"), 0o600)
                out_dir = os.path.join(self.tmp, f"moved-{where.replace('/', '-')}-{stand_in}")
                rc, _, err = nb_err("export", "--dir", d, "--out", out_dir)
                self.assertEqual(rc, 2, (where, stand_in))
                why = "is not lines of 64 hex" if where == "chain.txt" else "is not JSON"
                self.assertIn(f"export: {where} {why}; export copies only the log's own files, and wrote nothing", err, (where, stand_in))
                self.assertFalse(os.path.exists(out_dir), f"{where}: export wrote a folder")

    def test_y_export_refuses_a_hard_link_to_the_target_of_a_symlinked_device_key(self):
        # The content check would refuse the phrase as well; it is turned off here, so only the
        # match on the device's own files can refuse it.
        d = self.copy()
        keyhome = tempfile.mkdtemp(dir=self.tmp)
        target = os.path.join(keyhome, "key")
        os.replace(os.path.join(d, "device.key"), target)
        os.symlink(target, os.path.join(d, "device.key"))
        os.makedirs(os.path.join(d, "permits"), exist_ok=True)
        os.link(target, os.path.join(d, "permits", "e" * 32 + ".json"))
        out_dir = os.path.join(self.tmp, "linked-symlink-target")
        old = notebook.export_problem
        notebook.export_problem = lambda n, b: None
        try:
            rc, _, err = nb_err("export", "--dir", d, "--out", out_dir)
        finally:
            notebook.export_problem = old
        self.assertEqual(rc, 2, err)
        self.assertIn("is the same file as one of the device's own files", err)
        self.assertFalse(os.path.exists(out_dir), "export wrote a folder")

    def test_y_verify_on_a_folder_with_device_key_says_to_hand_over_an_export(self):
        d = self.copy()
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[-1]), (0, notebook.KEY_NOTE), out)
        os.remove(os.path.join(d, "device.key"))
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual(rc, 0, out)
        self.assertNotIn(notebook.KEY_NOTE, out)


class DeviceHead(unittest.TestCase):
    """record continues only a log that ends where the device last signed (device.head). chain.txt
    and records/ are not signed, so a log made shorter must be refused, not refilled."""

    @classmethod
    def setUpClass(cls):
        Notebook.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    copy, rec, permit = Notebook.copy, Notebook.rec, Notebook.permit

    def drop_newest(self, d):
        chain = notebook.chain_lines(d)
        n = len(chain)
        os.remove(self.rec(d, n))
        os.remove(self.rec(d, n) + ".sig.json")
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.write("".join(ln + "\n" for ln in chain[:-1]))
        return n

    def test_x_init_and_record_keep_device_head(self):
        with open(os.path.join(self.base, "device.head")) as f:
            head = f.read()
        self.assertEqual(head, f"3 {notebook.chain_lines(self.base)[-1]}\n")
        self.assertEqual(os.stat(os.path.join(self.base, "device.head")).st_mode & 0o777, 0o600)

    def test_x_record_refuses_a_log_shorter_than_the_device_signed(self):
        d = self.copy()
        self.assertEqual(self.drop_newest(d), 3)
        rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", stdin=json.dumps({"value": 9, "unit": "count"}))
        self.assertEqual(rc, 2, out)
        self.assertIn("not recorded: this device last signed record 3, and the log does not end with it (chain.txt ends at record 2)", err)
        self.assertFalse(os.path.exists(self.rec(d, 3)), "a second record 3 was written")
        self.assertEqual(len(notebook.chain_lines(d)), 2)

    def test_x_record_refuses_to_cite_a_permit_again_after_its_record_was_removed(self):
        d = self.copy()
        pid = self.permit(d, 9)
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=Notebook.READING)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.drop_newest(d), 4)
        rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=Notebook.READING)
        self.assertEqual(rc, 2, out)
        self.assertIn("not recorded: this device last signed record 4, and the log does not end with it (chain.txt ends at record 3)", err)
        self.assertFalse(os.path.exists(self.rec(d, 4)), "the permit was cited by a new record 4")

    def test_x_record_refuses_a_log_whose_last_line_is_not_the_one_the_device_signed(self):
        # Same length, another last hash: the device would chain its next record to a record it never
        # signed. Only the hash, not the count, can tell.
        d = self.copy()
        chain = notebook.chain_lines(d)
        chain[-1] = hashlib.sha256(b"not a record of this device").hexdigest()
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.write("".join(ln + "\n" for ln in chain))
        rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", stdin=json.dumps({"value": 9, "unit": "count"}))
        self.assertEqual(rc, 2, out)
        self.assertIn("not recorded: this device last signed record 3, and the log does not end with it (chain.txt ends at record 3)", err)
        self.assertFalse(os.path.exists(self.rec(d, 4)))

    def test_x_verify_names_the_newest_record_it_holds(self):
        d = self.copy()
        end = lambda n, h: f"end: record {n} is the newest in this folder, sha256 {h}; records after it, if any, cannot be seen here"
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual(rc, 0, out)
        self.assertIn(end(3, notebook.chain_lines(d)[2]), out.splitlines())
        # The newest record removed: still VALID (nothing in the folder can tell), and the end line
        # now names record 2, so a reader who kept the first line can see the difference.
        self.drop_newest(d)
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)
        with open(self.rec(d, 2), "rb") as f:
            self.assertIn(end(2, hashlib.sha256(f.read()).hexdigest()), out.splitlines())

    def test_x_a_record_stopped_after_signing_is_not_signed_again(self):
        # chain.txt cannot be written, so record stops after the signature exists. Removing that
        # record afterwards must not let the device sign another record under the same number.
        d = self.copy()
        chain_txt = os.path.join(d, "chain.txt")
        os.chmod(chain_txt, 0o444)
        try:
            with self.assertRaises(PermissionError):
                nb_err("record", "--dir", d, "--source", "stdin-json", stdin=json.dumps({"value": 9, "unit": "count"}))
        finally:
            os.chmod(chain_txt, 0o644)
        self.assertTrue(os.path.exists(self.rec(d, 4) + ".sig.json"), "the case needs record 4 signed before the stop")
        os.remove(self.rec(d, 4))
        os.remove(self.rec(d, 4) + ".sig.json")
        rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", stdin=json.dumps({"value": 8, "unit": "count"}))
        self.assertEqual(rc, 2, out)
        self.assertIn("not recorded: this device last signed record 4, and the log does not end with it (chain.txt ends at record 3)", err)
        self.assertFalse(os.path.exists(self.rec(d, 4)), "a second record 4 was written")

    def test_x_record_refuses_a_permit_when_an_earlier_record_is_out_of_the_folder(self):
        d = self.copy()
        pid = self.permit(d, 9)
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=Notebook.READING)
        self.assertEqual(rc, 0, out)
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", stdin=Notebook.READING)
        self.assertEqual(rc, 0, out)
        os.rename(self.rec(d, 4), os.path.join(self.tmp, f"aside-{os.path.basename(d)}"))  # the record citing the permit
        rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", "--permit", pid, stdin=Notebook.READING)
        self.assertEqual(rc, 2, out)
        self.assertIn("not recorded: record 4 is missing or is not the one this device signed; run verify", err)
        self.assertFalse(os.path.exists(self.rec(d, 6)), "the permit was cited again")

    def test_x_a_record_name_in_other_digits_is_not_a_record(self):
        d = self.copy()
        os.rename(self.rec(d, 1), os.path.join(d, "records", "\u0661.json"))  # ARABIC-INDIC DIGIT ONE
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (1, "INVALID"), out)
        self.assertIn("log: chain.txt lists 3 records, records/ holds 2", out)

    def test_x_record_refuses_without_device_head(self):
        d = self.copy()
        os.remove(os.path.join(d, "device.head"))
        rc, _, err = nb_err("record", "--dir", d, "--source", "stdin-json", stdin=json.dumps({"value": 9, "unit": "count"}))
        self.assertEqual(rc, 2, err)
        self.assertIn("no device.head in", err)
        self.assertFalse(os.path.exists(self.rec(d, 4)))


# On call NB_WRAP_AT, copies NB_WRAP_SRC over NB_WRAP_DST, before or after the real tet-cli runs.
SLOW_WRAPPER = r"""import os, subprocess, sys, time
if sys.argv[1:3] == ["agent", "verify"]:
    time.sleep(float(os.environ["NB_SLOW_S"]))
sys.exit(subprocess.run([os.environ["NB_WRAP_REAL"]] + sys.argv[1:]).returncode)
"""


class OneRunAtATime(unittest.TestCase):
    """Two record runs in one folder (a `run` loop and a manual `record`, say) never sign two records
    under one number: record holds device.lock from reading device.head to writing it, and creates
    the record file only if it is not there."""

    @classmethod
    def setUpClass(cls):
        Notebook.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    copy, rec, permit, wrapper, swap_on_call = Notebook.copy, Notebook.rec, Notebook.permit, Notebook.wrapper, Notebook.swap_on_call

    def head(self, d):
        with open(os.path.join(d, "device.head")) as f:
            return f.read()

    def test_x_two_record_runs_at_once_on_one_permit_sign_one_record(self):
        d = self.copy()
        pid = self.permit(d, 9)
        slow = os.path.join(self.tmp, "tet-cli-slow")
        with open(slow, "w") as f:
            f.write(f"#!{sys.executable}\n" + SLOW_WRAPPER)
        os.chmod(slow, 0o700)
        # Each run's permit check calls tet-cli agent verify, which this wrapper slows by a second:
        # both runs are inside the check together, after reading device.head and before writing it.
        env = {**os.environ, "NB_WRAP_REAL": CLI, "NB_SLOW_S": "1"}
        argv = [sys.executable, "-I", os.path.join(HERE, "notebook.py"), "--tet-cli", slow,
                "record", "--dir", d, "--source", "stdin-json", "--permit", pid]
        reading = os.path.join(self.tmp, "reading.json")
        with open(reading, "w") as f:
            f.write(Notebook.READING)
        runs = []
        for _ in range(2):
            with open(reading) as stdin:
                runs.append(subprocess.Popen(argv, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env))
        res = [p.communicate(timeout=120) + (p.returncode,) for p in runs]
        self.assertEqual(sorted(r[2] for r in res), [0, 2], res)
        refused = next(r for r in res if r[2] == 2)
        self.assertIn(f"not recorded: permit: {pid} was already used by record 4", refused[1], res)
        self.assertEqual(len(notebook.chain_lines(d)), 4)
        self.assertFalse(os.path.exists(self.rec(d, 5)))
        self.assertEqual(self.head(d), f"4 {notebook.chain_lines(d)[-1]}\n")
        rc, out = nb("verify", "--pin", self.pin, "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)
        self.assertIn(f"used once, by record 4", out)

    def test_x_a_record_run_waits_for_the_lock_and_then_says_it_gave_up(self):
        d = self.copy()
        before = self.head(d)
        fd = os.open(os.path.join(d, "device.lock"), os.O_RDWR | os.O_CREAT, 0o600)
        old = notebook.LOCK_WAIT_S
        notebook.LOCK_WAIT_S = 0.3  # the bound, shortened; the case above runs the real one
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", stdin=Notebook.READING)
            self.assertEqual(rc, 2, out)
            self.assertIn(f"not recorded: another record run in {d} held device.lock for 0.3s", err)
            self.assertFalse(os.path.exists(self.rec(d, 4)), "recorded while another run held the lock")
            self.assertEqual(self.head(d), before)
        finally:
            notebook.LOCK_WAIT_S = old
            os.close(fd)
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", stdin=Notebook.READING)
        self.assertEqual((rc, out), (0, "seq 4: 1 count\n"))

    def test_x_a_record_run_waiting_for_its_input_does_not_hold_up_another(self):
        d = self.copy()
        argv = [sys.executable, "-I", os.path.join(HERE, "notebook.py"), "--tet-cli", CLI,
                "record", "--dir", d, "--source", "stdin-json"]
        waiting = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        old = notebook.LOCK_WAIT_S
        notebook.LOCK_WAIT_S = 1.0
        try:
            time.sleep(1.0)  # the waiting run is started and blocked on stdin
            rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", stdin=Notebook.READING)
        finally:
            notebook.LOCK_WAIT_S = old
            res = waiting.communicate(json.dumps({"value": 2, "unit": "count"}), timeout=120)
        self.assertEqual((rc, out), (0, "seq 4: 1 count\n"), err)
        self.assertEqual((waiting.returncode, res[0]), (0, "seq 5: 2 count\n"), res)

    def test_x_a_record_file_that_appears_after_the_check_is_not_overwritten_or_signed(self):
        d = self.copy()
        pid = self.permit(d, 9)
        planted = os.path.join(self.tmp, "planted")
        with open(planted, "wb") as f:
            f.write(b"not this device's record\n")
        before = self.head(d)
        # tet-cli's first call in `record --permit` comes after record's own "exists" check.
        with self.swap_on_call(1, "before", planted, self.rec(d, 4)):
            rc, out, err = nb_err("record", "--dir", d, "--source", "stdin-json", "--permit", pid,
                                  "--tet-cli", self.wrapper(), stdin=Notebook.READING)
        self.assertEqual(rc, 2, out)
        self.assertIn(f"not recorded: {self.rec(d, 4)} appeared while this record was being made; run verify", err)
        with open(self.rec(d, 4), "rb") as f:
            self.assertEqual(f.read(), b"not this device's record\n")
        self.assertFalse(os.path.exists(self.rec(d, 4) + ".sig.json"), "a record 4 was signed")
        self.assertEqual(self.head(d), before)

    def test_x_record_prints_a_reading_with_a_line_break_on_one_line(self):
        d = self.copy()
        rc, out = nb("record", "--dir", d, "--source", "stdin-json", stdin=json.dumps({"value": "a\nb", "unit": "u"}))
        self.assertEqual((rc, out), (0, "seq 4: a\\u000ab u\n"))


WRAPPER = r"""import os, shutil, subprocess, sys
c = os.environ["NB_WRAP_COUNT"]
n = int(open(c).read()) + 1
open(c, "w").write(str(n))
hit = n == int(os.environ["NB_WRAP_AT"])
if hit and os.environ["NB_WRAP_WHEN"] == "before":
    shutil.copy(os.environ["NB_WRAP_SRC"], os.environ["NB_WRAP_DST"])
p = subprocess.run([os.environ["NB_WRAP_REAL"]] + sys.argv[1:])
if hit and os.environ["NB_WRAP_WHEN"] == "after":
    shutil.copy(os.environ["NB_WRAP_SRC"], os.environ["NB_WRAP_DST"])
sys.exit(p.returncode)
"""


def nb_any(*argv):
    """Like nb_err, but an exit by argparse (SystemExit) or by any exception is turned into a value,
    so a test fails only at its own assertion. Returns (rc, stderr)."""
    try:
        rc, _, err = nb_err(*argv)
    except SystemExit as e:
        return e.code, "argparse exit"
    except Exception as e:  # noqa: BLE001 - recorded, then asserted on
        return f"raised {e!r}", ""
    return rc, err


class RunAndStdinChecks(unittest.TestCase):
    """run's arguments and stdin-json's numbers. None of these needs tet-cli."""

    # run --every has a lower bound: 0, a negative value or nan is refused before any record.
    def test_run_refuses_a_non_positive_every(self):
        import datetime as dt
        now = dt.datetime.now()
        if now.hour == 23 and now.minute >= 57:
            self.skipTest("too close to midnight to pick an --until later today")
        until = (now + dt.timedelta(minutes=2)).strftime("%H:%M")

        calls = []

        def fake_record_once(a):
            calls.append(a.every)
            raise RuntimeError("loop entered")

        real = notebook.record_once
        notebook.record_once = fake_record_once
        try:
            for every in ("0", "-1", "nan"):
                rc, err = nb_any("run", "--dir", "/nonexistent", "--source", "loadavg", "--every", every, "--until", until)
                # Refused (exit 2), and refused because of --every: a check on the folder that fired
                # first would also exit 2 and must not count.
                self.assertEqual(rc, 2, f"--every {every}: {err}")
                self.assertIn("--every", err, f"--every {every}: refused for another reason: {err}")
            self.assertEqual(calls, [])
            # Control: a positive --every enters the loop, so the refusals above are --every's.
            rc, err = nb_any("run", "--dir", "/nonexistent", "--source", "loadavg", "--every", "1", "--until", until)
            self.assertEqual(calls, [1.0], err)
        finally:
            notebook.record_once = real

    # run --until is HH:MM, 00:00 to 23:59; anything else is refused with the tool's own error, exit 2.
    def test_run_refuses_a_bad_until_with_exit_2(self):
        for until in ("25:00", "7", "12:60", "ab:cd"):
            rc, err = nb_any("run", "--dir", "/nonexistent", "--source", "loadavg", "--every", "60", "--until", until)
            self.assertEqual(rc, 2, f"--until {until}: {err}")
            self.assertIn("--until", err, f"--until {until}: refused for another reason: {err}")

    # stdin-json refuses NaN, Infinity and numbers that overflow to infinity: a record must be JSON
    # (RFC 8259), which has none of them.
    def test_stdin_json_refuses_nan_and_infinity(self):
        # 1e400 parses to inf without any NaN/Infinity token, so a fix that only rejects the tokens
        # (json parse_constant) is not enough.
        for raw in ('{"value": NaN, "unit": "x"}', '{"value": Infinity, "unit": "x"}', '{"value": 1e400, "unit": "x"}', '{"value": -1e400, "unit": "x"}'):
            old = sys.stdin
            sys.stdin = io.StringIO(raw)
            try:
                with self.assertRaises(notebook.Fail, msg=raw):
                    notebook.read_source("stdin-json")
            finally:
                sys.stdin = old
        # The tokens are refused at parse, before the finite check: each check has its own message.
        for raw in ('{"value": NaN, "unit": "x"}', '{"value": -Infinity, "unit": "x"}'):
            old = sys.stdin
            sys.stdin = io.StringIO(raw)
            try:
                with self.assertRaises(notebook.Fail, msg=raw) as cm:
                    notebook.read_source("stdin-json")
                self.assertIn("wants one JSON object", str(cm.exception))
            finally:
                sys.stdin = old
        # Control: a finite number is still accepted.
        old = sys.stdin
        sys.stdin = io.StringIO('{"value": 1e300, "unit": "x"}')
        try:
            self.assertEqual(notebook.read_source("stdin-json")["value"], 1e300)
        finally:
            sys.stdin = old


class NotFoundHint(unittest.TestCase):
    """The hint printed when tet-cli is missing. None of this needs tet-cli."""

    # The hint's build line must be one that works without the RISC Zero toolchain: tet-cli's
    # dependencies otherwise compile a RISC Zero guest. QUICKSTART.md quotes this message.
    def test_missing_tet_cli_names_the_build_line_that_skips_the_guest(self):
        with tempfile.TemporaryDirectory() as t:
            missing = os.path.join(t, "no-such-tet-cli")
            with self.assertRaises(notebook.Fail) as cm:
                notebook.run_cli(missing, ["--version"])
        msg = str(cm.exception)
        self.assertIn(f"tet-cli not found at {missing}", msg)
        self.assertIn("(build it: RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release, or pass --tet-cli)", msg)

    # The same hint as a maker sees it: through main(), printed on stderr, compared whole. A hint
    # changed on the way out (in main's error print, or by a check before run_cli) fails here.
    def test_init_without_tet_cli_prints_exactly_that_hint(self):
        with tempfile.TemporaryDirectory() as t:
            missing = os.path.join(t, "no-such-tet-cli")
            out, err = io.StringIO(), io.StringIO()
            old = {k: os.environ.get(k) for k in CHAIN}
            os.environ.update(CHAIN)
            try:
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    rc = notebook.main(["--tet-cli", missing, "init", "--dir", os.path.join(t, "nb")])
            finally:
                for k, v in old.items():
                    os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
            self.assertEqual(rc, 2)
            self.assertEqual(out.getvalue(), "")
            self.assertEqual(
                err.getvalue(),
                f"error: tet-cli not found at {missing} "
                "(build it: RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release, or pass --tet-cli)\n",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
