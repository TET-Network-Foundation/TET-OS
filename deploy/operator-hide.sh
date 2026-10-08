#!/usr/bin/env bash
# Operator hide on the demo node (tet-core/src/operator_hide.rs): stop serving a board, post or file
# on this node's public routes. Node-local; never touches chain data; every use is logged to
# /data/operator.log inside the node's volume (and the node log).
#
#   deploy/operator-hide.sh hide   wallet <64-hex wallet id>  "reason"   # a board, or a poster
#   deploy/operator-hide.sh hide   msg    <msg_id>            "reason"   # one post
#   deploy/operator-hide.sh hide   file   <file uuid>         "reason"
#   deploy/operator-hide.sh unhide <kind> <id>                "reason"
#   deploy/operator-hide.sh list
#   deploy/operator-hide.sh log                                          # the operator log
#
# A thread: list its posts' msg_ids on your own machine with the board's invite
# (tet-network/ui/scripts/operator_thread_ids.mjs), then hide each msg_id.
#
# The request runs inside the node's container (docker exec), so it comes from loopback, and the
# admin key is read from the container's own environment (TET_ADMIN_API_KEY in .env): it is never
# typed here or shown.
set -euo pipefail

CONTAINER="${TET_CONTAINER:-tet-core-mainnet}"
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

json_str() {  # escape for a JSON string
  local s="$1"
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/ }; s=${s//$'\r'/ }; s=${s//$'\t'/ }
  printf '"%s"' "$s"
}

call() {  # METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  if [ "$method" = GET ]; then
    # shellcheck disable=SC2016  # $TET_ADMIN_API_KEY expands inside the container, on purpose
    docker exec "$CONTAINER" sh -c 'wget -qO- --header "Authorization: Bearer $TET_ADMIN_API_KEY" "http://127.0.0.1:5010$1"' _ "$path"
  else
    # shellcheck disable=SC2016
    docker exec "$CONTAINER" sh -c 'wget -qO- --header "Authorization: Bearer $TET_ADMIN_API_KEY" --header "Content-Type: application/json" --post-data "$2" "http://127.0.0.1:5010$1"' _ "$path" "$body"
  fi
  echo
}

[ $# -ge 1 ] || usage
case "$1" in
  hide|unhide)
    [ $# -eq 4 ] || usage
    case "$2" in wallet|msg|file) ;; *) usage ;; esac
    [ -n "${4// /}" ] || { echo "a reason is required: it goes in the operator log" >&2; exit 2; }
    call POST "/operator/$1" "{\"kind\":$(json_str "$2"),\"id\":$(json_str "$3"),\"reason\":$(json_str "$4")}"
    ;;
  list) call GET /operator/hidden ;;
  log) docker exec "$CONTAINER" sh -c 'cat /data/operator.log 2>/dev/null || echo "(no operator log yet)"' ;;
  *) usage ;;
esac
