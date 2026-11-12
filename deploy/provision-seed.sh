#!/usr/bin/env bash
# provision-seed.sh — turn a plain Ubuntu 24.04 host, at any provider, into a TET node.
#
#   scp genesis.json root@<host>:/etc/tet/genesis.json      # the chain's genesis file (see below)
#   ssh root@<host> 'cd /opt/TET-OS && TET_CHAIN_ID=<id> TET_NODE_ROLE=demo-producer … bash deploy/provision-seed.sh'
#
# Nothing here assumes a provider. What the provider must do is short and is printed as text at the
# end of every run (and listed in deploy/demo/README.md): an Ubuntu 24.04 host with a public IPv4 and
# IPv6 address, your SSH key, and a firewall in front of it that allows exactly the ports printed.
#
# Idempotent: every step checks before it acts, so re-running after a failure
# resumes rather than redoes. Safe to run twice.
#
# ---------------------------------------------------------------------------
# Getting the source onto the seed. Two modes, TET_SEED_SOURCE=push|clone.
#
# **push (default)** — the operator streams a tar of the tracked tree over the
# SSH session that is already open, and THE SEED HOLDS NO CREDENTIAL AT ALL:
#
#   COPYFILE_DISABLE=1 git archive --format=tar HEAD \
#     | ssh root@<host> 'mkdir -p /opt/TET-OS && tar -x -C /opt/TET-OS'
#
# COPYFILE_DISABLE=1 is not optional on macOS: bsdtar otherwise emits an
# AppleDouble `._<name>` sidecar per file carrying xattrs, which GNU tar on
# the seed extracts as 353 extra junk files into the Docker build context.
#
# For a box whose whole job is to accept connections from strangers on 8002,
# "no credential present" beats every scoped credential. `git archive HEAD`
# also ships only *tracked* files, so `deploy/secrets/`, `.env` and every
# build artifact stay on the workstation by construction. The cost is that
# the seed cannot update itself; re-run the push to deploy a new commit.
#
# **clone** — read-only deploy key, generated ON the seed (the private half is
# never transmitted), registered against the one repository:
#
#   gh repo deploy-key add <pubkey> --repo TET-Network-Foundation/TET-OS \
#     --title '<host>-seed (ro)'
#
# Use this if you want the seed to self-update. It needs deploy keys enabled
# for the repository — as of 2026-09-22 they are DISABLED org-wide on
# TET-Network-Foundation, and GitHub exposes no API to flip that, so it is a
# UI change under repo Settings -> Deploy keys before this mode will work.
#
# A personal access token is the option NOT offered here. The coarsest scope
# GitHub gives a classic PAT for cloning a private repo is `repo`, which is
# read AND WRITE to every repository the account can see — a public-facing
# seed would be holding a credential that can push to everything the founder
# owns. A fine-grained PAT (single repo, Contents: read) is defensible, but it
# is still an account-linked credential sitting on a public host, and it
# expires, which turns a working seed into a broken one on a date nobody
# remembers.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_SSH="${TET_SEED_REPO_SSH:-git@github.com:TET-Network-Foundation/TET-OS.git}"
REPO_BRANCH="${TET_SEED_REPO_BRANCH:-main}"
SEED_DIR="${TET_SEED_DIR:-/opt/TET-OS}"
DEPLOY_KEY="${TET_SEED_DEPLOY_KEY:-/root/.ssh/tet_os_deploy}"
SOURCE_MODE="${TET_SEED_SOURCE:-push}"   # push | clone — see header
# SSH listens on a non-default port (8443, also reachable from networks that block outbound 22).
# Port 22 stays open too until you have logged in on the new port once; then run this again with
# TET_SSH_KEEP_22=0 to close it. Closing 22 first, behind a provider firewall that doesn't allow
# 8443 yet, would lock you out.
SSH_PORT="${TET_SSH_PORT:-${TET_SEED_SSH_PORT:-8443}}"
SSH_EXTRA_PORTS="${TET_SSH_EXTRA_PORTS:-}"
if [ "${TET_SSH_KEEP_22:-1}" = 1 ] && [ "$SSH_PORT" != 22 ]; then SSH_EXTRA_PORTS="22 $SSH_EXTRA_PORTS"; fi
P2P_PORT="${TET_SEED_P2P_PORT:-8002}"
SWAP_GB="${TET_SEED_SWAP_GB:-4}"

