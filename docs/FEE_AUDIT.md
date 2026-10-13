# Fee Schedule Audit

> ## ⚠ Superseded — historical record
>
> The state described below no longer exists in code. All seven schedules were unified into
> `tet-core/src/fees.rs` on 2026-09-17 under [`FEE_SPEC.md`](./FEE_SPEC.md), which is now normative.
> This document is kept because it is the evidence trail for *why* the unification was shaped the
> way it was, and because the commit messages reference its numbering.
>
> ### Corrections found during implementation
>
> Three claims below were wrong or incomplete. They are left in place rather than edited, so the
> record stays honest:
>
> 1. **Schedule 1 "Entered by" is wrong.** It lists `POST /wallet/transfer → rest/handlers/ledger.rs:761`.
>    Line 761 is the **GenesisBridge** handler. `POST /wallet/transfer` had *already* been routed
>    through `TxV1::Transfer` → mempool → consensus by commit `8f52db7` in May, so it used
>    **schedule 2**, not schedule 1. Schedule 1's real callers were the genesis bridge, `/ai/proxy`,
>    and six `p2p_dex` escrow hops.
> 2. **The burn bug was worse than recorded.** §Observations item 4 says schedules 1, 2 and 7 "credit
>    a balance key" rather than burning. In fact the transfer and file-fee *apply* paths did **both** —
>    credited `tet-api-pool` **and** decremented `META_TOTAL_SUPPLY` — so supply fell while the same
>    value stayed spendable at that key. Value was duplicated, not merely mis-accounted.
> 3. **Finding 7 is resolved.** `settle_ai_utility_payment` appeared twice because
>    `ledger/settlement.rs` **was never compiled** — `ledger.rs` has no `mod settlement;`. The file
>    was 188 lines of dead code and has been deleted.
>
> One live bug surfaced that this audit did not catch: all six `p2p_dex` escrow hops passed
> `fee_bps: None` while schedule 1 forced 1% regardless, so a maker who locked an order and
> cancelled it silently lost ~2% of the escrowed amount.

**Date:** 2026-09-17
**Scope:** Inventory only. **Nothing is unified or changed by this document.**
**Method:** Code read at commit `56c91dd`. Every rate and split below is quoted from source, not from a spec.
**Why:** `WHITEPAPER.md` §11.7 says "50% of all transaction fees burned" and §17.7 records the reconciliation as an open problem. Before that can be closed, the actual surface has to be written down.

**Headline:** the archaeology pass (`archive/TET_STATE_2026-09.md` §2.5) counted six schedules. There are **seven**. The seventh is the v0-era **Imperial Tax**, still hardcoded and still live on the worker-reward path.

---

## Summary

| # | Schedule | Rate | Split | Fee destination |
|---|---|---|---|---|
| 1 | Wallet transfer | **1%** fixed | 50 / 50 | worker pool / burn sink |
| 2 | Consensus transfer | **caller-supplied** | 50 / 50 | worker pool / burn sink |
| 3 | Mint (proof-of-energy) | **1%** default, env-tunable **0–100%** | 100% | **founder wallet** |
| 4 | Imperial Tax (worker reward) | **1%** hardcoded | 99 / 1 | worker (90-day vest) / imperial vault |
| 5 | AI utility settlement | **20%** | 80 / 15 / 5 | worker / `dex:treasury` / burn |
| 6 | AI inference (dynamic) | thermodynamic `R_micro` | 50 / 50 (pool **×5** in Genesis Epoch) | worker pool / burn sink |
| 7 | File fee | **1000 µTET** flat | 25 / 50 / 25 | treasury / storage node / burn |
| — | Tmail / Pin / Anonymous | *specified* 1 / 1 000 / 1 000 000 µTET | *specified* 50 / 50 | **not implemented** |

---

## 1. Wallet transfer

| | |
|---|---|
| **Code** | `tet-core/src/ledger.rs:6648` `transfer_with_fee_attested` |
| **Constant** | `PROTOCOL_MAINTENANCE_FEE_BPS = 100` — `ledger.rs:133` |
| **Rate** | **1%** of gross |
| **Split** | `fee_pool_half = fee/2` → `WALLET_SYSTEM_WORKER_POOL` (`000…0001`); `fee_burn_half = fee - fee_pool_half` → `ai_burn_wallet()` |
| **Burn destination** | `TET_AI_BURN_WALLET`, default `"tet-api-pool"` (`ledger.rs:2730`, `WALLET_AI_BURN_DEFAULT` `ledger.rs:125`) |
| **Entered by** | `POST /wallet/transfer` → `rest/handlers/ledger.rs:761`; `POST /ai/proxy` → `ai_proxy.rs:348` |
| **Tx types** | None — this path **bypasses `TxV1` entirely** and writes balances directly |

