# TET Network — State of the Project, 2026-09

**Compiled:** 2026-09-17
**Method:** Read-only repository archaeology (git history, all `docs/`, all whitepaper versions, and the Rust/TypeScript source as it exists on disk). No code was changed.
**Audience:** An incoming CTO with no prior context.
**Working directory:** `/Users/sengokukazuma/Nexus_Network`
**Remote:** `https://github.com/TET-Network-Foundation/TET-OS.git`, branch `main`, no tags, no other branches.

> **Read this first.** The last commit on `main` is `ff6f7be`, dated **2026-06-12**. Today is **2026-09-17**. The repository has been **dormant for 3 months and 5 days**. The Phase 0 public ship date, locked in writing on 2026-05-19 and repeated in the whitepaper, the README, and every planning document, was **2026-09-15** — two days ago. It was not met, and there is no commit, doc, or note in the repo explaining why. Everything below describes a project that was moving very fast and then stopped.

---

## Table of contents

1. [History and pivots](#1-history-and-pivots)
2. [Architecture as it exists in code](#2-architecture-as-it-exists-in-code)
3. [Gap analysis](#3-gap-analysis)
4. [Ideas inventory (unfiltered)](#4-ideas-inventory-unfiltered)
5. [Sprint 4 / Phase 0 remaining scope as last documented](#5-sprint-4--phase-0-remaining-scope-as-last-documented)
6. [What I would want to know on day one](#6-what-i-would-want-to-know-on-day-one)

---

# 1. History and pivots

## 1.1 The shape of the record

The git history is **not** the project history. `main` begins on 2026-05-10 with `50ffb79 "Genesis Commit: Purged all nested repos"` — a single 547-file, 200,219-line commit that imported an already-mature codebase from a set of nested git repositories that were discarded in the process. Everything before 2026-05-10 survives only as:

- file mtimes (earliest artifacts date to **2026-04-15**),
- the content imported in `50ffb79` (which *does* contain the Substrate and Solana trees — see §1.3),
- prose in `docs/` and the archived whitepapers.

65 commits total, spanning **2026-05-10 → 2026-06-12** (34 days). Author: `Steve <yizhenxianshi@gmail.com>`. A large fraction are co-authored `Cursor <cursoragent@cursor.com>` — this codebase was built in a tight human+agent loop, and the daily logs are explicit about that methodology (see §1.6).

Working tree is clean except one untracked file: `tet-network/ui/scripts/files_interop_step3.mjs`.

## 1.2 Timeline

| Date | Event | Evidence |
|------|-------|----------|
| 2026-04-15 | Earliest dated artifact: `.cursor_nexus_project.md` "Version 1.0.0-GOLD-GENESIS", project titled **"Tradable Energy Token (TET)"** | file header |
| 2026-04-20 | `AUDIT_REPORT_genesis_v1.md` | mtime |
| 2026-04-28 | **Whitepaper Genesis Draft v1.0** written | `GENESIS_V1.md`, `archive/WHITEPAPER_v1.0.md` |
| 2026-05-10 | **Monorepo genesis commit** — nested repos purged, single tree | `50ffb79` |
| 2026-05-18 | Whitepaper unified to Genesis v1.0 as canonical; `SPRINT_PLAN.md` (6-sprint plan) written | `183fd14` |
| 2026-05-18→19 | **Sprint 1 + 2 + 3A in ~2 days**: chain catch-up driver, 3-node sync, sync gate, 25/50/25 treasury, ZK-Court §14.1, three UI-P0 commits | `7264191`…`d157c77` |
| 2026-05-20 | **Dual `genesis_hash` bug** found and fixed; founder wallet migrated to Steve's mnemonic address; Substrate/Solana trees deleted from the tree | `df59517`, `32f8eee` |
| 2026-05-21 | `CODEBASE_ATLAS.md`, worker-mode audits | `04fbad4`, `2021269`, `6f7fd44` |
| 2026-05-22 | **Sovereign OS Phase 0 spec** (54 KB) + **WP v1.1** + JP translation + Phrack-style PDF | `b6d0620`, `e798d87`, `2dcad0f` |
| 2026-05-24 | Founder philosophy essay; WP §17.13 (Bitcoin mining reuse); **WP v1.1 promoted to canonical** | `3def56a`, `4be6201`, `3898a12` |
| 2026-05-28 | **First cross-region P2P sync** (Mac/Switzerland ⇄ VPS/Finland); multi-swarm port-collision bug fixed | `7a23ee6`, `DAILY_LOG_2026-05-28.md` |
| 2026-05-29 | Overnight resilience proven (11k blocks, auto-reconnect, 441-block catch-up in ~2 s); faucet discovered already implemented and enabled; **Strategy C locked** (Phase 0 = throwaway testnet, Phase 1 = fresh mainnet genesis) | `DAILY_LOG_2026-05-29.md` |
| 2026-05-30 | **`block_id` schema V2 hard fork** (45-minute diagnose→fix→deploy); 5 critical fixes in one day; block 9828 divergence mystery logged unresolved | `c6e63a1`, `f08a020`, `5297bb7`, `21e0309` |
| 2026-05-31 | **Send Coins made consensus-grade** (two off-chain-mutation bugs killed); **Tmail Basic E2EE shipped end-to-end in one afternoon** | `8f52db7`, `2ce9024`, `9e9a4a7`, `4d3fc72`, `1d3173f` |
| 2026-06-02 | **TNS (TET Naming Service)** spec added as Phase 0.5 candidate | `cb355da` |
| 2026-06-05 | File Sharing backend; Tmail cross-region interop verified (CH→FI, 1.3 s); **Win95 component-library UI redesign** | `dbfa7ab`, `356df5e`, `ad3fb3f` |
| 2026-06-06→07 | Files UI; block-plane swarm wedge fix + systemd watchdog; AI-airdrop consensus fork fix | `bd98cdc`, `83e0074`, `3bd2009` |
| 2026-06-09→10 | WP §17.14–17.16 research directions; UI polish steps 7–10; `apply_remote_block_from_gossip` offloaded (chain was at **137,000+ blocks**); File Sharing Step 4 complete | `972cdf9`…`ed9b9bc` |
| 2026-06-12 | **Mining UI / Worker Experience scaffold (Phase 0.5)** — last commit | `ff6f7be` |
| 2026-06-13 → 2026-09-17 | **Nothing.** | — |

## 1.3 Pivots and major redesigns

### Pivot 1 — Substrate → custom Rust L1

The original chain was a **Substrate solochain template**. Evidence:

- `50ffb79` contains `nexus network/tet-core-node/` — a full Substrate node template (`node/src/{chain_spec,service,command,rpc}.rs`, `pallets/template/`, `runtime/`, `env-setup/flake.nix`, its own CI workflows).
- `tet-network/chain/` was a *second, duplicate* Substrate chain template.
- `tet-network/primitives/` (still tracked today, 48 LOC) is a `parity-scale-codec` + `sp-core` + `dilithium-rs` primitives crate — a Substrate pallet primitive.
- `tet-network/services/tet-core/` (still tracked today, 431 LOC) is a **`subxt`-based service** that talks to a Substrate node over RPC. It shares a crate name with the real `tet-core` and is *not* in the root workspace.

Removed from the working tree in `32f8eee` (2026-05-20), recoverable from git history at or before `50ffb79`.

**Note:** `tet-network/chain/` source is gone but **12 GB of its build artifacts are still on disk** at `tet-network/chain/target/` (untracked). `tet-network/services/target/` is another 1.6 GB, `tet-network/primitives/target/` 258 MB, root `target/` 35 GB.

### Pivot 2 — Solana → own ledger

`nexus-onchain/` was an **Anchor (Solana) program** (`Anchor.toml`, `programs/nexus_onchain/src/lib.rs`) implementing worker register-and-stake on Solana. Also removed in `32f8eee`, but **the client side is still compiled into `tet-core` today**:

- `tet-core/src/onchain.rs` (186 LOC) — `register_and_stake` against a localnet Anchor program via `clone-solana-sdk`.
- `tet-core/src/ledger/solana_client.rs` (141 LOC) — SPL token mint `2WZmTHKZgo5VMKzDnWGpmD28PkjQHYzR2vTS64n76jkU`, `REWARD_PER_INFERENCE_TET = 10`, `decimals=9`.
- `tet-core/Cargo.toml` still pulls `solana-client`, `solana-sdk`, `clone-solana-*`, `spl-token`, `spl-associated-token-account`.

These are dead weight on build time and dependency surface, and they contradict the "sovereign L1" narrative if a reader greps for them.

### Pivot 3 — Economic model: CHF peg → thermodynamic energy peg

The oldest economic framing (`archive/WHITEPAPER_v0_economic.md`, `archive/LITEPAPER_v0.md`) is a **completely different product**:

- **"1 TET = 1 CHF"** hard peg, "The Global Energy Currency for Verified Compute".
- **"Stevemon Economy"**, **"Imperial Tax"** (compute rewards), founder-revenue protocol fees.
- A **P2P orderbook DEX with "Quantum Gate"** whose purpose was explicitly *bank bypass* — escrow released against a Solana USDC `txid`.
- Fiat bridge (Stripe/CHF) as a Phase 4 deliverable.

Genesis v1.0 (2026-04-28) replaced all of that with the **energy peg** `R(T) = Σ[η(W_i)·C(t_i)]/D(t)`. But `LITEPAPER.md` **at the repo root still says "1 TET = 1 CHF"** — the deprecation banner exists only on `archive/LITEPAPER_v0.md`. And the CHF machinery is still in the ledger: `chf_top_up_mint`, `META_CHF_DEPOSITS_MICRO`, `META_FIAT_MINT_STEVEMON_MICRO`, `META_AML_CHF_PREFIX`, plus `p2p_dex.rs` (589 LOC) live and routed at `/dex/*`.

### Pivot 4 — Whitepaper v1.0 → v1.1 (structural honesty)

v1.0 mixed near-term mechanics and long-term vision in one §12. v1.1 (2026-05-21, canonical since `3898a12`) split the document into three parts and — this is the important editorial decision — **added Part III §17 "Open Problems", which states unsolved problems bluntly rather than hiding them.** The Design Goals section now literally includes *"Honest documentation — Where code diverges from prose, §17 records the gap; we do not paper over implementation debt."* That is a rare and valuable norm; preserve it.

Mapping v1.0 → v1.1: §4–10,14 → Part I; §12.5–12.7 → Part II §14–16; §12.1–12.4 → §3.3; §13 → §19. New in v1.1: §5 energy-peg phases, §11 four-slot genesis, §13 Sovereign OS, §17 open problems, §18 comparison, §19 roadmap.

### Pivot 5 — Product: "node + wallet" → "Sovereign OS"

`b6d0620` (2026-05-22) introduced `docs/SOVEREIGN_OS_PHASE0_SPEC.md`, reframing the deliverable from an L1 with a wallet UI into a **Win95-styled desktop environment** ("Inspired by 1990s desktop OS", explicitly no Microsoft marks — locked decision #4) containing Wallet, Tmail, Files, and mini-apps. This is the framing that governs everything after 2026-05-22.

### Pivot 6 — Sprint renumbering (a real trap)

**There are two incompatible sprint numbering schemes in the repo.**

| Scheme | Source | Meaning of "Sprint 4" |
|---|---|---|
| A | `docs/SPRINT_PLAN.md` (2026-05-18) | "Incentive layer (P1)" — AI settlement, worker stake gate, slashing MVP |
| B | `docs/SOVEREIGN_OS_PHASE0_SPEC.md` §B.1 (2026-05-19, v0.2) | **"L1 Foundation"** — public seed, faucet, Docker, CI/CD, ops docs |

Scheme B superseded A and is what the daily logs use ("Sprint 4 Day 2/3/4/5"). `docs/SPRINT_PLAN.md` was never updated or marked obsolete. Scheme B also renumbered Tmail from Sprint 4→5 and Anonymous from Sprint 7→8. Assume **B** unless a document predates 2026-05-19.

### Renamed concepts

| Old | New | Status |
|---|---|---|
| **Nexus** (Nexus Network, `nexus-*` crates, `nexus-inference-v1` topic, `/nexus/1.0.0` identify) | **TET** | Partial. Working directory is still `Nexus_Network`; `nexus-protocol`, `nexus-wasm`, `nexus-frontend`, `nexus-onchain` still exist; `DB_MAGIC_LEGACY` is literally `nexus-db-v1` encoded as a byte array "to avoid brand leakage in source strings" (`ledger.rs:246`). |
| **Stevemon** | micro-TET / `*_micro` | Unresolved. WP §11.2 keeps both; `WHITEPAPER_v1.0_GAPS.md` §10.1 flags "pick one" as Phase 1 work. Also a denomination change: `LEGACY_STEVEMON_PER_TET = 1e8` → `STEVEMON = 1e6`. |
| **Messages** | **Tmail** | Done (`TMAIL_TOPIC`, `MESSAGES_TOPIC` rename was a Sprint 5 checklist item). |
| **Imperial Tax** / **Sharding Plugins** | (dropped) | Terms gone from canonical docs; similar logic may survive in `conductor.rs` / worker mint paths. |
| `tet-api-pool` | AI burn sink | Still the default `WALLET_AI_BURN_DEFAULT`. |

## 1.4 Whitepaper versions and how the vision moved

| Version | Date | Location | Core claim |
|---|---|---|---|
| **v0 economic** | pre-2026-04 | `archive/WHITEPAPER_v0_economic.md` | 1 TET = 1 CHF; compute gateway + orchestrator; Imperial Tax; bank bypass via DEX |
| **Litepaper v0** | pre-2026-04 | `archive/LITEPAPER_v0.md` (deprecated banner) + **`LITEPAPER.md` (root, no banner)** | Same CHF peg, P2P DEX "Quantum Gate" |
| **Genesis v1.0** | 2026-04-28 | `GENESIS_V1.md`, `archive/WHITEPAPER_v1.0.md` | CAAC + PoC/PoR; energy peg; ML-DSA from genesis; §12 mixes near/long-term |
| **v1.1** | 2026-05-21 | **`WHITEPAPER.md` (canonical)** + `docs/WHITEPAPER_v1.1_DRAFT.md` + JP + PDF | Three-part split; Sovereign OS §13; §17 open problems; §19 roadmap with 2026-09-15 ship date |

**Divergence you must fix:** `972cdf9` (2026-06-09) added **§17.14 Browser-embedded node architecture, §17.15 AI-native smart contracts, §17.16 Anchoring to external networks** to `docs/WHITEPAPER_v1.1_DRAFT.md` **only**. The canonical root `WHITEPAPER.md` stops at §17.13. The two files are otherwise byte-identical. The canonical document is therefore 41 lines stale.

Secondary: `WHITEPAPER.md` still carries the draft header *"Status: Draft for review. Does not supersede WHITEPAPER.md (Genesis v1.0)…"* even though it **is** `WHITEPAPER.md` and `3898a12` promoted it to canonical. It is a self-referential leftover from the copy.

## 1.5 How a nominally 14–18-week plan got compressed

The spec estimated **~93 dev-days / 14–18 weeks** for Sprints 4–11. The daily logs show Send Coins (consensus-grade) + Tmail Basic E2EE both landing on **2026-05-31**, and File Sharing essentially complete by **2026-06-10**. The founder's own note: *"Phase 0 14-18 week engineering: significant compression today (2 major features in 1 day)."* Three of the plan's eight sprints' worth of headline features landed in about 12 days.

## 1.6 Working method (visible in the logs, worth preserving)

The daily logs record an unusually disciplined process, and the lessons are stated explicitly:

- **Diagnose → design (compare options A–D) → minimal scoped fix.** Used for the multi-swarm port collision; the log calls out *"avoided fixing everything in sight."*
- **Agent used as auditor, not executor.** The Kyber Round-3 vs FIPS-203 ML-KEM correction came from the agent contradicting the task prompt, and was accepted. *"Treat Cursor reports as audit, not blind execution."*
- **Prior hypotheses must be explicitly retracted.** The block-9828 forensic took three rounds; rounds 1 and 2 were disproven on facts.
- **Silent failures hide bugs.** `listen_on` failures weren't logged, which hid the port collision; success/failure logging is now mandatory for every listener.
- **Cool impulses with facts.** The "unlock the founder wallet and ship" impulse was stopped by an investigation that established the 365-day cliff is already burned into genesis — which is what produced Strategy C.
- **Long-running tests find what short ones can't.** The 10-hour soak exposed the 8-hour idle-isolation bug.

---

# 2. Architecture as it exists in code

## 2.1 Crate / package map

Root `Cargo.toml` workspace members: `tet-core`, `methods`, `nexus-wasm`, `nexus-protocol`, `tet-pqc-wasm`, `prover/methods`, `prover/host`, `tet-cli`.

| Package | Path | LOC (src) | Tests | In workspace | Purpose / verdict |
|---|---|---|---|---|---|
| **`tet-core`** | `tet-core/` | **38,303** | **143** | yes | **The entire product.** Ledger, consensus, 3 libp2p swarms, REST, Tmail, Files, AI, ZK-Court, DEX, wallet. 3 binaries: `TET-Core`, `TET-Signer`, `TET-Worker-App`. |
| `nexus-protocol` | `nexus-protocol/` | 43 | 0 | yes | Shared zkVM journal types (`InferenceJournalV1`, `ZkCourtJournalV1`) + the domain-separated commitment hash. `no_std`-capable. Small and load-bearing. |
| `methods` | `methods/` (+`guest/`) | 67 | 0 | yes | RISC Zero guest for inference journals (`NEXUS_GUEST_ID/ELF`). Skippable via `RISC0_SKIP_BUILD=1`. |
| `prover/host` | `prover/host/` | 219 | 0 | yes | Standalone HTTP prover daemon (`POST /prove`, `POST /prove_ai`), port 9945. |
| `prover/methods` | `prover/methods/` (+2 guests) | 76 | 0 | yes | RISC0 guests: `tet_transfer_guest`, `tet_ai_inference_guest`. |
| `tet-cli` | `tet-cli/` | 587 | 0 | yes | CLI. |
| `nexus-wasm` | `nexus-wasm/` | 605 | 0 | yes | Browser WASM helper (has explicit no-op stubs for non-wasm targets). |
| `tet-pqc-wasm` | `tet-pqc-wasm/` | 121 | 0 | yes | ML-DSA-44 signing in the browser via `dilithium-rs`, keys derived from BIP39 + HKDF. |
| **`tet-network/ui`** | | **13,683** (TS/TSX) | 0 unit | n/a | **Next.js 16.1.6 / React 19.2.3 Sovereign OS.** See §2.9. |
| `tet-agent-sdk` | | ~758 (TS) | 1 jest file | n/a | M2M agent client. Still depends on `@polkadot/keyring` — Substrate-era. |
| `tet-worker` | `tet-worker/index.ts` | 279 | 0 | n/a | Legacy TS worker. |
| `tet-network/primitives` | | 48 | 0 | **no** (own workspace) | **Substrate leftover.** `parity-scale-codec` + `sp-core`. |
| `tet-network/services/tet-core` | | 431 | 0 | **no** (own workspace) | **Substrate leftover.** `subxt` client. Name-collides with the real `tet-core`. |
| `nexus-frontend`, `web-wallet`, `pwa`, `nexus-onchain` | | 0 | 0 | n/a | Empty / a single `index.html` / `README.md` / build artifacts only. |

Test distribution inside `tet-core` (static count of `#[test]` + `#[tokio::test]`): `tests.rs` 101, `sync.rs` 28, `swarm_health.rs` 6, `p2p.rs` 3, `invariant_tests.rs` 3, `genesis.rs` 1, `chaos.rs` 1. **143 total.** Commit messages report the suite green at each step (101 → 129 → 131 → "ALL PASS" at `ed9b9bc`); I did not run it (read-only task), so treat 143 as the static count and the green status as last-reported, not verified today.

Largest `tet-core` files: `ledger.rs` 6,904 · `tests.rs` 5,277 · `p2p.rs` 2,706 · `consensus.rs` 1,774 · `sync.rs` 1,483 · `p2p_network.rs` 1,410 · `rest/handlers/ledger.rs` 1,353 · `rest/handlers/ai.rs` 911 · `rest/handlers/worker.rs` 779 · `main.rs` 716.

## 2.2 Consensus — what CAAC actually does

**Whitepaper claim (§6):** consensus routes nodes into PoC/PoR lanes from measured hardware capability, with leader election weighted by CAAC records, and full autonomous reclassification each epoch as "open".

**Code reality:**

*Role assignment* (`tet-core/src/vision/caac.rs`, 204 LOC — the file's own docstring says "routing skeleton"):

- `probe_hardware_fingerprint()` — `sysinfo` core count + RAM + a GPU *hint*. The GPU hint is: is `CUDA_VISIBLE_DEVICES`/`GPU_DEVICE_ORDINAL` set, or (macOS) does `system_profiler SPDisplaysDataType` exit 0. The fingerprint is `SHA256("cores=…ram=…gpu=…" + hint)`. Its own doc comment: *"not a security anchor — routing heuristic only."*
- `assign_role()` → PoC if `gpu_detected || (cores ≥ 4 && RAM ≥ 8 GiB)` (env-tunable).
- There **is** a real challenge–response: `generate_hardware_challenge()` issues a 32-byte seed; the worker runs a SHA-256 chain of 10,000–60,000 rounds derived from the seed and reports latency; the server verifies the digest and re-measures its own wall time. `role_from_latency_ms()` classifies PoC if client latency ≤ 50 ms. Result persists as `CaacWorkerRecord { role, latency_ms, seed_hex, server_wall_ms }` under meta key `caac_worker_v1:{wallet}`.
- REST: `/v1/vision/caac/{profile,challenge,complete}`.

*Leader election* (`tet-core/src/consensus.rs`):

- `ValidatorSet::from_env_or_single()` — validators come from the **`TET_VALIDATOR_IDS` env var**, comma-separated. There is no on-chain validator registry, no staking-based set, no join/leave protocol.
- Two modes selected by `TET_CONSENSUS_LEADER_MODE`:
  - **`hash` (default)** — `leader = argmin SHA256(height ‖ validator_id)`. CAAC is not consulted at all.
  - **`caac`** — `argmin (first 8 bytes of that hash as u64) / weight`, where `weight = base + latency_score/server_penalty`, `base` ∈ {POC:100, POR:25, unregistered:10}, `latency_score = clamp(1000/latency_ms, 1, 1000)`, `server_penalty = 2 if server_wall_ms > 1000`.
- `.env.mainnet.example` sets `TET_CONSENSUS_LEADER_MODE=caac`, so the intended production mode is the weighted one.

*Block production and chain rules:*

- `block_id` **V2 schema** (`c6e63a1`, 2026-05-30): `SHA256("TET_BLOCK_ID_V2|" ‖ height_LE8 ‖ parent_block_id ‖ state_root ‖ tx_hashes ‖ producer_id)`. V1 was `SHA256(height ‖ tx_hashes)` — which made two divergent chains produce *identical* block ids on empty coinbase blocks. Genesis parent is 32 zero bytes.
- Fork choice: `remote_wins_fork()` + cumulative weight; `find_common_ancestor` / `reorg_to_branch` / `try_reorg_backfilled_branch` implement real reorg with `BlockUndoV1` undo records.
- `TARGET_BLOCK_TIME_MS = 4000` (nominal); `.env.mainnet.example` uses `TET_BLOCK_TIME_SEC=12`.
- `spawn_auto_miner` gated behind `TET_AUTO_MINE` and a sync gate.
- `apply_remote_block_from_gossip` is wrapped in `spawn_blocking` with a **static serialization mutex** (`1a997d2`), because inline execution at 137k+ blocks was stalling the whole tokio runtime.

**Honest summary:** CAAC in code is (a) a hardware heuristic that classifies a node PoC or PoR, (b) a proof-of-work-ish timing challenge whose result is persisted, and (c) an *optional* divisor in a hash-based round-robin leader election over an **env-configured validator list**. It is a real, working, deterministic block producer selector. It is not yet a Sybil-resistant, permissionless, capability-attested consensus. The whitepaper's own §6.4 status table says exactly this ("Full autonomous reclassification every epoch — Open"), so the docs are not lying; just don't read "CAAC" as more than the above.

## 2.3 Cryptography — wired vs stubbed

| Primitive | Library | Status |
|---|---|---|
| Ed25519 signatures | `ed25519-dalek 2` | **Real.** Wallet id *is* the 64-hex Ed25519 verifying key. |
| **ML-DSA (FIPS 204)** | **`dilithium-rs 0.2.0`** (crates.io, `dilithium::{ML_DSA_44, ML_DSA_65, ML_DSA_87}`) | **Real code path**, not a stub. Default for new keys is **ML-DSA-65**; verification accepts 44/65/87 by pubkey length. Deterministic keygen from BIP39 seed via HKDF with level-specific info strings (`tet:pqc:mldsa65-seed:v1`). Deterministic signing randomness likewise. Browser side matches via `tet-pqc-wasm` (ML-DSA-44). **Risk: `dilithium-rs 0.2.0` is a small third-party pure-Rust crate; there is no evidence in the repo of an audit, FIPS validation, or KAT/ACVP test-vector suite.** This is the single largest unexamined cryptographic dependency in the project. |
| Hybrid auth | `quantum_shield.rs` | **Real.** `verify_hybrid` = Ed25519 **AND** ML-DSA over identical canonical bytes; both must pass. Fails closed: `pqc_active()` defaults to true when `TET_PROD`/`TET_MAINNET` is set. |
| **KEM** | **`pqcrypto-kyber 0.8.1` → `kyber768`** | **Real, but not what the docs claim.** This is **CRYSTALS-Kyber Round-3**, which is **byte-incompatible with FIPS-203 ML-KEM-768**. The 2026-05-31 log records this correction explicitly and notes both sides were deliberately aligned on Round-3 (`crystals-kyber-js@^1.1.2` in the browser) to keep interop. Migration to FIPS-203 was listed as required "before Phase 0 ship" and **has not happened**. Meanwhile `PHASE_0_FILE_SHARING_SPEC.md` §1 still writes "ML-KEM-768 (Kyber768)" as if they were the same thing, and `p2p_network.rs` uses `mlkem_*` field names throughout. |
| Hybrid E2EE | `e2ee.rs` | **Real.** X25519 (`x25519-dalek`) + Kyber768-r3 → HKDF-SHA256 (zero salt, info `tet-e2ee-hybrid-v1`; Files uses `tet-file-v1`) → ChaCha20-Poly1305. There is a `#[cfg(debug_assertions)]` dev symmetric fallback that **panics if reached in prod**. |
| At-rest ledger encryption | `aes-gcm` | Real; `TET_DB_ENCRYPT=strict` + `TET_DB_KEY_B64`. |
| Hardware attestation | `attestation.rs` | **Stub with a trait boundary.** Per-OS impls are placeholders; `TET_ATTESTATION_ALLOW_STUB` exists for dev and is **rejected on mainnet** (`rest/helpers.rs:228`). |
| zkVM | `risc0-zkvm 3.0.5` | **Real when the guest ELF is built.** `RISC0_SKIP_BUILD=1` yields an empty ELF. Dev mocks `MOCKJ1:` / `MOCKZC1:` exist and **panic at startup** if `TET_MAINNET=1` and `TET_ALLOW_MOCK_ZK=1`. |
| SP1 | — | **Not integrated** (WP §17.2). |

## 2.4 Network layer

Three **independent libp2p swarms in one process** — the design that caused the 2026-05-28 port-collision outage:

| Swarm | Module | Listen env (default) | Identify | Role |
|---|---|---|---|---|
| **block plane** | `p2p.rs` (2,706 LOC) | `TET_P2P_LISTEN` (`:4001`) | `/tet/identify/1.0.0` | Blocks, txs, chain sync, Tmail, Files announce. **The real chain.** |
| nexus / inference | `p2p_network.rs` (1,410) | `TET_NEXUS_P2P_LISTEN` (`:4003`) | `/nexus/1.0.0` | E2EE inference marketplace; autonat + relay + dcutr + WebRTC |
| ledger replication | `network.rs` (317) | `TET_LEDGER_P2P_LISTEN` (`:4005`) | — | Ledger gossip / guardian |

**Gossipsub topics:**

| Topic | Const | Plane |
|---|---|---|
| `/tet/v1/blocks` | `BLOCKS_TOPIC` | block |
| `/tet/v1/txs` | `TXS_TOPIC` | block |
| `/tet/v1/ai-workload` | `AI_WORKLOAD_TOPIC` | block |
| `/tet/v1/tmail` | `TMAIL_TOPIC` | block |
| `/tet/v1/files/announce` | `files::FILES_ANNOUNCE_TOPIC` | block |
| `/tet/v1/ledger` | `TET_LEDGER_TOPIC` | ledger |
| `nexus-inference-v1` | `INFERENCE_TOPIC` | nexus |
| `tet-global-state` | `GLOBAL_STATE_TOPIC` | **`#[deprecated]`** |

**Request/response protocols:** `/tet/v1/block-sync/json`, `/tet/v1/chain-sync/hello/json`, `/tet/v1/chain-sync/range/json`, `/tet/v1/files/fetch` (custom codec, 64 KiB req / 8 MiB resp, 30 s timeout).

Transport: TCP + Noise + Yamux, plus mdns, ping, Kademlia, identify, autonat/relay/dcutr (inference plane), `libp2p-webrtc` (alpha). Gossip message cap `TET_P2P_GOSSIP_MAX_MSG_BYTES`, default 128 KiB, clamped 48–512 KiB.

**Resilience machinery added in the 05-28 → 06-10 bug-fix arc** (all real, all tested):

- `TET_IDLE_TIMEOUT_SEC` (default 300) — libp2p 0.55 defaults `with_idle_connection_timeout` to `Duration::ZERO`, which was the root cause of nodes isolating after 8 hours idle.
- `TET_KAD_BOOTSTRAP_INTERVAL_SEC` (default 60) — original code bootstrapped Kademlia exactly once at startup and could never recover from "No known peers".
- Bootnode re-dial with `is_connected` + in-flight dial guard (`TET_BOOTNODE_REDIAL_SEC`, default 30) — fixes `AddrInUse` storms.
- Periodic `chain_hello` resend (`TET_CHAIN_HELLO_INTERVAL_SEC`, default 15) + peer blacklist TTL.
- `swarm_health.rs` liveness beacon → **systemd watchdog** via `sd-notify` (`READY=1`, `WATCHDOG=1` only while the event loop ticks; stall threshold 90 s) + `GET /health/swarm` (200 healthy / 503 stalled, lock-free atomics).
- Five hot paths plus `apply_remote_block_from_gossip` moved off the swarm event loop into `spawn_blocking`.

**Seed node configuration:** `TET_BOOTNODES` (or `BOOTNODES`), comma-separated multiaddrs with `/p2p/<PeerId>`; parsed in `vision/fluid_net.rs`. Persistent libp2p identity at `libp2p_keypair.bin` under `TET_DB_DIR` (`p2p_keystore.rs`); PeerId printed in a boot banner. Production deployment: `deploy/systemd/tet-node.service` (hardened: `NoNewPrivileges`, `ProtectSystem=strict`, `LimitNOFILE=1048576`, `Restart=always`) reading `/etc/tet-node/tet-node.env`. Docker: root `docker-compose.yml` with a CPU service and an `nvidia` GPU profile, healthcheck on `/status`, ports 5010 + 8002 tcp/udp.

**Known live topology (from the logs, as of June):** exactly **two nodes** — a Mac in Switzerland and a Hetzner/VPS in Finland (Helsinki). Whether that VPS is still running today is unknown from the repo. Risk R10 in the spec accepts the single-public-seed SPOF pre-ship.

## 2.5 Ledger

`sled` embedded KV, AES-GCM-encrypted values, with trees: `balances`, `meta`, `worker_stakes_v1`, `workers_registry_v1`, `tmail_by_receiver_v1`, `tmail_by_msg_id_v1`, `tmail_keys_v1`, files blob/meta/inbox keyspaces, audit log, tx index.

### Transaction types (`tet-core/src/protocol.rs`, `TxV1`)

| Variant | Mutates ledger | Added |
|---|---|---|
| `SignerLink { wallet_id }` | no (control plane) | early |
| `FoundingMemberEnroll { member_wallet }` | no (control plane) | early |
| `Transfer { from, to, amount_micro, fee_bps }` | **yes** | early |
| `GenesisBridge { founder_wallet, to, amount_micro }` | yes | early |
| `InitialAirdrop { wallet_id }` | **yes** | `2ce9024`, 2026-05-31 |
| `FileFee { from, storage_wallet, file_id, fee_micro }` | **yes** | `ed9b9bc`, 2026-06-10 |
| `WorkerRegister { wallet_id, hardware_id_hex, hardware_profile, capabilities, tflops_declared }` | yes (registry) | `ff6f7be`, 2026-06-12 |
| `EnterpriseInference { enterprise_wallet_id, prompt, model, amount_micro, nonce, prompt_sha256_hex, workload_flag, attestation_required }` | yes | early |
| `VerifyZkProof { task_id, image_id, journal_b64, receipt_b64 }` | yes | early |

Envelope: `SignedTxEnvelopeV1 { v, tx, sig: HybridSigV1, attestation: AttestationV1 }`. `HybridSigV1` carries Ed25519 pubkey-hex + sig plus ML-DSA pubkey + sig, all base64. `WorkloadFlag { Standard = 0, AiInference = 1 }` is the whitepaper's "fluid transaction routing" flag and only `EnterpriseInference` ever sets it.

**Dedup/idempotency pattern** (important, reused everywhere): a per-tx `applied_k` marker in the meta tree (`remote_tx_applied_v1:{tx_hash}`). Because tx bodies for airdrop/file-fee are unique by construction (`wallet_id`, `file_id`), the tx hash is unique and a replay is a no-op. **`TxV1::Transfer` has no nonce**, so two identical transfers produce the same hash and only the first applies. This is listed as known-deferred in the 2026-05-31 log — adding a nonce requires a schema change.

### Fee model (three different schedules coexist)

| Path | Rate | Split | Code |
|---|---|---|---|
| **Wallet transfer** `transfer_with_fee_attested` | **1%** — `PROTOCOL_MAINTENANCE_FEE_BPS = 100`, and the caller-supplied `fee_bps` is **ignored** (`let _ = fee_bps; let bps = PROTOCOL_MAINTENANCE_FEE_BPS;`) | 50% worker pool / 50% burn | `ledger.rs:6667` |
| **Consensus transfer** `apply_remote_transfer` | **uses the envelope's `fee_bps`** | 50% pool / 50% burn | `ledger.rs:2194` |
| **AI utility** `settle_ai_utility_payment` | `NETWORK_FEE_BPS = 2000` (20%) | **80% worker / 15% `dex:treasury` / 5% burn** (burn = 25% of the 20% fee) | `ledger/settlement.rs` |
| **AI inference (dynamic)** `settle_ai_inference_dynamic_charge` | charge = thermodynamic `R_micro` | **50% worker pool / 50% burn**, but during the Genesis Epoch (`height < GENESIS_EPOCH_BLOCK_LIMIT = 1_300_000`) the pool share is **×5** (`GENESIS_REWARD_MULTIPLIER`), capped at the full charge, with burn taking the remainder | `ledger.rs:6083` |
| **File fee** | `FILE_FEE_MICRO = 1000` µTET flat | **25% treasury / 50% storage node / 25% burn**; burn absorbs the integer-division remainder so the three parts always sum exactly | `files/mod.rs:51` |
| **Tmail / Pin / Anonymous** | spec'd 1 / 1,000 / 1,000,000 µTET, **50% treasury / 50% burn** | **not implemented** — `4d3fc72` explicitly deferred it rather than reintroduce an off-chain mutation | — |

Other economic constants: `SLASHING_PENALTY_BPS = 500` (5%), `MIN_WORKER_STAKE_MICRO = 1,000 TET` (bond, Sybil gate), legacy `WORKER_MIN_STAKE_MICRO = 5,000 TET` (different slot, meta-tree stake via `/wallet/stake`), welcome airdrop 1,000 TET × first 10,000 wallets, `GENESIS_1K_BONUS_TET = 10,000`, admin faucet clamp 1M TET/grant.

### Genesis allocation and treasury

`MAX_SUPPLY_MICRO = 10,000,000,000 TET × 1e6`. A `const _: () = assert!(GENESIS_TOTAL_MINT_MICRO == MAX_SUPPLY_MICRO)` enforces that genesis mints **the entire supply** — there is no ongoing issuance beyond redistribution from the worker pool.

| Slot | Address | Share |
|---|---|---|
| Worker pool | `000…0001` (`WALLET_WORKER_POOL`) — locked, no private key exists | **50%** (5B TET) |
| Founder | `TET_GENESIS_FOUNDER_WALLET_ID` (dev default `57e0b29d…36a0`) | **25%** (2.5B) |
| Treasury | `TET_TREASURY_ADDRESS` — **required env, no fallback**, must be 64 hex | **25%** (2.5B) |
| Protocol reserve | `000…0003` | **0** by design |
| Legacy ecosystem sentinel | `000…0002` | 0 post–Phase 2B |

`genesis_hash = deterministic_genesis_hash(founder, treasury)`, `chain_id_from_env()`. **Changing the reserve or any slot changes `genesis_hash` and makes the chain incompatible** — no migration path.

### Founder lock

`META_FOUNDER_GENESIS_UNLOCK_AT_MS` and `META_FOUNDER_GENESIS_LOCKED_MICRO` are written **once, at genesis**: unlock = `genesis_time + founder_genesis_cliff_ms()` (default `365 × 86,400,000` ms; `TET_FOUNDER_CLIFF_MS` override is read **only at genesis**), locked amount = the entire 2.5B founder tranche. Consequences, all confirmed by the 2026-05-29 investigation:

- Founder `balance = 2.5B`, `spendable = 0`. Signed transfers verify and then fail `InsufficientFunds`.
- **There is no early-unlock API and no governance path.** Time is the only key.
- On an existing DB the cliff cannot be changed, because the env var is never re-read.
- It is a **100% cliff, not a vest** — 2.5B unlocks in one instant.

This single fact is what produced **Strategy C**: the current chain can never become mainnet, because a one-shot 25%-of-supply unlock is an unshippable tokenomics headline. Phase 0 is a disposable testnet; Phase 1 cuts a fresh genesis with a properly designed cliff + linear vest. WP §17.3 still records "cliff vs linear vest" as open.

Separately, `wallet_presale_lock_until_ms_v1:` applies a configurable lock (`TET_PRESALE_LOCK_MS`) to any wallet funded from `dex:treasury`.

## 2.6 ZK-Court — implemented or scaffold?

**Implemented, with real cryptography, on an in-memory spine.**

`tet-core/src/vision/zk_court.rs` (601 LOC) implements a genuine state machine: `ChallengePhase::{None, ChallengeOpen, EvidencePending, SlashExecuted, Dismissed}`, `InferenceDisputeState` with open/close timestamps (`TET_ZK_COURT_CHALLENGE_MS`, default 24 h), challenger bonds, and `run_challenge_pipeline` → RISC Zero prove (timeout `TET_ZK_COURT_PROVE_TIMEOUT_SEC`, default 120 s) → journal-vs-commitment comparison. A **guilty** verdict requires the receipt to verify **and** the journal to contradict the commitment — conservative in the right direction. Guilty → `slash_worker_bond_to_ecosystem_all` (full liquid bond).

The commitment is domain-separated in `nexus-protocol`:
`SHA256("TET_ZK_COURT_COMMIT_V1" ‖ prompt ‖ 0xff ‖ response ‖ 0xff ‖ flops_le ‖ worker_pubkey)`.

What is *not* production-shaped:

- `static DISPUTES` and `static ARTIFACTS` are `Lazy<Mutex<HashMap>>` — **process memory is the primary store** (persisted variants exist: `record_inference_delivered_persisted`, `list_open_persisted`). A crash loses open disputes. Flagged Med severity in `WHITEPAPER_v1.0_GAPS.md`.
- `verify_optimistic_execution` (`POST /v1/vision/zk-court/verify-optimistic`) is a **dev-only placeholder** that treats an empty/`INVALID` proof as fraud. It was mainnet-unsafe and was fixed to return false and error on mainnet.
- `lambda_multiplier()` (`TET_SLASH_LAMBDA_MULTIPLIER`, default 100) is computed for §12's `S = λ·R_expected` model but **is not used as a slash cap** — the full bond is burned. This is a documented, deliberate mismatch ("Option C: keep full slash, document λ as telemetry").
- There is **no automatic watcher/challenger** and no incentive for anyone to open a challenge. Disputes require a human to call the REST endpoint. This is the load-bearing gap: optimistic execution is only as safe as the population of challengers, and that population is currently empty.
- Two parallel paths exist: on-chain `TxV1::VerifyZkProof` and the REST "vision court". Both use `zk_verifier`; the gaps doc says "document only".
- SP1: not integrated.

## 2.7 AI inference market — what `/ai/infer` actually does

`POST /ai/infer` (`tet-core/src/rest/handlers/ai.rs:604`), in order:

1. Validate `wallet_id` is 64 hex; `prompt` non-empty; **`flops` (u64 > 0) required**; **`nonce` (u64 > 0) required**.
2. **Consume the nonce in sled first** (`ai_consume_nonce`) — persistent, monotonic, replay-proof even on retry.
3. **Require a hybrid Ed25519 + ML-DSA signature** over `ai_infer_hybrid_auth_message_bytes(wallet, prompt, flops, nonce)`. Mandatory on all nodes, not just mainnet.
4. **Never grants the welcome airdrop.** `let welcome_airdrop_micro: Option<u64> = None;` with a long comment explaining that the old off-chain `claim_initial_airdrop` here forked non-producer nodes (fixed in `3bd2009`). New wallets must call `POST /ledger/initial_airdrop/claim` first.
5. Spam gate: raw `balances` balance ≥ **10 TET**.
6. Pick a worker: first entry in the **in-memory** `WorkerRegistry`, else `TET_DEFAULT_WORKER_ID`.
7. **If a worker exists** → forward to `post_ai_utility_impl` → the libp2p E2EE inference pipeline on the nexus plane → settlement via `settle_ai_utility_payment` (**80/15/5**).
8. **If no worker exists** → **single-node local fallback**: `worker_engine::run_local_inference` (real inference through the `InferenceExecutor` boundary, with SAFE-MODE content filtering), a fixed charge `AI_INFER_LOCAL_CHARGE_MICRO`, optional consensus spacing delay, settlement via `settle_ai_inference_dynamic_charge` (**50/50 with the ×5 Genesis-Epoch multiplier**), a RISC0 receipt via `generate_receipt_b64`, an audit row, and `zk_court::record_inference_delivered_full` to open the challenge window. Response includes `response`, `receipt_b64`, `local_fallback: true`, token counts, `flops`, `energy_wh`, `cost_micro`, `ncu`.

`POST /ai/infer_signed` is a thinner Ed25519-only variant (`sig` over prompt+nonce) that forwards into the same pipeline.

**Actual inference backend** (`ai_local.rs` priority order): `TET_AI_CMD` shell override (debug builds only) → **Candle quantized Llama-3-8B-Instruct GGUF** (`candle-core`/`candle-transformers`/`hf-hub`/`tokenizers`, downloads on first run, warns below 8 GB free RAM) → **Ollama** at `TET_OLLAMA_URL` → deterministic `poc_infer` stub as last resort.

**Economics reality check:** thermodynamic `R_micro = (C_flops / E_joules_per_flop) × Γ × scale`, where `C_flops` is **declared by the caller**, `E` is an env constant (`TET_JOULES_PER_FLOP`, default 1e-12), `Γ` is an env constant (default 1.0), and `scale` is a calibration env constant (default 1e-18). Nothing measures energy. The whitepaper is candid about this (§5.3: "η approximated indirectly via hardware fingerprint class… **not** per-device power telemetry"), but be clear-eyed: **the "energy peg" is currently three environment variables multiplied by a number the client supplies.**

`POST /ai/proxy` is a different, older surface: it accepts a payment envelope + model + input, verifies a hardware-bound `WorkerProofV1` for `tet/...` models, and can fall back to an external API. It has a `TET_WORKER_PROOF_STUB` dev bypass.

## 2.8 Files and Tmail (the two Phase 0 features that actually shipped)

**Tmail** (`tet-core/src/tmail/`, 560 LOC + UI): `TmailEnvelopeV1` with a canonical preimage, hybrid-signed; gossiped on `/tet/v1/tmail`; stored in three sled trees with a 7-day default TTL (30-day max, 50,000-entry cap, background prune); key directory at `/tmail/keys/:wallet_id`; UI Messages tab with 5-second polling and local decrypt. **Verified cross-region CH→FI in 1.3 s, ciphertext byte-identical on both nodes** (`356df5e`). Crypto: X25519 + Kyber768-r3 + HKDF-SHA256 + ChaCha20-Poly1305, byte-compatible between `e2ee.rs` and `tmail_e2ee.ts`. **No ledger fee or audit is charged** — deliberately deferred so as not to reintroduce an off-chain mutation.

**Files** (`tet-core/src/files/`, 705 LOC + 636-line `FilesPanel.tsx`): `FileEnvelopeV1`, ≤ 5 MB, 1:1, 30-day TTL. Announce plane = gossip (envelope metadata only); body plane = REST `GET /files/fetch/:id` with a **custom libp2p request/response codec** (`/tet/v1/files/fetch`) for cross-node pulls, caching locally after fetch. Fee settlement is **on-chain** via `TxV1::FileFee` (1000 µTET, 25/50/25). The node is a blind relay — it never sees plaintext filename, MIME, or bytes.

## 2.9 REST surface

`tet-core/src/rest/routes.rs` — **117 `.route()` registrations**. Layer order: CORS (outermost) → body limit → global rate limit → routes. Handlers live under `rest/handlers/` (22 modules).

Grouped: `/ledger/*` (state, blocks, mine, transfer, faucet, stake, unstake, me, proof, zk_verify, genesis_bridge, initial_airdrop/claim, mint_demo, recover-from-guardian) · `/wallet/*` (mnemonic new/recover, active, nonce, transfer, stake, slash) · `/tmail/*` (send, inbox, keys) · `/files/*` (upload, announce, fee, inbox, fetch, item) · `/worker/*` (register, enroll, list, status, rewards, model status/download, ai_engine/status, e2ee next/complete, stats, cockpit, pending) · `/ai/*` (infer, infer_signed, nonce, pricing, proxy, utility) · `/v1/vision/*` (caac challenge/complete/profile, zk-court challenge(s)/params/verify-optimistic, thermo/genesis, pqc/status, network config/stats, market/index, ledger me/initial_airdrop) · `/dex/*` (orderbook, place, cancel, take, settlement/confirm, trade/complete, sweep/refunds) · `/enterprise/inference[/submit]` · `/founder/*` (genesis, audit.csv, withdraw_treasury) · `/genesis/1000/*` · `/health/swarm`, `/metrics`, `/status`, `/logs` (SSE), `/telemetry/local`, `/network/{stats,power}` · `/phase4/*` (all return **501 Not Implemented**).

## 2.10 Sovereign OS UI

Next.js **16.1.6** App Router, React **19.2.3**, Tailwind 4, TypeScript. 13,683 lines under `app/`. Entry: `/os` → `OsClient.tsx` (**2,281 lines**, down from 3,100+ after the 10-step redesign).

**Nine tabs** (`type TabId`): AI Task Terminal (default) · Send Coins · Receive Coins · Messages · Files · Address Book · Transactions · Explorer · Worker. Grouped as Communication / Data / Compute.

**Win95 component library** (`app/os/components/`, 13 components): `Win95Button`, `Win95Panel`, `Win95Field`, `Win95Window`, `Win95TabBar`, `Win95Menu`, `tokens.ts` (single source of truth for bevels/colors/fonts), plus extracted `WalletSummaryHeader`, `WalletUnlockBody`, `NetworkStatusPanel`, `StatusBar`, `LedgerConsole`, `TitleBar`. `StatusBar` and `TitleBar` deliberately keep raw class strings (1 px bevel / navy chrome don't match the 2 px token definitions) — documented in JSDoc.

**Crypto in the browser:** `@noble/ed25519` (BIP39 `to_seed("")` → first 32 bytes, byte-parity with `wallet.rs` — there's a verification script `scripts/verify-ed25519-tet-parity.mjs`), `crystals-kyber-js`, `@noble/curves` (X25519), `@noble/ciphers` (ChaCha20-Poly1305), `@scure/bip39`. **`@polkadot/keyring` and `@polkadot/util-crypto` are still in `package.json`** — Substrate residue; they were removed from the signing path in `df59517` but not from the dependency list.

**Endpoints the UI actually hits** (real, not mocked): `/ledger/{state,me,blocks,initial_airdrop/claim}`, `/wallet/transfer`, `/ai/{infer,nonce}`, `/enterprise/inference/submit`, `/tmail/{send,inbox/:w,keys/:w}`, `/files/{upload,announce,fee,inbox/:w}`, `/worker/{enroll,cockpit/:w,rewards/:w,stats/:w,status/:w}`, `/network/stats`, `/market/index`, and the `/v1/vision/*` probes (caac/profile, pqc/status, thermo/genesis, network/config, ai/infer/estimate). Reached either directly via `NEXT_PUBLIC_TET_CORE_URL` or through the same-origin proxy `app/tet-node-api/[...path]/route.ts`, which tries `TET_CORE_ORIGIN` → `NEXT_PUBLIC_API_URL` → `NEXT_PUBLIC_TET_CORE_URL` → `127.0.0.1:5010` → `:8080` in order.

Other pages: `/` onboarding wizard, `/setup`, `/create-wallet`, `/understand`, `/participate`, `/whitepaper`, `/explorer` and `/worker` (legacy, redirect to `/os`). Next API routes: `/api/ollama/{generate,tags}`, `/api/tet/{nonce,infer_signed}`. i18n exists (`app/i18n/translations.ts`, 1,284 lines; EN/JP).

Interop verification scripts (real, executed, results recorded in commits): `tmail_interop_step4.mjs` (425 lines, 10/10 steps), `files_interop_step4.mjs` (552 lines), `files_interop_step3.mjs` (**untracked**), `verify-genesis-hash.mjs`, `verify-ed25519-tet-parity.mjs`, `debug-transfer-binding.mjs`.

---

# 3. Gap analysis

## 3.1 Whitepaper claim vs code reality

| # | WP claim | § | Code reality | Verdict |
|---|---|---|---|---|
| 1 | CAAC assigns PoC/PoR from hardware reality | 3.2, 6 | Static probe + SHA-256 timing challenge; role persisted; used only as a leader-election divisor, and only when `TET_CONSENSUS_LEADER_MODE=caac` | **Partial** (WP §6.4 says so) |
| 2 | Validator set / permissionless participation | 6 | `TET_VALIDATOR_IDS` env var. No on-chain set, no join protocol, no stake-weighted membership | **Gap not stated in WP** |
| 3 | Energy peg `R(T)=Σ[η·C]/D` | 5.1 | `(C_flops/E)×Γ×scale`, all env constants, `C_flops` **caller-declared** | **Partial, disclosed** (§5.3, §17.1) |
| 4 | ML-DSA (FIPS 204) from genesis | 7.1 | Real `dilithium-rs 0.2.0` ML-DSA-65 default, hybrid AND-verification. **Unaudited crate, no KAT suite in repo** | **Implemented, unvalidated** |
| 5 | "Post-quantum (ML-DSA / **ML-KEM** path)" vs Signal/Telegram/Session | 18.2 | KEM is **CRYSTALS-Kyber Round-3**, byte-incompatible with FIPS-203 ML-KEM-768 | **Overclaim.** Both sides agree with each other, but not with the standard the docs name |
| 6 | ZK-Court optimistic + cryptographic dispute | 8 | Full state machine + RISC0 prove + slash. In-memory primary store; **no watcher incentive, no automatic challenger** | **Implemented, unexercised** |
| 7 | SP1 prover | 8.3, 17.2 | Not integrated | **Open, disclosed** |
| 8 | 100% slash for ZK fraud | 12.1 | `slash_worker_bond_to_ecosystem_all` — full bond | **Aligned** |
| 9 | `S = λ·R_expected` | 12.2 | λ computed, not applied as a cap | **Documented mismatch** (§17.7) |
| 10 | Transfer fee 1%, 50/50 pool/burn | 11.6 | True for `/wallet/transfer`. `apply_remote_transfer` honors the envelope's `fee_bps` instead | **Divergent paths** |
| 11 | "50% of all transaction fees burned" | 11.7 | Three different splits coexist (50/50, 80/15/5, 25/50/25) | **Open, disclosed** (§17.7) |
| 12 | Tmail fees 1 Stevemon, 50/50 treasury/burn | 11.5 | **Not implemented.** No fee, no audit row on Tmail | **Not built** |
| 13 | Tmail time-lock delivery | 13.4, 17.8, AT-3 | **Not built** | **Not built** |
| 14 | Tmail burn-after-read | 13.4, 17.9, AT-4 | **Not built** | **Not built** |
| 15 | Tmail Anonymous Mode + ZK anchor (1 TET escrow) | 13.5, AT-5 | **Not built.** Critical-path sprint S8 never started | **Not built** |
| 16 | Tmail Pin (1000 Stevemon stake, >5 msgs) | 11.5, AT-7 | **Not built** | **Not built** |
| 17 | Mini-apps: Calculator, Clock, Notes | 13.3, AT-8 | **Not built** (S10) | **Not built** |
| 18 | Win95 shell with window manager, taskbar, boot sequence, sounds | 13.2, A.5 | A **tabbed** Win95-styled shell with a component library and modal `Win95Window`s. No WM, no taskbar, no boot sequence, no sounds | **Partial — different design** |
| 19 | Faucet 100 TET/day/IP | 19.1, D#10 | `POST /ledger/faucet` + `/faucet`, **admin Bearer token required**, per-wallet once + per-IP rate limit, source = worker pool. Tested 3/3 in production | **Implemented; not public** (a token-gated faucet is not a self-serve faucet) |
| 20 | Public seed node, builder joins in <30 min | B.1.1 | One Hetzner VPS in Helsinki, systemd + ufw + fail2ban + 4 GB swap. `RUNNING_A_NODE.md` exists (17 KB). Sprint-4 exit criteria were never formally signed off | **Partial** |
| 21 | CI/CD green on main | B.1.1 | **No `.github/workflows/` in the repo at all** | **Not built** |
| 22 | Hardware fingerprinting for Sybil resistance | 10, 17.5 | Heuristic hash; own docstring says "not a security anchor" | **Partial, disclosed** |
| 23 | Edge light clients (headers + Merkle branch) | 9 (v1.0 §8) | `state_root` exists; **no SPV protocol** | **Not built** |
| 24 | Worker "earn on your laptop" | 13.6, D.2 | `WorkerRegister` tx + registry + UI scaffold (`ff6f7be`). **No workload distribution, no task queue, no matching, no GPU integration** — explicitly out of scope in that commit | **Scaffold only, honestly labelled** |
| 25 | World Brain / Sentient Assets / Agent-Gate | 14–16 | **No code.** Correctly marked Part II "not Phase 0 deliverables" | **Vision, disclosed** |
| 26 | Multi-node sync at testnet scale | 17.11 | 2 nodes, 137k+ blocks, 10-hour soak clean. **72-hour public soak never done** | **Partial, disclosed** |

## 3.2 Every TODO / FIXME / `unimplemented!()`

**There are zero `TODO`, `FIXME`, `XXX`, `todo!()`, or `unimplemented!()` markers in the entire Rust and TypeScript source.** I verified this across `tet-core`, `nexus-protocol`, `nexus-wasm`, `tet-pqc-wasm`, `prover`, `methods`, `tet-cli`, and `tet-network/ui/app`. That is a deliberate hygiene choice, and it is a double-edged one: the codebase reads as finished, and incomplete work is instead marked by **naming and doc comments**. Here is that hidden inventory.

### Explicit stubs / placeholders

| File:line | What |
|---|---|
| `tet-core/src/rest/handlers/phase4.rs:4` | `/phase4/tee/status` → **501** "Phase 4: TEE compute stub" |
| `tet-core/src/rest/handlers/phase4.rs:10` | `/phase4/marketplace/status` → **501** "marketplace escrow stub" |
| `tet-core/src/rest/handlers/phase4.rs:16` | `/phase4/render-farm/status` → **501** "render farm stub" |
| `tet-core/src/tee_compute.rs:1,21` | Phase 4 stub: TEE compute; `open_session_stub()` returns `session_id: "tee_stub"` |
| `tet-core/src/marketplace.rs:1,16` | Phase 4 stub: P2P trading + escrow; `stub_offer()` → `offer_id: "escrow_stub"` |
| `tet-core/src/render_farm.rs:1,16` | Phase 4 stub: `split_frames_stub()` |
| `tet-core/src/oracle.rs:1,18` | Energy/CHF oracle stub; "Production should query a real oracle"; deterministic geo adjustment stub |
| `tet-core/src/executor.rs:209-214` | `StubExecutor`, `name() = "stub"`, "used until llama.cpp/candle integration is wired into this slim repo snapshot" |
| `tet-core/src/attestation.rs:4,92,145` | "trait boundary and stubs per OS"; `allow_stub_attestation()` via `TET_ATTESTATION_ALLOW_STUB` |
| `tet-core/src/rest/helpers.rs:222-228` | Stub attestation **forbidden on mainnet** |
| `tet-core/src/tet_worker/mod.rs:1,45,90-144` | "PoC stub"; `poe_execution_stub_b64` / `verify_poe_stub`, scheme id `"tet-zkp-poe-stub-v1"` — **the "ZK-PoE" in the `/ai/proxy` path is a SHA-256 commitment, not a proof** |
| `tet-core/src/ai_proxy.rs:192-225,360-368,445` | `TET_WORKER_PROOF_STUB` + `TET_WORKER_STUB_SK_HEX` + `TET_WORKER_STUB_HW_ID` dev bypass; response note claims "PoC verified (hardware-bound signature + ZK-PoE stub)" |
| `tet-core/src/vision/mod.rs:1` | *"Phase 0–2 whitepaper alignment: **scaffolding only** (types, traits, REST probes)"* — this covers `caac.rs`, `zk_court.rs`, `thermo_genesis.rs`, `pqc_bridge.rs`, `fluid_net.rs` |
| `tet-core/src/rest/handlers/vision.rs:1` | "REST scaffolding for whitepaper Phase 0–2 modules" |
| `tet-core/src/vision/zk_court.rs:504,513,566` | `verify-optimistic` is a "dev placeholder; mainnet returns error" |
| `tet-core/src/conductor.rs:3,33,113,140` | "deterministic scaffold. Production should distribute shards to remote workers"; VIDEO and SCIENTIFIC COMPUTE plugins are stubs |
| `tet-core/src/rest/handlers/network.rs:243,268-270` | "Verification engine stub"; CHF cost from shard count is a stub |
| `tet-core/src/rest/types.rs:298` | `redundancy: Option<u32>` — "require N matching outputs per shard (**stubbed**)" |
| `tet-core/src/ledger.rs:6338` | `chf_top_up_mint` — "Swiss CHF top-up (**Stripe placeholder**)" |
| `tet-core/src/ledger.rs:3127` | `total_tflops` — "dashboard scaffold" |
| `tet-core/src/workers/mod.rs:1,28` | "On-chain worker registry (Phase 0.5 **scaffold**)"; `total_rewards_micro` is a scaffold counter |
| `tet-core/src/protocol.rs:83` | `WorkerRegister` — "Phase 0.5 scaffold" |
| `tet-core/src/p2p_network.rs:929` | Trace root is a "**placeholder** for real trace merkle root" |
| `tet-core/src/p2p_dex.rs:71,383` | Solana settlement listener "(or stub)"; "real pending queue lands in Phase 4" |
| `tet-core/src/ai_filter.rs:54` | "Expect false positives. Phase 4.2 will add ML-based policy" |
| `tet-core/src/worker_config.rs:9` | `--unsafe-no-filter` disables "content filtering placeholders" |
| `nexus-wasm/src/lib.rs:5` | "gating wasm-only dependencies and providing **no-op stubs**" |

### `#[allow(dead_code)]` / `#[deprecated]`

`updater.rs:9,20,29` · `worker_daemon.rs:349,355` · `p2p_network.rs:398–410` (7 fields) · `ledger.rs:303,4982,5070,5447,6468` · `ai_filter.rs:11,14` · `wallet.rs:248` · `zk_verifier.rs:172` · `attestation.rs:9,29,40,48` · `network.rs:101` · `rest/types.rs:58` · **`p2p.rs:361` `#[deprecated] GLOBAL_STATE_TOPIC`** · `ledger.rs` `claim_initial_airdrop` (deprecated in `3bd2009`, kept only for legacy test compatibility).

### Open bugs with written investigations

| Doc | Status |
|---|---|
| `docs/BUG_block_9828_divergence_mystery.md` | **HIGH severity, root cause UNKNOWN.** Same `block_id`, same `tx_hashes`, different post-apply `state_root` on two nodes. Env-mismatch hypothesis disproven. `compute_state_root` confirmed deterministic (explicit sort, no HashMap/time/thread dependence). Did not reproduce after a full chain reset. The doc's own recommendation: forensic deep-dive before Phase 1 mainnet. **Still open.** |
| `docs/BUG_chain_state_divergence.md` | Resolved → `block_id` V2 (`c6e63a1`) |
| `docs/BUG_long_idle_connection_failure.md` | Resolved → `f08a020` |
| `docs/BUG_multiswarm_port_collision.md` | Resolved → `7a23ee6` |
| `docs/BUG_mac_sync_catchup_not_triggered.md` | Resolved → `767fee9` |
| `docs/SYNC_ISSUE.md` | Phase A/B implemented; 72 h public soak outstanding |

### Explicitly deferred, from commit messages and logs

1. **`TxV1::Transfer` has no nonce** — identical transfers collide on tx hash; fixing it changes the schema.
2. **FIPS-203 ML-KEM migration** — required "before Phase 0 ship", not done.
3. **Divergence auto-recovery ("Fix 5")** — recover from `state_root` mismatch via snapshot reset. Not built.
4. **`spawn_blocking` for `sync.rs:749`, `sync.rs:792`, `p2p.rs:1472`** — "Option F extension", not done.
5. **Per-block `state_root` checkpoint validation** (catch divergence early, not at tip) — proposed, not built.
6. **`"synced": false` display bug** — cosmetic, unfixed.
7. **Deeper detached-task refactor of the swarm accept loop** — "flagged for future work" in `83e0074`.

### Dead code and archived experiments

| Item | Disposition |
|---|---|
| `tet-core/src/onchain.rs`, `ledger/solana_client.rs` + 5 Solana/SPL deps | **Solana-era, still compiled.** Delete candidates. |
| `tet-network/primitives/`, `tet-network/services/tet-core/` | **Substrate-era, still git-tracked**, not in the workspace. `services/tet-core` name-collides with the real node. |
| `tet-network/chain/` | Source removed; **12 GB of build artifacts remain on disk** (untracked) |
| `nexus-onchain/` | Source removed; only `target/` remains |
| `nexus-frontend/` (1 `index.html`), `web-wallet/` (1 `README.md`), `pwa/` (empty) | Vestigial |
| `tet-worker/index.ts` (279 lines) | Legacy TS worker, superseded by `tet-core/src/bin/tet-worker.rs` |
| `tet-agent-sdk/` | Alive but still on `@polkadot/keyring` |
| `p2p_dex.rs` (589 LOC) + `/dex/*` routes | **v0 CHF-era product**, still live and routed |
| `chf_top_up_mint`, CHF/AML/fiat meta keys | v0 CHF-era, still live |
| `archive/` (3 whitepapers), `docs/archive/` | Correctly archived |
| Root clutter | `bootnode.log` (157 KB), `client.log` (159 KB), `worker.log` (53 KB), `node.log`, `prover.log`, `ignition-run.log`, `tet.db_5010/`, `tet.db_5011/`, `tet.db_8010/`, `test-ledger/`, `tet_ledger.json`, and a **zero-byte file literally named `10000000000`**. `1cc000f` removed testnet wallet files from git, but the local copies and logs remain on disk. |
| Disk | root `target/` **35 GB** + `tet-network/chain/target/` 12 GB + `services` 1.6 GB + `primitives` 258 MB + `ui` 894 MB ≈ **50 GB** |

### Terminology hazard: two Phase numbering systems

Code comments use a **legacy internal** scheme (Phase 1.1, 1.2, 1.3.1, 1.6, 1.8.1, 2.3, 2.5, 3.2, 4.1, 4.2, 4.3, 4.7, 5.2) that has **no relationship** to the whitepaper's Phase 0 / 0.1 / 0.5 / 1 / 2. E.g. `ai.rs:671` "Phase 5.2 + Phase 1 ledger" means nothing in whitepaper terms. Don't conflate them.

---

# 4. Ideas inventory (unfiltered)

Every idea found in WP §17, `docs/`, and code comments. No filtering, no ranking — source and stated status only.

## 4.1 Whitepaper §17 — Open Problems (canonical `WHITEPAPER.md`, §17.1–17.13)

| # | Idea | Stated status |
|---|---|---|
| 17.1 | Formal definition of **η(W_i)** under adversarial hardware impersonation (measurable on commodity HW, resistant to emulator timing attacks, composable into R(T)) | **Open** |
| 17.2 | **SP1 prover integration** as a second zkVM backend | **Open** (RISC0 partial) |
| 17.3 | **Founder unlock schedule** — cliff vs linear vest for mainnet | **Open** |
| 17.4 | **Worker pool emission curve** — constant vs decay | **Open** |
| 17.5 | **CAAC hardware fingerprinting attack model** — formal security game vs emulator / FPGA / cloud GPU posing as mobile | **Open** (impl partial) |
| 17.6 | **Cross-chain bridge design** — ETH/SOL/BTC custody | **Open** |
| 17.7 | **Slash magnitude + economics notation reconciliation** (100% slash vs λ·R_expected; 50/50 vs 80/15/5) | **Partial** |
| 17.8 | **Time-lock cryptography upgrade** — Phase 0 = stake-scheduled release (`release_at_ms`, social/protocol-enforced); Phase 0.1+ = **VDF** (class-group evaluation, research track) or threshold decryption | **Open** (VDF) |
| 17.9 | **Burn-after-reading cryptographic guarantee** — Phase 0 best-effort (cooperating peers delete on read-receipt gossip; malicious archivers retain); Phase 1+ forward secrecy + **key-destruction proofs**, possible CRDT-wide revocation research | **Open** |
| 17.10 | **REST API completeness** — `tx_hash` / block confirmation in `/wallet/transfer`; `amount_tet` f64 vs `amount_micro` u64 | **Open** |
| 17.11 | **Multi-node sync at public testnet scale** — 72 h soak | **Partial** |
| 17.12 | Dual `genesis_hash` class of bugs | **Closed** 2026-05-20; kept as a process lesson |
| 17.13 | **Mining hardware reuse for AI inference.** PoW networks burn ~150 TWh/yr with no useful output. Dual-purpose **GPU PoW miners** (GRIN, Ergo, ETC) during low-profit windows; **SHA-256 ASICs explicitly excluded**. Mechanism: idle-time auto-switching gated by real-time profitability oracles (hashprice vs thermodynamic `R_micro`) + CAAC role. Open Qs: incentive compatibility vs pool lock-in/variance; switching latency and thermal cycling; anti-cheating / fingerprint stability across protocol switches; pool economics (PPS/FPPS/stratum) without ToS violation or double-spent hashrate | **Research.** Phase 0 does not ship |

## 4.2 Whitepaper §17.14–17.16 — in `docs/WHITEPAPER_v1.1_DRAFT.md` only (added `972cdf9`, **never merged into canonical `WHITEPAPER.md`**)

| # | Idea | Stated status |
|---|---|---|
| 17.14 | **Browser-embedded node architecture.** Light TET node in-tab via libp2p WebRTC + light-client verification; goal is Foundation-operated infra trending to zero. Open Qs: WebRTC transport maturity (NAT, signaling, churn); IndexedDB state budget; mobile battery/data; light-client trust model + fraud proofs/sampling; cold-tab peer bootstrap | Research, **Phase 2+**, multi-year, no commitment |
| 17.15 | **AI-native smart contracts.** `infer(...)` as a first-class contract primitive rather than an oracle bridge; enables autonomous agents, on-chain moderation, verifiable AI workflows. Open Qs: determinism vs replayable state transitions; ZK-ML maturity; gas-equivalent metering on FLOPs/energy; model versioning + weight pinning; cross-validator runtime consistency | Research, **Phase 1–2**, no date |
| 17.16 | **Anchoring to external networks.** Periodic Merkle-root anchoring to Bitcoin/Ethereum/IPFS/Filecoin for independent long-term verifiability and audit-trail integrity (distinct from the §17.6 custody bridge). Open Qs: anchor cadence vs fee; Merkle root vs fuller commitment; third-party verifier tooling; cost model (calldata/blob, OP_RETURN/inscription) | Research, **Phase 1+**, unscheduled |

## 4.3 `docs/FUTURE_IDEAS.md` — the parking lot

The file's own rule: *"Build TET Phase 0 first (target 2026-09-15). Revisit only after ship. Logging an idea here is a commitment to NOT pursue it now."*

| Idea | Logged | Detail |
|---|---|---|
| **Quantum Security Company** | 2026-05-27 | A PQ-crypto company built on ML-DSA implementation expertise. The founder's own written self-assessment: *"If TET succeeds, this becomes a real strategic extension (A). If TET fails, this is just a shiny object I reached for to escape the grind (B)."* Against: cannot legally found a company solo at **15** (needs a guardian/representative in Japan, Switzerland, Singapore); red ocean (PQShield, SandboxAQ $500M+ Schmidt-backed, QuSecure, ISARA, Post-Quantum); TET *is* the best PQ demo; focus is the scarcest resource. **Revisit trigger: only after Phase 0 ships AND founder is 18+ AND a defensible niche exists.** Candidate niches: PQ for decentralized messaging (Tmail learnings); PQ + edge/IoT/mobile (CAAC/PoR learnings); PQ key management for the migration wave itself. |
| **Trust-curated search engine on TET** | 2026-05-29 | AI auto-evaluates source trustworthiness (public figures, verified institutions, publishers) and aggregates only trusted information; code analysis surfaces hidden high-quality GitHub projects matching a query; **no account required** (privacy + sovereignty). Framed as automating "only believe specific trusted sources". TET connection: curation runs on worker-mode inference; token incentives for good curators/source-evaluators; same philosophy as Tmail; **mining = providing AI compute = building the curation/search index**. Rationale: information trust is collapsing in the AI era — Google SEO-polluted, Twitter engagement-baited, TikTok centralized. Founder committed to doing it eventually, integrated with TET, **Phase 2–3**. Action on revisit: decide whether it becomes a formal §17 entry; whether worker-mode design should include the curation use case; investigate index build cost, legal exposure, and the trust-scoring algorithm. |

## 4.4 `docs/SOVEREIGN_OS_PHASE0_SPEC.md` §B.3 — **TNS (TET Naming Service)**

Added `cb355da` (2026-06-02), the largest single un-started idea in the repo. Phase 0.5 candidate.

- **Motivation:** 64-hex wallet IDs are "unmemorable, unspoken, unshareable — the single biggest UX barrier."
- **Formats:** (A) native `name.tmail`, lowercase, 3–32 chars, Unicode in 0.5+; (B) DNS bridge `localpart@domain` via `_tet-wallet.domain` TXT record + signature, optional on-chain pin.
- **Tx types:** `tns_register_v1`, `tns_renew_v1`, `tns_transfer_v1`, `tns_update_v1`, `tns_dispute_v1`, `tns_dns_pin_v1`.
- **Pricing tiers:** 5+ chars → 1 TET stake + 0.01 TET/yr · 3–4 chars → 10 TET + 0.1 TET/yr, Dutch auction · 1–2 chars → reserved at genesis, treasury auction Phase 1+ · trademark → 100 TET + 1 TET/yr with verification · DNS bridge → 1 TET/yr per domain. **Renewals: 50% burn / 50% treasury.**
- **Anti-squatting:** identical/homograph blocked; trademark disputes via ZK-Court §14.1; inactive >180 d no message + >365 d no renewal → public auction; punycode normalization.
- **Multi-app identity:** one name across Tmail, Files (`alice.tmail/files/cid`), AI Worker registration, Address Book, Anonymous Tmail (ZK proof of name ownership).
- **Privacy:** public registry by default; private resolution via RISC0 ZK proof for journalism/whistleblower use.
- **REST:** `GET /tns/resolve/:name`, `/tns/lookup/:wallet_id`, `/tns/dns/:domain`, `/tns/auctions`; `POST /tns/{register,renew,transfer,dispute}`.
- **Phasing:** 0.5a (Oct–Nov 2026) registry + resolution cache + REST + Tmail autocomplete, 5+ chars · 0.5b (Dec 2026) DNS bridge, short-name auction, ZK-Court disputes, Files integration · Phase 1 (2027 Q1) worker registration, avatar CIDs, mobile · Phase 2 (2027 Q2–Q3) Anonymous TNS (ZK), ENS bridge, Unicode.
- **Open problems:** DNS hijacking → on-chain pin; squatting → ZK-Court + time-based release; short-name pricing → Dutch auction; ENS migration → Phase 2 bridge with proof-of-control; Unicode → punycode + visual confusion detection.
- **Positioning:** *"ENS solves 'send 0.1 ETH to vitalik.eth'. TNS solves 'send your story to nytimes.tmail anonymously, have them verify it's a legitimate journalist, and ensure quantum-safe end-to-end encryption' — all from one name."*

## 4.5 `docs/SOVEREIGN_OS_PHASE0_SPEC.md` Part D — post-Phase-0 scope

**D.1 Phase 0.1:** Tmail **Voice** (audio E2EE + size caps) · **Verifiable timestamp** signed by a tet-core block hash · **Reply-chain** thread graph on `msg_id` parent · **Browser app window** (libp2p light-client proxy via the node) · **VDF time-lock upgrade** if the research lands · **Tip Jar mini-app** · File-share fee curve · 2nd-seed trigger metric (TBD).

**D.2 Phase 0.5 — AI Worker mode:** Win95 **Worker.app** (hidden in P0, `SHOW_WORKER_TAB=true`) · `/ledger/stake` UI + register heartbeat · async payout settlement on `VerifyZkProof` · Ollama + RISC0 daemon docs · **explicitly: "Not marketed as 'earn on laptop' until settlement is fixed."**

**D.3 Phase 1:** formal η · formal CAAC fingerprint model · **worker registry persistence** · **mini-app SDK + third-party signing** · SP1 dual-prover.

## 4.6 Ideas embedded in the Phase 0 spec (Part A) that were designed but never built

- **A.2 Time-lock**, four approaches compared; Phase 0 selection = "**C + envelope commit**" (stake-scheduled), VDF deferred.
- **A.3 Burn-after-reading**, layered mechanism + read-receipt flow + interaction with the 5-message cap.
- **A.4 Anonymous Mode**: ephemeral wallet generation in the UI, **RISC0 ZK ownership proof**, **anchor-only audit trail**, misuse prevention, and an explicit "implementation risk" section. Guest program `methods/guest/tmail_anchor`, ledger tree `anonymous.rs`, `GET /tmail/audit/self`, UI stake slider + "24h settle" explainer, security review requirement (no anchor leak in gossip).
- **A.5 Win95 shell**: window manager behavior spec, app registration, **shared identity bus**, boot sequence, **sound effects**.
- **A.6 Files**: modes, `FileShareEnvelopeV1`, share link via local mailbox.
- **A.7 Mini-apps** (Calc, Clock, Notes, Explorer window, sound polish).
- **Appendix B gossip `kind` registry**: `tmail_envelope_v1`, `tmail_burn_revoke_v1`, `file_share_v1`, **`file_pin_v1` (replication)**.
- **Appendix C**: file pin per GB/day = 1,000,000 µTET; free tier 100 Tmail/day/wallet, rate-limited by count not price.
- **Appendix F**: 256 KiB gossip budget (`TET_TMAIL_MAX_GOSSIP_BYTES`); larger attachments go to Files with the Tmail body carrying a `file_cid`.

## 4.7 `docs/DESIGN_SOVEREIGN_OS_SUITE.md` (2026-05-19)

- Analysis of which of the three libp2p planes should carry Messages/Files → **block plane** (a 4th swarm rejected for port/NAT/bootnode complexity; the inference plane rejected to avoid mixing with scoring/E2EE pipelines). This decision held.
- **Part F: "5 messages limit" as founder philosophy** — a deliberate scarcity constraint on conversation retention, with Pin stake as the escape hatch.
- Storage incentives for Files; `TxV1` variants for the ledger impact; effort estimates; a list of decisions escalated to Steve.

## 4.8 `SPRINT0_ISSUES.md` — production-readiness backlog (never closed)

**§E "Revolutionary ideas":** Neural State Transition — unimplemented · Sentient Assets — unimplemented · ZK-Court "conceptually stubbed", full dispute workflow + proof engine wiring incomplete · **Federated / continuous learning — unimplemented.**

**§A Network/ops:** productionized bootnode distribution · peer scoring + eviction · DoS resistance + partition rules · public RPC defense (method allowlist, auth, reverse proxy, WAF/DDoS) · **node role separation (validator/full/archive/sentry/public-rpc/indexer)** · mempool policy (priority, replacement, spam suppression, fee-bytes) · state DB SRE (compaction, backup, snapshot, restore, IO tuning) · **reproducible + signed builds, rollback strategy** · incident ops (emergency stop, key-leak process, fork handling).

**§B/C/D/F:** full event-driven indexer/explorer · production wallet key management (domain separation, restore UX, audit logs) · **API contract versioning + deprecation policy** · Prometheus/Grafana/Alertmanager + SLOs · external security audit pipeline · **economic parameter governance** (fee market / slashing / reward formula) · CAAC threshold + capability routing · genesis/vesting/treasury/release/burn lifecycle · tokenomics constants unified chain+UI · **network ops dashboards** (block-time distribution, finality/reorg, tx pool stats, RPC p95).

Issue templates already drafted: P0-1 RPC allowlist/auth/rate-limit · P0-2 node role separation · P0-3 peer scoring/eviction/DoS · P0-4 observability dashboards + alerts · P0-5 key management + fail-closed start · P0-6 CAAC gating minimum · P1-7 slashing MVP wiring · P1-8 proof schema v1 enforcement E2E · P1-9 tokenomics single source of truth + tests · P2-10 OS earnings + job engine real wiring · P2-11 explorer full event exploration · P2-12 production docs + 72 h soak Go/No-Go.

## 4.9 `docs/WHITEPAPER_v1.0_GAPS.md` — Phase 1+ backlog

SP1 verifier backend (**High**) · remove global `DISPUTES`/`ARTIFACTS` Lazy maps (Med) · align slash magnitude with §14.3 (Med) · **automatic challenge scheduler / watcher incentives** (Med) · bind optimistic main-chain acceptance to the dispute state machine (Med) · **proof size / data-availability policy for on-chain receipts** (Low) · pick canonical denomination naming (Stevemon vs micro-TET) · add `tx_hash` / `block_height` to `/wallet/transfer` · Protocol Reserve purpose definition.

## 4.10 `.cursor_nexus_project.md` (2026-04-15) — pre-pivot ideas still unbuilt

Note: the economics here (**10% founder premine, 1% mint fee to founder, 0.5–1.0% transfer fee to founder**) were **superseded** by the 25/50/25 model. But the following survive as ideas:

- **ESR (Energy Standard Ratio)** — expose `Σ J / Σ TET` as verifiable ledger metadata. Never implemented under that name.
- **Delta Sync** — eventually-consistent state reconciliation via cursor-based paging + monotonic IDs.
- **Scale to 200M nodes** via monotonic IDs + paging, then shard state (peer-prefix / ranges / topic partitioning).
- **B2B Gateway as an OpenAI-compatible API** — "top priority"; external devs buy TET with fiat/cards and spend it on inference; the gateway is the auth/billing/rate-limit/audit/abuse boundary protecting the P2P interior. (`/ai/proxy` and `/v1/b2b/compute` are the vestiges.)
- **Fiat bridge (CHF/USD)** settling directly without stablecoins.
- **Hardware attestation** via Secure Enclave / TPM 2.0 to prevent energy fraud.
- **PQC rollout ladder:** PQ signatures optional → required; PQ KEM for key exchange (outside Noise or via protocol extension); **migrate key generation to TRNG (Secure Enclave/TPM)**; deprecate classical crypto with a defined audit/migration window.
- **Web wallet PWA** (no-install transfers/balances/API keys).
- **ERC-20 / SPL wrapping interfaces** for external chain bridges.
- Invariant/property testing to continuously prove hard-cap safety (this one **was** built — `invariant_tests.rs`, `proptest`).

## 4.11 Ideas in code comments

- `caac.rs:99` — "Dynamic PoC vs PoR assignment (**routing hook for future scheduler**)" — the scheduler doesn't exist.
- `conductor.rs` — sharding plugins for **VIDEO RENDERING** (frame splitting) and **SCIENTIFIC COMPUTE** (grid tiling), both stubs; "Production should distribute shards to remote workers."
- `conductor_plugins.rs` (165 LOC) — plugin architecture for shard types.
- `replication.rs` (95 LOC) — ledger replication, minimal.
- `chaos.rs` (99 LOC) — chaos-testing hooks.
- `energy_oracle.rs` (43 LOC) — energy pricing oracle.
- `compute_v1.rs` (70 LOC) — compute job API v1.
- `verification_engine.rs` (54 LOC) — redundancy-based output verification ("require N matching outputs per shard", stubbed).
- `updater.rs` (45 LOC) — self-update path, entirely `#[allow(dead_code)]`.
- `p2p.rs:1315` — NAT'd workers/clients **reserve a relay slot on the first bootnode**; `:1359` explicit `/p2p/<peer_id>` dials treated as relay; `:1269` **WebRTC-direct (UDP) on the same port as TCP** — groundwork for §17.14 browser nodes.
- `p2p_network.rs:1199` — "Phase 4.7: Store last verified inference for browser UI (**trustless verification demo**)."
- `rest/types.rs:12` — "Versioned format for future evolution"; `consensus.rs:380` — V2 "leaves room for a future V3."
- `ai_filter.rs:54` — "Phase 4.2 will add **ML-based policy**" for content filtering.

## 4.12 `docs/FOUNDER_NOTES.md` — the operating philosophy (essay, 3rd person, 2026-05-24)

Not features, but the decision rules behind them, and worth reading before you change direction:

- **Rule 1 — geographic arbitrage:** find business in the difference between what exists in one place and not another; transplant proven patterns, test the market, cut cost to the bone.
- **Rule 2 — multiplication, not addition:** life experience × idea × technology choice. TET = libp2p × ledger × PQ crypto × a personal orientation toward introversion and anonymity.
- **Rule 3 — visualize the success state:** repeatedly simulate *after* it worked. `E=mc²` (mass–energy equivalence) and TET's *compute = energy* are the same "E=" story. Imagination is a design input, not decoration.
- **On AI:** the gap between those who use AI and those used by it will widen; AI only dulls learning for people who weren't learning.
- **On founder identity:** known online as **Steve**; wants **"Steve" treated as a group, not a person**; intends to **hand the project to trusted members** once the ecosystem stands up and **stay out of the spotlight** — because a centralized company would contradict decentralized AI.
- Explicit mapping of each principle to a TET design decision.

---

# 5. Sprint 4 / Phase 0 remaining scope as last documented

**Source of truth:** `docs/SOVEREIGN_OS_PHASE0_SPEC.md` v0.3 (2026-05-19, +TNS 2026-06-02), cross-checked against `WHITEPAPER.md` §19.1 and the daily logs through 2026-06-12. Numbering scheme **B** (see §1.3).

## 5.1 Sprint 4 — L1 Foundation (16 dev-days). The gate for everything else.

| Work item | Est. | Last documented state |
|---|---|---|
| **Public seed ×1** — Hetzner EU, static IP, bootnode multiaddr | 3 d | **Done.** Helsinki VPS hardened 2026-05-28: systemd auto-start, fixed `TET_P2P_LISTEN=/ip4/0.0.0.0/tcp/4001`, ufw (22/4001/5010 only), fail2ban (61 fails / 8 IPs banned on day one), 4 GB swap, persistent DB at `/opt/tet-core-data`. Later re-hardened with `WatchdogSec=120`. **Liveness today unknown.** |
| **Faucet** — 100 TET/day/IP | 3 d | **Partial.** `POST /ledger/faucet` + `/faucet` exist; source = worker pool; per-wallet once + per-IP rate limit; production-tested 3/3 (claim / IP-limit / unauthorized) on 2026-05-29 and again on the post-hard-fork chain. **But it requires an admin Bearer token** (`TET_ADMIN_API_KEY`, stored `chmod 600` at `/root/admin_token.txt`). There is no public self-serve faucet UI or endpoint. |
| **Docker (node + UI)** — `docker compose up` brings up both | 4 d | **Partial.** Root `docker-compose.yml` runs `tet-core` (+ `tet-core-gpu` profile) only. `tet-network/ui/Dockerfile` exists but **no compose service wires the UI**. Locked decision #12 requires node + UI. |
| **CI/CD (GitHub Actions)** — `cargo test`, `cargo clippy`, UI `npm run build` + lint, required check on `main` | 2 d | **Not done.** No `.github/` directory in the repo. Every "PASS" in the commit log is a local run. |
| **Public operator docs** — extend `RUNNING_A_NODE.md` | 2 d | **Partial.** `RUNNING_A_NODE.md` is 17 KB but dated 2026-05-19 — it predates the port split (4001/4003/4005), the watchdog, `/health/swarm`, the `block_id` V2 fork, Tmail, and Files. |
| **Monitoring + logs** | 2 d | **Partial.** JSON tracing, `/metrics`, `/health/swarm`, systemd watchdog, `observability/{prometheus,grafana}` scaffolding. No dashboards, no alerting, no SLOs. |

**Sprint 4 exit criteria (the Foundation gate) — none formally signed off:**

- [ ] ≥1 public seed reachable from the internet with a documented multiaddr — *seed exists; the multiaddr is not published in any tracked doc*
- [ ] Faucet funds a test wallet, UI or curl documented — *works, but admin-token-gated*
- [ ] Fresh machine: `docker compose up` → **node + UI** against the public seed with **no local genesis hack** — **not met (UI not in compose)**
- [ ] CI green on the default branch — **not met (no CI)**
- [ ] A builder can follow `RUNNING_A_NODE.md` and join the testnet in under 30 minutes — **unverified, and the doc is stale**

Risk **R8** in the spec is explicit: *"No L1 Foundation before Tmail → Sprint 4 gate — do not start S5 until AT-F1 passes."* **Tmail (S5/S6) and Files (S9) were built anyway, ahead of the gate.** That was the right call for product velocity and it produced two verified cross-region features, but it means the Foundation deliverables were never forced to completion by their own dependency ordering.

## 5.2 Sprints 5–11 — as last documented vs. as actually built

| Sprint | Planned | Actual |
|---|---|---|
| **S5** Tmail protocol (10 d) | gossip topic, `TmailEnvelopeV1`, REST, **ledger audit + 1-Stevemon fee**, 2-node test | **Done except the fee/audit**, deliberately deferred (`4d3fc72`) |
| **S6** Win95 shell + Basic Tmail UI (12 d) | Basic E2EE E2E, **WM + taskbar + boot**, Wallet app port, 98.css | E2EE **done and cross-region verified**. Shell delivered as a **tabbed** Win95-styled UI with a 13-component library — **no window manager, no taskbar, no boot sequence** |
| **S7** Time-lock + Burn + Pin (12 d) | `release_at_ms` paths, burn paths, threads, 5-msg cap + Pin stake | **Not started.** (The 5-newest + "Show older" UI cap exists; the stake economy does not) |
| **S8** Anonymous (15 d) — **critical path** | `methods/guest/tmail_anchor` RISC0 program, `anonymous.rs` escrow tree, `GET /tmail/audit/self`, stake slider UI, security review for anchor leakage | **Not started.** Risk R1: *"Anonymous ZK not ready → slip ship; never ship placeholder UI."* |
| **S9** Files (12 d) | upload, chunk RR, P2P pull, Files window | **Done** — Steps 1–4 including the custom libp2p codec and on-chain fee settlement |
| **S10** Mini-apps (8 d) | Calculator, Clock, Notes, Explorer window, sound polish | **Not started.** (An Explorer *tab* exists) |
| **S11** QA + ship (8 d) | QA matrix, public testnet smoke, ship candidate | **Not started** |

## 5.3 Phase 0 acceptance tests — status

| AT | Requirement | Status |
|---|---|---|
| **AT-F1** | Clean laptop → `RUNNING_A_NODE.md` → join public seed → faucet → `/ledger/me` → send 1 TET | **Not passed** (Docker UI, CI, public faucet, stale docs) |
| **AT-0** | `localhost:3000/os` → Win95 boot → desktop | **Partial** — the desktop renders; there is no boot sequence |
| **AT-1** | Wallet: send 1 TET, friend's balance rises | **PASS** — verified 2026-05-31, "Confirmed in block 7394", both nodes agreeing |
| **AT-2** | Tmail Basic: friend decrypts | **PASS** — verified 2026-05-31 (2 browsers) and 2026-06-05 (CH→FI, 1.3 s) |
| **AT-3** | Time-lock | **FAIL — not built** |
| **AT-4** | Burn-after-read | **FAIL — not built** |
| **AT-5** | Anonymous with 1 TET escrow | **FAIL — not built** |
| **AT-6** | Files: upload, share, P2P download on a second machine | **Likely PASS** — Step 4 shipped with a 552-line interop script; I found no log entry recording a two-machine run |
| **AT-7** | Pin: 1000 Stevemon stake retains >5 messages | **FAIL — not built** |
| **AT-8** | Mini-apps | **FAIL — not built** |
| **AT-9** | All Tmail/transfer signatures verify ML-DSA + Ed25519 | **PASS** |

**Locked decision #6:** *"Marketing = AT-3 + AT-4 + AT-5 required."* All three are unbuilt. **By the project's own written criteria, Phase 0 cannot be announced.**

## 5.4 Locked decisions (Appendix D, 2026-05-19) — for the record

1. Time-lock = stake-scheduled (Phase 0); VDF → 0.1 · 2. Burn UI = best-effort copy · 3. Anonymous escrow = 1 TET · 4. UI legal = "Inspired by 1990s desktop OS", no Microsoft marks · 5. **Ship = 2026-09-15, freeze 2026-08-31** · 6. Marketing requires AT-3+4+5 · 7. Worker tab hidden (`SHOW_WORKER_TAB=true`) · 8. One-click Docker required · 9. **Sprint 4 = L1 Foundation** · 10. Faucet = 100 TET/day/IP · 11. Seed = 1 pre-ship, 2 post-traffic · 12. Docker = node + UI compose.

## 5.5 Strategy C (locked 2026-05-29) — the most consequential live decision

Three options were considered: **A** promote the running chain to mainnet · **B** reset and rebuild · **C** Phase 0 = experimental testnet, Phase 1 = fresh genesis.

**C was chosen**, forced by the founder-lock finding (§2.5): the live chain has a one-shot 2.5B-TET unlock burned into its genesis, which is an unshippable supply-shock headline. Therefore:

- The current chain is **disposable**. Chain resets are cheap and were performed repeatedly — this is *correct* behavior for Phase 0, not sloppiness.
- Phase 1 mainnet needs a **new genesis** with **cliff + linear vesting** designed in from block 0, and that design must be written into WP §17.3 (next-step item #2 from 2026-05-29; **not done**).
- Anything that requires a genesis-schema change — **adding a nonce to `TxV1::Transfer`**, reserve allocation, denomination rename — should be **batched into the Phase 1 genesis**, not retrofitted.
- Corollary from the 2026-05-30 log: *"Phase 0 testnet is the window for chain-core changes. After Phase 1 mainnet, a `block_id` schema change is impossible without a full chain reset."* **That window is still open. It closes at Phase 1 genesis.**

## 5.6 Explicit non-goals for Phase 0 (WP §19.1)

Part II primitives (§14–16 World Brain / Sentient Assets / Agent-Gate) · mainnet freeze · SP1 · cross-chain bridges · productized AI Worker earn (that is Phase 0.5).

---

# 6. What I would want to know on day one

Ordered by how much they change your first decision, not by severity.

1. **Is the Helsinki seed still running, and is the chain still advancing?** Everything in §5 is conditional on that. It was at 137,000+ blocks on 2026-06-10. Check `/health/swarm`, `/ledger/state`, and `journalctl -u tet-core`. One `curl` answers whether this is a live testnet or a cold archive.
2. **Why did work stop on 2026-06-12?** The repo offers no answer. Risk R3 in the spec — *"Steve health / summer bandwidth"* — was written down as a foreseen risk, and the founder is **15 years old** (per `FUTURE_IDEAS.md`). The right move is to ask, not to infer.
3. **Phase 0 cannot be announced as specified.** AT-3/4/5 gate marketing and none exist. Either build Sprints 7–8 (≈27 dev-days est.) or formally rescope what "Phase 0" means and update WP §19.1, the README, and the spec together. Do not quietly ship a subset under the old name — the project's documented norm is the opposite of that.
4. **Fix the whitepaper divergence first; it costs an hour.** Merge §17.14–17.16 into canonical `WHITEPAPER.md`, delete the stale "Draft, does not supersede" header, and either deprecate or delete root `LITEPAPER.md` (it still advertises a CHF peg the project abandoned six months ago). A prospective contributor reading the repo today gets three mutually contradictory economic models.
5. **Two cryptographic claims need decisions before anyone reads this as post-quantum.** (a) The KEM is **Kyber Round-3, not FIPS-203 ML-KEM**, while the docs say ML-KEM and the comparison table in §18.2 uses it to beat Signal and Session. Either migrate both sides or correct the claim. (b) `dilithium-rs 0.2.0` is carrying the entire FIPS-204 claim with no audit and no KAT vectors in the repo. At minimum, add ACVP/KAT test vectors to `tests.rs` — that is a day of work and it converts an assertion into evidence.
6. **`docs/BUG_block_9828_divergence_mystery.md` is unresolved and is a mainnet-blocking class of bug.** Identical `block_id`, identical `tx_hashes`, divergent `state_root`. It did not reproduce after a reset, which is the worst possible outcome — it means the mechanism is still in the code. The doc's own suggestion (per-block `state_root` checkpoints instead of tip-only validation) is the right instrumentation and should land before Phase 1 genesis.
7. **There is no CI.** Sixty-five commits, 143 tests, zero automated runs. This is the cheapest high-value thing to add and it was already a Sprint 4 line item.
8. **The Phase 1 genesis is a one-way door and its design isn't written.** Founder vesting (cliff + linear), `TxV1::Transfer` nonce, reserve allocation, denomination naming, and any `block_id`/schema change must all be decided *before* that ceremony. Right now only the decision to *have* a new genesis (Strategy C) is recorded; the contents are not. Write the Phase 1 genesis spec while the Phase 0 window is still open.
9. **About 50 GB of build artifacts and two dead Substrate crates are still in the tree**, plus a live Solana client compiled into `tet-core` and a CHF-era DEX on public routes. None of it is urgent; all of it is confusing to a newcomer and inflates build times and dependency-audit surface.
10. **The documentation culture here is an asset — protect it.** Six detailed daily logs, five bug post-mortems with root causes and disproven hypotheses, a whitepaper section whose stated job is to record where the code diverges from the prose, and a parking-lot file whose explicit rule is that *writing an idea down is a commitment not to chase it now.* The engineering has real gaps. The honesty about those gaps is unusually good, and it is the reason this archaeology was possible at all.

---

*Compiled by read-only inspection on 2026-09-17. Every file:line and commit hash cited above was read directly. Nothing was built or executed; test-suite status is as last reported in commit messages, not re-verified.*
