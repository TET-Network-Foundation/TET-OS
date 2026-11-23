#!/usr/bin/env bash
# Negative controls for the code-scan rule of test_demo_files.py. Each control commits ONE change to a
# throwaway local clone of HEAD (objects shared, nothing checked out, nothing fetched) and runs
#   Repository.test_every_path_the_code_scan_leaves_out_is_a_pinned_vendored_folder
# there, which must then FAIL on its own assertion, naming the change. The unchanged clone must pass
# first, so a failure is the change's and not the harness's. Exits 0 only if every control failed
# that way.
#
#   unpinned-folder  a second paths-ignore entry names a demo folder with no SHA256SUMS
#   unlisted-file    a file the SHA256SUMS does not list is added to the pinned folder
#   widened          the entry is widened from the pinned folder to prep/demos
#   init-input       an init input other than languages, build-mode and config (source-root) is added
#
#   bash prep/demos/guards/controls_demo_files.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/demo-files-controls.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
test_name="Repository.test_every_path_the_code_scan_leaves_out_is_a_pinned_vendored_folder"
pinned="prep/demos/robot-sim/px4/vendor/three"
codeql=".github/workflows/codeql.yml"
bad=0

git clone -q --shared --no-checkout "$repo" "$scratch/c" || { echo "local clone failed"; exit 2; }
c="$scratch/c"
base="$(git -C "$c" rev-parse HEAD)"

g() { git -C "$c" -c user.name=control -c user.email=control@invalid "$@"; }

# commit_with <path> <file holding the new bytes> ...: one commit on base, HEAD detached at it
commit_with() {
  local idx="$scratch/index" tree commit
  rm -f "$idx"
  GIT_INDEX_FILE="$idx" g read-tree "$base" || return 1
  while [ $# -gt 0 ]; do
    local blob; blob="$(g hash-object -w "$2")" || return 1
    GIT_INDEX_FILE="$idx" g update-index --add --cacheinfo "100644,$blob,$1" || return 1
    shift 2
  done
  tree="$(GIT_INDEX_FILE="$idx" g write-tree)" || return 1
  commit="$(g commit-tree "$tree" -p "$base" -m control)" || return 1
  g update-ref --no-deref HEAD "$commit"
}

# edit_codeql <old line> <new lines>: writes $scratch/codeql.yml; the old line must occur once
edit_codeql() {
  g show "$base:$codeql" >"$scratch/codeql.orig" || return 1
  python3 - "$scratch/codeql.orig" "$scratch/codeql.yml" "$1" "$2" <<'PY'
import sys
src, out, old, new = sys.argv[1:5]
s = open(src).read()
n = s.count(old + "\n")
if n != 1:
    sys.exit(f"expected the line once, found it {n} times: {old!r}")
open(out, "w").write(s.replace(old + "\n", new + "\n"))
PY
}

run_guard() { DEMO_FILES_ROOT="$c" python3 "$here/test_demo_files.py" "$test_name" >"$1" 2>&1; }

expect_fail() { # label log expected-text
  local label="$1" log="$2" want="$3"
  if run_guard "$log"; then echo "control $label: PASSED with the change (vacuous)"; bad=1; return; fi
  if grep -q "^FAIL: test_every_path_the_code_scan_leaves_out_is_a_pinned_vendored_folder" "$log" \
      && ! grep -q "^ERROR: " "$log" && grep -qF "$want" "$log"; then
    echo "control $label: FAILS as it must: $want"
  else
    echo "control $label: failed, but not on the assertion naming the change:"; tail -12 "$log"; bad=1
  fi
}

# 0. the unchanged commit passes here, so each failure below is its change's
if run_guard "$scratch/0.out"; then echo "baseline: the unchanged commit passes"
else echo "baseline: the unchanged commit FAILS; the controls mean nothing:"; tail -12 "$scratch/0.out"; exit 2; fi

entry="              - $pinned"

# 1. a second entry naming an unpinned demo folder
if edit_codeql "$entry" "$entry
              - prep/demos/agent-console" && commit_with "$codeql" "$scratch/codeql.yml"; then
  expect_fail unpinned-folder "$scratch/1.out" "prep/demos/agent-console: left out of the code scan but holds no SHA256SUMS"
else echo "control unpinned-folder: could not be made"; bad=1; fi

# 2. an unlisted file added to the pinned folder
printf 'export const x = Math.random();\n' >"$scratch/extra.js"
if commit_with "$pinned/extra.js" "$scratch/extra.js"; then
  expect_fail unlisted-file "$scratch/2.out" "$pinned/extra.js: left out of the code scan but not pinned in $pinned/SHA256SUMS"
else echo "control unlisted-file: could not be made"; bad=1; fi

# 3. the entry widened to prep/demos
if edit_codeql "$entry" "              - prep/demos" && commit_with "$codeql" "$scratch/codeql.yml"; then
  expect_fail widened "$scratch/3.out" "prep/demos: a code-scan path must be a folder under prep/demos"
else echo "control widened: could not be made"; bad=1; fi

# 4. an init input other than languages, build-mode and config
if edit_codeql "          build-mode: none" "          build-mode: none
          source-root: $pinned" && commit_with "$codeql" "$scratch/codeql.yml"; then
  expect_fail init-input "$scratch/4.out" "the code scan's init sets 'source-root'; only languages, build-mode and config are allowed"
else echo "control init-input: could not be made"; bad=1; fi

[ "$bad" -eq 0 ] && echo "all 4 controls fail as they must"
exit "$bad"
