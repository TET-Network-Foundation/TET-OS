#!/usr/bin/env bash
# Install the log seal on this seed (as root, from a copy of deploy/logseal/). Idempotent; it never
# overwrites an existing seal wallet. Docs: docs/LOG_SEAL.md.
#
#   bash install.sh <host label> [tree dir] [container]
#
# 1. installs /opt/tet-logseal (the tool, the stamp signer, TET's ML-DSA WASM) and the systemd units;
# 2. makes this host's seal wallet: 12 words generated in a container with NO network, written
#    straight to /etc/tet-logseal/seal.mnemonic (root, 0600) and never printed;
# 3. funds it with the welcome airdrop (1,000 TET, practice unit), signed in a no-network container
#    and submitted to this node's own loopback API;
# 4. takes the current config as accepted, writes the first seal and stamps it, then enables the
#    timer (every 10 minutes; a stamp about once an hour).
set -euo pipefail
LABEL="${1:?usage: install.sh <host label> [tree dir] [container]}"
TREE="${2:-/opt/TET-OS}"
CONTAINER="${3:-tet-core-mainnet}"
SRC="$(cd "$(dirname "$0")" && pwd)"
NODE=http://127.0.0.1:5010
PY_IMG=mirror.gcr.io/library/python:3.12-slim
NODE_IMG=mirror.gcr.io/library/node:22-slim
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[[ "$LABEL" =~ ^[a-z0-9-]{1,32}$ ]] || { echo "label: a-z 0-9 - only"; exit 1; }

VENDOR="$TREE/tet-agent-sdk/vendor"; [ -f "$VENDOR/tet_pqc_wasm_bg.wasm" ] || VENDOR="$SRC"
install -d -m 0755 /opt/tet-logseal
install -m 0755 "$SRC/tet-logseal" /opt/tet-logseal/tet-logseal
install -m 0644 "$SRC/stamp_sign.mjs" "$SRC/airdrop_claim_sign.mjs" "$VENDOR/tet_pqc_wasm.js" "$VENDOR/tet_pqc_wasm_bg.wasm" /opt/tet-logseal/
install -d -m 0700 /etc/tet-logseal /var/lib/tet-logseal
cat > /etc/tet-logseal/logseal.env <<ENV
TET_LOGSEAL_HOST=$LABEL
TET_LOGSEAL_TREE=$TREE
TET_LOGSEAL_CONTAINER=$CONTAINER
TET_LOGSEAL_NODE=$NODE
ENV
chmod 0600 /etc/tet-logseal/logseal.env

# 2. The seal wallet (never overwritten, never printed).
if [ ! -e /etc/tet-logseal/seal.mnemonic ]; then
  G=$(mktemp -d /root/logsealgen.XXXX)
  docker run --rm -v "$G:/pkgs" "$PY_IMG" pip install -q --target /pkgs mnemonic==0.21 >/dev/null 2>&1
  cat > "$G/gen.py" <<'PY'
import os, sys
sys.path.insert(0, "/pkgs")
from mnemonic import Mnemonic
p = "/out/seal.mnemonic"
if os.path.exists(p): sys.exit("exists")
w = Mnemonic("english").generate(strength=128)
fd = os.open(p + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.write(fd, (w + "\n").encode()); os.fsync(fd); os.close(fd); os.chown(p + ".tmp", 0, 0); os.rename(p + ".tmp", p)
PY
  docker run --rm --network none -v "$G:/pkgs:ro" -v "$G/gen.py:/gen.py:ro" -v /etc/tet-logseal:/out "$PY_IMG" python /gen.py
  rm -rf "$G"
fi
chmod 0600 /etc/tet-logseal/seal.mnemonic

# 3. Fund it with the welcome airdrop, if it has nothing yet.
read -r CHAIN GEN < <(curl -s -m 10 "$NODE/chain" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['chain_id'],d['genesis_hash'])")
CLAIM=$(docker run --rm --network none -v /opt/tet-logseal:/w:ro -v /etc/tet-logseal:/k:ro "$NODE_IMG" \
  node /w/airdrop_claim_sign.mjs /k/seal.mnemonic "$CHAIN" "$GEN" /w)
WALLET=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tx']['wallet_id'])" "$CLAIM")
echo "seal wallet: $WALLET"
BAL=$(curl -s -m 10 "$NODE/ledger/balance/$WALLET" | python3 -c "import json,sys;print(json.load(sys.stdin).get('balance_tet',0))")
if [ "$BAL" = "0.0" ] || [ "$BAL" = "0" ]; then
  echo "airdrop claim: $(curl -s -m 20 -X POST -H 'Content-Type: application/json' --data "$CLAIM" "$NODE/ledger/initial_airdrop/claim" | head -c 160)"
  for _ in $(seq 1 40); do
    BAL=$(curl -s -m 10 "$NODE/ledger/balance/$WALLET" | python3 -c "import json,sys;print(json.load(sys.stdin).get('balance_tet',0))")
    [ "$BAL" != "0.0" ] && break; sleep 5
  done
fi
echo "seal wallet balance: $BAL TET (practice unit)"

# 4. Units, the accepted config, the first seal and stamp, then the timer.
install -m 0644 "$SRC/tet-logseal.service" /etc/systemd/system/tet-logseal.service
install -m 0644 "$SRC/tet-logseal.timer" /etc/systemd/system/tet-logseal.timer
systemctl daemon-reload
set -a
# shellcheck source=/dev/null
. /etc/tet-logseal/logseal.env
# shellcheck source=/dev/null
[ -f /etc/tet/healthcheck.env ] && . /etc/tet/healthcheck.env
set +a
/opt/tet-logseal/tet-logseal accept
TET_LOGSEAL_STAMP_EVERY_SEC=0 /opt/tet-logseal/tet-logseal run
systemctl enable --now tet-logseal.timer
systemctl list-timers tet-logseal.timer --no-pager | head -3
