#!/usr/bin/env bash
# Tests for deploy/seed-healthcheck.sh, run by CI's shell job:  bash deploy/tests/seed-healthcheck.test.sh
#
# The script talks to docker, curl, df and date. Each is replaced by a stub on PATH that answers
# from FAKE_* variables and appends what it was asked to $CALLS, so a case can assert exactly which
# pings and which docker commands one run produced. jq and cmp are the real ones.
#
# The cases are the guarantees in the script's header: a dead node is RED (every failure path pings
# /fail with its reason), success means the height ADVANCED, a ping healthchecks.io rejects is
# logged rather than swallowed, and a stale installed copy reports itself.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../seed-healthcheck.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STUBS="$WORK/bin"
mkdir -p "$STUBS"
CALLS="$WORK/calls"
export CALLS

cat > "$STUBS/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  inspect) echo "${FAKE_HEALTH:-healthy}" ;;
  logs)    echo "DOCKER logs ${*:2}" >> "$CALLS"; echo "fake container log line" ;;
  compose) echo "COMPOSE ${*:2}" >> "$CALLS" ;;
  *)       echo "DOCKER $*" >> "$CALLS" ;;
esac
EOF
cat > "$STUBS/curl" <<'EOF'
#!/usr/bin/env bash
url="${*: -1}"; data=""
prev=""
for a in "$@"; do
  [ "$prev" = "--data-raw" ] && data="$a"
  prev="$a"
done
case "$url" in
  */ledger/state)
    [ "${FAKE_REST:-up}" = up ] || exit 7
    printf '{"block_height":%s,"mempool_len":0}' "${FAKE_HEIGHT:-100}" ;;
  *)
    echo "PING ${url#"$TET_HC_URL"} | $data" >> "$CALLS"
    printf '%s' "${FAKE_PING_REPLY:-OK HTTP200}" ;;
esac
EOF
cat > "$STUBS/df" <<'EOF'
#!/usr/bin/env bash
printf 'Use%%\n %s%%\n' "${FAKE_DISK:-40}"
EOF
cat > "$STUBS/date" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "+%s" ]; then echo "${FAKE_NOW:-1000000}"; else /bin/date "$@"; fi
EOF
chmod +x "$STUBS"/*

failed=0
pass() { echo "ok   $1"; }
flunk() { echo "FAIL $1"; echo "     --- output:"; sed 's/^/     /' "$WORK/out"; echo "     --- calls:"; sed 's/^/     /' "$CALLS" 2>/dev/null; failed=$((failed + 1)); }

# run STATE_NAME [VAR=value ...] — one probe run with a fresh calls log; state persists per name.
run() {
  local state="$WORK/state-$1"; shift
  : > "$CALLS"
  env PATH="$STUBS:$PATH" TET_HC_URL="https://hc.example/abc123" TET_HC_STATE_DIR="$state" \
      TET_HC_COMPOSE_DIR="$WORK/nonexistent" TET_HC_STALL_SEC=300 "$@" \
      bash "$SCRIPT" > "$WORK/out" 2>&1
  echo $? > "$WORK/rc"
}
pings()   { grep -c '^PING' "$CALLS" || true; }
has()     { grep -q -- "$1" "$CALLS"; }
outhas()  { grep -q -- "$1" "$WORK/out"; }
rc()      { cat "$WORK/rc"; }

# --- a dead node is red -----------------------------------------------------------------------
run dead FAKE_HEALTH=exited
if has 'PING /fail | container tet-core-mainnet health=exited' && [ "$(rc)" = 1 ]; then pass "container not healthy → /fail with the reason"; else flunk "container not healthy → /fail with the reason"; fi

run unreachable FAKE_REST=down
if has 'PING /fail | REST /ledger/state unreachable' && [ "$(rc)" = 1 ]; then pass "REST unreachable → /fail with the reason"; else flunk "REST unreachable → /fail with the reason"; fi

run disk FAKE_DISK=95
if has 'PING /fail | disk 95%'; then pass "disk full → /fail with the reason"; else flunk "disk full → /fail with the reason"; fi

# --- success means the height advanced ---------------------------------------------------------
run chain FAKE_HEIGHT=100 FAKE_NOW=1000
if [ "$(pings)" = 0 ] && outhas 'BASELINE height=100'; then pass "first run records a baseline and pings nothing"; else flunk "first run records a baseline and pings nothing"; fi

run chain FAKE_HEIGHT=100 FAKE_NOW=1060
if [ "$(pings)" = 0 ] && outhas 'WAITING height=100'; then pass "flat height inside the window pings nothing"; else flunk "flat height inside the window pings nothing"; fi

run chain FAKE_HEIGHT=105 FAKE_NOW=1120
if has 'PING  | height=105' && [ "$(pings)" = 1 ]; then pass "height advanced → one success ping"; else flunk "height advanced → one success ping"; fi

run chain FAKE_HEIGHT=105 FAKE_NOW=1500 TET_HC_ALLOW_RESTART=0
if has 'PING /fail | height 105 stalled 380s' && ! has '^COMPOSE'; then pass "stalled past the window → /fail (follower: no restart)"; else flunk "stalled past the window → /fail (follower: no restart)"; fi

# --- a rejected ping is not silent -------------------------------------------------------------
run unreachable2 FAKE_REST=down FAKE_PING_REPLY='not found HTTP404'
if outhas 'PING NOT ACCEPTED (/fail): not found HTTP404'; then pass "a ping healthchecks.io rejects is logged"; else flunk "a ping healthchecks.io rejects is logged"; fi

# --- a stale installed copy reports itself -----------------------------------------------------
mkdir -p "$WORK/tree/deploy"
echo "# a newer version" > "$WORK/tree/deploy/seed-healthcheck.sh"
run stale FAKE_HEIGHT=7 FAKE_NOW=1000 TET_HC_COMPOSE_DIR="$WORK/tree"
run stale FAKE_HEIGHT=8 FAKE_NOW=1060 TET_HC_COMPOSE_DIR="$WORK/tree"
if has 'PING /fail | node OK at height 8, but this monitor is stale'; then pass "installed copy differs from the deployed tree → /fail"; else flunk "installed copy differs from the deployed tree → /fail"; fi
cp "$SCRIPT" "$WORK/tree/deploy/seed-healthcheck.sh"
run stale FAKE_HEIGHT=9 FAKE_NOW=1120 TET_HC_COMPOSE_DIR="$WORK/tree"
if has 'PING  | height=9' && ! has '/fail'; then pass "installed copy matches the tree → success"; else flunk "installed copy matches the tree → success"; fi

echo
if [ "$failed" -eq 0 ]; then echo "all passed"; exit 0; else echo "$failed FAILED"; exit 1; fi
