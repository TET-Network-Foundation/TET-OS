#!/usr/bin/env bash
# Run every guard CI runs, in CI's order, and stop at the first red one.
#
#   bash scripts/run_guards.sh            # from the repo root; exit 0 only if every guard is green
#   bash scripts/run_guards.sh && git push
#
# The list is read from .github/workflows/ci.yml (the `python3 tools/…/test_*.py` and
# `python3 prep/demos/…/test_*.py` steps, the `node tet-agent-sdk/examples/*.mjs` and
# `node prep/demos/…/test_*.mjs` steps of the `rust` job, run from the root against
# target/release/tet-cli unless TET_CLI is set; the `node … scripts/*.mjs` steps of the `ui` job, run
# from tet-network/ui; and the committed signer's interop check), so the list follows ci.yml for the steps it takes (see
# Judged below).
# Steps that need something only CI has (a built server for lang_render_guard, `$RUNNER_TEMP`) are
# named as skipped, never silently dropped.
# Judged: each single-line step of the rust, ui and wasm jobs whose command, after `run:`, any
# spacing and an optional opening quote, is python, python3, python3.x or node followed by a space
# or tab: it must be on the list, and a step the parser does not take is named and stops the run
# (exit 2). Not judged: a multi-line `run: |` block, other interpreter names, a quote followed by a
# space, and a job whose header is not indented by exactly two spaces; such steps are not run and
# not named.
#
# Exit codes: 0 every guard run is green and every step not run is named as skipped · 1 a guard is red (it stops there: the guards after it are NOT
# run) · 2 the guards couldn't be run at all (no node_modules, no ci.yml, untracked files). Never 0 unless
# all ran green.
#
# CLAUDE.md: "A push never happens while any guard is red." A loop over branches runs this per branch
# and stops at the first non-zero exit.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CI="$ROOT/.github/workflows/ci.yml"
UI="$ROOT/tet-network/ui"
[ -f "$CI" ] || { echo "run_guards: no $CI" >&2; exit 2; }
[ -d "$UI/node_modules" ] || { echo "run_guards: $UI/node_modules is missing; run npm ci --ignore-scripts there first" >&2; exit 2; }

# Untracked files make a green run meaningless. Guards that scan the repository read `git ls-files`,
# so a file that is not committed yet is not checked at all: on 2026-11-12 four new guards each
# reported "all green" while their own file was untracked, and went red once it was committed. So a
# run with untracked (not ignored) files is not run: exit 2, naming them. Commit first, then run.
untracked=$(cd "$ROOT" && git ls-files --others --exclude-standard)
if [ -n "$untracked" ]; then
  n=$(printf '%s\n' "$untracked" | wc -l | tr -d ' ')
  list=$(printf '%s\n' "$untracked" | head -20 | tr '\n' ' ')
  [ "$n" -gt 20 ] && list="$list(and $((n - 20)) more)"
  echo "run_guards: untracked files not scanned: $list; commit or stash first" >&2
  exit 2
fi
# The Python guards must not leave __pycache__ behind, which would stop the next run.
export PYTHONDONTWRITEBYTECODE=1

# `TET_GUARDS_LIST` (tests only): a file of "dir<TAB>command" lines used instead of ci.yml.
if [ -n "${TET_GUARDS_LIST:-}" ]; then
  list=$(cat "$TET_GUARDS_LIST")
