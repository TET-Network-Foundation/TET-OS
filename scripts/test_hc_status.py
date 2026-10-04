#!/usr/bin/env python3
"""Tests for scripts/hc_status.py. Run: python3 scripts/test_hc_status.py (CI: shell job)."""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "hc_status.py")


def run(doc, *extra):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(doc if isinstance(doc, str) else json.dumps(doc))
        path = f.name
    try:
        r = subprocess.run([sys.executable, SCRIPT, path, *extra], capture_output=True, text=True)
        return r.returncode, r.stdout
    finally:
        os.unlink(path)


def checks(*statuses):
    return {"checks": [{"name": f"seed-{i}", "status": s, "last_ping": "2026-10-04T15:18:14+00:00"}
                       for i, s in enumerate(statuses)]}


CASES = [
    ("both up → pass", checks("up", "up"), 0),
    ("one down → fail", checks("up", "down"), 1),
    ("one late (grace) → fail", checks("up", "grace"), 1),
    ("one never pinged (new) → fail", checks("up", "new"), 1),
    ("one paused → fail", checks("paused", "up"), 1),
    ("only one check → fail", checks("up"), 1),
    ("no checks list (wrong key / API change) → fail", {"error": "wrong api key"}, 1),
    ("not JSON → fail", "<html>rate limited</html>", 1),
    # The shape check on its own: with no minimum, a document without a checks list must still fail.
    ("no checks list, --min-checks 0 → fail", {"error": "wrong api key"}, 1, "--min-checks", "0"),
]

failed = 0
for name, doc, want, *extra in CASES:
    got, out = run(doc, *extra)
    if got == want:
        print(f"ok   {name}")
    else:
        failed += 1
        print(f"FAIL {name}: exit {got}, wanted {want}\n{out}")
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
