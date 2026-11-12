#!/usr/bin/env python3
"""Fixture for "Check a machine's log" (app/lib/machine_log.mjs, scripts/try_machine_log_guard.mjs).

    TET_CLI=path/to/tet-cli python3 scripts/make_machine_log_fixture.py

Every file in it is written by the real tools/machine-notebook/notebook.py and signed by the real
`tet-cli agent sign`; every case carries what the real `notebook.py verify` printed for it. The guard
then holds the page's verdict to that output. Nothing here is signed by the page's own code.

A case is the base log with some files replaced or removed. Cases that need a record notebook.py's
`record` would refuse (a reused or expired permit) are written with notebook.py's own canonical() and
sign(), so the signature is valid and only the check the case is named for can refuse it.

device.key is never written to the fixture: the device phrase is thrown away with the temp folder.
"""

import base64
import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

# Importing notebook.py must not leave a __pycache__ in tools/.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
NB_PATH = os.path.join(REPO, "tools", "machine-notebook", "notebook.py")
OUT = os.path.join(HERE, "fixtures", "machine_log_v1.json")
# The chain tet-core's own agent-envelope test vectors use (tet-core/src/testdata).
CHAIN_ID = "tet-agent-interop-1"
GENESIS = "0x9f2c1b7a4d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607182"

spec = importlib.util.spec_from_file_location("notebook", NB_PATH)
nb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nb)
CLI = os.environ.get("TET_CLI") or os.path.join(REPO, "target", "release", "tet-cli")


def run(args, stdin=None):
    """notebook.py main() in-process; returns (exit code, stdout)."""
    buf = io.StringIO()
    old_stdin = sys.stdin
    try:
        if stdin is not None:
            sys.stdin = io.StringIO(stdin)
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
            rc = nb.main(["--tet-cli", CLI] + args)
    finally:
        sys.stdin = old_stdin
    return rc, buf.getvalue()


def init(d):
    env = {"TET_CHAIN_ID": CHAIN_ID, "TET_GENESIS_HASH": GENESIS}
    os.environ.update(env)
    rc, out = run(["init", "--dir", d])
    assert rc == 0, out
    return out.strip()


def record(d, value, unit, permit=None):
    args = ["record", "--dir", d, "--source", "stdin-json"] + (["--permit", permit] if permit else [])
    rc, out = run(args, stdin=json.dumps({"value": value, "unit": unit}))
    assert rc == 0, out


def permit(d, action, expires):
    rc, out = run(["permit", "--dir", d, "--action", action, "--expires-seq", str(expires)])
    assert rc == 0, out
    return out.strip()


def forced_record(d, value, unit, permit_id, clock="2026-11-12T08:00:00Z"):
    """A record notebook.py's `record` would refuse, written and signed exactly as it writes one."""
    chain = nb.chain_lines(d)
    seq = len(chain) + 1
    rec = {"v": 1, "kind": nb.KIND, "seq": seq, "prev": chain[-1] if chain else nb.ZERO,
           "reading": {"source": "stdin-json", "value": value, "unit": unit}, "clock_utc": clock, "permit": permit_id}
    path = os.path.join(d, "records", f"{seq}.json")
    body = nb.canonical(rec)
    with open(path, "wb") as f:
        f.write(body)
    nb.sign(CLI, d, path, nb.PAYLOAD_TYPE)
    with open(os.path.join(d, "chain.txt"), "a") as f:
        f.write(nb.sha256_hex(body) + "\n")


def snapshot(d):
    files = {}
    for root, _, names in os.walk(d):
        for n in names:
            p = os.path.join(root, n)
            rel = os.path.relpath(p, d).replace(os.sep, "/")
            if rel == "device.key":
                continue
            with open(p, "rb") as f:
                files[rel] = base64.b64encode(f.read()).decode()
    return dict(sorted(files.items()))


def verify(d):
    """Run from the folder's parent with a relative --dir, so no temp path lands in the fixture."""
    here = os.getcwd()
    os.chdir(os.path.dirname(d))
    try:
        rc, out = run(["verify", "--dir", os.path.basename(d)])
    finally:
        os.chdir(here)
    return {"exit": rc, "stdout": out}


def overlay(base, now):
    return {k: now.get(k) for k in sorted(set(base) | set(now)) if base.get(k) != now.get(k)}


