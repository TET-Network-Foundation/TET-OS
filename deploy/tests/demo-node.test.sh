#!/usr/bin/env bash
# Tests for the demo node's deploy (docs/DEMO_NODE.md), run by CI's shell job:
#     bash deploy/tests/demo-node.test.sh
#
# 1. provision-seed.sh refuses a demo role that would not be a safe follower, before it touches the
#    host (the refusals run before the root check, so this needs no root).
# 2. The composed demo config exposes exactly what the design says: Caddy on 80/443, tet-core only on
#    127.0.0.1 (REST) and 8002 (P2P), the UI not at all; public mode on; the trusted-proxy range is the
#    pinned compose subnet; the Caddyfile does not trust client X-Forwarded-For.
# 3. Caddy enforces the same allow-list as tet-core (a second, independent layer), refuses the UI's
#    own /api/* routes, and serves only the /try page; provision starts Caddy only after tet-core
#    proves it is in public mode. (Commit security review of #37.)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

failed=0
pass()  { echo "ok   $1"; }
flunk() { echo "FAIL $1${2:+ — $2}"; failed=$((failed + 1)); }

refuses() {  # NAME EXPECTED-MESSAGE ENV...
  local name="$1" want="$2"; shift 2
  local out
  out=$(env -i PATH="$PATH" "$@" bash deploy/provision-seed.sh 2>&1); local rc=$?
  if [ "$rc" -ne 0 ] && grep -q -- "$want" <<<"$out"; then pass "provision refuses: $name"
  else flunk "provision refuses: $name" "rc=$rc out=$(tail -1 <<<"$out")"; fi
}
BOOT=/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC
refuses "demo without bootnodes" "a demo node follows the seeds" TET_NODE_ROLE=demo TET_DEMO_DOMAIN=try.example.org
refuses "demo without a domain"  "set TET_DEMO_DOMAIN"          TET_NODE_ROLE=demo TET_BOOTNODES="$BOOT"
refuses "demo that would mine"   "never produces blocks"        TET_NODE_ROLE=demo TET_BOOTNODES="$BOOT" TET_DEMO_DOMAIN=try.example.org TET_AUTO_MINE=1
refuses "an unknown role"        "must be seed or demo"         TET_NODE_ROLE=validator

compose_json() { docker compose -f docker-compose.yml -f "$1" config --format json 2>&1; }

json=$(TET_DEMO_DOMAIN=try.example.org compose_json deploy/demo/docker-compose.demo.yml)
if ! python3 - "$json" <<'PY'
import json, sys
cfg = json.loads(sys.argv[1]); s = cfg["services"]; bad = []
def ports(svc):
    return sorted((str(p.get("host_ip", "")), str(p.get("published", "")), str(p.get("target")))
                  for p in s[svc].get("ports", []))
if ports("tet-core") != [("", "8002", "8002"), ("127.0.0.1", "5010", "5010")]:
    bad.append(f"tet-core ports {ports('tet-core')}")
if ports("ui"):
    bad.append(f"ui is published {ports('ui')}")
if [p[1] for p in ports("caddy")] != ["443", "80"] or any(p[0] for p in ports("caddy")):
    bad.append(f"caddy ports {ports('caddy')}")
env = s["tet-core"]["environment"]
if env.get("TET_PUBLIC_API") != "1":
    bad.append("public mode is off")
if env.get("TET_AUTO_MINE") != "0":
    bad.append("the demo node would mine")
subnets = [c["subnet"] for c in cfg["networks"]["default"]["ipam"]["config"]]
if env.get("TET_PUBLIC_TRUSTED_PROXIES") not in subnets:
    bad.append(f"trusted proxies {env.get('TET_PUBLIC_TRUSTED_PROXIES')} is not the pinned subnet {subnets}")
for b in bad: print("   ", b)
sys.exit(1 if bad else 0)
PY
then flunk "the composed demo config exposes only what the design says"
else pass "the composed demo config exposes only what the design says"; fi

# Captured first: compose exits non-zero here (that is the point), which pipefail would carry.
nodomain=$(env -u TET_DEMO_DOMAIN docker compose -f docker-compose.yml -f deploy/demo/docker-compose.demo.yml config --format json 2>&1)
if grep -q "set TET_DEMO_DOMAIN" <<<"$nodomain"; then
  pass "compose refuses a demo config without a domain"
else flunk "compose refuses a demo config without a domain"; fi

if grep -v '^\s*#' deploy/demo/Caddyfile | grep -q 'trusted_proxies'; then
  flunk "the Caddyfile must not trust client X-Forwarded-For (trusted_proxies)"
