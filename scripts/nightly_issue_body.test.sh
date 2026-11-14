#!/usr/bin/env bash
# A public nightly issue about an audit carries counts and the run link, never an advisory's name,
# ID or crate (scripts/nightly_issue_body.sh). Test and guard failures keep their log tail.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
export SHA=abc123 RUN_URL=https://example.invalid/run/1
fail() { echo "FAIL: $*"; exit 1; }

cat > "$t/cargo.log" <<'LOG'
    Scanning Cargo.lock for vulnerabilities (830 crate dependencies)
Crate:     rustls
Version:   0.23.45
Title:     Unauthenticated ServerHello can downgrade later connections
ID:        RUSTSEC-2026-0349
URL:       https://rustsec.org/advisories/RUSTSEC-2026-0349
error: 24 vulnerabilities found!
warning: 13 allowed warnings found
LOG
cat > "$t/npm.log" <<'LOG'
# npm audit report
next  15.0.0 - 15.2.2
Severity: high
Authorization bypass - https://github.com/advisories/GHSA-f82v-jwr5-mffw
3 vulnerabilities (1 low, 2 high)
LOG

for f in cargo npm; do
  body=$(bash "$here/nightly_issue_body.sh" "$f audit" "$t/$f.log" counts)
  for leak in RUSTSEC GHSA rustls ServerHello Authorization advisories next; do
    if grep -q "$leak" <<<"$body"; then fail "$f: the public body names '$leak'"; fi
  done
  grep -q "run: https://example.invalid/run/1" <<<"$body" || fail "$f: no run link"
done
body=$(bash "$here/nightly_issue_body.sh" "cargo audit" "$t/cargo.log" counts)
grep -q "found: 24 vulnerabilities found; 13 allowed warnings found" <<<"$body" || fail "cargo counts missing: $body"
body=$(bash "$here/nightly_issue_body.sh" "npm audit" "$t/npm.log" counts)
grep -q "found: 3 vulnerabilities (1 low, 2 high)" <<<"$body" || fail "npm counts missing: $body"

echo "test result 1 failed" > "$t/test.log"
body=$(bash "$here/nightly_issue_body.sh" "cargo test" "$t/test.log" log)
grep -q "test result 1 failed" <<<"$body" || fail "a test failure lost its log tail"

if bash "$here/nightly_issue_body.sh" x "$t/test.log" other >/dev/null 2>&1; then fail "an unknown kind was accepted"; fi
echo "nightly_issue_body: ok"
