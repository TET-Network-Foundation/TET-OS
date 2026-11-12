#!/usr/bin/env python3
"""Sign in with TET, a local-only prototype. Design not reviewed; not for real logins.

    python3 tools/sign-in/signin.py serve  --domain example.test [--port 8765]
    TET_MNEMONIC='…12 words…' python3 tools/sign-in/signin.py login --server http://127.0.0.1:8765

The server issues a challenge {v, kind, domain, nonce, expires_seq}. The client signs its exact bytes
with `tet-cli agent sign` (payload type application/vnd.tet.signin-challenge+json) and posts the
envelope back. The server checks it with `tet-cli agent verify`, then, in this order:
  payload type → challenge JSON → domain → nonce issued here → the exact challenge issued
  → nonce not used before → not expired
and accepts each nonce once. No new cryptography: every signature and every signature check is tet-cli.

`expires_seq` counts challenges, not time: the server's seq goes up by one for every challenge it
issues, and a challenge is good while seq <= its expires_seq. Deterministic, so the tests need no clock.

Shows: this key answered this challenge for this domain. Does not show: who holds the key.
The server binds to 127.0.0.1 only and keeps everything in memory.
"""

import argparse
import base64
import hashlib
import http.server
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request

KIND = "tet_signin_challenge_v1"
PAYLOAD_TYPE = "application/vnd.tet.signin-challenge+json"
TTL = 8  # a challenge stays good for this many further challenges issued
# The agent envelope binds a chain. This one is plainly an example: no node runs it.
EXAMPLE_CHAIN = {
    "TET_CHAIN_ID": "tet-example-sign-in",
    "TET_GENESIS_HASH": hashlib.sha256(b"tet sign-in prototype").hexdigest(),
}


class Refused(Exception):
    pass


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def tet_cli(path=None):
    return path or os.environ.get("TET_CLI") or "target/release/tet-cli"


def run_cli(cli, argv, env_extra):
    env = dict(os.environ)
    env.pop("TET_MNEMONIC", None)
    env.update(env_extra)
    try:
        p = subprocess.run([cli] + argv, capture_output=True, text=True, env=env, timeout=120)
    except FileNotFoundError:
        raise SystemExit(f"tet-cli not found at {cli} (cargo build -p tet-cli --release, or set TET_CLI)")
    return p.returncode, p.stdout, p.stderr


def ed_keyid(env):
    ids = [s.get("keyid", "") for s in env.get("signatures", []) if str(s.get("keyid", "")).startswith("tet-ed25519:")]
    return ids[0] if len(ids) == 1 else None


# ── server ────────────────────────────────────────────────────────────────────────────────────


class SignInServer:
    """The state: a seq counter, the challenges issued (nonce -> exact bytes), the nonces used."""

    def __init__(self, domain, cli=None, chain=None, ttl=TTL):
        self.domain = domain
        self.cli = tet_cli(cli)
        self.chain = chain or EXAMPLE_CHAIN
        self.ttl = ttl
        self.seq = 0
        self.issued = {}
        self.used = set()
        self.lock = threading.Lock()

    def issue(self):
        with self.lock:
            self.seq += 1
            ch = {"v": 1, "kind": KIND, "domain": self.domain, "nonce": secrets.token_hex(32), "expires_seq": self.seq + self.ttl}
            self.issued[ch["nonce"]] = canonical(ch)
            return ch

    def already_used(self, nonce):
        return nonce in self.used

    def accept(self, env):
        """The signer's key id if the envelope answers an open challenge of ours; else raises Refused."""
        if not isinstance(env, dict) or env.get("payloadType") != PAYLOAD_TYPE:
            raise Refused(f"payload type: not {PAYLOAD_TYPE}")
        with tempfile.TemporaryDirectory() as d:
            sig = os.path.join(d, "response.sig.json")
            with open(sig, "w") as f:
                json.dump(env, f)
            rc, out, _ = run_cli(self.cli, ["agent", "verify", "--sig", sig], self.chain)
        if rc != 0:
            plain = re.sub(r"\x1b\[[0-9;]*m", "", out)
            why = next((ln.split(":", 1)[1].strip() for ln in plain.splitlines() if ln.startswith("FAIL")), "tet-cli agent verify refused it")
            raise Refused(f"signature: {why}")
        key = ed_keyid(env)
        if not key:
            raise Refused("signature: no single Ed25519 key id")
        try:
            body = base64.b64decode(env.get("payload", ""), validate=True)
            ch = json.loads(body)
        except ValueError:
            raise Refused("challenge: not JSON")
        if not isinstance(ch, dict) or ch.get("kind") != KIND or canonical(ch) != body:
            raise Refused(f"challenge: not a canonical {KIND}")
        if ch.get("domain") != self.domain:
            raise Refused(f"domain: the challenge is for {ch.get('domain')!r}, this is {self.domain!r}")
        nonce = ch.get("nonce")
        with self.lock:
            if nonce not in self.issued:
                raise Refused("nonce: not issued here")
            if self.issued[nonce] != body:
                raise Refused("challenge: not the one issued for this nonce")
            if self.already_used(nonce):
                raise Refused("nonce: already used")
            if self.seq > ch["expires_seq"]:
                raise Refused(f"expired: seq is {self.seq}, the challenge was good to {ch['expires_seq']}")
            self.used.add(nonce)
        return key


