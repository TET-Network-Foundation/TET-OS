# Post-mortem: a follower could not publish transactions

**Date:** 2026-09-22 → 09-23 · **Impact:** a node joining the public seed could read and verify the
chain but could not get its own transactions mined. Intermittent, roughly one joining node in
three. No funds at risk, no consensus divergence. · **Status:** cause found and fixed.

---

## What we thought it was

A race in `libp2p-gossipsub`. A follower's record of the seed showed three of the seed's four
topics — `/tet/v1/txs` missing — so `publish` returned `InsufficientPeers` forever while blocks
kept arriving normally. We drafted an upstream issue arguing that a simultaneous dial left a
`Subscribe` RPC on a connection that then closed.

That was wrong, and it was wrong in a way worth recording: **every piece of evidence in the draft
was real, and the conclusion still did not follow.** We had the right observations and the wrong
model three times running.

## What it actually was

**Three `Swarm` instances built from one identity keypair, two of them dialling the same remote
listener.**

The node runs a block plane (`p2p.rs`, port 8002), an inference plane (`p2p_network.rs`, 4003) and
a ledger plane (`network.rs`, 4005). All three are constructed from the same `libp2p_keypair`
(`main.rs:525/551/587`), so all three present the **same `PeerId`**. The inference plane also read
`TET_BOOTNODES` (`p2p_network.rs:1301`) — the block plane's published address — and dialled it.

So the follower opened two TCP connections to the seed's port 8002, from one `PeerId`, owned by
two different `Behaviour` instances. From the seed's single block-plane gossipsub:

- first connection: `other_established == 0` → advertise our subscriptions;
- second connection: `other_established > 0` → **return early, say nothing**
  (`behaviour.rs:2912-2914`).

Locally, though, the second connection belongs to a *different* `Behaviour`. If that was the
follower's block plane, it never received the seed's subscription list, so it believed the seed
was subscribed to nothing it cared about, and `publish` failed at the early return in
`behaviour.rs:635` — before mesh, fanout, explicit-peer or flood-publish selection, which is why
none of the usual mitigations applied.

Intermittent because it depended on which plane's dial landed first.

The dial was never correct in the first place: 4003 and 4005 are container-internal and are not
published on the seed at all, so an inference-plane dial to the block-plane port could only ever
reach the wrong plane's listener.

## How we found it

Reading the vendored `libp2p-gossipsub-0.48.0` source instead of reasoning about it. Two lines
settled it:

- `behaviour.rs:2928` — subscriptions are advertised by iterating `self.mesh` and sending **one
  `RpcOut::Subscribe` per topic**, not one RPC for the set.
- `behaviour.rs:2926` — `New peer connected` is logged *after* the `other_established > 0` early
  return, so it fires only on a first connection.

That second line invalidated our log reading twice over. We had read two `New peer connected`
lines, milliseconds apart, first as two simultaneous connections and then as a disconnect and
reconnect. Both were wrong: they were **two different gossipsub instances in the same process**,
each seeing its own first connection to the same peer.

The confirming measurement was two TCP connections from the follower container to
`95.217.158.153:8002` where there should have been one.

## Fix and result

One line of intent: the inference plane reads `TET_NEXUS_BOOTNODES` (empty by default) instead of
`TET_BOOTNODES`, and `plane_bootnode_addrs_from_env` deliberately does **not** fall back to it.

Ten consecutive fresh-container joins against the public seed, before and after:

| | connections to seed | gossip publish | disconnects | claim settled |
|---|---|---|---|---|
| before | 2 | **failed 3/3** | churn | only via tx-submit |
| after | 1 | **succeeded 10/10** | 0 | 10/10 |

The follower's record of the seed now carries all four topics, including `/tet/v1/txs`.

## Why no test caught it

Every earlier test ran one node, or ran several in one process. The bug needs **two processes each
running multiple planes over a real transport** — in-process tests share a runtime and the
harness's nodes dial each other's block planes only, so the second connection never happened.

This is the same shape as the defect that preceded it: transactions submitted to a non-mining node
were never mined, and that also survived every test because submit-node and mining-node had always
been the same process. Both were invisible until a node ran somewhere that was not this laptop.

## What stays

- **`/tet/v1/tx-submit`** — the direct request/response path for transactions. Built as a
  workaround for a bug that turned out to be ours, and kept on its own merits: blocks have had two
  independent delivery paths since S1 (gossip and pull catch-up), and transactions having only one
  is what turned a single defect into an outage. It is now the reason the outage was survivable at
  all, since it delivered every transaction while gossip was broken.
- **The gossip-heal detector** — demoted to a canary. It logs when a peer's record holds some but
  not all core topics. Its repair attempt is gone: `unsubscribe()` removes the topic from
  `self.mesh` (`behaviour.rs:1140`) and advertisement iterates `self.mesh`, so "repairing" by
  unsubscribe+resubscribe can cause the same damage it detects.
- **The publish-failure diagnostic** (`[P2P][diag]`) — it dumps `all_peers()` with each peer's
  topic set. It is what made the invisible visible, and it costs nothing until a publish fails.

## Version note — upgraded 2026-09-23

Everything above was diagnosed against **`libp2p-gossipsub` 0.48.0**, which is what TET ran at the
time. TET is now on **0.50.0** (via `libp2p` 0.57.0). Three things in this document read
differently on the new version:

