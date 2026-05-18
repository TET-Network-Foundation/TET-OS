# Sprint 1 — Block Sync MVP (Design)

**Status:** Phase A **reviewed** (2026-05-18) — Phase B in progress (Step B.1 pending Steve go-ahead)  
**Date:** 2026-05-18  
**Goal:** 3-node testnet where `block_height` differs by **≤ 2** across nodes within ~120s  
**Sources of truth:** [`SPRINT_PLAN.md`](./SPRINT_PLAN.md) Sprint 1, [`SYNC_ISSUE.md`](./SYNC_ISSUE.md)

**Out of scope (Sprint 2+):** full single-swarm merge of inference + ledger replication; leader-only auto-mine policy; fork reorg hardening beyond ordered catch-up.

---

## 0. Problem recap

| # | Issue | Evidence |
|---|--------|----------|
| 1 | **Three libp2p swarms** per process | `network.rs` (`/tet/v1/ledger`), `p2p_network.rs` (`nexus-inference-v1`), `p2p.rs` (blocks + block-sync RPC) |
| 2 | **Block swarm listens on ephemeral port** | `p2p.rs` L595 hardcodes `/ip4/0.0.0.0/tcp/0`; compose advertises `TET_P2P_LISTEN` on **5011** for other stacks only |
| 3 | **Tip-only gossip + strict apply** | `apply_remote_block_from_gossip` skips `height > local+1` (`consensus.rs` L1314–1319) |
| 4 | **Backfill is by block_id, not range** | `BlockRequest { block_id }` on `/tet/v1/block-sync/json` (`p2p.rs` L43–46) — no genesis→tip walk |
| 5 | **No background pull loop** | Followers with `TET_AUTO_MINE=0` never catch up from height 0 when bootnode is at 15 |

Gossip publish/receive **works in principle**; the failure mode is **policy + transport split**, not missing `BlockMined` publish.

---

## A.1 Single-swarm integration decision

### Options

| Option | Summary | Pros | Cons |
|--------|---------|------|------|
| **(a) Full merge** | One `Swarm` + gossipsub; blocks, txs, ledger snapshots, inference as topics | Clean architecture; one PeerId / listen / bootstrap | High regression risk; touches `main.rs`, `network.rs`, `p2p_network.rs`, `replication.rs`, inference path |
| **(b) Keep swarms + sync on block plane** | Leave 3 stacks; fix **block** listen + add **pull catch-up** on existing `p2p.rs` swarm | Minimal blast radius; matches `SPRINT_PLAN.md` risk row (“pull-sync first, merge Sprint 2”); reuses `BlockSync` behaviour | Still 3 TCP listeners; operational complexity remains |
| **(c) Hybrid** | Merge blocks + ledger replication into `p2p.rs`; keep inference on `p2p_network.rs` | Medium cleanup | Still two swarms; more refactor than (b) for partial benefit |

### **Decision: (b)** — *現状維持 + block-plane sync RPC & listen fix*

**Rationale (code review):**

1. **Sprint 1 DoD is height convergence**, not P2P architecture purity. Option (b) directly addresses root causes #1 (for blocks), #3, #4, #5 in `SYNC_ISSUE.md`.
2. **`p2p.rs` already has** gossipsub on `/tet/v1/blocks` and `request_response::json` for `BlockRequest`/`BlockResponse` (`BLOCK_SYNC_PROTOCOL`). Extending with **range sync** is incremental.
3. **`main.rs` already reads `TET_P2P_LISTEN`** (L371–372) but **does not pass it** to `start_mdns_ping_swarm` — fixing listen alignment is a one-line-equivalent design change in Phase B, not a full merge.
4. **Steve の事前推奨 (b) と一致。** Option (a) remains **Sprint 2** per `SPRINT_PLAN.md` (“Single-swarm inference topic”).

### Listen address — **Decision (i): share `TET_P2P_LISTEN` on the block-plane Swarm**

Steve review confirmed **(i)**, not **(ii)** (no new `TET_BLOCK_LISTEN` env var).

| Option | Description | Sprint 1 |
|--------|-------------|----------|
| **(i)** | Block-plane `p2p.rs` Swarm listens on **`TET_P2P_LISTEN`** (passed from `main.rs`). Gossipsub, ping, identify, kademlia, `/tet/v1/block-sync/json`, and new chain-sync protocols **multiplex on one TCP listener** via libp2p (already one `Swarm` + `NetworkBehaviour`). | **Adopted** |
| **(ii)** | Separate env e.g. `TET_BLOCK_LISTEN` for block swarm only | **Rejected** — avoids operator config drift; Sprint 2 may merge swarms instead |

**Why (i) is sufficient for libp2p:** request-response and gossipsub are behaviours on the **same** Swarm; they do not need a second TCP port. The prior bug was `p2p.rs` hardcoding `tcp/0` while bootnode docs pointed at `TET_P2P_LISTEN` used by **other** stacks.

