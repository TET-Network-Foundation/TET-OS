# TET Whitepaper
## The Global Energy Currency for Verified Compute

**TET (Tradable Energy Token)** is a monetary and compute protocol where AI and high‑value computation become a verifiable, tradable energy commodity.

- **Unit**: 1 TET = **100,000,000** *stevemon* (8 decimals)
- **Peg**: **1 CHF == 1 TET** (commercial settlement target)
- **Security**: hardware attestation boundary + hybrid signatures (Ed25519 + PQC-ready)
- **Compute**: decentralized worker network with shard orchestration + verification

---

## 1. Thesis

Modern AI is an energy industry disguised as software. Whoever controls compute controls intelligence.
TET makes compute:

- **Measurable** (task proofs, hashes, audit trail)
- **Payable** (stevemon economy, fee routing, founder treasury)
- **Decentralizable** (worker network: anyone can lend CPU/GPU)
- **Auditable** (tamper‑evident logs and founder transparency)

---

## 2. System Architecture (High Level)

TET consists of three layers:

### 2.1 Core Ledger (TET-Core)

- Maintains balances in *stevemon*.
- Enforces hard cap.
- Executes atomic **mint** and **transfer** with protocol fees.
- Stores proofs and an append‑only, hashed audit trail.

### 2.2 Compute Gateway + Orchestrator

- Accepts compute requests via API (e.g. **`POST /v1/compute`**).
- Splits large jobs into **shards**.
- Routes shards across workers (initially simulated deterministically, designed for real distribution).
- Verifies results before merging.
- Mints rewards to workers with **Imperial Tax** routing.

### 2.3 Worker Network (TET-Worker-App)

- Users lend compute to earn stevemon.
- Each worker response is **hardware-bound**:
  - task hash + result hash + hardware ID
  - signed by the worker identity key
  - proof-of-execution hook (ZK-PoE stub) for future zero-knowledge enforcement

---

## 3. The CHF Peg (1:1)

TET targets a commercial peg:

> **1 CHF deposited == 1 TET minted**

In the current launch scaffold:

- Checkout is a **Stripe placeholder** flow.
- Payment confirmation triggers **CHF top-up minting** (ledger mint) at the peg ratio.
- Founder can view:
  - total CHF collected
  - total TET minted from fiat
  - total circulating supply
  - a peg sanity check

This provides a clear operational model for Swiss-style transparency and auditability.

---

## 4. Stevemon Economy

### 4.1 Denomination

- Smallest unit: **stevemon**
- \(1\\ \\,TET = 100,000,000\\ \\,stevemon\)

### 4.2 Protocol Fees (Founder Revenue)

The protocol enforces fees at the ledger layer so they cannot be bypassed by UI or clients.

- **Mint fee**: routed to founder wallet (bps-configurable, default 1%)
- **Transfer fee**: routed to founder wallet (0.5%–1.0% allowed range)

### 4.3 Imperial Tax (Compute Rewards)

On worker-network minting:

- **99%** to the worker
- **1%** to **`founder-vault-1`** (configurable imperial vault)

This is a protocol-level revenue stream aligned with compute throughput.

---

## 5. Compute Orchestration & Verification

### 5.1 Sharding Plugins

TET supports plugin-based sharding strategies:

- **AI Inference**: split large context windows into parallel chunks
- **Video Rendering**: split frame ranges into independent tasks and reassemble
- **Scientific Compute**: split grid/tiles and aggregate

### 5.2 Verification Engine

Launch scaffold verifies correctness via deterministic recomputation for PoC tasks and is designed to upgrade to:

- redundant execution across multiple workers per shard
- **hash agreement** thresholds (e.g. 2-of-3, 3-of-5)
- ZK proofs of execution (future)

---

## 6. Cryptographic Security

### 6.1 Hardware Binding

Workers are identified by a hardware-derived ID (attestation boundary). Responses are signed and verified server-side.

### 6.2 Hybrid Signatures (Quantum Shield)

When enabled, state-changing actions require:

- Ed25519 signature
- PQC signature (wire shape enforced now; production-grade verification later)

---

## 7. Phased Evolution (3 Phases)

### Phase 1 — Secure Gateway

- Wallet + signer bridge
- Ledger invariants and audit trail
- External AI bridge (cost guard + pricing)

### Phase 2 — Worker Protocol

- worker registry + proofs
- internal routing (bypass external costs where possible)
- imperial tax + community compute telemetry

### Phase 3 — Commercial Readiness & Supercompute

- `POST /v1/compute` orchestration pipeline
- commerce checkout placeholder + CHF peg minting
- founder transparency dashboards + CSV audit exports
- chaos simulation mode for anti-fragility

---

## 8. What Makes TET “Legendary”

TET is not “another token.” It is an **energy accounting layer for intelligence**:

- A currency that measures compute.
- A network that turns idle hardware into a global supercomputer.
- A ledger that makes fees, proofs, and compliance auditable by design.

**TET is the bridge from compute to commerce.**

