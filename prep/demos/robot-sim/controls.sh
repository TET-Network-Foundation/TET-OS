#!/usr/bin/env bash
# Negative controls for test_robotsim.py: for each button, a copy of this folder with that button's
# tamper line (marked "# control:<name>") replaced by "pass", then that button's test. Each must FAIL;
# this script exits 0 only if every one failed, and 1 if any passed with its tamper step removed.
# The last case ("meta") removes the line that puts the run's details into the served page.
#
#   TET_CLI=path/to/tet-cli bash prep/demos/robot-sim/controls.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/robotsim-controls.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
# The copies live outside the repo, so tet-cli is named explicitly (default: this repo's build).
export TET_CLI="${TET_CLI:-$repo/target/release/tet-cli}"
[ -x "$TET_CLI" ] || { echo "tet-cli not found: set TET_CLI"; exit 2; }
bad=0
for case in alter:Alter replay:Replay reorder:Reorder alter_alt:DroneAlterAlt take_out:DroneTakeOut swap_exit:DroneSwapExit other_key:DroneOtherKey lower_peak:ColdLowerPeak take_peak:ColdTakePeak hide_door:ColdHideDoor drop_outlier:LabDropOutlier smooth_read:LabSmoothRead meta:View.test_the_served_page_names_its_run_seed_versions_and_commit; do
  name="${case%%:*}"; test="${case##*:}"
  # The copy keeps the repo layout so robotsim.py still finds tools/machine-notebook.
  copy="$scratch/$name/prep/demos/robot-sim"
  mkdir -p "$copy" "$scratch/$name/tools"
  cp "$here"/robotsim.py "$here"/page.html "$here"/view3d.js "$here"/test_view3d.mjs "$here"/test_robotsim.py "$copy"/
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
exit $bad
