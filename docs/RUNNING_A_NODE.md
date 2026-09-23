# Running a TET-Core Node

Operational guide for **Phase 0 public testnet alpha** developers. This document reflects the **post–Phase 2A** block-sync stack and **Phase 2B** treasury configuration. For architecture context see [`CODEBASE_OVERVIEW.md`](./CODEBASE_OVERVIEW.md); for Sprint 1 sync design see [`SPRINT1_DESIGN.md`](./SPRINT1_DESIGN.md).

---

## 1. Prerequisites

### Operating system

- **macOS** or **Linux** (developer-tested). Windows is not documented here.
- **RAM:** ≥ 4 GB recommended for a single node; ≥ 8 GB for a 3-node local testnet plus UI.
- **Disk:** ≥ 10 GB free (sled DB, Rust `target/`, optional RISC0 toolchain).

### Rust toolchain

- **Rust 1.85+** (crate uses **edition 2024** — see `tet-core/Cargo.toml`).
- Install via [rustup](https://rustup.rs/), then from the repo:

```bash
cd tet-core
cargo build --release --bin TET-Core
```

### RISC0 (optional for node-only work)

ZK guest builds are **not required** to run the ledger node or 3-node sync tests:

```bash
export RISC0_SKIP_BUILD=1
```

Use this for local dev, CI-style builds, and `scripts/start-3-node-testnet.sh` (the script sets it automatically).

### Repository

```bash
git clone <your-repo-url> Nexus_Network
cd Nexus_Network
```

There is **no `.gitmodules`** in this monorepo at present; clone the single repository. Related trees (`tet-network/ui`, `methods/`, etc.) live in the same checkout.

---

## 2. Single-node quick start

### Minimum environment

| Variable | Required | Notes |
|----------|----------|--------|
| `TET_TREASURY_ADDRESS` | **Yes** | 64 lowercase hex chars (Ed25519 pubkey style). **No default, no silent fallback.** Process exits at startup if missing or invalid. |
| `TET_DB_DIR` | Recommended | Sled ledger path. If unset, defaults to `tet.db_{PORT}` (see `main.rs`). |
| `PORT` | Optional | REST bind port; default **5010**. |
| `TET_ENABLE_P2P` | Optional | Default **enabled** (`1` / `true`). Set `0` to disable block-plane P2P. |
| `TET_WALLET_ID` | Optional | Local operator wallet id for dev faucet / identity; default `local-wallet` or `TET_PEER_ID`. |

**There is no `TET_KEYSTORE_PATH` env var.** libp2p identity is stored as **`{TET_DB_DIR}/libp2p_keypair.bin`** (persistent Ed25519; see `p2p_keystore.rs`).

Example (dev):

```bash
cd tet-core
export RISC0_SKIP_BUILD=1
export PORT=5010
export TET_DB_DIR=/tmp/tet-solo.db
export TET_TREASURY_ADDRESS=fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321
export TET_ENABLE_P2P=0          # optional: REST-only solo node
export TET_FOUNDER_WALLET=founder
export TET_FOUNDER_CLIFF_MS=0    # dev: liquid founder balance

cargo run --release --bin TET-Core
```

On first boot with an empty ledger, the node runs **auto genesis** (25% founder / 50% worker pool / 25% treasury) using `TET_GENESIS_FOUNDER_WALLET_ID` or the built-in dev founder hex.

### Verify state

```bash
curl -s http://127.0.0.1:5010/ledger/state | jq
```

Example fields:

| Field | Meaning |
|-------|---------|
| `block_height` | Canonical mined height |
| `state_root` | Balance-tree root (`0x…`) |
| `mempool_len` | Pending txs |
| `synced` | `true` when catch-up gate allows mining / considers chain aligned |
| `sync.active` | Range catch-up RPC in progress |
| `sync.lag_blocks` | `best_peer_height - local_height` |
| `sync.best_peer_id` | libp2p peer id string of best known peer |
| `sync.best_peer_height` | Highest height reported by hellos |

With `TET_ENABLE_P2P=0`, `synced` is always `true` and `sync.lag_blocks` is `0` (no block-plane peers).

```bash
curl -s http://127.0.0.1:5010/ledger/balance/founder | jq
```

---

## 3. Three-node local testnet

### Script

From `tet-core/`:

```bash
export TET_TREASURY_ADDRESS=fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321
./scripts/start-3-node-testnet.sh
```

The script:

1. Builds `target/release/TET-Core` if needed (`RISC0_SKIP_BUILD=1`).
2. Starts **node 1** on REST **5010**, block P2P **16011**, `TET_IS_BOOTNODE=1`, `TET_AUTO_MINE=1`.
3. Waits 30s, parses **`[P2P-block] listening on …`** from node 1 logs → sets `TET_BOOTNODES` for nodes 2–3.
4. Starts nodes **5020** / **5030** with P2P **16012** / **16013**.
5. Prints heights and `state_root` for Sprint 1 DoD.

**Important:** All three nodes must share the same `TET_TREASURY_ADDRESS` on **fresh** DB paths (`/tmp/tet-phasec-n*.db`). The script wipes those paths each run.

### Per-node environment (manual reference)

| Node | `PORT` | `TET_DB_DIR` | `TET_P2P_LISTEN` | `TET_BOOTNODES` |
|------|--------|--------------|------------------|-----------------|
| 1 (boot) | 5010 | `/tmp/tet-phasec-n1.db` | `/ip4/127.0.0.1/tcp/16011` | *(unset)* |
| 2 | 5020 | `/tmp/tet-phasec-n2.db` | `/ip4/127.0.0.1/tcp/16012` | node 1 full multiaddr |
| 3 | 5030 | `/tmp/tet-phasec-n3.db` | `/ip4/127.0.0.1/tcp/16013` | node 1 full multiaddr |

Common settings used by the script:

```bash
export TET_VALIDATOR_IDS=alice      # default if unset: TET_WALLET_ID
export TET_AUTO_MINE=1
export TET_BLOCK_TIME_SEC=5         # script default; code default is 10 if unset
export TET_WALLET_ID=alice
```

### Definition of done

**Sprint 1 (height convergence):**

- `max(block_height) - min(block_height) ≤ 2` across the three REST ports (script enforces this).

**Phase 2A+ (tip alignment):**

- After catch-up, all nodes should report the **same `state_root`** at the same height.
- Auto-mine on followers stays gated until:
  - `synced == true` (no peer ahead, no catch-up driver active, no tip conflict), **and**
  - tip has been stable for **`TET_SYNC_STABLE_SEC`** consecutive seconds (default **2**).

Verify manually:

```bash
for p in 5010 5020 5030; do
  echo -n "port $p: "
  curl -sf "http://127.0.0.1:$p/ledger/state" | jq -c '{h:.block_height,root:.state_root,synced:.synced,lag:.sync.lag_blocks}'
done
```

### Docker — node + UI in one command

**Updated 2026-09-21.** `docker-compose.yml` now brings up **both** `tet-core` and the Sovereign OS
UI (locked decision #12). Before this, compose ran the node only and `tet-network/ui/Dockerfile`
was referenced by nothing.

#### Quickstart (~10 min)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
open http://localhost:3000
```

The override builds the node **without the RISC Zero guests**. That is the whole difference, and
it is the difference between a first build of minutes and one of tens of minutes.

What you give up: the zk prover. The log shows
`[worker-daemon] not started: NEXUS_GUEST_ELF is empty`, and the zk-court and proof paths are
unavailable. Wallet, faucet claim, transfers, Tmail, Files and mining all work. The zk path is
fail-closed on mainnet and warn-only in dev, which is why this is fine locally and is **not** a
production configuration.

#### Production

```bash
docker compose up --build -d
```

The base file alone keeps `RISC0_SKIP_BUILD=0` and `--features zk-prove`, so it installs the risc0
toolchain and builds the guests. A deployment that does not pass `docker-compose.dev.yml` is
unaffected by anything in it.

No `.env` is required — `env_file` is marked `required: false` and the compose file carries local
dev defaults (`TET_CHAIN_ID=tet-local-dev`, dev founder, dev treasury, P2P off, auto-mine on). An
`.env` in the repo root, if present, overrides all of them.

> **The PQC WASM is baked into the UI image.** Stage 1 of `tet-network/ui/Dockerfile` runs the
> `wasm-pack` command from [§ Sovereign OS UI — post-quantum WASM](#sovereign-os-ui-tet-networkui--post-quantum-wasm-required)
> and copies the result into `public/pqc`. You do **not** run that step by hand for Docker, and the
> runtime image contains no Rust toolchain. That is also why **both** images build from the
> repository root, not from `tet-network/ui`:
>
> ```bash
> docker build -f tet-network/ui/Dockerfile .    # correct
> docker build tet-network/ui                    # WRONG — no Rust workspace in that context
> ```

#### Expected output

Shown for the quickstart; `docker compose ps` is identical either way.

```console
$ docker compose ps
NAME               STATUS                    PORTS
tet-core-mainnet   Up 13 seconds (healthy)   0.0.0.0:5010->5010/tcp, 0.0.0.0:8002->8002/tcp, 0.0.0.0:8002->8002/udp
tet-ui             Up 7 seconds (healthy)    0.0.0.0:3000->3000/tcp
```

`tet-ui` has `depends_on: {tet-core: {condition: service_healthy}}`, so compose prints
`tet-core-mainnet Waiting → Healthy` before it starts the UI.

```console
$ curl -sf http://127.0.0.1:5010/status
{"founder_wallet_id":"57e0b29d...36a0","pqc_active":false,"attestation_required":false,
 "guardian_count":0,"fee_total_tet":0.0,"cost_guard_limit_usd":50.0,"cost_guard_used_usd":0.0}
```

**`state_root` is not in `/status`** — it is in `/ledger/state`:

```console
$ curl -sf http://127.0.0.1:5010/ledger/state
{"block_height":1,"mempool_len":0,
 "state_root":"0x8329a23914512db8c7e429707bf52e27083d011ede8416789eb881a7d7d26f7b",
 "synced":true,"sync":{"active":false,"lag_blocks":0,"best_peer_height":1,"best_peer_id":""}}
```

With `TET_AUTO_MINE=1` the height advances every `TET_BLOCK_TIME_SEC` (default 12) and the root
changes with it. `pqc_active:false` is expected in dev: it is a **UI advertisement flag** that
defaults to `is_prod`, and `quantum_shield.rs` says in as many words not to use it for
authorization — hybrid Ed25519 + ML-DSA is required on sensitive routes regardless.

There is **no bare `/health` route** (it returns 404). Liveness is `/status`, which is what both
healthchecks poll. `/health/swarm` reports the block-plane swarm and reads `peer_count: 0` with
P2P off, so it is not a single-node liveness signal.

```console
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/       # Sovereign OS
200
$ curl -s -o /dev/null -w '%{http_code} %{size_download} %{content_type}\n' \
    http://127.0.0.1:3000/pqc/tet_pqc_wasm_bg.wasm
200 274722 application/wasm
$ curl -sf http://127.0.0.1:3000/tet-node-api/ledger/state    # UI → node, via compose DNS
{"block_height":2,...,"state_root":"0x13a0f60b...f216","synced":true,...}
```

That last call is the one that matters: the browser only ever talks to the UI origin, and
`app/tet-node-api/[...path]/route.ts` proxies server-side to `TET_CORE_ORIGIN`, which compose sets
to `http://tet-core:5010`. `127.0.0.1:5010` would be the UI container's own loopback, not the node.

#### Genesis values must match on both sides

`NEXT_PUBLIC_*` is **inlined at build time**, so the UI image is built with the same founder,
treasury and chain id the node runs with — compose passes one set of values to both. A mismatch
changes the computed genesis hash and every hybrid-signed request is rejected with
`invalid signature or missing chain_id/genesis_hash binding`. To change them, rebuild the UI image;
editing the node's env alone is not enough.

Cross-check the UI's derivation against the Rust constants:

```console
$ cd tet-network/ui && node scripts/verify-genesis-hash.mjs
0x9d6ccb1354b31419ade378aef68de58e854938df795b69cf76777e3483efbb36
OK: payload uses treasury= (Phase 2B), not ecosystem= / system:worker_pool
OK: SHA-256 matches dev golden vector
```

The node does not expose its genesis hash over REST — it appears only inside signature preimages
(`wallet.rs`), so this stays a static cross-check rather than a live comparison.

#### Images

| Image | Size | Notes |
|---|---|---|
| `nexus_network-tet-core` | 214 MB | `debian:bookworm-slim` + the release binary |
| `nexus_network-ui` | 343 MB | `node:22-alpine`, Next `output: "standalone"`, non-root `nextjs` user, PQC baked in |

### Joining the public testnet seed

**Bootnode multiaddr — canonical, verified 2026-09-22:**

```
/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC
```

Helsinki (Hetzner, `ubuntu-4gb-hel1-3`). It auto-mines on a 12 s block time and is the only
published seed, so it is currently a single point of failure — spec risk **R10**, still open.

Put three lines in `.env` at the repository root and bring the stack up:

```bash
cat >> .env <<'EOF'
TET_ENABLE_P2P=1
TET_BOOTNODES=/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC
TET_AUTO_MINE=0
EOF

docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

`TET_AUTO_MINE=0` is the right setting for a follower: the seed produces the blocks, and a second
independent producer on the same genesis just races it. Leave the three genesis variables alone —
the committed compose defaults are what the seed runs, and a mismatch changes the genesis hash and
rejects every signed request with `401 ed25519 verification failed`.

Confirm you are on the seed's chain — equal tip height is *not* sufficient, because a fork can sit
at the same height. Compare `block_id` **and** `state_root` at one height:

```console
$ H=$(curl -sf http://127.0.0.1:5010/ledger/blocks | jq '.[0].height')
$ curl -sf http://127.0.0.1:5010/ledger/block/$H | jq '.block | {height, block_id, state_root}'
{
  "height": 302,
  "block_id": "0x93740af7d62afc4c7f6855653a04bc55cfc6c49f73c8a05413658979b9bb13e7",
  "state_root": "0xd7ef05d4c8944f5dd83ba55aae11860c100aa2d34a8991cce26900c45c82d394"
}
```

`GET /health/swarm` should show `"peer_count": 1` once the dial lands, and the logs show the
catch-up driver run:

```
[P2P-block] 🤝 chain_hello from 12D3KooW… height=150 local=149 diff=1 catch_up_pending=true
[P2P-block] 📦 catch-up range from 12D3KooW… blocks=1 to_height=150
[P2P-block] ✅ catch-up applied height=150
```

Verified 2026-09-22, Switzerland → Helsinki: a fresh node reached the seed's tip and matched
`block_id` and `state_root` at every height compared.

#### The seed's REST API is not public

Only `8002/tcp` is reachable from the internet. Port 5010 is published on the seed's loopback
interface only (`deploy/docker-compose.seed.yml`), and the seed does not run the UI. To query it:

```bash
ssh -L 15010:127.0.0.1:5010 root@95.217.158.153
curl -sf http://127.0.0.1:15010/status
```

Note that a `ufw deny 5010` would **not** have closed that port: Docker publishes ports by writing
DNAT rules into the nat table's `DOCKER` chain, which ufw's filter rules never see. Binding to
`127.0.0.1` is the close that actually holds.

#### Smoke test: submit from the follower, not the seed

When verifying a node, **send the test transaction from the node you just started**, not from the
seed over a tunnel. The difference is not cosmetic: `/ledger/transfer` admitted transactions to the
mempool and announced them to nobody until 2026-09-23, so a follower could accept a signed
transfer, return `202 pending`, and never deliver it. Every AT-F1 run before that date passed
because the transfer was submitted to the seed, where submit-node and mining-node are the same
process and the bug is invisible.

```bash
# fund a wallet through YOUR node
tet-cli --node-url http://127.0.0.1:5010 faucet claim --mnemonic "…"

# then send FROM your node — this is the assertion that matters
tet-cli --node-url http://127.0.0.1:5010 tx send <recipient> 1 --mnemonic "…"
```

Expect settlement within two block intervals and the same balances on your node and the seed. If
the transfer stays `pending`, your node is not announcing it — see below.

#### Transaction propagation

A transaction submitted to **any** node reaches the producers, over two independent paths.

1. **Gossip** — published on `/tet/v1/txs`, and re-published every `TET_TX_REBROADCAST_SEC`
   (default 15 s) up to `TET_TX_REBROADCAST_MAX` (default 20) attempts until it is mined.
2. **Direct submit** — a `/tet/v1/tx-submit` request/response call to each connected bootnode,
   sent alongside the gossip publish, never instead of it.

The second path is not belt-and-braces. Blocks have had two paths since S1 (gossip plus the
pull-based catch-up RPC), and that redundancy is why a silently degraded mesh never stopped a
chain from syncing. Transactions had only gossip until 2026-09-22, when a follower against the
public seed turned out to be holding an **incomplete record of the seed's topic subscriptions** —
`/tet/v1/txs` missing while blocks, tmail and files were present — so `publish` returned
`InsufficientPeers` indefinitely. Gossipsub exchanges subscriptions once, at connection
establishment, with no retry, so the node stayed wrong until restarted. Nothing in the API showed
it: the claim returned `200 {"status":"pending"}` and simply never settled.

Both paths apply identical admission rules, so a direct submission buys no trust a gossiped one
would not get. `p2p::handle_tx_broadcast` runs, in order: `verify_envelope_v1` (envelope version,
hybrid Ed25519 + ML-DSA signatures, chain binding — a tx signed against a different genesis cannot
enter), `is_tx_applied` (an already-mined envelope is dropped, not re-queued), a mempool duplicate
check, then the same byte/count caps and lowest-fee eviction REST submissions face. Inbound
`tx-submit` is rate-limited per peer, and the budget is spent *before* signature verification —
the ML-DSA check is the expensive part, so a peer must not be able to trigger it at will.

A tx learned from a peer is never added to this node's rebroadcast set, so receiving one never
makes this node re-publish it.

| Variable | Default | Purpose |
|---|---|---|
| `TET_TX_REBROADCAST_SEC` | **15** | Seconds between rebroadcast sweeps (both paths). |
| `TET_TX_REBROADCAST_MAX` | **20** | Attempts per tx before it is abandoned. Five minutes at the default cadence. |
| `TET_TX_SUBMIT_RPS` | **10** | Inbound `/tet/v1/tx-submit` budget per peer per second. |
| `TET_NEXUS_BOOTNODES` | *(empty)* | Bootnodes for the **inference** plane (4003). Deliberately separate from `TET_BOOTNODES`, which is the block plane's address and must not be dialled from another plane — see the 2026-09 post-mortem. |

If a transaction stays pending for more than two block intervals, check the submitting node's log:

```
[P2P] ❌ GOSSIP PUBLISH ERROR topic=/tet/v1/txs err=InsufficientPeers
[P2P][diag] topic=/tet/v1/txs connected_peers=1 mesh_peers=[] peers=[<peer> on_topic=false topics=[...]]
[P2P][tx-submit] ← <peer> accepted=true outcome=enqueued
```

The first two lines are the lost-subscription failure above; the third shows the second path
carrying the transaction anyway, which is the intended behaviour. `on_topic=false` with the peer
otherwise healthy means gossip is degraded for that peer until one side reconnects.

---

### Getting testnet TET

There is **no faucet endpoint.** `POST /ledger/faucet` and `POST /faucet` were removed on
2026-09-20 (`c2416dc`) because the handler wrote balances directly, outside consensus, and forked
`state_root` — one of the block-9828 mechanisms. Do not look for an admin token; there isn't one
any more.

The replacement is the **one-time welcome airdrop**: 1,000 TET per wallet, capped at 10,000
recipients network-wide, public and self-serve. It is an ordinary consensus transaction — a
hybrid-signed `TxV1::InitialAirdrop` that enters the mempool and is applied by every node at
block-apply, so it cannot fork the chain the way the old faucet could.

#### With the CLI

```console
$ cargo run -p tet-cli -- keys generate --words 12
Public Address (ed25519 vk, hex):
bfab9fbd9615e9f988ed58d5ebc43a4ea63766587307322f0e947e2963c80cf3
Mnemonic (DO NOT SHARE):
main bubble twin police box sell business favorite chaos into tag knee

$ export TET_CHAIN_ID=tet-local-dev
$ export TET_TREASURY_ADDRESS=fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321
$ export TET_GENESIS_FOUNDER_WALLET_ID=57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0

$ cargo run -p tet-cli -- --node-url http://127.0.0.1:5010 \
    faucet claim --mnemonic "main bubble twin police box sell business favorite chaos into tag knee"
Welcome airdrop claimed.
wallet: bfab9fbd...0cf3
status: pending — credited when the next block is mined
node_response: {"ok":true,"status":"pending","tx_hash":"0x0e5c7282...","welcome_airdrop_tet":1000}
```

**The three env vars are not optional.** They feed the signature preimage
(`tet tx v1|chain_id=..|genesis_hash=..|mldsa=..|tx=..`), so if they disagree with the node you get
`401 ed25519 verification failed` — which does not sound like a configuration problem, so the CLI
appends a hint saying it is. The values above are the compose defaults.

Wait one block (`TET_BLOCK_TIME_SEC`, default 12), then:

```console
$ curl -sf "http://127.0.0.1:5010/ledger/me?wallet_id=<wallet>" | jq .balance_tet
1000.0
```

Claiming twice is safe and does nothing — the second call returns `200` with
`"outcome":"already_claimed"` and the same `tx_hash`, because the tx body is the wallet id alone,
so its hash is unique per wallet.

#### With curl

The envelope must carry a valid hybrid Ed25519 + ML-DSA signature over the canonical preimage, so
there is no meaningful hand-rolled `curl` for the claim itself — building the signature *is* the
work, which is what `tet-cli faucet claim` and the UI both do. The shape, for reference:

```
POST /ledger/initial_airdrop/claim
{ "v": 1,
  "tx": { "kind": "initial_airdrop", "wallet_id": "<64 hex>" },
  "sig": { "ed25519_pubkey_hex": "<must equal wallet_id>",
           "ed25519_sig_b64": "...", "mldsa_pubkey_b64": "...", "mldsa_sig_b64": "..." },
  "attestation": { "platform": "", "report_b64": "" } }
→ 202 Accepted   {"status":"pending","tx_hash":"0x..."}
→ 200 OK         {"outcome":"already_claimed"}   (idempotent)
→ 401            signature invalid, or signer != wallet_id
```

`/v1/vision/ledger/initial_airdrop/claim` is an alias for the same handler.

#### In the UI

**There is no button yet.** The Sovereign OS has no claim control, and `ui/app/lib/ai_infer_hybrid.ts:91`
already builds a `tet initial airdrop claim hybrid v1` preimage, so the client-side signing exists
but nothing calls it for this route. The natural home is the Wallet window, next to the balance —
a "Claim 1,000 TET" button visible while the balance is zero and the wallet has not claimed. That
is UI work, deliberately not done here.

#### Multi-node

For `tet-node-1`…`3`, see `tet-core/README.md`. Use `./scripts/print-bootnode.sh` for Docker PeerId
discovery (reads container logs). Block-plane bootstrap must use the **`[P2P-block] listening on`**
multiaddr, not legacy inference-only ports. Set `TET_ENABLE_P2P=1` and `TET_BOOTNODES` — the
single-node quickstart above ships with P2P **off**, because there is no seed to dial.

---

## 4. Environment variables — network

| Variable | Default (code) | Purpose |
|----------|----------------|---------|
| `TET_VALIDATOR_IDS` | `TET_WALLET_ID` (single id) | Comma-separated validator identities for leader election / block production. **All nodes in a testnet must use the same set** (or compatible superset). |
| `TET_BOOTNODES` | *(empty)* | Comma-separated libp2p multiaddrs with `/p2p/<PeerId>`. Alias: `BOOTNODES`. |
| `TET_P2P_LISTEN` | `/ip4/0.0.0.0/tcp/0` | **Block-plane** swarm listen multiaddr (`p2p.rs`). Production: set explicit host/port. |
| `TET_HELLO_TIMEOUT_SEC` | **10** | Bootnode hello deadline before marking dead (`p2p.rs`). |
| `TET_BOOTNODE_REDIAL_SEC` | **30** | Period between bootnode re-dial attempts (`p2p.rs`). |
| `TET_SYNC_STABLE_SEC` | **2** (minimum 1) | Seconds tip must stay aligned before auto-mine unblocks (`sync.rs`). |
| `TET_GOSSIP_MESH_N` | **6** | Gossipsub mesh target (`p2p.rs`). |
| `TET_GOSSIP_MESH_N_LOW` | **4** | Mesh low watermark. |
| `TET_GOSSIP_MESH_N_HIGH` | **12** | Mesh high watermark. |
| `TET_AUTO_MINE` | *(off)* | Set `1` / `true` to enable background miner (`consensus.rs`). |
| `TET_AUTO_MINE_IGNORE_SYNC` | **off** | If `1` / `true`, bypasses sync gate (**dev only**; never on mainnet). |
| `TET_IS_BOOTNODE` | **off** | `1` / `true` marks bootnode role (hello / redial behaviour). |
| `TET_ENABLE_P2P` | **on** | `0` / `false` disables block-plane swarm startup. |
| `TET_BLOCK_TIME_SEC` | **10** | Auto-miner sleep interval (seconds, min 1). |

**Test override warning:** Integration tests set `TET_GOSSIP_MESH_N=2`, `TET_SYNC_STABLE_SEC=1`, etc. Do not assume those values in production.

---

## 5. Environment variables — economics & genesis

| Variable | Default | Purpose |
|----------|---------|---------|
| `TET_TREASURY_ADDRESS` | *(none — required)* | Treasury wallet (64 hex). Minted **25%** of supply at genesis. Stored in ledger meta (`META_TREASURY_WALLET`). |
| `TET_FOUNDER_WALLET` | *(optional)* | Founder fee routing / audits; also fallback for genesis hash if `TET_GENESIS_FOUNDER_WALLET_ID` unset. |
| `TET_GENESIS_FOUNDER_WALLET_ID` | dev hex in `ledger.rs` | Founder receiving 25% genesis tranche. **Required** when `TET_MAINNET=1`. |
| `TET_GENESIS_HASH` | computed | Override deterministic genesis hash (advanced). |
| `TET_FOUNDER_CLIFF_MS` | **365 days** | Founder genesis lock duration (`ledger.rs`). Use `0` in dev tests. |
| `TET_BASE_BLOCK_REWARD` | **`0.1` TET** | Per-block reward debited from worker pool (`consensus.rs`). |

There is **no** `TET_FOUNDER_ADDRESS` env var in code; use **`TET_FOUNDER_WALLET`** / **`TET_GENESIS_FOUNDER_WALLET_ID`**.

### Genesis hash immutability

`deterministic_genesis_hash(founder, treasury)` includes:

- `chain_id` (`TET_CHAIN_ID`, default `tet-local-dev` or `tet-mainnet-1`)
- Founder wallet + micro-amounts
- Worker pool sentinel + micro-amounts
- **Treasury address** + 25% micro-amount
- `MAX_SUPPLY_MICRO`

**Changing `TET_TREASURY_ADDRESS` after genesis on an existing `TET_DB_DIR` causes startup failure** (`TET_TREASURY_ADDRESS mismatch: env=… ledger=…`). Wiping the DB is required to change treasury. This is incompatible with pre–Phase 2B ledgers that minted to the ecosystem sentinel `000…0002`.

### Treasury startup failure conditions

The process exits at startup (exit code **2** from `StartupConfig`) when:

1. **`TET_TREASURY_ADDRESS` unset** — `Invalid("TET_TREASURY_ADDRESS is required")`.
2. **Empty string** — `TET_TREASURY_ADDRESS must not be empty`.
3. **Invalid format** — not exactly **64 ASCII hex digits**.
4. **Ledger already has genesis** (`META_TREASURY_WALLET` stored) and env **≠** stored value.

Empty ledger: env is validated and treasury is written at **`apply_genesis_allocation`**.

### Sovereign OS UI (`tet-network/ui`) — post-quantum WASM (required)

**A fresh clone cannot sign anything until you build this.** The UI produces every ML-DSA-44
signature through `tet-pqc-wasm`, loaded at runtime from `/pqc/tet_pqc_wasm.js`. That build output
is **gitignored** (`tet-network/ui/public/pqc/.gitignore`), so it is absent after `git clone` and
wallet unlock, transfers, Tmail and Files all fail until it exists.

```bash
# one-time: install wasm-pack
cargo install wasm-pack

# from the repository root — regenerate after any change to tet-pqc-wasm/
wasm-pack build tet-pqc-wasm \
  --target web \
  --out-dir ../tet-network/ui/public/pqc
```

Verify the four expected artifacts exist:

```bash
ls tet-network/ui/public/pqc
# tet_pqc_wasm.js  tet_pqc_wasm_bg.wasm  tet_pqc_wasm.d.ts  tet_pqc_wasm_bg.wasm.d.ts
```

If the UI console shows a failed import of `/pqc/tet_pqc_wasm.js`, this step was skipped.

> Automating this in CI is an open Sprint 4 item (`docs/SPRINT_PLAN.md` §S4 — CI/CD).

### Sovereign OS UI (`tet-network/ui`) — genesis hash env

Hybrid-signed requests (inference, airdrop, future transfer) embed `chain_id` + `genesis_hash`. The UI computes the same hash as `deterministic_genesis_hash(founder, treasury)` when **`NEXT_PUBLIC_TET_GENESIS_HASH`** is unset.

Copy `tet-network/ui/.env.example` → `.env.local` and set:

| Variable | Must match node |
|----------|-----------------|
| `NEXT_PUBLIC_TET_TREASURY_ADDRESS` | **`TET_TREASURY_ADDRESS`** (64 hex) |
| `NEXT_PUBLIC_TET_CHAIN_ID` | **`TET_CHAIN_ID`** (if set) |
| `NEXT_PUBLIC_TET_MAINNET` | **`TET_MAINNET`** (`1` → `tet-mainnet-1`) |
| `NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID` or `NEXT_PUBLIC_TET_FOUNDER_WALLET` | **`TET_GENESIS_FOUNDER_WALLET_ID`** / **`TET_FOUNDER_WALLET`** |

```bash
cd tet-network/ui
cp .env.example .env.local
# edit NEXT_PUBLIC_TET_TREASURY_ADDRESS to match your node
npm run dev
```

Static cross-check (no node required):

```bash
cd tet-network/ui
node scripts/verify-genesis-hash.mjs
```

**Verifying hash against a running node**

- **`GET /ledger/me` does not return `genesis_hash`** (balance / supply fields only).
- **`GET /ledger/state` does not return `genesis_hash`** either.
- Options:
  1. Compare UI output from `node scripts/verify-genesis-hash.mjs` (with the same founder + treasury + chain_id as the node) to the hash stored at genesis — e.g. inspect ledger meta on first boot logs, or set `NEXT_PUBLIC_TET_GENESIS_HASH` from a known-good value.
  2. Set **`NEXT_PUBLIC_TET_GENESIS_HASH`** explicitly to the node’s stored hash (advanced; skips local computation).
  3. Trigger a hybrid-signed dev call (e.g. initial airdrop): node rejects with `chain_id/genesis_hash` mismatch if UI env is wrong.

**Dev golden vector** (default founder `57e0b29d…`, treasury `fedcba09…`, `chain_id=tet-local-dev`):

`0x9d6ccb1354b31419ade378aef68de58e854938df795b69cf76777e3483efbb36`

---

## 6. Bootnode PeerId — source of truth

1. **Persistent identity:** `{TET_DB_DIR}/libp2p_keypair.bin` — recreating the same DB directory preserves PeerId across restarts.
2. **Startup banner:** stderr shows `libp2p PeerId: 12D3KooW…` and `Full multiaddr (TET_P2P_LISTEN): …/p2p/<PeerId>` (`p2p_keystore::log_peer_id_banner`).
3. **Block plane log:** `[P2P-block] listening on /ip4/…/tcp/…/p2p/12D3KooW…` — **this** is what `start-3-node-testnet.sh` parses for `TET_BOOTNODES`.

Followers must dial the **block-plane** multiaddr (same `TET_P2P_LISTEN` host/port + `/p2p/PeerId`), not the inference swarm port.

**Do not** delete `libp2p_keypair.bin` on a bootnode if you want stable `TET_BOOTNODES` documentation.

### The public seed

| | |
|---|---|
| **Multiaddr** | `/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC` |
| **Host** | Hetzner `ubuntu-4gb-hel1-3`, Helsinki — Ubuntu 24.04.3, 2 vCPU, 3.7 GB RAM, 4 GB swap |
| **Open to the internet** | `22/tcp`, `8002/tcp`. Nothing else — REST is loopback-only, no UI |
| **Identity** | `/data/libp2p_keypair.bin` inside the `tet_core_data` volume. Deleting that volume changes the PeerId and invalidates every line above |
| **Provisioned by** | [`deploy/provision-seed.sh`](../deploy/provision-seed.sh) + [`deploy/docker-compose.seed.yml`](../deploy/docker-compose.seed.yml) |

Re-provision or update it with:

```bash
COPYFILE_DISABLE=1 git archive --format=tar HEAD \
  | ssh root@95.217.158.153 'mkdir -p /opt/TET-OS && tar -x -C /opt/TET-OS'
ssh root@95.217.158.153 'cd /opt/TET-OS && bash deploy/provision-seed.sh'
```

The seed holds **no** credential — the source is pushed over the operator's own SSH session rather
than pulled with a key, so a host whose whole job is accepting connections from strangers on 8002
has nothing to steal. `git archive HEAD` ships tracked files only, so `deploy/secrets/` and `.env`
stay on the workstation by construction. The trade-off is that the seed cannot update itself; run
the two commands above to deploy a new commit.

---

## 7. REST API (essentials)

Base URL: `http://<host>:<PORT>` (default `http://127.0.0.1:5010`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ledger/state` | Height, `state_root`, mempool, **sync gate** |
| GET | `/ledger/balance/:wallet` | Wallet balance (micro-units) |
| GET | `/ledger/blocks` | Recent blocks |
| GET | `/ledger/block/:height` | Block detail + txs |
| GET | `/ledger/me` | Node / wallet context |
| POST | `/ledger/mine` | Manual mine (dev) |
| POST | `/ledger/transfer` | Transfer (signed) |

Admin / faucet routes may require `TET_ADMIN_API_KEY` (see `tet-core/.env.example`).

### Reading sync status

```json
{
  "block_height": 42,
  "state_root": "0x…",
  "synced": false,
  "sync": {
    "active": true,
    "lag_blocks": 3,
    "best_peer_height": 45,
    "best_peer_id": "12D3KooW…",
    "in_progress_request": { "from_height": 43, "to_height": 45 }
  }
}
```

- **`synced: false`** while catching up, awaiting first hello (when `TET_BOOTNODES` set), or **tip conflict** (same height, different `state_root` / `tip_block_id` vs a peer).
- Auto-mine also waits **`TET_SYNC_STABLE_SEC`** after `synced` becomes true before producing blocks.

---

## 8. Troubleshooting

### Node does not sync

1. **Bootnode reachable?** `curl` REST on bootnode; check `[P2P-block] listening on` in its logs.
2. **`TET_BOOTNODES`** includes full `/p2p/PeerId` suffix matching bootnode’s `libp2p_keypair.bin`.
3. **`TET_VALIDATOR_IDS`** matches across validators (leader checks reject unknown producers).
4. **Firewall / loopback:** local testnet uses `127.0.0.1`; Docker uses service DNS names.
5. **`sync.lag_blocks` > 0`** — wait for catch-up; inspect `[P2P-block] catch-up` log lines.

### Auto-mine does not run

1. Confirm `TET_AUTO_MINE=1`.
2. Check `/ledger/state`: `synced` must be `true` (unless **`TET_AUTO_MINE_IGNORE_SYNC=1`** — dev only).
3. After sync, wait at least **`TET_SYNC_STABLE_SEC`** seconds (default 2).
4. Leader election: local `TET_WALLET_ID` must be leader for current height (single-validator testnets use one id everywhere).

### Treasury startup failure

| Symptom | Fix |
|---------|-----|
| `TET_TREASURY_ADDRESS is required` | Export a 64-hex address before launch. |
| `must not be empty` / `must be 64 hex chars` | Fix typo; no `0x` prefix. |
| `TET_TREASURY_ADDRESS mismatch` | Use the same treasury as genesis, or delete `TET_DB_DIR` and re-genesis. |

### `state_root` mismatch across nodes at same height

1. Wait for **`TET_SYNC_STABLE_SEC`** after heights align.
2. Indicates fork / divergent blocks — check logs for `catch-up apply rejected`.
3. Ensure all nodes share genesis parameters (`TET_TREASURY_ADDRESS`, founder, `TET_CHAIN_ID`).
4. Do not run mixed binary versions on one testnet.

### Database lock errors

Another `TET-Core` process holds `TET_DB_DIR`. Stop it or use a different `TET_DB_DIR` / `PORT`.

---

## 9. Phase 0 Alpha disclaimer

**This is Phase 0 testnet alpha software**, not mainnet.

Specifications that **may change before mainnet** (v1.1 whitepaper):

- Some **§12.5–§12.7** items may move to explicit Future Work.
- **R(T)** thermodynamic formula (§5.2) — implementation partially aligned; see [`WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md) (do not duplicate here).
- **Slash model** (§14.3) — full burn today; λ-based model planned for v1.1.

**Confirmed for this codebase:**

- **Genesis allocation §11.1:** **25% founder / 50% mining pool / 25% treasury** (treasury via `TET_TREASURY_ADDRESS`).

**Known limitations:**

- **Real LLM** not integrated (mock inference; Llama-3 targeted Phase 0.5).
- **Light client** protocol not shipped (Phase 1).
- **CAAC automatic role assignment** not implemented (roles via env / manual PoC flags).
- **Three libp2p swarms** per process (block / ledger replication / inference)
  remain separate. Consolidation may happen in a later sprint.

**Tokens:** Phase 0 testnet TET has **no relation** to future mainnet **10B TET** economics beyond using the same denomination for testing.

---

## Related docs

- [`CODEBASE_OVERVIEW.md`](./CODEBASE_OVERVIEW.md) — repository structure and module map (post Sprint 1)  
- [`STATUS.md`](./STATUS.md) — whitepaper vs implementation matrix  
- [`SPRINT1_DESIGN.md`](./SPRINT1_DESIGN.md) — block sync MVP design  
- [`SYNC_ISSUE.md`](./SYNC_ISSUE.md) — historical sync root-cause notes  
- [`tet-core/README.md`](../tet-core/README.md) — Docker quick start  