```rust
// ledger.rs:6666-6672
let _ = fee_bps;                              // <-- caller's fee_bps DISCARDED
let bps = PROTOCOL_MAINTENANCE_FEE_BPS;       // strict: 1% on all transfers
let fee_micro  = amount_micro.saturating_mul(bps) / 10_000;
let net_micro  = amount_micro.saturating_sub(fee_micro);
let fee_pool_half = fee_micro / 2;
let fee_burn_half = fee_micro.saturating_sub(fee_pool_half);
```

**Note.** Wrapper `transfer_with_fee` (`:6469`) and `transfer_with_fee_attested_dual_verified` (`:6610`) both funnel here, so their `fee_bps` argument is equally inert. `transfer_no_fee` (`:6487`) is a separate zero-fee path.

**Caution.** The burn "sink" is an ordinary balance key that accumulates — `total_supply` is **not** decremented on this path, unlike schedules 5 and 6. Whether that counts as a burn is a policy question, not a code question.

---

## 2. Consensus transfer

| | |
|---|---|
| **Code** | `tet-core/src/ledger.rs:2174` `apply_remote_transfer` |
| **Rate** | **`fee_bps` taken verbatim from the signed envelope** |
| **Split** | Identical 50 / 50 to schedule 1 |
| **Entered by** | `TxV1::Transfer` via mempool → block apply → `ledger.rs:2153` |
| **Tx types** | **`TxV1::Transfer`** |

```rust
// ledger.rs:2194-2198
let bps = fee_bps;                            // <-- from the envelope, NOT the constant
let fee_micro = amount_micro.saturating_mul(bps) / 10_000;
```

### The discrepancy

`TxV1::Transfer` carries `fee_bps: u64` as a **signed field** (`protocol.rs:43-48`). Schedule 1 ignores it and forces 1%. Schedule 2 honours it. Both settle the same user-facing operation — "send TET" — and the UI takes the schedule-2 path (`8f52db7` moved Send Coins onto consensus).

Consequences, stated without recommending a fix:

- A sender can sign `fee_bps: 0` and pay nothing; the block applies it.
- A sender can sign `fee_bps: 10_000` and burn/pool the entire amount.
- There is no validation of `fee_bps` anywhere in the apply path.
- The 1% in `WHITEPAPER.md` §11.6 describes schedule 1, which the product no longer uses for Send Coins.

Unifying this is a **consensus change** — every node must agree on the rate, so it belongs with the Phase 1 genesis, alongside the `TxV1::Transfer` nonce already deferred for the same reason.

---

## 3. Mint (proof-of-energy)

| | |
|---|---|
| **Code** | `tet-core/src/ledger.rs:5473` `fee_bps_mint`, applied at `:5481` `mint_reward_with_proof` |
| **Rate** | `TET_PROTOCOL_FEE_BPS`, **default 100 bps (1%)**, clamped only at the top: `.min(10_000)` — i.e. **0–100% is settable by env** |
| **Split** | 100% of fee → **founder wallet** (`self.founder_wallet()?`) |
| **Entered by** | `POST /ledger/proof` → `rest/handlers/ledger.rs:586`; `POST /ledger/mint_demo`; genesis-1k claim `ledger.rs:5045`; node bootstrap `main.rs:419` |
| **Tx types** | None — direct ledger mutation |

This is the last surviving piece of the `archive/cursor_nexus_project_2026-04.md` (2026-04-15) economic constitution: *"Mint: 1% (bps=100) is charged and credited to the founder wallet."* That document was superseded by the 25/50/25 genesis model, but this code path was not updated.

---

## 4. Imperial Tax — worker network reward

| | |
|---|---|
| **Code** | `tet-core/src/ledger.rs:5696` `mint_worker_network_reward`; rate at **`:5723`** |
| **Rate** | **`let imperial_bps = 100u64;`** — 1%, **hardcoded local, not a named constant** |
| **Split** | 99% `worker_net` → worker wallet, **90-day vest**; 1% `imperial_tax` → `imperial_vault_wallet` (caller-supplied), **unlocked** |
| **Entered by** | `ai_proxy.rs:429`; `rest/handlers/network.rs:292` |
| **Tx types** | None — direct ledger mutation |
| **Audit key** | Emits `"imperial_tax_micro"` into the audit log (`:5883`) |

```rust
// ledger.rs:5695 (doc comment)
/// Split: 99% `worker_net` (90-day vest to worker) / 1% imperial tax (unlocked to vault).
```

