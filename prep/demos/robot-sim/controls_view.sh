#!/usr/bin/env bash
# Negative controls for the 3D view's tests. Each control changes ONE marked line of a copy of
# view3d.js and runs the tests named for it, which must then FAIL on their own assertion. Exits 0
# only if every control failed that way.
#
#   log-from-records  the log view reads the simulation's live value for each record instead of the
#                     record the checker read. test_view3d.mjs (synthetic /state) and
#                     test_robotsim.py View (a real log, signed and checked with tet-cli) must fail.
#   no-webgl          the renderer claims WebGL even when there is none; the 2D fallback test must fail.
#   field-names       a field name with digits (od600) is not read; the plate reader's view test must fail.
#
#   TET_CLI=path/to/tet-cli bash prep/demos/robot-sim/controls_view.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/view3d-controls.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
export TET_CLI="${TET_CLI:-$repo/target/release/tet-cli}"
case "$TET_CLI" in /*) ;; *) TET_CLI="$PWD/$TET_CLI" ;; esac  # absolute: the copies run in other folders
[ -x "$TET_CLI" ] || { echo "tet-cli not found: set TET_CLI"; exit 2; }
command -v node >/dev/null || { echo "node not found"; exit 2; }
bad=0

mutate() { # name replacement-line -> writes $scratch/<name>.js
  local name="$1" line="$2" out="$scratch/$1.js"
  local n; n=$(grep -c "// control:$name\$" "$here/view3d.js")
  if [ "$n" -ne 1 ]; then echo "control $name: expected 1 marked line, found $n"; return 1; fi
  python3 - "$here/view3d.js" "$out" "$name" "$line" <<'PY'
import re, sys
src, out, name, line = sys.argv[1:5]
s = open(src).read()
s, n = re.subn(r"^(\s*).*// control:" + re.escape(name) + r"$", lambda m: m.group(1) + line, s, flags=re.M)
assert n == 1
open(out, "w").write(s)
PY
}

expect_fail() { # label log command...
  local label="$1" log="$2"; shift 2
  if "$@" >"$log" 2>&1; then echo "control $label: PASSED with the line changed (vacuous)"; bad=1; return; fi
  if grep -qE "^not ok|^FAIL: test_" "$log" && ! grep -qE "^ERROR: |SyntaxError|ReferenceError" "$log"; then
    echo "control $label: FAILS as it must: $(grep -m1 -E '^not ok|^FAIL: ' "$log" | cut -c1-150)"
  else
    echo "control $label: failed, but not on a test assertion:"; tail -8 "$log"; bad=1
  fi
}

# 1. the log view reads live telemetry
if mutate log-from-records 'const p = parseValue((((S.live || []).find((t) => t.seq === r.file)) || {}).value);'; then
  expect_fail "log-from-records (node)" "$scratch/1a.out" env VIEW3D_JS="$scratch/log-from-records.js" node --test-reporter=tap "$here/test_view3d.mjs"
  expect_fail "log-from-records (real log)" "$scratch/1b.out" env VIEW3D_JS="$scratch/log-from-records.js" python3 "$here/test_robotsim.py" View.test_the_view_draws_the_records_the_checker_read
else bad=1; fi

# 2. no 2D fallback
if mutate no-webgl 'return { kind: "3d", gl };'; then
  expect_fail "no-webgl" "$scratch/2.out" env VIEW3D_JS="$scratch/no-webgl.js" node --test-reporter=tap "$here/test_view3d.mjs"
else bad=1; fi

# 3. field names without digits: "od600" is not read, so the plate reader's strip and markers lose it
if mutate field-names 'for (const m of v.matchAll(/([a-z_]+)=(-?[0-9]+(?:\.[0-9]+)?)/gi)) out[m[1].toLowerCase()] = Number(m[2]);'; then
  expect_fail "field-names" "$scratch/3.out" env VIEW3D_JS="$scratch/field-names.js" node --test-reporter=tap "$here/test_view3d.mjs"
else bad=1; fi

[ "$bad" -eq 0 ] && echo "all view controls fail as they must" || echo "SOME VIEW CONTROL DID NOT FAIL"
exit "$bad"
