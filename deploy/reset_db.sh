#!/usr/bin/env bash
# shellcheck disable=SC2029
# Every ssh command below interpolates $DB_PATH CLIENT-side on purpose. The path is the argument
# the operator typed and that this script has already validated (absolute, not deny-listed,
# confirmed twice). Expanding it on the server instead would hand the server the decision about
# what gets deleted, which is the opposite of what this script is for.
#
# Destroy a node's ledger and restart it from an empty database.
#
# This is the most dangerous script in the repository. It is also, as of 2026-09-29, one that
# had never been tested by anything and whose hardcoded path was WRONG: it deleted
# /var/lib/tet-node/*, which is a systemd layout the seed stopped using when it moved to Docker.
# On the current seed it would have deleted nothing, reported success, and restarted the node —
# leaving the operator believing the chain had been reset when it had not.
#
# Two changes follow from that:
#
#   1. The database path is no longer guessed. It is named explicitly by the caller, echoed back,
#      and verified to exist on the server before anything is stopped.
#   2. Confirmation is a FLAG, not a prompt. `read -r -p` looks like a safeguard and is not one:
#      it is skipped entirely when stdin is not a terminal, so `yes | ./reset_db.sh 1.2.3.4` or
#      any CI invocation sailed straight through it. A flag cannot be satisfied by accident.
#
# Usage:
#   ./reset_db.sh --server <IP> --db-path <ABSOLUTE PATH> --yes-delete-the-ledger-at <SAME PATH>
#
# The path is given twice on purpose. The second occurrence is the confirmation, and it must match
# the first exactly — so the destructive argument is the one you have to type deliberately, and a
# copy-pasted command from a chat log will not run against the wrong host.

set -euo pipefail

die() { echo "[reset-db] ERROR: $*" >&2; exit 1; }

SERVER_IP=""
DB_PATH=""
CONFIRM_PATH=""
SERVICE="tet-node"
RESTART=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)                     SERVER_IP="${2:-}"; shift 2 ;;
    --db-path)                    DB_PATH="${2:-}"; shift 2 ;;
    --yes-delete-the-ledger-at)   CONFIRM_PATH="${2:-}"; shift 2 ;;
    --service)                    SERVICE="${2:-}"; shift 2 ;;
    --no-restart)                 RESTART=0; shift ;;
    -h|--help)                    sed -n '2,30p' "$0"; exit 0 ;;
    *)                            die "unknown argument: $1" ;;
  esac
done

[[ -n "$SERVER_IP" ]] || die "--server is required"
[[ -n "$DB_PATH" ]]   || die "--db-path is required"

if [[ -z "$CONFIRM_PATH" ]]; then
  die "refusing to delete anything.
  This script needs --yes-delete-the-ledger-at '<path>' naming the SAME path as --db-path.
  Intended:  $0 --server $SERVER_IP --db-path '$DB_PATH' --yes-delete-the-ledger-at '$DB_PATH'"
fi

if [[ "$CONFIRM_PATH" != "$DB_PATH" ]]; then
  die "confirmation does not match.
  --db-path                  : $DB_PATH
  --yes-delete-the-ledger-at : $CONFIRM_PATH
  These must be identical. Refusing, because a mismatch is how the wrong host gets wiped."
fi

# Absolute, and not a path whose deletion would take the machine with it. `rm -rf` on any of
# these is not a ledger reset, it is an outage, and the old script's `rm -rf ${VAR}/*` would have
# expanded to exactly that had the variable ever been empty.
case "$DB_PATH" in
  /|/root|/root/|/var|/var/|/var/lib|/var/lib/|/data|/data/|/home|/home/|/etc|/etc/|/usr|/usr/)
    die "refusing to delete '$DB_PATH' — that is not a ledger directory" ;;
  /*) ;;
  *)  die "--db-path must be absolute (got '$DB_PATH')" ;;
esac

REMOTE="root@${SERVER_IP}"

echo "[reset-db] server   : ${SERVER_IP}"
echo "[reset-db] db path  : ${DB_PATH}"
echo "[reset-db] service  : ${SERVICE}"
echo "[reset-db] restart  : $([[ "$RESTART" -eq 1 ]] && echo yes || echo no)"

# Verify the path EXISTS before stopping anything. The stale-path bug is only silent if nobody
# looks; this looks.
if ! ssh "$REMOTE" "test -e '${DB_PATH}'"; then
  die "'${DB_PATH}' does not exist on ${SERVER_IP}.
  Nothing has been stopped or deleted. Check the path — the node may store its ledger elsewhere
  (a Docker volume, for instance, rather than a host directory)."
fi

echo "[reset-db] contents about to be deleted:"
ssh "$REMOTE" "ls -la '${DB_PATH}' | head -20" || true

echo "[reset-db] stopping ${SERVICE}..."
ssh "$REMOTE" "systemctl stop '${SERVICE}' || true"

echo "[reset-db] deleting ${DB_PATH}/* ..."
# Quoted and guarded: an empty DB_PATH cannot reach this line, and the trailing /* is applied to
# a path that has already been checked against the deny-list above.
ssh "$REMOTE" "set -euo pipefail; test -n '${DB_PATH}'; rm -rf -- '${DB_PATH}'/*"

if [[ "$RESTART" -eq 1 ]]; then
  echo "[reset-db] restarting ${SERVICE}..."
  ssh "$REMOTE" "systemctl restart '${SERVICE}'; systemctl status '${SERVICE}' --no-pager || true"
else
  echo "[reset-db] --no-restart given; ${SERVICE} left stopped."
fi

echo "[reset-db] done. ${SERVER_IP} has an empty ledger at ${DB_PATH}."
