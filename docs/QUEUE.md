# Work queue — Phase 1 genesis batch

The order to build [`PHASE_1_GENESIS_SPEC.md`](./PHASE_1_GENESIS_SPEC.md) in. Unattended sessions
work from this file, top to bottom.

## Rules for an unattended session

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

## Queue

| # | Item | Spec | Depends on | Autonomous | Status |
|---|---|---|---|---|---|
| 1 | **Block time as the consensus clock**: V3 header with `ts_ms` in `block_id` and on the wire, apply and preview take it as a parameter, validation (monotonic, ≤ local + 60 s, held not rejected), `genesis_time_ms` and the cliff in the genesis hash, founder unlock from them, node-clock test seam, replacement guards | §1 | — | **yes** — the design and guards are specified; stop and ask if the code disagrees with the inventory | ready |
| 2 | **`Transfer` nonce**: what the nonce is, how it enters the tx hash, replay and ordering rules, what other variants should copy | §2 table | — | **no** — schema design; new variants (3, 7) should follow it | ready |
| 3 | **`TxV1::TmailPin`**: 1_000 µTET, 50 % treasury / 50 % burn, an apply arm, the retention exemption | §2 table; `SOVEREIGN_OS_PHASE0_SPEC.md` App. C | 2 (approved design) | **yes** | blocked |
| 4 | **Per-plane libp2p keypairs**: HKDF per plane from the node key; `FileAnnounce.storage_node` pinned to the block plane with a test; the `TET_PEER_ID` → `TET_NODE_LABEL` rename | §2.4 | — | **yes** — branch only; new multiaddrs are published at the ceremony, not by the session | ready |
| 5 | **Minimum ML-DSA level**: consensus verification refuses a key below the floor instead of inferring the level from its length | §2 table, WP §7.1 | — | **yes** | ready |
| 6 | **Leader mode as a genesis parameter**: `TET_CONSENSUS_LEADER_MODE` stops being a per-node setting | §1 inventory | 1 | **yes** | blocked |
| 7 | **Founder vesting, cliff + linear** | §2 table, WP §17.3 | 1 | **no** — the schedule is an economic decision | blocked |
| 8 | **`TxV1::AnonymousEscrow`** (open / settle / slash) with the 24 h auto-settle on block time; closes AT-5(b) | §2 table; S8 | 1 merged, 2 | **yes** once 1 is merged | blocked |
| 9 | **FIPS-203 ML-KEM migration** (both planes) | §2 table, WP §17.17 | — | **no** — invalidates every messaging identity; library and key-derivation choices | ready |
| 10 | **Protocol reserve allocation** and **denomination naming** | §2 table | — | **no** — economic and naming decisions | ready |

### Likely not in the Q1 2027 ceremony

Listed so they are decided rather than forgotten. All `autonomous: no`; a design is the deliverable.

| Item | Spec | Why it is heavy |
|---|---|---|
| `/ai/infer` settlement and worker-reward mints as consensus txs | §2.1, §2.5 | needs the optimistic-execution model; ZK-Court has no challenger incentive yet |
| Stake / unstake / worker-bond tx variants | §2.5 | three new variants with economic rules |
| CAAC server-measured latency | §2.3 | changes what consensus weights mean |
| Per-block `state_root` checkpoints | §2 table | changes what nodes exchange |
| Genesis-bridge apply arm | §2.5 | the variant is signable but has no apply arm |

## Done

| Item | PR |
|---|---|
| §1 design written | this file's PR |
