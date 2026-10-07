# 2026-10-03 → 10-04: the producer's block plane wedged for 32 h 53 m

**Impact.** The public testnet made no blocks from 2026-10-03 06:25 UTC to 2026-10-04 15:18 UTC.
Helsinki is the only producer, so the chain stopped at height **78479**. Nuremberg kept serving
that frozen tip. No state was lost, and no block was produced twice or forked. Transactions sent
in that window waited in mempools or failed to reach the producer.

**Detection.** The monitor went red within about a minute, and nobody saw it. healthchecks.io
emailed DOWN for both seeds on Oct 3 and UP on Oct 4. Email was the only channel to a human, and
nobody read it for 33 hours. The outage was found by accident, during an unrelated deploy, when
Nuremberg's height did not move after its upgrade.

**Recovery.** A manual redeploy of Helsinki (`c28495a`), which restarted the container. Nothing
restarted it automatically, although three mechanisms were meant to.

## Timeline (UTC)

| When | What | Source |
|---|---|---|
| 2026-09-29 20:37:59 | Helsinki's `tet-healthcheck.timer` (re)starts and runs every minute from here on | `systemctl show` |
| 2026-10-02 11:52 | One UNHEALTHY run (`health=starting`) during the Oct 2 deploy's restart, then OK again | healthcheck journal |
| 2026-10-03 **06:25:09** | Helsinki's block-plane event loop ticks for the last time. Height 78479 | `swarm-health` age on Oct 4 15:03 (117,480,999 ms) |
| 06:26:05 | Helsinki's healthcheck: `UNHEALTHY: REST /ledger/state unreachable`, then every minute after. `/fail` sent | journal; healthchecks.io DOWN email |
| 06:30:46 | Nuremberg's healthcheck: `restarted tet-core after 320s stall at height 78479`. It restarts every hour after (33 times) | journal |
| 10-03 → 10-04 | Helsinki logs `[swarm-health] … STALLED …; withholding systemd watchdog ping (unit will be restarted)` every 20 s. Nothing restarts it | `docker logs` |
| 2026-10-04 ~14:45 | Found during the deploy of #16–#18: Nuremberg's height does not move after its upgrade, and neither does Helsinki's | session |
| 15:07 | Helsinki's full `docker logs` (15.7 MB) and diagnostics saved to `/root/helsinki-wedge-20261004T1507Z.*` | |
| ~15:17 | Helsinki redeployed to `c28495a`; the container is recreated | deploy |
| 15:18:14 / 15:18:25 | First OK on Helsinki (height 78480) and Nuremberg (78481). Blocks every ~12 s again | journal; healthchecks.io UP email |

**About "UNHEALTHY since 9/29".** The healthcheck was not unhealthy since 9/29. That date is when
Helsinki's **timer unit** started (`Active: active (waiting) since Tue 2026-09-29 20:37:59`), the
first line `systemctl status` prints. Between then and the wedge the journal holds 5,853 OK runs
and one UNHEALTHY: the minute the Oct 2 deploy restarted the container (`health=starting`).
Nuremberg's timer dates from its provisioning on 09-30 10:13. Its only UNHEALTHY before the wedge
is that first run, while the container was still starting.

The dashboard and the journal agree. DOWN on Oct 3 is the first `/fail` at 06:26 (06:30 on
Nuremberg). UP on Oct 4 is the first success ping at 15:18. healthchecks.io's "1d 8h" is that
32 h 52 m.

## Three safety nets, and why each failed

### 1. The node's own watchdog: it told systemd, and nothing was listening

`ebc80d3` (2026-06-07) followed the June wedges. It added `swarm_health`: a beacon the block-plane
loop ticks, and a watchdog that **withholds systemd's `WATCHDOG=1` ping** when the loop stalls,
expecting `WatchdogSec=120` in the unit to restart the process. In September the seeds moved to
**Docker**. A container has no systemd unit and no watchdog listener, so the watchdog detected the
stall correctly and then told no one. Its log line, "unit will be restarted", was false for 33 h.

Docker's `restart: unless-stopped` restarts a container whose process **exits**. This one never
exited. Docker also does not act on a healthcheck that reports `unhealthy`.

