# Item 4 — `FileAnnounce.storage_node` is never a `PeerId`

Open question from queue item 4 (per-plane libp2p keypairs). Written 2026-10-04 by the unattended
session that built the item on `phase1-item-4-per-plane-keys`. The per-plane keys and the
`TET_NODE_LABEL` rename are implemented; **this one part of the row is not**, because the code
does not match what the spec assumes about it.

## What the spec says

`PHASE_1_GENESIS_SPEC.md` §2.4, cost 1:

> `FileAnnounce.storage_node` must remain the block-plane `PeerId`. It is a `PeerId` string that
> `files_fetch` resolves on the block plane, and it is bound into the signed envelope pre-image.
> Deriving it from the wrong plane does not fail loudly — it invalidates envelopes at
> signature-verification time, far from the cause. Whatever populates that field must be pinned
> to the block-plane identity explicitly, with a test.

The queue row: "`FileAnnounce.storage_node` pinned to the block plane with a test".

## What the code does

Nothing populates the field with a `PeerId`.

| Where | What it puts in `storage_node` |
|---|---|
| `tet-network/ui/app/lib/files.ts:196` (the only real client) | `opts.storageNode ?? "local"`; no caller passes `storageNode` |
| `tet-network/ui/scripts/files_interop_step3.mjs`, `step4.mjs` | `"local"` |
| `tet-core/src/rest/handlers/files.rs` (`POST /files/upload`) | takes the signed envelope as given; no form check |
| `tet-core/src/p2p.rs:2392` (`files_fetch`) | `parse::<PeerId>()` fails on `"local"`, so it falls back to the **first connected block-plane peer** |
| any REST route | none exposes the node's `PeerId`, so a client could not fill the field if it wanted to |

So the cross-plane failure cost 1 warns about cannot happen today. The field is never a `PeerId`,
on any plane. Integrity does not depend on it: the fetched body is checked against the signed
`file_sha256` and `file_size` before it is served or cached (`files.rs`, `fetch_blob_from_peer`).
What does depend on it is **availability**. With more than a handful of peers, "ask the first
connected peer" usually asks a node that does not hold the blob. It answers `found=false` and the
receiver gets a 404.

## What this branch does about it

- `PlaneKeys::storage_node_peer_id()` returns the block-plane `PeerId`. The guard
  `storage_node_is_the_block_plane_peer_id` pins it, so if the field is ever wired, the identity it
  should carry is already fixed and tested. `main.rs` logs it at startup (`storage_node=`).
- Nothing reads it. No client, envelope, or upload check changes.

## Options

**A. Keep `storage_node` opaque, and say so.** Leave `"local"`. At the ceremony, either drop the
field from the envelope (the pre-image changes in Rust, TS and both interop scripts) or document it
as an opaque hint. Fetch keeps asking connected peers, and the sha256 check keeps it safe.
- Cost: availability gets worse as the network grows. Item 4's `storage_node` clause becomes moot.
  The helper and its guard can stay as documentation, or go.
- Privacy: nothing new is replicated.

**B. Wire it to the block-plane `PeerId`.** The node exposes `storage_node_peer_id()` over REST
(for example in an upload preflight). The client signs it into the envelope. `POST /files/upload`
refuses an envelope whose `storage_node` is not this node's block-plane `PeerId`, which is where
the pin becomes loud. `files_fetch` targets that peer, and could later dial it through Kademlia
when it is not connected.
- Cost: a REST route, a UI change, an extra round trip before signing, and an upload refusal that
  needs its own guard and negative control. Files are off-chain, so none of this is genesis-bound.
  It could land at any time, not only at the ceremony.
- Privacy (**the reason this is a question, not a fix**): the envelope is gossiped to every block-plane
  peer, and it already names `sender_wallet_id`. Adding the uploading node's `PeerId` links that
  wallet to a specific machine. For a user who runs their own node, which is the deployment
  the project encourages, that is the user's network address. Under "TET only proves, never
  stores", ask what an observer holding every announce can recover. With B, the answer includes
  wallet → node → IP. Today it does not.

**C. Have the node fill it in.** Not possible: the field is inside the client-signed pre-image.

## Recommendation

**A**, unless availability across many nodes is needed before Phase 2. The privacy cost of B falls
on exactly the users the design principle protects, while A's cost is availability, and the sha256
check already makes A safe. If availability is needed, a better route than B is probably a
fetch that asks the receiver's peers in turn (or a Kademlia provider record keyed by `file_id`).
Either answers "who has this blob" without putting a machine identity into a gossiped, signed
envelope. That is a separate item.

Either way, the queue row's "`storage_node` pinned to the block plane with a test" should be
reworded once this is decided. As written, it describes a field that does not exist in the form it
assumes.
