# Sprint 0 Issues (Production Readiness)

This document is designed to be copy/pasted into GitHub issues.
It contains:
1) What is done vs not done
2) A strict, prioritized issue backlog with Dependencies + Definition of Done (DoD)

## 0) What is done (from our current workspace progress)

### Implemented / verified
- `tet-testnet` chain spec added (`tet_testnet_chain_spec`) with fixed bootnode + `protocol_id=tet` direction.
- Node CLI: `--tet-rpc-profile public|private` + runtime propagation via `TET_RPC_PROFILE`.
- Node RPC: added `tet_healthSummary` RPC method.
- `tet-worker` hardening:
  - Removed dev key usage in code path; worker seed must be provided by `TET_WORKER_SEED`.
  - Added worker metrics HTTP server at `/metrics`.
- `tet-core-chain` runtime fee accounting:
  - `pallet-tet-core`: added `TotalBurned`.
  - runtime fee handler (`DealWithFees`) now records burned fees via `tetCore.TotalBurned`.
- `tet-ui` explorer:
  - `Burned` now reads from `tetCore.totalBurned`.
  - `Peers` reads from `system.health().peers` (best-effort parsing).
  - Removed placeholder tag and hardcoded burned=0 messaging.
- `tet-ui` OS security UX:
  - Removed sessionStorage PIN persistence + auto-unlock after reload.
- `tet-worker` tx parameter normalization:
  - `tetCompute.submit_inference_proof` argument ordering aligned and byte-level argument handling normalized.
  - Verified end-to-end tx success and event emission on a local dev chain.

### Status notes
- You still have visible warnings (deprecated constant weights) and build/run requires dev-setup correctness.

## 1) Not done (exhaustive gaps against the “Phase 0 public testnet/mainnet” goal)

The goal: "Public testnet: third parties can connect, submit inference jobs, verify, and rewards reflect reliably for 72h."

### A) Network / Node Operations (Most Critical)
- [GAP] Bootnode distribution strategy not productionized (beyond fixed testnet).
- [GAP] Peer scoring / eviction policy not implemented.
- [GAP] DoS resistance and network partition operational rules not implemented.
- [GAP] Public RPC defense (method allowlist + auth + reverse proxy standardization + WAF/DDoS) not implemented end-to-end.
- [GAP] Node role separation not defined (validator/full/archive/sentry/public-rpc/indexer).
- [GAP] Mempool policy not defined (priority/replacement/spam suppression/fee-bytes controls).
- [GAP] State DB SRE procedures missing (RocksDB/ParityDB compaction, backups, snapshots, restore, IO tuning).
- [GAP] Release engineering missing (reproducible builds, signed releases, rollback strategy).
- [GAP] Incident operations missing (emergency stop, key leakage process, chain fork handling).

### B) Ecosystem / User-facing Foundations
- [GAP] Indexer/Explorer full event exploration not implemented (UI still not complete for full real-time event audit).
- [GAP] Wallet/key management lacks production-grade standardization (domain separation, restore UX, audit logs).
- [GAP] Public API contract versioning and deprecation policy not implemented.
- [GAP] Observability dashboarding not implemented (Prometheus/Grafana/Alertmanager + SLOs/alerts).

### C) ETH/BTC-grade operational readiness items missing
- [GAP] Signed releases and reproducible builds.
- [GAP] Incident Runbooks + operational playbooks.
- [GAP] Security audit loop and external audit pipeline not established.
- [GAP] Economic parameters operational governance not fully implemented (fee market / slashing / reward formula management).

### D) Protocol / Rule Hardcoding
- [GAP] CAAC thresholds / task-node capability routing not implemented.
- [GAP] Lambda slashing MVP incomplete:
  - no full challenge window + penalty ledger + proof-dispute -> penalty workflow is wired.
- [GAP] Genesis/vesting/treasury/release/burn lifecycle not complete.
- [GAP] Tokenomics constants consistency fully unified across chain + UI not formally enforced beyond local fixes.
- [GAP] PQC verification remains placeholder-level (not production-grade ML-DSA verification path).

