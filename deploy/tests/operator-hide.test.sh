#!/usr/bin/env bash
# Tests for deploy/operator-hide.sh that need no Docker: its JSON escaping always yields valid JSON,
# and it refuses a hide without a reason (or with a bad kind) before touching the container.
#     bash deploy/tests/operator-hide.test.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
failed=0
pass()  { echo "ok   $1"; }
flunk() { echo "FAIL $1${2:+ — $2}"; failed=$((failed + 1)); }

eval "$(awk '/^json_str\(\) \{/,/^\}/' deploy/operator-hide.sh)"
for s in 'plain' 'quote " inside' 'back\slash' $'new\nline' $'tab\there' $'both \" and \\'; do
  if printf '{"r":%s}' "$(json_str "$s")" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
    pass "json_str: valid JSON for $(printf %q "$s")"
  else flunk "json_str: valid JSON for $(printf %q "$s")" "$(json_str "$s")"; fi
done

# docker is stubbed: if the script reached it, the stub records the call.
stub=$(mktemp -d)
printf '#!/bin/sh\necho called >> "%s/calls"\n' "$stub" > "$stub/docker"; chmod +x "$stub/docker"
refuses() {  # NAME ARGS...
  local name="$1"; shift
  if ! PATH="$stub:$PATH" bash deploy/operator-hide.sh "$@" >/dev/null 2>&1 && [ ! -e "$stub/calls" ]; then pass "refuses: $name"
  else flunk "refuses: $name" "it ran or called docker"; fi
  rm -f "$stub/calls"
}
refuses "a hide without a reason" hide msg abc ""
refuses "a hide with a blank reason" hide msg abc "   "
refuses "an unknown kind" hide board abc "spam"
refuses "a missing id" hide msg
if PATH="$stub:$PATH" bash deploy/operator-hide.sh hide msg abc "spam" >/dev/null 2>&1 && [ -e "$stub/calls" ]; then
  pass "control: a valid hide does reach docker"
else flunk "control: a valid hide does reach docker"; fi
rm -rf "${stub:?}"

echo
if [ "$failed" -eq 0 ]; then echo "all passed"; exit 0; else echo "$failed FAILED"; exit 1; fi