**"Imperial Tax" is v0 CHF-era terminology.** `archive/STATUS_2026-09.md` §B lists it as *"deprecated WP … 用語は非正本"* (term not canonical) and guessed that *"similar logic may survive in the worker mint path."* Confirmed: it survives under its original name, in the audit output, on a live path. Any external reader running `/founder/audit.csv` will see `imperial_tax_micro` in the JSON.

---

## 5. AI utility settlement

| | |
|---|---|
| **Code** | `tet-core/src/ledger/settlement.rs:13` `settle_ai_utility_payment` (duplicated body also at `ledger.rs:5903`) |
| **Constants** | `NETWORK_FEE_BPS = 2_000` (20%) `ledger.rs:139`; `BURN_FRACTION_OF_NETWORK_FEE_BPS = 2_500` (25% of the fee) `ledger.rs:141` |
| **Rate** | **20%** network fee on gross |
| **Split** | **80%** → worker · **15%** → `dex:treasury` (`WALLET_DEX_TREASURY`, `ledger.rs:122`) · **5%** → burn |
| **Supply** | **Decrements `META_TOTAL_SUPPLY`** by the burn amount — a real burn |
| **Entered by** | `POST /enterprise/inference` → `rest/handlers/enterprise.rs:217` |
| **Tx types** | **`TxV1::EnterpriseInference`**, settled on **`TxV1::VerifyZkProof`** |

Treasury share goes to `dex:treasury` — a **v0 DEX-era wallet id**, not the `TET_TREASURY_ADDRESS` 64-hex treasury established in Phase 2B (`68a4b94`). Two different "treasuries" are in play across schedules 5 and 7.

---

## 6. AI inference — dynamic charge

| | |
|---|---|
| **Code** | `tet-core/src/ledger.rs:6083` `settle_ai_inference_dynamic_charge` |
| **Rate** | Charge = `R_micro` from `vision/thermo_genesis.rs` — `(C_flops / E_joules_per_flop) × Γ × scale`, where `C_flops` is **declared by the caller** and `E`, `Γ`, `scale` are env constants |
| **Split** | `base_pool = cost/2`; **if `inference_block_height() < GENESIS_EPOCH_BLOCK_LIMIT` (1 300 000), pool share = `base_pool × GENESIS_REWARD_MULTIPLIER (5)`, capped at `cost_micro`**; burn takes the remainder |
| **Effective split today** | Height is far below 1 300 000, so `pool = min(cost/2 × 5, cost) = cost` → **100% pool, 0% burn** |
| **Supply** | Decrements `META_TOTAL_SUPPLY` by the burn amount — which is currently **zero** |
| **Entered by** | `POST /ai/infer` single-node local fallback → `rest/handlers/ai.rs:744` |
| **Tx types** | None — direct ledger mutation |

```rust
// ledger.rs:6096-6105
let height_at = self.inference_block_height();
let base_pool = cost_micro / 2;
let pool_half = if height_at < GENESIS_EPOCH_BLOCK_LIMIT {
    base_pool.saturating_mul(GENESIS_REWARD_MULTIPLIER).min(cost_micro)
} else { base_pool };
let burn_half = cost_micro.saturating_sub(pool_half);
```

**Flagged for the unification pass:** the ×5 multiplier saturates. `cost/2 × 5 = 2.5 × cost`, clamped to `cost`, so the documented "50/50 worker/burn" (WP §5.6, `thermo_genesis.rs:105` note string `"50/50 worker pool / protocol burn on settlement"`) is **not what runs** for the entire 1.3 M-block Genesis Epoch. The code comment at `ledger.rs:22` anticipates this — *"burn remainder absorbs reduced burn share"* — but the remainder is zero, not reduced.

---

## 7. File fee

| | |
|---|---|
| **Code** | `tet-core/src/files/mod.rs:51` `file_fee_split`; constants `:34-38` |
| **Rate** | **`FILE_FEE_MICRO = 1000`** µTET flat per file |
| **Split** | `FEE_SPLIT_TREASURY_BPS = 2_500` (25%) · `FEE_SPLIT_STORAGE_BPS = 5_000` (50%) · `FEE_SPLIT_BURN_BPS = 2_500` (25%) |
| **Rounding** | Burn takes the integer-division remainder, so the three parts sum to exactly `fee_micro` on every node — deterministic across the network |
| **Entered by** | `POST /files/fee` → mempool → block apply (`ledger.rs:1787`, `:1455`, `:708`) |
| **Tx types** | **`TxV1::FileFee`** |
| **Treasury** | `TET_TREASURY_ADDRESS` — the Phase 2B 64-hex treasury, **not** `dex:treasury` |

