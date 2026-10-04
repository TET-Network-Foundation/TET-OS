#!/usr/bin/env bash
# seed-healthcheck.sh — one-minute liveness probe for the TET public seed.
#
# Installed by deploy/provision-seed.sh as a systemd timer. Run by hand with:
#     TET_HC_URL=... bash deploy/seed-healthcheck.sh
#
# ---------------------------------------------------------------------------
# WHY THE PING IS ON SUCCESS, NOT ON FAILURE
#
# healthchecks.io is a dead-man's switch: it alerts when expected pings STOP.
# Pinging only when something is wrong cannot detect the failures that matter
# most — power loss, kernel panic, a full disk, cron itself not running — because
# a dead box sends nothing and silence would mean "fine". So: ping on every
# healthy minute, and use the /fail endpoint to raise a detected problem
# immediately rather than waiting out the grace period.
#
# Set the check's period to 1m and grace to 5m.
#
# A SUCCESS PING MEANS "THE CHAIN MOVED", NOTHING LESS
#
# Until 2026-10-04 an unchanged height inside the stall window also pinged success, and a ping
# that healthchecks.io rejected was thrown away (`>/dev/null 2>&1 || true`). Now:
#   - success is pinged only when this run sees the height ADVANCE past the last one it recorded;
#     the first run only records a baseline, and a flat height inside the window pings nothing
#     (the check's grace period turns that silence red if it lasts);
#   - every failure path pings /fail with its reason;
#   - every ping's answer is checked, and anything but "OK" is logged as PING NOT ACCEPTED;
#   - a monitor that differs from the deployed tree's copy reports itself red. Both seeds ran a
#     copy installed weeks earlier, because only provision-seed.sh ever installed it.
# See docs/postmortems/2026-10-04-producer-wedge-33h.md.
# ---------------------------------------------------------------------------
set -uo pipefail

HC_URL="${TET_HC_URL:-}"                      # healthchecks.io check URL, no trailing slash
NODE="${TET_HC_NODE:-http://127.0.0.1:5010}"
CONTAINER="${TET_HC_CONTAINER:-tet-core-mainnet}"
STALL_SEC="${TET_HC_STALL_SEC:-300}"          # height must advance within this window
DISK_PCT_MAX="${TET_HC_DISK_PCT_MAX:-90}"
COMPOSE_DIR="${TET_HC_COMPOSE_DIR:-/opt/TET-OS}"
STATE_DIR="${TET_HC_STATE_DIR:-/var/lib/tet-healthcheck}"
RESTART_COOLDOWN_SEC="${TET_HC_RESTART_COOLDOWN_SEC:-3600}"

# May this node restart itself when its height stalls? Default yes, which is right for a BLOCK
# PRODUCER: if Helsinki stops advancing, Helsinki is the thing that is broken.
#
# Set 0 on a NON-PRODUCING node. A follower's height stalls when THE PRODUCER stops, and
# restarting the follower fixes nothing — it just churns the container once an hour and buries the
# real signal, which is that the producer is down. Nuremberg runs with 0 for exactly this reason.
ALLOW_RESTART="${TET_HC_ALLOW_RESTART:-1}"

mkdir -p "$STATE_DIR"
HEIGHT_FILE="$STATE_DIR/last_height"
SEEN_FILE="$STATE_DIR/last_change_epoch"
RESTART_FILE="$STATE_DIR/last_restart_epoch"
now=$(date +%s)

ping_hc() {  # $1 = "" | "/fail" | "/start" ; $2 = body
  if [ -z "$HC_URL" ]; then
    echo "NOTE: TET_HC_URL is not set; nothing was reported" >&2
    return 0
  fi
  local out
  # healthchecks.io answers 200 "OK". Anything else (a wrong check UUID is 404 "not found", a
  # network failure is curl's own error) means the check did NOT get this ping, and silence here
  # is how a dead node can sit behind a green check.
  out=$(curl -sS -m 10 --retry 3 -w ' HTTP%{http_code}' --data-raw "${2:-}" "${HC_URL}${1:-}" 2>&1) || true
  if [ "$out" != "OK HTTP200" ]; then
    echo "PING NOT ACCEPTED (${1:-success}): $out" >&2
  fi
}

fail() { echo "UNHEALTHY: $*"; ping_hc "/fail" "$*"; exit 1; }

