#!/usr/bin/env bash
# tet-node-1 の PeerId を取得して、TET_BOOTNODES 用の multiaddr を表示

set -e

CONTAINER="${1:-tet-node-1}"
P2P_PORT="${2:-5011}"

echo "Waiting for ${CONTAINER} to start..."
PEER_ID=""
for _ in $(seq 1 30); do
  PEER_ID=$(docker logs "${CONTAINER}" 2>&1 | grep -oE 'libp2p PeerId: 12D3KooW[A-Za-z0-9]+' | head -1 | awk '{print $3}' || true)
  if [ -n "$PEER_ID" ]; then
    break
  fi
  sleep 2
done

if [ -z "$PEER_ID" ]; then
  echo "ERROR: PeerId not found in ${CONTAINER} logs after 60s"
  exit 1
fi

echo ""
echo "============================================================"
echo "Bootnode PeerId:    ${PEER_ID}"
echo "Bootnode multiaddr: /dns4/${CONTAINER}/tcp/${P2P_PORT}/p2p/${PEER_ID}"
echo "============================================================"
echo ""
echo "To connect other nodes, set:"
echo "  TET_BOOTNODES=/dns4/${CONTAINER}/tcp/${P2P_PORT}/p2p/${PEER_ID}"
