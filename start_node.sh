#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33mWarning: %s\033[0m\n' "$*"; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
  elif command -v docker-compose >/dev/null 2>&1; then
    printf 'docker-compose'
  else
    die "Docker Compose が見つかりません。"
  fi
}

env_value() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 1
  fi
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' "$ENV_FILE"
}

main() {
  cd "$ROOT_DIR"
  [[ -f "$ENV_FILE" ]] || die ".env がありません。先に ./install.sh を実行してください。"
  command -v docker >/dev/null 2>&1 || die "Docker が見つかりません。"
  docker info >/dev/null 2>&1 || die "Docker daemon が起動していません。"

  local compose gpu service
  compose="$(compose_cmd)"
  gpu="$(env_value TET_GPU_ENABLED || printf '0')"

  if [[ "$gpu" == "1" ]]; then
    service="tet-core-gpu"
    bold "Starting TET Core with GPU profile..."
    $compose stop tet-core >/dev/null 2>&1 || true
    COMPOSE_PROFILES=gpu $compose up -d --build "$service"
  else
    service="tet-core"
    warn "CPU modeで起動します。Real ZK proving は非常に遅くなる可能性があります。"
    $compose stop tet-core-gpu >/dev/null 2>&1 || true
    $compose up -d --build "$service"
  fi

  bold "TET node started."
  printf 'REST UI: http://127.0.0.1:%s/status\n' "$(env_value PORT || printf '5010')"
  printf 'Logs:    %s logs -f %s\n' "$compose" "$service"
}

main "$@"
