#!/usr/bin/env python3
"""Regenerate tet-core/src/testdata/agent_halves_v1.json.

    python3 tet-cli/scripts/make_halves_fixture.py [path-to-tet-cli]

Every TET signature has two halves, Ed25519 and ML-DSA-44, and the signer always makes both. A
verifier that only checks "every half that is present verifies" would accept a record cut down to
one half. This fixture is one valid record signed by the real `tet-cli agent sign`, and the same
record with exactly one half removed, emptied, or relabelled. Each verifier's guard reads it and
must accept `base` and refuse every case, for the reason the guard pins.

The record is hash-only (application/vnd.tet.sha256, 32 bytes), so every verifier takes it: the
agent envelope check, `tet-cli agent verify`, the node's signature registry, the agent SDK and the
offline verifier.

The cases are cut from the signed record without re-signing: removing a half needs no key. The
mnemonic is the public BIP39 test vector the other agent fixtures use, read from
agent_payload_envelopes.json; it holds no funds.
"""

import base64
import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TESTDATA = os.path.join(REPO, "tet-core", "src", "testdata")
OUT = os.path.join(TESTDATA, "agent_halves_v1.json")
CLI = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "target", "debug", "tet-cli")

ED = "tet-ed25519:"
ML = "tet-mldsa44:"
HASH_TYPE = "application/vnd.tet.sha256"


def main():
    src = json.load(open(os.path.join(TESTDATA, "agent_payload_envelopes.json"), encoding="utf-8"))
    chain = src["chain"]
    mnemonic = src["cases"][0]["mnemonic"]
    payload = hashlib.sha256(b"agent halves fixture v1").digest()

    with tempfile.TemporaryDirectory() as work:
        pin = os.path.join(work, "payload.bin")
        sig = os.path.join(work, "payload.sig.json")
        open(pin, "wb").write(payload)
        env = dict(os.environ, TET_CHAIN_ID=chain["chain_id"], TET_GENESIS_HASH=chain["genesis_hash"], TET_MNEMONIC=mnemonic)
        subprocess.run([CLI, "agent", "sign", "--in", pin, "--payload-type", HASH_TYPE, "--out", sig],
                       env=env, check=True, stdout=subprocess.DEVNULL)
        base = json.load(open(sig, encoding="utf-8"))
        # The record must verify before anything is cut from it, or every case is refused for nothing.
        subprocess.run([CLI, "agent", "verify", "--sig", sig, "--payload", pin], env=env, check=True,
                       stdout=subprocess.DEVNULL)

    assert sum(s["keyid"].startswith(ED) for s in base["signatures"]) == 1
    assert sum(s["keyid"].startswith(ML) for s in base["signatures"]) == 1

    def cut(fn):
        e = copy.deepcopy(base)
        fn(e)
        return e

    def half(e, prefix):
        return next(s for s in e["signatures"] if s["keyid"].startswith(prefix))

    def keep_only(prefix):
        return lambda e: e.__setitem__("signatures", [s for s in e["signatures"] if s["keyid"].startswith(prefix)])

    def empty(prefix):
        return lambda e: half(e, prefix).__setitem__("sig", "")

    def relabel(prefix, new):
        return lambda e: half(e, prefix).__setitem__("keyid", new + half(e, prefix)["keyid"][len(prefix):])

    cases = [
        ("ed25519_only", "ml-dsa-44", "the ML-DSA-44 signature is removed; only the Ed25519 half is left", keep_only(ED)),
        ("mldsa44_only", "ed25519", "the Ed25519 signature is removed; only the ML-DSA-44 half is left", keep_only(ML)),
        ("ed25519_sig_empty", "ed25519", "the Ed25519 signature is an empty string", empty(ED)),
        ("mldsa44_sig_empty", "ml-dsa-44", "the ML-DSA-44 signature is an empty string", empty(ML)),
        ("ed25519_label_changed", "ed25519", "the Ed25519 half's keyid says tet-ed448: instead of tet-ed25519:", relabel(ED, "tet-ed448:")),
        ("mldsa44_label_changed", "ml-dsa-44", "the ML-DSA-44 half's keyid says tet-mldsa65: instead of tet-mldsa44:", relabel(ML, "tet-mldsa65:")),
    ]

    doc = {
        "_what": "One hash-only record signed by tet-cli agent sign, and the same record with exactly one signature half removed, emptied or relabelled. Every verifier must accept base and refuse every case.",
        "_produced_by": "tet-cli/scripts/make_halves_fixture.py (the real tet-cli agent sign; cases are cut from its output, not re-signed)",
        "_mnemonic": "the public BIP39 test vector from agent_payload_envelopes.json; not stored here",
        "chain": chain,
        "payload_type": HASH_TYPE,
        "payload_b64": base64.b64encode(payload).decode(),
        "base": base,
        "cases": [{"name": n, "broken_half": h, "what": w, "envelope": cut(fn)} for n, h, w, fn in cases],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print(f"wrote {os.path.relpath(OUT, REPO)}: base + {len(cases)} cases")


if __name__ == "__main__":
    main()
