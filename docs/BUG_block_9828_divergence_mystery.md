# BUG: Block 9828 state_root divergence mystery (2026-05-30 evening)

## Severity: HIGH — unexplained consensus divergence

## Symptom
After all morning + evening fixes deployed (block_id V2, snapshot path,
8-hour idle, REST hang), Mac genesis re-sync against VPS hit state_root
mismatch at exactly block 9828:

  block_id (SAME): 0x408fe2f1d278b89c072543483c6127cc47db51e673d46ac8c1ee97226d2e180a
  Mac computed:    0x37b7d643020a0f28cfd62a6a4bf291c799e2f7293d2d638906134c80493a83dc
  VPS sent:        0x49f4e6b87d55aa7e1a50ab3a5aa671167e78e083e63841bc422ca26abb9020df

Mac apply rejected, infinite loop on block 9828.

## What we ruled OUT

### TET_AI_BURN_WALLET env mismatch (Cursor's primary hypothesis)
- VPS env (systemd): TET_AI_BURN_WALLET NOT set → default "tet-api-pool"
- Mac env (launch command): TET_AI_BURN_WALLET NOT set → default "tet-api-pool"
- BOTH use default. Mismatch ruled out.

### Other env values
- TET_TREASURY_ADDRESS: both = ...0099 ✅
- TET_GENESIS_FOUNDER_WALLET_ID: both = ...0098 ✅
- TET_AUTO_MINE: only VPS (correct, only producer)
- TET_BLOCK_TIME_SEC: only VPS (correct, only producer)

### compute_state_root determinism (Cursor confirmed)
- ledger.rs:1279-1308 explicitly sorts rows before hash
- No HashMap, no time, no thread scheduling dependence
- Deterministic given identical inputs

## What we DON'T know

What caused the actual divergence at block 9828?
Possible candidates (to investigate next session):

1. Faucet credit transactions
   - Morning: faucet test produced credits at block ~9968 (after 9828)
   - Evening: faucet re-enable at block ~9967 (after 9828)
   - Both AFTER 9828, unlikely to cause divergence at 9828

2. Mining sequence specifics
   - Block 9828 mined ~02:30 UTC during block_id V2 hard fork session
   - Possibly during VPS chain reset + first mining after binary swap
   - State at moment of mine could have had some Mac-side discrepancy
     (Mac was offline at that point, didn't observe directly)

3. Race condition during sync
   - Mac's genesis re-sync received block 9828 via catch-up range
   - Possibly applied with slightly different state than VPS's local state
   - Mechanism unclear

## Recovery
Full chain reset (VPS DB + Mac DB) → both fresh from genesis → re-sync
succeeded at block 97+ with 0 errors. The divergence does NOT
reproduce on fresh chain.

## Implication
- This was a ONE-TIME divergence during yesterday's chaotic
  multi-fix sprint (block_id V2 + snapshot fix + idle fix + REST fix
  + multiple DB resets within hours)
- Cannot reliably reproduce
- Root cause unknown
- Phase 0 ship should not depend on this being fixed; recommend
  forensic deep-dive in next session for Phase 1 mainnet safety

## Next investigation
1. Examine block 9828's tx content (if VPS DB before reset had it)
2. Review consensus apply path for non-determinism not covered by
   Cursor's prior analysis
3. Consider replay test: run two nodes in lockstep, look for state
   divergence under load
4. Consider adding state_root checkpoint validation at each block
   (not just at tip) so divergence is caught earlier

## Discovered
2026-05-30 ~19:30 UTC, immediately after REST hang fix deploy.
Recovery via full chain reset confirmed clean sync.
