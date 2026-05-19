# Whitepaper Genesis v1.0 — Implementation Gaps (Sprint 2)

**Scope:** ZK-Court / lazy-evaluation fraud path (`tet-core/src/vision/zk_court.rs`, `zk_verifier.rs`, `protocol.rs` `TxV1::VerifyZkProof`).  
**Reference:** `WHITEPAPER.md` §5.1 (Sovereign Runtime), §14.1 (Lazy Evaluation), §14.3 (Economic Finality).  
**Audit source:** `docs/CODEBASE_OVERVIEW.md` v2 §9 (`zk_court.rs` rated **部分**).

---

## 1. WP claims vs code (summary)

| WP claim | Location | Implementation | Status |
|----------|----------|----------------|--------|
| Optimistic acceptance + **challenge window** | §5.1, §14.1 | `record_inference_delivered*` → `ChallengeOpen`; `submit_challenge` enforces phase + **open/close timestamps** | **Aligned** (Sprint 2 B.1 tightened close) |
| Any watcher may challenge during window | §14.1 | `POST /v1/vision/zk-court/challenge` + challenger bond (`zkcourt_lock_challenger_bond`) | **Partial** (bond required; no on-chain watcher registry) |
| RISC Zero **or SP1** zkVM replay | §14.1, §5.1 | RISC Zero guest via `prove_zk_court_receipt` when `NEXUS_GUEST_ELF` non-empty | **Partial** — SP1 not integrated |
| Trace contradicting commitment → slash | §14.1 | `run_challenge_pipeline` → guilty only if receipt verifies **and** journal mismatches commitment | **Aligned** (conservative) |
| **100% slash of staked TET** | §14.1, §5.1 | `slash_worker_bond_to_ecosystem_all` (full liquid bond burn) | **Mostly aligned** (see §14.3 λ note) |
| \(S = \lambda \cdot R_{\text{expected}}\) | §14.3 | `lambda_multiplier()` computed; **not** used as slash cap (full bond burned) | **Documented mismatch** |
| Mainnet must not rely on mock proofs | implied | `zk_verifier::mock_zk_allowed` + `main.rs` panic if `TET_MAINNET=1` && `TET_ALLOW_MOCK_ZK=1` | **Aligned** |
| Dev mock boundary explicit | engineering | `MOCKJ1:` / `MOCKZC1:` in `zk_verifier`; `zk_dev_mock_allowed()` exported (B.1) | **Aligned** (Sprint 2) |

---

## 2. §14.1 — Lazy evaluation (detailed)

### 2.1 What WP says

- PoC may submit fabricated inference; ZK-Court defends during a **challenge window**.
- Watchers run **RISC Zero or SP1** execution trace against the commitment.
- Contradiction → **100% slash** of staked TET; fraud has negative expected value.

### 2.2 What code does

**Files:** `vision/zk_court.rs`, `zk_verifier.rs`, `worker_daemon.rs`, `rest/handlers/vision.rs`, `consensus.rs` (`VerifyZkProof`).

1. **Delivery & window** — `record_inference_delivered_full` stores `InferenceArtifact` (prompt, response, flops, SHA-256 commitment) and opens `InferenceDisputeState` with `challenge_opens_at_ms` / `challenge_closes_at_ms` (`TET_ZK_COURT_CHALLENGE_MS`, default 24h).

2. **Challenge submit** — `submit_challenge` locks challenger bond, moves phase to `EvidencePending`. **Sprint 2 B.1:** rejects submit before open or after close.

3. **Prove & verdict** — `run_challenge_pipeline`:
   - Spawns blocking RISC0 prove (`prove_zk_court_receipt`).
   - **Guilty** only if `zk_definitive_invalid` (receipt OK, journal ≠ commitment) **and** host transcript consistent.
   - Prove timeout / ELF empty / verify error → **dismissed**, not guilty (mainnet-safe).

4. **Slash** — `apply_slash_verdict(true)` → `slash_worker_bond_to_ecosystem_all(worker)` (entire bond to ecosystem wallet).

5. **Persistence** — Disputes/artifacts: in-memory `Lazy<Mutex<HashMap>>` **plus** ledger KV (`zkcourt_put_*`). Restart can repopulate from ledger for disputes; artifacts fall back to ledger read in pipeline.

6. **REST**
   - `POST /v1/vision/zk-court/challenge` — full pipeline (preferred).
   - `POST /v1/vision/zk-court/verify-optimistic` — **dev placeholder** only (`verify_optimistic_execution`); **disabled on mainnet** (B.1).

### 2.3 Gaps

| Gap | Severity | Sprint 2 action |
|-----|----------|-----------------|
| SP1 prover not wired | Med | **Phase 1** — dual prover abstraction |
| In-memory `DISPUTES` / `ARTIFACTS` primary | Low | **Phase 1** — ledger-only or crash-safe WAL |
| Slash uses full bond, not `min(bond, λ·R_expected)` | Low | **Phase 1** or **WP amend** §14.3 vs §14.1 wording |
| `verify_optimistic_execution` was mainnet-unsafe | High | **Fixed B.1** — returns false + endpoint errors on mainnet |
| Challenge window time not enforced on submit | Med | **Fixed B.1** — open/close checks |
| On-chain `TxV1::VerifyZkProof` path separate from vision REST court | Info | Document only; both use `zk_verifier` |

