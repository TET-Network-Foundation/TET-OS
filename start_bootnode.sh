#!/bin/bash
echo "🗼 Starting The Lighthouse (Bootnode) on port 5009..."
export TET_WALLET_ID="nexus_bootnode_01"
export TET_X25519_STATIC_SK_B64="dGVzdF9ib290bm9kZV9zZWNyZXRfa2V5XzMyYnl0ZXM="
export PORT=5009
export TET_P2P_LISTEN="/ip4/127.0.0.1/tcp/7999"
export RUST_LOG=info
RISC0_SKIP_BUILD=1 cargo run --bin TET-Core
