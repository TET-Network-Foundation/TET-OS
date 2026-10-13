# Browser nodes (Phase 8): plan

Status: **plan only, no code.** Phase 8 on the roadmap. Nothing here changes the testnet today.

## Goal

A visitor's browser runs a small TET node: it joins the network directly instead of asking one
server for everything, checks what it receives itself (as the page already does for signatures and
keys), and talks to other browsers when it can. The demo server becomes one peer among many, not
the only way in.

## Architecture (per libp2p's guide: https://libp2p.io/docs/webrtc-browser-connectivity/)

- **Browser side: js-libp2p** with `webRTC()` (browser to browser), `circuitRelayTransport()`, Noise
  and Yamux, `@chainsafe/libp2p-gossipsub`, and peer discovery over pubsub
  (`@libp2p/pubsub-peer-discovery`) or the seeds' Kademlia.
- **Seeds: circuit relay v2 as the signaling and relay point.** A browser can't accept incoming
  connections, so it reserves a slot on a seed's relay. Another browser reaches it at
  `…/p2p/<seed>/p2p-circuit/webrtc/p2p/<browser>`. The SDP offer and answer travel over that
  relayed circuit, ICE runs, and the two browsers then talk over a direct WebRTC connection. If hole
  punching fails (the guide cites about 80 % success on public networks), gossip still arrives
  through the relay and other peers.
- **How a browser reaches a seed in the first place.** Two options; the plan uses both:
  - **WebRTC-direct (UDP)** to the seeds: browsers can dial it with the certificate hash in the
    multiaddr, so no domain or CA certificate is needed. `tet-core` already builds a WebRTC-direct
    transport (`p2p_network.rs`, libp2p-webrtc 0.10-alpha) on the inference plane.
  - **Secure WebSockets** through the demo's Caddy (`wss://tetnet.org/…`), for networks that block
    UDP. Needs a CA certificate, which the demo already has.

  WebTransport is left out (not in Safari, and not served by the Rust stack the seeds run).

## What exists today (inventory, 2026-10-11)

- **Block plane** (the network the chain runs on): Rust libp2p 0.57, TCP 8002, Noise, Yamux,
  gossipsub (strict, signed), Kademlia, identify. No relay server, no browser transport.
- **Inference plane** (`p2p_network.rs`): listens on TCP and UDP 4003 inside the seed's container,
  with a WebRTC-direct listener and a **relay server with libp2p's default limits**. Port 4003 isn't
  published, so it isn't reachable from the internet. Before anything is exposed, the relay's limits
  are set explicitly (below); defaults are not a decision.

## Steps

1. **Relay on the seeds, behind a flag** (`TET_RELAY_SERVER=1`): a relay v2 server on the block
   plane's swarm, with explicit limits: reservations per peer and per IP, total reservations,
   circuit duration and bytes, and a rate limit on reservation requests. A WebRTC-direct listener
   on a published UDP port. Metrics in the health check. Off on Helsinki (the producer) at first:
   relays run on Nuremberg and the demo node, so relay load can't slow block production.
2. **A read-only browser node** in the /try page, opt-in ("connect directly"): it subscribes to the
   public topics (`/tet/v1/blocks`, `/tet/v1/tmail`), applies the same checks as a node (signatures,
   the clock rule, the producer pin) and shows what it sees beside what the server says. It sends
   nothing yet.
3. **Browser to browser:** reservations on a relay, WebRTC between browsers, gossip of public
   board posts.
4. **Sending from the browser node:** posts and messages go out over the peer network instead of
   the server's REST API.
5. **Light-client checks** of block headers once blocks carry producer signatures (Phase 1); until
   then a browser can only compare what several seeds report.

## Risks and what the plan does about them

- **IP addresses.** WebRTC shows each peer the other's IP address. Today only the server sees a
  visitor's IP; with browser-to-browser connections, other visitors would too. That matters most for
  anonymous posting. Browser-to-browser stays **off by default**, the page says what turning it on
  reveals, and anonymous posts never go out over direct browser connections, only through a relay.
- **Relay abuse.** A public relay is free bandwidth. The limits in step 1, per-IP caps, and the
  relay running on non-producing nodes bound the cost; a relay over its budget refuses new
  reservations rather than slowing down.
- **Eclipse.** A browser that only hears one seed can be shown a false picture. It connects to at
  least two seeds and compares block ids and state roots, as the operator does today.
- **Maturity.** The guide calls pubsub peer discovery not battle-tested for production use at
  scale, and the Rust WebRTC transport is alpha. Both are reasons for an opt-in, read-only start.
- **The page's own code** still has to be trusted, as today; the installable app
  (`INSTALLABLE.md`, after launch) is what removes that.

## Tests (each with a negative control)

- The relay's limits: the n+1th reservation from one peer is refused; a circuit over its byte or
  time budget is closed.
- A browser node refuses a gossiped envelope or block a node would refuse (a forged signature, a
  time off the clock, a block from an unpinned producer).
- Browser-to-browser is off unless turned on; anonymous posts never take a direct WebRTC path.

## Community

An offer was made in the libp2p Discord to run a **public test relay on our seeds** for the libp2p
community's browser-connectivity testing. If it goes ahead, it runs on Nuremberg or the demo node
(never the producer), with the limits above, its own health check, and a plain statement of what
the relay sees: connection metadata, never message contents (circuits carry encrypted libp2p
traffic).

## Open questions

1. Relay on the block plane's swarm, or a separate relay process on the same host?
2. Which UDP port for WebRTC-direct (the Hetzner firewall and ufw need it)?
3. Does the public test relay for the libp2p community go ahead, and with which limits?
