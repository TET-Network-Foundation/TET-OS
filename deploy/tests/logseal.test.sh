#!/usr/bin/env bash
# Tests for deploy/logseal/tet-logseal, run by CI's shell job:  bash deploy/tests/logseal.test.sh
#
# The tool reads files, talks to docker (image, binary hash, log path) and to the node. Docker is a
# stub on PATH that answers from FAKE_* variables; the node is unreachable unless a case starts a
# stub for it, and a stub healthchecks.io records what it was sent. Each guarantee in the tool's
# header has a case, and each case that could pass vacuously has a negative control next to it.
set -uo pipefail
export PYTHONDONTWRITEBYTECODE=1  # the test imports the tool; keep the source folder clean
cd "$(dirname "$0")/../.." || exit 1
TOOL="$PWD/deploy/logseal/tet-logseal"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; [ -n "${HCPID:-}" ] && kill "$HCPID" 2>/dev/null' EXIT
failed=0
pass() { echo "ok   $1"; }
flunk() { echo "FAIL $1"; [ -n "${2:-}" ] && echo "     $2"; failed=$((failed + 1)); }

# --- a fake host -----------------------------------------------------------------------------
mkdir -p "$WORK/bin" "$WORK/tree/deploy" "$WORK/etc"
cat > "$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
case "$1 ${4:-}" in
  "inspect {{.Image}}") echo "${FAKE_IMAGE:-sha256:aaaa}" ;;
  "inspect {{.LogPath}}") echo "$FAKE_LOG" ;;
esac
if [ "$1" = exec ]; then echo "${FAKE_BINARY:-bbbb}  /usr/local/bin/TET-Core"; fi
EOF
chmod +x "$WORK/bin/docker"
export PATH="$WORK/bin:$PATH" FAKE_LOG="$WORK/node.log"
SECRET_VALUE="s3cr3t-$(date +%s)-value-never-in-a-seal"
printf 'TET_CHAIN_ID=tet-local-dev\nTET_ADMIN_API_KEY=%s\nTET_DEMO_SPONSOR_MNEMONIC_FILE=/run/x\n' "$SECRET_VALUE" > "$WORK/tree/.env"
echo "services: {}" > "$WORK/tree/docker-compose.yml"
echo "port 22" > "$WORK/etc/sshd_config"
printf '{"log":"block 1\\n"}\n' > "$WORK/node.log"
export TET_LOGSEAL_STATE="$WORK/state" TET_LOGSEAL_TREE="$WORK/tree" TET_LOGSEAL_HOST=test \
  TET_LOGSEAL_NODE="http://127.0.0.1:9" TET_LOGSEAL_FILES="{tree}/.env:env,{tree}/docker-compose.yml,$WORK/etc/sshd_config,$WORK/etc/absent" \
  TET_LOGSEAL_STAMP_EVERY_SEC=999999999 TET_HC_URL=""
