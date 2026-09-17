# Fee Specification

**Status:** Normative. Supersedes the seven ad-hoc schedules inventoried in [`FEE_AUDIT.md`](./FEE_AUDIT.md).
**Date:** 2026-09-17
**Implementation:** `tet-core/src/fees.rs` — the single source of truth. No fee arithmetic may live anywhere else.

> ## ⚠ This is a consensus hard fork
>
> Fee splits and burn semantics both feed `compute_state_root`. A node running this spec and a node
> running the previous code will diverge on the first fee-bearing block. **The chain must be reset and
> every node upgraded together.** This is acceptable only because Phase 0 is a disposable testnet under
> [Strategy C](./SPRINT_PLAN.md) — the current chain can never become mainnet regardless, because of the
> founder cliff burned into its genesis. Do not apply this to a chain you intend to keep.

---

## 1. Model

Every fee-bearing operation resolves to exactly one `FeeSplit` of four parts:

| Part | Meaning | Destination |
|---|---|---|
| `net_micro` | What the counterparty receives | Recipient wallet, or the storage node for file fees |
| `pool_micro` | Worker pool share | `WALLET_WORKER_POOL` (`000…0001`) |
| `treasury_micro` | Protocol treasury share | **`TET_TREASURY_ADDRESS` only** |
| `burn_micro` | Destroyed | **Decrements `META_TOTAL_SUPPLY`** |

### 1.1 Conservation invariant

```
net_micro + pool_micro + treasury_micro + burn_micro == amount_micro
```

Exact, for every kind, at every amount, on every node. Enforced by construction and by
`fees::tests::conservation_holds_for_all_kinds_and_amounts` (proptest).

### 1.2 Rounding rule

Adopted from the old schedule 7, which was the only one that documented it:

> Each share except the last is computed by integer division in `u128`, then downcast.
> **`burn_micro` takes the remainder:** `burn = amount − net − pool − treasury`.

Burn absorbs all rounding loss. This makes every split deterministic across nodes regardless of
architecture or optimisation level, with no float and no rounding mode to disagree about.

### 1.3 Burn means burn

Previously "burn" meant two different things: schedules 5 and 6 decremented `META_TOTAL_SUPPLY`,
while schedules 1, 2 and 7 merely credited a balance key (`tet-api-pool`) that accumulated forever.
The second is not a burn — supply was never reduced and the tokens remained spendable by anyone
holding that key.

**Under this spec, `burn_micro` always decrements `META_TOTAL_SUPPLY` and is credited to no wallet.**
`TET_AI_BURN_WALLET` and `WALLET_AI_BURN_DEFAULT` are removed.

### 1.4 Treasury means one address

Previously three destinations were called "treasury": `dex:treasury` (schedule 5),
`TET_TREASURY_ADDRESS` (schedule 7), and the founder wallet (schedule 3).

**Under this spec there is one:** `TET_TREASURY_ADDRESS`, already required at startup with no
fallback (`ledger.rs::treasury_address_from_env`). `WALLET_DEX_TREASURY` is removed from all fee
paths. No fee may be routed to the founder wallet.

---

## 2. Fee kinds

`fees::charge(kind, amount_micro) -> Result<FeeSplit, FeeError>`

### 2.1 `FeeKind::Transfer { fee_bps }`

| | |
|---|---|
| Rate | `fee_bps`, **carried in the signed `TxV1::Transfer` envelope** |
| **Valid range** | **`100 ≤ fee_bps ≤ 1000`** (1% – 10%) |
| Out of range | `FeeError::FeeBpsOutOfRange` → block apply rejects the tx |
| Split | `fee = amount × fee_bps / 10000`; `pool = fee / 2`; `burn = fee − pool`; `treasury = 0`; `net = amount − fee` |

The rate stays sender-declared and signed — it is part of what the sender authorises — but it is now
**bounded and validated at apply time on every node**. Previously any value `0..=10000` applied
unchecked, so a sender could pay nothing or destroy the entire amount.

The bounds are consensus rules. Changing them is a fork.

### 2.2 `FeeKind::AiUtility`

| | |
|---|---|
| Rate | 20% network fee (`NETWORK_FEE_BPS = 2000`) |
| Split | `net` 80% worker · `treasury` 15% · `burn` 5% · `pool` 0 |
| Burn fraction | 25% of the network fee (`BURN_FRACTION_OF_NETWORK_FEE_BPS = 2500`) |

Unchanged in value. Changed in destination: the 15% now goes to `TET_TREASURY_ADDRESS`, not
`dex:treasury`.

### 2.3 `FeeKind::AiInference`

| | |
|---|---|
| Charge | Thermodynamic `R_micro` from `vision/thermo_genesis.rs` |
| Split | **`pool` 50% · `burn` 50%** · `net` 0 · `treasury` 0 |

**The Genesis Epoch ×5 multiplier is removed.** It saturated:
`base_pool = cost/2`, then `× GENESIS_REWARD_MULTIPLIER (5)` clamped to `cost`, giving
`pool = cost, burn = 0` for all 1 300 000 Genesis Epoch blocks — so the 50/50 documented in
whitepaper §5.6 and in `thermo_genesis.rs`'s own note string never actually ran.

