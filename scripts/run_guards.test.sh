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

# The runner refuses to run with untracked files, so the cases below run it in a throwaway repo
# holding a copy of it (a developer's own untracked files can't decide them), committed and clean.
R="$W/repo"; mkdir -p "$R/scripts" "$R/.github/workflows" "$R/tet-network/ui/node_modules"
cp scripts/run_guards.sh "$R/scripts/"
printf 'jobs:\n' > "$R/.github/workflows/ci.yml"
printf 'node_modules/\n*.ignored\n' > "$R/.gitignore"
(cd "$R" && git init -q && git add scripts/run_guards.sh .github/workflows/ci.yml .gitignore \
  && git -c user.name=t -c user.email=t@t.invalid commit -qm init) || { echo "FAIL could not set up the test repo"; exit 1; }
RUNNER="$R/scripts/run_guards.sh"

# A red guard in the middle: exit 1, and the guard after it is never run.
printf '.\ttrue\n.\tsh -c "echo FAIL boom; exit 3"\n.\ttouch %s/after-red\n' "$W" > "$W/list1"
TET_GUARDS_LIST="$W/list1" bash "$RUNNER" > "$W/o1" 2>&1; rc=$?
if [ "$rc" = 1 ] && grep -q "^RED " "$W/o1" && grep -q "STOPPED at the first red guard" "$W/o1"; then pass "a red guard: exit 1, named, stopped"; else flunk "a red guard: exit 1, named, stopped" "rc=$rc $(cat "$W/o1")"; fi
if [ ! -e "$W/after-red" ]; then pass "the guard after a red one is not run"; else flunk "the guard after a red one is not run"; fi

# All green: exit 0, every guard run.
printf '.\ttrue\n.\ttouch %s/ran-1\n.\ttouch %s/ran-2\n' "$W" "$W" > "$W/list2"
TET_GUARDS_LIST="$W/list2" bash "$RUNNER" > "$W/o2" 2>&1; rc=$?
if [ "$rc" = 0 ] && [ -e "$W/ran-1" ] && [ -e "$W/ran-2" ] && grep -q "all 3 guards green" "$W/o2"; then pass "all green: exit 0, all run"; else flunk "all green: exit 0, all run" "rc=$rc $(cat "$W/o2")"; fi

# A loop over branches with `&&` stops at the red one (the way scripts must call it).
pushed=0
for list in "$W/list2" "$W/list1" "$W/list2"; do
  TET_GUARDS_LIST="$list" bash "$RUNNER" > /dev/null 2>&1 || break
  pushed=$((pushed + 1))
done
if [ "$pushed" = 1 ]; then pass "a loop stops at the first branch with a red guard"; else flunk "a loop stops at the first branch with a red guard" "pushed=$pushed"; fi

# Nothing to run is not green.
: > "$W/empty"
TET_GUARDS_LIST="$W/empty" bash "$RUNNER" > "$W/o3" 2>&1; rc=$?
if [ "$rc" = 2 ]; then pass "no guards found: exit 2, not 0"; else flunk "no guards found: exit 2, not 0" "rc=$rc"; fi

# The real list is read from ci.yml and is not empty. The parser is taken out of run_guards.sh
# itself (the awk program between `list=$(awk '` and `' "$CI")`), so this test can't drift from it.
PARSER=$(awk "/list=\\\$\\(awk '/{f=1; next} f && /' \"\\\$CI\"\\)/{f=0} f" scripts/run_guards.sh)
[ -n "$PARSER" ] || flunk "the parser could be read out of run_guards.sh"
listed=$(awk "$PARSER" .github/workflows/ci.yml)
n=$(grep -c '^tet-network/ui' <<<"$listed")
if [ "$n" -gt 0 ]; then pass "ci.yml's ui job has $n guard steps for the runner"; else flunk "ci.yml's ui job has guard steps for the runner"; fi

