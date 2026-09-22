# Draft: rust-libp2p issue — gossipsub peer record can lose topics permanently after simultaneous dial

**Status:** draft, not yet filed. Target: https://github.com/libp2p/rust-libp2p/issues

---

## Title

gossipsub: peer's subscription set can be permanently incomplete after a simultaneous dial, making `publish` fail with `InsufficientPeers` indefinitely

## Versions

- `libp2p` 0.56, `libp2p-gossipsub` 0.48.0
- Transport: TCP + noise + yamux
- Rust 1.94, Linux 6.8 (Ubuntu 24.04) and macOS 15 (Darwin 25.3)
- Two nodes, one dialling the other as a bootnode; both also learn the peer via Kademlia and mDNS

## Summary

Gossipsub sends a peer its topic subscriptions once, when a connection to that peer is
established, and never re-sends them. When two nodes dial each other at nearly the same moment,
two connections are established and one is subsequently closed. If the `Subscribe` RPC was
delivered over the connection that closes, the surviving peer record is left with an **incomplete**
subscription set, and there is no mechanism that repairs it.

The consequence is that `Behaviour::publish` to an affected topic returns
`PublishError::InsufficientPeers` for the remaining life of the process, even though the peer is
connected, healthy, subscribed to that topic, and successfully delivering messages on other
topics in the other direction.

The failure is silent: no event, no error, and every other subsystem on that connection continues
to work.

## Observed behaviour

Instrumented at the publish failure, dumping `Behaviour::all_peers()`:

```
topic=/tet/v1/txs connected_peers=1 mesh_peers=[]
peers=[12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC on_topic=false
       topics=[/tet/v1/blocks /tet/v1/files/announce /tet/v1/tmail]]
```

The remote node subscribes to four topics unconditionally, in this order: `/tet/v1/blocks`,
`/tet/v1/txs`, `/tet/v1/tmail`, `/tet/v1/files/announce`. Three are recorded; `/tet/v1/txs` is
missing. The remote is definitely subscribed — it publishes on that topic itself, and other peers
receive those messages.

With `RUST_LOG=libp2p_gossipsub=debug` on the affected node:

```
11:14:56.019  New peer connected                      peer=12D3KooWNcdESJUC…
11:14:56.115  New peer connected                      peer=12D3KooWNcdESJUC…
11:14:56.122  SUBSCRIPTION: Adding gossip peer to topic   (x3)
11:14:56.199  SUBSCRIPTION: Adding gossip peer to topic   (x1)
```

Two connections to the same peer, 96 ms apart, then four subscription events — but only three
distinct topics end up recorded, so one of the four was a duplicate. Nothing afterwards changes
the set: no further connection, subscription or disconnection events for that peer for the rest
of the run.

`publish` then returns at `behaviour.rs:635`:

```rust
let mut peers_on_topic = self
    .connected_peers
    .iter()
    .filter(|(_, p)| p.topics.contains(&topic_hash))
    .map(|(peer_id, _)| peer_id)
    .peekable();

if peers_on_topic.peek().is_none() {
    return Err(PublishError::InsufficientPeers);
}
```

Because the early return precedes mesh, fanout, explicit-peer and flood-publish selection, none of
the usual mitigations apply — `flood_publish` is `true` (the default) and the peer is registered as
an explicit peer, and neither helps, because neither code path is reached.

## Reproduction

Not deterministic; it reproduced in roughly one run in three.

1. Two nodes, A and B, subscribed to the same four topics at startup.
2. B is configured with A as a bootnode and dials it. A independently learns B (Kademlia /
   mDNS / an inbound dial) and dials back at approximately the same moment, so two connections
   are established within ~100 ms and one is then closed.
3. After the connection settles, call `publish` on B for a topic A is subscribed to.
4. In the failing runs, `publish` returns `InsufficientPeers` and continues to do so indefinitely.
   `all_peers()` shows A present, connected, with a strict subset of its topics.

Three consecutive runs of the same binary, with identical connection and subscription event
counts in the logs: two succeeded, one failed. Restarting the affected node clears it; nothing
short of a new connection does.

## Analysis

`handle_received_subscriptions` inserts into `connected_peers[peer].topics`, which is keyed by
`PeerId` rather than by connection. Subscriptions are sent to a peer when a connection to it is
established. With two connections racing:

- each connection carries a `Subscribe` RPC for the sender's current topic set;
- the topics land in one shared per-peer record;
- when one connection closes, whatever was in flight on it is lost;
- the per-peer record is not rebuilt from the surviving connection, because gossipsub has already
  "sent subscriptions to this peer" and has no reason to send them again.

There is no periodic re-advertisement of subscriptions, and no protocol message for requesting a
peer's current set, so a record that starts incomplete stays incomplete until a new connection to
that peer is established.

Two properties make this hard to notice in practice:

1. It is one-directional. Only the node with the damaged record is affected, and only for
   publishing. The other node's record may be complete, so its own publishes land and its messages
   arrive normally — the connection looks healthy from both ends.
2. `InsufficientPeers` is indistinguishable from the ordinary "mesh has not grafted yet" condition
   that occurs briefly after any connection, so it reads as a startup race rather than a permanent
   state.

## Suggested fixes

In rough order of cost:

1. Re-send the local subscription set on `ConnectionEstablished` for a peer that is already in
   `connected_peers`, rather than only on the first connection. Cheap, and it makes the surviving
   connection self-correcting.
2. Rebuild the per-peer topic record when a connection to a peer closes while other connections to
   the same peer remain, instead of leaving a record assembled across a connection that no longer
   exists.
3. Periodically re-advertise subscriptions, as a backstop for any other way a record can drift.

## Note on reconnecting as a repair

Disconnecting the peer and letting a redial re-establish the connection does **not** repair the
record, at least not when the redial is immediate. Measured: the reconnect completes about two
seconds later and is logged as a new connection, but no `Subscribe` RPC follows it, so the
incomplete peer record survives and `publish` keeps failing. Subscriptions appear to be advertised
only on what the remote considers the first connection to a peer, and an immediate redial arrives
while the remote still holds the previous peer entry. A longer delay before redialling may behave
differently; that has not been tested.

## Workaround

Detect and repair from the application. Every 30 s, compare each bootnode's `all_peers()` topic
set against the topics that every node in the network subscribes to unconditionally. A peer
showing some of them but not all is the signature — a peer that has genuinely not subscribed yet
shows none. On detecting that, the most useful action is to log it: the condition is otherwise invisible, and
as noted above an immediate disconnect/redial does not repair the record.

Re-sending the local node's own subscriptions (`unsubscribe` followed by `subscribe`, since
`subscribe` alone is a no-op when already subscribed and emits no RPC) repairs the *remote's*
record of the local node, which is the opposite direction and does not fix publishing on the
affected node. Both halves are needed to repair both directions.

The durable mitigation at the application layer is not to depend on gossip alone for anything that
must be delivered: a direct request/response path to known peers covers the case where a peer
record is silently wrong.
