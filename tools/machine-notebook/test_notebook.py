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

The Shows / Does not show lists verify prints are pinned word for word, in notebook.py and in the
README (the try page and /agents show the same words); a changed word, a dropped or swapped item and
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
            raise RuntimeError(f"tet-cli not found at {CLI}: cargo build -p tet-cli --release, or set TET_CLI")
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
        rc, out = nb("verify", "--dir", d)
        self.assertEqual(rc, 1, out)
        self.assertEqual(out.splitlines()[0], "INVALID", out)
        self.assertIn(reason, out, f"INVALID, but not for the reason this case is named for:\n{out}")

    def test_init_prints_only_the_key_id_and_keeps_the_phrase_private(self):
        self.assertRegex(self.keyid, r"^tet-ed25519:[0-9a-f]{64}$")
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
        rc, out = nb("verify", "--dir", self.copy())
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
        "that each record was written before the next one",
        "that no one-time permission was used twice in this log, or after it ran out",
    ]
    PINNED_DOES_NOT_SHOW = [
        "that the reading is true",
        "that the machine's clock was right",
        "where the machine was",
        "who runs the machine",
        "that the key was not copied",
        "that a copied key did not use the same permission in another log",
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

    def lists_problems(self, verify_out, readme):
        """Every place the printed lists or the README's lists differ from the pinned ones."""
        want = (self.PINNED_SHOWS, self.PINNED_DOES_NOT_SHOW)
        out = []
        if (notebook.SHOWS, notebook.DOES_NOT_SHOW) != want:
            out.append("notebook.py's SHOWS / DOES_NOT_SHOW differ from the pinned lists")
        if self.printed_lists(verify_out, "Shows:", "Does not show:", "  - ") != want:
            out.append("verify printed other lists")
        if self.printed_lists(readme, "Shows:", "Does not show:", "- ") != want:
            out.append("README.md quotes other lists")
        return out

    def test_verify_prints_exactly_the_two_lists_and_the_readme_quotes_them(self):
        rc, out = nb("verify", "--dir", self.copy())
        self.assertEqual(rc, 0, out)
        with open(os.path.join(HERE, "README.md")) as f:
            readme = f.read()
        self.assertEqual(self.lists_problems(out, readme), [])
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
        return seq

    def assertOnlyProblem(self, d, reason, prefix=False):
        """verify says INVALID and lists exactly one problem: the one this case is named for."""
        rc, out = nb("verify", "--dir", d)
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
        rc, out = nb("verify", "--dir", d)
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
        rc, out = nb("verify", "--dir", d)
        self.assertEqual((rc, out.splitlines()[0]), (0, "VALID"), out)

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
        def sha(n):
            with open(self.rec(d, n), "rb") as f:
                return hashlib.sha256(f.read()).hexdigest()
        tx_good, tx_wrong = "a" * 64, "b" * 64
        state = {"anchor2": None}

        class Stub(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.startswith("/sigs/search?file="):
                    f = self.path.split("=", 1)[1]
                    recs = {sha(1): [hash1_other], sha(2): [hash2], sha(3): [hash3]}.get(f, [])
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
            rc, out = nb("verify", "--dir", d, "--node", url)
            self.assertEqual(rc, 0, out)
            self.assertIn("stamp: record 1: not on this node", out)  # only another key's record is there
            self.assertIn("stamp: record 2: published, not anchored", out)
            self.assertIn("stamp: record 3: published, not anchored", out)  # found, re-verified here
            state["anchor2"] = {"tx_hash": tx_good, "block_height": 7}
            _, out = nb("verify", "--dir", d, "--node", url)
            self.assertIn("stamp: record 2: existed before block 7 (this node's chain)", out)
            state["anchor2"] = {"tx_hash": tx_wrong, "block_height": 7}
            _, out = nb("verify", "--dir", d, "--node", url)
            self.assertIn("stamp: record 2: anchor stamps a different file", out)
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
