# BUG: Mac node sync catch-up not triggered (2026-05-29 evening)

## Symptom
Mac node received gossiped blocks from VPS but never catches up.
- Mac local_height stuck at 15848
- VPS height: 22300+ (growing)
- Lag: 6,000+ blocks and increasing
- Mac process eventually died (PID 45150 not found at investigation)

## Log pattern (repeating before death)
[P2P] PING OK
[P2P] STATE SYNC DETECTED: BlockMined { block_height: 22XXX }
[P2P] ORPHAN BLOCK BUFFERED ... no_source_peer
[P2P] REMOTE BLOCK SKIPPED: missing previous blocks
       height=22311 local_height=15848

## What's missing in logs
- No chain_hello received logs (compared to morning when present)
- No catch_up_triggered=true logs
- No range request logs

## Contrast with morning behavior (working)
At 06:15 UTC same scenario with lag=441 caused:
- chain_hello received from VPS height=13337
- catch_up_triggered=true
- range request 12897..12996 -> applied
- Resolved in ~2 seconds

Now (evening) the same trigger did not fire despite live PING + gossip.

## Hypothesis
1. catch-up trigger relies on chain_hello (received over a specific
   protocol), not on gossip BlockMined events
2. After long idle (~8 hours), chain_hello cycle may have stopped
3. Possible side effect of morning's multi-swarm port fix:
   - swarm A (block-plane) is now on 4001 only
   - did chain_hello protocol negotiation get disrupted somehow?
4. no_source_peer flag may indicate orphan source not being tracked
5. Mac process eventually died - secondary symptom or related?

## Impact
- VPS healthy and unaffected (mining continues, faucet works)
- Only affects 2nd node catch-up after long disconnect
- Phase 0 ship critical: real users joining after disconnect
  cannot rejoin -> must fix before public testnet

## Repro
1. Run two nodes synced
2. Wait long idle (hours)
3. Mac shows lag growing but no catch-up despite gossip
4. Eventually Mac process may die

## Discovered
2026-05-29 evening, after ~8 hour idle since morning bug fix.
