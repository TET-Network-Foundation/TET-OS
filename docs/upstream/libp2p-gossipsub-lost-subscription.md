# Draft: rust-libp2p issue — gossipsub peer record can lose topics permanently after simultaneous dial

**Status:** draft, **not** filed, and probably should not be filed in this form. Candidate 1 below
is an application-architecture fault, not a libp2p defect, and it currently explains the evidence
better than anything upstream. Resolve that before considering an issue.

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

## What the 0.48.0 source actually does

Read from the vendored crate, `libp2p-gossipsub-0.48.0/src/behaviour.rs`.

**Subscriptions are sent as one RPC per topic, not one RPC for all of them.**
`on_connection_established` ends with (`behaviour.rs:2926-2930`):

```rust
tracing::debug!(peer=%peer_id, "New peer connected");
// We need to send our subscriptions to the newly-connected node.
for topic_hash in self.mesh.clone().into_keys() {
    self.send_message(peer_id, RpcOut::Subscribe(topic_hash));
}
```

Two details follow from this:

1. The loop iterates `self.mesh`, not a set of subscribed topics. A topic that is subscribed but
   momentarily absent from the mesh is not advertised to a peer connecting at that instant.
2. Each topic is a separate `RpcOut::Subscribe`, so a subset can be delivered. `send_message`
   (`behaviour.rs:2828-2847`) returns `false` and **drops** the RPC when the peer's send queue is
   full, logging `Send Queue full. Could not send ...` at warn level. `RpcOut::Subscribe` goes to
   the priority queue (`rpc.rs:86-96`), which is a bounded `try_send`.

**Advertisement is gated on the first connection only** (`behaviour.rs:2912-2914`):

```rust
if other_established > 0 {
    return; // Not our first connection to this peer, hence nothing to do.
}
```

`subscribe()` separately sends one `RpcOut::Subscribe` per topic to every already-connected peer
(`behaviour.rs:542-546`), so subscribing after a connection exists does reach that peer.

### Correction to an earlier reading of these logs

The `New peer connected` line is emitted *after* the `other_established > 0` early return, so it
appears only on a first connection to a peer. Two such lines for the same peer therefore do **not**
indicate two simultaneous connections — they indicate the peer was fully disconnected and then
reconnected. The earlier framing of this report as a simultaneous-dial race was wrong on that
point; what the logs show is connect → subscriptions → full disconnect → reconnect → subscriptions,
with the resulting record still incomplete.

### What is not yet explained

The queue-full path is ruled out for the observed failure: no `Send Queue full` warning appears
anywhere in the captured logs, at a log level that would have shown it. So a subset of the
per-topic `Subscribe` RPCs went missing without the one code path that is documented to drop them
having fired.

That leaves the mechanism open. Candidates, in current order of likelihood:

**1. Multiple `Swarm` instances in one process sharing a single `PeerId` and connecting to the
same remote listener.** This is an application-architecture candidate, not a libp2p defect, and it
now looks like the leading explanation for the reporting application. That application runs three
separate `Swarm`s — a block plane, an inference plane and a ledger plane — all built from the
**same identity keypair**, and at least two of them dial the *same* bootnode multiaddr, i.e. the
same remote TCP listener.

From the remote's single gossipsub `Behaviour`, those arrive as two connections from one `PeerId`.
The first gets `other_established == 0` and is advertised to; the second hits the early return at
`behaviour.rs:2912` and is told nothing. Locally, though, those two connections belong to two
*different* `Behaviour` instances, and whichever one owns the connection the remote treated as
"second" never receives the subscription list at all. If that is the block plane, publishing on
its topics fails exactly as described, permanently, and intermittently — depending on which
swarm's dial lands first.

Consistent with: the ~1-in-3 failure rate; the partial or empty topic set; and connect/disconnect
churn observed between the two nodes. Not yet proven. The decisive test is to stop the secondary
swarms dialling the block-plane address, or give each swarm its own keypair, and re-run.

**2. Connection churn from an empty mesh.** With every peer registered as a gossipsub *explicit*
peer, `get_random_peers` excludes them and the mesh stays empty for every topic. Since 0.31.0 only
mesh peers are kept alive, so nothing holds the connection open and the swarm's
`idle_connection_timeout` may close it, producing the disconnect/reconnect churn seen in the logs.
The reporting application's timeout is 300 s, which does not obviously match the sub-second
intervals between some events, and the observed disconnect causes are a mix of `IO(Custom { .. })`
and `None` — so this is plausible for the churn but not yet tied to the lost subscriptions.

**3.** A topic subscribed but absent from `self.mesh` at the moment a peer connects, so the loop
at `behaviour.rs:2928` never advertises it. Note that `unsubscribe()` removes the mesh entry
(`behaviour.rs:1140`), so an application that "repairs" by unsubscribe+resubscribe opens this
window itself.

**4.** `handle_received_subscriptions` discarding a subscription that arrives while the sending
peer is not in `connected_peers`.

**5.** RPCs lost in the connection handler after `send_message` returned `true`.

This report should not assert a mechanism until one of these is demonstrated. The observations
above are reproducible; the cause is not yet established.

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