---

## 3. §14.3 — Economic finality (\(S = \lambda R_{\text{expected}}\))

### 3.1 WP

\(S = \lambda \cdot R_{\text{expected}}\), with \(\lambda\) chosen so \(S > R_{\text{expected}}\).

### 3.2 Code

- `lambda_multiplier()` default **100** (`TET_SLASH_LAMBDA_MULTIPLIER`).
- `r_expected_micro` stored on artifact from settlement (`pool_half`).
- **Actual slash:** `slash_worker_bond_to_ecosystem_all` — burns **all** liquid worker bond, not `λ × R_expected`.

### 3.3 Resolution options

| Option | Owner |
|--------|--------|
| **A.** Implement capped slash `min(bond, λ × R_expected)` + burn remainder policy | Phase 1 |
| **B.** WP amend: §14.1 “100% slash” primary; §14.3 λ as parametric model for other offenses | Docs |
| **C.** Keep full slash; document λ as telemetry only | **Current** + this doc |

**Sprint 2:** Option C (no economics change in B.2 ledger scope).

---

## 4. Mock vs real proof boundary

| Path | Real crypto | Mock / placeholder | Mainnet |
|------|-------------|-------------------|---------|
| `TxV1::VerifyZkProof` → `zk_verifier::verify_tx_receipt_and_journal` | RISC0 `Receipt::verify` | `MOCKJ1:` / `MOCKZC1:` | Mock **rejected** |
| `run_challenge_pipeline` | RISC0 prove + journal decode | Dismissed if prove fails | No mock shortcut to guilty |
| `verify_optimistic_execution` | N/A | Empty/`INVALID` proof = fraud | **Endpoint disabled** |
| `worker_daemon` | `prove_zk_court_task_receipt` if ELF present | No mock fallback on inference failure | ELF empty → task fails |

**Guards:** `TET_MAINNET=1` forbids `TET_ALLOW_MOCK_ZK=1` (panic in `main.rs` and `zk_verifier`). Tests use `cfg!(test)` or explicit env.

---

## 5. `protocol.rs` / on-chain surface

- `TxV1::VerifyZkProof { task_id, image_id, journal_b64, receipt_b64 }` — documented mock prefix in enum comment; **no signature change** in Sprint 2.
- Consensus applies thermodynamic reward when `VerifiedZkJournal::ZkCourt` matches task (see `consensus.rs`).
- Gap: WP “watcher-initiated trace” is REST-first; mempool `VerifyZkProof` is prover-submission path — complementary, not duplicate.

---

## 6. Sprint 2 fixes applied (B.1)

1. **`zk_verifier::zk_dev_mock_allowed()`** — single exported predicate for dev/mock paths.
2. **`submit_challenge`** — enforce `challenge_opens_at_ms` / `challenge_closes_at_ms` (WP window).
3. **`verify_optimistic_execution` / `execute_optimistic_slash_if_fraud`** — mainnet returns error / does not slash via placeholder.
4. **`params_json()`** — `whitepaper_alignment` block for operators.

**Not changed (by design):** RISC0/SP1 proof math, `TxV1` layout, full persistence refactor.

---

## 7. Phase 1+ backlog

| Item | Priority |
|------|----------|
| SP1 verifier backend | High |
| Remove/displace global `DISPUTES`/`ARTIFACTS` Lazy maps | Med |
| Align slash magnitude with §14.3 or unify WP wording | Med |
| Automatic challenge scheduler / watcher incentives | Med |
| Bind optimistic main-chain acceptance to dispute state machine | Med |
| Proof size / DA policies for receipts on-chain | Low |

---

## 8. Related modules (out of B.1 scope)

- **§14.2 hardware fingerprinting** — `vision/caac.rs` (separate gap analysis).
- **§11.1 supply split** — `ledger.rs` (Phase 2B Task B.2).

---

## 9. Protocol Reserve slot (§11.1 not documented)

### 9.1 What the implementation has

Genesis binding and allocation include a **fourth slot** beyond the whitepaper §11.1 narrative (founder / mining pool / treasury):

| Slot | Address constant | Genesis mint (`apply_genesis_allocation`) |
|------|------------------|-------------------------------------------|
| Worker pool | `WALLET_WORKER_POOL` (`…0001`) | 50% (5B TET) |
| Ecosystem sentinel (legacy) | `WALLET_ECOSYSTEM` (`…0002`) | **0** post–Phase 2B (treasury moved to `TET_TREASURY_ADDRESS`) |
| Protocol reserve | `WALLET_PROTOCOL_RESERVE` (`…0003`) | **0** micro-TET (`GENESIS_PROTOCOL_RESERVE_SHARE_MICRO = 0`) |
| Treasury (Phase 2B) | `TET_TREASURY_ADDRESS` (env, 64 hex) | 25% (2.5B TET) |