**Across the three stacks (Sprint 1 unchanged):** `network.rs`, `p2p_network.rs`, and `p2p.rs` remain **separate Swarms**. Steve: **do not disable** `network.rs` in compose. All three may still attempt `TET_P2P_LISTEN` inside one container (known `AddrInUse` risk on a single host). Sprint 1 scope:

- Block catch-up **must not depend** on `network.rs` / `/tet/v1/ledger` (prove in Phase C).
- `TET_BOOTNODES` / `print-bootnode.sh` must advertise the **block swarm** dial address (log at startup after `listen_on`).
- Triple-bind resolution → **Sprint 2** single-swarm merge.

### Phase B prerequisites under (b)

| Change | Purpose |
|--------|---------|
| `start_mdns_ping_swarm(..., listen: Multiaddr)` with `listen = TET_P2P_LISTEN` from `main.rs` | Replace hardcoded `tcp/0` (L595) |
| Log **`[P2P] block swarm listen: ...`** with full `/p2p/PeerId` multiaddr | Bootstrapping targets block plane |
| `TET_BOOTNODES` includes **`/p2p/<peer_id>`** on that listen addr | Peers join block gossip + chain-sync mesh |

---

## A.2 Pull-based catch-up protocol

### Design principles

1. **Gossip = tip announcement only** (unchanged publish path via `gossip_tx`).
2. **Catch-up = always pull**, never rely on historical gossip for heights `local+2..peer`.
3. **Apply rule unchanged:** each applied block must satisfy `height == local_height + 1` — pull delivers an **ordered** slice so `apply_remote_block_from_gossip` succeeds without relaxing L1314–1319.
4. **Extend** existing JSON request-response on the **block swarm**; do not overload `SignedTxEnvelopeV1` in `protocol.rs`.

### Protocol layering

| Layer | Location | Notes |
|-------|----------|-------|
| P2P wire types | **`p2p.rs`** (today) or new **`sync.rs`** re-exported | Keeps `protocol.rs` for **ledger transactions** only |
| Ledger apply | **`consensus.rs`** | Reuse `apply_remote_block_from_gossip`; add `block_record_to_remote_gossip(BlockRecordV1) -> RemoteBlockGossip` helper |
| Coordinator | **`sync.rs`** (recommended new) | State machine, peer selection, batch loop |
| Swarm I/O | **`p2p.rs`** | New RR protocol + `Hello` on identify/connection |

**Namespace:** New stream protocol id (do not break existing single-block fetch):

| Protocol ID | Request | Response | Replaces |
|-------------|---------|----------|----------|
| `/tet/v1/block-sync/json` | `BlockRequest { block_id }` | `BlockResponse { block, .. }` | Orphan backfill (keep) |
| **`/tet/v1/chain-sync/range/json`** | `ChainSyncRangeRequest` | `ChainSyncRangeResponse` | **New** bulk catch-up |
| **`/tet/v1/chain-sync/hello/json`** | `ChainHello` | `ChainHello` (echo or ack) | Status handshake |

### Message schemas (JSON)

```rust
// Proposed — implement in sync.rs or p2p.rs, NOT in protocol.rs (TxV1 namespace)

#[derive(Serialize, Deserialize)]
pub struct ChainHello {
    pub chain_id: String,           // optional: genesis hash or TET_CHAIN_ID env
    pub block_height: u64,
    pub tip_block_id: String,
    pub state_root: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChainSyncRangeRequest {
    /// Inclusive start height. Must be >= 1 for non-genesis blocks.
    pub from_height: u64,
    /// Inclusive end height. Server clamps to local tip.
    pub to_height: u64,
}

#[derive(Serialize, Deserialize)]
pub struct ChainSyncRangeResponse {
    pub from_height: u64,
    pub to_height: u64,
    /// Ordered by block_height ascending; each entry is full BlockRecordV1 + embedded txs
    /// OR compact RemoteBlockGossip payloads (prefer BlockRecordV1 — already stored on disk).
    pub blocks: Vec<crate::ledger::BlockRecordV1>,
}
```

**Validation rules (responder):**

- Reject if `from_height > to_height`.
- **Batch cap (dual limit — Steve review):** include blocks in ascending height order until **either**:
  - **100 blocks** (`MAX_SYNC_BATCH_BLOCKS`), **or**
  - cumulative serialized JSON size **≥ 8 MiB** (`MAX_SYNC_BATCH_BYTES`, default `8 * 1024 * 1024`),
  whichever is reached **first**.
