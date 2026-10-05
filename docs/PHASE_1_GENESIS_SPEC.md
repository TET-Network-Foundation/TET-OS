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

`apply_consensus_block_batch` (`ledger.rs:1640`) and `compute_state_root_after_remote_block`
(`ledger.rs:1398`) both call:

```rust
let locked_sum = self.locked_balance_micro(&from, ledger_now_ms())?;
```

`ledger_now_ms()` reads `SystemTime::now()` — the **node's own wall clock**. `locked_balance_micro`
(`ledger.rs:4639-4664`) is explicitly time-gated:

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

### Inventory (2026-10-02, `main` at `4502580`)

Every clock read reachable from the two entry points, found by reading each callee rather than by
grep. Line numbers drift; the function names are the stable part.

| Site | Path | Decides | Consensus? |
|---|---|---|---|
| `ledger.rs:1449` | preview, `Transfer` arm | `locked_balance_micro(from, now)` → applies or `InsufficientFunds` | **yes**, balance root |
| `ledger.rs:1695` | apply, `Transfer` arm | the same | **yes** |
| `ledger.rs:1567` | preview (`:1487`) **and** apply (`:1821`), via `apply_file_fee_to_balance_map` | the file-fee payer's spendable balance | **yes** — a second site, missed by the first version of this section |
| `ledger.rs:1750` | apply, `VerifyZkProof` | `ts_ms` in the `zk_verified` meta record | no — read only by `audit_events_recent` (REST); differs per node |
| `ledger.rs:1770` | apply, `VerifyZkProof` | `task.processed_at_ms` | no — read by nothing in consensus |
| `ledger.rs:3217` | apply, `WorkerRegister`, via `apply_worker_register` | `registered_at_ms` on the worker record | no — a sort key for the REST worker list |

The comparison itself is `locked_balance_micro`: vest rows `unlock_at_ms > now` (`:4647`) and the
founder cliff `now < unlock_at` (`:4660`).

**The other half of the defect: what the time is compared *against* is per-node too.**

- **Founder unlock.** `apply_genesis_allocation` (`ledger.rs:4389-4390`) stores
  `unlock_at = ledger_now_ms() + founder_genesis_cliff_ms()`, and `founder_genesis_cliff_ms` reads
  `TET_FOUNDER_CLIFF_MS` from the environment (`:564`). Every node runs it at its own first boot
  (`main.rs:395`), so every node holds a different founder unlock time — apart by however far apart
  the nodes were first started — and the environment can differ too. The genesis hash covers
  neither.
- **Worker reward vest locks** take `unlock_at` from the minting node's clock plus
  `TET_WORKER_VEST_MS`. The mint is one of the §2.5 paths, so the rows exist only on that node anyway;
  it becomes this section's problem when the mint is consensus-routed.

**Adjacent, not clock reads:** the stored block `ts_ms` is each node's own receive time
(`consensus.rs:909`), and `RemoteBlockGossip` (`consensus.rs:72`) carries no timestamp at all — the
wire format changes, not only `block_id`. `TET_CONSENSUS_LEADER_MODE` (`consensus.rs:297`) is a
per-node environment value that decides the expected leader during validation (`:1544`): the same
class with a different input, and it belongs in genesis. `TET_SNAPSHOT_EVERY_BLOCKS` is operational
only.

### The design

1. **Header.** Add `ts_ms: u64`, set by the producer, covered by a V3 `block_id` with its own domain
   (PAE domain `tet block id v3`, see "As built"), and carried on gossip and catch-up. Rename the node-local field to
   `received_at_ms` so nothing reads it by mistake.
2. **Apply takes it as a parameter.** `apply_consensus_block_batch` and
   `compute_state_root_after_remote_block` gain `block_ts_ms` and thread it to all six sites above,
   through `apply_file_fee_to_balance_map` and `apply_worker_register`. After this, `ledger_now_ms()`
   is unreachable from either function.
3. **Genesis gets a clock.** `genesis_time_ms` and the cliff length go into the genesis hash payload.
   The founder unlock is `genesis_time_ms + cliff`, identical everywhere. `TET_FOUNDER_CLIFF_MS`
   stops being a consensus input; a dev chain that wants cliff 0 says so in its genesis and so gets a
   different hash. Worker vest becomes `block_ts_ms + protocol constant` when that mint is routed.
