# Phase 1 Genesis — consensus changes that must land at the ceremony

**Status:** Open. Created 2026-09-19.
**Why this document exists:** Phase 1 cuts a **new genesis** ([`SPRINT_PLAN.md`](./SPRINT_PLAN.md),
Strategy C). Changes that are impossible on a live chain are free at a genesis ceremony, and there
is exactly one window to make them. Anything on this list that is missed stays broken until the
*next* genesis — which, for mainnet, means never.

---

## 0. The §2 batch is growing — ceremony targets **Q1 2027**

**Added 2026-09-24.** This list was written as a catalogue of things that *would* be nice to fix at
a ceremony. It is turning into the critical path for shipping features.

Three Phase 0 features now have a half that cannot ship without it:

| Feature | Phase 0 half | Blocked half | Why blocked |
|---|---|---|---|
| **Pin** (S7-3) | — | the whole thing | `TxV1::TmailPin` is a new variant |
| **Anonymous** (S8) | anonymity works, AT-5(a) | escrow + 24 h settle + slash, AT-5(b) | new variant **and** §1's wall-clock defect |
| **Retention** (S7-0) | server-side rule ✅ | pin exemption | waits on Pin |

Each was deferred here for a good individual reason. Together they mean the product ships with
acceptance tests that are red by design and a marketing claim that needs a footnote.

**The tension worth naming:** a flag-day `TxV1` upgrade is *cheapest right now* — the network is one
seed and a handful of followers — and gets more expensive with every node that joins. But it is not
available for the anonymous escrow, because that one's auto-settle **is** §1's wall-clock-in-apply
defect; a flag day would ship the defect rather than route around it. So the escrow cannot jump the
queue, and Pin jumping it alone buys little.

**Decision, 2026-09-28: the ceremony targets Q1 2027, and the date is published as a quarter.**

S8-3 has landed, so this is the promised revisit. Three findings:

1. **Not before the Phase 0 public launch.** A new genesis resets the chain, and the FIPS-203 row
   below means every messaging identity is invalidated with it. Doing that in the week strangers
   first arrive is the worst available timing.
2. **The batch is dominated by one item.** §1 — wall-clock time as a consensus input — blocks the
   anonymous escrow directly, and is a consensus design change needing its own spec, its own guards
   and a negative control, not a ceremony-day edit. Of the fifteen items in §2, six are nearly free
   *once the ceremony happens* (`TmailPin`, the `Transfer` nonce, per-plane keypairs, the ML-DSA
   floor, the reserve allocation, denomination naming). They are waiting on §1, not on each other.
3. **So the batch does not yet cost more than the ceremony** — but it will, and the answer to "when"
   is "when §1 is designed", not a calendar date.

**A quarter, not a day.** Three acceptance tests are red by design (AT-5(b), AT-7(b), Pin), and a
reader deserves better than "deferred". They also deserve better than a specific date that this
project's own history says will slip — the Phase 0 target of 2026-09-15 was missed, and inventing a
precise successor would repeat the mistake rather than learn from it. **Q1 2027** is what can be
said honestly: far enough out for §1 to be designed and tested properly, near enough to be a
commitment.

Revisit the quarter if §1's design lands materially early or late. Move it in public if it moves.

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

### Live corroboration, 2026-09-22

Cross-region sync against the Helsinki seed shows the stored block timestamp is node-local. At the
same height, on the same chain, the two nodes agree on everything that is hashed and disagree on
the timestamp:

```
height 151   Helsinki (producer)                 Switzerland (replayer)
block_id     0x89a8e440…b025eb60      ==         0x89a8e440…b025eb60
state_root   0x4179a4b5…65522574      ==         0x4179a4b5…65522574
ts_ms        1790068236724            !=         1790068246418      (+9694 ms)
```

