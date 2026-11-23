#!/usr/bin/env bash
# Negative controls for test_console.py: for each cheat, a copy of this folder with that cheat's
# tamper line (marked "# control:<name>") replaced by "pass", then that cheat's test. Each must FAIL;
# then the tool-path control below. This script exits 0 only if all of them failed, and 1 if any passed.
#
#   TET_CLI=path/to/tet-cli bash prep/demos/agent-console/controls.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/console-controls.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
# The copies live outside the repo, so tet-cli is named explicitly (default: this repo's build).
export TET_CLI="${TET_CLI:-$repo/target/release/tet-cli}"
case "$TET_CLI" in /*) ;; *) TET_CLI="$PWD/$TET_CLI" ;; esac  # absolute: the copies run in other folders
[ -x "$TET_CLI" ] || { echo "tet-cli not found: set TET_CLI"; exit 2; }
bad=0
for case in overuse:Overuse alter:Alter swapkey:Swapkey; do
  name="${case%%:*}"; test="${case##*:}"
  # The copy keeps the repo layout so console.py still finds tools/machine-notebook.
  copy="$scratch/$name/prep/demos/agent-console"
  mkdir -p "$copy" "$scratch/$name/tools"
  cp "$here"/console.py "$here"/page.html "$here"/test_console.py "$copy"/
  cp "$here"/../tetcli_path.py "$scratch/$name/prep/demos/"
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

# The tool path, in the form CI hands it: TET_CLI relative to the folder the test starts in. A copy of
# this folder with the helper's "make absolute" line (tetcli_path.py, marked "# control:abspath")
# replaced by "return path". Untouched.test_valid_and_counts
# must then FAIL on its own assertion: a subprocess started in another folder cannot find the
# relative path.
name=abspath; test=Untouched.test_valid_and_counts
root="$scratch/$name"; copy="$root/prep/demos/agent-console"
mkdir -p "$copy" "$root/tools" "$root/bin"
cp "$here"/console.py "$here"/page.html "$here"/test_console.py "$copy"/
cp "$here"/../tetcli_path.py "$root/prep/demos/"
ln -s "$repo/tools/machine-notebook" "$root/tools/machine-notebook"
ln -s "$TET_CLI" "$root/bin/tet-cli"
n=$(grep -c "# control:abspath\$" "$root/prep/demos/tetcli_path.py")
if [ "$n" -ne 1 ]; then echo "control $name: expected 1 marked line, found $n"; bad=1
else
  python3 - "$root/prep/demos/tetcli_path.py" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
s = re.sub(r"^(\s*).*# control:abspath$", r"\1return path  # made relative by controls.sh", s, flags=re.M)
open(p, "w").write(s)
PY
  if (cd "$root" && TET_CLI=bin/tet-cli python3 "prep/demos/agent-console/test_console.py" "$test") >"$scratch/$name.out" 2>&1; then
    echo "control $name: test PASSED with the tool path left relative (vacuous)"; bad=1
  elif grep -q "^FAIL: test_" "$scratch/$name.out" && ! grep -q "^ERROR: " "$scratch/$name.out"; then
    echo "control $name: FAILS as it must: $(grep -m1 '^AssertionError' "$scratch/$name.out" | cut -c1-160)"
  else
    echo "control $name: failed, but not on the test's assertion:"; tail -5 "$scratch/$name.out"; bad=1
  fi
fi
exit $bad