4. **Validation.**
   - `ts_ms > parent.ts_ms` — deterministic, evaluated identically everywhere.
   - `ts_ms ≤ local_now + 60 s` — a block further ahead is **held and retried, not rejected**.
     Rejecting it would make validity depend on when a node looked, which is a new way to fork. Held,
     it becomes valid as the local clock passes it.
   - **No lower bound against local time.** Catch-up replays blocks whose time is long past; any
     "too old" rule breaks sync.

**Why 60 s.** The shortest time-gated window anywhere is the planned anonymous escrow's 24 h;
60 s of early release is 0.07 % of it, and negligible against a 90-day vest or a 365-day cliff.
NTP-synced hosts agree to well under a second, so 60 s also absorbs a badly-synced laptop. Too small
costs a skewed follower a held block that heals itself; too large costs early release of that size.
Bitcoin's 2 h is no template — it is sized for 10-minute blocks.

**What a producer can do by lying about time:**

- **Release funds early:** by at most 60 s — the future bound, and monotonicity keeps it there.
- **Freeze funds by holding time back:** not prevented by these rules. Monotonicity lets time crawl.
  With a single producer (risk R10) this is the same power as declining to include a transaction,
  which that producer already has; a median-time-past rule only helps once several producers
  alternate. Stated here so the bound above is not read as covering it.

5. **Producer signature (D2; decided 2026-10-03, option 1).** Blocks carry a hybrid signature over the
   V3 `block_id`, which already commits to `ts_ms`, parent, txs and `state_root`.
   - **Key.** A dedicated Ed25519 + ML-DSA-44 keypair in the node's db dir
     (`producer_ed25519_seed.raw`, `producer_mldsa44_seed.raw`). It is never the wallet key, so a
     producing node holds no spending secret. `TET-Core --producer-key` prints the node's entry.
   - **Pre-image.** `TET_BLOCK_SIG_V1|` followed by `block_id`. ML-DSA uses the deterministic `rnd`
     every TET signature uses.
   - **Validator set in genesis.** `TET_GENESIS_VALIDATORS` names a JSON list of
     `(producer_id, ed25519_pk_hex, mldsa44_pk_b64)`. It goes into the genesis hash as a
     length-prefixed digest, so changing the set is a new genesis. Phase 1 accepts that;
     rotation is Phase 1.1 (`QUEUE.md`). It replaces `TET_VALIDATOR_IDS`.
   - **Where it is checked.** Every acceptance site: gossip, height-range catch-up, by-id backfill.
     Both acceptance functions take a `ProducerVerifiedBlock`, and only `verify_block_producer` can
     construct one, so a sync path that skips the check does not compile. The gossip mesh verdict
     also refuses a bad signature, so a forged block is not forwarded. The `TET_PRODUCER_PEERS`
     PeerId pin remains as an optional second layer.
   - **Held blocks.** A block more than 60 s ahead returns `Held`. Nobody is blacklisted for it.
     The catch-up driver goes idle, and its 1 s tick re-requests the block.

### As built (2026-10-03, branch `phase1-block-time`)

Where the implementation differs from the text above, or the text left a choice open:

- **The spendability guard uses separate blocks for `Transfer` and `FileFee`, not one block with
  both.** With both in one block, restoring the node clock at either site leaves the other site
  still refusing the block, so the guard measures their disjunction (C4).
- **Founder guard.** Nodes that boot at different clocks hold the same unlock. A node that sets a
  different `TET_FOUNDER_CLIFF_MS` gets a **different genesis hash**, not the same unlock, because
  design 3 puts the cliff in the hash. The guard sketch's "one with `TET_FOUNDER_CLIFF_MS` set →
  identical unlock" would contradict that, so the guard asserts the hash differs.
- **The producer also reads the clock.** It stamps `ts_ms = max(clock, parent.ts_ms + 1)`. So the
  clock has two production readers, the stamp and the future bound, and neither is on the apply
  path. D3's "only reader" means only reader on the acceptance side.
- **Local bookkeeping still uses the node clock:** `received_at_ms`, undo and tx-index timestamps,
  audit rows. None of it is in the state root or read by consensus.
- **The CHF AML day bucket** reads the injected clock. It is off the apply path.
- **The V3 `block_id` pre-image is length-prefixed**, not tag-separated: `SHA256(PAE("tet block id
  v3", [height_le, parent, state_root, PAE_fields(tx_hashes), producer, ts_le]))`, the agent-payload
  convention (`agent::pae`). The tag-separated draft let a `,` in a tx hash, `[]` against `[""]`, or
  bytes moved across a `|field=` tag give two headers one id.
  `block_id_has_no_field_boundary_collision` holds four such pairs, and
  `block_id_v3_golden_vector` pins the encoding.

