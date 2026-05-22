# TET NETWORK
## Fluid P2P Compute–Energy Resource Protocol
## AI-Native Sovereign Layer 1

**Version:** Whitepaper v1.1 Draft  
**Date:** 2026-05-21  
**Author:** Steve  
**Title:** Founder-Architect, TET Network Project  
**Contact:** yizhenxianshi@gmail.com  

**Status:** Draft for review. Does **not** supersede [`WHITEPAPER.md`](../WHITEPAPER.md) (Genesis v1.0, 2026-04-28) until merged by explicit commit.  
**Implementation references:** [`docs/WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md), [`docs/SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md), [`docs/CODEBASE_OVERVIEW.md`](./CODEBASE_OVERVIEW.md), [`docs/STATUS.md`](./STATUS.md)  
**Canonical code:** `tet-core/` (Rust), `tet-network/ui/` (Sovereign OS)

---

## Document map

| Part | Sections | Scope |
|------|----------|--------|
| **I — Layer 1 Protocol** | §1–§13 | L1 mechanics + **Sovereign OS Suite (Phase 0)** |
| **II — Layer 2 Applications** | §14–§16 | Long-horizon primitives (not Phase 0 deliverables) |
| **III — Open Problems & Comparisons** | §17–§19 | Honest gaps, peer comparison, roadmap |

**Phase 0 language:** This draft describes a **public testnet / developer preview**, not a production mainnet. Mainnet parameters, REST stability, and economic schedules remain subject to change until explicitly frozen.

---

# Part I — Layer 1 Protocol

## 1. Introduction

Cloud AI infrastructure today is not a technical necessity; it is a capital structure. A small set of operators price inference, control availability, and impose correlated failure on every downstream application. Blockchains that treat all nodes as identical hardware competitors reproduce the same concentration under a different scarcity token (ASICs or stake).

TET Network responds at the protocol layer with a single premise: **compute is energy**. Every device that draws electricity can, in principle, contribute verified work or network maintenance. The protocol does not force smartphones to compete under data-center rules. **Context-Aware Adaptive Consensus (CAAC)** assigns roles from hardware reality: high-throughput nodes run **Proof of Compute (PoC)**; constrained edge nodes run **Proof of Relay (PoR)**.

This whitepaper separates what the **testnet ships today** (Part I) from **research-grade application primitives** (Part II) and from **explicit open problems** (Part III). Critique should target the mechanisms in Part I; Part II is directional intent, not a delivery commitment.

### 1.1 Relation to Genesis v1.0

Genesis Draft v1.0 (2026-04-28) mixed near-term L1 mechanics with long-term vision in a single §12. Version 1.1 **restructures** that material:

- v1.0 §4–§10, §14 → Part I (renumbered)
- v1.0 §12.5–§12.7 → Part II §13–§15
- v1.0 §12.1–§12.4 (RaaS, marketplace, agents, DeFi) → summarized under §3.3 (Phase 0/1 binding surface)
- v1.0 §13 roadmap → §18
- New: §5 implementation phases for the energy peg; §11 four-slot genesis; §13 Sovereign OS; §17 open problems; §18 comparison; §19 roadmap

---

## 2. Design Goals

1. **Post-quantum security from genesis** — ML-DSA (FIPS 204) as the base signature family; hybrid Ed25519 + ML-DSA for wallet transfer auth in Phase 0 (see §7).
2. **Hardware-adaptive consensus** — CAAC routes PoC vs PoR from measured or attested capability, not a single global puzzle.
3. **Thermodynamic economic binding** — Token issuance and inference settlement tied to **verified physical compute energy**, not abstract hash puzzles (§5). This is the differentiator vs labor markets (Bittensor) and compute-as-a-service brokers (Gensyn).
4. **Optimistic execution with cryptographic dispute resolution** — Sovereign Runtime accepts commitments; fraud challenged in ZK-Court (§8).
5. **Participation without industrial capital** — Edge light clients and PoR roles bound storage and verification cost for consumer hardware (§9).
6. **Honest documentation** — Where code diverges from prose, §17 records the gap; we do not paper over implementation debt.

---

## 3. Architecture Overview

### 3.1 System components

The canonical node implementation is **`tet-core`** (`TET-Core` binary):

| Subsystem | Primary modules | Role |
|-----------|-----------------|------|
| Ledger | `ledger.rs`, `genesis.rs` | sled-backed balances, genesis allocation, fees, burns |
| Consensus / mining | `consensus.rs` | Block production, gossip apply, CAAC leader hints |
| REST API | `rest/` | Axum HTTP surface for wallet, ledger, vision/ZK-Court |
| P2P (legacy stack) | `p2p.rs`, `network.rs` | Gossipsub blocks/txs, ledger snapshots |
| P2P (Phase 1 stack) | `p2p_network.rs`, `p2p_keystore.rs` | libp2p swarm, persistent PeerId |
| Vision / CAAC | `vision/caac.rs`, `vision/zk_court.rs`, `vision/thermo_genesis.rs` | Roles, disputes, thermodynamic estimates |
| ZK | `zk_verifier.rs`, `methods/` (RISC0 guest) | Receipt verification, challenge pipeline |
| Wallet crypto | `wallet.rs`, `quantum_shield.rs` | BIP39 → Ed25519 + ML-DSA hybrid messages |

