# TET's libp2p setup, on one page

What tet-core runs today, read from the code (branch `libp2p-notes`, on top of the review stack).
Paths are in `tet-core/src/`. Anything we have not tested is listed at the end.

## Library

- **rust-libp2p 0.57.0**, with **libp2p-gossipsub 0.50.0** and libp2p-swarm 0.48.0.
- **Enabled features:** `tokio`, `tcp`, `dns`, `noise`, `yamux`, `mdns`, `ping`, `kad`,
  `gossipsub`, `identify`, `request-response`, `json`, `macros`, `autonat`, `relay`, `dcutr`.
  Separately, `libp2p-webrtc 0.10.0-alpha` (tokio).
- **Peer identities: Ed25519 only.** libp2p-identity is built with `ed25519` and no `rsa`,
  `secp256k1` or `ecdsa`. A peer with another key type can't connect; see the interop notes below.

## Three swarms in one process

| Swarm | File | Listens on (env, default) | Purpose |
|---|---|---|---|
| **Block plane** | `p2p.rs` | `TET_P2P_LISTEN`, `/ip4/0.0.0.0/tcp/4001` (the seeds and the demo set `…/tcp/8002`) | blocks, transactions, messages, chain sync. **The only one exposed on the seeds.** |
| Inference plane ("nexus") | `p2p_network.rs` | `TET_NEXUS_P2P_LISTEN`, `/ip4/0.0.0.0/tcp/4003` | AI inference requests (`nexus-inference-v1`); has the relay, AutoNAT and DCUtR |
| Ledger topic | `network.rs` | `TET_LEDGER_P2P_LISTEN`, `/ip4/0.0.0.0/tcp/4005` | one older topic, `/tet/v1/ledger` |

On the seeds and the demo, only **8002/tcp** is published (`deploy/docker-compose.seed.yml`). The
other two swarms listen inside the container and can't be reached from outside. The rest of this
page is the block plane unless it says otherwise.

## Transport, encryption, multiplexing

- **Block plane and ledger swarm:** TCP (`nodelay`) → multistream-select 1.0 (`Version::V1`) →
  **Noise** (`noise::Config::new`, XX handshake, the libp2p default) → **Yamux** (default config) →
  a 20 s upgrade timeout.
- **No QUIC, no WebSocket, and no mplex.** A peer offering only mplex is refused at muxer
  negotiation.
- **Inference plane:** TCP or a relay circuit (relay client), upgraded the same way, OR'd with
  **WebRTC-direct** over UDP. It tries to listen on the same port number as its TCP listen (or that
  plus 10,000). On the seeds that UDP port isn't published, so nothing outside can reach it.

## Behaviours on the block plane

| Behaviour | Settings |
|---|---|
| gossipsub | see below |
| identify | protocol `/ipfs/id/1.0.0`; protocol-version string `/tet/identify/1.0.0`; agent `tet-core/<version>` |
| Kademlia | `/ipfs/kad/1.0.0`, server mode, in-memory store; bootstrap re-run every 60 s (`TET_KAD_BOOTSTRAP_INTERVAL_SEC`) |
| mDNS | on (LAN discovery) |
| ping | every 10 s, 20 s timeout |
| request-response (JSON) | `/tet/v1/block-sync/json` (20 s), `/tet/v1/chain-sync/hello/json` (10 s), `/tet/v1/chain-sync/range/json`, `/tet/v1/files/fetch`, `/tet/v1/anon-register` (10 s), `/tet/v1/anon-receipt` (30 s), `/tet/v1/anon-registry-sync` |

**A bug this review found:** the transaction-submission behaviour is registered under
`/tet/v1/anon-register`, not `/tet/v1/tx-submit` (`p2p.rs`, `tx_submit_behaviour`). So two
behaviours claim one protocol, and `/tet/v1/tx-submit` is never offered. Checked from py-libp2p:
- a transaction request sent on `/tet/v1/anon-register` is answered by the transaction handler;
- `/tet/v1/tx-submit` fails to negotiate.

Direct transaction submission therefore works under the wrong name. Direct anonymity-set
registrations land on the same handler and can't be decoded, so registrations rely on gossip alone.
This is inferred from the same routing; I didn't observe it directly. It isn't fixed yet; changing
a protocol name has to reach every node together.

## Gossipsub (block plane)

