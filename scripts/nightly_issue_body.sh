#!/usr/bin/env bash
# The body of a public nightly issue (.github/workflows/nightly.yml).
# Usage: nightly_issue_body.sh <step label> <log file> <log|counts>   (env: SHA, RUN_URL)
#   log     the last 80 lines of the log (tests, guards: nothing secret in them)
#   counts  only the counts from an audit log, never advisory names, IDs or crates; the detail
#           belongs in the private security repository (CLAUDE.md), not in a public issue.
set -euo pipefail
label=$1 log=$2 kind=$3
echo "**$label** failed in the nightly run."
echo
echo "- commit: \`${SHA:-unknown}\`"
echo "- run: ${RUN_URL:-unknown}"
case "$kind" in
  counts)
    # cargo audit: "error: 24 vulnerabilities found!" / "warning: 13 allowed warnings found"
    # npm audit:   "3 vulnerabilities (1 low, 2 high)" / "found 0 vulnerabilities"
    found=$(grep -oE '[0-9]+ (vulnerabilit(y|ies)( found)?( \([a-z0-9 ,]*\))?|allowed warnings? found)' "$log" 2>/dev/null \
            | awk '!seen[$0]++' | paste -sd ';' - | sed 's/;/; /g' || true)
    echo "- found: ${found:-no counts in the log; see the run}"
    echo
    echo "Details are kept in the private security repository, not here."
    ;;
  log)
    echo
    echo "Last 80 lines of the log:"
    echo
    echo '```'
    # shellcheck disable=SC2016  # literal backticks: a fence in the log must not end the block
    tail -n 80 "$log" 2>/dev/null | sed 's/```/` ` `/g' || echo "(no log)"
    echo '```'
    ;;
  *) echo "nightly_issue_body.sh: kind must be log or counts, not '$kind'" >&2; exit 2 ;;
esac
