# TET-Core

> Sovereign Layer 1 node implementation for the TET Network.
> Post-quantum (ML-DSA), AI-native, hardware-adaptive consensus.

> ⚠️ **Phase 0 Alpha**: TET Network is in active development. The current
> codebase is a developer preview targeting Phase 0 public testnet launch.
> The whitepaper specification may be updated to v1.1 before mainnet.
> See [docs/RUNNING_A_NODE.md](../docs/RUNNING_A_NODE.md) for known limitations
> and operational guidance.

## What is this?

TET-Core is the **canonical** reference node for the TET Network: a persistent ledger with hybrid Ed25519 + ML-DSA authentication, libp2p mesh networking, and APIs that settle AI and enterprise workloads on-chain using deterministic tokenomics (including an 80/15/5 worker settlement split). It implements the Thermodynamic Execution Tree vision—binding compute intent, signatures, and ledger state—while CAAC (hardware-adaptive roles) and ZK-Court scaffolding evolve toward full PoC/PoR production consensus.

## Run a 3-node testnet in 30 seconds

```bash
git clone https://github.com/[REPO_URL]
cd Nexus_Network/tet-core
./scripts/start-network.sh
```

Open **http://localhost:3000** to access the UI (Sovereign OS: **http://localhost:3000/os**).

### Verify the network

```bash
curl http://localhost:5010/ledger/state
curl http://localhost:5020/ledger/state
curl http://localhost:5030/ledger/state
# After a few seconds, chain height should converge across nodes when TET_BOOTNODES is set.
```

### Stop the network

```bash
docker compose down
```

### Reset everything (delete all data)

```bash
docker compose down -v
```

Bootnode helper (manual): `./scripts/print-bootnode.sh tet-node-1`

## Run a node in 5 minutes

### Option A: Docker (recommended)

**Docker image coming soon** — use the local compose stack or Option B today.

Single node:

```bash
cd tet-core
docker compose up -d --build tet-node-1
sleep 15
curl http://localhost:5010/ledger/state
```

When published:

```bash
docker run -p 5010:5010 -p 5011:5011 \
  -v tet-data:/data \
  -e TET_DB_DIR=/data/tet.db \
  -e TET_ENABLE_P2P=1 \
  ghcr.io/tet-network/tet-core:latest
```

### Option B: From source

```bash
# Prerequisites: Rust 1.85+ (edition 2024), 4 GB RAM, 10 GB disk
git clone https://github.com/[REPO_URL]
cd Nexus_Network/tet-core

cp .env.example .env
# Optional: PORT=5010 TET_ENABLE_P2P=1

export RISC0_SKIP_BUILD=1
cargo build --release --bin TET-Core
./target/release/TET-Core
```

Default REST bind: `127.0.0.1:5010` (set `TET_REST_BIND=0.0.0.0:5010` for containers/LAN).

### Verify it's running

```bash
curl http://localhost:5010/ledger/state
# Expected: JSON with block height, supply, chain metadata, etc.

curl http://localhost:5010/status
```

## Connect the UI

In another terminal:

```bash
cd ../tet-network/ui
npm install
npm run dev
# Open http://localhost:3000
```

Sovereign OS (full wallet + explorer + AI terminal): **http://localhost:3000/os**

The UI proxies API calls to tet-core via `/tet-node-api/*` (or `NEXT_PUBLIC_TET_CORE_URL` if set).

## Create a wallet and send your first TX

1. Open **http://localhost:3000** and complete the wallet wizard (12-word mnemonic + PIN), or go to **/setup**.
2. Open **http://localhost:3000/os** and unlock the wallet (PIN). This loads Ed25519 + ML-DSA (WASM) into the hybrid signer session.
3. Confirm balance: status bar / **Transactions** tab (calls `GET /ledger/me`).
4. **Send Coins** tab: enter recipient `wallet_id` (64-char hex) and amount in TET → confirm. The UI signs with Ed25519 + ML-DSA and submits via the ledger API.
5. Optional dev faucet (non-production): `POST /ledger/faucet` with admin key if configured.

Legacy operator UIs served by the node itself:

- `http://localhost:5010/` — landing
- `http://localhost:5010/app` — worker dashboard
- `http://localhost:5010/core` — legacy core UI

## Architecture