# Every `node … scripts/<name>.mjs` step of the ui job reaches the runner, whatever its name: a
# guard named with a hyphen (verify-genesis-hash.mjs) was once silently left out locally.
missing=$(awk '/^  [A-Za-z0-9_-]+:[[:space:]]*$/ { job = $1; sub(":", "", job) } job == "ui" && /^[[:space:]]+run: node .*scripts\/[^ \/]+\.mjs/ { sub(/^[[:space:]]+run: /, ""); print }' .github/workflows/ci.yml \
  | while IFS= read -r step; do grep -qxF "tet-network/ui	$step" <<<"$listed" || echo "$step"; done)
if [ -z "$missing" ]; then pass "every ui-job guard step reaches the runner"; else flunk "every ui-job guard step reaches the runner" "left out: $missing"; fi

# The rust job's Python guard is picked up too (the machine notebook), and run from the root.
nb=$(awk '/^  [A-Za-z0-9_-]+:[[:space:]]*$/ { job = $1; sub(":", "", job) } job == "rust" && /^[[:space:]]+run: python3 tools\/[A-Za-z0-9_\/-]+\/test_[A-Za-z0-9_]+\.py[[:space:]]*$/' .github/workflows/ci.yml | grep -c 'tools/machine-notebook/test_notebook.py')
if [ "$nb" = 1 ]; then pass "ci.yml's rust job lists the machine notebook guard for the runner"; else flunk "ci.yml's rust job lists the machine notebook guard for the runner" "found $nb"; fi

# Untracked files: a guard that scans `git ls-files` (as try_privacy_guard does) cannot see a file
# that isn't committed, so the runner must not report green while one exists (2026-11-12).
SCAN="sh -c '! git ls-files -z | xargs -0 grep -l untraceable'"
printf '.\t%s\n.\ttouch %s/scan-ran\n' "$SCAN" "$W" > "$W/list-scan"
TET_GUARDS_LIST="$W/list-scan" bash "$RUNNER" > "$W/o5" 2>&1; rc=$?
if [ "$rc" = 0 ]; then pass "a clean repo: the scanning guard runs green"; else flunk "a clean repo: the scanning guard runs green" "rc=$rc $(cat "$W/o5")"; fi
rm -f "$W/scan-ran"
printf 'Messages are untraceable.\n' > "$R/page.html"
# The trap itself: run alone, the scanning guard is green although page.html holds the phrase.
if (cd "$R" && sh -c '! git ls-files -z | xargs -0 grep -l untraceable') > /dev/null 2>&1; then pass "control: the scan alone misses the untracked file (the false green)"; else flunk "control: the scan alone misses the untracked file (the false green)"; fi
TET_GUARDS_LIST="$W/list-scan" bash "$RUNNER" > "$W/o6" 2>&1; rc=$?
if [ "$rc" = 2 ] && grep -q "untracked files not scanned: page.html" "$W/o6" && grep -q "commit or stash first" "$W/o6"; then pass "an untracked file with a banned phrase: exit 2, named"; else flunk "an untracked file with a banned phrase: exit 2, named" "rc=$rc $(cat "$W/o6")"; fi
if [ ! -e "$W/scan-ran" ]; then pass "with untracked files no guard is run"; else flunk "with untracked files no guard is run"; fi
(cd "$R" && git add page.html && git -c user.name=t -c user.email=t@t.invalid commit -qm page)
TET_GUARDS_LIST="$W/list-scan" bash "$RUNNER" > "$W/o7" 2>&1; rc=$?
if [ "$rc" = 1 ] && grep -q "^RED " "$W/o7"; then pass "the same file committed: the scanning guard goes red"; else flunk "the same file committed: the scanning guard goes red" "rc=$rc $(cat "$W/o7")"; fi
(cd "$R" && git rm -q page.html && git -c user.name=t -c user.email=t@t.invalid commit -qm rm)
printf 'Messages are untraceable.\n' > "$R/notes.ignored"
TET_GUARDS_LIST="$W/list2" bash "$RUNNER" > "$W/o8" 2>&1; rc=$?
if [ "$rc" = 0 ]; then pass "an ignored file does not stop the run"; else flunk "an ignored file does not stop the run" "rc=$rc $(cat "$W/o8")"; fi

if [ "$failed" -eq 0 ]; then echo "all passed"; exit 0; else echo "$failed FAILED"; exit 1; fi