- Rationale: gossipsub caps (default ~1 MiB per message, configurable via `TET_P2P_GOSSIP_MAX_MSG_BYTES`) do not protect range RPC; large blocks with txs can exceed a count-only cap.
- Reject oversize requests where `from_height..=to_height` cannot be satisfied within both caps (client must shrink range).
- Return empty `blocks` if peer has no records in range (client tries another peer).
- Clamp `to_height` to `min(request.to_height, local_tip_height)`.

**Client algorithm (`sync.rs`):**

```
on peer_connected OR periodic tick (e.g. 5s):
  hello = local ChainHello
  exchange with peer -> peer_hello
  if peer_hello.block_height <= local_height: continue
  target = peer_hello.block_height
  while local_height < target:
    from = local_height + 1
    to = min(target, from + MAX_SYNC_BATCH_BLOCKS - 1)  // responder also truncates by 8 MiB
    resp = RR ChainSyncRangeRequest { from, to }
    for block in resp.blocks ordered by height:
      gossip = block_record_to_remote_gossip(block)
      apply_remote_block_from_gossip(ledger, mempool, gossip).await
      if Skipped/Rejected: log, break batch, retry other peer
    if no progress in batch: break (stall)
```

**Timeouts & limits (defaults, env-overridable in Phase B):**

| Parameter | Default | Env (proposed) |
|-----------|---------|----------------|
| RR request timeout | **10s** | `TET_SYNC_RR_TIMEOUT_SECS` |
| Max blocks per request | **100** (or **8 MiB** first) | `TET_SYNC_MAX_BATCH_BLOCKS`, `TET_SYNC_MAX_BATCH_BYTES` |
| Max parallel sync peers | **2** | `TET_SYNC_MAX_PEERS` |
| Hello / retry interval | **5s** | `TET_SYNC_POLL_INTERVAL_SECS` |
| Stall give-up (no progress) | **60s** | `TET_SYNC_STALL_SECS` |
| Target lag for `synced=true` | **≤ 2** | `TET_SYNC_MAX_LAG` (aligns with E2E) |

**When to trigger catch-up:**

| Trigger | Action |
|---------|--------|
| `ConnectionEstablished` + identify | Exchange `ChainHello` |
| Gossip `BlockMined` with `height > local+1` | **Do not only skip** — enqueue sync job for that peer (or best known tip peer) |
| Startup | Mandatory sync pass before `synced=true` (see A.3) |
| Periodic timer | Re-check max peer height vs local |

**Interaction with orphan backfill:**

- Keep `BlockRequest { block_id }` for single-block parent fetch.
- Range sync is the **primary** 0→N path; orphan path remains for forks / single missing parent.

**Range response builder (no `ledger.rs` change in Sprint 1):**

Implement in **`sync.rs`** (or `p2p.rs` handler calling sync helper):

1. For each `h` in `from_height..=to_height`, `ledger.canonical_block_id_at_height(h)` → `block_record_by_id`.
2. Stop early when block count or serialized byte budget hits dual cap.
3. Existing APIs: `canonical_block_id_at_height`, `block_record_by_id`, `chain_tip`, `block_height` — no new ledger surface required.

---

## A.3 Startup sync gate & REST

### `/ledger/state` extension

**Confirmed (Steve review):** `synced` + `sync` object ship in **Sprint 1** (operability / E2E).

```json
{
  "block_height": 15,
  "mempool_len": 0,
  "state_root": "...",
  "synced": false,
  "sync": {
    "local_height": 3,
    "best_peer_height": 15,
    "lag_blocks": 12,
    "active": true
  }
}
```

| Field | Semantics |
|-------|-----------|
| `synced` | `true` when `lag_blocks <= TET_SYNC_MAX_LAG` (default 2) **and** no in-flight range sync **and** at least one P2P peer seen **or** node is bootnode with `TET_IS_BOOTNODE=1` |
| `sync.active` | Coordinator currently pulling |
| `lag_blocks` | `max(0, best_known_peer_height - local_height)` |

### Gate behaviour

| Component | Behaviour |
|-----------|-----------|
| **HTTP server** | Starts immediately (no blocking HTTP bind on sync) |
| **`synced`** | `false` until catch-up criteria met |
| **Docker healthcheck** | HTTP up ≠ synced; followers should reach `synced=true` before E2E height check (Phase C) |
| **Auto-mine** | **Confirmed:** pause `spawn_auto_miner` until `synced` on **all nodes that are catching up** (prevents followers mining ahead and forking). Bootnode: `synced=true` when `TET_IS_BOOTNODE=1` **or** lag ≤ `TET_SYNC_MAX_LAG` with no higher peer |
| **`network.rs` swarm** | **Confirmed: do not disable** in compose. Block sync must not depend on ledger-replication gossip; prove in Phase C |

### State ownership

```
Arc<SyncCoordinator>  // new in main.rs
  -> shared with p2p swarm task (updates best_peer_height)
  -> shared with RestState (read for /ledger/state)
```

---