else
  # The `rust` job's guards (single-line `run: python3 tools/…/test_X.py` or `prep/demos/…/test_X.py`,
  # `node tet-agent-sdk/examples/X.mjs`, `node prep/demos/…/test_X.mjs`), from the root;
  # the `ui` job's guard steps (single-line `run: node … scripts/X.mjs …`), run from tet-network/ui;
  # then the committed-signer interop check from the root (the wasm job).
  list=$(awk '
    /^  ["\047]?[A-Za-z0-9_-]+["\047]?[[:space:]]*:[[:space:]]*(#.*)?$/ { job = $0; gsub(/[[:space:]"\047]/, "", job); sub(/:.*/, "", job) }
    job == "rust" && /^[[:space:]]+(-[[:space:]]+)?run: python3 (tools|prep\/demos)\/[A-Za-z0-9_\/-]+\/test_[A-Za-z0-9_]+\.py[[:space:]]*$/ { sub(/^[[:space:]]+(-[[:space:]]+)?run: /, ""); print ".\t" $0 }
    job == "rust" && /^[[:space:]]+(-[[:space:]]+)?run: node tet-agent-sdk\/examples\/[A-Za-z0-9_-]+\.mjs[[:space:]]*$/ { sub(/^[[:space:]]+(-[[:space:]]+)?run: /, ""); print ".\t" $0 }
    job == "rust" && /^[[:space:]]+(-[[:space:]]+)?run: node prep\/demos\/[A-Za-z0-9_\/-]+\/test_[A-Za-z0-9_]+\.mjs[[:space:]]*$/ { sub(/^[[:space:]]+(-[[:space:]]+)?run: /, ""); print ".\t" $0 }
    job == "ui" && /^[[:space:]]+(-[[:space:]]+)?run: node .*scripts\/[A-Za-z0-9_-]+\.mjs/ { sub(/^[[:space:]]+(-[[:space:]]+)?run: /, ""); print "tet-network/ui\t" $0 }
    job == "wasm" && /^[[:space:]]+(-[[:space:]]+)?run: node tet-agent-sdk\/scripts\/check_wasm_interop\.mjs/ { sub(/^[[:space:]]+(-[[:space:]]+)?run: /, ""); print ".\t" $0 }
  ' "$CI")
fi
[ -n "$list" ] || { echo "run_guards: found no guard steps in $CI" >&2; exit 2; }

# Every single-line python3 or node step of the rust, ui and wasm jobs must be on the list. A step
# the parser above does not take would otherwise be dropped without a word, and the run would say
# green on a tree CI fails. `TET_GUARDS_LIST` replaces only the list, not this check.
# A step counts wherever `run:` stands on its line (`- run:`, a quoted `"run":`, a flow map
# `- { run: … }`), with any spacing, quoted or not, for python3, python3.12, python or node, and
# under a two-space job header written with quotes, a space before its colon or a comment (a quote
# followed by a space is not judged); it is compared with
# the list as written, so a step written differently from what the parser takes is named here, not
# dropped.
steps=$(awk '
  /^  ["\047]?[A-Za-z0-9_-]+["\047]?[[:space:]]*:[[:space:]]*(#.*)?$/ { job = $0; gsub(/[[:space:]"\047]/, "", job); sub(/:.*/, "", job) }
  (job == "rust" || job == "ui" || job == "wasm") && !/^[[:space:]]*#/ && /run["\047]?[[:space:]]*:[[:space:]]*["\047]?(python[0-9.]*|node)([[:space:]]|$)/ { sub(/^[[:space:]]+(-[[:space:]]+)?run: ?/, ""); sub(/[[:space:]]+$/, ""); print }
' "$CI")
cmds=$(printf '%s\n' "$list" | cut -f2- | sed 's/[[:space:]]*$//')
notrun=$(printf '%s\n' "$steps" | while IFS= read -r step; do
  [ -n "$step" ] || continue
  grep -qxF -- "$step" <<<"$cmds" || echo "$step"
done)
if [ -n "$notrun" ]; then
  echo "run_guards: ci.yml steps this runner would not run (fix its parser):" >&2
  printf '%s\n' "$notrun" | sed 's/^/  /' >&2
  exit 2
fi

ran=0 skipped=0
out=$(mktemp); trap 'rm -f "$out"' EXIT
while IFS=$'\t' read -r dir cmd; do
  [ -n "$cmd" ] || continue
  # shellcheck disable=SC2016  # matches the literal text $RUNNER_TEMP, not its value
  case "$cmd" in
    *'$RUNNER_TEMP'*|*scripts/lang_render_guard.mjs*) echo "skip $cmd  (needs CI's build or temp dir)"; skipped=$((skipped + 1)); continue ;;
  esac
  if (cd "$ROOT/$dir" && eval "$cmd") > "$out" 2>&1 < /dev/null; then
    ran=$((ran + 1))
    echo "ok   $cmd"
  else
    rc=$?
    echo "RED  $cmd  (exit $rc)"
    grep -E "^(FAIL|FAILED|Error|error)" "$out" | head -8 | sed 's/^/     /'
    tail -5 "$out" | sed 's/^/     | /'
    echo "run_guards: STOPPED at the first red guard ($ran green before it). Nothing after it was run. Do not push."
    exit 1
  fi
done <<< "$list"
if [ "$skipped" -gt 0 ]; then echo "run_guards: all $ran guards green ($skipped skipped: they need CI)"; else echo "run_guards: all $ran guards green"; fi
exit 0