- **The error is renamed.** `PublishError::InsufficientPeers` became
  `PublishError::NoPeersSubscribedToTopic` in 0.49.0. Occurrences of the old name in this
  post-mortem are left as written, because they are quoting what 0.48 actually produced. Code and
  logs from here on will show the new name.
- **Subscriptions are now sent as a single hello RPC**, not one per topic (0.50.0,
  [PR 6385](https://github.com/libp2p/rust-libp2p/pull/6385)). The "a subset of the per-topic
  `Subscribe` RPCs went missing" line of enquiry is therefore closed on the current version: a
  subset of one message cannot be delivered. That was never our root cause, but it was one of the
  candidates.
- **The `other_established > 0` early return is unchanged**, so the actual mechanism — a second
  connection from a known `PeerId` being told nothing — still exists in 0.50.0 and on master. That
  is what [PR 6635](https://github.com/libp2p/rust-libp2p/pull/6635) makes visible.

The upgrade was driven by security, not by this bug: 0.49.3, 0.49.4 and 0.49.5/0.50.0 carry fixes
for three advisories (prune backoff `GHSA-gc42-3jg7-rxr2`, time arithmetic
`GHSA-xqmp-fxgv-xvq5`, unbounded per-peer topic growth `GHSA-g3g5-x568-qvqx`), and the seed has
8002 open to the internet. The fix for *this* post-mortem's bug was ours and shipped separately in
`25771f8`.

## Worth raising upstream — small, and not what we thought

gossipsub accepts a second connection from a `PeerId` it already knows and tells it nothing: no
warning, no event, no way for the application to learn that this connection will never receive a
subscription list. For a single-`Swarm` application that is correct and invisible. For a process
running several `Swarm`s on one identity it is a silent trap, and the failure surfaces far away —
as `InsufficientPeers` on publish, indistinguishable from the ordinary "mesh has not grafted yet"
condition that occurs briefly after any connection.

A `debug!` on the skipped advertisement would have saved days. That is an ergonomics issue, not
the protocol bug we were about to file.

## Identity inventory (read, not inferred)

What actually depends on the three planes sharing one `PeerId`:

| Thing | Keyed by | Affected by per-plane keys? |
|---|---|---|
| `WorkerRegistry` | `by_wallet: HashMap<String, _>` — wallet id | No |
| Tmail envelopes | `sender_wallet_id` / `receiver_wallet_id` | No |
| Ledger / consensus state | no `PeerId` anywhere | No |
| `TET_PEER_ID` | a **string label** for the producer/wallet id, unrelated to libp2p's `PeerId` despite the name | No |
| Block-plane internals (hello registry, bootnode watch, catch-up, blacklist) | `PeerId`, all within one plane | No |
| Published bootnode multiaddr `/p2p/<id>` | block-plane keystore banner | Must stay the block plane's |
| **`FileAnnounce.storage_node`** | a `PeerId` string, **bound into the signed envelope preimage** (`files/mod.rs:134-144`), resolved by `files_fetch` on the block plane | **Yes — must be the block-plane `PeerId`** |

So one genuine constraint, and one naming trap worth renaming some day (`TET_PEER_ID` is not a
libp2p peer id).

## Proposed durable fix — recommendation only, not implemented

Scoping the env var fixes this instance. It does not stop the next plane from being pointed at
another plane's address, because the planes remain indistinguishable on the wire.

**Derive a per-plane keypair from the node key**, e.g.
`HKDF-SHA256(ikm = node_key, info = "tet/plane/block" | "tet/plane/nexus" | "tet/plane/ledger")`,
seeding an Ed25519 key per plane. Each plane then has its own stable `PeerId`, derived from the
same persisted secret, so:

- a cross-plane dial connects as a different peer and gets a normal first-connection
  advertisement — the failure mode becomes impossible rather than merely unconfigured;
- identities stay stable across restarts, with no new key material to back up;
- `libp2p_keypair.bin` stays the single root secret.

Costs to weigh before doing it: the published bootnode multiaddr must be the block plane's (it
already is); `FileAnnounce.storage_node` must be the block-plane id, and it is **inside a
signature pre-image**, so getting it wrong invalidates envelopes rather than failing loudly; and
existing seeds change `PeerId` on any plane whose label differs from today's derivation, which
means re-publishing the multiaddr. Phase 1's genesis ceremony is the natural window.

## Timeline

| | |
|---|---|
| 2026-09-22 09:44 | Public seed provisioned; cross-region sync verified |
| 2026-09-22 ~11:00 | AT-F1 against the seed: follower-submitted transactions never settle |
| 2026-09-22 11:21 | First diagnosis — "nothing publishes to `TXS_TOPIC`". **Wrong**, grepped the topic constant rather than the `NetworkEvent` variant |
| 2026-09-22 17:24 | `/tet/v1/tx-submit` second path ships; transactions flow again |
| 2026-09-22 ~21:00 | `[P2P][diag]` added; peer record shown holding 3 of 4 topics |
| 2026-09-23 | 0.48.0 source read; `other_established` gate found; three-swarms-one-identity confirmed; scoped env fix, 10/10 |
| 2026-09-23 | Upgraded to gossipsub 0.50.0 / libp2p 0.57.0 for the three security advisories. See [Version note](#version-note--upgraded-2026-09-23) |