The delta tracks propagation latency — 9.7 s on a block the follower fetched via catch-up, 1.7 s
and 19 ms on blocks it received by gossip. So `ts_ms` is *when this node learned about the block*,
not when the block was produced, and it is outside `block_id` exactly as §1 describes. Any
consensus rule that reads it is reading a different value on every node, which is the mechanism
this section exists to remove.

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
| **`/ai/infer` settlement → consensus** | this doc §2.1 | Needs a new `TxV1` variant **and** a client-signed settlement envelope; see §2.1 |
| **Founder vesting: cliff + linear** | WP §17.3, `DAILY_LOG_2026-05-29` | The live chain has a one-shot 365-day 100% cliff on 2.5B TET burned into genesis, with no early-unlock path. This is the reason Strategy C exists |
| **`TxV1::Transfer` nonce** | `DAILY_LOG_2026-05-31` | Identical transfers currently collide on tx hash, so only the first applies. Adding a nonce changes the tx schema |
| **FIPS-203 ML-KEM migration** | WP §17.17 | Tmail/Files KEM keys are mnemonic-derived; changing the algorithm invalidates every messaging identity. Free when the key directory is discarded anyway |
| **Minimum ML-DSA level** | WP §7.1 | Verification infers the level from pubkey length and accepts 44/65/87, so the effective security level is the signer's choice. Pinning a floor is a consensus rule |
| **Protocol reserve allocation** | WP §11.4 | `WALLET_PROTOCOL_RESERVE` mints 0 and is committed in the genesis hash. Changing it needs a new ceremony |
| **Consensus-route all remaining balance writes** | this doc [§2.5](#25-consensus-route-all-remaining-balance-writes) | **Nine** paths still move funds outside the block pipeline. Each needs a new `TxV1` variant or a client-signed settlement envelope, several need both. (Said "ten" until 2026-09-28; nine is the count §2.5 actually lists) |
| **Stake / unstake / worker-bond as consensus txs** | this doc [§2.5](#25-consensus-route-all-remaining-balance-writes); locations in `TET-OS-security` | `TxV1` has **no** `Stake`, `Unstake` or `WorkerBond` variant — the nine are `SignerLink`, `FoundingMemberEnroll`, `Transfer`, `GenesisBridge`, `InitialAirdrop`, `FileFee`, `WorkerRegister`, `EnterpriseInference`, `VerifyZkProof`. Routing these through the mempool therefore needs new tx variants, which is a schema change |
| **Per-plane libp2p keypairs** | [post-mortem 2026-09](./postmortems/2026-09-gossip-lost-subscriptions.md), this doc §2.4 | Changes every node's `PeerId` on at least two planes, so every published bootnode multiaddr must be reissued. Free at a ceremony, disruptive on a live network |
| **`TxV1::AnonymousEscrow` (open / settle / slash)** | `SOVEREIGN_OS_PHASE0_SPEC.md` §A.4.5, `SPRINT_PLAN.md` § S8 | Anonymous Mode locks **1 TET** from the anchor into escrow per ephemeral. That is a balance move, so it needs a new `TxV1` variant — the same schema break as `TmailPin`. **It cannot be brought forward by a flag day**, because the 24 h auto-settle is §1's defect: "if `now > created_at + 24h` … → escrow → anchor" is `ledger_now_ms()` deciding a balance move, and an escrow row with a deadline is `VestLockV1`-shaped, read by the time-gated `locked_balance_micro` (`ledger.rs:4571`). Shipping it before §1 lands would add a second wall-clock consensus input, not remove one. Decided 2026-09-24 |
| **`TxV1::TmailPin`** | `SOVEREIGN_OS_PHASE0_SPEC.md` Appendix C, `SPRINT_PLAN.md` §S7 | Tmail Pin is a 1_000 µTET fee (50% treasury / 50% burn). `TxV1` is `#[serde(tag = "kind")]` and blocks carry `Vec<SignedTxEnvelopeV1>` (`consensus.rs:81`), so a node on the current binary cannot **deserialize** a block containing a new variant — it fails before reaching the `apply_consensus_block_batch` catch-all. Adding it to a live chain is a flag-day upgrade for every node; free at a ceremony. Decided 2026-09-23 not to spend a flag day on it |
| **Denomination naming** | `WHITEPAPER_v1.0_GAPS.md` §10.1 | "Stevemon" vs "micro-TET" is cosmetic in code but appears in the genesis hash payload |
| **Per-block `state_root` checkpoints** | `BUG_block_9828_divergence_mystery.md` | Validation is tip-only today, so divergence surfaces at an arbitrary later block rather than the one that caused it. Changes what nodes exchange |

### 2.1 `/ai/infer` settlement must become a consensus tx

The `/ai/infer` handler calls `settle_ai_inference_dynamic_charge` — a **direct balance write**.
(Exact location in `TET-OS-security`, per the note in §2.5.)
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

### 2.4 Per-plane libp2p keypairs

**Why this is here:** the node runs three `Swarm`s — block plane (`p2p.rs`, 8002), inference plane
(`p2p_network.rs`, 4003) and ledger plane (`network.rs`, 4005) — and all three are built from the
same `libp2p_keypair` (`main.rs:525/551/587`). They are therefore **indistinguishable on the
wire**: one `PeerId`, three independent `Behaviour` instances.

On 2026-09-22 that cost the public testnet its transaction path. The inference plane read
`TET_BOOTNODES` and dialled the block plane's address, so a follower opened two connections to one
remote listener under one `PeerId`. The remote's gossipsub advertised its subscriptions on the
first (`other_established == 0`) and said nothing on the second (`behaviour.rs:2912-2914`) — and
locally that second connection belonged to a *different* `Behaviour`, which was left with no
record of the peer's topics and could not publish. Intermittently, depending on dial order. Full
account in the [post-mortem](./postmortems/2026-09-gossip-lost-subscriptions.md).

That instance is fixed by scoping the env var (`TET_NEXUS_BOOTNODES`, empty by default). **The
class is not.** Nothing stops the next plane from being pointed at another plane's address, and
the failure is silent when it happens.

#### The fix

Derive a keypair per plane from the persisted node key:

```
plane_key = HKDF-SHA256(
    ikm  = <libp2p_keypair.bin secret>,
    info = "tet/plane/block" | "tet/plane/nexus" | "tet/plane/ledger",
)
```

seeding an Ed25519 identity per plane. Each plane then has its own stable `PeerId` derived from
the same root secret, so a cross-plane dial arrives as an ordinary first connection from an
unknown peer and is advertised to normally. The failure becomes **structurally impossible** rather
than merely unconfigured. `libp2p_keypair.bin` stays the single root secret — no new key material
to generate, distribute or back up, and identities remain stable across restarts.

#### Two costs, both found by reading the code

1. **`FileAnnounce.storage_node` must remain the block-plane `PeerId`.** It is a `PeerId` string
   that `files_fetch` resolves on the block plane, and it is **bound into the signed envelope
   pre-image** (`files/mod.rs:134-144`). Deriving it from the wrong plane does not fail loudly —
   it invalidates envelopes at signature-verification time, far from the cause. Whatever populates
   that field must be pinned to the block-plane identity explicitly, with a test.

2. **Every existing bootnode multiaddr must be republished.** Any plane whose label differs from
   today's derivation gets a new `PeerId`, including the block plane unless its label is chosen to
   reproduce the current key. The published seed multiaddr in
   [`RUNNING_A_NODE.md`](./RUNNING_A_NODE.md) § The public seed, and `TET_BOOTNODES` on every node,
   change with it. On a live network that is a coordinated restart; at a genesis ceremony the
   addresses are being reissued anyway.

Everything else surveyed is unaffected: `WorkerRegistry` is keyed by wallet id, Tmail by
sender/receiver wallet ids, and the ledger holds no `PeerId` at all. The block plane's own
`PeerId`-keyed state (hello registry, bootnode watch, catch-up driver, blacklist) lives entirely
within one plane.

#### Related rename, cosmetic but overdue

**`TET_PEER_ID` is not a libp2p peer id.** It is a string label for the producer / wallet identity
(`main.rs:100`, `consensus.rs:342`) and has nothing to do with `PeerId`. The name actively misleads
in exactly the area this section is about, and it is read in only two places. Rename it to
`TET_NODE_LABEL` (or fold it into `TET_WALLET_ID`) at the ceremony, when changing an env var
contract is free.

### 2.5 Consensus-route all remaining balance writes

After the 2026-09-23 sweep, **nine paths** still write balances outside the block pipeline. Every one
forks `state_root` on the serving node while block history stays byte-identical — the block-9828
signature. None is reachable anonymously any more; all are hybrid-signed or admin-gated. **That is
not the same as being safe:** a signature authorises the caller, it does not put the write through
consensus. Two nodes serving the same signed request still diverge.

By class:

| Class | Count | What each needs |
|---|---|---|
| Stake / unstake / worker bond | 3 | new `TxV1` variants — `TxV1` has no `Stake`, `Unstake` or `WorkerBond` |
| AI settlement and worker-reward mints | 4 | client-signed settlement envelopes and consensus-validated mint amounts; blocked on the optimistic-execution model below |
| Genesis bridge | 1 | an **apply arm** — the variant is signable but `apply_consensus_block_batch` has none, so enqueueing one would make every node reject the block |
| Admin-gated slash | 1 | a slash tx variant |
| ZK-Court challenger bond | 1 | settle at block-apply, not at challenge submission |
| Dev faucet | 1 | not network-reachable, off by default, refused on mainnet |

> **Locations withheld.** `file:line` for each path, and the per-path fork analysis, live in the
> private [`TET-OS-security`](https://github.com/TET-Network-Foundation/TET-OS-security) repository
> (`DIRECT_WRITE_PATHS.md`). Three of these need nothing but a caller's own valid signature, so
> publishing exact locations alongside "these fork `state_root`" would be a working recipe for
> forking the public testnet. The counts, the classes and the fix plan are here because they cost an
> attacker nothing and a reader everything. This note goes away when the last path closes.

**The blocker is shared.** Settlement runs *after* the work and *before* the `200 OK`. Routing it
through the mempool means the caller receives the result before payment confirms, and a tx that
never mines leaves the node having worked for free. That is the optimistic-execution model the
whitepaper specifies (§5.1, §8 ZK-Court) and which is not built — ZK-Court has no challenger
incentive, so the dispute path is never exercised. Settling that model is a prerequisite for the
four AI-settlement paths, not a consequence of them.

**A signable variant is not an appliable one.** `apply_consensus_block_batch` has arms for exactly
six variants, and its catch-all returns `Err("unsupported tx in consensus block")` rather than
ignoring the rest — so enqueueing an unhandled variant does not silently drop the write, it makes
every node reject the whole block. An earlier draft of this section claimed two of these paths were
cheap sprint wins "because the variants already exist"; that was derived from the enum and the
signing path without reading the apply path, and it was wrong in both cases.
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

## 4. Direct-write path inventory

**Moved.** The per-path inventory — every `pub fn` in the ledger that writes the balances tree, each
caller, the trigger, and whether it forks `state_root` — is in the private
[`TET-OS-security`](https://github.com/TET-Network-Foundation/TET-OS-security) repository,
`DIRECT_WRITE_PATHS.md`.

What belongs in public, and is not withheld:

- **Eighteen paths were audited** on 2026-09-23 by taking every balance-writing function and reading
  every caller. This replaced an earlier "~15 direct-write paths" placeholder that pointed at an
  audit nobody had written down.
- **Nine are closed:** five removed outright, one writes no balance, and the dead methods are either
  deleted or gated to the test build.
- **Nine remain open**, summarised by class in [§2.5](#25-consensus-route-all-remaining-balance-writes).
  One of those is not network-reachable.
- **The fork test is objective:** `compute_state_root` iterates the balances map, so any method that
  changes a balance outside block-apply forks the serving node's root while block history stays
  identical. Block *validation* counts too — a write that survives a rejected block is a write no
  other node made.
- **Two corrections are on record** in the private file: one path was first labelled
  "already consensus-routed, no fork" and is not, and four were first labelled "unauthenticated" and
  are not — they verify hybrid signatures by hand rather than through the usual helper, so a scan for
  helper names missed them. Both errors were found by reading the code rather than the enum, which is
  the same lesson as the apply-arm correction in §2.5.

**Still open, unrelated to balance writes:** ZK-Court has no challenger incentive, so the dispute
path is never exercised (WP §8). The CHF/AML/fiat top-up meta machinery remains live v0 code.
