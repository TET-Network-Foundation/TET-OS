#!/usr/bin/env python3
"""Guard for the Sign in with TET prototype (signin.py), over HTTP, with the real tet-cli.

    python3 tools/sign-in/test_signin.py      (TET_CLI=path/to/tet-cli, else target/release/tet-cli)

A server for "example.test" on 127.0.0.1, a client key from `tet-cli keys generate`, then:
  valid       a signed answer to an open challenge          -> accepted, as the client's key
  replay      the same signed answer posted a second time   -> refused, "nonce: already used"
  domain (a)  a challenge of ours with its domain rewritten
              to "evil.test", then validly signed           -> refused, "domain:"
  domain (b)  a challenge issued by an evil.test server,
              signed and relayed to example.test            -> refused, "domain:"
  expired     answered after TTL more challenges were issued -> refused, "expired:"
Each refusal asserts the reason it is named for, never one of several. Every answer is validly signed
by the client's own key, so the signature check passes and the check under test is the one reached.

The replay case is the one only the used-nonce check can refuse: the challenge is ours, exact and
unexpired (asserted: seq <= expires_seq at the replay). The control test below runs the same replay
against a server with that check switched off and asserts it is ACCEPTED: nothing else (expiry, the
exact-challenge check) is standing in for it.

tet-cli is required: without it this fails, it does not skip.
"""

import os
import re
import subprocess
import sys
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import signin  # noqa: E402

CLI = signin.tet_cli()


def new_key():
    out = subprocess.run([CLI, "keys", "generate", "--words", "12"], capture_output=True, text=True, check=True).stdout
    lines = [ln.strip() for ln in out.splitlines()]
    address = lines[lines.index("Public Address (ed25519 vk, hex):") + 1]
    phrase = lines[next(i for i, ln in enumerate(lines) if ln.startswith("Mnemonic")) + 2]
    assert re.fullmatch(r"[0-9a-f]{64}", address) and re.fullmatch(r"[a-z]+( [a-z]+){11}", phrase)
    return f"tet-ed25519:{address}", phrase


class Served:
    def __init__(self, state):
        self.state = state
        self.http = signin.make_http_server(state)
        self.url = f"http://127.0.0.1:{self.http.server_address[1]}"
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def challenge(self):
        code, ch = signin.http_json(self.url + "/challenge")
        assert code == 200, ch
        return ch

    def answer(self, env):
        return signin.http_json(self.url + "/signin", env)

    def close(self):
        self.http.shutdown()
        self.http.server_close()


class NoUsedCheck(signin.SignInServer):
    """The control: the used-nonce check switched off, everything else as shipped."""

    def already_used(self, nonce):
        return False


class SignIn(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.exists(CLI):
            raise AssertionError(f"tet-cli not found at {CLI}: cargo build -p tet-cli --release, or set TET_CLI")
        cls.keyid, cls.phrase = new_key()

    def setUp(self):
        self.site = Served(signin.SignInServer("example.test", CLI))

    def tearDown(self):
        self.site.close()

    def sign(self, ch):
        return signin.sign_challenge(ch, self.phrase, CLI)

    def test_valid_answer_is_accepted(self):
        code, res = self.site.answer(self.sign(self.site.challenge()))
        self.assertEqual((code, res), (200, {"accepted": True, "key": self.keyid}))

    def replay(self, site):
        ch = site.challenge()
        env = self.sign(ch)
        first = site.answer(env)
        self.assertEqual(first, (200, {"accepted": True, "key": self.keyid}))
        # Expiry cannot be what refuses the replay: the challenge is still open.
        self.assertLessEqual(site.state.seq, ch["expires_seq"])
        return site.answer(env)

    def test_replayed_nonce_is_refused(self):
        self.assertEqual(self.replay(self.site), (403, {"refused": "nonce: already used"}))

    def test_control_replay_is_accepted_without_the_used_check(self):
        site = Served(NoUsedCheck("example.test", CLI))
        try:
            self.assertEqual(self.replay(site), (200, {"accepted": True, "key": self.keyid}))
        finally:
            site.close()

    def test_challenge_rewritten_to_another_domain_is_refused(self):
        ch = self.site.challenge()
        ch["domain"] = "evil.test"
        code, res = self.site.answer(self.sign(ch))  # validly signed by the client's own key
        self.assertEqual(code, 403)
        self.assertTrue(res["refused"].startswith("domain:"), res)

    def test_challenge_from_another_site_relayed_here_is_refused(self):
        evil = Served(signin.SignInServer("evil.test", CLI))
        try:
            code, res = self.site.answer(self.sign(evil.challenge()))
        finally:
            evil.close()
        self.assertEqual(code, 403)
        self.assertTrue(res["refused"].startswith("domain:"), res)

    def test_expired_challenge_is_refused(self):
        ch = self.site.challenge()
        for _ in range(signin.TTL):
            self.site.challenge()
        self.assertEqual(self.site.state.seq, ch["expires_seq"])  # still good here, one more ends it
        self.site.challenge()
        code, res = self.site.answer(self.sign(ch))
        self.assertEqual(code, 403)
        self.assertTrue(res["refused"].startswith("expired:"), res)


if __name__ == "__main__":
    unittest.main(verbosity=2)
