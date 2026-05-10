#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.mainnet.example"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33mWarning: %s\033[0m\n' "$*"; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
  elif command -v docker-compose >/dev/null 2>&1; then
    printf 'docker-compose'
  else
    die "Docker Compose が見つかりません。Docker Desktop または docker compose plugin をインストールしてください。"
  fi
}

check_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker が見つかりません。https://www.docker.com/products/docker-desktop/ からインストールしてください。"
  docker info >/dev/null 2>&1 || die "Docker daemon が起動していません。Docker Desktop を起動してから再実行してください。"
}

detect_public_ip() {
  local ip=""
  if command -v curl >/dev/null 2>&1; then
    ip="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
    if [[ -z "$ip" ]]; then
      ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    fi
  fi
  printf '%s' "$ip"
}

random_b64_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import base64, os
print(base64.b64encode(os.urandom(32)).decode())
PY
  else
    die "openssl か python3 が必要です。DB暗号化キーを生成できません。"
  fi
}

prompt_required() {
  local label="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -p "$label: " value
    value="$(printf '%s' "$value" | xargs)"
  done
  printf '%s' "$value"
}

prompt_secret_required() {
  local label="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -s -p "$label: " value
    printf '\n'
    value="$(printf '%s' "$value" | xargs)"
  done
  printf '%s' "$value"
}

validate_wallet_id() {
  [[ "$1" =~ ^[0-9a-fA-F]{64}$ ]]
}

validate_mnemonic_shape() {
  local count
  count="$(printf '%s' "$1" | wc -w | tr -d ' ')"
  [[ "$count" == "12" || "$count" == "24" ]]
}

detect_gpu() {
  local host_gpu=0
  local docker_gpu=0
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    host_gpu=1
  fi
  if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -qi nvidia; then
    docker_gpu=1
  fi
  if [[ "$host_gpu" == "1" && "$docker_gpu" == "1" ]]; then
    printf '1'
  else
    printf '0'
  fi
}

write_env() {
  local wallet_id="$1"
  local mnemonic="$2"
  local public_host="$3"
  local bootnodes="$4"
  local gpu_enabled="$5"
  local db_key
  local external_addr
  db_key="$(random_b64_32)"
  if [[ "$public_host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    external_addr="/ip4/$public_host/tcp/8002"
  else
    external_addr="/dns4/$public_host/tcp/8002"
  fi

  umask 077
  cat > "$ENV_FILE" <<EOF
TET_MAINNET=1
TET_PROD=true
RUST_LOG=info
PORT=5010
TET_REST_BIND=0.0.0.0:5010
TET_DB_DIR=/data/tet.db
TET_DB_ENCRYPT=strict
TET_DB_KEY_B64=$db_key

TET_WALLET_ID=$wallet_id
TET_WORKER_MNEMONIC="$mnemonic"

TET_AUTO_MINE=1
TET_BLOCK_TIME_SEC=12
TET_CONSENSUS_LEADER_MODE=caac
TET_BASE_BLOCK_REWARD=0.1
TET_WORKER_DAEMON=1
TET_WORKER_DAEMON_POLL_MS=2000

TET_ENABLE_P2P=1
TET_P2P_LISTEN=/ip4/0.0.0.0/tcp/8002
TET_EXTERNAL_ADDR=$external_addr
TET_BOOTNODES=$bootnodes
TET_P2P_GOSSIP_MAX_MSG_BYTES=131072
TET_P2P_MAX_ORPHANS=256
TET_P2P_ORPHAN_TTL_MS=600000
TET_P2P_MAX_BACKFILL_DEPTH=64

OLLAMA_BASE_URL=http://host.docker.internal:11434
TET_AI_MODEL=llama3
TET_GPU_ENABLED=$gpu_enabled
EOF
  chmod 600 "$ENV_FILE"
}

main() {
  cd "$ROOT_DIR"
  bold "TET Mainnet 1-Click Installer"
  [[ -f "$ENV_EXAMPLE" ]] || die ".env.mainnet.example が見つかりません。"
  check_docker
  local compose
  compose="$(compose_cmd)"

  if [[ -f "$ENV_FILE" ]]; then
    read -r -p ".env は既に存在します。上書きしますか？ [y/N]: " overwrite
    if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
      bold "既存 .env を保持して起動します。"
      "$ROOT_DIR/start_node.sh"
      exit 0
    fi
  fi

  bold "Worker wallet setup"
  printf 'Worker Daemon がZK Proof Txに署名するため、TET_WORKER_MNEMONIC が必須です。\n'
  printf 'まだ持っていない場合は、Sovereign OS / TET wallet で新規ウォレットを作成し、表示されたシードフレーズを紙に控えてください。\n'
  printf 'このスクリプトは秘密鍵をネットワーク送信しません。.env は chmod 600 で保存されます。\n\n'

  local wallet_id mnemonic
  wallet_id="$(prompt_required "TET_WALLET_ID (64 hex public wallet id)")"
  while ! validate_wallet_id "$wallet_id"; do
    warn "TET_WALLET_ID は64文字のhexである必要があります。"
    wallet_id="$(prompt_required "TET_WALLET_ID (64 hex public wallet id)")"
  done

  mnemonic="$(prompt_secret_required "TET_WORKER_MNEMONIC (12 or 24 words; hidden input)")"
  while ! validate_mnemonic_shape "$mnemonic"; do
    warn "Mnemonic は12語または24語で入力してください。"
    mnemonic="$(prompt_secret_required "TET_WORKER_MNEMONIC (12 or 24 words; hidden input)")"
  done

  local public_ip detected_ip answer
  detected_ip="$(detect_public_ip)"
  if [[ -n "$detected_ip" ]]; then
    read -r -p "あなたのグローバルIPは $detected_ip ですか？ [Y/n]: " answer
    if [[ "$answer" =~ ^[Nn]$ ]]; then
      public_ip="$(prompt_required "公開IPv4またはDNS名")"
    else
      public_ip="$detected_ip"
    fi
  else
    warn "グローバルIPを自動検出できませんでした。"
    public_ip="$(prompt_required "公開IPv4またはDNS名")"
  fi

  local bootnodes
  read -r -p "TET_BOOTNODES [/ip4/BOOTNODE_IP/tcp/8002/p2p/BOOTNODE_PEER_ID]: " bootnodes
  bootnodes="${bootnodes:-/ip4/BOOTNODE_IP/tcp/8002/p2p/BOOTNODE_PEER_ID}"

  local gpu_enabled
  gpu_enabled="$(detect_gpu)"
  if [[ "$gpu_enabled" == "1" ]]; then
    bold "NVIDIA GPU + Docker GPU runtime を検出しました。GPU profile で起動します。"
  else
    warn "NVIDIA GPUを使用するには nvidia-container-toolkit が必要です。現在はCPUモードで起動します（非常に遅くなります）。"
  fi

  write_env "$wallet_id" "$mnemonic" "$public_ip" "$bootnodes" "$gpu_enabled"
  bold ".env を生成しました。"
  printf 'Compose: %s\n\n' "$compose"

  "$ROOT_DIR/start_node.sh"
}

main "$@"
