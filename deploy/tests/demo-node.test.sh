#!/usr/bin/env bash
# Tests for the demo node's deploy (docs/DEMO_NODE.md), run by CI's shell job:
#     bash deploy/tests/demo-node.test.sh
#
# 1. provision-seed.sh refuses a demo role that would not be a safe follower, before it touches the
#    host (the refusals run before the root check, so this needs no root).
# 2. The composed demo config exposes exactly what the design says: Caddy on 80/443, tet-core only on
#    127.0.0.1 (REST) and 8002 (P2P), the UI not at all; public mode on; the trusted-proxy range is the
#    pinned compose subnet; the Caddyfile does not trust client X-Forwarded-For.
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

# The seeds' composition is untouched: REST on loopback, no Caddy.
seed=$(compose_json deploy/docker-compose.seed.yml)
if python3 -c 'import json,sys; c=json.loads(sys.argv[1]); s=c["services"]; sys.exit(0 if "caddy" not in s and any(str(p.get("host_ip"))=="127.0.0.1" and str(p.get("published"))=="5010" for p in s["tet-core"]["ports"]) else 1)' "$seed"; then
  pass "the seed composition is unchanged"
else flunk "the seed composition is unchanged"; fi

echo
if [ "$failed" -eq 0 ]; then echo "all passed"; exit 0; else echo "$failed FAILED"; exit 1; fi
