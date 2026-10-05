# Design: the block-plane loop must not block

Status: **A in progress** (2026-10-05); B and C after A has run on both seeds for a day.
Root cause of the 2026-10-03 33 h outage. See [the postmortem](./postmortems/2026-10-04-producer-wedge-33h.md).

**On the wire: nothing changes.** It's the same protocols, messages and timing.
**In consensus: nothing changes.** Block apply order is preserved: one worker, FIFO. This is
execution structure, so it lands on `main` with no genesis.

## 1. What blocks the loop today

### The deadlock (root cause, confirmed)

Three pieces of block-sync state each have their own `tokio::sync::Mutex`: the `BlockSyncBoard`,
the `SyncHelloRegistry` and the `CatchUpDriver`. They are taken in **inconsistent orders**:

| Who | Order | Where (`main` at `c940b0c`) |
|---|---|---|
| Swarm loop, catch-up tick (every 1 s) | `catch_up_driver` → `hello_registry` | `p2p.rs` `try_start_catch_up` (`:1140`), also the catch-up response paths `:1234`, `:1262`, `:1298` |
| Swarm loop, peer disconnect | `hello_registry` → `catch_up_driver` | `p2p.rs:3201` |
| Auto-mine gate (every 12 s, up to three checks per tick) | `board` → `hello_registry` → `catch_up_driver` | `sync.rs` `auto_mine_blocked_by_sync` (`:843–852`) |
| REST `/ledger/state` | `board` → `hello_registry` → `catch_up_driver` | `sync.rs` `ledger_sync_status_with_state_root` (`:804–806`), via `rest/handlers/ledger.rs:578` |

In steady state the catch-up driver is idle, so every second the loop **holds the driver and waits
for the registry**. Every 12 s the gate **holds the board and the registry and waits for the
driver**. When the two interleave, neither proceeds. Every REST call that needs sync status then
queues behind the board. A lock-free watchdog keeps running, which is why its log line was the
only sign of life for 33 h.

**Reproduced** (2026-10-05) with the real `auto_mine_blocked_by_sync` and `ledger_sync_status`, the
test taking the loop's side as `try_start_catch_up` does:

```
REPRO loop_got_registry=false gate_finished=false rest_answered=false
```

The window is microseconds per tick, which is why it is rare. The inverted orders were introduced
on 2026-05-18/19 (`6850003`, `1a8ea22`).

### Slow awaits (lag, not deadlock)

- **Block apply is awaited inline** by the loop: catch-up batches (`p2p.rs:1258`) and gossip blocks
  (`:3415`). The apply runs on `spawn_blocking`, but the loop handles no other event until it
  returns.
- **The mempool lock** is then awaited inline. The miner holds it while building a block.

## 2. Design

### A. One sync lock, never held across an await (the deadlock fix)

- Merge the registry, the catch-up driver and the board's fields into **one `SyncState` behind one
  mutex**.
- Every user locks it once, does **synchronous** work only, and releases it. Nothing `.await`s while
  holding it. The API makes that structural: `SyncState` is only reachable through
  `with_sync(|s| …)`, which takes a non-async closure.
- The gate and REST compute from a **snapshot** taken under the lock. Slow work, such as the state
  root, happens outside it, as now.
- With one lock there is no order to get wrong. This also removes a subtle inconsistency: today the
  gate can read the registry and the driver at different moments.

### B. The loop only routes

- **An apply worker** (one task, FIFO) owns block application. The loop `try_send`s blocks to it
  over a **bounded** channel. Results come back as loop events and drive the catch-up driver
  (under A's lock, briefly).
- **Backpressure, explicit:**
  - When the worker queue is full, the loop drops gossip blocks (they are re-fetchable) and counts
    each drop.
  - Catch-up does not request a new range while the queue holds more than one batch.
- **The mempool is never awaited in the loop.** Admission goes through the same worker, or a queue
  of its own.
- **Disk lookups stay on `spawn_blocking`**, but the loop spawns them and handles the result as a
  later event, never awaiting inline.

### C. A lag watchdog, not a liveness watchdog

- The beacon records **per-iteration latency** and the **apply-queue depth**.
- It warns above 5 s per iteration. It exits with status 70 past `TET_SWARM_LAG_EXIT_MS`; today's
  stall exit is kept until B lands.
- `/health/swarm` reports the 99th-percentile lag and the queue depth.

## 3. Guards (each with a negative control, per CLAUDE.md)

| Guard | Part | Negative control |
|---|---|---|
| G1 `catch_up_tick_and_sync_gate_never_deadlock`: the reproduction above, red today, green after A | A | split `SyncState` back into two mutexes → times out |
| G2 `sync_state_lock_is_never_held_across_an_await`: an `.await` inside `with_sync` does not compile | A | expose the inner mutex guard → the bad usage compiles |
| G3 `loop_keeps_draining_while_apply_is_slow`: a 10 s apply; hellos and pings are still served | B | await apply inline again → loop lag over 10 s |
| G4 `loop_keeps_draining_under_1000_queued_blocks`: hellos answered within 1 s, memory bounded | B | unbounded queue or an awaiting send → stall or growth |
| G6 `loop_drains_while_mempool_is_held` | B | await the mempool in the loop → stall |
| G5 `lag_watchdog_exits_past_threshold` | C | liveness-only watchdog → no exit on a slow loop that still ticks |

## 4. Size and order

| Part | Size | When |
|---|---|---|
| A + G1/G2 | ~150–250 lines in `sync.rs` and `p2p.rs`; ½–1 day | now; deploy and watch for a day |
| B + G3/G4/G6 | ~500–800 lines, mostly moved, in `p2p.rs`; 2–4 days | its own PR, after A is stable |
| C + G5 | ~100 lines; ½ day | its own PR, after B |
