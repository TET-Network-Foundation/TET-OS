# BUG: 8-hour idle causes node connection state corruption (2026-05-30 evening)

## Severity: HIGH — Phase 0 ship blocker candidate

## Symptom
After ~8 hours of continuous operation (10:29 -> 17:47 UTC), both 
nodes entered isolated state with no auto-recovery:

VPS:
- Process active (PID 69437, 7h uptime)
- Port 5010 still listening
- REST endpoint /ledger/state hangs (timeout)
- Recent logs: repeated "Failed to trigger bootstrap: No known peers"
- Bootstrap attempts every 5 min, all fail
- libp2p kademlia: no known peers internal state

Mac:
- Process active (PID 13526)
- Dial errors looping:
  - "Address already in use (os error 48)" (local TCP source port reuse)
  - "Timeout" (TCP timeout to VPS)
  - "Connection refused (os error 61)" (mdns local discovery)
- bootnode re-dial attempts every 30s, all fail
- 0 state_root mismatch (block_id V2 + snapshot fix working)

## Recovery
- VPS systemctl restart tet-core
- Mac auto-recovered after VPS restart (chain_hello reached Mac, sync resumed)

This confirms: VPS was the root cause. Once VPS restarted, libp2p
on both sides reconnected naturally. Mac dial errors were
downstream symptoms.

## Discovery context
- 2026-05-30 02:30 UTC: block_id V2 hard fork deployed
- 2026-05-30 10:29 UTC: snapshot path fix deployed + VPS restart
- 2026-05-30 10:29 -> ~14:00: 8918 blocks synced successfully
- ~14:00 onwards: VPS libp2p internal state corrupted
- 2026-05-30 17:47 UTC: discovered during morning continuation
- 2026-05-30 17:49 UTC: VPS restarted, auto-recovery confirmed

## What is NOT the cause
- Block_id V2 working: 0 state_root mismatch, 0 apply rejected
- Snapshot path fix working: snapshot inside DB dir as designed
- chain_hello periodic resend was deployed (commit 767fee9)
- Mac was healthy until VPS became unresponsive

## Root cause hypothesis
VPS libp2p connection state degrades after multi-hour uptime:
- Kademlia DHT loses all known peers
- REST API thread may have been blocked (deadlock?)
- mdns discovery polluted

## Production impact
- 8-hour uptime causes silent node isolation (REST hangs)
- Public testnet users would experience node stops working
- Manual restart required
- Phase 0 ship blocker candidate

## Required investigation (next session)
1. Why does kademlia lose all known peers after hours?
   - TET_BOOTNODES connection lifecycle?
   - Peer eviction policy?
2. Why does REST API hang while process is alive?
   - Tokio task starvation? Mutex deadlock?
3. Why does Mac get AddrInUse on outgoing dials?
   - TCP source port exhaustion?
4. Auto-recovery mechanism design:
   - Watchdog timer that restarts on REST unresponsive?
   - Auto bootstrap retry with exponential backoff?

## Workaround (Phase 0 testnet only)
systemctl restart tet-core every 4-6 hours via cron
NOT acceptable for production.

## Discovered
2026-05-30 ~17:47 UTC (19:47 CEST), morning continuation session.
