# Phase 1 Genesis — consensus changes that must land at the ceremony

**Status:** Open. Created 2026-09-19.
**Why this document exists:** Phase 1 cuts a **new genesis** ([`SPRINT_PLAN.md`](./SPRINT_PLAN.md),
Strategy C). Changes that are impossible on a live chain are free at a genesis ceremony, and there
is exactly one window to make them. Anything on this list that is missed stays broken until the
*next* genesis — which, for mainnet, means never.

---

## 1. Consensus change: apply must use `block.timestamp`, not `ledger_now_ms()`

**This is the single most important Phase 1 consensus fix.**

### The defect

`apply_consensus_block_batch` (`ledger.rs:1678`) and `compute_state_root_after_remote_block`
(`ledger.rs:1432`) both call:

```rust
let locked_sum = self.locked_balance_micro(&from, ledger_now_ms())?;
```

`ledger_now_ms()` reads `SystemTime::now()` — the **node's own wall clock**. `locked_balance_micro`
(`ledger.rs:4730-4755`) is explicitly time-gated:

```rust
if row.wallet == peer && row.unlock_at_ms > now_ms { sum += row.amount_micro }   // vest locks
if unlock_at > 0 && now_ms < unlock_at { sum += locked }                          // founder cliff
```

Its result feeds the spendability check that decides whether a transfer applies or returns
`InsufficientFunds`.

**Wall-clock time is therefore a consensus input.** Two nodes applying the *same block* against
*byte-identical state* reach different outcomes whenever a lock-expiry boundary falls between the
moments they each process it. Nothing about the block changes — same `block_id`, same `tx_hashes` —
only the root diverges, and nothing is logged.

### Why this is the 9828 candidate

On 2026-05-30 the VPS mined block 9828 at ~02:30 UTC. The Mac replayed it during a genesis re-sync
roughly **17 hours later**. Any lock boundary inside that window evaluates differently on the two
nodes. It is inherently non-reproducible, which is exactly what
[`BUG_block_9828_divergence_mystery.md`](./BUG_block_9828_divergence_mystery.md) reports: it did not
recur after a chain reset, meaning the mechanism is still in the code.

### The fix

1. Add a `timestamp_ms` field to the block record, set by the producer and covered by `block_id`
   (it already hashes `height ‖ parent ‖ state_root ‖ tx_hashes ‖ producer_id` — extend it).
2. Thread it through `apply_consensus_block_batch` and
   `compute_state_root_after_remote_block` as an explicit parameter.
3. Replace every `ledger_now_ms()` call on an apply/preview path with that parameter.
4. Validate it at apply time: monotonic vs the parent, and within a bounded drift of the receiving
   node's clock — otherwise a producer can mint or freeze funds by lying about time.

**Consensus-breaking on two counts** — the block schema changes and apply outcomes change. It
cannot be shipped to a running chain. It is free at a genesis ceremony.

### Test that inverts here

[`tet-core/src/tests.rs`](../tet-core/src/tests.rs) →
`wallclock_time_changes_spendability_for_the_same_block`

It currently asserts the **broken** behaviour: the same wallet, the same stored state, two injected
timestamps, and a spendability gate that flips — rejected during the vest, accepted after. It is
green today and carries `TODO(9828)`.

**When this fix lands, invert it:** the two evaluations must become identical, so `assert_ne!`
becomes `assert_eq!`. If the test still passes unchanged after the fix, the fix did not work.

---

## 2. Also batch into this genesis

These are all consensus- or schema-breaking and are cheap only at a ceremony.

| Item | Source | Why it must wait for genesis |
|------|--------|------------------------------|
| **`/ai/infer` settlement → consensus** | `ai.rs:744`, this doc §2.1 | Needs a new `TxV1` variant **and** a client-signed settlement envelope; see §2.1 |
| **Founder vesting: cliff + linear** | WP §17.3, `DAILY_LOG_2026-05-29` | The live chain has a one-shot 365-day 100% cliff on 2.5B TET burned into genesis, with no early-unlock path. This is the reason Strategy C exists |
| **`TxV1::Transfer` nonce** | `DAILY_LOG_2026-05-31` | Identical transfers currently collide on tx hash, so only the first applies. Adding a nonce changes the tx schema |
| **FIPS-203 ML-KEM migration** | WP §17.17 | Tmail/Files KEM keys are mnemonic-derived; changing the algorithm invalidates every messaging identity. Free when the key directory is discarded anyway |
| **Minimum ML-DSA level** | WP §7.1 | Verification infers the level from pubkey length and accepts 44/65/87, so the effective security level is the signer's choice. Pinning a floor is a consensus rule |
| **Protocol reserve allocation** | WP §11.4 | `WALLET_PROTOCOL_RESERVE` mints 0 and is committed in the genesis hash. Changing it needs a new ceremony |
| **Denomination naming** | `WHITEPAPER_v1.0_GAPS.md` §10.1 | "Stevemon" vs "micro-TET" is cosmetic in code but appears in the genesis hash payload |
| **Per-block `state_root` checkpoints** | `BUG_block_9828_divergence_mystery.md` | Validation is tip-only today, so divergence surfaces at an arbitrary later block rather than the one that caused it. Changes what nodes exchange |

### 2.1 `/ai/infer` settlement must become a consensus tx

`rest/handlers/ai.rs:744` calls `settle_ai_inference_dynamic_charge` — a **direct balance write**.
Whichever node serves the request forks its `state_root` while block history stays identical: the
block 9828 signature. `3bd2009` removed the welcome-airdrop mutation from this handler in June but
left the settlement.

