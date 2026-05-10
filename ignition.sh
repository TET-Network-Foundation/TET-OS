#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root (directory containing this script) so DB purge matches TET-Core cwd regardless of caller pwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "[ignition] ROOT=$PWD"

echo "[ignition] (1) 過去の亡霊（ゾンビプロセス）を殺害"
pkill -f TET-Core || true
pkill -f tet-prover-host || true
sleep 2

echo "[ignition] (2) 金庫の物理的破壊（パージ）— TET-Core は既定で tet.db_<PORT>（PORT 未設定時は tet.db_5010）"
# 新天地 DB ディレクトリを毎回白紙に（起動前に Genesis から必ずやり直す）
rm -rf "${ROOT}/TET_NEW_UNIVERSE_DB"
# Namespaced DB (see main.rs: tet.db_${PORT} when TET_DB_DIR unset)
rm -rf tet.db tet.db_* "tet.db_${PORT:-5010}" 2>/dev/null || true
rm -rf tet-core/tet.db tet-core/tet.db_* "tet-core/tet.db_${PORT:-5010}" 2>/dev/null || true
# Legacy / alternate cwd when operators ran cargo only inside tet-core/
rm -rf tet-core/tet.db tet-core/tet.db_* 2>/dev/null || true
rm -rf chains/dev tet-core/chains/dev 2>/dev/null || true

echo "[ignition] (2b) 隠しパス・キャッシュ・ログを掃除（毎回クリーンジェネシス相当）"
shopt -s dotglob nullglob 2>/dev/null || true
# Hidden / alternate DB filenames operators may have created
rm -rf "${ROOT}/.tet_db"* "${ROOT}/tet-core/.tet_db"* 2>/dev/null || true
# Recursive tet.db* trees (any depth under repo root, bounded depth avoids traversing huge dirs)
find "${ROOT}" -maxdepth 6 \( -name 'tet.db' -o -name 'tet.db_*' \) -exec rm -rf {} + 2>/dev/null || true
# Next.js dev/build caches (stale API routes / proxy)
rm -rf "${ROOT}/tet-network/ui/.next" "${ROOT}/tet-network/ui/out" "${ROOT}/ui/.next" "${ROOT}/ui/out" 2>/dev/null || true
# Prior foreground logs from last ignition (fresh files after restart)
rm -f "${ROOT}/node.log" "${ROOT}/prover.log" 2>/dev/null || true
find "${ROOT}" -maxdepth 4 -name '.DS_Store' -delete 2>/dev/null || true

# Genesis / PQC — exported before TET-Core so `cargo run` and the binary inherit them.
export TET_PQC_ENABLED=1
# tet-core `pqc_active()` reads `TET_PQC_ACTIVE` (see quantum_shield.rs); keep aligned with TET_PQC_ENABLED.
export TET_PQC_ACTIVE="${TET_PQC_ENABLED}"
# 64-char lowercase hex (placeholder founder pubkey for operators / tooling; adjust if your deployment expects a live key).
export TET_FOUNDER_PUBKEY="1cbd2d43530a44705ad088af313e18f80b53ef16b36177cd4b77b846f2a5f07c"
export TET_DB_DIR="${ROOT}/TET_NEW_UNIVERSE_DB"

echo "[ignition] (3) L1ノードのバックグラウンド起動"
# tet-core クレートのマニフェスト上でビルドし、必ず TET-Core バイナリだけを起動（workspace 既定バイナリ衝突を避ける）
(
  cd "${ROOT}/tet-core"
  RUST_LOG=info cargo run --release --bin TET-Core --features zk-prove -- --dev --offchain-worker Always
) > "${ROOT}/node.log" 2>&1 &

sleep 3

if [[ ! -f "${ROOT}/node.log" ]]; then
  echo -e "\033[0;31m[ignition] FATAL: node.log was not created — TET-Core may have failed before writing logs.\033[0m"
  exit 1
fi

if grep -qiE 'panicked|error' "${ROOT}/node.log"; then
  echo -e "\033[0;31m[ignition] FATAL: node.log reports panic or error — refusing to start UI. Inspect node.log:\033[0m"
  tail -n 80 "${ROOT}/node.log" >&2
  exit 1
fi

echo "[ignition] (4) ZK Proverのバックグラウンド起動"
cargo run --release -p tet-prover-host > "${ROOT}/prover.log" 2>&1 &

echo "[ignition] (5) UIサーバーの起動"
if [[ -d tet-network/ui ]]; then
  cd tet-network/ui
elif [[ -d ui ]]; then
  cd ui
else
  echo "[ignition] WARN: tet-network/ui not found; skip npm run dev"
  exit 0
fi
npm run dev