### 2. The host healthcheck: it restarted only on a stall it could read

`deploy/seed-healthcheck.sh` restarts a producer when the height **is readable and unchanged** for
`TET_HC_STALL_SEC`. This wedge also hung `GET /ledger/state`. So each run took the
`REST /ledger/state unreachable` branch, which alerts and exits. It logged UNHEALTHY 1,866 times
and never reached the restart. The slow-stall case was covered; the hang was not.

Two more defects surfaced:

- **The installed scripts were stale.** Only `provision-seed.sh` copies the script to
  `/usr/local/bin/tet-healthcheck`. A deploy refreshes `/opt/TET-OS` but not that copy, so
  Helsinki ran a copy from 09-23 and Nuremberg one from 09-30 10:13.
- **Nuremberg's copy predates `TET_HC_ALLOW_RESTART`** (added later that day), so it ignored its
  `ALLOW_RESTART=0` and **restarted the follower 33 times**. That is the churn the setting exists
  to prevent, and it fixed nothing, because the producer was the broken node.

### 3. The human: one channel, and nobody read it

healthchecks.io did its job. It went DOWN on Oct 3 and emailed. Email was the only notification
method on both checks, and nobody read it for 33 hours. A monitor that goes red where no one is
looking does not help.

### Not a safety net: the six-hourly "seed liveness" workflow

`.github/workflows/seed-liveness.yml` passed throughout, as it should: it checks that the P2P port
**accepts a TCP connection** and that REST is **not** public. The kernel completes a TCP handshake
into the listen backlog even when the application above it is wedged. It is an exposure check, not
a liveness check, and it does not ping healthchecks.io.

## What changed

| Gap | Fix |
|---|---|
| The watchdog only spoke systemd | **#24.** Past `TET_SWARM_EXIT_AFTER_MS` (default 180 s) the watchdog logs the evidence and calls `process::exit(70)`, so Docker, systemd or anything else restarts the node. The systemd ping stays. Guard: the real watchdog loop with an injected exit hook, three negative controls |
| The healthcheck could not restart a node it could not read | **#23.** An unhealthy container or unreachable REST for `STALL_SEC` counts as a stall. A producer **saves `docker logs` to `/root/tet-wedge-<UTC>.log` first**, then restarts. Compose files follow the deploy's profile detection (the hard-coded `docker-compose.dev.yml` is gone). 8 cases, 5 negative controls |
| A flat height pinged success; rejected pings were silent; installs went stale | **#22.** Success is pinged only when the height advances. Every ping's answer is logged if it isn't `OK`. A monitor that differs from the deployed tree reports itself red. 10 cases, 5 negative controls |
| The deploy never reinstalled the monitor | The deploy command now ends with `install -m 0755 deploy/seed-healthcheck.sh /usr/local/bin/tet-healthcheck` (`RUNNING_A_NODE.md`). #22 makes a missed reinstall visible |
| Email was the only human channel | **A push channel** (Telegram, or ntfy on a phone) on both checks: `RUNNING_A_NODE.md`, *Alerts that reach a person* |

## Root cause: a lock-order deadlock (confirmed 2026-10-05)

The block-plane loop and the auto-miner **deadlocked on two mutexes taken in opposite orders**.
Every second the loop's catch-up tick (`p2p.rs` `try_start_catch_up`) holds `catch_up_driver` and
waits for `hello_registry`. Every 12 s the auto-mine sync gate (`sync.rs`
`auto_mine_blocked_by_sync`) holds the sync board and `hello_registry` and waits for
`catch_up_driver`. When the two interleave, both wait forever. REST `/ledger/state` takes the
gate's order too, so it queued behind the board and hung.

- **The timing fits.** The loop's last tick was at about 06:25:09.7, and the gate was due at about
  06:25:10.7. The loop and mining went silent at the same moment, REST hung, and only the
  lock-free watchdog kept logging.
- **Reproduced** with the real gate and status functions, the test taking the loop's side:
  `loop_got_registry=false gate_finished=false rest_answered=false`.