seal() { find "$WORK/state/seals" -name '*.json' -exec basename {} \; | sort | sed -n "${1}p"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
# field N KEY [KEY…]: one value of seal N, by key path (no code evaluated).
field() { local n=$1; shift; python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2:]: d=d[k]
print(d)" "$WORK/state/seals/$(seal "$n")" "$@"; }

# --- 1. seals form a chain -----------------------------------------------------------------------
"$TOOL" run > "$WORK/out1" 2>&1
"$TOOL" run > "$WORK/out2" 2>&1
if [ "$(field 1 "prev")" = None ] && [ "$(field 2 "prev")" = "$(sha "$WORK/state/seals/$(seal 1)")" ] && [ "$(field 2 "seq")" = 2 ]; then
  pass "each seal names the SHA-256 of the one before it"
else flunk "each seal names the SHA-256 of the one before it" "$(cat "$WORK/out2")"; fi
if [ "$(field 1 config "$WORK/etc/absent")" = absent ]; then pass "a missing file is recorded as absent"; else flunk "a missing file is recorded as absent"; fi

# --- 2. no secret value ever leaves the env file -------------------------------------------------
if ! grep -rq -- "$SECRET_VALUE" "$WORK/state" "$WORK/out1" "$WORK/out2"; then pass "SECURITY: a secret value appears in no seal, state file or output"; else flunk "SECURITY: a secret value appears in no seal, state file or output"; fi
redacted=$(python3 -c "
import importlib.machinery,importlib.util,sys
l=importlib.machinery.SourceFileLoader('ls',sys.argv[1]); s=importlib.util.spec_from_loader('ls',l); m=importlib.util.module_from_spec(s); l.exec_module(m)
print(m.redact_env(open(sys.argv[2]).read()))" "$TOOL" "$WORK/tree/.env")
if grep -q '^TET_ADMIN_API_KEY=<redacted>$' <<<"$redacted" && grep -q '^TET_DEMO_SPONSOR_MNEMONIC_FILE=<redacted>$' <<<"$redacted" && grep -q '^TET_CHAIN_ID=tet-local-dev$' <<<"$redacted"; then
  pass "secret values are replaced; other values and every key stay"
else flunk "secret values are replaced; other values and every key stay" "$redacted"; fi
# Control: the same file hashed without redaction gives a different config hash, so the check bites.
if [ "$(field 1 config "$WORK/tree/.env")" != "$(sha "$WORK/tree/.env")" ]; then pass "control: the recorded .env hash is not the raw file's"; else flunk "control: the recorded .env hash is not the raw file's"; fi

# --- 3. an unaccepted change is reported, and only then -------------------------------------------
python3 -m http.server --help >/dev/null 2>&1
cat > "$WORK/hc.py" <<'EOF'
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n).decode()
        open(sys.argv[2], "a").write(f"{self.path} {body}\n"); self.send_response(200); self.end_headers(); self.wfile.write(b"OK")
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
EOF
PORT=$((20000 + RANDOM % 20000)); python3 "$WORK/hc.py" "$PORT" "$WORK/hc.calls" & HCPID=$!
for _ in $(seq 1 50); do (echo > "/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && break; sleep 0.1; done
export TET_HC_URL="http://127.0.0.1:$PORT/check"
"$TOOL" accept > /dev/null
"$TOOL" run > "$WORK/out3" 2>&1
if ! grep -q CHANGED "$WORK/out3" && [ ! -s "$WORK/hc.calls" ]; then pass "no change since accept: no alert"; else flunk "no change since accept: no alert" "$(cat "$WORK/out3" "$WORK/hc.calls" 2>/dev/null)"; fi
echo "port 2222" > "$WORK/etc/sshd_config"
FAKE_BINARY=cccc "$TOOL" run > "$WORK/out4" 2>&1
if grep -q "CHANGED: .*sshd_config" "$WORK/out4" && grep -q "binary" "$WORK/out4" && grep -q '^/check/fail log seal (test): changed since the last accepted seal: .*sshd_config' "$WORK/hc.calls"; then
  pass "a changed config file and binary are reported to healthchecks.io as a failure, by name"
else flunk "a changed config file and binary are reported to healthchecks.io as a failure, by name" "$(cat "$WORK/out4" "$WORK/hc.calls" 2>/dev/null)"; fi
if ! grep -q -- "port 2222" "$WORK/hc.calls" "$WORK/out4"; then pass "an alert names what changed, never its content"; else flunk "an alert names what changed, never its content"; fi
FAKE_BINARY=cccc "$TOOL" accept > /dev/null; : > "$WORK/hc.calls"
FAKE_BINARY=cccc "$TOOL" run > "$WORK/out5" 2>&1
if ! grep -q CHANGED "$WORK/out5" && [ ! -s "$WORK/hc.calls" ]; then pass "after accept (a deploy), the new config is expected"; else flunk "after accept (a deploy), the new config is expected" "$(cat "$WORK/out5")"; fi
export TET_HC_URL=""

# --- 4. the log since the last seal, and a copy that can be re-checked ----------------------------
printf '{"log":"block 2\\n"}\n{"log":"block 3\\n"}\n' >> "$WORK/node.log"
"$TOOL" run > /dev/null 2>&1
last=$(find "$WORK/state/seals" -name '*.json' | wc -l | tr -d ' ')
from=$(field "$last" "log" "from"); to=$(field "$last" "log" "to")
expect=$(tail -c +"$((from + 1))" "$WORK/node.log" | head -c "$((to - from))" | shasum -a 256 | cut -d' ' -f1)
if [ "$(field "$last" "log" "sha256")" = "$expect" ] && [ "$to" = "$(wc -c < "$WORK/node.log" | tr -d ' ')" ]; then
  pass "a seal hashes exactly the log bytes written since the previous one"
else flunk "a seal hashes exactly the log bytes written since the previous one"; fi
mv "$WORK/node.log" "$WORK/old.log"; printf '{"log":"new container\\n"}\n' > "$WORK/node.log"
"$TOOL" run > /dev/null 2>&1
last=$((last + 1))
if [ "$(field "$last" "log" "from")" = 0 ] && [ "$(field "$last" "log" "new_file")" = True ]; then pass "a new log file (a new container) starts from 0 and says so"; else flunk "a new log file (a new container) starts from 0 and says so"; fi

# --- 5. verify: the chain and the log copies; tampering is caught ---------------------------------
if "$TOOL" verify > "$WORK/v1" 2>&1 && grep -q "chain intact" "$WORK/v1"; then pass "verify: an untouched chain and its log copies check out"; else flunk "verify: an untouched chain and its log copies check out" "$(cat "$WORK/v1")"; fi
cp -r "$WORK/state" "$WORK/state.bak"
python3 - "$WORK/state/seals/$(seal 2)" <<'EOF'
import sys; p=sys.argv[1]; b=open(p,'rb').read(); open(p,'wb').write(b.replace(b'"host":"test"', b'"host":"tset"'))
EOF
if ! "$TOOL" verify > "$WORK/v2" 2>&1 && grep -q "BROKEN" "$WORK/v2"; then pass "control: an edited old seal breaks the chain"; else flunk "control: an edited old seal breaks the chain" "$(cat "$WORK/v2")"; fi
rm -rf "$WORK/state"; mv "$WORK/state.bak" "$WORK/state"
g=$(find "$WORK/state/log" -name '*.log.gz' -exec basename {} \; | sort | tail -1); printf 'x' | gzip > "$WORK/state/log/$g"
if ! "$TOOL" verify > "$WORK/v3" 2>&1 && grep -q "stored log copy does not match" "$WORK/v3"; then pass "control: an altered log copy is caught"; else flunk "control: an altered log copy is caught" "$(cat "$WORK/v3")"; fi

# --- 6. no node: a seal is still written, nothing is stamped, nothing crashes ---------------------
TET_LOGSEAL_STAMP_EVERY_SEC=0 "$TOOL" run > "$WORK/out6" 2>&1; rc=$?
if [ "$rc" = 0 ] && grep -q "stamp skipped: node not reachable" "$WORK/out6" && [ ! -f "$WORK/state/stamps.jsonl" ]; then pass "a stamp due while the node is down is skipped, the seal still written"; else flunk "a stamp due while the node is down is skipped, the seal still written" "$(cat "$WORK/out6")"; fi

# --- 7. a stamp counts as anchored only when the chain has that exact file-fee ---------------------
# The explorer's real answer shape (captured from a node): `tx` is the envelope, `tx.tx` the transaction.
anchored=$(python3 - "$TOOL" <<'EOF'
import importlib.machinery, importlib.util, sys
l = importlib.machinery.SourceFileLoader("ls", sys.argv[1]); s = importlib.util.spec_from_loader("ls", l)
m = importlib.util.module_from_spec(s); l.exec_module(m)
real = {"found": True, "canonical": True, "block_height": 46119, "tx_kind": "file_fee",
        "tx": {"v": 1, "tx": {"kind": "file_fee", "file_id": "5b7a09f7-3a5b-3137-6b40-7cb4f32b036e", "fee_micro": 1000},
               "sig": {}, "attestation": {}}}
flat = {"found": True, "canonical": True, "tx": {"kind": "file_fee", "file_id": "5b7a09f7-3a5b-3137-6b40-7cb4f32b036e"}}
print(m.stamp_tx_of(real).get("file_id"), m.stamp_tx_of(flat).get("file_id"))
EOF
)
if [ "$anchored" = "5b7a09f7-3a5b-3137-6b40-7cb4f32b036e None" ]; then pass "a stamp's transaction is read from the explorer's real answer (envelope inside), not a guessed shape"; else flunk "a stamp's transaction is read from the explorer's real answer" "$anchored"; fi

# --- 8. state is private ---------------------------------------------------------------------------
perm=$(stat -c %a "$WORK/state/seals/$(seal 1)" 2>/dev/null || stat -f %Lp "$WORK/state/seals/$(seal 1)")
if [ "$perm" = 600 ]; then pass "seals are written mode 600"; else flunk "seals are written mode 600" "mode $perm"; fi

if [ "$failed" -eq 0 ]; then echo "all passed"; exit 0; else echo "$failed FAILED"; exit 1; fi
