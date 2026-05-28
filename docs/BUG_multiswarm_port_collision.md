# BUG: Multi-swarm port collision breaks block sync (2026-05-28)

## Symptom
2-node sync test: Mac node (height 0) cannot catch up to VPS node
(height 102, auto-mining). Connection establishes but:
- [P2P] PING FAIL err=Ping protocol not supported
- [P2P-block] bootnode dead (no hello within timeout)
- VPS: GOSSIP PUBLISH ERROR topic=/tet/v1/blocks err=InsufficientPeers

## Root cause
tet-core runs multiple libp2p swarms on the SAME port 4001:
- p2p_network swarm: identify protocol "/nexus/1.0.0"
  (p2p_network.rs:601), NO ping, NO chain-sync protocols
- block swarm (p2p.rs): identify protocol "/tet/identify/1.0.0",
  HAS /ipfs/ping, /tet/v1/chain-sync/*, /tet/v1/block-sync/json

When a peer dials port 4001, which swarm it lands on is non-deterministic.
- First connect (11:33): landed on block swarm → chain-sync worked
  (but both height 0, so no actual sync tested)
- After VPS restart (11:52): landed on /nexus/1.0.0 swarm → no
  chain-sync protocol → bootnode declared dead → sync fails

## Impact
CRITICAL for Phase 0. Multi-node sync is unreliable. Would break
catastrophically when multiple nodes join after HN launch (matches
AI evaluation's flagged risk: "multi-node sync at scale is a
Sept-15 problem, not a future problem").

## Fix direction (Phase 0, before public testnet)
Options:
1. Separate ports per swarm (block swarm vs p2p_network swarm)
2. Unify into single swarm with all protocols
3. Proper protocol-based routing on shared port
Needs careful design with Cursor. Do NOT rush.

## Discovered
2026-05-28, during first real 2-node cross-region sync test
(Mac CH ⇄ VPS Helsinki). Found BEFORE public launch. Good.
