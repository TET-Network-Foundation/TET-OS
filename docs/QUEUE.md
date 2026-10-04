# Work queue — Phase 1 genesis batch

The order to build [`PHASE_1_GENESIS_SPEC.md`](./PHASE_1_GENESIS_SPEC.md) in. Unattended sessions
work from this file, top to bottom.

## Rules for an unattended session

- **Phase 1 work targets the `phase1` branch, never `main`.** Branch from `phase1`, open the PR against
  `phase1`. `main` stays deployable to the live testnet until the ceremony: a V3 header or a new
  genesis hash on `main` would leave a node built from it unable to follow the seeds.
- **Take the first item whose status is `ready`.** Skip `blocked` items; never reorder the list.
- **`autonomous: yes`** — branch, implementation, guards, PR. Every guard gets its negative control,
  run and recorded in the commit body (`CLAUDE.md`). Full CI on the PR. **Never merge, never deploy,
  never push to `main`.**
- **`autonomous: no`** — write or extend the design in the spec, open a docs PR, and **stop**. These
  items turn on a decision that is not the session's to make (economics, identity, cryptography,
  network-wide disruption). A design that ends in a question is the expected output.
- **Nothing here changes a live network.** No genesis parameter, seed configuration or deploy is
  touched by an unattended session, even when the item is about one.
- When an item's PR is merged, a person moves it to **Done** and marks the next one `ready`.
- If an item turns out to need something not in its row, stop and say so in the PR rather than
  widening the item.
- **A draft PR with a design question is resolved by the human in a PR comment; the nightly does
  not wait on it.** That item is skipped while its PR is open, and the next night takes the next
  qualifying item.

## Queue

| # | Item | Spec | Depends on | Autonomous | Status |
|---|---|---|---|---|---|
| 2 | **`Transfer` nonce**: what the nonce is, how it enters the tx hash, replay and ordering rules, what other variants should copy | §2 table | — | **no** — schema design; new variants (3, 7) should follow it | ready |
| 3 | **`TxV1::TmailPin`**: 1_000 µTET, 50 % treasury / 50 % burn, an apply arm, the retention exemption | §2 table; `SOVEREIGN_OS_PHASE0_SPEC.md` App. C | 2 (approved design) | **yes** | blocked |
| 5 | **Minimum ML-DSA level**: consensus verification refuses a key below the floor instead of inferring the level from its length | §2 table, WP §7.1 | — | **yes** | ready |
| 6 | **Leader mode as a genesis parameter**: `TET_CONSENSUS_LEADER_MODE` stops being a per-node setting | §1 inventory | 1 | **yes** | ready |
| 7 | **Founder vesting, cliff + linear** | §2 table, WP §17.3 | 1 | **no** — the schedule is an economic decision | ready |
| 8 | **`TxV1::AnonymousEscrow`** (open / settle / slash) with the 24 h auto-settle on block time; closes AT-5(b) | §2 table; S8 | 1 merged, 2 | **yes** once 1 is merged | blocked |
| 9 | **FIPS-203 ML-KEM migration** (both planes) | §2 table, WP §17.17 | — | **no** — invalidates every messaging identity; library and key-derivation choices | ready |
| 10 | **Protocol reserve allocation** and **denomination naming** | §2 table | — | **no** — economic and naming decisions | ready |
| 11 | **By-id backfill two-swarm test**: a network-level guard that the by-id backfill site refuses a block without a valid producer signature, like `block_sync::gossip_refuses_a_block_without_a_valid_producer_signature`; today only the `ProducerVerifiedBlock` type-state covers it. Negative control: skip the verify at that site | §1 "As built" (open) | — | **yes** | ready |

### Likely not in the Q1 2027 ceremony

Listed so they are decided rather than forgotten. All `autonomous: no`; a design is the deliverable.

| Item | Spec | Why it is heavy |
|---|---|---|
| `/ai/infer` settlement and worker-reward mints as consensus txs | §2.1, §2.5 | needs the optimistic-execution model; ZK-Court has no challenger incentive yet |
| Stake / unstake / worker-bond tx variants | §2.5 | three new variants with economic rules |
| CAAC server-measured latency | §2.3 | changes what consensus weights mean |
| Per-block `state_root` checkpoints | §2 table | changes what nodes exchange |
| Genesis-bridge apply arm | §2.5 | the variant is signable but has no apply arm |
| **Locate a file blob without a machine identity** | §2.4 cost 1; `PHASE1_ITEM4_STORAGE_NODE.md` | `storage_node` is an opaque hint (item 4, option A), so `files_fetch` asks the first connected peer and availability falls as the network grows. Candidates: ask the receiver's peers in turn, or a Kademlia provider record keyed by `file_id`. Neither may put a node `PeerId` in the gossiped, signed envelope. Files are off-chain, so this is not genesis-bound |
| **Validator-set rotation** (Phase 1.1) | §1 design 5, D4 | the set is in the genesis hash, so today any change is a new genesis; rotation needs a signed, consensus-applied set change and a rule for which set signs the block that changes it |

## Decisions

Recorded 2026-10-02. These bind every item above; an item that seems to need otherwise stops and asks.

- **D1 — Where Phase 1 lands.** A long-lived `phase1` branch, created from `main` on 2026-10-02 and
  protected like `main`: pull request required (0 approvals), the five required checks, no force
  pushes, no deletion. Every Phase 1 PR targets it. `main` keeps taking only changes that are safe on
  the live testnet, and is merged into `phase1` when it moves, so `phase1` never falls behind.
- **D2 — One header change.** The producer signature over `block_id` is part of item 1, not a later
  item, so the block header changes once before the ceremony rather than twice.
- **D3 — The clock seam.** `Ledger` takes a `now_ms` source at construction: the system clock in
  production, a fixed or stepped clock in tests. No global, no environment variable, no test-only
  override — an override that stands in for the real path is the fallback pattern `CLAUDE.md` warns
  about, and it would let a guard pass without exercising the code it names. After §1 the only
  production reader of that clock is the future-bound check in block validation; anything else that
  reads it on the apply path is a regression.

- **D4 — The producer key (2026-10-03).** Option 1 of the item 1 PR: a dedicated hybrid
  Ed25519 + ML-DSA-44 producer keypair in the node keystore, never the wallet key. The genesis
  validator set is a list of `(producer_id, ed25519_pk, mldsa44_pk)` in the genesis hash, so a set
  change is a new genesis until rotation lands in Phase 1.1. The signature is over the V3 `block_id`
  and is verified at every acceptance site; the PeerId pin stays as an optional second layer.

## Done

| Item | PR |
|---|---|
| §1 design written | #7 |
| 1 — Block time as the consensus clock: V3 header (`ts_ms`, length-prefixed `block_id`, producer signature), genesis v2, clock seam, 36 CI guards | #11 |
| 4 — Per-plane libp2p keypairs (HKDF per plane, all three PeerIds new), `TET_PEER_ID` → `TET_NODE_LABEL` (old name refused); `storage_node` stays an opaque hint (option A) | #14 |
