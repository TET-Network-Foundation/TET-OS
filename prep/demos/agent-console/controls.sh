#!/usr/bin/env bash
# Negative controls for test_console.py: for each cheat, a copy of this folder with that cheat's
# tamper line (marked "# control:<name>") replaced by "pass", then that cheat's test. Each must FAIL;
# this script exits 0 only if all three failed, and 1 if any passed with its tamper step removed.
#
#   TET_CLI=path/to/tet-cli bash prep/demos/agent-console/controls.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/console-controls.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
# The copies live outside the repo, so tet-cli is named explicitly (default: this repo's build).
export TET_CLI="${TET_CLI:-$repo/target/release/tet-cli}"
[ -x "$TET_CLI" ] || { echo "tet-cli not found: set TET_CLI"; exit 2; }
bad=0
for case in overuse:Overuse alter:Alter swapkey:Swapkey; do
  name="${case%%:*}"; test="${case##*:}"
  # The copy keeps the repo layout so console.py still finds tools/machine-notebook.
  copy="$scratch/$name/prep/demos/agent-console"
  mkdir -p "$copy" "$scratch/$name/tools"
  cp "$here"/console.py "$here"/page.html "$here"/test_console.py "$copy"/
  ln -s "$repo/tools/machine-notebook" "$scratch/$name/tools/machine-notebook"
  n=$(grep -c "# control:$name\$" "$copy/console.py")
  if [ "$n" -ne 1 ]; then echo "control $name: expected 1 marked line, found $n"; bad=1; continue; fi
  python3 - "$copy/console.py" "$name" <<'PY'
import re, sys
p, name = sys.argv[1], sys.argv[2]
s = open(p).read()
s = re.sub(r"^(\s*).*# control:" + name + r"$", r"\1pass  # removed by controls.sh", s, flags=re.M)
open(p, "w").write(s)
PY
  if python3 "$copy/test_console.py" "$test" >"$scratch/$name.out" 2>&1; then
    echo "control $name: test PASSED with the tamper step removed (vacuous)"; bad=1
  elif grep -q "^FAIL: test_" "$scratch/$name.out" && ! grep -q "^ERROR: " "$scratch/$name.out"; then
    # A failure for another reason (setup, a missing tool) would prove nothing: only an assertion
    # failure inside the named test counts.
    echo "control $name: FAILS as it must: $(grep -m1 '^AssertionError' "$scratch/$name.out" | cut -c1-160)"
  else
    echo "control $name: failed, but not on the test's assertion:"; tail -5 "$scratch/$name.out"; bad=1
  fi
done
exit $bad
