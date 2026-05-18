# Block Sync Diagnosis — 3-Node height 15 / 0 / 0

**Symptom (observed 2026-05-18):** Bootstrap node `TET_AUTO_MINE=1` reaches `block_height ≈ 15`; peers on 5020/5030 stay at `0` while P2P shows `PING OK` / `mdns connected` to bootnode PeerId.

**Scope:** `tet-core/src/p2p.rs`, `tet-core/src/p2p_network.rs`, `tet-core/src/network.rs`, `tet-core/src/consensus.rs`, `tet-core/src/main.rs`

---

## 1. Architecture: three independent libp2p swarms

Each enabled node starts **three** stacks (same keypair after recent keystore fix, **different listen addresses and topics**):

| Stack | File | Listen | Gossip topic(s) | Role |
|-------|------|--------|-----------------|------|
| NetworkManager | `network.rs` | `TET_P2P_LISTEN` | `/tet/v1/ledger` | Signed ledger snapshot replication (`replication.rs`) |
| Nexus P2P engine | `p2p_network.rs` | `TET_P2P_LISTEN` + WebRTC UDP | `nexus-inference-v1` | AI inference request/result loop |
| mDNS / block sync | `p2p.rs` | **`/ip4/0.0.0.0/tcp/0`** (ephemeral) | `/tet/v1/blocks`, `/tet/v1/txs`, `/tet/v1/ai-workload` | **Block gossip + block-sync RPC** |

**Implication:** Bootnode multiaddr `127.0.0.1:5011` targets `p2p_network` / `network` listeners, **not** the ephemeral port where block gossip runs. mDNS may still connect peers on LAN, but **bootstrap dial to :5011 does not guarantee membership in the block-gossip mesh**.

---

## 2. Block propose → gossip publish

### 2.1 Mining path **does** enqueue gossip

After local mining, `consensus.rs` sends `NetworkEvent::BlockMined { ... }` JSON on `state.gossip_tx`:

- `mine_pending_block_as` → lines ~1258–1274  
- `mine_coinbase_only_block_as` → lines ~1143–1159  

`main.rs` wires `gossip_tx` only to `p2p::start_mdns_ping_swarm` (not to `p2p_network` or `network`).

### 2.2 Publish to gossipsub

`p2p.rs` `run_mdns_ping_swarm`:

- Receives JSON on `publish_rx`
- `network_event_topics()` maps `BlockMined` → **`/tet/v1/blocks`** (+ `/tet/v1/ai-workload` if AI txs)
- Calls `gossipsub.publish(topic, msg.as_bytes())`

**Conclusion:** ✅ Proposer **does** publish block announcements — but **only on the `p2p.rs` swarm**, topic **`/tet/v1/blocks`** (not `/nexus/v1/blocks`).

### 2.3 Topic name consistency

| Path | Topic constant | Value |
|------|----------------|-------|
| Send (`p2p.rs`) | `BLOCKS_TOPIC` | `/tet/v1/blocks` |
| Receive (`p2p.rs`) | subscribed `blocks_topic` | `/tet/v1/blocks` |
| Inference (`p2p_network.rs`) | `INFERENCE_TOPIC` | `nexus-inference-v1` |

**No `/nexus/v1/blocks` in codebase.** Send/receive for blocks are **consistent within `p2p.rs`**.

`p2p_network.rs` does **not** handle block gossip; it only handles inference-shaped JSON on `nexus-inference-v1`.

---

## 3. Receive path → ledger apply

### 3.1 Gossip handler

`p2p.rs` ~870–1038: on `Gossipsub::Message`, parses `NetworkEvent::BlockMined` and calls:

```text
consensus::apply_remote_block_from_gossip(ledger, mempool, gossip)
```

Orphan / missing parent → `validate_and_record_backfill_candidate` + **`block_sync` request-response** (`/tet/v1/block-sync/json`).

### 3.2 Apply rules (why height stays 0)

`consensus.rs` `apply_remote_block_from_gossip`:

| Condition | Result |
|-----------|--------|
| `block_height < local_height` | **Skipped** (stale) |
| `block_height > local_height + 1` | **Skipped** — `"missing previous blocks"` |
| `block_height == local_height + 1` | Validates leader, rewards, state_root → **may apply** |
| Leader / validator mismatch | **Rejected** |
| Same height, different block_id | Fork logic; full reorg often **unsupported** |

**Root cause #1 — tip-only gossip, no catch-up:**  
If a peer starts at height `0` and the bootnode is already at height `15`, the first gossiped message is typically **height 15**. That fails `block_height > local_height + 1` and is **skipped**, not queued for bulk sync. Intermediate blocks 1–14 are **not** re-broadcast historically.

**Root cause #2 — backfill is parent-driven, not height-range:**  
Block-sync RPC fetches **one block by id** when parent is missing. It does not implement “sync from genesis to tip” or “headers-first” walk. Catching up from 0→15 requires **15 sequential successes** triggered by orphan logic; if gossip never delivers height `1` first, the pipeline stalls.

