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
