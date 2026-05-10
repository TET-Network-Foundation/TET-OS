#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 SERVER_IP" >&2
  exit 1
fi

SERVER_IP="$1"
REMOTE="root@${SERVER_IP}"

read -r -p "本当にサーバー ${SERVER_IP} のDBを吹き飛ばして良いですか？ (y/n) " answer
case "${answer}" in
  y|Y|yes|YES)
    ;;
  *)
    echo "Aborted."
    exit 0
    ;;
esac

echo "[reset-db] Stopping tet-node on ${SERVER_IP}..."
ssh "${REMOTE}" <<'EOF'
set -euo pipefail
systemctl stop tet-node
rm -rf /var/lib/tet-node/*
systemctl restart tet-node
systemctl status tet-node --no-pager
EOF

echo "[reset-db] Done. ${SERVER_IP} restarted from a clean DB."

