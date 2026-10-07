#!/usr/bin/env python3
"""Decide seed liveness from the healthchecks.io Management API, for .github/workflows/seed-liveness.yml.

    curl -fsS -H "X-Api-Key: $KEY" https://healthchecks.io/api/v3/checks/ > checks.json
    python3 scripts/hc_status.py --min-checks 2 checks.json

Passes only when the project has at least --min-checks checks and EVERY one of them is "up".
"grace" (a ping is late), "down", "new" (never pinged), "paused" and "started" all fail: each
means a check cannot vouch that its seed's chain advanced in the last minute. A missing or
malformed document fails too: this check must never pass because it could not see.

Why it exists: until 2026-10-04 this workflow only TCP-connected to the P2P port, which the
kernel accepts even while the node above it is wedged. It stayed green through a 33 h outage
(docs/postmortems/2026-10-04-producer-wedge-33h.md). healthchecks.io's status is driven by the
on-box probe, which pings success only when the height advances.
"""
import argparse
import json
import sys


def verdict(doc, min_checks):
    """Return (ok, lines) for a parsed /api/v3/checks/ document."""
    checks = doc.get("checks") if isinstance(doc, dict) else None
    if not isinstance(checks, list):
        return False, ["response has no 'checks' list — wrong key, wrong endpoint, or an API change"]
    lines = []
    ok = True
    if len(checks) < min_checks:
        ok = False
        lines.append(f"only {len(checks)} check(s) in the project, expected at least {min_checks} (one per seed)")
    for c in checks:
        name = c.get("name") or "(unnamed)"
        status = c.get("status")
        lines.append(f"{name}: status={status} last_ping={c.get('last_ping')}")
        if status != "up":
            ok = False
    return ok, lines


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="JSON from GET /api/v3/checks/")
    ap.add_argument("--min-checks", type=int, default=2)
    args = ap.parse_args(argv)
    try:
        with open(args.path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError) as e:
        print(f"::error::cannot read the healthchecks.io response: {e}")
        return 1
    ok, lines = verdict(doc, args.min_checks)
    for line in lines:
        print(line)
    if not ok:
        print("::error::a seed check is not up on healthchecks.io")
        return 1
    print("all seed checks are up")
    return 0


if __name__ == "__main__":
    sys.exit(main())