**Chain binding:** Hybrid signed messages embed `chain_id` and `genesis_hash`. The canonical genesis hash is computed in **`tet-core/src/genesis.rs`** (single source of truth); `ledger.rs` and `wallet.rs` delegate to it.

### 3.2 CAAC + PoC + PoR + ZK-Court (control plane)

```text
                    ┌─────────────────────────────────────┐
                    │           TET-Core node              │
                    │  REST (wallet, ledger, vision)       │
                    └──────────────┬──────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
   ┌───────────┐            ┌──────────────┐          ┌─────────────┐
   │  Ledger   │◄──────────│  Consensus   │─────────►│  libp2p     │
   │  (sled)   │            │  auto-mine   │          │  gossipsub  │
   └───────────┘            └──────┬───────┘          └─────────────┘
                                   │
                    workload_flag=0 │ workload_flag=1
                         PoR path  │  PoC + inference
                                   ▼
                          ┌────────────────┐
                          │  ZK-Court      │
                          │  (RISC0 guest) │
                          └────────────────┘
```

### 3.3 Phase 0 / Phase 1 application surface (binding scope)

The following v1.0 §12.1–§12.4 capabilities remain **in scope for testnet and Phase 1**, but are not renumbered as separate whitepaper chapters in v1.1:

| Application | Phase 0 status | Notes |
|-------------|----------------|-------|
| Decentralized inference marketplace | **Partial** | REST + Sovereign OS UI; thermodynamic pricing via §5 Phase 0 approximation |
| Enterprise / AI workload transactions | **Partial** | `workload_flag=1` mempool path |
| Agent / M2M clients | **Partial** | `tet-agent-sdk/`; Agent-Gate is Part II |
| Native L2 RaaS | **Research** | Not operational on testnet |

Part II §13–§15 (World Brain, Sentient Assets, Agent-Gate) remain **explicitly out of Phase 0**.

---

## 4. Proof of Compute (PoC) and Proof of Relay (PoR)

### 4.1 Proof of Compute (PoC)

Nodes with sufficient GPU/CPU throughput are classified as **PoC producers**. They:

- Execute AI inference or heavy compute tasks off the hot ledger path.
- Submit cryptographic commitments to results (hashes, journals).
- Accept optimistic settlement during a **challenge window**; disputes escalate to ZK-Court (§8).

Rewards scale with **verified thermodynamic work** (§5), not with hash rate on a meaningless puzzle.

**Implementation:** `worker_daemon.rs`, `vision/caac.rs`, `consensus.rs` (AI workload blocks). PoC eligibility uses CAAC worker records and role flags.

### 4.2 Proof of Relay (PoR)

Constrained devices (mobile, IoT) participate as **PoR** nodes:

- Propagate blocks, transactions, and signed ledger snapshots.
- Perform lightweight ML-DSA / hybrid signature verification.
- Do **not** execute full inference workloads (`workload_flag=1` rejected on PoR routing).

Economic rewards are smaller than PoC but non-zero, preserving the “universal miner” design goal.

**Implementation:** `p2p.rs` gossip paths, `network.rs` ledger topic, edge verification in wallet/ledger read paths.

### 4.3 Workload flag (fluid transaction routing)

Transactions carry a binary **`workload_flag`**:

| Flag | Semantics | Routed to |
|------|-----------|-----------|
| `0` | Value transfer / maintenance | PoR-eligible validation |
| `1` | AI inference / compute request | PoC producers only |

Misrouting flag-1 work to edge nodes is rejected at the protocol layer (v1.0 §6, preserved in implementation via consensus and mempool filters).

---

## 5. Energy Peg — Thermodynamic Reward Model

### 5.1 Vision: the Sovereign Peg

**Claim (strategic):** TET pegs each unit of circulating supply to **verified physical compute energy** through a worker-specific thermodynamic efficiency term **η(W_i)**. Unlike labor-token markets that reward stake-weighted opinions, and unlike pure compute rental APIs that price hours without a chain-level energy conservation law, TET binds issuance to **η(W_i) · C(t_i)** aggregated over verified tasks, normalized by network difficulty **D(t)**.

The v1.0 continuous-time statement:

```
R(T) = Σ_{i ∈ verified_tasks(T)} [ η(W_i) · C(t_i) ] / D(t)
```

Where:

- **η(W_i)** — thermodynamic efficiency of worker *i* (energy out per unit useful compute, or equivalent joules attributed to verified work).
- **C(t_i)** — network compute price at task time *t_i*.
- **D(t)** — dynamic difficulty / scarcity regulator (analogous in role to mining difficulty, but tied to compute-energy targets).

**We do not weaken this claim in v1.1.** We document **how each phase approximates η** and where formal η remains open (§17.1).

### 5.2 Formal η(W_i) — deferred

A complete definition of **η(W_i)** under adversarial hardware impersonation, cross-vendor GPU counters, and mobile enclave attestations is **not closed in this draft**. §17.1 lists required assumptions. Until then, phases below use **auditable proxies**.

### 5.3 Phase 0 implementation (current testnet)

**Code path:** `tet-core/src/vision/thermo_genesis.rs`

The ledger settlement uses a **discrete approximation** aligned with whitepaper §4.2 engineering notes:

```
R_micro = (C_flops / E_joules_per_flop) × Γ × scale
```

