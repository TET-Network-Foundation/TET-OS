#!/usr/bin/env bash
# Negative controls for test_scene.py. Each control copies the files the scene runs (notebook.py, the
# two-party sketch, tetcli_path.py, this folder) into a scratch tree with the repo's layout, breaks ONE
# check there by replacing one exact line, and runs the one test named for that check. Each must FAIL
# by its own assertion: the output must hold "FAIL: <that test>" and no "ERROR:" line. An error (a crash,
# a failure in setUpClass) or any other non-zero exit is not a failed control.
# Exit 0 only if every control made its test fail that way and every replaced line was found once;
# 1 otherwise; 2 if tet-cli is missing.
#
#   TET_CLI=path/to/tet-cli bash prep/demos/home-permit/controls.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/home-permit-controls.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
export TET_CLI="${TET_CLI:-$repo/target/release/tet-cli}"
case "$TET_CLI" in /*) ;; *) TET_CLI="$PWD/$TET_CLI" ;; esac
[ -x "$TET_CLI" ] || { echo "tet-cli not found: set TET_CLI"; exit 2; }

# name | file (repo-relative) | exact line to replace | replacement | test
controls=(
  'permit-reuse|tools/machine-notebook/notebook.py|            raise Fail(f"not recorded: {why}")|            pass|Scene.test_second_request_with_the_same_permit_is_refused_by_h_for_reuse'
  'signature|prep/demos/two-party-v0/twoparty.py|    rc, out = nb.verify_bytes(cli(), chain_env, env_bytes, record, "record")|    rc, out = 0, ""|Scene.test_tamper_summary_resigned_by_n_is_refused_on_h_signature'
  'log-end|prep/demos/two-party-v0/twoparty.py|        return [LogConflict(f"{p}: log ends at record {max(bodies)}, before record {seq}")]|        return []|Scene.test_dropped_record_at_h_is_a_log_conflict_at_h_not_a_bad_signature'
  'banner|prep/demos/home-permit/page.html|<p id="banner" role="status">simulation: no robot moved</p>|<p id="banner" role="status"></p>|Page.test_banner_is_on_screen_outside_every_step'
  'permit-label|prep/demos/home-permit/scene.py|                  list(shown) + [cited_line(cited)], permit=self.used)|                  list(shown) + [cited_line(cited)])|Scene.test_every_step_shows_the_permit_and_after_the_second_request_it_reads_used'
  'again-text|prep/demos/home-permit/scene.py|                  "Then H'"'"'s notebook refuses to write it: the permit was already used. "|                  "H'"'"'s notebook refuses. "|Scene.test_again_step_says_both_signed_then_h_refused_the_write_and_both_aborted'
  'test-keys|prep/demos/home-permit/page.html|    <p id="test-keys">The keys are test keys, made and kept in software, in this simulation. No real device holds them.</p>|    <p id="test-keys">The keys are real.</p>|Page.test_page_says_the_keys_are_test_keys_in_software_in_a_simulation'
  'wording|prep/demos/home-permit/page.html|  <h1>Home permit: one one-time permit, two machines <span class="ja">家の手伝いロボットと訪問看護の端末</span></h1>|  <h1>Home permit: the nurse signed</h1>|Page.test_page_and_readme_keep_the_wording_rules'
)

bad=0
n=0
for c in "${controls[@]}"; do
  IFS='|' read -r name file old new test <<<"$c"
  tree="$scratch/$name"
  mkdir -p "$tree/tools" "$tree/prep/demos"
  cp -R "$repo/tools/machine-notebook" "$tree/tools/"
  cp "$repo/prep/demos/tetcli_path.py" "$tree/prep/demos/"
  cp -R "$repo/prep/demos/two-party-v0" "$repo/prep/demos/home-permit" "$tree/prep/demos/"
  mkdir -p "$tree/prep/demos/robot-sim/px4/vendor/three"
  cp "$repo/prep/demos/robot-sim/px4/vendor/three/three.module.js" "$tree/prep/demos/robot-sim/px4/vendor/three/"
  python3 - "$tree/$file" "$old" "$new" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(p, encoding="utf-8").read().split("\n")
n = lines.count(old)
if n != 1:
    sys.exit(f"expected the line once, found it {n} times")
lines[lines.index(old)] = new
open(p, "w", encoding="utf-8").write("\n".join(lines))
PY
  if [ $? -ne 0 ]; then echo "control $name: line not found once in $file"; bad=1; continue; fi
  python3 "$tree/prep/demos/home-permit/test_scene.py" "$test" >"$tree/out.log" 2>&1
  rc=$?
  fail_line="$(grep -E "^FAIL: ${test##*.} " "$tree/out.log" | head -1)"
  if [ $rc -eq 0 ]; then
    echo "control $name: $test PASSED with the check broken"; bad=1
  elif grep -qE '^ERROR:' "$tree/out.log" || [ -z "$fail_line" ]; then
    echo "control $name: $test did not fail by its assertion (exit $rc; $(grep -E '^(ERROR|FAIL):' "$tree/out.log" | head -1 | cut -c1-80))"
    bad=1
  else
    echo "control $name: fails by its assertion, as it must: $fail_line"
    n=$((n + 1))
  fi
done
echo "controls failed by their assertion: $n of ${#controls[@]}"
exit $bad