The split is now a true 50/50 at every height. `GENESIS_EPOCH_BLOCK_LIMIT` and
`GENESIS_REWARD_MULTIPLIER` no longer affect settlement.

> Removing the multiplier removes a 5× worker-reward subsidy that was live. That is an economic
> change, not just a correctness fix. It is the right default — the subsidy was undocumented,
> unintended, and made the burn a no-op — but if a Genesis Epoch subsidy is wanted, it must be
> reintroduced deliberately as a *pool top-up funded from the pool*, not as a split that silently
> zeroes the burn.

### 2.4 `FeeKind::File`

| | |
|---|---|
| Charge | `FILE_FEE_MICRO = 1000` µTET flat |
| Split | `net` 50% storage node · `treasury` 25% · `burn` 25% (remainder) · `pool` 0 |

Unchanged. This schedule was already correct; it becomes the template.

---

## 3. Deleted

| Deleted | Was | Why |
|---|---|---|
| **Schedule 1** — forced 1% on `transfer_with_fee_attested` | `PROTOCOL_MAINTENANCE_FEE_BPS` applied after `let _ = fee_bps;` | Duplicate of §2.1 at a different, non-consensus rate. Wallet transfers already route through `TxV1::Transfer`; the only remaining callers were **internal plumbing** |
| **Schedule 3** — mint fee to founder | `fee_bps_mint`, env `TET_PROTOCOL_FEE_BPS`, 0–100%, 100% to founder wallet | v0 "economic constitution" artifact. No fee may route to the founder |
| **Schedule 4** — Imperial Tax | `imperial_bps = 100u64` hardcoded, 99/1 worker/vault | v0 CHF-era. Already marked non-canonical in `STATUS.md` since May |
| **`/founder/audit.csv`** | CSV export of the audit log | Existed to report schedules 3 and 4. Its `imperial_tax_micro` column leaked deprecated terminology to anyone who called it |
| **`WALLET_AI_BURN_DEFAULT` / `TET_AI_BURN_WALLET`** | Burn "sink" balance key | §1.3 — not a burn |
| **`WALLET_DEX_TREASURY` in fee paths** | 15% AI-utility treasury share | §1.4 |

### 3.1 Internal transfers are fee-free

Deleting schedule 1 leaves callers that move value *within* the protocol rather than between users:

| Caller | Now |
|---|---|
| `p2p_dex.rs` — 6 escrow hops | `transfer_internal_no_fee` |
| `/ledger/genesis_bridge` | `transfer_internal_no_fee` |
| `/ai/proxy` payment | `FeeKind::Transfer` at the default rate |

This fixes a live bug. All six DEX hops passed `fee_bps: None`, and schedule 1 charged 1% anyway —
so a maker→escrow→trade-escrow→taker round trip silently lost ~3% of escrowed funds. Escrow
plumbing is not a taxable event.

---

## 4. Constants

All fee constants live in `fees.rs`. Nothing else may define one.

| Constant | Value |
|---|---|
| `TRANSFER_FEE_BPS_MIN` | `100` (1%) |
| `TRANSFER_FEE_BPS_MAX` | `1000` (10%) |
| `TRANSFER_FEE_BPS_DEFAULT` | `100` (1%) |
| `NETWORK_FEE_BPS` | `2000` (20%) |
| `BURN_FRACTION_OF_NETWORK_FEE_BPS` | `2500` (25% of fee) |
| `FILE_FEE_MICRO` | `1000` µTET |
| `FILE_SPLIT_TREASURY_BPS` / `_STORAGE_BPS` / `_BURN_BPS` | `2500` / `5000` / `2500` |
| `AI_INFERENCE_POOL_BPS` | `5000` (50%) |

---

## 5. Test obligations

| Test | Asserts |
|---|---|
| `conservation_holds_for_all_kinds_and_amounts` | §1.1 invariant, proptest over all kinds × amounts |
| `burn_takes_the_rounding_remainder` | §1.2 — odd amounts never lose or create a µTET |
| `transfer_fee_bps_bounds_are_enforced` | §2.1 — 99 and 1001 rejected, 100 and 1000 accepted |
| `transfer_fee_bps_zero_and_max_rejected` | §2.1 — the old unchecked `0` and `10000` now fail |
| `ai_inference_is_fifty_fifty_across_genesis_epoch` | §2.3 — 50/50 holds at heights 0, 1, mid-epoch, `GENESIS_EPOCH_BLOCK_LIMIT ± 1` |
| `burn_decrements_total_supply` | §1.3 — supply strictly decreases by exactly `burn_micro` |
| `no_fee_routes_to_founder_or_dex_treasury` | §1.4, §3 |

---

## 6. References

| Document | Relation |
|---|---|
| [`FEE_AUDIT.md`](./FEE_AUDIT.md) | The pre-unification inventory this spec replaces |
| [`WHITEPAPER.md`](../WHITEPAPER.md) §5.6, §11.5–11.7, §17.7 | §17.7 reconciliation is closed by this spec for schedules 2, 5, 6, 7 |
| [`SPRINT_PLAN.md`](./SPRINT_PLAN.md) | Strategy C — why a hard fork is affordable now |
