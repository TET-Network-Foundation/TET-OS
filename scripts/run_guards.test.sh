#!/usr/bin/env bash
# Tests for scripts/run_guards.sh (CI's shell job): it stops at the first red guard and exits
# non-zero, never runs the guards after it, and exits 0 only when every guard ran green.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p tet-network/ui/node_modules 2>/dev/null   # the runner refuses to start without it
failed=0
pass() { echo "ok   $1"; }
flunk() { echo "FAIL $1"; [ -n "${2:-}" ] && echo "     $2"; failed=$((failed + 1)); }

# A red guard in the middle: exit 1, and the guard after it is never run.
printf '.\ttrue\n.\tsh -c "echo FAIL boom; exit 3"\n.\ttouch %s/after-red\n' "$W" > "$W/list1"
TET_GUARDS_LIST="$W/list1" bash scripts/run_guards.sh > "$W/o1" 2>&1; rc=$?
if [ "$rc" = 1 ] && grep -q "^RED " "$W/o1" && grep -q "STOPPED at the first red guard" "$W/o1"; then pass "a red guard: exit 1, named, stopped"; else flunk "a red guard: exit 1, named, stopped" "rc=$rc $(cat "$W/o1")"; fi
if [ ! -e "$W/after-red" ]; then pass "the guard after a red one is not run"; else flunk "the guard after a red one is not run"; fi

# All green: exit 0, every guard run.
printf '.\ttrue\n.\ttouch %s/ran-1\n.\ttouch %s/ran-2\n' "$W" "$W" > "$W/list2"
TET_GUARDS_LIST="$W/list2" bash scripts/run_guards.sh > "$W/o2" 2>&1; rc=$?
if [ "$rc" = 0 ] && [ -e "$W/ran-1" ] && [ -e "$W/ran-2" ] && grep -q "all 3 guards green" "$W/o2"; then pass "all green: exit 0, all run"; else flunk "all green: exit 0, all run" "rc=$rc $(cat "$W/o2")"; fi

# A loop over branches with `&&` stops at the red one (the way scripts must call it).
pushed=0
for list in "$W/list2" "$W/list1" "$W/list2"; do
  TET_GUARDS_LIST="$list" bash scripts/run_guards.sh > /dev/null 2>&1 || break
  pushed=$((pushed + 1))
done
if [ "$pushed" = 1 ]; then pass "a loop stops at the first branch with a red guard"; else flunk "a loop stops at the first branch with a red guard" "pushed=$pushed"; fi

# Nothing to run is not green.
: > "$W/empty"
TET_GUARDS_LIST="$W/empty" bash scripts/run_guards.sh > "$W/o3" 2>&1; rc=$?
if [ "$rc" = 2 ]; then pass "no guards found: exit 2, not 0"; else flunk "no guards found: exit 2, not 0" "rc=$rc"; fi

# The real list is read from ci.yml and is not empty.
n=$(awk '/^  [A-Za-z0-9_-]+:[[:space:]]*$/ { job = $1; sub(":", "", job) } job == "ui" && /^[[:space:]]+run: node .*scripts\/[A-Za-z0-9_]+\.mjs/' .github/workflows/ci.yml | wc -l | tr -d ' ')
if [ "$n" -gt 0 ]; then pass "ci.yml's ui job has $n guard steps for the runner"; else flunk "ci.yml's ui job has guard steps for the runner"; fi

if [ "$failed" -eq 0 ]; then echo "all passed"; exit 0; else echo "$failed FAILED"; exit 1; fi