`deterministic_genesis_hash` always serializes:

`…|reserve={WALLET_PROTOCOL_RESERVE}|reserve_micro=0|…`

**Repurposing this slot (non-zero mint, different address, or removing fields) changes the genesis hash** and is **chain-incompatible** with nodes that already committed the current payload.

### 9.2 History (Phase 2B vs earlier)

| Change | Sprint / commit era |
|--------|---------------------|
| `WALLET_PROTOCOL_RESERVE` + `reserve` / `reserve_micro` in genesis hash payload | **Pre–Phase 2B** (present at monorepo genesis import, `50ffb79`) |
| Phase 2B B.2: treasury via `TET_TREASURY_ADDRESS`, `treasury=` field in hash (replaces `ecosystem=` + `WALLET_ECOSYSTEM` mint) | **Phase 2B** (`68a4b94`) |

**Phase 2B did not introduce the Reserve slot**; it only retargeted the 25% tranche from the ecosystem sentinel to the configurable treasury wallet. The zeroed reserve slot remained in the hash formula for backward compatibility with the four-field layout.

### 9.3 Phase 1 / Whitepaper v1.1 work

- Define **purpose** of Protocol Reserve (governance grants, bug bounty, buyback, emergency ops, etc.).
- Decide whether **Phase 0** ships with **0 micro** (current) or a pre-allocated tranche.
- Document the four-way split explicitly in **§11.1** alongside founder / worker pool / treasury.
- If reserve is never funded, consider WP “Future Work” vs removing the field (would require a **new genesis** / new `tet-genesis-v2` binding — not a silent upgrade).

---

## 10. UI / REST API — Phase 1 improvements (Sprint 3 Phase A discovery)

Discovered while shipping **UI-P0-3** (`POST /wallet/transfer` hybrid flow in `tet-network/ui`). Phase 0 uses the current contract; items below are **Phase 1 / Phase 0.5** backlog (no tet-core change in Sprint 3 Phase A UI work).

### 10.1 Stevemon unit naming

| | |
|-|-|
| **Current** | `wallet.rs` / ledger use **Stevemon** as the 10⁻⁶ TET subunit name (`STEVEMON = 1_000_000` per TET). Docs and UI mix “Stevemon”, “micro-TET”, and `*_micro` field names. |
| **Issue** | Terminology predates Phase 2B economics alignment; operators and WP readers see inconsistent labels. |
| **Phase 1** | Pick canonical naming (**micro-TET** vs **Stevemon**), align REST field docs and **Whitepaper §11** denomination table. |

### 10.2 `/wallet/transfer` response — no `tx_hash`

| | |
|-|-|
| **Current** | `POST /wallet/transfer` returns `{ from_wallet_id, to_wallet_id, amount_micro, net_micro, fee_micro }` only (`rest/handlers/wallet.rs`). |
| **Issue** | UI cannot deep-link to block explorer or show “confirmed in block N” after Send Coins. |
| **Phase 1** | Add **`tx_hash`** and/or **`block_height` + `tx_index`** (or audit `seq`) to the JSON response. |

### 10.3 Fee calculation lineage

| | |
|-|-|
| **Current** | `fee_micro` returned on transfer; on-chain fee is **1%** gross via `PROTOCOL_MAINTENANCE_FEE_BPS` (50% worker pool / 50% burn split in ledger). |
| **Issue** | Relation to whitepaper **§11** founder / protocol fee schedule is not spelled out for wallet HTTP clients. |
| **Phase 1 / WP v1.1** | Document fee derivation in **§11** and operator docs (`RUNNING_A_NODE.md`). |

### 10.4 `amount_tet` as `f64` on REST

| | |
|-|-|
| **Current** | `WalletTransferSignedReq.amount_tet` is **`f64`**; hybrid signing uses **`amount_micro`** (`u64`) in the message bytes. |
| **Issue** | Sufficient for Phase 0 demos (≥ 0.001 TET); **double-precision loss** risk for very large transfers (> ~10¹⁵ micro if ever allowed). |
| **Phase 1** | Prefer **string decimal** or **`amount_micro` u64** in REST; keep `amount_tet` as display-only alias if needed. |

### 10.5 Endpoint clarity (documented, not a code gap)

| Path | Role |
|------|------|
| **`POST /wallet/transfer`** | Hybrid Ed25519 + ML-DSA; **immediate** ledger debit/credit (`transfer_with_fee_attested_dual_verified`). **UI-P0-3 uses this.** |
| **`POST /ledger/transfer`** | `SignedTxEnvelopeV1` → mempool (`202 Accepted`); different auth and lifecycle. |

---

*Last updated: Sprint 3 Phase A (UI-P0-1 / P0-2 / P0-3) + Sprint 2 Phase 2B Task B.1.*