**Open, for whoever reviews this:**

- **The by-id backfill site has no network-level guard.** The type-state covers it, but it lacks a
  two-swarm test like gossip's.
- **Leader mode is still a per-node setting** (item 6).

### Migration — this is a new genesis

- **State:** nothing carries over (Strategy C). Balances, vest locks, the worker registry and the
  Tmail key directory start empty. Mnemonics still derive the same wallets; balances do not survive.
- **Signatures:** a new `chain_id` and a `genesis_hash` that now includes `genesis_time_ms` and the
  cliff invalidate everything bound to the chain: transaction envelopes, Tmail key registrations,
  anonymous registrations, agent payloads and manifests — including the devlog's (`tools/pin.mjs`
  with the new values, then `tools/sign.mjs --resign-all --previous-pin <old>`). Agent keys do not
  change. Update the published hash in `RUNNING_A_NODE.md`, the UI's `verify-genesis-hash.mjs`, and
  the SECURITY.md `tet-local-dev` limitation.
- **Ceremony order:**
  1. Freeze a tag with the batch merged: full CI, a fresh `zk-real`, every negative control.
  2. Fix the genesis parameters — chain id, `genesis_time_ms` (a published future instant), the real
     treasury, founder schedule, reserve, denomination, leader mode — and compute the hash **with
     tet-core**, never by hand.
  3. Publish the hash and genesis time, and new seed multiaddrs if per-plane keys change PeerIds.
  4. Archive the old chain's data; wipe the seeds.
  5. Start Helsinki — no block can exist before `genesis_time + 60 s` by the future bound — then
     Nuremberg; check heights and roots agree.
  6. Re-sign everything chain-bound (devlog; users re-register Tmail keys, which FIPS-203 forces anyway).
  7. Docs: SECURITY.md, `RUNNING_A_NODE.md`, the red-by-design tests turning green, a devlog entry.

### Guards

**Replace `wallclock_time_changes_spendability_for_the_same_block`, do not flip it.** It calls
`locked_balance_micro(t)` with two injected times, and that function *should* depend on time — locks
expire. `assert_ne!` → `assert_eq!` there would demand locks that never unlock. The invariant is that
the **applying node's clock** no longer matters; the **block's** time does.

- `same_block_applies_identically_at_any_node_clock`: one state with a vest lock unlocking at U; one
  block, `ts_ms = U − 1`, holding a `Transfer` **and** a `FileFee` that need the locked funds; apply on
  two copies with the node clock forced to U − 1 and to U + 1 year. Roots equal; both refuse.
- Its companion: the same transactions in a block with `ts_ms = U + 1` apply on both — so "always
  refuse" cannot pass the first.
- Negative controls, one site at a time: restore `ledger_now_ms()` at the preview `Transfer` site, the
  apply `Transfer` site, and `FileFee` → each turns the primary guard red. A `Transfer`-only guard would
  leave `FileFee` unguarded.
- Founder schedule: two nodes applying genesis at different forced clocks, one with
  `TET_FOUNDER_CLIFF_MS` set → identical unlock time and root. Control: restore `now + cliff`.
- Validation: `ts ≤ parent` refused; `> now + 60 s` held then accepted once the clock passes it; an
  old block during catch-up accepted; `ts` altered after the fact breaks `block_id`. Controls: drop
  each bound, and drop `ts` from `block_id`.

All of these need a test seam for the node clock. After the fix, the only legitimate reader of it is
the future-bound check.

**Consensus-breaking on two counts** — the block schema changes and apply outcomes change. It
cannot be shipped to a running chain. It is free at a genesis ceremony.

### Order of the §2 batch

`docs/QUEUE.md` holds the batch in implementation order, marking which items can be built
unattended on a branch and which need a design decision first.

---

## 2. Also batch into this genesis

These are all consensus- or schema-breaking and are cheap only at a ceremony.

