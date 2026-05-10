#!/usr/bin/env bash
set -euo pipefail

# Minimal smoke-check for P0-1:
# When running node with `--tet-rpc-profile public`, potentially-unsafe RPCs
# (e.g. `author_submitExtrinsic`) must be rejected externally.
#
# Usage:
#   RPC_HTTP_URL=http://127.0.0.1:9933 ./scripts/check_public_rpc_allowlist.sh
#
# Requirements:
#   - Node must already be running and exposing RPC.
#   - `curl` must be available.

RPC_HTTP_URL="${RPC_HTTP_URL:-http://127.0.0.1:9933}"

echo "[check_public_rpc_allowlist] RPC_HTTP_URL=${RPC_HTTP_URL}"

REQ_ID="1"

# 1) Unsafe RPC should be rejected with MethodNotFound (or equivalent).
# `author_submitExtrinsic` is blocked by Substrate's DenyUnsafe policy.
BODY_1=$(cat <<EOF
{
  "jsonrpc": "2.0",
  "id": ${REQ_ID},
  "method": "author_submitExtrinsic",
  "params": ["0x00"]
}
EOF
)

RESP_1="$(curl -sS -H 'content-type: application/json' --data "${BODY_1}" "${RPC_HTTP_URL}")"

echo "[check_public_rpc_allowlist] response=${RESP_1}"

if python3 -c "import json,sys; j=json.loads(sys.stdin.read()); err=j.get('error') or {}; code=err.get('code'); sys.exit(0 if code==-32601 else 1)" <<<"${RESP_1}"; then
  echo "[OK] author_submitExtrinsic rejected (Method not found)."
  exit 0
fi

if python3 -c "import sys; resp=sys.stdin.read().lower(); sys.exit(0 if 'method not found' in resp else 1)" <<<"${RESP_1}"; then
  echo "[OK] author_submitExtrinsic rejected (Method not found text)."
  exit 0
fi

echo "[FAIL] author_submitExtrinsic was not rejected as expected."
echo "       Expected MethodNotFound. Got:"
echo "${RESP_1}"
exit 1