### E) Revolutionary ideas
- [GAP] Neural State Transition fully unimplemented (not part of Sprint 0).
- [GAP] Sentient Assets fully unimplemented (not part of Sprint 0).
- [GAP] ZK-Court is conceptually stubbed; full dispute workflow + proof engine wiring incomplete.
- [GAP] Federated/continuous learning fully unimplemented.

### F) Web / UI production monitoring and data correctness
- [GAP] OS earnings/counters remain `0.00 TET` (not wired to actual rewards or reward events).
- [GAP] Network ops dashboards missing (block time distribution, finality/reorg, tx pool stats, RPC health p95, etc).
- [GAP] UI placeholders remain in OS flows (Start Earning -> actual job engine integration missing).

## 2) Sprint 0 Roadmap (Prioritized by risk + dependency)

### Week 1: Survival Foundation (public connectivity + security basics + observability)
1. Network and public RPC security hardening (method allowlist + auth + rate limiting + WAF/reverse proxy profile).
2. Role separation template (validator/full/archive/sentry/public-rpc/indexer).
3. Peer scoring + DoS resistance minimal viable.
4. Observability (Prometheus/Grafana/Alertmanager + node/worker/RPC SLO alerts).
5. Key management: dev keys fail-closed, production keystore/env/KMS integration, runbooks.

### Week 2: Protocol minimal completion
6. Proof schema v1 must be enforced end-to-end (worker -> chain -> UI).
7. Slashing MVP: implement challenge->finalize->slash workflow with ledger/eventing.
8. ZK-Court stub: state machine wired; proof engine can stay stubbed but dispute path must work.
9. Tokenomics: finalize single source of truth (total supply, allocations, burn accounting, reward formula).

### Week 3: External usability
10. Explorer/OS: remove remaining fixed/placeholder fields; wire to real chain events.
11. Public docs: RPC spec, node startup, troubleshooting, known limitations.
12. 72h soak test + Go/No-Go checklist + restart and fork resilience.

## 3) GitHub Issue Backlog (copy/paste templates)

Use labels:
- `p0`, `network`, `security`, `rpc`, `observability`, `protocol`, `tokenomics`, `ui`, `ops`

### Issue P0-1: Public RPC allowlist + auth + rate limit enforcement
**Repository:** `tet-core-chain`
**Summary:** Enforce a real public RPC allowlist based on `--tet-rpc-profile public`, not just a profile flag.

**Dependencies:**
- `node/src/rpc.rs` (current `tet_healthSummary`)
- `node/src/cli.rs` and `node/src/service.rs` (profile plumbing)

**DoD (Definition of Done):**
- Public profile rejects any RPC methods not in a strict allowlist.
- Requests are rate limited per IP + per method category.
- Add a minimal integration test (or scripted check) proving method rejection.
- Document the public RPC surface in `docs/rpc-public.md`.

**Notes:**
- This must include reverse proxy/WAF assumptions in docs (e.g., nginx config snippets).

### Issue P0-2: Node role separation (validator/full/archive/sentry/indexer/public-rpc)
**Repository:** `tet-core-chain`
**Summary:** Define and document node roles and their required ports and configuration.

**Dependencies:**
- Chain spec (`tet_testnet` / future mainnet)
- Current node boot parameters

**DoD:**
- Provide role templates in `docs/roles/*.md`.
- Each role describes:
  - required ports (p2p, rpc, prometheus, etc)
  - required config flags
  - required persistence and backup strategy
- Runbook includes "how to deploy role X".

### Issue P0-3: Peer scoring + eviction + DoS resistance minimal viable
**Repository:** `tet-core-chain`
**Summary:** Implement minimal peer quality scoring and DoS resistance hooks.

**Dependencies:** network policy injection points (planned `network_policy.rs`)

**DoD:**
- Under simulated abusive traffic, nodes keep block production stable.
- Add logs/metrics for peer scoring and eviction counts.
- Provide a repeatable test plan for 1h load test.

### Issue P0-4: Observability dashboards + alerts (node / rpc / worker)
**Repository:** `tet-core-chain` and `tet-worker`
**Summary:** Add Prometheus/Grafana/Alertmanager dashboards and alerts.

**Dependencies:**
- `tet-worker` `/metrics` (already added)
- Node prometheus registry is present; custom metrics missing.