- **Since when:** the inverted orders came with the catch-up driver and the Phase 2A gate,
  2026-05-18/19 (`6850003`, `1a8ea22`). They predate the 2026-05-30 and 2026-06-05/06 wedges. Those
  were attributed at the time to idle connections (`BUG_long_idle_connection_failure.md`) and to
  inline ledger work (`ebc80d3`), and those fixes were real. Whether this deadlock was also behind
  them **cannot be checked now** (no logs of that kind survive). The code that could deadlock was
  present for all of them.
- **Why it was rare:** the window is microseconds per tick.

**The fix**, in [`DESIGN_accept_loop.md`](../DESIGN_accept_loop.md):
- **A:** one sync lock, never held across an await. This removes the deadlock, and its guard is
  the reproduction above.
- **B:** the loop only routes; apply moves to a worker with bounded queues.
- **C:** a watchdog that measures lag.

A ships first, on its own.

## Checked hypothesis: did losing its only peer stop the producer?

During the live negative control on 2026-10-04, Nuremberg was stopped on purpose at **20:51:01**,
and Helsinki stopped producing at **80141**. That suggested a hypothesis: the producer wedges when
its only peer disconnects, and Nuremberg's stale probe had been restarting it for days. Both logs
were read to check it.

**Today, 20:51: a different failure, and not a wedge.** Helsinki logged
`[p2p][mdns] disconnected peer_id=12D3KooWSam6…` (Nuremberg) 0.25 s after the stop, and from then
on, every 12 s:

```
[consensus] auto-mine gated: synced=false active=false lag_blocks=0 catch_up_in_progress=false
```

The event loop kept running (normal log volume, no `swarm-health STALLED`, and the 180 s self-exit
correctly did not fire), and REST answered every minute. The **sync gate** treats a producer with no
peers as unsynced and stops it mining. Helsinki is the only validator, so **a follower going down
halts the chain**. The test itself caused about **13 minutes without blocks** (80142 came at
21:03:51, after Nuremberg was started again). The new probe behaved as designed: four `WAITING`
runs, a restart at 320 s with the logs saved first (`/root/tet-wedge-20261004T205650Z.log`), then
the cooldown. A restart cannot reopen a gate that is waiting for a peer. Tracked as **#28**.

**Oct 3, 06:25: not triggered by a disconnect. Refuted.** In the saved 33 h log:

- `sync_hello peers=1` at 06:24:17, 06:24:33, 06:24:48, 06:25:04 and **06:25:07.94**. There is no
  disconnect or `ConnectionClosed` between 06:00 and 06:30.
- `auto-mined block height=78479` at 06:24:58: production was normal until the end.
- The event loop's last tick was about **06:25:09.7** (`STALLED age_ms=100999` at 06:26:50). There
  is no `auto-mine gated` line. This was a dead loop, not a closed gate.
- **Nuremberg restarted nothing before the wedge.** Since its provisioning on 09-30 its probe had
  3,863 OK runs, one UNHEALTHY (its first boot), and zero restarts. All 33 of its restarts came
  after 06:30, as a consequence of the wedge. "Restarted hourly for days" is refuted.

**A lead for the refactor design** (confirmed on 2026-10-05; see § Root cause). At the moment of the wedge the **auto-mine task went silent
too**. It logs every 12 s ("auto-mined" or "gated"), and its next line, due at about 06:25:10,
never came. Only the watchdog, which reads lock-free atomics, kept logging. The last thing the swarm
loop did was handle a `sync_hello` (`p2p.rs:1079`). That fits the swarm loop blocking while it holds
something auto-mine also needs, such as a lock on the ledger or the block-sync board. It is a lead,
not a proof, and the design item should start there.

## Lessons

- **A safety net that depends on its environment needs a test in that environment.** The watchdog
  was correct under systemd and did nothing once the deployment changed underneath it.
- **Restart on the failure you can't read, not only the one you can.** A hang that takes the
  health endpoint down with it is a wedge, not a reason to stop checking.
- **A negative control on production is itself a change to production.** Stopping the follower
  halted the chain through a dependency nobody had written down (#28). The test found it, and it
  cost 13 minutes.
- **An alert is finished when a person reads it.** The alert fired within 60 s; the human channel
  added 33 h.