| Symbol | Meaning | Source |
|--------|---------|--------|
| `C_flops` | Declared inference FLOPs | Task / receipt metadata |
| `E_joules_per_flop` | Energy proxy **E** (J/FLOP), env `TET_JOULES_PER_FLOP` | Operator-tunable default `1e-12` |
| `Γ` | Network difficulty | `NetworkDifficulty`, env `TET_NETWORK_DIFFICULTY_GAMMA` |
| `scale` | Maps dimensionless ratio → Stevemon micro | `TET_THERMO_STEVEMON_MICRO_SCALE` |

**η in Phase 0:** Approximated indirectly via **hardware fingerprint class** (CPU vs GPU vs specialized) in CAAC weighting (`vision/caac.rs`) and static env efficiency — **not** per-device power telemetry.

**Gap:** This is **(C/E)×Γ**, not the full Σ[η·C]/D integral. The gap is explicit in §17.1 and §17.7 (notation reconciliation).

### 5.4 Phase 1 target

- η computed from **CAAC fingerprint + measured compute** (timing micro-tasks, FLOPs/second bands, attested GPU class).
- Bind optimistic inference receipts to thermodynamic **R_expected** used in slash economics (§12).
- Unify discrete `thermo_genesis` outputs with wallet-visible fee displays (§11).

### 5.5 Phase 2 target

- η pegged to **hardware-attested power telemetry** (TPM / secure enclave / datacenter PDU APIs where available).
- Cross-check on-chain R against physical energy invoices for auditability.

### 5.6 AI inference settlement split (related economics)

Separate from transfer fees (§11), AI utility settlement in code uses a **50/50** split of thermodynamic `R_micro` between worker reward and protocol burn (`estimate_ai_infer_cost_micro`). This is **not** identical to v1.0 §11.2 “50% of all transaction fees burned” wording for every flow — see §17.7 and `WHITEPAPER_v1.0_GAPS.md` Gap 6 in STATUS.

---

## 6. Context-Aware Adaptive Consensus (CAAC)

CAAC is the routing and weighting layer that assigns each node an operational role from hardware and network context. v1.0 §4 content is preserved here as the **core working claim** of the project.

### 6.1 Role assignment

1. **Probe** — Static and micro-benchmark signals (GPU name, memory, optional timing tasks).
2. **Classify** — PoC vs PoR vs fallback weights.
3. **Leader election** — Hash- or weight-based producer selection for block intervals (`consensus.rs`, CAAC records in ledger).

### 6.2 PoC weight factors

High-performance nodes earn higher **CAAC weight** from:

- Proof-of-capacity signals (GPU tier, memory),
- Historical latency and availability,
- Verified inference deliveries (feeds ZK-Court and thermodynamic history).

### 6.3 PoR weight factors

Edge nodes earn weight from:

- Successful gossip propagation,
- Signature verification throughput,
- Uptime on relay paths.

### 6.4 Implementation status

| Feature | Status |
|---------|--------|
| Worker records in ledger | **Implemented** |
| Static hardware probes | **Partial** |
| Probabilistic timing fingerprinting (§10) | **Partial** |
| Full autonomous reclassification every epoch | **Open** (§17.5) |

---

## 7. Post-Quantum Cryptography

### 7.1 ML-DSA from genesis

TET adopts **ML-DSA** (FIPS 204, module-lattice signatures) as the protocol-family PQC scheme. Migration-from-ECDSA is intentionally avoided.

**Implementation:** `quantum_shield.rs`, `tet-pqc-wasm/`, Dilithium crates in `wallet.rs`.

### 7.2 Phase 0 hybrid wallet auth

Wallet transfers require **both**:

- **Ed25519** over a deterministic UTF-8 message (BIP39 seed bytes `[0..32]` → signing key), and
- **ML-DSA** over the same message bytes.

This hybrid path is what Sovereign OS uses for `POST /wallet/transfer`. See `wallet.rs::transfer_hybrid_auth_message_bytes` and UI `ed25519_tet.ts`.

**Chain binding fields** in the message:

```
tet xfer hybrid v1|chain_id=...|genesis_hash=...|to=...|amount_micro=...|nonce=...|mldsa_pubkey_b64=...
```

`genesis_hash` must match `genesis::expected_genesis_hash_from_env()` on the node.

### 7.3 Node ML-DSA keystore

`pqc_keystore::ensure_node_mldsa_keystore` provisions node-level ML-DSA keys under the DB directory for server-side operations.

### 7.4 Quantum threat model

ECDSA-secured chains face retroactive migration risk under Shor-capable adversaries. TET assumes ML-DSA parameter sets aligned with NIST guidance; parameter agility for future standards remains an operational concern, not a Phase 0 blocker.

---

## 8. ZK-Court (Lazy Evaluation)

### 8.1 Threat addressed

A malicious PoC node may submit **fabricated inference** without executing the model. ZK-Court provides **lazy evaluation**: optimistic acceptance during a challenge window, then cryptographic replay.

### 8.2 Mechanism

1. PoC records delivery + commitment (`vision/zk_court.rs`).
2. Challenge window opens (`TET_ZK_COURT_CHALLENGE_MS`, default 24h).
3. Challenger posts bond; pipeline runs **RISC Zero** guest prove when `NEXUS_GUEST_ELF` is non-empty.
4. **Guilty** if verified receipt shows journal ≠ commitment.
5. **Slash** on guilty verdict (§12).