| Item | Source | Why it must wait for genesis |
|------|--------|------------------------------|
| **`/ai/infer` settlement → consensus** | this doc §2.1 | Needs a new `TxV1` variant **and** a client-signed settlement envelope; see §2.1 |
| **Founder vesting: cliff + linear** | WP §17.3, `DAILY_LOG_2026-05-29` | The live chain has a one-shot 365-day 100% cliff on 2.5B TET burned into genesis, with no early-unlock path. This is the reason Strategy C exists |
| **`TxV1::Transfer` nonce** | `DAILY_LOG_2026-05-31` | Identical transfers currently collide on tx hash, so only the first applies. Adding a nonce changes the tx schema |
| **FIPS-203 ML-KEM migration** | WP §17.17 | Tmail/Files KEM keys are mnemonic-derived; changing the algorithm invalidates every messaging identity. Free when the key directory is discarded anyway |
| **Minimum ML-DSA level** | WP §7.1 | Verification infers the level from pubkey length and accepts 44/65/87, so the effective security level is the signer's choice. Pinning a floor is a consensus rule. **Open (2026-10-05):** no level sits below 44, so a 44 floor refuses nothing and any higher floor breaks the browser wallet; the ML-DSA key is also not bound to the wallet. See [`PHASE1_ITEM5_MLDSA_FLOOR.md`](./PHASE1_ITEM5_MLDSA_FLOOR.md) |
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

1. **`FileAnnounce.storage_node` is an opaque hint, not a `PeerId`** (decided 2026-10-04, option A
   of [`PHASE1_ITEM4_STORAGE_NODE.md`](./PHASE1_ITEM4_STORAGE_NODE.md)). This cost first assumed
   the field carries the block-plane `PeerId`. It never has: every client signs the literal
   `"local"`, the node does not check its form, and `files_fetch` falls back to the first
   connected block-plane peer. The field stays in the signed envelope pre-image
   (`files/mod.rs:134-144`) as an unverified hint, and nothing pins it to a plane, so the
   per-plane split cannot break it. Do not wire it to a `PeerId`. The envelope is gossiped and
   already names `sender_wallet_id`, so a node `PeerId` there links a wallet to a machine
   (option B, rejected). Finding which node holds a blob is a separate design item (`QUEUE.md`).

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

#### As built (2026-10-04, branch `phase1-item-4-per-plane-keys`)

- **All three planes are derived, the block plane included.** `info` is exactly the three labels
  above, `salt` is empty, the output is used as an Ed25519 seed. No label reproduces today's key,
  so every plane's `PeerId` changes and the root key is never a wire identity. The alternative —
  the block plane keeps the root key so its multiaddr survives — would leave one plane on a key no
  other plane's derivation separates it from, to save a reissue the ceremony does anyway.
  `plane_keys_match_the_spec_derivation_vector` pins the derivation against an independent Python
  computation.
- **The swarm constructors take `PlaneKeys` and select their own plane** (`start_mdns_ping_swarm` →
  block, `start_p2p_node` / `build_nexus_swarm` → nexus, `NetworkManager::new` → ledger). `main.rs`
  no longer holds a raw keypair to hand to the wrong swarm.
- **A non-Ed25519 root is refused**, not replaced. `load_or_create` only ever wrote Ed25519. This
  build compiles `libp2p-identity` with only `ed25519`, so such a file fails to *decode* at load;
  `PlaneKeys::derive`'s own `try_into_ed25519` refusal is a second line that no test can reach
  without enabling another key type. `plane_keys_refuse_a_non_ed25519_root` drives the reachable
  refusal and checks that the file is left untouched.
- **Banner.** `libp2p PeerId:` is now the block plane's, which is what `print-bootnode.sh`,
  `start-network.sh` and `provision-seed.sh` grep for and what `TET_BOOTNODES` /
  `TET_PRODUCER_PEERS` need. The nexus and ledger PeerIds follow on their own lines.
- **`TET_PEER_ID` → `TET_NODE_LABEL`**, both readers (`StartupConfig`, `local_node_id_from_env`).
  The old name is **refused at startup** when non-empty, not read as an alias: ignoring it would
  move a node whose only label it was to `local-wallet`, a different producer id, in silence.
- **`storage_node`: option A, an opaque hint** (decided 2026-10-04, cost 1 above). No client
  sends a `PeerId` there (`tet-network/ui/app/lib/files.ts:196`, both interop scripts send
  `"local"`), so there is nothing to pin. The draft's `PlaneKeys::storage_node_peer_id()` helper,
  its startup log field and its guard were removed with the decision. Nothing read them, and a
  tested "this is the storage-node PeerId" helper would invite wiring option B.

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