**Root cause #3 — split listen planes:**  
Even with PING on bootnode PeerId, followers may be connected on **mdns/random ports** while block gossip mesh is a **subset** of connected peers. Multiple swarms on one host also produced `AddrInUse` / `InvalidData` transport errors in logs (contention on same machine).

**Root cause #4 — optional validator set misconfiguration:**  
Without shared `TET_VALIDATOR_IDS`, each node defaults to `{local-wallet}` only. Leader checks use **global** producer id from the block; with identical `local-wallet` on all dev nodes this may pass, but **production multi-validator** setups will reject foreign producers until env is unified.

**Root cause #5 — `TET_AUTO_MINE` only on node 1:**  
Followers do not mine; they **depend entirely** on gossip/sync. No pull-based sync loop runs in the background.

---

## 4. What is **not** the primary bug

- **Topic typo `/nexus/v1/blocks`:** not used; blocks use `/tet/v1/blocks` end-to-end in `p2p.rs`.
- **Missing publish on mine:** publish exists via `gossip_tx`.
- **Missing receive handler:** handler exists and can apply blocks (unit tests in `tests.rs` cover `apply_remote_block_from_gossip`).

---

## 5. Recommended fix design (no code — architecture only)

### Phase A — Unify transport (prerequisite)

1. **Single libp2p swarm per process** (or single gossipsub + shared behaviour), one listen multiaddr (`TET_P2P_LISTEN`), one PeerId.
2. Deprecate parallel `network.rs` + `p2p_network.rs` + `p2p.rs` listeners on the same port/key, **or** clearly separate concerns:
   - Blocks + txs + ledger snapshots on one mesh
   - Inference on a **subtopic** of the same gossipsub, not a second TCP listener

### Phase B — Sync protocol (fixes 15/0/0)

1. **Status handshake** on connect: exchange `(height, head_block_id, state_root)`.
2. If `peer_height > local_height`:
   - **Pull range:** `GET blocks [local+1 .. min(peer, local+K)]` via request-response (extend `BLOCK_SYNC_PROTOCOL` or add `/tet/v1/chain-sync/range`).
   - Apply **in order** with existing `apply_remote_block_from_gossip` rules.
3. **Gossip remains tip announcement** only; catch-up is always pull-based.
4. On startup, **mandatory sync** before serving `/ledger/state` as “synced” (optional readiness flag).

### Phase C — Operational testnet defaults

1. Document required env for multi-node:
   - `TET_VALIDATOR_IDS=wallet1,wallet2,wallet3`
   - `TET_AUTO_MINE=1` only on current leader, **or** hash leader with shared validator set
2. Integration test: 3 nodes, assert `|height_i - height_j| <= 2` within 120s (matches prior E2E expectation).

### Phase D — Observability

1. Log line on skip: `REMOTE BLOCK SKIPPED reason=...` (already printed) → promote to structured `WARN` with height/local_height.
2. Metric: `tet_p2p_blocks_applied_total`, `tet_p2p_blocks_skipped_total{reason}`.

---

## 6. Verification commands (after Phase B)

```bash
# 3-node local (same as prior E2E)
# ... start nodes ...
for p in 5010 5020 5030; do
  curl -s http://127.0.0.1:$p/ledger/state | jq .block_height
done
# Expected: three heights within ±2
```

```bash
grep -E "REMOTE BLOCK APPLIED|REMOTE BLOCK SKIPPED|missing previous" /tmp/tet-node-2.log | tail -20
# Expected after fix: APPLIED monotonic heights, no permanent "missing previous" at tip
```

---

## 7. Sprint 1 design (Phase A — 2026-05-18)

**Decision:** Option **(b)** — keep three swarms for Sprint 1; fix block-plane listen (`TET_P2P_LISTEN` on `p2p.rs`) and add **pull-based range catch-up** (`/tet/v1/chain-sync/range/json` + `ChainHello`).

Full specification: **[`docs/SPRINT1_DESIGN.md`](./SPRINT1_DESIGN.md)**

### Implementation checklist (Phase B — not started)

- [ ] `p2p.rs`: listen on `TET_P2P_LISTEN` (not hardcoded `tcp/0`)
- [ ] Range sync RPC + `ChainHello` handshake
- [ ] `sync.rs`: coordinator loop; gossip height-gap triggers pull
- [ ] Ordered apply via existing `apply_remote_block_from_gossip` (no relax of `local+1` rule)
- [ ] `GET /ledger/state`: `synced` + `lag_blocks`
- [ ] Integration test + 3-node E2E (heights within ±2)

---

## 8. Related tests (already in tree)

- `tests.rs`: `phase2_mempool_mine_and_apply_block_to_peer`, remote gossip / reorg cases — pass **in-process**, not over live 3-node TCP.
- Live gap is **wiring + sync policy**, not missing ledger apply function.