# quickstart | production.  production = RISC0 toolchain + zkVM guests baked in
# (docker-compose.yml defaults).  quickstart = docker-compose.dev.yml, no zk.
# See README block at the bottom of this file for the fit measurement.
PROFILE="${TET_SEED_PROFILE:-quickstart}"

# Genesis identity: a public chain names itself, so there are no defaults. The first public testnet
# ran on the dev values (chain id tet-local-dev, the dev founder and treasury), so every fresh dev node
# computed its genesis hash. Now the chain comes from its genesis file, {"chain_id",
# "founder_wallet_id", "treasury_address", "genesis_hash"}, made once by the owner, and TET_CHAIN_ID
# must name the same chain. The node itself refuses to start with TET_ENV=testnet unless the file
# matches (tet-core genesis::check_public_chain); this script refuses earlier, before it touches the
# host. The UI image's build args bake the same values in from .env.
GENESIS_FILE="${TET_GENESIS_FILE:-/etc/tet/genesis.json}"
CHAIN_ID="${TET_CHAIN_ID:-}"
DEV_FOUNDER=57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0
DEV_TREASURY=fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321

# Joining an existing chain vs starting one. The .env template below was written for the FIRST
# seed: a producer with no bootnode to dial. A SECOND seed is the opposite and neither of these
# was honoured until 2026-09-30 — provisioning Nuremberg produced a node with no bootnode and
# TET_AUTO_MINE=1 in .env, so it sat at height 0 and would have become a second producer on the
# next `docker compose up`.
#
# TET_AUTO_MINE defaults to 1 only when no bootnode is given. Supply TET_BOOTNODES and the
# default flips to 0, because two producers on one genesis race each other — see
# RUNNING_A_NODE.md "Joining the public testnet seed".
BOOTNODES="${TET_BOOTNODES:-}"
if [ -n "$BOOTNODES" ]; then
  AUTO_MINE="${TET_AUTO_MINE:-0}"
else
  AUTO_MINE="${TET_AUTO_MINE:-1}"
fi
# A follower pins the producer's PeerId (as producer "local-wallet") so it accepts gossiped blocks
# only from it. There is no default: the producer's PeerId is printed when it is provisioned. The
# producer writes the variable EMPTY: docker-compose.yml would otherwise fill in a follower default.
# A producer is the chain's sole validator by explicit configuration (its own node id, local-wallet):
# without it, chain sync would trust every peer (p2p SyncTrust), and the node refuses to start that
# way with TET_ENV=testnet.
if [ "$AUTO_MINE" = 1 ]; then
  PRODUCER_PEERS=""
  VALIDATOR_IDS="${TET_VALIDATOR_IDS:-local-wallet}"
else
  PRODUCER_PEERS="${TET_PRODUCER_PEERS:-}"
  VALIDATOR_IDS="${TET_VALIDATOR_IDS:-}"
fi

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m %s\n' "$*"; }
warn() { printf '    \033[33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# Node role (docs/DEMO_NODE.md). Checked before anything touches the host.
#   seed           a P2P node: the producer when no bootnode is given, else a follower.
#   demo           a follower that also serves the /try page: REST in public mode behind Caddy on 443.
#   demo-producer  one host as both: the chain's only producer AND the /try page (testnet-2 runs
#                  this way, one host and no second seed yet).
ROLE="${TET_NODE_ROLE:-seed}"
DEMO_DOMAIN="${TET_DEMO_DOMAIN:-}"
case "$ROLE" in
  seed) ;;
  demo|demo-producer)
    [ -n "$DEMO_DOMAIN" ] || die "set TET_DEMO_DOMAIN (the name Caddy gets a certificate for)"
    [ -n "${TET_DEMO_ACME_EMAIL:-}" ] || die "set TET_DEMO_ACME_EMAIL (Let's Encrypt contact; Caddy will not start without it)"
    if [ "$ROLE" = demo ]; then
      [ -n "$BOOTNODES" ]  || die "a demo node follows a producer: set TET_BOOTNODES (or use TET_NODE_ROLE=demo-producer)"
      [ "$AUTO_MINE" = 0 ] || die "a demo node never produces blocks: TET_AUTO_MINE must be 0"
    else
      [ -z "$BOOTNODES" ]  || die "a demo-producer is the chain's producer: it dials no bootnode (unset TET_BOOTNODES)"
      [ "$AUTO_MINE" = 1 ] || die "a demo-producer produces blocks: TET_AUTO_MINE must be 1"
    fi
    ;;
  *) die "TET_NODE_ROLE must be seed, demo or demo-producer (got '$ROLE')" ;;
