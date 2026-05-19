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

### Docker alternative

See `tet-core/README.md` and `docker compose` for `tet-node-1`…`3`. Use `./scripts/print-bootnode.sh` for Docker PeerId discovery (reads container logs). Block-plane bootstrap must use the **`[P2P-block] listening on`** multiaddr, not legacy inference-only ports.

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

---

## 6. Bootnode PeerId — source of truth

1. **Persistent identity:** `{TET_DB_DIR}/libp2p_keypair.bin` — recreating the same DB directory preserves PeerId across restarts.
2. **Startup banner:** stderr shows `libp2p PeerId: 12D3KooW…` and `Full multiaddr (TET_P2P_LISTEN): …/p2p/<PeerId>` (`p2p_keystore::log_peer_id_banner`).
3. **Block plane log:** `[P2P-block] listening on /ip4/…/tcp/…/p2p/12D3KooW…` — **this** is what `start-3-node-testnet.sh` parses for `TET_BOOTNODES`.

Followers must dial the **block-plane** multiaddr (same `TET_P2P_LISTEN` host/port + `/p2p/PeerId`), not the inference swarm port.

**Do not** delete `libp2p_keypair.bin` on a bootnode if you want stable `TET_BOOTNODES` documentation.

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