The only schedule with a deterministic consensus-safe rounding rule and a full preview / apply / undo implementation. If one schedule is the template for unification, it is this one.

---

## Specified but not implemented

`SOVEREIGN_OS_PHASE0_SPEC.md` Appendix C and `WHITEPAPER.md` §11.5 define a schedule that does not exist in code:

| Action | Spec charge | Spec split |
|---|---|---|
| Tmail send | 1 µTET (1 Stevemon) | 50% treasury / 50% burn |
| Tmail Pin | 1 000 µTET | 50% treasury / 50% burn |
| Anonymous escrow | 1 000 000 µTET (1 TET) | 50% treasury / 50% burn |
| File pin per GB/day | 1 000 000 µTET | — |

Deliberately deferred in `4d3fc72`: *"no ledger audit/fee for Tmail this commit (reintroducing off-chain mutation pattern would defeat Fix 1/3)."* The reasoning was sound — adding a fee meant either an off-chain mutation (which forks state) or a new `TxV1` variant (which is consensus work). Neither was in scope that day.

---

## Adjacent: paths that move value with no fee

Listed for completeness so the next pass does not mistake them for gaps.

| Path | Code | Behaviour |
|---|---|---|
| `TxV1::InitialAirdrop` | `ledger.rs:1570`, `:5095` | 1 000 TET pool → wallet, no fee, capped at 10 000 recipients |
| `TxV1::WorkerRegister` | `ledger.rs:730`, `:1471` | No fee; requires an existing ≥1 000 TET bond |
| `TxV1::GenesisBridge` | `ledger.rs:1654+` | Founder → wallet, no fee |
| `transfer_no_fee` | `ledger.rs:6487` | Explicit zero-fee transfer |
| Admin faucet | `admin_rest_faucet` | Pool → wallet, no fee, admin token required |
| CHF fiat top-up | `ledger.rs:6339` `mint_fiat_chf_topup` | **v0 CHF-era.** Mints at a 1:1 CHF peg, no fee. Reachable code; tracks `META_CHF_DEPOSITS_MICRO` and `META_AML_CHF_PREFIX` |
| Slashing | `SLASHING_PENALTY_BPS = 500` `ledger.rs:143` | 5% — a **penalty**, not a fee. Note `slash_worker_bond_to_ecosystem_all` burns the **full** bond and ignores this constant (WP §17.7) |

---

## Observations for the unification pass

No changes are proposed here; these are the decisions a unification would have to make.

1. **Schedules 1 and 2 settle the same operation at different rates.** Consensus change → Phase 1 genesis, batched with the `TxV1::Transfer` nonce.
2. **`fee_bps` is unvalidated in the consensus path.** Any signed value 0–10 000 applies.
3. **Three destinations are called "treasury":** `dex:treasury` (schedule 5), `TET_TREASURY_ADDRESS` (schedule 7), founder wallet (schedule 3).
4. **Two burn semantics:** schedules 5 and 6 decrement `total_supply`; schedules 1, 2 and 7 credit a balance key. Only the first is a burn in the supply sense.
5. **Schedule 6's Genesis Epoch multiplier saturates to 100% pool / 0% burn** for 1.3 M blocks — the documented split never runs.
6. **Schedules 3 and 4 are v0 artifacts** (`fee_bps_mint` → founder; `imperial_bps` → imperial vault) predating the 25/50/25 genesis model, still live, still in audit output.
7. **`settle_ai_utility_payment` exists twice** — `ledger/settlement.rs:13` and `ledger.rs:5903` — bodies appear identical. Confirm which is dead before touching either.
8. **Only schedule 7 has consensus-safe rounding.** The others use plain integer division; schedules 1, 2 and 6 compute `x/2` and give the remainder to burn, which is deterministic, but none documents the invariant the way `file_fee_split` does.

---

## References

| Document | Relevance |
|---|---|
| [`archive/TET_STATE_2026-09.md`](../archive/TET_STATE_2026-09.md) (archived) §2.5 | Where the six-schedule count came from |
| [`WHITEPAPER_v1.1.md`](../archive/WHITEPAPER_v1.1.md) (archived) §11.5–11.7, §17.7 | Documented fee model and the open reconciliation |
| [`WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md) Gap 6 | 80/15/5 vs §11 tokenomics |
| [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) Appendix C | Tmail/Pin/Anonymous spec |
| [`archive/STATUS_2026-09.md`](../archive/STATUS_2026-09.md) (archived) §B | Records Imperial Tax as deprecated terminology |