**DoD:**
- Node metrics include: block time, peer count, rpc latency p95, tx fail rate.
- Worker metrics include: proof submission latency, tx success/failure.
- Provide `dashboards/*.json` (or documented panels) and alert rules.
- Define SLO thresholds and alert routing.

### Issue P0-5: Key management and fail-closed start logic
**Repository:** `tet-core-chain` and `tet-worker` and `tet-ui`
**Summary:** Remove dev keys and harden production key handling.

**Dependencies:**
- Worker requires `TET_WORKER_SEED` (already fail-closed)
- Node keystore loading

**DoD:**
- Dev/start scripts cannot run production without production keys.
- Runbook for key rotation and key leakage incident.
- Document environment variables and keystore formats.

### Issue P0-6: Protocol CAAC gating (minimum)
**Repository:** `tet-core-chain`
**Summary:** Implement CAAC gating: task capability routing and minimal rule transitions.

**Dependencies:** Proof schema v1 must exist end-to-end.

**DoD:**
- Add storage for capability thresholds.
- Worker submits task with capability hints; chain enforces it.
- Unit tests for accept/reject paths.

### Issue P1-7: Slashing MVP workflow wiring (challenge -> finalize -> slash)
**Repository:** `tet-core-chain`
**Summary:** Implement full slashing workflow with challenge window and penalty ledger.

**Dependencies:**
- `slash_worker` exists but is root-only; dispute path not wired.
- ZK-Court stub partially exists.

**DoD:**
- Implement:
  - open_dispute/challenge extrinsics
  - evidence submission
  - finalize that triggers `slash_worker`-equivalent ledger update
- Add event trail and storage ledger queries.
- Provide a proof-dispute end-to-end test scenario.

### Issue P1-8: Proof schema v1 enforcement end-to-end
**Repository:** `tet-core-chain`, `tet-worker`, `tet-ui`
**Summary:** Normalize and enforce proof schema fields and encoding.

**Dependencies:** `tet-compute.submit_inference_proof` signature

**DoD:**
- Worker sends schema v1 exactly.
- Chain emits enough event fields to reconstruct receipt deterministically.
- UI displays schema fields in explorer/OS (or a “receipt view”).
- Add tests for encoding correctness.

### Issue P1-9: Tokenomics single source of truth + tests
**Repository:** `tet-core-chain` and `tet-ui`
**Summary:** Enforce constants: total supply, allocations, burn formula, reward formula.

**Dependencies:**
- `TotalBurned` now exists

**DoD:**
- Total supply and allocations are derived from runtime storage/config (no hidden constants).
- Add tests verifying:
  - burn increases on fee events
  - reward issuance follows formula
- UI uses the same formulas or reads from chain.

### Issue P2-10: OS earnings and job engine real wiring
**Repository:** `tet-ui`
**Summary:** Replace `0.00 TET` earnings and connect "Start Earning" to real job submission.

**Dependencies:**
- Need chain data source for earnings (events / receipts)
- Need worker or local edge submission integration

**DoD:**
- OS Dashboard shows real session earnings (from chain events or tracked receipts).
- Start/Stop toggles an actual background job process (or local worker trigger) and updates UI.
- Remove placeholder copy and fixed values.

### Issue P2-11: Explorer full event-driven exploration experience
**Repository:** `tet-ui`
**Summary:** Remove remaining fixed values and implement event-driven explorers.

**DoD:**
- explorer can find, paginate, and filter events by:
  - block
  - worker address
  - task_id
  - dispute case
- Provide user-facing docs for the explorer.

### Issue P2-12: Production docs + 72h soak test Go/No-Go
**Repository:** `tet-core-chain` and root repo docs
**Summary:** Document operational steps and run a 72h soak test.

**DoD:**
- Add:
  - node startup commands
  - RPC surface docs
  - troubleshooting playbook
  - rollback and incident playbook
- Execute soak test with checklist:
  - restart durability
  - tx submission under load
  - rpc load test
  - fork/dispute behavior
  - reorg resilience

## 4) Tracking: What you should do next
- Step 1: Confirm issue ownership per repository.
- Step 2: For P0-1..P0-5 implement in parallel only if dependencies are met.
- Step 3: Freeze CAAC/slashing proof verification features until core public ops is stable.

