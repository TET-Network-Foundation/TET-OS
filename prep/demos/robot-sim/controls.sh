#!/usr/bin/env bash
# Negative controls for test_robotsim.py: for each button, a copy of this folder with that button's
# tamper line (marked "# control:<name>") replaced by "pass", then that button's test. Each must FAIL;
# this script exits 0 only if every one failed, and 1 if any passed with its tamper step removed.
# The last case ("meta") removes the line that puts the run's details into the served page.
# After the loop, the tool-path control ("abspath") leaves TET_CLI relative, as CI hands it.
#
#   TET_CLI=path/to/tet-cli bash prep/demos/robot-sim/controls.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/robotsim-controls.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
# The copies live outside the repo, so tet-cli is named explicitly (default: this repo's build).
export TET_CLI="${TET_CLI:-$repo/target/release/tet-cli}"
case "$TET_CLI" in /*) ;; *) TET_CLI="$PWD/$TET_CLI" ;; esac  # absolute: the copies run in other folders
[ -x "$TET_CLI" ] || { echo "tet-cli not found: set TET_CLI"; exit 2; }
bad=0
for case in alter:Alter replay:Replay reorder:Reorder alter_alt:DroneAlterAlt take_out:DroneTakeOut swap_exit:DroneSwapExit other_key:DroneOtherKey lower_peak:ColdLowerPeak take_peak:ColdTakePeak hide_door:ColdHideDoor drop_outlier:LabDropOutlier smooth_read:LabSmoothRead meta:View.test_the_served_page_names_its_run_seed_versions_and_commit; do
  name="${case%%:*}"; test="${case##*:}"
  # The copy keeps the repo layout so robotsim.py still finds tools/machine-notebook.
  copy="$scratch/$name/prep/demos/robot-sim"
  mkdir -p "$copy" "$scratch/$name/tools"
  cp "$here"/robotsim.py "$here"/page.html "$here"/view3d.js "$here"/test_view3d.mjs "$here"/test_robotsim.py "$copy"/
  cp "$here"/../tetcli_path.py "$scratch/$name/prep/demos/"
  ln -s "$repo/tools/machine-notebook" "$scratch/$name/tools/machine-notebook"
  n=$(grep -c "# control:$name\$" "$copy/robotsim.py")
  if [ "$n" -ne 1 ]; then echo "control $name: expected 1 marked line, found $n"; bad=1; continue; fi
  python3 - "$copy/robotsim.py" "$name" <<'PY'
import re, sys
p, name = sys.argv[1], sys.argv[2]
s = open(p).read()
s = re.sub(r"^(\s*).*# control:" + name + r"$", r"\1pass  # removed by controls.sh", s, flags=re.M)
open(p, "w").write(s)
PY
  if python3 "$copy/test_robotsim.py" "$test" >"$scratch/$name.out" 2>&1; then
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
# replaced by "return path". View.test_the_served_page_names_its_run_seed_versions_and_commit
# must then FAIL on its own assertion: a subprocess started in another folder cannot find the
# relative path.
name=abspath; test=View.test_the_served_page_names_its_run_seed_versions_and_commit
root="$scratch/$name"; copy="$root/prep/demos/robot-sim"
mkdir -p "$copy" "$root/tools" "$root/bin"
cp "$here"/robotsim.py "$here"/page.html "$here"/view3d.js "$here"/test_view3d.mjs "$here"/test_robotsim.py "$copy"/
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
  if (cd "$root" && TET_CLI=bin/tet-cli python3 "prep/demos/robot-sim/test_robotsim.py" "$test") >"$scratch/$name.out" 2>&1; then
    echo "control $name: test PASSED with the tool path left relative (vacuous)"; bad=1
  elif grep -q "^FAIL: test_" "$scratch/$name.out" && ! grep -q "^ERROR: " "$scratch/$name.out"; then
    echo "control $name: FAILS as it must: $(grep -m1 '^AssertionError' "$scratch/$name.out" | cut -c1-160)"
  else
    echo "control $name: failed, but not on the test's assertion:"; tail -5 "$scratch/$name.out"; bad=1
  fi
fi
exit $bad