def make_http_server(state, port=0):
    class Handler(http.server.BaseHTTPRequestHandler):
        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/challenge":
                self._send(200, state.issue())
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/signin":
                return self._send(404, {"error": "not found"})
            n = int(self.headers.get("Content-Length") or 0)
            if n > 64 * 1024:
                return self._send(413, {"refused": "too large"})
            try:
                env = json.loads(self.rfile.read(n))
                self._send(200, {"accepted": True, "key": state.accept(env)})
            except ValueError:
                self._send(400, {"refused": "not JSON"})
            except Refused as e:
                self._send(403, {"refused": str(e)})

        def log_message(self, *a):
            pass

    # Local only: never bound to anything but the loopback address.
    return http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)


# ── client ────────────────────────────────────────────────────────────────────────────────────


def sign_challenge(challenge, phrase, cli=None, chain=None):
    """The envelope tet-cli agent sign makes over the challenge's exact canonical bytes."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "challenge.json")
        with open(path, "wb") as f:
            f.write(canonical(challenge))
        rc, _, err = run_cli(tet_cli(cli), ["agent", "sign", "--in", path, "--payload-type", PAYLOAD_TYPE], {**(chain or EXAMPLE_CHAIN), "TET_MNEMONIC": phrase})
        if rc != 0:
            raise SystemExit(f"signing failed: {err.strip()[-300:]}")
        with open(path + ".sig.json") as f:
            return json.load(f)


def http_json(url, data=None):
    req = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        with e:
            return e.code, json.load(e)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--tet-cli", help="path to tet-cli (else env TET_CLI, else target/release/tet-cli)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the challenge server on 127.0.0.1")
    s.add_argument("--domain", required=True)
    s.add_argument("--port", type=int, default=8765)
    c = sub.add_parser("login", help="fetch a challenge, sign it (TET_MNEMONIC), post it back")
    c.add_argument("--server", default="http://127.0.0.1:8765")
    a = p.parse_args()
    if a.cmd == "serve":
        srv = make_http_server(SignInServer(a.domain, a.tet_cli), a.port)
        print(f"prototype, not for real logins: {a.domain} on http://127.0.0.1:{srv.server_address[1]}", flush=True)
        srv.serve_forever()
    else:
        phrase = os.environ.get("TET_MNEMONIC", "").strip()
        if not phrase:
            raise SystemExit("set TET_MNEMONIC to the words of the key to sign in with")
        _, ch = http_json(a.server + "/challenge")
        print(f"challenge for {ch.get('domain')!r}, nonce {ch.get('nonce', '')[:16]}…")
        code, res = http_json(a.server + "/signin", sign_challenge(ch, phrase, a.tet_cli))
        print(json.dumps(res))
        sys.exit(0 if code == 200 else 1)


if __name__ == "__main__":
    main()