esac
[ "$AUTO_MINE" = 1 ] || [ -n "$PRODUCER_PEERS" ] || die "a follower pins its producer: set TET_PRODUCER_PEERS=local-wallet=<producer PeerId>"

# The genesis file, read with python3 (in every Ubuntu image; jq comes later, with Docker).
[ -n "$CHAIN_ID" ] || die "set TET_CHAIN_ID: the public chain this node runs (not a dev id)"
case "$CHAIN_ID" in tet-dev-local|tet-local-dev) die "TET_CHAIN_ID=$CHAIN_ID is a dev chain id; a public chain names itself" ;; esac
[ -f "$GENESIS_FILE" ] || die "no genesis file at $GENESIS_FILE (copy the chain's genesis.json there first)"
GENESIS_FIELDS=$(python3 -c '
import json, sys
g = json.load(open(sys.argv[1]))
assert set(g) == {"chain_id", "founder_wallet_id", "treasury_address", "genesis_hash"}, "unexpected fields"
print(g["chain_id"], g["founder_wallet_id"].lower(), g["treasury_address"].lower(), g["genesis_hash"].lower())
' "$GENESIS_FILE") || die "$GENESIS_FILE is not a genesis file {chain_id, founder_wallet_id, treasury_address, genesis_hash}"
read -r G_CHAIN FOUNDER TREASURY GENESIS_HASH <<<"$GENESIS_FIELDS"
[ "$G_CHAIN" = "$CHAIN_ID" ] || die "$GENESIS_FILE is for chain $G_CHAIN, TET_CHAIN_ID is $CHAIN_ID"
[ "$FOUNDER" != "$DEV_FOUNDER" ] || die "$GENESIS_FILE names the dev founder wallet"
[ "$TREASURY" != "$DEV_TREASURY" ] || die "$GENESIS_FILE names the dev treasury"

[ "$(id -u)" -eq 0 ] || die "run as root"

# --- 1. host preflight ------------------------------------------------------
log "Host preflight"
# shellcheck source=/dev/null  # exists on the target host, not in this repo
. /etc/os-release
ok "$PRETTY_NAME  kernel $(uname -r)  $(nproc) vCPU  $(free -m | awk '/^Mem:/{print $2}') MB RAM"
[ "${ID:-}" = ubuntu ] || warn "not Ubuntu ($ID) — apt steps below assume Debian-family"

# --- 2. swap ----------------------------------------------------------------
# A release build of tet-core links libp2p, RISC0 and the Solana SDK. On a
# 2-vCPU/4 GB box cargo runs two rustc processes at once and the peak lands
# above what RAM alone covers; without swap the build dies as an OOM kill
# midway, which reads like a compiler crash. Swap is what makes it finish, and
# it is also what the previous (dead) Helsinki host ran.
log "Swap (${SWAP_GB} GB)"
if swapon --show --noheadings | grep -q .; then
  ok "already active: $(swapon --show --bytes --noheadings | awk '{print $1, $3}' | tr '\n' ' ')"
else
  fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB*1024))
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "created and enabled /swapfile, persisted in /etc/fstab"
fi

# --- 3. docker --------------------------------------------------------------
# Docker's own apt repo, not `curl … | sh`. Same binaries, but the packages are
# signed and apt keeps them patched, and nothing pipes a remote script into a
# root shell.
log "Docker Engine + Compose plugin"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "$(docker --version), $(docker compose version --short)"
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git ufw jq >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker >/dev/null
  ok "$(docker --version), compose $(docker compose version --short)"
fi
apt-get install -y -qq git ufw jq >/dev/null 2>&1 || true