### 8.3 Prover backends

| Backend | Status |
|---------|--------|
| RISC Zero (`methods/`, `worker_daemon.rs`) | **Implemented** (requires built guest ELF) |
| SP1 | **Not integrated** (§17.2) |

### 8.4 Mainnet safety

`TET_MAINNET=1` forbids mock ZK paths (`zk_verifier.rs`, `main.rs` panic on `TET_ALLOW_MOCK_ZK=1`). Dev-only `MOCKJ1:` / `MOCKZC1:` prefixes are rejected on mainnet.

### 8.5 REST surface (operator)

- `POST /v1/vision/zk-court/challenge` — full pipeline
- Params JSON exposes `whitepaper_alignment` block for operators (`WHITEPAPER_v1.0_GAPS.md` §6)

---

## 9. Network Layer (libp2p)

### 9.1 Transport and identity

- **Transport:** TCP + Noise XX + Yamux (Phase 1 swarm in `p2p_network.rs`).
- **Identity:** Persistent Ed25519 libp2p keypair in `libp2p_keypair.bin` under DB dir (`p2p_keystore.rs`). Boot banner logs PeerId for bootnode wiring.
- **Discovery:** mDNS, Kademlia, identify, autonat, relay (compose-dependent).

### 9.2 Gossip topics (representative)

| Topic constant | Purpose |
|----------------|---------|
| `BLOCKS_TOPIC` | Block propagation (`p2p.rs`) |
| `TXS_TOPIC` | Transaction gossip |
| `AI_WORKLOAD_TOPIC` | AI workload announcements |
| `TET_LEDGER_TOPIC` | Signed ledger snapshot replication (`network.rs`) |
| `nexus-inference-v1` | Inference gossip (`p2p_network.rs`) |

### 9.3 Sync and testnet operations

Sprint 1 added **chain catch-up** (`sync.rs`) and sync-gated auto-mine. Multi-node docker compose (`tet-core/docker-compose.yml`, `scripts/start-network.sh`) is the recommended Phase 0 operator path. See `docs/RUNNING_A_NODE.md`.

### 9.4 Cockroach Doctrine (resilience)

If data-center PoC clusters fail, PoR mesh continues header propagation and ledger continuity; inference throughput degrades, chain liveness does not halt. This remains a **design property**; planetary-scale PoR counts are not yet demonstrated publicly.

---

## 10. Hardware Fingerprinting (Sybil Resistance)

### 10.1 Attack

Adversary claims PoC-class rewards while running low-tier hardware.

### 10.2 Defense (v1.0 §14.2, preserved)

**Probabilistic hardware fingerprinting:** non-deterministic micro-tasks whose timing distributions are silicon-specific. Emulation must reproduce physical timing at scale.

### 10.3 Implementation

`vision/caac.rs` — static probes (GPU name, memory heuristics) and limited micro-benchmark hooks. Full probabilistic schedule is **partial** (§17.5).

### 10.4 Phase 2

Integration with secure enclaves (see Part II §15 Agent-Gate pillar 3) for presence proofs without per-request ZK.

---

## 11. Tokenomics

### 11.1 Supply cap

**Maximum supply:** `10,000,000,000 TET` (`MAX_SUPPLY_MICRO` in `ledger.rs` / `genesis.rs`).

### 11.2 Denomination table

| Unit | Definition | On-chain representation |
|------|------------|---------------------------|
| **TET** | Human-facing token | — |
| **Stevemon** | Sub-unit name in code/comments | 1 TET = **10⁶** Stevemon |
| **micro-TET / `*_micro` fields** | Integer ledger amounts | `u64` micro-units (= Stevemon atoms) |

**REST stability (Phase 0):** Field names may change pre-mainnet (`amount_tet` as `f64` vs `amount_micro` as `u64` in signing). §17 documents API gaps.

### 11.3 Genesis four-slot allocation

Genesis mint is binding via `tet-genesis-v1` hash (`genesis.rs`). Four logical slots:

| Slot | Wallet id | Share | Phase 0 mint |
|------|-----------|-------|----------------|
| **Worker pool** | `000…0001` (`WALLET_WORKER_POOL`) | **50%** (5B TET) | Full tranche to locked system pool |
| **Founder** | `TET_GENESIS_FOUNDER_WALLET_ID` / `TET_FOUNDER_WALLET` (64-hex Ed25519 id) | **25%** (2.5B TET) | Credited at genesis; **vesting / unlock schedule open** (§17.3) |
| **Treasury** | `TET_TREASURY_ADDRESS` (required 64-hex) | **25%** (2.5B TET) | Credited at genesis |
| **Protocol reserve** | `000…0003` (`WALLET_PROTOCOL_RESERVE`) | **0%** (placeholder) | **Zero by design** in Phase 0 |

Legacy sentinel `000…0002` (`WALLET_ECOSYSTEM`) receives **no mint** post–Phase 2B; treasury tranche moved to env-configured address (`WHITEPAPER_v1.0_GAPS.md` §9).

**Repurposing reserve** (non-zero mint or address change) alters `genesis_hash` → **chain-incompatible** without new genesis ceremony.

### 11.4 Protocol Reserve purpose (Phase 1+)

