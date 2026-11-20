#!/usr/bin/env bash
# Cross-language guard for agent identity: the SDK signs, `tet-cli` verifies, and `tet-cli` signing
# reproduces the SDK's envelope byte for byte.
#
# A CLI is a surface no cargo test exercises. `verify` returning 0 on a bad signature is the kind of
# defect that unit tests cannot see and that a verification tool must never have, so the exit codes
# are asserted in both directions — a `verify` that cannot fail is worse than no verify at all.
#
# Usage: tet-cli/scripts/agent_cli_interop.sh [path-to-tet-cli]
set -euo pipefail

CLI="${1:-target/debug/tet-cli}"
FIXTURE="tet-core/src/testdata/agent_payload_envelopes.json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -x "$CLI" ] || { echo "no tet-cli at $CLI — cargo build -p tet-cli first" >&2; exit 2; }
[ -s "$FIXTURE" ] || { echo "missing $FIXTURE" >&2; exit 2; }

CHAIN_ID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["chain"]["chain_id"])' "$FIXTURE")
GENESIS=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["chain"]["genesis_hash"])' "$FIXTURE")
COUNT=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["cases"]))' "$FIXTURE")
[ "$COUNT" -gt 0 ] || { echo "fixture has no cases — an empty loop passes vacuously" >&2; exit 1; }

export TET_CHAIN_ID="$CHAIN_ID"
export TET_GENESIS_HASH="$GENESIS"
echo "chain: $CHAIN_ID   cases: $COUNT"

checked=0
for i in $(seq 0 $((COUNT - 1))); do
  python3 - "$FIXTURE" "$i" "$WORK" <<'PY'
import base64, json, sys
fixture, i, work = sys.argv[1], int(sys.argv[2]), sys.argv[3]
d = json.load(open(fixture, encoding="utf-8"))
c = d["cases"][i]
open(f"{work}/payload.bin", "wb").write(base64.b64decode(c["payload_b64"]))
open(f"{work}/sdk.sig.json", "w", encoding="utf-8").write(json.dumps(c["envelope"], indent=2) + "\n")
open(f"{work}/meta", "w", encoding="utf-8").write(c["payload_type"] + "\n" + c["mnemonic"] + "\n")
PY
  PAYLOAD_TYPE=$(sed -n 1p "$WORK/meta")
  MNEMONIC=$(sed -n 2p "$WORK/meta")

  # 1. the CLI verifies what the SDK signed, including that the file on disk is those bytes
  "$CLI" agent verify --sig "$WORK/sdk.sig.json" --payload "$WORK/payload.bin" >/dev/null

  # 2. the CLI's own envelope is byte-identical to the SDK's
  TET_MNEMONIC="$MNEMONIC" "$CLI" agent sign \
    --in "$WORK/payload.bin" --payload-type "$PAYLOAD_TYPE" --out "$WORK/cli.sig.json" >/dev/null
  if ! cmp -s "$WORK/cli.sig.json" "$WORK/sdk.sig.json"; then
    echo "case $i: tet-cli produced a different envelope than tet-agent-sdk" >&2
    diff "$WORK/sdk.sig.json" "$WORK/cli.sig.json" >&2 || true
    exit 1
  fi

  # 3. verify must FAIL on the wrong chain …
  if TET_CHAIN_ID="tet-not-the-signing-chain" \
     "$CLI" agent verify --sig "$WORK/sdk.sig.json" >/dev/null 2>&1; then
    echo "case $i: verify returned 0 for an envelope from another chain" >&2
    exit 1
  fi

  # … and when the file on disk is not what was signed. One appended byte, so the payload length is
  # also wrong — a guard that only flipped a byte would still pass if the length were the only check.
  cp "$WORK/payload.bin" "$WORK/tampered.bin"
  printf 'X' >> "$WORK/tampered.bin"
  if "$CLI" agent verify --sig "$WORK/sdk.sig.json" --payload "$WORK/tampered.bin" >/dev/null 2>&1; then
    echo "case $i: verify returned 0 for a payload that is not what was signed" >&2
    exit 1
  fi

  checked=$((checked + 1))
done

[ "$checked" -eq "$COUNT" ] || { echo "checked $checked of $COUNT cases" >&2; exit 1; }
echo "ok: $checked cases signed, verified and byte-compared across tet-agent-sdk and tet-cli"

# A record cut down to one signature half must be refused, for a reason that is about the half that
# was cut. tet-core/src/testdata/agent_halves_v1.json is one record signed by this same `agent
# sign`, and that record with exactly one half removed, emptied or relabelled
# (tet-cli/scripts/make_halves_fixture.py). The base must verify first, or every refusal below could
# be for something else. Each case breaks ONE half, so a verify that stopped checking either half
# fails here on that half's cases.
HALVES="tet-core/src/testdata/agent_halves_v1.json"
[ -s "$HALVES" ] || { echo "missing $HALVES" >&2; exit 1; }
TET_CHAIN_ID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["chain"]["chain_id"])' "$HALVES")
TET_GENESIS_HASH=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["chain"]["genesis_hash"])' "$HALVES")
export TET_CHAIN_ID TET_GENESIS_HASH
python3 - "$HALVES" "$WORK" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
json.dump(d["base"], open(f"{sys.argv[2]}/halves_base.sig.json", "w"))
for c in d["cases"]:
    json.dump(c["envelope"], open(f"{sys.argv[2]}/halves_{c['name']}.sig.json", "w"))
open(f"{sys.argv[2]}/halves_names", "w").write("\n".join(c["name"] for c in d["cases"]) + "\n")
PY
out=$("$CLI" agent verify --sig "$WORK/halves_base.sig.json" 2>&1) || {
  echo "halves: the uncut record does not verify, so no refusal below would mean anything" >&2
  echo "$out" >&2
  exit 1
}

# The reason each case must be refused for, as `agent verify` prints it after "FAIL       : ".
halves_reason() {
  case "$1" in
    ed25519_only|mldsa44_only) echo "expected exactly 2 signatures (ed25519 + ml-dsa-44), got 1" ;;
    ed25519_sig_empty) echo "ed25519 signature verification failed:" ;;
    mldsa44_sig_empty) echo "ml-dsa-44 signature verification failed: mldsa signature must be 2420 bytes for this level (got 0)" ;;
    ed25519_label_changed) echo "missing or duplicated ed25519 signature" ;;
    mldsa44_label_changed) echo "missing or duplicated ml-dsa-44 signature" ;;
    *) echo "UNKNOWN CASE" ;;
  esac
}

halves=0
while read -r name; do
  [ -n "$name" ] || continue
  want=$(halves_reason "$name")
  [ "$want" != "UNKNOWN CASE" ] || { echo "halves: no pinned reason for case $name" >&2; exit 1; }
  if out=$("$CLI" agent verify --sig "$WORK/halves_$name.sig.json" 2>&1); then
    echo "halves: verify returned 0 for $name" >&2
    exit 1
  fi
  line=$(printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep '^FAIL' || true)
  case "$line" in
    "FAIL       : $want"*) ;;
    *) echo "halves: $name was refused, but not for its own reason" >&2
       echo "  want: FAIL       : $want" >&2
       echo "  got:  ${line:-<no FAIL line>}" >&2
       exit 1 ;;
  esac
  halves=$((halves + 1))
done < "$WORK/halves_names"
[ "$halves" -eq 6 ] || { echo "halves: checked $halves cases, expected 6" >&2; exit 1; }
echo "ok: the uncut record verifies and all $halves one-half cuts are refused for their own reason"