else pass "the Caddyfile does not trust client X-Forwarded-For"; fi

# Caddy enforces tet-core's allow-list on its own: same (method, path) set as PUBLIC_ALLOWLIST.
if python3 - <<'PY'
import re, sys
rs = open("tet-core/src/rest/public_api.rs").read()
blk = rs[rs.index("pub const PUBLIC_ALLOWLIST"):]
blk = blk[:blk.index("];")]
want = {(m, re.sub(r":[^/]+", ":", p)) for m, p in re.findall(r'\("([A-Z]+)",\s*"([^"]+)"\)', blk)}
cf = open("deploy/demo/Caddyfile").read()
got = set()
for m, rx in re.findall(r'\{method\} == "([A-Z]+)" && \{path\}\.matches\("\^/tet-node-api(.*?)\$"\)', cf):
    got.add((m, rx.replace("[^/%]+", ":").replace("\\", "")))
if want != got:
    print("    only in tet-core:", sorted(want - got)); print("    only in Caddy:", sorted(got - want))
    sys.exit(1)
PY
then pass "Caddy's allow-list equals tet-core's PUBLIC_ALLOWLIST"
else flunk "Caddy's allow-list equals tet-core's PUBLIC_ALLOWLIST"; fi

if grep -q 'die "tet-core is not in public mode' deploy/provision-seed.sh \
   && awk '/Public mode check/{c=1} c && /up -d caddy/{ok=1} END{exit !ok}' deploy/provision-seed.sh; then
  pass "provision starts Caddy only after tet-core proves public mode"
else flunk "provision starts Caddy only after tet-core proves public mode"; fi

# The real Caddyfile in front of a stub upstream, with real requests. Needs a Docker daemon: CI has
# one; a laptop without one skips (and says so) rather than passing silently.
if docker info >/dev/null 2>&1; then
  net=tet-demo-test-$$
  docker network create "$net" >/dev/null
  docker run -d --rm --name "ui-$$" --network "$net" --network-alias ui caddy:2.8 \
    caddy respond --listen :3000 --body upstream >/dev/null
  docker run -d --rm --name "edge-$$" --network "$net" -p 127.0.0.1:18080:8080 \
    -e TET_DEMO_DOMAIN=":8080" -e TET_DEMO_ACME_EMAIL="" \
    -v "$PWD/deploy/demo/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.8 >/dev/null
  for _ in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:18080/try && break; sleep 1; done
  code() { curl -s -o /dev/null -w "%{http_code}" -X "$1" "http://127.0.0.1:18080$2"; }
  expect() {  # METHOD PATH WANT
    local got; got=$(code "$1" "$2")
    if [ "$got" = "$3" ]; then pass "caddy: $1 $2 → $3"; else flunk "caddy: $1 $2 → $3" "got $got"; fi
  }
  expect GET    /tet-node-api/status 200
  expect POST   /tet-node-api/tmail/send 200
  expect GET    /tet-node-api/tmail/inbox/abababab 200
  expect POST   /tet-node-api/ledger/mine 404
  expect POST   /tet-node-api/execute 404
  expect GET    /tet-node-api/metrics 404
  expect GET    /tet-node-api/ledger/state/ 404
  expect GET    /tet-node-api/tmail/inbox/a%2Fb 404
  expect GET    /tet-node-api/tmail/anon/path/abababab 404
  expect GET    /api/ollama/tags 404
  expect POST   /api/tet/infer_signed 404
  expect GET    /os 404
  expect GET    /try 200
  expect GET    /_next/static/chunk.js 200
  expect GET    / 302
  docker rm -f "edge-$$" "ui-$$" >/dev/null 2>&1; docker network rm "$net" >/dev/null 2>&1
elif [ -n "${CI:-}" ]; then
  flunk "caddy behaviour" "no Docker daemon in CI"
else
  echo "SKIP caddy behaviour: no Docker daemon here (CI runs it)"
fi

# The seeds' composition is untouched: REST on loopback, no Caddy.
seed=$(compose_json deploy/docker-compose.seed.yml)
if python3 -c 'import json,sys; c=json.loads(sys.argv[1]); s=c["services"]; sys.exit(0 if "caddy" not in s and any(str(p.get("host_ip"))=="127.0.0.1" and str(p.get("published"))=="5010" for p in s["tet-core"]["ports"]) else 1)' "$seed"; then
  pass "the seed composition is unchanged"
else flunk "the seed composition is unchanged"; fi

echo
if [ "$failed" -eq 0 ]; then echo "all passed"; exit 0; else echo "$failed FAILED"; exit 1; fi
