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
| **S4** | **L1 Foundation** — public seed, faucet, Docker (node + UI), CI/CD, operator docs, monitoring | 🟡 | Faucet ✅, Docker ✅, CI ✅, docs ✅, **public seed ✅ (2026-09-22)**. Monitoring remains, and AT-F1 exposed a new blocker: tx gossip is not implemented. See [S4 detail](#s4--l1-foundation-detail) |
| **S5** | Tmail protocol — `/tet/v1/tmail` gossip, `TmailEnvelopeV1`, REST, store | ✅ *(fee/audit deferred)* | `9e9a4a7`, `4d3fc72` |
| **S6** | Win95 shell + Basic Tmail UI | 🟡 | `1d3173f`, `356df5e`, `ad3fb3f`, `a3f2720`…`31299c3`. E2EE verified cross-region (CH→FI, 1.3 s). Shell is **tabbed**, not a window manager — no taskbar, no boot sequence, no sounds |
| **S7** | Time-lock + Burn + Pin stake | ⬜ | Gates marketing (locked decision #6, AT-3/AT-4) |
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
| **Docker (node + UI)** | 4 d | 🟡 **quickstart done, production image broken** | **2026-09-21** (`e9c8aae`). Compose brings up `tet-core` + `ui`; PQC WASM baked into the UI image; healthchecks on both, `ui` gated on `tet-core` healthy. `docker-compose.dev.yml` is the ~10-min quickstart. **2026-09-22:** the base file's production default (`RISC0_SKIP_BUILD=0`, `--features zk-prove`) **does not build at all** — `Dockerfile:22` runs `cargo risczero install`, which RISC Zero has removed in favour of `rzup`, and the step exits 1 with `Error: Run \`rzup install\` instead`. Nothing caught it because CI passes `RISC0_SKIP_BUILD=1` on every job (`.github/workflows`, lines 32 and 238), so the zk image path has never been built by anything. Not a resource limit: it failed after 7 s with peak memory at 564 MB of 3.7 GB. The seed therefore runs quickstart. Images 197 MB (node, quickstart) / 343 MB (UI) |
| **CI/CD (GitHub Actions)** | 2 d | ✅ **done** | **2026-09-21** (`a914316`). Four jobs — `rust` (build + 185 tests + 6 named security guards + 4 block-9828 pins), `ui`, `wasm`, `docker`. Green on `main`. Clippy runs non-blocking until the 37 existing warnings are cleared |
| **Public operator docs** | 2 d | 🟡 **partly done** | **2026-09-21:** the Docker section is rewritten against real output (Quickstart / Production split, `docker-compose.dev.yml`), and § Getting testnet TET is new. **2026-09-22:** § Joining the public testnet seed, § The public seed, and the tx-gossip limitation are new and written against the verified run. Still stale elsewhere: the doc is dated 2026-05-19 and predates the 4001/4003/4005 port split, the watchdog, `/health/swarm`, the `block_id` V2 fork, Tmail and Files |
| **Monitoring + logs** | 2 d | ⬜ open | JSON tracing, `/metrics`, `/health/swarm`, systemd watchdog and `observability/{prometheus,grafana}` scaffolding all exist. No dashboards, no alerting, no SLOs |
| **Tx gossip** | — | ⬜ **new blocker** | Found by AT-F1 on 2026-09-22. `TXS_TOPIC` (`p2p.rs:357`) is subscribed (`p2p.rs:1276`) but **never published to** — those two lines are the only hits in the tree. A tx settles only on the node that accepted it; a follower can never get one mined. Not in the original S4 scope, but it makes "join the testnet and transact" false, so it belongs to the Foundation gate |

### S4 exit criteria (the Foundation gate)

**Updated 2026-09-22.** The seed exists, so criteria 1, 3 and 5 close and 6 closes in substance.
What the seed's arrival did *not* do is make the gate pass: exercising AT-F1 against a real remote
node surfaced that transactions do not propagate between peers, which is a harder blocker than the
one it replaced.

| # | Criterion | State | Evidence / what is left |
|---|---|---|---|
| 1 | ≥1 public seed reachable from the internet, **multiaddr documented in a tracked file** | ✅ | `/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC`, in `RUNNING_A_NODE.md` § The public seed. Reachability verified from outside the host: `8002/tcp` open, `5010` and `3000` not reachable |
| 2 | Faucet funds a test wallet with **no admin token**; curl or UI path documented | ✅ | `POST /ledger/initial_airdrop/claim`, hybrid-signed, no token. Verified 0 → 1,000 TET after one block. Documented in `RUNNING_A_NODE.md` § Getting testnet TET. Caveat: **CLI path only, no UI button** |
| 3 | Fresh machine: `docker compose up` → **node + UI** against the public seed, no local genesis hack | ✅ | **2026-09-22.** Fresh volume, `TET_BOOTNODES` = the seed, node + UI up; UI served 200 and proxied `/tet-node-api/status` to the node. No genesis hack — the committed compose defaults are what the seed runs |
| 4 | CI green on the default branch | ✅ | Run 35547793730 on `main`, all jobs green (`a914316`) |
| 5 | A builder follows `RUNNING_A_NODE.md` and joins the testnet in under 30 minutes | ✅ | § Joining the public testnet seed is three `.env` lines plus one compose command, written against the run that produced criterion 3. Sync landed within one block interval of container start |
| 6 | **AT-F1** end-to-end: clean laptop → join seed → faucet → `GET /ledger/me` → send 1 TET | 🟡 **passes, with the tx submitted to the seed** | **2026-09-22, Switzerland → Helsinki.** Join ✅ (same `block_id` + `state_root` at every height compared). Claim → 1,000 TET ✅. Send 1 TET → sender 999.0, recipient 0.99 after the 1% fee, **identical on both nodes** ✅. The asterisk: both txs had to be submitted to the *seed*. Submitted to the joined node they returned `200 {"status":"pending"}` and never settled — see the Tx gossip row. A clean laptop can join, read and verify the chain, but cannot yet transact through its own node |

**So: tx gossip and monitoring are the remaining ⬜.** Provisioning the seed converted four rows
at once, as predicted — and then AT-F1, run for the first time against a node that is not also the
node doing the mining, exposed the gap that single-node testing structurally could not: a
transaction never leaves the mempool of the node that accepted it. Every earlier AT-F1 run passed
because submit-node and mining-node were the same process.

That is the shape of this whole sprint. The Foundation gate is not a checklist of artifacts; it is
the first configuration in which the artifacts are forced to talk to each other over a real
network, and it keeps finding things that a laptop cannot.

Still ⬜: **tx gossip** (new, and the blocker for a genuinely joinable testnet) and **monitoring**
(dashboards, alerting, SLOs; the `/metrics`, `/health/swarm` and `observability/` scaffolding all
exists already).

---

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