- **Protocols spoken:** `/meshsub/1.3.0`, `1.2.0`, `1.1.0`, `1.0.0` and `/floodsub/1.0.0` (the
  crate's list).
- **Message signing:** `MessageAuthenticity::Signed` with the node's Ed25519 key. Message IDs use
  the default, source peer + sequence number.

| Parameter | We set | Library default |
|---|---|---|
| `validation_mode` | `Strict` | `Strict` (same) |
| `validate_messages` | **on**: each message waits for the app's accept/reject | off |
| `max_transmit_size` | **128 KiB** (`TET_P2P_GOSSIP_MAX_MSG_BYTES`, clamped 48–512 KiB) | 64 KiB |
| `mesh_n` / `mesh_n_low` / `mesh_n_high` | 6 / **4** / 12 (`TET_GOSSIP_MESH_N*`) | 6 / 5 / 12 |
| `mesh_outbound_min` | **3** (half of `mesh_n`, at most `mesh_n_low`) | 2 |
| `heartbeat_interval` | **800 ms** | 1 s |
| `max_publish_messages` | **32** | 5000 |
| peer scoring | **on**, see below | off |
| everything else | default | history 5, gossip history 3, gossip_lazy 6, gossip_factor 0.25, fanout TTL 60 s, duplicate cache 60 s, flood_publish on, PX off, prune backoff 60 s, max control message 16 KiB, initial heartbeat delay 5 s |

**Peer scoring (block plane):**
- **Per topic:** weight 1.0; invalid-message-deliveries weight −22, decay 0.88.
- **Behaviour penalty:** weight −10, threshold 1.0.
- **App-specific weight:** 12.
- **Thresholds:** gossip −6, publish −45, graylist −62 (default −80).

The inference plane uses the same scoring with app weight 14 and behaviour penalty −12. The ledger
swarm has no scoring.

## Topics

| Topic | Subscribed | Content |
|---|---|---|
| `/tet/v1/blocks` | always | `{"BlockMined": {...}}`: a block with its transactions |
| `/tet/v1/txs` | always | `{"TxBroadcast": {...}}` |
| `/tet/v1/tmail` | always | `{"TmailGossip": {...}}`: encrypted messages and board posts |
| `/tet/v1/files/announce` | always | `{"FileAnnounce": {...}}` |
| `/tet/v1/ai-workload` | only nodes that take AI work | AI workload events |
| `/tet/v1/ledger` | ledger swarm | older ledger events |
| `nexus-inference-v1` | inference plane | inference requests and proofs |

Payloads are UTF-8 JSON: serde's default "externally tagged" enum (`models.rs`, `NetworkEvent`).

## Where messages are checked

1. **In gossipsub, before forwarding:** the size cap. Then the app parses the JSON and calls
   `gossip_event_acceptance` (`p2p.rs`):
   - it rejects the obsolete `TransferExecuted` / `FaucetExecuted` events;
   - it rejects a block whose producer doesn't match the expected peer, when `TET_PRODUCER_PEERS`
     is set;
   - it accepts everything else.

   A rejection lowers the sender's score. **Accept here means "well-formed, from a plausible
   source", not "valid":** it is what lets gossipsub forward the message.
2. **After that, in the app:**
   - blocks are fully checked before they're applied (`consensus.rs`): block id, parent, each
     transaction's signatures, state root. Blocks themselves carry no producer signature yet
     (Phase 1);
   - transactions are checked on mempool admission (`tx_admissible` / `tx_affordable`);
   - messages are checked in the message store: signatures, the ±5 min clock window and
     anonymous-membership proofs.

   A message that fails here was already forwarded by gossip; it simply isn't applied or stored.

## Bootstrap and connections

- **Bootnodes:** `TET_BOOTNODES`, a comma-separated list of multiaddrs ending in `/p2p/<id>`. Dead
  bootnodes are redialled every 30 s (`TET_BOOTNODE_REDIAL_SEC`). A chain "hello" is expected
  within 10 s and re-sent every 15 s.
- **Public seeds (block plane):**
  - Helsinki `/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC`;
  - Nuremberg `/ip4/46.224.223.54/tcp/8002/p2p/12D3KooWSam648Et2FXCUrqUBM6AEoZR5GAwDnoMG77JnA3ajonM`.
- **Idle connections** close after 300 s on the block plane (`TET_IDLE_TIMEOUT_SEC`). The other
  two swarms use the library default.
- **Connection limits: none.** The `connection_limits` behaviour isn't used, so there's no cap on
  peers, on connections per peer or on pending dials. The relay server (inference plane) runs with
  the library's default reservation and circuit limits.
- **Chain sync trusts** only the configured producer peers (`SyncTrust`), not every peer.

## Interop result: py-libp2p (2026-10-12)

`tools/interop/py_libp2p_probe.py` uses py-libp2p 0.8.0 on Python 3.13, against a local tet-core.

- **Works:**
  - TCP + Noise + Yamux;
  - identify (it lists all of tet-core's protocols);
  - gossipsub negotiated at `/meshsub/1.3.0`;
  - tet-core puts the Python peer in its mesh for blocks, txs, tmail and files;
  - every block arrived, in order, signed, and parsed as JSON;
  - the same through a second tet-core node that relays the first node's blocks;
  - **a 6-minute run** (past the 300 s idle timeout): 61 blocks in a row with no gaps, all signed,
    and 12 board messages on `/tet/v1/tmail` posted during the run; still connected at the end,
    with no parse errors.
- **Fails, as configured:**
  - an RSA identity: py-libp2p sees Noise succeed, then tet-core resets the connection during
    muxer negotiation. tet-core logs only "Failed to negotiate transport protocol(s)". Our reading
    is that the RSA identity is refused in the Noise payload, because tet-core is Ed25519-only;
    this is inferred, not shown by a log line.
  - mplex only: tet-core answers `na` to `/mplex/6.7.0`.

## Not tested

- **NAT:** every node so far has a public IP or runs on one machine. AutoNAT and DCUtR are compiled
  into the inference plane but have never been used.
- **Relay:** the circuit relay v2 server runs with default limits on an unpublished port. No
  relayed connection has ever been made.
- **QUIC:** not compiled in, so nothing runs over it.
- **WebRTC-direct:** compiled in on the inference plane only; never connected from outside.
- **More than 3 nodes:** the live network is 3 nodes (two seeds and the demo), and the local tests
  use 2–3. Mesh behaviour, scoring and the 128 KiB cap haven't been tried with more peers or under
  load.
- **Other implementations** beyond py-libp2p (go-libp2p, js-libp2p): not tried.
- **Long-lived interop:** the py-libp2p run lasted 6 minutes; nothing longer.
