#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 SERVER_IP" >&2
  exit 1
fi

SERVER_IP="$1"
REMOTE="root@${SERVER_IP}"
REMOTE_DIR="/root/TET-Network"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[deploy] Target: ${REMOTE}"
echo "[deploy] Project root: ${PROJECT_ROOT}"

echo "[deploy] Installing Ubuntu build dependencies and Rust..."
ssh "${REMOTE}" <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if [ ! -f /swapfile ]; then
  echo "Creating 8GB swap file..."
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
apt update
apt install -y build-essential pkg-config libssl-dev git curl ufw rsync ca-certificates fail2ban
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
mkdir -p /root/TET-Network
EOF

echo "[deploy] Syncing source to ${REMOTE}:${REMOTE_DIR}..."
rsync -az --delete \
  --exclude ".git/" \
  --exclude "target/" \
  --exclude "node_modules/" \
  --exclude "data/" \
  --exclude "tet_data/" \
  --exclude "tet.db*/" \
  --exclude "db_*/" \
  --exclude ".env" \
  --exclude ".DS_Store" \
  "${PROJECT_ROOT}/" "${REMOTE}:${REMOTE_DIR}/"

echo "[deploy] Building release binary and installing service..."
ssh "${REMOTE}" <<'EOF'
set -euo pipefail
source "$HOME/.cargo/env"
cd /root/TET-Network
RISC0_SKIP_BUILD=1 cargo build --release -p tet-core
install -m 0755 target/release/TET-Core /usr/local/bin/TET-Core

mkdir -p /etc/tet-node /var/lib/tet-node
if [[ ! -f /etc/tet-node/tet-node.env ]]; then
  cat >/etc/tet-node/tet-node.env <<'ENVEOF'
PORT=5010
TET_REST_BIND=0.0.0.0:5010
TET_DB_DIR=/var/lib/tet-node/tet.db
TET_ENABLE_P2P=true
TET_P2P_LISTEN=/ip4/0.0.0.0/tcp/8002
TET_ADMIN_API_KEY=change-me
RISC0_SKIP_BUILD=1
ENVEOF
  chmod 0600 /etc/tet-node/tet-node.env
fi

cp deploy/systemd/tet-node.service /etc/systemd/system/tet-node.service

ufw allow 22/tcp
ufw allow 5010/tcp
ufw allow 8002/tcp
ufw allow 8002/udp
ufw --force enable

systemctl enable --now fail2ban

systemctl daemon-reload
systemctl enable --now tet-node
systemctl restart tet-node
systemctl --no-pager --full status tet-node || true
EOF

echo "[deploy] Done. Node deployed to ${SERVER_IP}."
echo "[deploy] IMPORTANT: edit /etc/tet-node/tet-node.env and replace TET_ADMIN_API_KEY=change-me."

