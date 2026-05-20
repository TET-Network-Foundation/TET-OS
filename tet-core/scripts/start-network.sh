#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

echo "Starting tet-node-1 (bootstrap)..."
docker compose up -d --build tet-node-1

echo "Waiting for PeerId..."
sleep 10

PEER_ID=""
for _ in $(seq 1 30); do
  PEER_ID=$(docker logs tet-node-1 2>&1 | grep -oE 'libp2p PeerId: 12D3KooW[A-Za-z0-9]+' | head -1 | awk '{print $3}' || true)
  if [ -n "$PEER_ID" ]; then
    break
  fi
  sleep 2
done

if [ -z "$PEER_ID" ]; then
  echo "ERROR: tet-node-1 did not start properly"
  docker logs tet-node-1 | tail -50
  exit 1
fi

BOOTNODE="/dns4/tet-node-1/tcp/5011/p2p/${PEER_ID}"
echo "Bootnode: ${BOOTNODE}"

echo "Starting tet-node-2, tet-node-3, and tet-ui..."
export TET_BOOTNODES="${BOOTNODE}"
docker compose up -d tet-node-2 tet-node-3 tet-ui

echo ""
echo "Network started. Endpoints:"
echo "  Node 1 (bootstrap): http://localhost:5010"
echo "  Node 2:             http://localhost:5020"
echo "  Node 3:             http://localhost:5030"
echo "  UI:                 http://localhost:3000"
