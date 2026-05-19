#!/usr/bin/env bash
# Sprint 1 Phase C — manual 3-node testnet (ports 5010/5020/5030).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/.."
REPO_ROOT="$(pwd)"

BIN="${TET_CORE_BIN:-$REPO_ROOT/target/release/TET-Core}"
if [[ ! -x "$BIN" ]]; then
  echo "Building release TET-Core..."
  (cd "$REPO_ROOT" && RISC0_SKIP_BUILD=1 cargo build --release --bin TET-Core)
  BIN="$REPO_ROOT/target/release/TET-Core"
fi

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

export RISC0_SKIP_BUILD=1
export TET_VALIDATOR_IDS="${TET_VALIDATOR_IDS:-alice}"
export TET_AUTO_MINE=1
export TET_BLOCK_TIME_SEC="${TET_BLOCK_TIME_SEC:-5}"

rm -rf /tmp/tet-phasec-n1.db /tmp/tet-phasec-n2.db /tmp/tet-phasec-n3.db

echo "=== Node 1 (bootstrap) port 5010 p2p 16011 ==="
unset TET_BOOTNODES
export TET_IS_BOOTNODE=1
export PORT=5010
export TET_DB_DIR=/tmp/tet-phasec-n1.db
export TET_WALLET_ID=alice
export TET_P2P_LISTEN=/ip4/127.0.0.1/tcp/16011
"$BIN" > /tmp/tet-phasec-n1.log 2>&1 &
PIDS+=($!)
echo "node1 pid=$!"

echo "Waiting 30s for node1 to mine and publish listen addr..."
sleep 30

BOOT=$(grep -E '\[P2P-block\] listening on ' /tmp/tet-phasec-n1.log | head -1 | sed 's/.*listening on //' || true)
if [[ -z "$BOOT" ]]; then
  echo "ERROR: could not read block-plane listen addr from node1 log"
  tail -40 /tmp/tet-phasec-n1.log
  exit 1
fi
echo "Bootnode: $BOOT"

unset TET_IS_BOOTNODE
export TET_BOOTNODES="$BOOT"

echo "=== Node 2 port 5020 p2p 16012 ==="
export PORT=5020
export TET_DB_DIR=/tmp/tet-phasec-n2.db
export TET_WALLET_ID=alice
export TET_P2P_LISTEN=/ip4/127.0.0.1/tcp/16012
"$BIN" > /tmp/tet-phasec-n2.log 2>&1 &
PIDS+=($!)
echo "node2 pid=$!"

echo "=== Node 3 port 5030 p2p 16013 ==="
export PORT=5030
export TET_DB_DIR=/tmp/tet-phasec-n3.db
export TET_WALLET_ID=alice
export TET_P2P_LISTEN=/ip4/127.0.0.1/tcp/16013
"$BIN" > /tmp/tet-phasec-n3.log 2>&1 &
PIDS+=($!)
echo "node3 pid=$!"

echo "Waiting 30s for catch-up..."
sleep 30

echo ""
echo "=== /ledger/state ==="
H1=$(curl -sf "http://127.0.0.1:5010/ledger/state" | tee /tmp/tet-phasec-s1.json | jq -r .block_height)
H2=$(curl -sf "http://127.0.0.1:5020/ledger/state" | tee /tmp/tet-phasec-s2.json | jq -r .block_height)
H3=$(curl -sf "http://127.0.0.1:5030/ledger/state" | tee /tmp/tet-phasec-s3.json | jq -r .block_height)

echo "heights: n1=$H1 n2=$H2 n3=$H3"
MIN=$(printf '%s\n' "$H1" "$H2" "$H3" | sort -n | head -1)
MAX=$(printf '%s\n' "$H1" "$H2" "$H3" | sort -n | tail -1)
SPREAD=$((MAX - MIN))
echo "max-min spread = $SPREAD"

echo ""
echo "state_root:"
jq -r '.state_root' /tmp/tet-phasec-s1.json
jq -r '.state_root' /tmp/tet-phasec-s2.json
jq -r '.state_root' /tmp/tet-phasec-s3.json

echo ""
echo "=== DoD check (Sprint 1) ==="
if [[ "$SPREAD" -le 2 ]]; then
  echo "✅ PASS: block_height max-min <= 2"
else
  echo "❌ FAIL: block_height max-min = $SPREAD (expected <= 2)"
  exit 1
fi

echo ""
echo "Logs: /tmp/tet-phasec-n{1,2,3}.log"
echo "Nodes still running (PIDs: ${PIDS[*]}). Stop with: kill ${PIDS[*]}"