The reserve slot exists in the hash payload for forward compatibility. Intended uses (governance-defined, not yet allocated):

- Security bug bounties
- Emergency operational grants
- Ecosystem grants approved by on-chain proposal
- Potential buyback / burn policy (subject to governance)

**Phase 0:** allocation remains **zero** intentionally; nodes still commit `reserve_micro=0` in genesis hash.

### 11.5 Sovereign OS micropayments (Phase 0 — Steve decisions locked)

Protocol fees for **Tmail** and related Sovereign OS actions (spec: [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) Appendix C). Amounts are **testnet defaults** until mainnet freeze.

| Action | Charge | Ledger field | Notes |
|--------|--------|--------------|-------|
| **Tmail send** | **1 Stevemon** (= 1 µTET) | `fee_paid_micro = 1` | ~free UX; spam gate; Phase 0.1 may raise |
| **Tmail Pin** | **1000 Stevemon** | `pin_stake_micro = 1_000` | Persistent thread beyond 5-msg UI cap |
| **Anonymous escrow** | **1 TET** | `1_000_000` µTET | Minimum stake; 24h auto-settle |
| **File share / pin** | TBD | — | Size-dependent fee **Phase 0.1** |

**Fee disposition (Tmail/Pin/Anonymous protocol fees):** **50% treasury / 50% burn** — same deflationary story as §11.6, routed to treasury address and burn sink at settlement.

**Faucet (testnet):** **100 TET per day per IP** on public seed — not a protocol fee; operator policy.

### 11.6 Transfer fee schedule (implemented)

| Parameter | Value | Code |
|-----------|-------|------|
| Maintenance fee | **1%** of gross transfer | `PROTOCOL_MAINTENANCE_FEE_BPS = 100` |
| Fee split | **50%** to worker pool, **50%** burned | `ledger.rs` transfer settlement |

Example (Phase 0 E2E): send `1,000,000` micro (1 TET) → `fee_micro = 10,000`, `net_micro = 990,000`.

**Note:** This is the **wallet transfer** path (`POST /wallet/transfer`). Mempool `POST /ledger/transfer` uses a different envelope (`SignedTxEnvelopeV1`).

### 11.7 Deflationary burn (vision vs transfer path)

v1.0 §11.2 states 50% of fees burn under sustained use. Implementation matches this for **standard wallet transfers**. AI inference economics additionally use thermodynamic 50/50 worker/burn split (§5.6). Unified narrative for v1.1 mainnet docs remains **open** (§17.7).

### 11.8 Worker pool emission

The 50% worker pool tranche is minted at genesis to a **locked** address without a private key. Ongoing PoC/PoR emissions from pool to producers follow coinbase and settlement rules in `ledger.rs`. **Emission curve shape** (constant vs decreasing) is **open** (§17.4).

---

## 12. Economic Security (Slash Model)

### 12.1 Lazy-evaluation fraud (ZK-Court)

For **proven inference fraud** during the challenge window, the implementation executes:

```
slash_worker_bond_to_ecosystem_all(worker)
```

i.e. **100% of liquid worker bond** is burned to the ecosystem sink. This matches v1.0 §14.1 and §5.1 “confiscation, not a fine.”

**Code:** `vision/zk_court.rs`, `ledger.rs`

### 12.2 Parametric model (other offense classes — Phase 1+)

v1.0 §14.3 defines slashable collateral:

```
S = λ · R_expected
```

with `λ` default **100** (`TET_SLASH_LAMBDA_MULTIPLIER`), and `R_expected` stored on artifacts from settlement.

**v1.1 choice (Option A — honest to code):**

| Offense class | Phase 0 rule | Future |
|---------------|--------------|--------|
| ZK-Court inference fraud | **100% bond slash** | Keep |
| Other Byzantine behaviors (double-sign, invalid blocks, etc.) | Ad hoc / partial | **Cap at min(bond, λ·R_expected)** Phase 1 |

Today `λ` and `R_expected` are **telemetry** for disputes; they do **not** cap ZK-Court slashes. See `WHITEPAPER_v1.0_GAPS.md` §3.

### 12.3 Rationality argument

For fraud with 100% slash, expected gain must be `<` bond. For future capped offenses, the inequality `S > R_expected` should be enforced by parameter choice at mainnet freeze.

### 12.4 Founder and treasury operational security

Founder premine is subject to unlock policy (§17.3). Treasury address is env-driven for testnet; production treasury migration requires coordinated genesis or transfer policy.

---

## 13. Sovereign OS Suite (Phase 0)

> **Phase 0 deliverable.** Sovereign OS is the user-facing surface of TET Network: not a wallet tab, but a daily-use **desktop environment** backed by `tet-core` and libp2p. Full technical spec: [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md).

### 13.1 Philosophy

- **TET UI ≠ wallet** — Users live in an OS metaphor (apps, windows, taskbar), not a single “Send Coins” page.
- **Local-first, node-backed** — Browser talks to the user’s `tet-core` REST API; libp2p runs in the node, not in the browser.
- **L1 before apps** — Public testnet (seed, faucet, Docker) ships in **Sprint 4** before Tmail (see §19.1).

### 13.2 Desktop shell — “Inspired by 1990s desktop OS”

Visual design uses open **98.css** styling: gray bevel chrome, draggable windows, taskbar, Start menu, boot animation. Marketing and About copy:

