#!/bin/bash
set -euo pipefail

# protobuf-src / libtool がワークスペースの空白パスで壊れるため、
# 空白のない symlink パスから実行する。
if [[ "$PWD" == *" "* ]]; then
  LINK_DIR="$HOME/nexus_ws"
  if [[ ! -e "$LINK_DIR" ]]; then
    ln -s "$PWD" "$LINK_DIR"
  fi
  cd "$LINK_DIR"
fi

# IMPORTANT: Do NOT skip guest embedding for the true ZK flight.
# risc0-build treats ANY non-empty value as "skip" (even "0"), so we must UNSET it.
unset RISC0_SKIP_BUILD

echo "🧨 Wiping local Sled DB (clean E2E)..."
rm -rf tet.db_* tet.db || true

echo "💰 Funding local Solana wallet (localnet airdrop)..."
solana airdrop 10 --keypair ~/.config/solana/id.json --url localhost || true

echo "🧠 Building RISC0 guest + embedding methods..."
cargo clean -p methods || true
cargo build -p methods

echo "🔧 Building host binary..."
cargo build --bin TET-Core
echo "🧹 Cleaning up old processes..."
killall -9 TET-Core 2>/dev/null || true
sleep 2

echo "🔑 Generating Worker Keys..."
eval $(./target/debug/TET-Core --keygen | sed 's/GEN_/WORKER_/g')
echo "🔑 Generating Client Keys..."
eval $(./target/debug/TET-Core --keygen | sed 's/GEN_/CLIENT_/g')

echo "🗼 Starting The Lighthouse (Bootnode) on port 5009..."
export TET_FOUNDER_WALLET="nexus_founder_01"
export TET_WALLET_ID="nexus_bootnode_01"
export PORT=5009
export TET_P2P_LISTEN="/ip4/127.0.0.1/tcp/7999"
export RUST_LOG=info
./target/debug/TET-Core > bootnode.log 2>&1 &
BOOTNODE_PID=$!

echo "⏳ Waiting for Bootnode Peer ID..."
BOOT_PEER_ID=""
for _ in {1..30}; do
  if grep -q "local_peer_id=" bootnode.log; then
    BOOT_PEER_ID="$(grep -m 1 -o 'local_peer_id=[^ ]*' bootnode.log | cut -d= -f2 | tr -d '\r\n')"
    break
  fi
  sleep 1
done
if [[ -z "$BOOT_PEER_ID" ]]; then
  echo "❌ Failed to capture Bootnode Peer ID from bootnode.log"
  echo "Last 50 lines of bootnode.log:"
  tail -n 50 bootnode.log || true
  exit 1
fi
echo "🎯 Bootnode Peer ID: $BOOT_PEER_ID"
FULL_BOOT_ADDR="/ip4/127.0.0.1/tcp/7999/p2p/$BOOT_PEER_ID"

echo "⏳ Waiting 3 seconds for Bootnode to bind..."
sleep 5

echo "🚀 Starting Worker (Node A) on port 5010..."
export TET_FOUNDER_WALLET="nexus_founder_01"
export TET_WALLET_ID="nexus_worker_01"
export TET_X25519_STATIC_SK_B64="$WORKER_X25519_SK"
export TET_MLKEM_STATIC_SK_B64="$WORKER_MLKEM_SK"
export PORT=5010
export TET_P2P_LISTEN="/ip4/127.0.0.1/tcp/8002"
export TET_DIAL_PEER="$FULL_BOOT_ADDR"
export RUST_LOG="info,TET_Core::ledger=debug"
if [[ "${TET_E2E_BAD_RECEIPT:-0}" == "1" ]]; then
  echo "🗡️  Slashing test mode: Worker runs WITHOUT zk-prove (bad receipt expected)"
  TET_ONCHAIN_STAKE=1 TET_IS_WORKER=1 cargo run --quiet --bin TET-Core > worker.log 2>&1 &
else
  TET_ONCHAIN_STAKE=1 TET_IS_WORKER=1 cargo run --quiet --bin TET-Core --features zk-prove > worker.log 2>&1 &
fi
WORKER_PID=$!

echo "⏳ Waiting 3 seconds for Worker to bind..."
sleep 8

echo "🚀 Starting Client (Node B) on port 5011 and dialing Bootnode..."
export TET_FOUNDER_WALLET="nexus_founder_01"
export TET_WALLET_ID="p2p-client"
export TET_X25519_STATIC_SK_B64="$CLIENT_X25519_SK"
export TET_MLKEM_STATIC_SK_B64="$CLIENT_MLKEM_SK"
export TET_MLKEM_STATIC_PUB_B64="$CLIENT_MLKEM_PK"
export TET_WORKER_X25519_PUB_B64="$WORKER_X25519_PK"
export TET_WORKER_MLKEM_PUB_B64="$WORKER_MLKEM_PK"
export TET_DEV_FAUCET_MICRO=1000000
export PORT=5011
export TET_P2P_LISTEN="/ip4/127.0.0.1/tcp/8001"
export TET_DIAL_PEER="$FULL_BOOT_ADDR"
export RUST_LOG="info,TET_Core::ledger=debug"
if [[ "${TET_E2E_BAD_RECEIPT:-0}" == "1" ]]; then
  export TET_ONCHAIN_SLASH=1
  export TET_ONCHAIN_TREASURY="$(solana address -k ~/.config/solana/id.json --url localhost)"
  export TET_ONCHAIN_SLASH_WORKER_PUBKEY="$TET_ONCHAIN_TREASURY"
fi
./target/debug/TET-Core > client.log 2>&1 &
CLIENT_PID=$!

echo "⏳ Waiting for DHT/Mesh to stabilize..."
sleep 60

echo "🔥 Firing the P2P inference missile..."
curl -s -X POST http://127.0.0.1:5011/api/v1/ai/utility \
     -H "Content-Type: application/json" \
     -d '{
           "prompt": "Hello Worker. Explain relativity in one sentence.",
           "target_worker_id": "nexus_worker_01"
         }'
echo -e "\n"

echo "⏳ Waiting 20 seconds for Ollama to process the prompt..."
sleep 20

echo "📊 === WORKER LOG RESULTS ==="
grep -E "p2p|relay|circuit|autonat|ollama|Llama3|PUBLISH|Mismatch|error|Error" worker.log | tail -n 30 || true

echo "📊 === CLIENT LOG RESULTS ==="
grep -E "p2p|relay|circuit|autonat|MISSION ACCOMPLISHED|⭐⭐⭐⭐|PUBLISH|Mismatch|error|Error" client.log | tail -n 30 || true

echo "📊 === BOOTNODE LOG RESULTS (Relay & NAT) ==="
grep -E "p2p|relay|circuit|autonat|error|Error|Mismatch|PUBLISH" bootnode.log | tail -n 30 || true

if [[ "${TET_E2E_KEEP_NODES:-0}" == "1" ]]; then
  echo "🧷 Keeping nodes running (TET_E2E_KEEP_NODES=1)"
  echo "BOOTNODE_PID=$BOOTNODE_PID WORKER_PID=$WORKER_PID CLIENT_PID=$CLIENT_PID"
  echo "Logs: bootnode.log worker.log client.log"
  exit 0
fi

echo "🧹 Cleaning up background nodes..."
kill -9 $BOOTNODE_PID $WORKER_PID $CLIENT_PID 2>/dev/null
echo "✅ Done."