# --- 4+5. source --------------------------------------------------------------
log "Source at $SEED_DIR (mode=$SOURCE_MODE)"
case "$SOURCE_MODE" in
push)
  # The operator pushed the tree before running this. Verify rather than
  # assume: a half-extracted tar that still builds a stale Dockerfile is a
  # much worse failure than a clear stop here.
  for f in docker-compose.yml docker-compose.dev.yml deploy/docker-compose.seed.yml Dockerfile Cargo.toml; do
    [ -f "$SEED_DIR/$f" ] || die "TET_SEED_SOURCE=push but $SEED_DIR/$f is missing. From the workstation:
    git archive --format=tar HEAD | ssh root@\$(hostname -I | awk '{print \$1}') 'mkdir -p $SEED_DIR && tar -x -C $SEED_DIR'"
  done
  ok "source present ($(find "$SEED_DIR" -type f | wc -l) files); no credential on this host"
  ;;
clone)
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  if [ ! -f "$DEPLOY_KEY" ]; then
    ssh-keygen -t ed25519 -N '' -C "tet-seed-$(hostname)-ro" -f "$DEPLOY_KEY" >/dev/null
    ok "generated $DEPLOY_KEY (private half stays on this host)"
  fi
  ssh-keyscan -t ed25519 github.com 2>/dev/null >> /root/.ssh/known_hosts
  sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts
  cat > /root/.ssh/config <<EOF
Host github.com
  User git
  IdentityFile $DEPLOY_KEY
  IdentitiesOnly yes
EOF
  chmod 600 /root/.ssh/config

  # `ssh -T git@github.com` exits 1 even when authentication SUCCEEDS (GitHub
  # refuses the shell), so under `set -o pipefail` a `ssh … | grep -q`
  # pipeline reports failure on the happy path. Capture first, then match.
  AUTH_OUT="$(ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1 || true)"
  if ! printf '%s' "$AUTH_OUT" | grep -q "successfully authenticated"; then
    cat <<EOF

  This key is not registered on the repository yet. Register it READ-ONLY:

    gh repo deploy-key add - --repo TET-Network-Foundation/TET-OS \\
      --title '$(hostname)-seed (ro)' <<'KEY'
$(cat "${DEPLOY_KEY}.pub")
KEY

  then re-run. (No --allow-write: the seed never pushes.) If that call returns
  "Deploy keys are disabled for this repository", enable them under repo
  Settings -> Deploy keys, or use TET_SEED_SOURCE=push instead.

EOF
    exit 3
  fi
  ok "deploy key authenticates to github.com"

  if [ -d "$SEED_DIR/.git" ]; then
    git -C "$SEED_DIR" fetch --quiet origin "$REPO_BRANCH"
    git -C "$SEED_DIR" checkout --quiet "$REPO_BRANCH"
    git -C "$SEED_DIR" reset --hard --quiet "origin/$REPO_BRANCH"
    ok "updated to $(git -C "$SEED_DIR" rev-parse --short HEAD)"
  else
    git clone --quiet --branch "$REPO_BRANCH" --depth 1 "$REPO_SSH" "$SEED_DIR"
    ok "cloned at $(git -C "$SEED_DIR" rev-parse --short HEAD)"
  fi
  ;;
*) die "TET_SEED_SOURCE must be push or clone (got '$SOURCE_MODE')" ;;
esac

# --- 6. environment ---------------------------------------------------------
# docker-compose.yml reads .env when present and it wins over the `environment:`
# defaults. TET_TREASURY_ADDRESS is the one the node exits(2) without; the rest
# are what make this host a *seed* rather than the isolated single node the
# compose defaults describe (TET_ENABLE_P2P=0, no listener).
log "Environment ($SEED_DIR/.env)"
case "$PROFILE" in
  production) RISC0_SKIP=0; BUILD_FEATURES=zk-prove ;;
  quickstart) RISC0_SKIP=1; BUILD_FEATURES= ;;
  *) die "TET_SEED_PROFILE must be quickstart or production (got '$PROFILE')" ;;
esac
cat > "$SEED_DIR/.env" <<EOF
# Generated by deploy/provision-seed.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Edit
# here, not in docker-compose.yml — this file wins.

# --- genesis identity (from $GENESIS_FILE; see script header) ----------------
# TET_ENV=testnet makes the node check all of these against the genesis file when it starts.
TET_ENV=testnet
TET_CHAIN_ID=$CHAIN_ID
TET_GENESIS_FILE=/etc/tet/genesis.json
TET_GENESIS_FOUNDER_WALLET_ID=$FOUNDER
TET_TREASURY_ADDRESS=$TREASURY
TET_GENESIS_HASH=$GENESIS_HASH