TET-Core runs an **Axum** HTTP server over a **sled**-backed ledger (`ledger.rs`). Transactions are queued in a mempool and applied into blocks via `consensus.rs` (`POST /ledger/mine` or `TET_AUTO_MINE=1`). Identity is **stateless**: clients pass `wallet_id` (Ed25519 pubkey hex) or `x-tet-wallet-id`; sensitive flows require **hybrid** Ed25519 + ML-DSA signatures (`wallet.rs`, `quantum_shield.rs`).

**P2P** uses **libp2p** in two layers: `p2p_network.rs` (Gossipsub inference topic, Kademlia, relay/AutoNAT/WebRTC) and `p2p.rs` (mDNS, ping, block-sync request/response). Bootstrapping uses **`TET_BOOTNODES`** (comma-separated multiaddrs with `/p2p/<PeerId>`), not `TET_BOOTSTRAP_PEERS`.

- **Ledger:** sled (+ optional AES-256 at-rest encryption; JSON snapshot on shutdown)
- **P2P:** libp2p (gossipsub, Kademlia, mDNS, relay, WebRTC-direct)
- **Signatures:** Ed25519 + ML-DSA hybrid (ML-DSA-65 default on-node; ML-DSA-44 in browser WASM)
- **Consensus:** block production + validator set; **CAAC** PoC/PoR roles — see [`src/vision/`](./src/vision/)
- **AI execution:** optimistic paths + RISC0 zkVM dispute hooks (`zk_verifier.rs`, `methods/`)

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5010` | REST API port (with `TET_REST_BIND` unset, bind is `0.0.0.0:{PORT}` in recent builds — set explicitly in prod) |
| `TET_REST_BIND` | `0.0.0.0:{PORT}` | HTTP listen socket |
| `TET_DB_DIR` | `tet.db_{PORT}` | sled database directory |
| `TET_ENABLE_P2P` | `true` (if unset) | Set to `0`/`false` to disable all libp2p stacks |
| `TET_P2P_LISTEN` | `/ip4/0.0.0.0/tcp/0` | libp2p listen multiaddr (`p2p_network.rs`) |
| `TET_BOOTNODES` | — | Comma-separated bootnode multiaddrs (`/ip4/.../tcp/.../p2p/...`) |
| `BOOTNODES` | — | Alias for `TET_BOOTNODES` |
| `TET_DIAL_PEER` | — | Single explicit peer dial (back-compat) |
| `TET_IS_BOOTNODE` | `false` | Relay/listen behaviour for non-boot peers |
| `TET_AUTO_MINE` | off | Automatic block production loop |
| `TET_BLOCK_TIME_SEC` | `10` | Auto-miner interval (seconds) |
| `TET_DB_ENCRYPT` | off | Set to `strict` for production encryption |
| `TET_DB_KEY` / `TET_DB_KEY_B64` | — | AES-256 key for encrypted sled |
| `TET_PROD` / `TET_MAINNET` | off | Production hardening (requires DB key, forbids weak ZK) |
| `TET_WALLET_ID` | `local-wallet` | Dev node identity label / default wallet |
| `TET_DEV_FAUCET_MICRO` | — | Dev-only faucet credit on boot (disabled in prod) |
| `TET_HTTP_RPS` | `25` | Global HTTP rate limit |
| `RISC0_SKIP_BUILD` | — | Skip RISC0 guest build (CI/dev; set for `cargo build`) |
| `TET_JSON_LOG` | `true` | Structured JSON logs when `true` |

See [`.env.example`](./.env.example) for admin keys, founder mnemonic, and GCP templates.

**Not implemented (use alternatives):**

| Requested / docs elsewhere | Use instead |
|--------------------------|-------------|
| `TET_P2P_PORT` | `TET_P2P_LISTEN=/ip4/0.0.0.0/tcp/5011` |
| `TET_BOOTSTRAP_PEERS` | `TET_BOOTNODES` with full multiaddr including `/p2p/PeerId` |
| `TET_NODE_ROLE=bootstrap` | `TET_IS_BOOTNODE=1` |

## Connecting to the public network

Public bootstrap nodes are **not** published yet. For local development:

- Run the [Docker compose](#option-a-docker-recommended) stack, or
- Start two nodes on a LAN and copy node-1’s **PeerId** from logs, then:

```bash
# Peer multiaddr must include /p2p/<PeerId> (generated at runtime today)
export TET_BOOTNODES="/ip4/192.168.1.10/tcp/5011/p2p/12D3KooW..."
export TET_P2P_LISTEN="/ip4/0.0.0.0/tcp/5021"
export TET_ENABLE_P2P=1
cargo run --release --bin TET-Core
```

Secondary discovery: `p2p.rs` enables **mDNS** on the same host/LAN (useful in Docker bridge networks once PeerIds are wired).

## Documentation

- Whitepaper: [`../WHITEPAPER.md`](../WHITEPAPER.md)
- Litepaper: [`../LITEPAPER.md`](../LITEPAPER.md)
- Architecture notes: `src/vision/`, [`BRIDGE_INTERFACES.md`](./BRIDGE_INTERFACES.md)
- API reference: [`openapi.yaml`](./openapi.yaml), [`../PUBLIC_API.md`](../PUBLIC_API.md)

## Status

This is **genesis draft v0.1** software. Do not join a production network with real funds yet.

Hackers welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Dual-licensed under **Apache-2.0** ([`LICENSE-APACHE`](./LICENSE-APACHE)) OR **MIT** ([`LICENSE-MIT`](./LICENSE-MIT)).

---

## Advanced

### Build / lint / test

```bash
cargo fmt
RISC0_SKIP_BUILD=1 cargo clippy -- -D warnings
RISC0_SKIP_BUILD=1 cargo test
```

### Persistence & graceful shutdown

The ledger persists in **sled** (`TET_DB_DIR`). On SIGTERM/SIGINT the server flushes sled and writes a best-effort JSON snapshot (`TET_LEDGER_JSON_PATH` or derived path).

### Tokenomics (AI settlement)

Demand-side AI payments via `settle_ai_utility_payment()` in `ledger.rs`:

- **80%** → worker
- **15%** → `dex:treasury`
- **5%** → burned

Units: **micro-TET** on-chain — `1 TET = 1_000_000` micro units (`STEVEMON` constant in code; aligns with [`WHITEPAPER.md`](../WHITEPAPER.md) §5–§6). PoC/PoR thermodynamic rewards per §5.2 are separate from this AI settlement split.

### Enterprise API

- `POST /enterprise/inference` — `SignedTxEnvelopeV1`, hybrid signatures, optional attestation routing
- Browser SDK: `GET /assets/tet_sdk.js`
- Node SDK: `GET /assets/tet_sdk_node.mjs`

### Stateless identity (CRITICAL)

The node does **not** store per-client “active wallet” state.

- Query: `GET /ledger/me?wallet_id=<64hex>`
- Header: `x-tet-wallet-id: <64hex>`

### Genesis Guardians

First workers from `system:worker_pool` receive guardian grants (`GENESIS_GUARDIANS_TOTAL`, `GENESIS_GUARDIAN_GRANT_MICRO` in `ledger.rs`). Register via `POST /worker/register`.

### Code layout

| Path | Role |
|------|------|
| `src/ledger.rs` | Balances, blocks, staking, tokenomics |
| `src/rest/` | HTTP routing and handlers |
| `src/protocol.rs` | `SignedTxEnvelopeV1` / `TxV1` |
| `src/wallet.rs` | Mnemonic, signatures, ML-DSA |
| `src/consensus.rs` | Mining, validator set |
| `src/p2p_network.rs` | Inference gossip + bootnodes |
| `src/p2p.rs` | mDNS, block sync |
| `src/worker_ai.rs` | Local inference |

### Docker compose verification

```bash
docker compose up -d
sleep 30
curl http://localhost:5010/ledger/state   # node-1
curl http://localhost:5020/ledger/state   # node-2
# Open http://localhost:3000
```

After `tet-node-1` starts, inspect logs for libp2p **PeerId** and set `TET_BOOTNODES` on peers for full mesh bootstrap.

### クイックスタート（日本語）

```bash
cp .env.example .env
RISC0_SKIP_BUILD=1 cargo run --bin TET-Core
```

主な特徴: ハイブリッド暗号（Ed25519 + ML-DSA）、sled 台帳、libp2p メッシュ、mempool + `/ledger/mine`、RISC Zero 統合（`VerifyZkProof` / `/ledger/zk_verify`）。
