# Sprint Plan — Phase 0

**Status:** **Canonical.** This file is the single source of truth for sprint numbering and sprint status.
**Baseline:** 2026-05-18 (v1) · **Renumbered:** 2026-09-17 (v2)
**Canonical node:** `tet-core/`
**Detailed work breakdowns:** [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) §B.1 — that document holds the *contents* of each sprint; this one holds the *numbering and status*. Where they disagree, this file wins.

---

## History

Two numbering schemes ran in parallel from 2026-05-18: an infrastructure track in this file (S1–S6: block sync → consensus → ZK wiring → incentive layer → inference mock → docs) and a Sovereign OS product track in the spec — the two agreed on S1–S2, diverged at S3, and the daily logs followed the *spec*, so the spec's numbering is adopted here as canonical and this file's original S3–S6 scope is preserved below under [Superseded scope](#superseded-scope).

**Reading older documents:**

| If a document says | Written | It means |
|---|---|---|
| Sprint 1, Sprint 2 | any date | Same as canonical S1, S2 — no change |
| Sprint 3 in `DAILY_LOG_*`, spec, `UI_STATUS_PHASE0.md` | 2026-05-19+ | Canonical **S3** (UI Send Coins / genesis / sync) |
| Sprint 3–6 in **this file, v1 only** | 2026-05-18 | **Superseded.** ZK wiring / incentive layer / inference mock / docs — never executed under those numbers. See [Superseded scope](#superseded-scope) |
| "Sprint 4" in `DAILY_LOG_2026-05-28` … `05-31` ("Sprint 4 Day 2–5") | 2026-05-28+ | Canonical **S4** — L1 Foundation |
| "was Sprint 4 / was Sprint 5 / was Sprint 7" in spec §B.1.2–B.1.4 | 2026-05-19 | Spec-internal shift when S4 = L1 Foundation was inserted. Already absorbed into canonical numbering below |

---

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Complete and verified end-to-end |
| 🟡 | Partially delivered; named gaps remain |
| 🔁 | Was complete, now needs redoing (environment lost) |
| ⬜ | Open — not started |

---

## Canonical sprint table

| Sprint | Scope | Status | Evidence |
|---|---|---|---|
| **S1** | Block sync MVP — pull-based catch-up, 3-node E2E | ✅ | `7264191`, `499bb00`; `DAILY_LOG_2026-05-19` |
| **S2** | Consensus hardening + economics — validator set, leader-only mine, parent metadata, Treasury 25/50/25, ZK-Court §14.1 | ✅ | `5382397`, `68a4b94` |
| **S3** | UI Send Coins — genesis hash sync, sync status, hybrid-signed transfer; consensus-grade refactor | ✅ | `aad734c`…`d157c77`, `df59517`, `8f52db7`, `2ce9024`; `DAILY_LOG_2026-05-20`, `05-31` |
| **S4** | **L1 Foundation** — public seed, faucet, Docker (node + UI), CI/CD, operator docs, monitoring | 🟡 | **All six exit criteria pass.** Public seed ✅, faucet ✅, CI ✅, Docker ✅. AT-F1 passes on the follower path (2026-09-23): a follower can join, read, verify **and send money**. Open: monitoring. Tx gossip resolved 2026-09-23; the production (zk) image builds again since `2f3d267`. See [S4 detail](#s4--l1-foundation-detail) |
| **S5** | Tmail protocol — `/tet/v1/tmail` gossip, `TmailEnvelopeV1`, REST, store | ✅ *(fee/audit deferred)* | `9e9a4a7`, `4d3fc72` |
| **S6** | Win95 shell + Basic Tmail UI | 🟡 | `1d3173f`, `356df5e`, `ad3fb3f`, `a3f2720`…`31299c3`. E2EE verified cross-region (CH→FI, 1.3 s). Shell is **tabbed**, not a window manager — no taskbar, no boot sequence, no sounds |
| **S7** | Time-lock + Burn + Pin stake | 🟡 | **Ordered and scoped 2026-09-23** (burn → time-lock → pin). Burn and time-lock are consensus-free and ship in Phase 0; **Pin is deferred to Phase 1** — see [S7 detail](#s7--time-lock--burn--pin-detail). Gates marketing (locked decision #6, AT-3/AT-4) |
| **S8** | Anonymous Mode — RISC0 guest, escrow, anchor audit | ⬜ | **Critical path.** Gates marketing (AT-5). Risk R1: never ship placeholder UI |
| **S9** | Files — upload, libp2p fetch codec, on-chain fee | ✅ | `dbfa7ab`, `bd98cdc`, `ed9b9bc` |
| **S10** | Mini-apps — Calculator, Clock, Notes | ⬜ | AT-8 |
| **S11** | QA matrix, public testnet smoke, ship candidate | ⬜ | AT-0…AT-9 |

**Out-of-band:** Phase 0.5 Mining UI / Worker registration scaffold landed early (`ff6f7be`, 2026-06-12) ahead of its Phase 0.5 slot.

**Ordering violation on record:** spec risk **R8** required that S5 not start until S4's AT-F1 passed. S5, S6, and S9 were built anyway. That produced three verified features but left the Foundation gate unclosed — which is why S4 is still the blocker below.

---

## S4 — L1 Foundation (detail)

**Why it gates everything:** without it, Phase 0 ships as a UI against a chain no external builder can join.

| Work item | Est. | Status | Note |
|---|---|---|---|
| **Public seed (1×)** | 3 d | ✅ **done** | **2026-09-22.** Helsinki rebuilt on Ubuntu 24.04.3 and provisioned by `deploy/provision-seed.sh`: Docker from the signed apt repo, 4 GB swap, ufw 22+8002/tcp, `docker compose up -d tet-core`. Not systemd this time — compose `restart: unless-stopped` plus the container healthcheck. Multiaddr published in `RUNNING_A_NODE.md` § The public seed. REST is loopback-only and the seed runs no UI, so `8002/tcp` is its entire internet surface |
| **Faucet** — 100 TET/day/IP | 3 d | ✅ **done, by another route** | **2026-09-21.** `POST /ledger/faucet` and `POST /faucet` stay removed (`c2416dc`: direct balance write, forked `state_root`). The public path is the consensus-safe welcome airdrop, `POST /ledger/initial_airdrop/claim` — hybrid-signed, mempool-routed, 1,000 TET, one per wallet, cap 10,000, **no admin token**. Round-trip verified: wallet → claim → 1,000 TET after one block. Driver: `tet-cli faucet claim`. Docs: `RUNNING_A_NODE.md` § Getting testnet TET. **Not** 100 TET/day/IP — a different, better-shaped grant; no UI button yet |
| **Docker (node + UI)** | 4 d | ✅ **both images build** | **2026-09-21** (`e9c8aae`). Compose brings up `tet-core` + `ui`; PQC WASM baked into the UI image; healthchecks on both, `ui` gated on `tet-core` healthy. `docker-compose.dev.yml` is the ~10-min quickstart. **2026-09-22, found:** the base file's production default (`RISC0_SKIP_BUILD=0`, `--features zk-prove`) did not build at all — `Dockerfile:22` ran `cargo risczero install`, which RISC Zero removed in favour of `rzup`, and the step exited 1 with `Error: Run \`rzup install\` instead`. Nothing caught it because CI passes `RISC0_SKIP_BUILD=1` on every job, so that path had never been built by anything. **2026-09-22, fixed (`2f3d267`):** the Dockerfile installs the toolchain via `rzup`, and `.github/workflows/zk-image.yml` builds the zk image on `workflow_dispatch` plus a monthly cron so the path cannot rot silently again. Verified green: run **35789136013**, `success`, 25m8s, 2026-09-22T21:51:53Z. **x86_64 only** — `rzup` has no linux/aarch64 build. The seed still runs quickstart by choice (it needs no prover). Images 197 MB (node, quickstart) / 343 MB (UI) |
| **CI/CD (GitHub Actions)** | 2 d | ✅ **done** | **2026-09-21** (`a914316`). Four jobs — `rust` (build + 185 tests + 6 named security guards + 4 block-9828 pins), `ui`, `wasm`, `docker`. Green on `main`. Clippy runs non-blocking until the 37 existing warnings are cleared |
| **Public operator docs** | 2 d | 🟡 **partly done** | **2026-09-21:** the Docker section is rewritten against real output (Quickstart / Production split, `docker-compose.dev.yml`), and § Getting testnet TET is new. **2026-09-22:** § Joining the public testnet seed, § The public seed, and the tx-gossip limitation are new and written against the verified run. Still stale elsewhere: the doc is dated 2026-05-19 and predates the 4001/4003/4005 port split, the watchdog, `/health/swarm`, the `block_id` V2 fork, Tmail and Files |
| **Monitoring + logs** | 2 d | ⬜ open | JSON tracing, `/metrics`, `/health/swarm`, systemd watchdog and `observability/{prometheus,grafana}` scaffolding all exist. No dashboards, no alerting, no SLOs |
| **Tx delivery** | — | ✅ **done** | **2026-09-22.** Four defects, found in this order. (1) **One-shot publish** — never retried, so a tx submitted before the mesh grafted was stranded. *Fixed:* locally-submitted txs re-publish every `TET_TX_REBROADCAST_SEC` (15 s) up to `TET_TX_REBROADCAST_MAX` (20). (2) **Receive path weaker than REST** — skipped `is_tx_applied` and bypassed every mempool cap via a raw `mp.push()`. *Fixed:* both paths run `p2p::handle_tx_broadcast` → `enqueue_into_mempool`. (3) **Lost gossipsub subscriptions** — the real blocker; see [root cause](#tx-gossip-root-cause-found-2026-09-22). Not fixed in gossipsub: it is unobservable from the application and has no retry. (4) **Transactions had only one delivery path.** *Fixed:* `/tet/v1/tx-submit`, a request/response protocol giving txs the same shape blocks have had since S1 — gossip for fan-out, a direct request to bootnodes as the path that still works when gossip does not. Same verification, dedup and caps as gossip; per-peer rate limit `TET_TX_SUBMIT_RPS` (10/s). Seven named CI guards |

### S4 exit criteria (the Foundation gate)

**Updated 2026-09-22 (second pass).** Five of six pass. The seed closed criteria 1, 3 and 5.
Criterion 6 is half-open: AT-F1 completes with transactions submitted to the seed, but a follower
still cannot get its own transactions mined.

| # | Criterion | State | Evidence / what is left |
|---|---|---|---|
| 1 | ≥1 public seed reachable from the internet, **multiaddr documented in a tracked file** | ✅ | `/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC`, in `RUNNING_A_NODE.md` § The public seed. Reachability verified from outside the host: `8002/tcp` open, `5010` and `3000` not reachable |
| 2 | Faucet funds a test wallet with **no admin token**; curl or UI path documented | ✅ | `POST /ledger/initial_airdrop/claim`, hybrid-signed, no token. Verified 0 → 1,000 TET after one block. Documented in `RUNNING_A_NODE.md` § Getting testnet TET. Caveat: **CLI path only, no UI button** |
| 3 | Fresh machine: `docker compose up` → **node + UI** against the public seed, no local genesis hack | ✅ | **2026-09-22.** Fresh volume, `TET_BOOTNODES` = the seed, node + UI up; UI served 200 and proxied `/tet-node-api/status` to the node. No genesis hack — the committed compose defaults are what the seed runs |
| 4 | CI green on the default branch | ✅ | Run 35547793730 on `main`, all jobs green (`a914316`) |
| 5 | A builder follows `RUNNING_A_NODE.md` and joins the testnet in under 30 minutes | ✅ | § Joining the public testnet seed is three `.env` lines plus one compose command, written against the run that produced criterion 3. Sync landed within one block interval of container start |
| 6 | **AT-F1** end-to-end: clean laptop → join seed → faucet → `GET /ledger/me` → send 1 TET | ✅ | **2026-09-23, re-run on the follower path.** Join ✅. Claim via the follower → 1,000 TET ✅. **Send 1 TET *from the follower*** → settled in ~10 s, sender 999.0 / recipient 0.99 after the 1% fee, **identical on both nodes** ✅. Guarded by `at_f1_follower_sends_money_and_producer_settles_it`. **The earlier 2026-09-22 pass was seed-submitted** and therefore did not exercise the follower path at all — `/ledger/transfer` admitted the tx and announced it to nobody (`ceb03f8`). A follower could accept a signed transfer, return `202`, and never send it anywhere |

**So: monitoring is the only remaining ⬜, and all six exit criteria pass.** The gate is closed on
function; it is not closed on operability.

The lesson worth keeping is about redundancy, not about gossipsub. Blocks survived a silently
broken mesh for an unknown length of time because they have had two independent delivery paths
since S1 — gossip and the pull-based catch-up RPC. Transactions had one, so the first defect in it
made them undeliverable with no symptom beyond `"status":"pending"` forever. The fix that mattered
was not repairing gossip but giving transactions the second path.

### Tx gossip: resolved 2026-09-23

Root cause was **ours, not libp2p's**: three `Swarm`s built from one identity keypair, two of them
dialling the same remote listener, so the seed's gossipsub told the second connection nothing
(`other_established > 0` early return) while locally that connection belonged to a different
`Behaviour` which was therefore left with no record of the seed's subscriptions.

Fixed by scoping the inference plane to `TET_NEXUS_BOOTNODES` (empty by default). Ten consecutive
fresh-container joins: gossip publish 10/10 after, 0/3 before; one connection instead of two; no
churn.

Full write-up, including the identity inventory and a recommended per-plane-keypair fix:
[`docs/postmortems/2026-09-gossip-lost-subscriptions.md`](./postmortems/2026-09-gossip-lost-subscriptions.md).



## S7 — Time-lock + Burn + Pin (detail)

**Ordering decided 2026-09-23: burn-after-read → time-lock → pin.** The order follows how much
consensus each feature touches, which is not the order the spec presents them in.

| # | Item | Consensus? | Status | Ships in |
|---|---|---|---|---|
| **S7-1** | Burn-after-read (AT-4) | No | ✅ | Phase 0 — [live evidence](#s7-1-at-4-verified-live-2026-09-23) |
| **S7-2** | Time-lock (AT-3) | No | ✅ | Phase 0 — [detail](#s7-2-scheduled-release-2026-09-23); **AT-3 passes seed↔follower** |
| **S7-0** | Server-side 5-message retention | No | ✅ | Phase 0 — [detail](#s7-0-retention-is-a-store-rule-now-2026-09-23) |
| **S7-3** | Pin stake (AT-7) | **Yes** | ⛔ **deferred** | **Phase 1 genesis** |

### S7-1: AT-4 verified live, 2026-09-23

**Two local nodes on the S7-1 binary, real libp2p gossip, 19/19 steps green.** Driver:
`tet-network/ui/scripts/tmail_burn_interop_step5.mjs` (`N1_URL`/`N2_URL`), which replicates the
browser's crypto exactly as `tmail_interop_step4.mjs` does — same Ed25519 + ML-DSA-44 signing, same
X25519 + Kyber-768 E2EE, same §A.1.3 / §A.3.2 pre-images.

| Step | Result |
|---|---|
| Envelope with `burn_after_read=1` accepted | `202` on N1 |
| Reaches N2 over gossip, flag intact | **1–2 ms**, `flags.burn_after_read=true` on the wire |
| B decrypts on N2 before burning | plaintext matches — it was genuinely readable |
| B posts `/tmail/read-receipt` | `202`, body carries the locked §A.3.2 copy |
| **AT-4: ciphertext gone from BOTH stores** | **1 ms** (second run; 508 ms on the first) |
| Re-submitting the burned envelope | `409`, tombstone holds, stays gone |
| Sender may burn what they sent | `202`, both nodes cleared |

Three live controls, so the run measures the burn and not merely that messages vanish:

| Control | Result |
|---|---|
| Read receipt on a **non-burn** message | `403 not burn-after-read`; message survives on both |
| Read receipt from a **third party** | `403 neither the sender nor the receiver`; survives on both |
| Plain message through the identical run | present on both nodes throughout |

**Mixed-version finding — the seed must be redeployed before burn is usable.** Probed against the
live seed and a local pre-S7-1 container:

| Behaviour on a node that has **not** been upgraded | Observed |
|---|---|
| `POST /tmail/read-receipt` | **404** — the route does not exist (verified on the Helsinki seed) |
| `POST /tmail/send` with `burn_after_read=1` | **400** `only the basic flag is supported in this build` — rejected at the flag gate, so it is never stored and never relayed |
| Receiving a `tmail_burn_revoke_v1` over gossip | `NetworkEvent` fails to deserialize → `p2p.rs:2907` reports `MessageAcceptance::Reject` to gossipsub |

The third row is the one worth acting on. `Reject` is not a silent ignore: gossipsub applies an
invalid-message penalty to the **propagation source**, so a new node publishing revokes into a
mixed network takes a peer-score hit from every old node that sees them. Nothing forks — Tmail is
off-ledger — but burn-after-read does not function across versions and emitting revokes before the
upgrade is actively counterproductive. The seed is the only block producer and the main gossip hub,
so it upgrades first.

### Seed redeployed to the S7-1 binary, 2026-09-23

Helsinki seed moved from the pre-S7-1 image to `2e14629`. Source shipped by the documented
`git archive HEAD | tar -x -C /opt/TET-OS` path (the seed is not a git checkout), then
`docker compose -f docker-compose.yml -f docker-compose.dev.yml -f deploy/docker-compose.seed.yml`
**build first, recreate second** — the old container kept producing blocks for the whole build, so
downtime was the container restart alone, not the ~6 min compile.

| Check | Before | After |
|---|---|---|
| **PeerId** | `12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC` | **identical** — the published multiaddr in `RUNNING_A_NODE.md` still resolves |
| Height | 10732 → 10802 at swap | 10804 and advancing — no reset |
| Block 10732 `block_id` | `0x10feee93…b15031` | **identical** |
| Block 10732 `state_root` | `0x97902ea4…679fba` | **identical** |
| `POST /tmail/read-receipt` | `404` (route absent) | `422` (route live) |

The data volume `tet-os_tet_core_data` was never touched, which is why the node kept its libp2p
identity and its chain.

**Verified on the deployed binary** (`tmail_burn_interop_step5.mjs` over an SSH tunnel to the
loopback REST): 19/19 green — burn envelope accepted, read receipt `202` carrying the locked
§A.3.2 copy, ciphertext gone, re-submission `409`, and all three authorization controls refused
with `403`.

**Independent follower, same binary, over the internet:** a fresh node joined the upgraded seed via
the public multiaddr and converged to **height 10827 with `state_root 0xfc93c5a3…9fd941`, identical
on both**. Gossip peering confirmed in its log (`CONNECTION ESTABLISHED` with the seed's PeerId,
subscribed to `/tet/v1/tmail`).

**Cross-network AT-4, seed ↔ follower, 19/19 green.** The gap noted here earlier is closed. The
read receipt was posted **on the follower**, not on the seed — deliberately, because the AT-F1
regression was a seed-submitted pass that never exercised the follower path:

| Step | Result |
|---|---|
| Burn envelope sent on the seed | `202` |
| Reached the follower over the public network | 367 ms, flag intact |
| Follower decrypts it | plaintext matches |
| **Read receipt posted on the follower** | `202` |
| **Both stores cleared** | **1049 ms** — the revoke travelled follower → seed |
| Sender-initiated burn (the mirror direction) | both cleared, 1088 ms |
| Three authorization controls | `403` each, messages survived |

Independent of the test script's own polling, the seed's log shows its gossip arm firing:

```
[P2P] 🔥 TMAIL BURNED msg_id=171f0cef-60ca-438c-a1ca-ad523791e900
[P2P] 🔥 TMAIL BURNED msg_id=531fb73d-e3c1-43da-9cfb-8b1278613b87
```

**Known gap, not blocking:** `metrics::inc_tmail_burned` increments but is not exported by
`/metrics`, so the burn counter is invisible to monitoring. Folds into the open S4 monitoring item.

### S7-2: scheduled release (2026-09-23)

**Shipped as spec §A.2.2 approach C.** `GET /tmail/inbox` lists a scheduled message — sender,
timestamps, `release_at_ms`, `locked: true`, `locked_note` — and **omits the `e2ee` block** until
`now >= release_at_ms`. The response carries `locked_count`. One clock reading covers the whole
response so rows cannot disagree about "now".

`flags.time_lock` and `release_at_ms` were already inside the signed §A.1.3 pre-image, so this
changed no signature format and invalidated nothing already signed — the schedule was signed all
along and merely refused. The schedule must be coherent with the flag in both directions: the flag
requires a release strictly after `sent_at_ms` (a past release would present as "scheduled" while
releasing immediately), and without the flag `release_at_ms` must be 0 (otherwise it is a signed
value the node silently ignores). The unsigned `time_lock` block may only restate the signed value,
and `vdf_proof_b64` is refused outright so the Phase 0.1 path never looks supported.

**A spec correction landed with it.** §A.2.4 specified `GET /tmail/decrypt/:id → 423 TIME_LOCKED`.
That endpoint does not exist and could not: the node holds no decryption keys and never decrypts —
decryption is client-side. A 423 from a decrypt route was never the mechanism. What a node can
withhold is the ciphertext it serves, so that is what it withholds; the table now says so.

**Honesty is enforced, not just written.** New §A.2.5 records the R6 wording as locked, and
`npm run verify:tmail-burn` pins three copies to each other — the spec, `TMAIL_TIME_LOCK_DISCLOSURE`
in `tet-core/src/tmail/timelock.rs`, and the UI constant. Softening any one of them fails the check.
The disclosure ships in `locked_note` on every withheld row, under the compose control, on every
scheduled message in the inbox, and in `RUNNING_A_NODE.md`:

> Scheduled release, not an enforced lock. The encrypted message reaches relaying nodes when it is
> sent; cooperating nodes withhold it until the release time, and anyone holding the recipient's
> keys could read it sooner.

**AT-3's clock is a parameter**, `to_inbox_row(env, now_ms)`. "After 1h" is reached by passing an
instant, never by sleeping. Negative controls: J1 withholding disabled, J2 clock comparison
inverted, J3 disclosure dropped, J4 flag ignored, J5 REST bypasses the projection, plus K1–K3 on the
copy — all live. J4 was vacuous on its first run and the guard was strengthened; see the item 2
commit.

**AT-3 verified live, two local nodes, 17/17 green.** Driver:
`tet-network/ui/scripts/tmail_timelock_interop_step6.mjs` (`SCHEDULE_MS`, default 25 s). It uses the
browser's real crypto, like the step4/step5 scripts.

| Step | Result |
|---|---|
| Scheduled envelope accepted | `202` on N1 |
| Listed as `locked` on BOTH nodes | **1 ms** over real gossip |
| `e2ee` block served by neither | withheld |
| `release_at_ms` + `locked_note` visible | both nodes, disclosure present |
| Ciphertext absent from the raw response bodies | clean |
| After the release passed | **both unlocked in 11 ms** |
| Receiver decrypts the released message | plaintext matches |

Three live controls:

| Control | Result |
|---|---|
| Unscheduled message | never withheld; served in full on both |
| `release_at_ms` in the past | `400 flags.time_lock requires release_at_ms strictly after sent_at_ms` |
| Unsigned `time_lock` block moving the release | `400 time_lock block disagrees with the signed release_at_ms` |

**No production clock hook.** The unit guards inject `now_ms` into `to_inbox_row`, which is how
AT-3's "after 1h" is reached without sleeping. The live run instead schedules ~25 s out and waits it
out, because adding a clock-skew override to a shipping node would be a backdoor around the only
mechanism this feature has.

**Seed redeployed to the S7-2 binary, 2026-09-23.** Same build-first-recreate-second pattern as the
S7-1 redeploy, so the old container produced blocks throughout the ~8 min compile.

| Check | Before | After |
|---|---|---|
| **PeerId** | `12D3KooWNcdESJUC…cD7MSEC` | **identical** |
| Height | 11054 → 11118 at swap | 11118, advancing |
| Block 11054 `block_id` | `0xa253afb2…a20a1bd` | **identical** |
| Block 11054 `state_root` | `0x23576105…0dd1fa` | **identical** |
| `GET /tmail/inbox` | no `locked_count` | `locked_count` present |

AT-3 re-run against the deployed seed over an SSH tunnel to its loopback REST: **17/17 green**,
including the raw-body check that the ciphertext appears nowhere in the response, and all three
controls. Both URLs pointed at the seed for that run, so its "both nodes" steps were self-checks —
closed by the cross-network run below.

**Cross-network AT-3, follower → seed, 17/17 green (2026-09-24).** Sent **from the follower**, not
the seed, for the same reason AT-4 was: a seed-submitted pass never exercises the follower path.
The follower first reached lag 0 against the public chain (height 14098, `state_root
0xbff8a79e9525785ef5`, identical on both) so gossip was genuinely established.

| Step | Result |
|---|---|
| Scheduled envelope sent **on the follower** | `202` |
| Listed as `locked` on **both** follower and seed | 693 ms over the public network |
| `e2ee` served by neither | withheld on both |
| `release_at_ms` + `locked_note` on both | disclosure present |
| Ciphertext absent from **both** raw response bodies | clean |
| After release passed | **both unlocked in 433 ms** |
| Receiver decrypts **via the seed** | plaintext matches |
| Three controls | all refused as expected |

The seed's own log independently shows the envelope arriving over gossip from the follower, while
the seed's REST served it with no payload until release:

```
[P2P] ✅ TMAIL ENVELOPE STORED msg_id=5bf34b8c-9fb3-4d15-bfb4-f14d988e8746
```

So withholding holds on a node that only ever saw the message over the wire, which is the case that
matters: the seed had no part in composing it and no reason to treat it specially.

**Deferred to Phase 0.1, as the spec already directs:**

| Deferred | Spec | Why not now |
|---|---|---|
| `time_lock_stake_micro` forfeit | §A.2.2 item 4 | Marked *Optional* there. It is the only part that would make the schedule **enforceable**, and it needs a challenge path on ZK-Court patterns plus a new consensus tx — the same flag-day problem as Pin |
| Wesolowski VDF | §A.2.3, decision #1 | New crypto dependency and proof tooling; "do not block ship on VDF" |
| Hash-lock to a release beacon | §A.2.2 item 3 caveat | Would raise the bar above "cooperating nodes", but needs an external beacon |

Until one of those lands, this is scheduled release and nothing stronger. Risk **R6** stays open by
design, and the marketing constraint from decision #1 — say "scheduled release", never "time-lock"
without the disclosure — is now a build check rather than a convention.

### Why time-lock is not the expensive one

The spec's §A.2 reads as though time-lock is the hard feature, and
[`PHASE_1_GENESIS_SPEC.md`](./PHASE_1_GENESIS_SPEC.md) §1 makes wall-clock reads look disqualifying.
Neither applies. §1 indicts `ledger_now_ms()` reached from `apply_consensus_block_batch`
(`ledger.rs:1641`) and `compute_state_root_after_remote_block` (`ledger.rs:1399`) — paths where every
node must derive the same `state_root` from the same block. Time-lock's `now >= release_at_ms` check
lives in a REST handler and the node-local store; its outcome affects one node's HTTP response, never
a `state_root`, and two nodes disagreeing about it produce no fork. Same class as
`spendable_balance_micro_now` at admission (`handlers/files.rs:341`), which §1 does not indict either.

So time-lock needs **no** `block.timestamp` and is the second-cheapest item, not the most expensive.
Deferred from it: the optional `time_lock_stake_micro` forfeit (§A.2.2 item 4) and the VDF — both
Phase 0.1 by locked decision #1.

What time-lock cannot claim is enforcement. The node never decrypts (there is no `/tmail/decrypt`
route; decryption is client-side in `ui/app/lib/tmail_e2ee.ts`), so a time-locked ciphertext sits in
every peer's store from `sent_at_ms` and anyone holding the receiver key can open it immediately.
The node-side 423 is a convention. Ship it as §A.2.2 selection **C** with locked decision #1 / risk
**R6** marketing copy ("scheduled release"), and withhold the `e2ee` block from `GET /tmail/inbox`
until release so the bar is at least "whoever saw the gossip".

### Pin: two decisions, both taken 2026-09-23

**1. Pin is a fee, not a locked stake.** Appendix C and Appendix K.2 specify different mechanisms:
C says a **1 000 µTET fee settled 50% treasury / 50% burn**, K.2 says the ledger **locks** stake with
`pin_expiry_ms = now + 30d` and slashes to treasury on expiry. **Appendix C wins; K.2 is marked
superseded.** A locked stake is a `VestLockV1` row with `unlock_at_ms`, read by `locked_balance_micro`
(`ledger.rs:4571`) — precisely the wall-clock-in-apply defect `PHASE_1_GENESIS_SPEC.md` §1 exists to
remove. Building K.2 would add a second one immediately after §1 documented the first. The fee has no
time component in apply.

**2. The `TxV1::TmailPin` variant is batched into Phase 1, not shipped as a flag-day upgrade.**
Adding a variant is not an apply-arm edit. `TxV1` is `#[serde(tag = "kind")]` and blocks carry
`Vec<SignedTxEnvelopeV1>` (`consensus.rs:81`), so a node on the current binary cannot **deserialize**
a block containing `kind: "tmail_pin"` — it fails before reaching the
`"unsupported tx in consensus block"` catch-all (`ledger.rs:1877`, the trap `CLAUDE.md` describes).
Every node on the network must upgrade before the first pin is mined. `PHASE_1_GENESIS_SPEC.md` §2
already queues eight-plus variants for the ceremony; Pin joins them there.

Ten sites a new appliable variant touches, from the `FileFee` precedent: `protocol.rs:30` (enum) ·
`ledger.rs:604` (`tx_kind`) · `ledger.rs:644` (`prepare_block_undo`) · `ledger.rs:1399` (preview arm,
must match apply byte-for-byte) · `ledger.rs:1641` (apply arm) · `consensus.rs:498`
(`compute_reward_for_block`, whose own `_ =>` also rejects the block) · `rest/state.rs:137`
(`tx_fee_score`) · `rest/handlers/ledger.rs:533` (dispatch) · a `POST /tmail/pin` handler shaped like
`post_files_fee` (`handlers/files.rs:296`) · `fees.rs:92` (a fifth `FeeKind` — today's four are
`Transfer`, `AiUtility`, `AiInference`, `File`, and none carries a 50/50 treasury/burn schedule).

### S7-0: retention is a store rule now (2026-09-23)

**Done.** A conversation keeps its newest **5** messages; older ones are **deleted** from
`tmail_by_receiver_v1`, not hidden. Conversation = counterparty wallet pair (Appendix K.3 flat
threads), so two counterparties retain 5 each rather than 5 between them. Enforced at write time in
`store_tmail`, so the store obeys the rule even if nothing ever reads the inbox, and again in
`get_inbox` so the API contract holds if a stale row survives a crash between insert and prune.

A pruned message leaves a `pruned:` marker in `tmail_by_msg_id_v1` — deliberately distinct from the
burn `burned:` tombstone, because "aged out" and "destroyed on instruction" are different facts.
Both stop a re-gossiped copy from reinserting; both carry the original expiry so `prune_expired`
reaps them.

`TmailStore::is_pinned` is the Phase 1 seam: hardcoded `false`, consulted by both the write-time
prune and the read-time cap, so when `TxV1::TmailPin` lands the exemption is already wired.

**AT-7 rewritten as two halves.** (a) without a pin the 6th message is genuinely gone — **green**.
(b) with a pin the thread keeps >5 — **RED**, `#[ignore]`d so CI stays green on a known-missing
feature, with the spec's AT list carrying the matching ❌. `cargo test --bin TET-Core -- --ignored
at7_b` shows it failing, with the reason in the panic message. It stays red until Phase 1.

Negative controls, all live:

| Control | Guard | Result |
|---|---|---|
| H1 `store_tmail` stops enforcing (the pre-S7-0 display-only cap) | `at7_a_sixth_message_is_pruned` | FAILED |
| H2 `get_inbox` drops its per-conversation cap | `at7_a_read_side_cap_holds` | FAILED |
| H3 retention ignores the conversation, caps the whole inbox | `at7_a_retention_is_per_conversation` | FAILED |
| H4 pruning deletes the row but leaves no marker | `at7_a_pruned_message_is_not_restored` | FAILED |
| H5 retention keeps the oldest five instead of the newest | `at7_a_sixth_message_is_pruned` | FAILED |
| H6 `is_pinned` flipped to `true` | `at7_a_sixth_message_is_pruned` | FAILED |
| H7 AT-7(b) run with `--ignored` | `at7_b_pinned_conversation` | FAILED (as intended) |

H1 is the one that matters: it restores exactly the behaviour that made AT-7 vacuous, and the guard
goes red. H6 proves the pin seam is genuinely wired into retention rather than decorative.

**The UI cap is gone (2026-09-23).** `INBOX_VISIBLE` and the "Show older" toggle were removed from
`MessagesPanel.tsx`: the panel now renders exactly what `GET /tmail/inbox` returns. There is one
"5" in the product and it is the node's per-conversation retention rule. Keeping a second,
differently-scoped cap in the client was how AT-7 came to be vacuous in the first place.

### AT-7 was vacuous before S7-0 — the original finding

**AT-7 ("pay 1000 Stevemon stake; conversation retains >5 messages") passes right now, with the
feature entirely absent.** The 5-message cap is client-side display only: `MessagesPanel.tsx:28`
`INBOX_VISIBLE = 5` and line 269 `showOlder ? items : items.slice(0, INBOX_VISIBLE)` — a "show older"
button already reveals everything, and the store returns up to 50 regardless (`store.rs`,
`get_inbox`). This is the decorative-guard failure mode `CLAUDE.md` names, sitting in an acceptance
test.

**S7-0** makes the cap a real server-side retention rule so that Pin has something to buy: what a pin
should extend is the store's TTL (`store.rs:21-22`, 7 d default / 30 d max), not a UI list's
visibility. AT-7 is rewritten to **fail** today — it asserts the 6th message is *gone* — and stays red
until Pin lands in Phase 1.

### Why Pin last does not block the marketing gate

Locked decision #6 gates marketing on **AT-3 + AT-4 + AT-5** — time-lock, burn, anonymous. **AT-7
(Pin) is not in that set.** Deferring Pin to Phase 1 costs the gate nothing, and the two features
that do gate it (S7-1, S7-2) are the two that touch no consensus.


## Superseded scope

Original v1 Sprints 3–6, preserved verbatim. **None was executed under these numbers.** Items marked ↪ were absorbed elsewhere; the rest are unscheduled backlog and several overlap S4.

### v1 S3 — ZK wiring (P1)

1. **RISC0 guest CI path:** `RISC0_SKIP_BUILD=0` で CI サブジョブ（または週次）が `methods/` ビルド成功。 — ⬜ **overlaps S4 CI/CD**
2. **`NEXUS_GUEST_ELF` 空時の挙動:** 本番は fail-closed、dev は warn。 — ↪ done, `zk_verifier.rs` + `main.rs` mainnet panic guard
3. **ZK-Court happy path:** mock ではなく guest receipt で `VerifyZkProof` が 1 本通る統合テスト（`TET_ALLOW_MOCK_ZK` なし）。 — ⬜ **open**

### v1 S4 — Incentive layer (P1)

1. **AI settlement + thermodynamic rewards:** 80/15/5 と §5.2 R(T) 経路がマルチノード同期後も一貫することを E2E テストで確認。 — ⬜ **open**
2. **Worker stake gate:** `MIN_WORKER_STAKE_MICRO` 拒否が integration test でカバー。 — ↪ partially done via `ff6f7be` `WorkerRegister` bond precondition
3. **Slashing stub → MVP:** ZK-Court 敗訴時の bond forfeit が台帳残高に反映。 — ↪ `slash_worker_bond_to_ecosystem_all` exists; **no challenger incentive**, so the path is never exercised

### v1 S5 — Inference mock E2E (P2)

1. **Single-swarm inference topic:** `nexus-inference-v1` をブロック mesh と共存。 — ⬜ **open**; still three separate swarms (4001/4003/4005)
2. **Phase 0 UI path:** request → worker → result が 1 ローカル mesh で完走。 — 🟡 works via single-node local fallback; multi-node worker dispatch unproven
3. **Optional:** `POST /v1/compute` がシャード数 > 0 で 200。 — ⬜ **open**

### v1 S6 — Docs, release, Docker recovery (P2)

1. **`docs/STATUS.md` 更新。** — ⬜ **open**; `STATUS.md` still reflects 2026-05-18 state
2. **Operator runbook 統合。** — ↪ **merged into S4** operator docs
3. **Docker E2E:** `docker compose up` で 3 ノード + UI smoke。 — ↪ **merged into S4** Docker item
4. **Commit / tag:** `Phase 0 foundation` タグ；push は CI 緑後。 — ⬜ **open**; repo has no tags

---

## Risk register

| Risk | Impact | Mitigation | State |
|---|---|---|---|
| **No L1 Foundation before Tmail** (spec R8) | Phase 0 ships with no joinable chain | S4 gate before further product work | **Materialized** — S5/S6/S9 shipped first |
| Public seed SPOF (spec R10) | Network dies with one host | 2nd seed when traffic warrants | **Open, and now load-bearing.** One seed is live (2026-09-22) and it is the only block producer on the network — followers run `TET_AUTO_MINE=0`, so if Helsinki stops, the chain stops. The previous "network is down" state is cleared; the single point of failure it created is not |
| RISC0 CI が重い | ZK path untested in CI | `RISC0_SKIP_BUILD=1` default, `zk` job optional | Open |
| Anonymous ZK not ready (spec R1) | Ship slips | Slip the date; never ship placeholder UI | Open — S8 not started |
| ホワイトペーパーと実装の用語乖離 | docs 混乱 | WP §17 records divergences explicitly | Ongoing; see `TET_STATE_2026-09.md` §3.1 |
| 3-month dormancy (2026-06-12 → 2026-09-17) | Dependency drift, lost context | This restart pass; `TET_STATE_2026-09.md` | Active |

---

## Out of scope for Phase 0

- 公開 testnet 72h 連続稼働（`SPRINT0_ISSUES.md` フル項目）
- Stripe 本番連携
- Substrate / Solana アーカイブ復活 — see `archive/substrate/`
- Neural State Transition / Sentient Assets（WP Part II §14–16）
- SP1 prover, cross-chain bridges, mainnet freeze (WP §19.1 explicit non-goals)
- Productized AI Worker earn — Phase 0.5

---

## References

| Document | Holds |
|---|---|
| [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) | Sprint *contents*, acceptance tests AT-F1…AT-9, locked decisions, fee economics |
| [`TET_STATE_2026-09.md`](./TET_STATE_2026-09.md) | Whole-project state, gap analysis, ideas inventory |
| [`UI_STATUS_PHASE0.md`](./UI_STATUS_PHASE0.md) | S3 evidence |
| [`SYNC_ISSUE.md`](./SYNC_ISSUE.md) | S1 evidence |
| [`SPRINT0_ISSUES.md`](../SPRINT0_ISSUES.md) | Production-readiness backlog (unclosed) |