# --- seed role --------------------------------------------------------------
# The compose default is TET_ENABLE_P2P=0 (isolated single node). A seed is the
# opposite: it listens, and it is the node everyone else dials.
TET_ENABLE_P2P=1
TET_P2P_LISTEN=/ip4/0.0.0.0/tcp/$P2P_PORT
TET_AUTO_MINE=$AUTO_MINE
TET_BLOCK_TIME_SEC=12
${BOOTNODES:+TET_BOOTNODES=$BOOTNODES}
TET_PRODUCER_PEERS=$PRODUCER_PEERS
${VALIDATOR_IDS:+TET_VALIDATOR_IDS=$VALIDATOR_IDS}
RUST_LOG=info

# --- build profile ($PROFILE) -----------------------------------------------
RISC0_SKIP_BUILD=$RISC0_SKIP
TET_BUILD_FEATURES=$BUILD_FEATURES
EOF
if [ "$ROLE" != seed ]; then
  {
    echo
    echo "# --- demo node (docs/DEMO_NODE.md) ------------------------------------------"
    echo "TET_PUBLIC_API=1"
    echo "TET_DEMO_DOMAIN=$DEMO_DOMAIN"
    echo "TET_DEMO_ACME_EMAIL=${TET_DEMO_ACME_EMAIL:-}"
    if [ -n "${TET_DEMO_REDIRECTS:-}" ]; then echo "TET_DEMO_REDIRECTS=${TET_DEMO_REDIRECTS}"; fi
  } >> "$SEED_DIR/.env"
fi
chmod 600 "$SEED_DIR/.env"
ok "profile=$PROFILE  p2p=$P2P_PORT  chain=$CHAIN_ID  genesis=$GENESIS_HASH"
# The containers read the genesis file at this path (the seed and demo overlays mount it).
if [ "$GENESIS_FILE" != /etc/tet/genesis.json ]; then install -D -m 0644 "$GENESIS_FILE" /etc/tet/genesis.json; fi

# --- 6b. SSH listeners --------------------------------------------------------
# Ubuntu 24.04 starts sshd from ssh.socket. Enable it explicitly and list every port on both IPv4
# and IPv6 (an [::] listener alone depends on bindv6only), then check each one really listens:
# a port the firewall allows but nothing serves looks exactly like a firewall problem from outside.
log "ssh.socket: ports $SSH_PORT $SSH_EXTRA_PORTS"
if systemctl list-unit-files ssh.socket >/dev/null 2>&1; then
  mkdir -p /etc/systemd/system/ssh.socket.d
  {
    echo "[Socket]"
    echo "ListenStream="
    for p in $SSH_PORT $SSH_EXTRA_PORTS; do
      echo "ListenStream=0.0.0.0:$p"
      echo "ListenStream=[::]:$p"
    done
    echo "BindIPv6Only=ipv6-only"
  } > /etc/systemd/system/ssh.socket.d/tet-ports.conf
  systemctl daemon-reload
  systemctl enable ssh.socket >/dev/null 2>&1
  systemctl restart ssh.socket
  # Each port on IPv4 and IPv6 separately: a [::] listener alone refuses every IPv4 connection
  # when the socket is IPv6-only, which is what locked the demo host's IPv4 SSH out.
  for p in $SSH_PORT $SSH_EXTRA_PORTS; do
    ss -4ltnH "sport = :$p" | grep -q . || die "ssh.socket is not listening on IPv4 port $p"
    ss -6ltnH "sport = :$p" | grep -q . || warn "ssh.socket is not listening on IPv6 port $p"
  done
  ok "ssh listens on $(ss -ltnH | awk '{print $4}' | grep -E ":(${SSH_PORT}$(for p in $SSH_EXTRA_PORTS; do printf '|%s' "$p"; done))$" | tr '\n' ' ')"
else
  warn "no ssh.socket unit (sshd not socket-activated here): extra ports not configured"
fi

# --- 7. firewall ------------------------------------------------------------
# Never add nftables reject rules of our own: a REJECT answers a connection with a reset, which
# reads from outside as "nothing listening" and hides the real problem. ufw is the only host
# firewall here (plus the provider's firewall, printed as text at the end). Anything else that
# rejects is reported.
if command -v nft >/dev/null 2>&1; then
  other=$(nft list ruleset 2>/dev/null | awk '/^table /{t=$2" "$3} /reject/ && t !~ /ufw/ {print t": "$0}' | head -5)
  [ -z "$other" ] || warn "nftables reject rules outside ufw (from cloud-config or elsewhere?): $other"
