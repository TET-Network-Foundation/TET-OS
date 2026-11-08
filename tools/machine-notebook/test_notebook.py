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


def nb(*argv, stdin=""):
    """Run notebook.main in-process; returns (exit code, stdout)."""
    out = io.StringIO()
    old_stdin = sys.stdin
    sys.stdin = io.StringIO(stdin)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = notebook.main(["--tet-cli", CLI, *argv])
    finally:
        sys.stdin = old_stdin
    return rc, out.getvalue()


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

    def test_a_untouched_log_is_valid(self):
        rc, out = nb("verify", "--dir", self.copy())
        self.assertEqual(rc, 0, out)
        self.assertEqual(out.splitlines()[0], "VALID")
        self.assertIn(f"3 records, all signed by {self.keyid}", out)
        self.assertIn("stamp: not checked (no node)", out)
        for line in notebook.SHOWS + notebook.DOES_NOT_SHOW:
            self.assertIn(line, out)

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