**“Inspired by 1990s desktop OS”** — no Microsoft® trademarks; not affiliated with or endorsed by Microsoft.

### 13.3 Core applications (Phase 0)

| App | Role |
|-----|------|
| **Wallet** | Hybrid Ed25519 + ML-DSA transfers; genesis-bound auth |
| **Tmail** | Encrypted messaging (§13.4) |
| **Files** | Local mailbox, libp2p P2P transfer, optional paid replication |
| **Explorer** | Block / transaction browse |
| **Mini-apps** | Calculator (TET/USD/JPY), Clock (block height), Notes (encrypted local) |

**Worker** inference UI is **hidden** in Phase 0 (`SHOW_WORKER_TAB=true` for developers). Productized earn path → Phase 0.5.

**Onboarding:** `docker compose up` launches **node + UI** (mandatory path for general users).

### 13.4 Tmail — five capabilities

| # | Feature | Phase 0 mechanism |
|---|---------|-------------------|
| 1 | **Basic E2EE** | X25519 + ML-KEM + ChaCha20-Poly1305 (`tet-core/src/e2ee.rs`) |
| 2 | **Time-lock** | **Stake-scheduled** `release_at_ms` (nodes enforce decrypt policy); VDF upgrade §17.8 |
| 3 | **Burn-after-read** | Read receipt → gossip revoke; **best-effort** (§17.9) |
| 4 | **Anonymous sender** | Anchor + ephemeral + RISC0 ownership proof; **1 TET** escrow |
| 5 | **5-msg window + Pin** | UI cap; **1000 Stevemon** stake for persistence |

Gossip topic: `/tet/v1/tmail` on the block-plane libp2p swarm. Ciphertext is **not** stored on-ledger; fees and audit metadata are.

**Marketing discipline:** Public “world-first” claims for time-lock, burn, and anonymous modes require **acceptance tests AT-3, AT-4, AT-5** on the public testnet (Steve decision).

### 13.5 Anonymous Mode architecture

```
Anchor wallet (persistent, BIP39)
    │ fund + escrow (1 TET minimum)
    ▼
Ephemeral wallet (per-send/session) ──ZK proof──► "anchor owns ephemeral" (RISC0 guest)
    │ send Tmail (gossip shows ephemeral only)
    ▼
Receiver sees anonymous sender; third parties cannot link to anchor
    │
Anchor-only audit trail (REST, hybrid-signed) — voluntary disclosure path
```

- **24h auto-settle** returns unused escrow to anchor unless dispute.
- Misuse deterrence: high escrow + ZK-Court slash linkage (§12).

### 13.6 Phase 0 operations and ship target

| Item | Policy |
|------|--------|
| **Ship target** | **2026-09-15** (feature freeze **2026-08-31**, 2-week polish) |
| **Public seed** | **1×** Hetzner EU (~$5/mo) pre-ship; 2nd node when traffic warrants (SPOF accepted) |
| **Faucet** | **100 TET / day / IP** |
| **Sprint plan** | S4 Foundation → S5 Tmail protocol → S6 E2EE+shell → S7 time-lock/burn/pin → S8 Anonymous+ZK → S9 Files → S10 mini-apps → S11 QA |

---

# Part II — Layer 2 Applications (Future Vision)

> **Not Phase 0 deliverables.** The following sections describe architectural intent. Implementation depends on resolving open problems in federated learning, on-chain inference economics, and machine-to-machine settlement.

## 14. World Brain (Neural State Transitions)

During idle periods, PoC nodes contribute spare compute to **federated fine-tuning** of a shared base model. The chain state becomes a living, tamper-resistant model artifact refined by privacy-preserving edge telemetry.

**Dependencies:** Part I CAAC + ZK-Court operational at scale; privacy and model-governance open problems.

**Status:** research / not implemented.

---

## 15. Sentient Assets (Smart Contracts 2.0)

Contracts embed inference over context — wallets that reason about fraud patterns, assets that negotiate price from live ecosystem data — built atop World Brain state transitions.

**Status:** research / not implemented.

---

## 16. Agent-Gate (Machine-to-Machine Economy)

An M2M API gateway imposing **economic friction** on autonomous agent swarms without degrading human UX:

1. **Invisible UX** — Sovereign OS local agent spends micro-TET in background.
2. **State channels** — high-frequency agent payments settle net on L1 daily.
3. **Hardware-enclave PoR** — presence proofs via Secure Enclave / TrustZone without per-request ZK.

**Status:** research / not implemented; overlaps §10 enclave roadmap.

---

# Part III — Open Problems and Comparisons

## 17. Open Problems

Each item is stated bluntly; solutions are not claimed unless noted.

### 17.1 Formal definition of η(W_i) under adversarial hardware impersonation

We lack a closed-form η(W_i) that is simultaneously measurable on commodity hardware, resistant to emulator timing attacks, and composable into R(T). Phase 0 uses (C/E)×Γ proxies. **Status: open.**

### 17.2 SP1 prover integration

ZK-Court pipeline is RISC Zero–only when ELF is present. SP1 is cited in v1.0 but not wired in `zk_verifier.rs`. **Status: open** (RISC0 partial).

### 17.3 Founder unlock schedule (cliff vs linear vest)