fi
# Mirrors the provider's firewall so the host is not defenceless if that
# firewall is ever relaxed. READ THIS BEFORE TRUSTING IT: ufw does not filter
# container-published ports. Docker inserts DNAT rules into the nat table's
# DOCKER chain, which runs before ufw's filter rules, so a published 0.0.0.0
# port stays open no matter what ufw says. That is why REST is published on
# 127.0.0.1 in deploy/docker-compose.seed.yml rather than merely ufw-denied.
# ufw's real job here is the host's own listeners (sshd, anything added later).
log "ufw"
ufw --force disable >/dev/null 2>&1 || true
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp"  >/dev/null   # keep this first — enabling without it locks you out
for p in $SSH_EXTRA_PORTS; do ufw allow "${p}/tcp" >/dev/null; done
ufw allow "${P2P_PORT}/tcp"  >/dev/null   # block plane; all swarms are TCP-only
if [ "$ROLE" != seed ]; then
  ufw allow 80/tcp  >/dev/null   # ACME challenge and the redirect to 443
  ufw allow 443/tcp >/dev/null   # Caddy: the /try page
fi
ufw --force enable >/dev/null
systemctl enable ufw >/dev/null 2>&1 || true
ok "$(ufw status | tr '\n' ' ')"

# --- 8. bring the stack up --------------------------------------------------
log "docker compose up -d tet-core  (profile=$PROFILE)"
cd "$SEED_DIR"
COMPOSE=(docker compose -f docker-compose.yml)
[ "$PROFILE" = quickstart ] && COMPOSE+=(-f docker-compose.dev.yml)
SERVICES=(tet-core)
if [ "$ROLE" != seed ]; then
  COMPOSE+=(-f deploy/demo/docker-compose.demo.yml)
  # One host as demo AND producer: the overlay that lets this demo node produce blocks.
  if [ "$ROLE" = demo-producer ]; then COMPOSE+=(-f deploy/demo/docker-compose.producer.yml); fi
  SERVICES+=(ui)
  # The file-fee sponsor's words go here later (deploy/demo/README.md, section 6). Root only; the
  # demo overlay mounts it read-only. Nothing in it comes from, or goes to, the seeds.
  install -d -m 700 /etc/tet-demo
else
  COMPOSE+=(-f deploy/docker-compose.seed.yml)
fi
printf '    %s\n' "${COMPOSE[*]} up -d --build ${SERVICES[*]}"
"${COMPOSE[@]}" up -d --build "${SERVICES[@]}"