def main():
    if not os.path.exists(CLI):
        sys.exit(f"tet-cli not found at {CLI}; set TET_CLI")
    cases = []
    with tempfile.TemporaryDirectory() as t:
        base_dir = os.path.join(t, "base")
        keyid = init(base_dir)
        # Readings chosen so a re-serializer that is not Python's own would differ: a float that is
        # integral (21.0), one in exponent form (1e-05), non-ASCII text (escaped by ensure_ascii).
        pid = permit(base_dir, "open-valve", 3)
        record(base_dir, 0.25, "load-1m")
        record(base_dir, 21.0, "°C", permit=pid)
        record(base_dir, 1e-05, "volt")
        record(base_dir, "ok", "状態")
        base = snapshot(base_dir)
        cases.append({"name": "valid", "why": "four records, record 2 cites a permit once", "files": {}, "verify": verify(base_dir)})

        def case(name, why, mutate):
            d = os.path.join(t, name)
            shutil.copytree(base_dir, d)
            mutate(d)
            cases.append({"name": name, "why": why, "files": overlay(base, snapshot(d)), "verify": verify(d)})

        def edit_reading(d):
            p = os.path.join(d, "records", "2.json")
            with open(p, "rb") as f:
                body = f.read()
            with open(p, "wb") as f:
                f.write(body.replace(b'"value":21.0', b'"value":29.0'))

        case("reading_changed", "record 2's reading edited after signing", edit_reading)

        def drop_record(d):
            os.remove(os.path.join(d, "records", "3.json"))
            os.remove(os.path.join(d, "records", "3.json.sig.json"))

        case("record_missing", "record 3 and its envelope removed", drop_record)

        def reuse(d):
            for s in ("3", "4"):
                os.remove(os.path.join(d, "records", f"{s}.json"))
                os.remove(os.path.join(d, "records", f"{s}.json.sig.json"))
            with open(os.path.join(d, "chain.txt")) as f:
                lines = f.read().splitlines()[:2]
            with open(os.path.join(d, "chain.txt"), "w") as f:
                f.write("".join(x + "\n" for x in lines))
            forced_record(d, 1e-05, "volt", pid)

        case("permit_reused", "record 3 cites record 2's permit again, correctly signed", reuse)

        def expired(d):
            for s in ("3", "4"):
                os.remove(os.path.join(d, "records", f"{s}.json"))
                os.remove(os.path.join(d, "records", f"{s}.json.sig.json"))
            with open(os.path.join(d, "chain.txt")) as f:
                lines = f.read().splitlines()[:2]
            with open(os.path.join(d, "chain.txt"), "w") as f:
                f.write("".join(x + "\n" for x in lines))
            p2 = permit(d, "close-valve", 2)
            forced_record(d, 1e-05, "volt", p2)

        case("permit_expired", "record 3 cites a permit whose expires_seq is 2, correctly signed", expired)

        def foreign_permit(d):
            other = os.path.join(t, "other-permit-device")
            init(other)
            p3 = permit(other, "open-valve", 9)
            for ext in (".json", ".json.sig.json"):
                shutil.copy(os.path.join(other, "permits", p3 + ext), os.path.join(d, "permits", p3 + ext))
            for s in ("3", "4"):
                os.remove(os.path.join(d, "records", f"{s}.json"))
                os.remove(os.path.join(d, "records", f"{s}.json.sig.json"))
            with open(os.path.join(d, "chain.txt")) as f:
                lines = f.read().splitlines()[:2]
            with open(os.path.join(d, "chain.txt"), "w") as f:
                f.write("".join(x + "\n" for x in lines))
            forced_record(d, 1e-05, "volt", p3)

        case("permit_other_key", "record 3 cites a permit signed by another device's key", foreign_permit)

        def keep_two(d):
            """Records 3 and 4 removed, so a forced record 3 follows record 2."""
            for s in ("3", "4"):
                os.remove(os.path.join(d, "records", f"{s}.json"))
                os.remove(os.path.join(d, "records", f"{s}.json.sig.json"))
            with open(os.path.join(d, "chain.txt")) as f:
                lines = f.read().splitlines()[:2]
            with open(os.path.join(d, "chain.txt"), "w") as f:
                f.write("".join(x + "\n" for x in lines))

        def permit_edited(d):
            # Record 2's permit: expires_seq raised after signing. Record 2 itself is untouched.
            p = os.path.join(d, "permits", f"{pid}.json")
            with open(p, "rb") as f:
                body = f.read()
            assert b'"expires_seq":3' in body
            with open(p, "wb") as f:
                f.write(body.replace(b'"expires_seq":3', b'"expires_seq":9'))

        case("permit_edited", "record 2's permit edited after signing (expires_seq 3 -> 9)", permit_edited)

        def permit_copied(d):
            # One signed permit under a second file name: its bytes and envelope verify, but the id
            # inside them is the first name's.
            keep_two(d)
            copy = "0" * 31 + "1"
            for ext in (".json", ".json.sig.json"):
                shutil.copy(os.path.join(d, "permits", pid + ext), os.path.join(d, "permits", copy + ext))
            forced_record(d, 1e-05, "volt", copy)

        case("permit_copied", "record 3 cites a copy of record 2's permit saved under another id", permit_copied)

        def permit_missing(d):
            keep_two(d)
            forced_record(d, 1e-05, "volt", "f" * 32)

        case("permit_missing", "record 3 cites a permit id that is not in permits/", permit_missing)

        def permit_wrong_type(d):
            # A permit's exact bytes, signed by the device key, but as a log record (payload type).
            keep_two(d)
            p4 = permit(d, "drain", 9)
            nb.sign(CLI, d, os.path.join(d, "permits", f"{p4}.json"), nb.PAYLOAD_TYPE)
            forced_record(d, 1e-05, "volt", p4)

        case("permit_wrong_type", "record 3 cites a permit whose envelope is a log record's payload type", permit_wrong_type)

        def other_key(d):
            other = os.path.join(t, "other-record-device")
            init(other)
            shutil.copy(os.path.join(other, "device.key"), os.path.join(d, "device.key"))
            os.remove(os.path.join(d, "records", "4.json"))
            os.remove(os.path.join(d, "records", "4.json.sig.json"))
            with open(os.path.join(d, "chain.txt")) as f:
                lines = f.read().splitlines()[:3]
            with open(os.path.join(d, "chain.txt"), "w") as f:
                f.write("".join(x + "\n" for x in lines))
            record(d, "ok", "状態")

        case("record_other_key", "record 4 signed by another device's key", other_key)

        def swap_half(prefix):
            def go(d):
                # A VALID signature half, over a different payload (record 2's), in record 1's
                # envelope: exactly one half is wrong, so only a verifier that checks it refuses.
                p1 = os.path.join(d, "records", "1.json.sig.json")
                with open(p1) as f:
                    e1 = json.load(f)
                with open(os.path.join(d, "records", "2.json.sig.json")) as f:
                    e2 = json.load(f)
                src = next(s for s in e2["signatures"] if s["keyid"].startswith(prefix))
                for s in e1["signatures"]:
                    if s["keyid"].startswith(prefix):
                        s["sig"] = src["sig"]
                with open(p1, "w") as f:
                    f.write(json.dumps(e1, indent=2) + "\n")
            return go

        case("ed25519_half_swapped", "record 1's Ed25519 signature replaced by record 2's (valid, other payload)", swap_half("tet-ed25519:"))
        case("mldsa_half_swapped", "record 1's ML-DSA-44 signature replaced by record 2's (valid, other payload)", swap_half("tet-mldsa44:"))

        def not_canonical(d):
            p = os.path.join(d, "records", "1.json")
            with open(p, "rb") as f:
                rec = json.loads(f.read())
            # Same object, spaces after separators: valid JSON, re-signed, but not canonical.
            body = json.dumps(rec, sort_keys=True, ensure_ascii=True).encode()
            with open(p, "wb") as f:
                f.write(body)
            nb.sign(CLI, d, p, nb.PAYLOAD_TYPE)

        case("record_not_canonical", "record 1 re-indented and re-signed", not_canonical)

    doc = {
        "_what": "notebook folders for the try page's machine-log check, and what notebook.py verify said about each",
        "_produced_by": "scripts/make_machine_log_fixture.py: tools/machine-notebook/notebook.py and tet-cli agent sign/verify",
        "_device_key": "not included; each device phrase was discarded with its temp folder",
        "chain": {"chain_id": CHAIN_ID, "genesis_hash": GENESIS},
        "keyid": keyid,
        "base": base,
        "cases": cases,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    for c in cases:
        print(f"{c['name']:24} exit {c['verify']['exit']}: {c['verify']['stdout'].splitlines()[0]}")


if __name__ == "__main__":
    main()