**Why it cannot be fixed server-side alone.**

The amount is tractable — `charge_micro` is `AI_INFER_LOCAL_CHARGE_MICRO` (`ai.rs:14`), a
compile-time constant, so consensus could validate it. The request is already hybrid-signed over
`(wallet, prompt, flops, nonce)` with the nonce consumed in sled, so it is replay-proof.

The blocker is ordering. Settlement runs **after** inference and **before** the `200 OK`
(`ai.rs:742` → response at `:841`), and the `402 PAYMENT_REQUIRED` branch (`ai.rs:747`) rejects
*post-compute*. Routing settlement through the mempool means:

- the caller receives the inference result before payment confirms, and
- a tx that never mines leaves the node having done the work for free.

That is precisely the **optimistic execution** model the whitepaper describes (§5.1, §8 ZK-Court) —
deliver first, settle or dispute after. The model is specified but not built: ZK-Court has no
challenger incentive, so the dispute path is never exercised.

**Shape of the fix.**

1. New `TxV1::AiInferenceCharge { wallet_id, charge_micro, nonce }` — schema change, genesis-only.
2. The **client** signs and submits it; the node cannot sign on the user's behalf. API + UI change.
3. Consensus validates `charge_micro` against the protocol constant and applies the
   `fees::FeeKind::AiInference` split at block-apply.
4. Settle the delivery/dispute story, or accept that an unmined charge is the node's loss.

### 2.2 ⚠ Trap for whoever implements §2.1

**Do not derive the charge from the thermodynamic calculation without first making its inputs
consensus fields.**

`vision/thermo_genesis.rs` computes `R = (C_flops / E) × Γ × scale`, where `E`, `Γ` and `scale`
come from **per-node environment variables**:

| Env var | Read at |
|---|---|
| `TET_JOULES_PER_FLOP` | `thermo_genesis.rs:44` |
| `TET_NETWORK_DIFFICULTY_GAMMA` | `thermo_genesis.rs:27` |
| `TET_THERMO_STEVEMON_MICRO_SCALE` | `thermo_genesis.rs:50` |

Two nodes with different values compute **different charges for the same transaction** and diverge —
the same class of defect as §1, with a different input. Today this is latent because the live path
uses the constant, not the formula. The moment the formula reaches consensus, those three values
must be block or genesis fields, not env reads.


### 2.3 CAAC latency is self-declared — signature does not fix it

`POST /v1/vision/caac/complete` derives the PoC/PoR role from `client_latency_ms`, a value the
**caller supplies**. The record it writes feeds `LedgerCaacWeightProvider::consensus_weight`
(`consensus.rs:200`) and therefore leader election whenever
`TET_CONSENSUS_LEADER_MODE=caac` — which is what `.env.mainnet.example` sets.

A hybrid signature was added on 2026-09-20. **It closes impersonation only.** You can no longer
write a role record for someone else's wallet. You can still sign your own `latency: 0` truthfully
and self-elevate:

| Declared latency | Role | Weight |
|---|---|---|
| `0` (claimed) | PoC | 100 + up to 1000 latency bonus |
| honest, slow | PoR | 25 |

So the *honest* participant is penalised and the liar is rewarded — the incentive points the wrong
way, which is worse than the endpoint simply being unauthenticated would suggest.

**What actually fixes it:** server-measured latency (the node times the challenge itself rather
than trusting a reported number — `measure_challenge_wall_ms` already exists and is currently
recorded only for audit), or hardware attestation binding the claim to a device. Either changes
what CAAC records mean and therefore what consensus weights mean, so it belongs at the ceremony.

Related: WP §17.5, which this is a concrete instance of.


---

## 3. Fixed before Phase 1 — do not redo

Recorded so the ceremony checklist does not re-litigate them.

| Fixed | Commit | Was |
|-------|--------|-----|
| `/wallet/transfer` off-chain mutation | `8f52db7` | Direct sled write; forked non-producer nodes |
| Initial airdrop off-chain mutation | `2ce9024` | Same, on the airdrop path |
| `/ai/infer` airdrop off-chain mutation | `3bd2009` | Missed in the `2ce9024` cleanup |
| Fee schedules unified, `fee_bps` bounded | `ad6749f`…`3b90701` | Seven ad-hoc schedules; unvalidated caller-supplied rate |
| Genesis Epoch ×5 burn saturation | `3b90701` | Documented 50/50 never ran |
| `/ledger/faucet` direct write | 2026-09-19 | REST-reachable direct balance write |
| `/ledger/recover-from-guardian` | 2026-09-20 | **Unauthenticated** route that wiped the balances tree and loaded caller-supplied state |
| `/dex/*` (7 routes) | 2026-09-20 | Six unauthenticated fund-movement endpoints; v0 CHF-era product, removed |
| `/v1/vision/zk-court/challenge` | 2026-09-20 | Unauthenticated: could lock and forfeit a third party's bond |
| `/v1/vision/caac/complete` | 2026-09-20 | Unauthenticated **impersonation** closed; self-declared latency remains — see §2.3 |
| `compute_state_root` silent row-drop | 2026-09-19 | Unreadable rows vanished from the root with no error |

---

## 4. Still unfixed and NOT genesis-blocked

Tracked here only so they are not forgotten; none requires a ceremony.

- ~~`/ai/infer` settlement~~ — **promoted to §2.1**; it is genesis-blocked after all.
- **~15 other direct-write paths** remain reachable from REST or p2p — see the audit in the
  commit body for 2026-09-19. None is a *new* regression; all predate this work.
- **ZK-Court has no challenger incentive**, so the dispute path is never exercised (WP §8).
