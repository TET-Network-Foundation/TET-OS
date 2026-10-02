#!/usr/bin/env bash
# End to end: a real node serves GET /chain, the SDK signs using ONLY what it discovered there, and
# tet-core's verifier accepts it.
#
# The point is that the SDK cannot derive a genesis hash — tet-core computes it from treasury
# configuration — so before this route existed an agent had to be configured with a value it could not
# check. The signing step runs with TET_CHAIN_ID and TET_GENESIS_HASH UNSET and refuses to start if
# either is present, so "it worked" cannot mean "it was told".
#
# Usage: tet-cli/scripts/agent_chain_discovery.sh [tet-core-bin] [tet-cli-bin]
set -euo pipefail

CORE="${1:-target/debug/TET-Core}"
CLI="${2:-target/debug/tet-cli}"
WORK="$(mktemp -d)"
NODE_PID=""
cleanup() {
  # Wait for the node to exit before deleting its directory: killed but still flushing, it can
  # recreate files under $WORK while rm runs ("Directory not empty", PR #9's first CI run).
  if [ -n "$NODE_PID" ]; then kill "$NODE_PID" 2>/dev/null || true; wait "$NODE_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

[ -x "$CORE" ] || { echo "no TET-Core at $CORE" >&2; exit 2; }
[ -x "$CLI" ] || { echo "no tet-cli at $CLI" >&2; exit 2; }
[ -d tet-agent-sdk/dist ] || { echo "build the SDK first: (cd tet-agent-sdk && npm ci && npm run build)" >&2; exit 2; }

CHAIN_ID="tet-discovery-probe-1"
TREASURY="fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"
TREASURY_B="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

start_node() {
  local port="$1" treasury="$2" dbdir="$3"
  # TET_GENESIS_HASH is deliberately NOT set: the node must DERIVE it, so that what the SDK discovers
  # is a real derived value rather than an echo of configuration.
  env -u TET_GENESIS_HASH \
    TET_REST_BIND="127.0.0.1:${port}" \
    PORT="$port" \
    TET_DB_DIR="$dbdir" \
    TET_DB_ENCRYPT=false \
    TET_REQUIRE_ATTESTATION=false \
    TET_ENABLE_P2P=false \
    TET_AUTO_MINE=0 \
    RISC0_SKIP_BUILD=1 \
    TET_CHAIN_ID="$CHAIN_ID" \
    TET_TREASURY_ADDRESS="$treasury" \
    TET_FOUNDER_CLIFF_MS=0 \
    TET_ADMIN_API_KEY=probe-admin-key \
    "$CORE" >"$dbdir/node.log" 2>&1 &
  NODE_PID=$!
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$NODE_PID" 2>/dev/null; then
      echo "node exited during startup; last lines:" >&2
      tail -5 "$dbdir/node.log" >&2
      return 1
    fi
    sleep 0.5
  done
  echo "node did not answer /status in 60s" >&2
  tail -5 "$dbdir/node.log" >&2
  return 1
}

stop_node() {
  if [ -n "$NODE_PID" ]; then kill "$NODE_PID" 2>/dev/null || true; fi
  wait "$NODE_PID" 2>/dev/null || true
  NODE_PID=""
}

PORT=$((21000 + RANDOM % 2000))
mkdir -p "$WORK/db-a"
start_node "$PORT" "$TREASURY" "$WORK/db-a"
BASE="http://127.0.0.1:${PORT}"

# 1. the route answers with both fields, and the hash is a real 64-hex digest
CHAIN_JSON=$(curl -sf "$BASE/chain")
echo "GET /chain -> $CHAIN_JSON"
SERVED_ID=$(printf '%s' "$CHAIN_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["chain_id"])')
SERVED_HASH=$(printf '%s' "$CHAIN_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["genesis_hash"])')
[ "$SERVED_ID" = "$CHAIN_ID" ] || { echo "chain_id is $SERVED_ID, expected $CHAIN_ID" >&2; exit 1; }
# `0x` + 64 hex is what tet-core derives; the prefix is part of the signed string, not decoration.
printf '%s' "$SERVED_HASH" | grep -Eq '^0x[0-9a-f]{64}$' || { echo "genesis_hash is not 0x+64hex: $SERVED_HASH" >&2; exit 1; }
[ "$SERVED_HASH" != "0x$(printf '0%.0s' $(seq 1 64))" ] || { echo "genesis_hash is all zeroes" >&2; exit 1; }

# 2. the SDK discovers the binding and signs with it, with both env vars unset
env -u TET_CHAIN_ID -u TET_GENESIS_HASH \
  node tet-agent-sdk/scripts/sign_with_discovered_chain.mjs "$BASE" "$WORK/signed"

DISCOVERED_HASH=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["genesis_hash"])' "$WORK/signed/discovered.json")
[ "$DISCOVERED_HASH" = "$SERVED_HASH" ] || { echo "the SDK recorded a different hash than the node served" >&2; exit 1; }

# 3. tet-core's verifier accepts it, with the node's own configuration
env -u TET_GENESIS_HASH TET_CHAIN_ID="$CHAIN_ID" TET_TREASURY_ADDRESS="$TREASURY" \
  "$CLI" agent verify --sig "$WORK/signed/payload.bin.sig.json" --payload "$WORK/signed/payload.bin"

# 4. and refuses on a different chain id — otherwise step 3 proves nothing about the binding
if env -u TET_GENESIS_HASH TET_CHAIN_ID="tet-some-other-chain" TET_TREASURY_ADDRESS="$TREASURY" \
     "$CLI" agent verify --sig "$WORK/signed/payload.bin.sig.json" >/dev/null 2>&1; then
  echo "verify returned 0 under a different chain id" >&2
  exit 1
fi

# 5. and the served hash is genuinely DERIVED: a node with a different treasury serves a different
#    genesis hash for the same chain id. Without this, /chain could be returning a constant.
stop_node
PORT_B=$((PORT + 1))
mkdir -p "$WORK/db-b"
start_node "$PORT_B" "$TREASURY_B" "$WORK/db-b"
SERVED_HASH_B=$(curl -sf "http://127.0.0.1:${PORT_B}/chain" | python3 -c 'import json,sys;print(json.load(sys.stdin)["genesis_hash"])')
[ "$SERVED_HASH_B" != "$SERVED_HASH" ] || { echo "two different treasuries served the same genesis_hash — /chain is not derived" >&2; exit 1; }
echo "derived: treasury A -> ${SERVED_HASH:0:12}…   treasury B -> ${SERVED_HASH_B:0:12}…"

echo "ok: GET /chain discovered, signed by the SDK, verified by tet-core, refused on another chain"