# The copy systemd runs is installed once, by provision-seed.sh; a deploy only refreshes the tree.
# If the two differ, the monitor is running logic the repository no longer has.
stale_monitor=""
deployed_copy="$COMPOSE_DIR/deploy/seed-healthcheck.sh"
if [ -f "$deployed_copy" ] && ! cmp -s "$0" "$deployed_copy"; then
  stale_monitor="$0 differs from $deployed_copy (reinstall: install -m 0755 $deployed_copy $0)"
fi

# --- 1. container ----------------------------------------------------------
status=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)
[ "$status" = healthy ] || fail "container $CONTAINER health=$status"

# --- 2. disk ---------------------------------------------------------------
# A sled-backed node dies quietly on a full disk; this is the cheapest guard.
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "${disk:-0}" -lt "$DISK_PCT_MAX" ] || fail "disk ${disk}% >= ${DISK_PCT_MAX}%"

# --- 3. chain progress -----------------------------------------------------
state=$(curl -fsS -m 10 "$NODE/ledger/state" 2>/dev/null) || fail "REST /ledger/state unreachable"
height=$(printf '%s' "$state" | jq -r '.block_height // empty')
[ -n "$height" ] || fail "no block_height in /ledger/state: $state"

last_height=$(cat "$HEIGHT_FILE" 2>/dev/null || echo "")
last_change=$(cat "$SEEN_FILE" 2>/dev/null || echo "$now")

if [ -z "$last_height" ]; then
  # First run (or the state dir was wiped): nothing to compare against, so this is a baseline,
  # not evidence of progress. No ping; the next run decides.
  echo "$height" > "$HEIGHT_FILE"
  echo "$now"    > "$SEEN_FILE"
  echo "BASELINE height=$height (no ping until the height advances)"
  exit 0
fi

if [ "$height" != "$last_height" ]; then
  echo "$height" > "$HEIGHT_FILE"
  echo "$now"    > "$SEEN_FILE"
  if [ -n "$stale_monitor" ]; then
    fail "node OK at height $height, but this monitor is stale: $stale_monitor"
  fi
  ping_hc "" "height=$height mempool=$(printf '%s' "$state" | jq -r '.mempool_len') disk=${disk}%"
  echo "OK height=$height"
  exit 0
fi

stalled_for=$(( now - last_change ))
if [ "$stalled_for" -lt "$STALL_SEC" ]; then
  # Not yet a stall, and not progress either: no ping. A 12 s block time makes a flat minute
  # rare; if it lasts, the check's grace period turns the silence red before STALL_SEC does.
  echo "WAITING height=$height unchanged ${stalled_for}s (no ping)"
  exit 0
fi

# --- 4. stalled: alert, and restart at most once an hour -------------------
# The cooldown matters. If the node is stalled by a consensus defect rather than
# a transient, restarting every five minutes destroys the evidence and produces
# an endless alert stream. Alert every time; restart rarely.
if [ "$ALLOW_RESTART" != "1" ]; then
  # Alert, do not act. On a follower a stall means the producer stopped; this node restarting
  # would be noise standing in for a diagnosis.
  fail "height $height stalled ${stalled_for}s; this node does not produce blocks, so NOT restarting (check the producer)"
fi

last_restart=$(cat "$RESTART_FILE" 2>/dev/null || echo 0)
since_restart=$(( now - last_restart ))

if [ "$since_restart" -lt "$RESTART_COOLDOWN_SEC" ]; then
  fail "height $height stalled ${stalled_for}s; NOT restarting (last restart ${since_restart}s ago, cooldown ${RESTART_COOLDOWN_SEC}s) — investigate"
fi

echo "$now" > "$RESTART_FILE"
ping_hc "/fail" "height $height stalled ${stalled_for}s — restarting tet-core"
cd "$COMPOSE_DIR" || fail "compose dir $COMPOSE_DIR missing"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.dev.yml -f deploy/docker-compose.seed.yml)
# if/else rather than `A && B || C`. fail() exits, so the old form was correct -- but it is the
# shape SC2015 exists to catch, and a reader has to know fail() exits to see that it is not a bug.
if "${COMPOSE[@]}" restart tet-core >/dev/null 2>&1; then
  fail "restarted tet-core after ${stalled_for}s stall at height $height"
else
  fail "restart FAILED after ${stalled_for}s stall at height $height"
fi
