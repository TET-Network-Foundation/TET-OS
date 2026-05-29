# BUG: Chain state divergence between Mac and VPS — uncoverable fork (2026-05-29 night)

## Severity: CRITICAL — Phase 0 ship blocker

## Symptom
Mac node and VPS at SAME height 15849 but DIFFERENT state_root:
- Mac expected: 0xeb3e24e596924ae43d410cd889e2cd7b562929a17a0e3a387dc6dfc96e9d9165
- VPS provided: 0xd36df16799dd960ff143aebee193e6f1386d2fefb4f15b1d1167716480d008ff

Catch-up applies block 15849 -> state_root mismatch -> reject loop forever.
Mac stuck at height 15848, infinitely re-requesting same range, never recovers.

## Discovery context
- Morning (2026-05-29 06:15 UTC): Mac and VPS synced at height 3471, 
  state_root MATCHED
- After morning multi-swarm fix deployment, Mac kept running
- Mac SSH disconnected (TimedOut) around 06:12 UTC
- Mac continued running locally
- Throughout day (~14 hours), Mac progressed to height 15848 somehow
- Evening: 2nd node started, sync attempts fail with state_root mismatch

## How divergence happened (hypothesis)
Need investigation:
1. Did Mac receive blocks from VPS during partial connection?
2. Was Mac somehow accepting blocks via wrong path (gossip without 
   validation)?
3. Did the morning catch-up partial complete then resume with bad state?
4. Was TET_AUTO_MINE accidentally set on Mac?

Key: Mac reached height 15848 with DIFFERENT chain than VPS for the
same heights. Both consider themselves canonical.

## What's broken in current code
Even with morning's multi-swarm fix and tonight's periodic chain_hello +
blacklist TTL fixes:
- Catch-up apply correctly DETECTS state_root mismatch (good)
- But there is NO recovery mechanism (bad)
- Loop forever re-requesting same range
- No fork detection / branch reorg from this depth
- No "discard divergent chain and restart from VPS" path

## Production impact (Phase 0 ship blocker)
If real user node disconnects, somehow gets divergent state, and 
reconnects:
- Forever stuck at point of divergence
- Cannot recover without `rm -rf db/` (catastrophic for user)
- Looks like "TET network broken"
- Reputation killer in public testnet

## Required fixes (design needed)
1. Detect state_root mismatch on catch-up apply
2. Determine canonical chain (VPS's, by majority / bootnode authority)
3. Either:
   a. Discard local divergent chain back to last matching parent, OR
   b. Initiate clean re-sync from VPS, OR  
   c. Fork detection + reorg from deeper checkpoint
4. Prevent acceptance of blocks that would create divergent state in
   the first place (root prevention)

## Workaround (Phase 0 testnet)
Currently: `rm -rf /tmp/tet-mac-node && restart` is the only recovery.
Acceptable for dev test, NOT for production.

## Related
- Morning multi-swarm fix (commit 7a23ee6) — different bug
- Evening chain_hello + blacklist TTL (commit 767fee9) — partially helps
  trigger catch-up, but cannot fix state divergence

## Discovered
2026-05-29 ~22:00 CET (20:00 UTC), during second day of multi-node sync
testing. Phase 0 ship target 2026-09-15: must address before public testnet.

## Update: 2026-05-29 ~22:50 — root cause investigation (continued)

### New discoveries

1. **`/tmp/tet_ledger.json` exists** — secondary persistence layer 
   outside TET_DB_DIR=/tmp/tet-mac-node
   - 627 bytes JSON file
   - Contains balances, founder_wallet, total_supply
   - Created/updated at 22:33 (Mac restart time)
   - TET_DB_DIR appears to NOT control this file

2. **Mac startup log says `local_height=0`** (clean start)
   **BUT REST API returns `height=15848`** (divergent state)
   - Direct contradiction
   - Implies Mac loaded state from somewhere despite log saying 0

3. **Auto-mine hypothesis REJECTED**
   - All Mac sessions log: `auto-miner disabled (TET_AUTO_MINE unset)`
   - `local-wallet: 1,580 TET` is from VPS's mining (producer_id is
     "local-wallet" for VPS auto-mine), observed by Mac via gossip
   - Mac never mined locally

4. **lsof /tmp/tet_ledger.json returns nothing**
   - File is not currently held by any process
   - Suggests load-at-startup + save-at-shutdown pattern
   - Divergent state may have been written by previous Mac session

### Refined hypothesis

The chain state divergence likely involves:
- A persistence path (`/tmp/tet_ledger.json` or similar) that is NOT
  controlled by `TET_DB_DIR` environment variable
- Mac loads state from this uncontrolled path on startup
- "Clean DB" via `rm -rf /tmp/tet-mac-node` is INSUFFICIENT because
  this path is not cleared
- Therefore Mac always resumes from prior (possibly corrupted) state

### Required investigation (next session, fresh)

1. Find ALL persistence paths in tet-core:
   - DB (rocksdb / sled?) under TET_DB_DIR
   - JSON ledger (/tmp/tet_ledger.json?)
   - Any other files

2. Understand which is canonical:
   - Why does Mac log `local_height=0` but REST returns 15848?
   - Is there a load order mismatch?

3. Determine cleanup procedure:
   - What files to delete for true "clean state"?

4. Design fix:
   - Either consolidate to single persistence layer, OR
   - Ensure all persistence paths respect TET_DB_DIR

### Phase 0 ship implication

This is more than a 2-node sync bug. It's a **state management 
architecture issue**. Multiple persistence paths with inconsistent
control surfaces is a design smell that will cause unpredictable
behavior at scale.

Must address before public testnet.