Founder tranche mints at genesis; much of founder balance may be **locked** in ledger policy. Cliff vs linear vest for mainnet is undecided. **Status: open.**

### 17.4 Worker pool emission curve

Genesis mints 5B TET to locked pool; ongoing emission rate shape (constant vs decay) not finalized. **Status: open.**

### 17.5 CAAC hardware fingerprinting attack model

Timing micro-tasks are described; formal security game (emulator, FPGA, cloud GPU posing as mobile) is not written. **Status: open** (implementation partial).

### 17.6 Cross-chain bridge design (Phase 1 interoperability)

No canonical bridge spec for ETH/SOL/BTC custody. **Status: open.**

### 17.7 Slash magnitude and economics notation reconciliation

§12 documents 100% slash for ZK fraud vs §14.3 λ·R_expected parametric model. AI 50/50 thermodynamic split vs global fee-burn wording differs. **Status: partial** (documented in GAPS doc; code uses Option A).

### 17.8 Time-lock cryptography upgrade

**Phase 0:** Time-lock delivery uses **stake-scheduled release** (`release_at_ms` in signed envelope; nodes refuse early decrypt). Trust is **social/protocol-enforced**, not wall-clock cryptographic.

**Phase 0.1+:** **Verifiable Delay Function (VDF)** or threshold decryption for **trustless** time-lock. Class-group VDF evaluation is research-track (see [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) §A.2).

**Status: open** (VDF); Phase 0 path **implemented by policy**.

### 17.9 Burn-after-reading cryptographic guarantee

**Phase 0:** Burn is **best-effort**: cooperating peers delete ciphertext after read-receipt gossip; malicious archivers may retain encrypted blobs. UI copy states this explicitly.

**Phase 1+:** Forward secrecy sessions + cryptographic key destruction proofs; possible CRDT-wide revocation research.

**Status: open** (strong guarantee); Phase 0 path **best-effort**.

### 17.10 REST API completeness

`POST /wallet/transfer` lacks `tx_hash` / block confirmation fields; `amount_tet` f64 vs signed `amount_micro` u64. **Status: open** (Phase 1).

### 17.11 Multi-node sync at public testnet scale

Catch-up driver exists; 72h public testnet soak not completed. **Status: partial** (`docs/SYNC_ISSUE.md`).

### 17.12 Dual genesis_hash class of bugs (resolved 2026-05-20)

Wallet vs ledger genesis hash divergence broke all hybrid transfers. Fixed via `genesis.rs`. **Status: closed** in testnet; recorded as process lesson.

---

## 18. Comparison Table

### 18.1 Layer 1 positioning

Factual summary from public project materials (2026-05). Where uncertain: **unknown / not stated**.

| Project | Consensus | Proof model | Hardware model | Token peg | PQ resistance | Layer position |
|---------|-----------|-------------|----------------|-----------|---------------|----------------|
| **TET Network** | CAAC (PoC + PoR), L1 testnet | Optimistic inference + ZK-Court (RISC0); hybrid Ed25519+ML-DSA transfers | Adaptive roles; fingerprinting partial | **Energy/compute peg (η vision; Phase 0 (C/E)×Γ proxy)** | ML-DSA genesis + hybrid wallets | Sovereign L1 + OS UI |
| **Bittensor** | Yuma consensus on subnet miners | Labor/market proof of intelligence | Subnet-specific miners | Labor market pricing (TAO) | Not PQ-native at base | Intelligence marketplace L1 |
| **Gensyn** | Compute coordination (rollup-centric docs) | Verifiable ML compute proofs | GPU workers | Compute-as-a-service settlement | unknown / not stated | Compute layer / L2-ish |
| **Ritual** | EVM + specialized nodes (public docs) | On-chain inference orchestration | Node specialization | Gas / ETH economic layer | Inherits Ethereum assumptions | Inference chain / L2 |
| **Render** | Solana-adjacent workload network | Job completion attestations | GPU render farms | Work-unit pricing (RENDER) | Solana stack | Compute marketplace |
| **Filecoin** | Expected consensus + PoRep/PoSt | Storage proof of replication | Storage hardware | Storage market pricing | Not PQ-native | Storage layer |

### 18.2 Secure messaging vs TET Tmail (Phase 0 target)

Differentiates **L1 + messaging** on two axes — not only consensus:

| Capability | Signal | Telegram | Session | **TET Tmail (Phase 0)** |
|------------|--------|----------|---------|-------------------------|
| **libp2p / decentralized transport** | No | No | Yes | **Yes** |
| **Post-quantum (ML-DSA / ML-KEM path)** | No | No | No | **Yes** |
| **On-chain fee / audit metadata** | No | No | No | **Yes** |
| **Time-lock delivery** | No | No | No | **Yes** (stake-scheduled) |
| **Network burn-after-read** | No | Limited (timer) | No | **Yes** (best-effort) |
| **ZK anonymous sender + anchor audit** | No | No | Partial (Session ID) | **Yes** (1 TET escrow) |

**Do not over-claim:** Rows assume **2026-09-15** ship targets pass AT-3..AT-5 on public testnet. Until then, table is **design intent**.

**Sources (indicative):** TET — this document + `tet-core` + [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md); Signal/Telegram/Session — public product docs.

**L1 caveat:** TET testnet does not yet demonstrate planetary PoR scale, SP1 proofs, or closed-form η.

---

## 19. Roadmap