## A.4 Planned file changes (Phase B / C)

| File | Phase B change |
|------|----------------|
| **`tet-core/src/sync.rs`** *(new)* | Wire types (`ChainHello`, range req/resp), `SyncCoordinator`, range builder via existing ledger APIs, unit tests (B.1) |
| **`tet-core/src/p2p.rs`** | `TET_P2P_LISTEN`; chain-sync RR + hello handlers; hook coordinator (B.2–B.3) |
| **`tet-core/src/consensus.rs`** | `block_record_to_remote_gossip` (apply path stays here — **no ledger.rs edit**) |
| **`tet-core/src/main.rs`** | Pass `p2p_listen`; init `SyncCoordinator`; auto-mine gate; startup sync flow (B.4–B.5) |
| **`tet-core/src/rest/handlers/ledger.rs`** | `synced` + `sync` on `GET /ledger/state` (B.4) |
| **`tet-core/src/tests.rs`** | Phase C: catch-up / range / 3-node E2E helpers |
| **`tet-core/src/lib.rs` or `main.rs`** | `mod sync;` |
| **`docs/SYNC_ISSUE.md`** | Checklist updates as steps land |

**Removed from Sprint 1 scope:** `ledger.rs` — range responses use **`canonical_block_id_at_height` + `block_record_by_id`** only; `apply_remote_block_from_gossip` remains in `consensus.rs`.

**Not in Sprint 1:** merge `network.rs` / `p2p_network.rs` into one swarm; disable `network.rs` in compose.

### Phase B step map (Steve workflow)

| Step | Scope | Commit |
|------|--------|--------|
| **B.1** | `sync.rs` schemas + serde unit tests | No commit / no stage |
| **B.2** | `p2p.rs` RR handlers + listen fix | Review between steps |
| **B.3** | Catch-up driver (hello + range + apply) | |
| **B.4** | `/ledger/state` + auto-mine gate | |
| **B.5** | `main.rs` wiring + boot flow | → Phase C |

---

## Phase C — Test plan (design only)

### C.1 Unit / integration (in-process)

| Test name (proposed) | Assert |
|----------------------|--------|
| `chain_sync_range_returns_ordered_blocks` | Mock ledger with heights 1..5; handler returns ascending vec |
| `catch_up_applies_sequential_heights` | Local 0, inject peer blocks 1..N via coordinator; `block_height == N` |
| `apply_still_skips_gap_without_sync` | Single gossip height+2 without sync → still Skipped (regression) |

```bash
RISC0_SKIP_BUILD=1 cargo test --bin TET-Core catch_up chain_sync 2>&1 | tail -20
```

### C.2 Manual 3-node E2E

Per `SPRINT_PLAN.md` / `SYNC_ISSUE.md` §6:

```bash
cd tet-core && ./scripts/start-network.sh
sleep 120
for p in 5010 5020 5030; do
  curl -sf "http://127.0.0.1:$p/ledger/state" | jq '{h:.block_height,s:.synced,lag:.sync.lag_blocks}'
done
# PASS: max(h)-min(h) <= 2 AND followers synced==true
```

### C.3 Log acceptance

```bash
grep -E "CHAIN_SYNC|REMOTE BLOCK APPLIED|synced=true" /tmp/tet-node-2.log | tail -30
```

Expect monotonic `REMOTE BLOCK APPLIED` heights after `CHAIN_SYNC batch from=1`.

---

## Open questions — 要 Steve 判断

| # | Question | Status |
|---|----------|--------|
| 1 | `synced` in Sprint 1 | **Resolved** — yes |
| 2 | Disable `network.rs` in compose | **Resolved** — no; prove independence in Phase C |
| 3 | Auto-mine until synced | **Resolved** — yes |
| 4 | Listen (i) vs (ii) | **Resolved** — (i) `TET_P2P_LISTEN` on block swarm |
| 5 | `ledger.rs` in scope | **Resolved** — out of scope |
| 6 | `TET_VALIDATOR_IDS` in compose | Document; hard enforcement Sprint 2 |
| 7 | Triple-bind on one host (3 swarms, same env port) | Sprint 2 merge; use startup log for bootnode addr |

---

## References

| Doc | Section |
|-----|---------|
| [`SYNC_ISSUE.md`](./SYNC_ISSUE.md) | §1–5 root cause, §5 recommended fix |
| [`SPRINT_PLAN.md`](./SPRINT_PLAN.md) | Sprint 1 DoD, risk “pull-sync first” |
| `tet-core/src/p2p.rs` | L34–52 block-sync, L595 listen, L1012 apply |
| `tet-core/src/consensus.rs` | L1289–1319 apply rules |
| `tet-core/src/main.rs` | L371–446 three swarm startup |

---

*Phase A reviewed 2026-05-18. Proceed to Step B.1 after Steve acknowledges this diff.*