# A demo node faces the internet only through Caddy, and Caddy starts only once tet-core has
# PROVED it is in public mode: a route off the allow-list must come back as the gate's own 404.
# An image without public mode would otherwise sit behind Caddy with every route open.
if [ "$ROLE" != seed ]; then
  log "Public mode check (before Caddy)"
  gate=""
  for _ in $(seq 1 60); do
    gate=$(curl -s -o /dev/null -D - -m 5 http://127.0.0.1:5010/metrics 2>/dev/null | tr -d '\r' | grep -i '^x-tet-public-gate: refused' || true)
    [ -n "$gate" ] && break
    sleep 5
  done
  [ -n "$gate" ] || die "tet-core is not in public mode (/metrics was not refused by the gate); NOT starting Caddy"
  ok "tet-core refuses off-list routes; starting Caddy"
  "${COMPOSE[@]}" up -d caddy
fi

# --- 8b. monitoring ---------------------------------------------------------
# A systemd timer rather than cron: it survives reboots, logs to the journal,
# and `systemctl status tet-healthcheck.timer` answers "is monitoring running?"
# without grepping crontabs.
#
# TET_HC_URL is the healthchecks.io check URL. Without it the probe still runs
# and still restarts a stalled node, it just has nowhere to report — so the
# script is useful unconfigured, and configuring it is one drop-in file.
log "Monitoring (systemd timer, every 60s)"
install -m 0755 "$SEED_DIR/deploy/seed-healthcheck.sh" /usr/local/bin/tet-healthcheck
mkdir -p /etc/tet
if [ -n "${TET_HC_URL:-}" ]; then
  printf 'TET_HC_URL=%s\n' "$TET_HC_URL" > /etc/tet/healthcheck.env
  # A follower must not restart itself on a stalled height (the producer is what stopped).
  if [ "$AUTO_MINE" = 0 ]; then printf 'TET_HC_ALLOW_RESTART=0\n' >> /etc/tet/healthcheck.env; fi
  chmod 600 /etc/tet/healthcheck.env
  ok "healthchecks.io URL written to /etc/tet/healthcheck.env"
elif [ -f /etc/tet/healthcheck.env ]; then
  ok "keeping existing /etc/tet/healthcheck.env"
else
  printf '# TET_HC_URL=https://hc-ping.com/<uuid>\n' > /etc/tet/healthcheck.env
  chmod 600 /etc/tet/healthcheck.env
  warn "no TET_HC_URL set — probe will run but not report. Add it to /etc/tet/healthcheck.env"
fi

# The units are repository files (deploy/systemd/), so a deploy can refresh them from the same tree
# it refreshes the probe from. The service names the seed directory; the file says /opt/TET-OS.
sed "s#/opt/TET-OS#$SEED_DIR#g" "$SEED_DIR/deploy/systemd/tet-healthcheck.service" \
  > /etc/systemd/system/tet-healthcheck.service
install -m 0644 "$SEED_DIR/deploy/systemd/tet-healthcheck.timer" /etc/systemd/system/tet-healthcheck.timer

systemctl daemon-reload
systemctl enable --now tet-healthcheck.timer >/dev/null 2>&1
ok "tet-healthcheck.timer active ($(systemctl is-active tet-healthcheck.timer))"

# --- 8c. weekly backup --------------------------------------------------------
# scripts/backup-node-data.sh, every week, into /var/backups/tet (it stops nothing). A backup that
# stays on this host is lost with it: pull it weekly to a machine outside (docs/OPS_CHECKLIST.md).
log "Weekly backup (systemd timer)"
install -m 0755 "$SEED_DIR/scripts/backup-node-data.sh" /usr/local/bin/tet-backup-node-data
install -m 0644 "$SEED_DIR/deploy/systemd/tet-backup.service" "$SEED_DIR/deploy/systemd/tet-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tet-backup.timer >/dev/null 2>&1
ok "tet-backup.timer active ($(systemctl is-active tet-backup.timer)); tarballs in /var/backups/tet"

# --- 9. verify --------------------------------------------------------------
log "Waiting for health"
for _ in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' tet-core-mainnet 2>/dev/null || echo none)
  [ "$s" = healthy ] && break
  sleep 5
done
[ "$s" = healthy ] || die "container health = $s; docker compose logs tet-core"
ok "container healthy"

WEB_RULES=""
if [ "$ROLE" != seed ]; then
  WEB_RULES="      allow 80/tcp     ACME and the redirect to 443
      allow 443/tcp    the /try page (Caddy)
"
fi
PEER_ID=$(docker logs tet-core-mainnet 2>&1 | grep -m1 'libp2p PeerId:' | awk '{print $NF}' || true)
PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')

cat <<EOF

    ---------------------------------------------------------------
    REST (loopback only)  http://127.0.0.1:5010/status
    $(curl -fsS --max-time 5 http://127.0.0.1:5010/status | head -c 400)

    PeerId       ${PEER_ID:-<not yet logged>}
    Bootnode     /ip4/${PUBLIC_IP}/tcp/${P2P_PORT}/p2p/${PEER_ID:-<PeerId>}
    ---------------------------------------------------------------

    Put that multiaddr in docs/RUNNING_A_NODE.md and in TET_BOOTNODES on
    every node that should join (with TET_PRODUCER_PEERS=local-wallet=<PeerId>
    when this node is the producer).

    Provider firewall: set this in the provider's console (inbound, TCP only)
      allow ${SSH_PORT}/tcp   SSH${SSH_EXTRA_PORTS:+ (and ${SSH_EXTRA_PORTS% } until closed with TET_SSH_KEEP_22=0)}
      allow ${P2P_PORT}/tcp   P2P
${WEB_RULES}      deny everything else (5010, the node API, stays on 127.0.0.1)

EOF