### 19.1 Phase 0 — Sovereign OS + public testnet (current)

**Sprint sequence** (see [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) §B.1):

| Sprint | Focus |
|--------|--------|
| **S4** | **L1 Foundation** — 1 public seed (Hetzner EU), faucet 100 TET/day/IP, Docker node+UI, CI/CD, ops docs |
| **S5** | Tmail protocol + REST + gossip |
| **S6** | Tmail E2EE + Win95 shell |
| **S7** | Time-lock + burn + Pin |
| **S8** | Anonymous Mode + ZK guest |
| **S9** | Files P2P |
| **S10** | Mini-apps (Calculator, Clock, Notes) |
| **S11** | QA + ship |

**Deliverables:**

- **Ship-able public testnet** (not UI-only): seed, faucet, `docker compose up`
- **Sovereign OS** (§13): Wallet, Tmail (5 features), Files, mini-apps
- Thermodynamic pricing **approximation** (§5.3)
- ML-DSA + Ed25519 hybrid wallets
- ZK-Court + Anonymous Tmail RISC0 path (dev ELF; CI stub where needed)

**Explicit non-goals:** Part II primitives (§14–§16), mainnet freeze, SP1, cross-chain bridges, productized AI Worker earn (Phase 0.5).

**Target:** **2026-09-15** public Phase 0 ship (feature freeze **2026-08-31**). Operator / builder preview — not financial promotion.

### 19.2 Phase 1 — CAAC + economics hardening

- Full CAAC role automation; improved fingerprinting (§17.5)
- SP1 backend option (§17.2)
- VDF time-lock (§17.8); stronger burn guarantees (§17.9)
- Founder vesting + REST API stability (§17.3, §17.10)
- Capped slash classes using λ·R_expected (§12.2)
- Optional Protocol Reserve funding via governance (§11.4)
- 2nd public seed + traffic SPOF mitigation

### 19.3 Phase 2 — Post-quantum fluid grid

- η from attested power telemetry (§5.5)
- Federated learning / World Brain (§14)
- Sentient assets + Agent-Gate (§15–§16)
- Scale-out toward edge participation thesis

---

## 20. Conclusion

TET Network is not an incremental L1 tweak. It couples **hardware-adaptive consensus**, **post-quantum signatures**, and an **energy-linked issuance philosophy** distinct from labor markets and centralized inference APIs. Version 1.1 makes the structure honest: Part I is what we build and test; Part II is where the protocol could go; Part III is what still requires math, code, or both.

The testnet exists to find bugs like dual `genesis_hash` implementations before they become permanent mainnet failures. Engineers who can disprove a mechanism should do so on testnet, not in production.

---

## 21. A Call to Builders

Expertise sought (unchanged in spirit from v1.0):

- Rust systems programming (consensus, ledger, networking)
- libp2p at scale
- zkVM engineering (RISC Zero today; SP1 tomorrow)
- Applied cryptography (ML-DSA, hybrid protocols)
- Distributed ML infrastructure

Technical critique: **yizhenxianshi@gmail.com** (Subject: Core Builder Application)

---

## 22. References

### Core consensus and cryptoeconomics

[1] Nakamoto, S. (2008). *Bitcoin: A Peer-to-Peer Electronic Cash System.*  
[2] Buterin, V. (2014). *Ethereum: A Next-Generation Smart Contract and Decentralized Application Platform.*  
[3] Sompolinsky, Y., & Zohar, A. (2015). *Secure High-Rate Transaction Processing in Bitcoin.*  
[4] Buterin, V., & Griffith, V. (2017). *Casper the Friendly Finality Gadget.*

### Zero-knowledge and post-quantum cryptography

[5] Ben-Sasson, E., et al. (2014). *SNARKs for C: Verifying Program Executions Succinctly and in Zero Knowledge.*  
[6] RISC Zero Team. (2023). *RISC Zero zkVM.*  
[7] Succinct Labs. (2024). *SP1 zkVM.*  
[8] NIST. (2024). *FIPS 204: ML-DSA.*

### Decentralized AI and networking

[9] Rao, Y. (2021). *Bittensor: A Peer-to-Peer Intelligence Market.*  
[10] Borzunov, A., et al. (2022). *Petals: Collaborative Inference and Fine-tuning of Large Models.*  
[11] AI@Meta. (2024). *Llama 3 Model Card.*  
[12] Protocol Labs. (2019). *libp2p.*

### Thermodynamics and hardware security

[13] McMahan, B., et al. (2017). *Communication-Efficient Learning of Deep Networks from Decentralized Data.*  
[14] Landauer, R. (1961). *Irreversibility and Heat Generation in the Computing Process.*  
[15] Bennett, C. H. (1982). *The Thermodynamics of Computation.*  
[16] Suh, G. E., & Devadas, S. (2007). *Physical Unclonable Functions for Device Authentication.*

### Implementation annex (non-normative)

- `tet-core/src/genesis.rs` — canonical `genesis_hash`
- `tet-core/src/vision/thermo_genesis.rs` — Phase 0 thermodynamic estimate
- `tet-core/src/ledger.rs` — fees, burns, genesis allocation
- `docs/WHITEPAPER_v1.0_GAPS.md` — v1.0 vs code audit trail

---

*End of Whitepaper v1.1 Draft — 2026-05-21*
