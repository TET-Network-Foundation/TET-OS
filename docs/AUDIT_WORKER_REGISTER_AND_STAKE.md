# Worker Registration & Stake Bond — Detailed Implementation Audit (Round 1)

**Date:** 2026-05-19  
**Companion:** [`WORKER_MODE_AUDIT.md`](./WORKER_MODE_AUDIT.md) (overview)  
**Method:** Code-read only. Line refs = `Nexus_Network` paths.  
**Audience:** Steve — Phase 0.5 “home Mac worker mode” design.

---

## Executive summary

| Capability | Backend | UI | 1-click Phase 0 |
|------------|---------|-----|-----------------|
| Worker bond lock (1000 TET) | **Yes** — `POST /ledger/stake` → `worker_stakes` tree | **No** | **No** |
| Worker heartbeat register | **Yes** — `POST /worker/register` → in-memory registry | **No** | **No** |
| Legacy `/wallet/stake` | **Yes** — **different** slot (meta stake, 5000 TET constant) | **No** | **Does not satisfy register** |

**Recommendation:** Ship **1-click worker start in Phase 0.5**, not Phase 0. Phase 0 keeps Worker tab as **monitor-only** (or hidden). Register+stake UI alone is ~**3–5 dev-days**; full “earn in 1 hour” needs **1–2 sprints** (see §3, §6).

---

# Part 1 — Worker registration

## 1.1 `POST /worker/register` (handler)

**Route:** `routes.rs:271-272` → `post_worker_register` → `post_worker_register_impl` (`worker.rs:17-107`, `545-549`).

### Request schema (`rest/types.rs:197-206`)

| Field | Type | Required | Meaning / validation |
|-------|------|----------|----------------------|
| `wallet` | `String` | **de facto yes** | Worker wallet id. Trimmed, lowercased (`worker.rs:21`). Empty → `400 WALLET_REQUIRED` (`worker.rs:22-30`). **Not enforced as 64-hex** in handler (only non-empty). |
| `hardware_id_hex` | `String` | **yes** (heartbeat) | Opaque hardware fingerprint string. Empty → `WORKER_REGISTER_REJECTED` / `"hardware_id_hex required"` (`worker_network.rs:65-67`). |
| `ed25519_pubkey_hex` | `String` | **yes** | Advertised Ed25519 pubkey (hex). Empty → reject (`worker_network.rs:69-71`). **Not cross-checked** against `wallet` in register handler. |
| `x25519_pubkey_b64` | `Option<String>` | no | E2EE worker key (base64). Stored if non-empty (`worker_network.rs:78-81`). |
| `mlkem_pubkey_b64` | `Option<String>` | no | ML-KEM pub for E2EE jobs. Required later for `/v1/compute_e2ee/submit` (`worker.rs:182-187`). |
| `tflops_est` | `Option<f64>` | no | Self-reported TFLOPS; default **1.0** if omitted (`worker.rs:99`). Clamped `>= 0` (`worker_network.rs:86`). |

### Response schema

| HTTP | Body |
|------|------|
| **200** | `{"ok": true}` (`worker.rs:101`) |
| **400** | `WALLET_REQUIRED`, `WORKER_REGISTER_REJECTED` + `message` |
| **403** | `FOUNDER_WORKER_FORBIDDEN`, `ATTESTATION_HARDWARE_MISMATCH`, `GRANT_ISSUED_STAKE_REQUIRED`, `WORKER_NOT_STAKED` (see below) |

**`WORKER_NOT_STAKED` (403)** — `worker_bond_micro < MIN_WORKER_STAKE_MICRO`:

```json
{
  "error": "WORKER_NOT_STAKED",
  "message": "insufficient stake to register heartbeat",
  "min_worker_bond_tet": 1000.0
}
```

(`worker.rs:81-88`, `MIN_WORKER_STAKE_MICRO` = `1_000 * STEVEMON` at `ledger.rs:120`).

**`GRANT_ISSUED_STAKE_REQUIRED` (403)** — First eligible guardian: credits **10_000 TET** from worker pool, then **still requires bond** before register succeeds (`worker.rs:59-78`, `GENESIS_GUARDIAN_GRANT_MICRO` `ledger.rs:110`).

### Authentication

| Mechanism | Applied to `/worker/register`? |
|-----------|-------------------------------|
| Hybrid signed body (Ed25519 + ML-DSA) | **No** |
| `x-api-key` / `TET_API_KEY` | **Not enforced server-side** on this handler. `tet-worker heartbeat` **sends** `x-api-key` (`bin/tet-worker.rs:146`) but `post_worker_register_impl` does not read headers. |
| Wallet proof-of-possession | **No** — any client can POST a `wallet` string if bond ≥ 1000 TET. |

**Inference (security):** Register is a **public heartbeat** gated by **ledger bond**, not by signature. Sybil cost = bond lock, not API key.

**Global middleware** (`routes.rs:465-476`): rate limit + CORS only — no API key layer on worker routes.

### Handler logic (ordered)

1. Founder wallet forbidden (`worker.rs:33-44`).
2. If `get_founding_cert(wallet)` exists → `hardware_id_hex` must match cert (`worker.rs:47-57`, `ledger.rs:426`).
3. `worker_bond_micro(wallet) >= MIN_WORKER_STAKE_MICRO` else try `grant_genesis_guardian_if_eligible` (`worker.rs:61-90`).
4. `WorkerRegistry::heartbeat(...)` → in-memory upsert (`worker.rs:92-106`).

### Side effects (what gets written)

| Store | Key / structure | Content |
|-------|-----------------|--------|
| **In-memory** `RestState.workers` | `HashMap<wallet, WorkerEntry>` | Full entry + `last_seen_ms = now` (`worker_network.rs:74-90`, `main.rs:586`) |
| **Ledger** | — | **No write** on register alone (bond unchanged). Guardian grant path writes `balances` + meta (`ledger.rs:2226-2315`). |
| **CAAC** | — | Not updated here; separate `POST /v1/vision/caac/complete` (`vision.rs:42-109`). |

**Persistence:** Registry **lost on tet-core restart**. Bond **survives** in sled `worker_stakes` tree (`ledger.rs:314-315`, `2577-2588`).

**Ledger KV extension (design headroom):** Could persist `WorkerEntry` under `META_*` prefix (pattern like `caac_wallet_meta_key` `ledger.rs:2765-2771`) or gossip from peers — **not implemented**.

---

## 1.2 `WorkerRegistry` (`worker_network.rs`)

### Struct members

**`WorkerEntry`** (`worker_network.rs:8-17`):

| Field | Type | Role |
|-------|------|------|
| `wallet` | `String` | Wallet id key |
| `hardware_id_hex` | `String` | Client-supplied fingerprint |
| `ed25519_pubkey_hex` | `String` | Advertised pubkey |
| `x25519_pubkey_b64` | `Option<String>` | E2EE |
| `mlkem_pubkey_b64` | `Option<String>` | E2EE |
| `tflops_est` | `f64` | Capacity hint for routing |
| `last_seen_ms` | `u128` | Heartbeat freshness |
| `caac_role` | `Option<String>` | `"POC"` / `"POR"` after CAAC complete |

**`WorkerRegistry`** (`worker_network.rs:21-23`): `by_wallet: HashMap<String, WorkerEntry>`.

### Methods (no `unregister` name)

| Method | Lines | Behavior |
|--------|-------|----------|
| `upsert` | 33-40 | Insert/replace; preserves `caac_role` if new entry omits it |
| `set_caac_role` | 42-50 | Patch role on existing wallet |
| `heartbeat` | 52-92 | Validate non-empty wallet/hw/pk → build `WorkerEntry` → `upsert` |
| `get_by_hardware` | 94-97 | Lookup by `hardware_id_hex` (ai_proxy routing) |
| `active_count` / `total_tflops` | 99-115 | TTL filter (`TET_WORKER_HEARTBEAT_TTL_MS`, default 60s in enterprise picker `enterprise.rs:117-120`; cockpit 120s `worker.rs:470-473`) |
| `remove_wallet` | 117-124 | Evict on unstake/slash (`enterprise.rs:161-162`, admin slash `wallet.rs:329-331`) |

---

## 1.3 Hardware fingerprint — two systems

Register uses **client-provided** `hardware_id_hex`, not server CAAC probe.

### A) `tet_worker::hardware_id_sha256_hex_best_effort` (CLI default)

**File:** `tet_worker/mod.rs:10-35`.

**Inputs hashed** (prefix `tet-hardware-id:v1`):

| Signal | Mac availability |
|--------|------------------|
| Primary MAC | `mac_address::get_mac_address()` — **usually yes** |
| Host name | `sysinfo::System::host_name()` — yes |
| OS version | yes |
| Kernel version | yes |

**Format:** lowercase **64-char hex** SHA-256 (not UUID).

**Stability:** Test asserts deterministic per snapshot (`tests.rs:2145-2153`).

### B) `vision/caac::probe_hardware_fingerprint` (server routing heuristic)

**File:** `vision/caac.rs:56-84`.

**Inputs:**

| Signal | Mac (Apple Silicon) |
|--------|---------------------|
| `cpu_logical_cores` | sysinfo CPU count |
| `ram_total_bytes` | sysinfo total RAM × 1024 |
| `gpu_detected` | `true` if `system_profiler SPDisplaysDataType -json` succeeds (`caac.rs:39-48`) |
| `gpu_hint` | `"system_profiler_displays"` |

**Format:** `fingerprint_sha256_hex` = SHA256(`cores=…|ram=…|gpu=…|{gpu_hint}`).

**Role assignment** (local node only): `assign_role` / `meets_poc_threshold` — GPU **or** (cores ≥ 4 AND RAM ≥ 8 GiB) env-tunable (`caac.rs:86-97`). **Not written to register.**

### C) CAAC challenge (ledger PoC/PoR lane)

**Not a hardware fingerprint for register.** Separate flow:

- `generate_hardware_challenge` → random `seed_hex` + SHA256-chain rounds (`caac.rs:139-171`)
- Client runs `compute_challenge_digest`, reports `client_latency_ms`
- `POST /v1/vision/caac/complete` → `CaacWorkerRecord` in **ledger meta** (`vision.rs:82-97`)

**Mac:** Displays probe works; PoC if latency ≤ `TET_CAAC_POC_MAX_LATENCY_MS` (default **50 ms** `caac.rs:181-186`) — **aggressive** for real SHA256-chain; likely **POR** unless tuned.

**Register vs CAAC:** Register does **not** require CAAC. Worker **daemon** requires POC (`worker_daemon.rs:65-72`).

---

## 1.4 UI state

| Question | Answer | Evidence |
|----------|--------|----------|
| "Become Worker" button? | **No** | No string match in `tet-network/ui` |
| Worker tab? | **Yes** — `OsClient.tsx` tab `"Worker"` (`line 73`, panel `2317+`) |
| What it does today | Cockpit poll `GET /worker/cockpit/:wallet` (`worker_cockpit.ts:37`, `OsClient.tsx:1041-1055`); **Start Mining** toggles UI + SSE `/logs` (`1504-1517`, `1062-1123`) | Does **not** call register/stake |
| "Start Mining" spawns daemon? | **No** | Only `setMiningOn(true)` + `EventSource` to middleware logs. Daemon is **child of `TET-Core` process** (`main.rs:612-618`), not browser |
| Cockpit `daemon.enabled` | Reflects **env** `TET_WORKER_DAEMON` on **server** (`worker.rs:500-506`), not client action |

### UI-P0-4 component list (if implementing worker onboarding)

| Component / module | Purpose |
|--------------------|---------|
| `WorkerOnboardingWizard.tsx` (new) | Steps: balance check → stake → CAAC → register loop |
| `lib/worker_bond.ts` (new) | `worker_bond_stake_hybrid_auth_message_bytes` parity (`wallet.rs:387-400`) |
| `lib/hardware_id.ts` (new) | WASM/TS port of `tet_worker` fingerprint or fetch from `GET /v1/vision/caac/profile` |
| `lib/worker_register.ts` (new) | `POST /worker/register` |
| Extend `OsClient.tsx` Worker tab | Replace misleading “Start Mining” or wire to wizard |
| `GET /ledger/me` + spendable | Bond needs **spendable** ≥ 1000 TET (`ledger.rs:2639-2640`) |
| Status: `worker_bond_micro` | **Gap:** no dedicated GET; infer from stake response or add `GET /ledger/worker-bond?wallet_id=` |
| CAAC UI | Challenge fetch + local digest + `POST /v1/vision/caac/complete` |
| Ollama gate | `GET /worker/ai_engine/status` (`worker.rs:126-158`) |
| Optional: local tet-core launcher doc | Browser cannot spawn daemon — need **sidecar** or “connect to your node URL” |

---

## 1.5 Phase 0 — 1-click register from UI

### Must implement (minimum)

1. `POST /ledger/stake` with hybrid signatures (1000 TET) — **not** `/wallet/stake` (wrong tree, `wallet.rs:294` vs `ledger.rs:1268`).
2. Hardware id generation (align `tet_worker` or document copy-paste).
3. `POST /worker/register` heartbeat (repeat every < TTL).
4. User education: **1000 TET liquid** on testnet (faucet / guardian grant is **not** enough alone — grant then stake `worker.rs:67-76`).

### Effort (UI register + stake only)

| Item | Estimate |
|------|----------|
| Hybrid stake + register API wiring in UI | **2–3 days** |
| Balance/bond UX + error mapping | **1 day** |
| CAAC step (optional for register, required for daemon) | **+1–2 days** |
| QA / genesis hash / nonce parity | **1 day** |
| **Subtotal** | **~4–7 dev-days** (1 sprint slice) |

### Safety: testnet “register → immediately earn”?

| Policy | Pros | Cons |
|--------|------|------|
| **A) Manual ops (current)** | No false product promise | Poor DX |
| **B) UI register + stake, earn still ops** | Honest staging | Steve’s friends need RUNNING_A_NODE doc |
| **C) UI full earn path** | Demo-ready | Needs async settlement + daemon docs ([`WORKER_MODE_AUDIT.md`](./WORKER_MODE_AUDIT.md)) |

**Recommendation for Phase 0 testnet:** **B** — allow UI stake+register with clear “daemon runs on your tet-core” banner; **do not** imply browser-only mining.

---

# Part 2 — Worker stake bond (1000 TET)

## 2.1 Constants (critical: two stake systems)

| Constant | Value | Tree / API | Used for |
|----------|-------|------------|----------|
| `MIN_WORKER_STAKE_MICRO` | `1_000 * STEVEMON` (**1000 TET**) | `worker_stakes` sled tree | **`is_active_worker`**, register, enterprise, P2P (`ledger.rs:120`, `2592-2593`) |
| `WORKER_MIN_STAKE_MICRO` | `5_000 * STEVEMON` (**5000 TET**) | meta `wallet_stake_*` | Legacy `/wallet/stake` only (`ledger.rs:117`) |
| `MIN_STAKE_AMOUNT_MICRO` | alias of `MIN_WORKER_STAKE_MICRO` | — | `ledger.rs:127` |

**Footgun:** Staking via **`POST /wallet/stake`** does **not** increment `worker_bond_micro` (`wallet.rs:294` → `stake_micro` `ledger.rs:2489-2573`). User can stake 5000 TET legacy and still get **`WORKER_NOT_STAKED`** on register.

## 2.2 `MIN_WORKER_STAKE_MICRO` references

| Location | Behavior if bond insufficient |
|----------|------------------------------|
| `worker.rs:61-90` | Register forbidden |
| `ledger.rs:2592-2593` `is_active_worker` | `false` |
| `enterprise.rs:160-170` | Drop worker from registry; `WORKER_NOT_STAKED` |
| `p2p_network.rs:740-745` | Reject `InferenceResult` gossip |
| `vision.rs:71-78` | CAAC complete forbidden |
| `consensus.rs:558` | Slash on invalid ZK (bond to ecosystem) |
| `zk_court.rs:473+` | Full bond slash on guilty verdict |

## 2.3 Lock mechanism

### Stake endpoint

| Route | Handler | Ledger fn |
|-------|---------|-----------|
| `POST /ledger/stake` | `post_ledger_stake` (`ledger.rs:1344-1346`, `routes.rs:165-166`) | `stake_worker_bond_micro` (`ledger.rs:2597-2679`) |

**Request:** `WalletStakeSignedReq` (`types.rs:76-86`):

- `wallet_id` (64 hex enforced in handler `ledger.rs:1238-1240`)
- `amount_tet` (float → micro)
- `nonce` (> 0)
- `ed25519_sig_hex` over **`worker_bond_stake_hybrid_auth_message_bytes`** (`wallet.rs:387-400`, verify `ledger.rs:1258-1264`)
- `mldsa_pubkey_b64` + `mldsa_sig_b64` (hybrid)

**Success 200:**

```json
{
  "wallet_id": "...",
  "moved_micro": <u64>,
  "worker_bond_micro": <new total bond>,
  "min_active_worker_bond_micro": 1000000000
}
```

(`ledger.rs:1270-1277` — micro = 1e6 per TET).

### Where locked TET lives

| Slot | Spendable? | Notes |
|------|------------|-------|
| `balances[wallet]` | **Reduced** by stake amount | Liquid balance decreases (`ledger.rs:2653-2656`) |
| `worker_stakes[wallet]` | **Locked bond** | Encrypted u64 micro (`ledger.rs:314`, `2576-2588`, comment `314`) |
| `system:worker_pool` | N/A | Unrelated sentinel; coinbase debits (`ledger.rs:36-37`) |

Stake uses **spendable** = `balance - locked_balance_micro(vest/founder locks)` (`ledger.rs:2612-2640`).

### Unstake endpoint

| Route | Handler | Ledger fn |
|-------|---------|-----------|
| `POST /ledger/unstake` | `post_ledger_unstake` (`ledger.rs:1351-1353`) | `unstake_worker_bond_micro` (`ledger.rs:2683-2762`) |

Moves micro from `worker_stakes` → `balances` (`ledger.rs:2736-2742`). Same hybrid auth with `worker_bond_unstake_hybrid_auth_message_bytes` (`wallet.rs:404-417`).

**Conditions:** `cur_bond >= amount_micro`; nonce monotonic. **No explicit “cooldown”** in unstake fn (inference: unstake anytime if bond sufficient).

After unstake below 1000 TET: `is_active_worker` false → enterprise evicts registry (`enterprise.rs:160-162`).

## 2.4 Slash vs §14.1

| Function | Bond destination | Supply |
|----------|------------------|--------|
| `slash_worker_bond_to_ecosystem_all` | `WALLET_ECOSYSTEM` balance | Unchanged (transfer) `ledger.rs:3043-3098` |
| `slash_worker_bond_zk_court_burn_all` | Burned | `META_TOTAL_SUPPLY` reduced `ledger.rs:2795-2862` |
| ZK-Court pipeline default | `slash_worker_bond_to_ecosystem_all` via `apply_slash_verdict` (`zk_court.rs:423+`, `473`) | |
| Invalid `VerifyZkProof` in block | `slash_worker_bond_to_ecosystem_all` on signer (`consensus.rs:556-559`) | |

**Alignment:** Implementation = **100% liquid bond** forfeited (`tests.rs:3066-3090`), not `min(bond, λ × R_expected)` ([`WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md)).

---

## 2.5 UI (stake)

| Item | Status |
|------|--------|
| Stake UI | **No** — no `ledger/stake` in `tet-network/ui` |
| Send Coins | `transfer.ts` — **transfer only**, not bond (`grep` UI lib) |
| Showing “1000 TET stake” | Needs new wizard + copy; read bond from stake response or new API |

### Founder 2.5B TET vs worker stake

| Topic | Detail |
|-------|--------|
| Founder premine | `GENESIS_FOUNDER_SHARE_MICRO` = 2.5B TET (`ledger.rs:43-45`) |
| Founder lock | `locked_balance_micro` subtracts from spendable until cliff (`ledger.rs:4337-4351`, `META_FOUNDER_GENESIS_LOCKED_MICRO` `146-147`) |
| Worker stake | **Independent** — user wallet moves **own** liquid balance to `worker_stakes` |
| Founder as worker | **Forbidden** register (`worker.rs:33-44`). Founder can still stake bond technically, but not heartbeat as worker. |

**Inference:** Steve’s founder wallet should not be used for worker demos; use a **fresh test wallet**.

---

## 2.6 Phase 0 policy decisions (for Steve)

### Testnet stake: 1000 TET vs 0 TET

| Option | Implementation | Recommendation |
|--------|----------------|----------------|
| Keep **1000 TET** | Const change hard — needs code + genesis economics review | **Default** — matches Sybil story |
| **0 TET testnet** | `MIN_WORKER_STAKE_MICRO = 0` or env override (not present today) | **1-line const + env** for devnet only — **~2h** if Steve wants friend onboarding |
| Guardian grant | 10k TET once (`ledger.rs:109-110`) — still must **`/ledger/stake` 1000** after | Good bootstrap, confusing UX |

### Mainnet (Phase 1 open problem)

- Keep 1000 TET vs bonded USD peg — **product**, not coded.
- Consider env `TET_MIN_WORKER_BOND_MICRO` (not in codebase today — **would be new**).

### Spam vs UX

| Lever | Effect |
|-------|--------|
| 1000 TET bond | Sybil expensive |
| No signed register | Bond is only gate — **weak** if testnet faucet is generous |
| Registry RAM-only | Restart clears workers — **UX** glitch, not security |
| Genesis guardian 10k grant | Helps funding, not bond bypass |

---

# Part 3 — End-to-end scenario (Mac friend, ~1 hour)

| Step | 現状 | Phase 0 needs | Phase 0.5 needs | Effort (order) |
|------|------|---------------|-----------------|----------------|
| **a.** Open UI | **動く** — `/os` `OsClient.tsx` | — | — | — |
| **b.** "Become Worker" | **未実装** | Wizard shell + CTA | Polish | **0.5–1 d** |
| **c.** Balance ≥ 1000 TET | **Partial** — `GET /ledger/me`, faucet `claim_initial_airdrop` | UI check + faucet CTA | — | **0.5 d** |
| **d.** Stake bond lock | **Partial** — API only `POST /ledger/stake` | UI hybrid stake module | — | **2–3 d** |
| **e.** Register network | **Partial** — API `POST /worker/register` | UI heartbeat + hardware_id | Persist registry optional | **1–2 d** |
| **f.** Daemon runs | **Partial** — only if user runs **TET-Core** locally with env (`main.rs:612-618`, `worker_daemon.rs:54-73`) | Doc only in P0 | Installer / script “start worker node” | **P0: doc 0.5d**; **P0.5: script 2–3 d** |
| **g.** Receive task | **Partial** — needs enterprise demand + registry online | — | Demand faucet / test job UI | **3–5 d** (network effect) |
| **h.** Reward to wallet | **未実装** (async path) — see [`WORKER_MODE_AUDIT.md`](./WORKER_MODE_AUDIT.md) | — | Ledger settle on VerifyZkProof | **5–8 d** backend |
| **i.** Unstake → spendable | **Partial** — `POST /ledger/unstake` | UI unstake button | — | **1 d** |

### “1 hour realistic” assessment

| Scope | Realistic in 1 hour? |
|-------|----------------------|
| **Phase 0 today** | **No** — CLI/manual only for b–e; no earn |
| **Phase 0 + UI stake/register** | **Partial** — friend can register if pre-funded + technical guide; **no earn** |
| **Phase 0.5 + settlement + ops script** | **Partial** — power users with Ollama + RISC0 build |
| **True 1-click earn** | **Phase 1** class (remote inference, rewards, hosted daemon) |

---

# Part 4 — Ship recommendation & Sprint load

## 4.1 Phase 0 vs Phase 0.5 for “1-click worker start”

| Deliverable | Phase 0 | Phase 0.5 |
|-------------|---------|-----------|
| UI stake + register | Optional **hidden beta** | **Yes** (primary) |
| CAAC + daemon docs | Link only | Scripted |
| Earn TET | **No promise** | Settlement fix + demo demand |
| `MIN_WORKER_STAKE` testnet override | Steve decision | Env toggle |

**Recommendation:** **Phase 0.5** for any “Become Worker” marketing. Phase 0: **do not** ship 1-click; keep Worker tab **monitor-only** or hide behind feature flag.

## 4.2 Effort & risk sum

| Work package | Dev-days | Risk |
|--------------|----------|------|
| UI bond stake + unstake (hybrid) | 3–4 | Genesis hash / nonce drift (UI-P0-1 class) |
| UI register + hardware_id | 2–3 | Wrong `/wallet/stake` footgun |
| CAAC wizard | 2 | 50ms POC default → false POR |
| Ops: tet-core + Ollama + guest ELF doc | 1–2 | RISC0 build time |
| Async worker payout (backend) | 5–8 | Economic correctness |
| Registry persistence | 3–5 | Restart UX |
| **Total Phase 0.5 MVP** | **~15–22 d** | **~1.5–2 sprints** |

**Risk sum:** Product liability if “Start Mining” stays (`OsClient.tsx:2353`) without backend earn; Sybil if testnet faucet + no signed register; **dual stake APIs** confusing integrators.

## 4.3 If forced into Phase 0 (Sprint 4/5 add-on)

Minimal slice (~**5–7 dev-days**):

1. `UI-P0-4a` — `worker_bond.ts` + stake/unstake in Worker tab (**must use `/ledger/stake`**).
2. `UI-P0-4b` — register heartbeat loop + hardware_id from TS port of `tet_worker/mod.rs:10-35`.
3. Copy fix — rename “Start Mining” → “Connect to node logs” (`OsClient.tsx:2347`).
4. `docs/RUNNING_A_NODE.md` — “Friend worker setup” section (stake → register → run tet-core).
5. **Explicit non-goals:** earn, CAAC automation, browser daemon.

**Do not** add Sprint 4/5 earn settlement without ledger review (scope creep).

---

# Appendix — Steve decision checklist

1. **Testnet `MIN_WORKER_STAKE_MICRO`:** keep 1000 TET vs env=0 for friends?
2. **Register auth:** add Ed25519 proof on `wallet` field before mainnet?
3. **Deprecate `/wallet/stake` for workers** in docs/UI (only `/ledger/stake`)?
4. **Phase 0 UI:** hide Worker tab vs beta wizard with “no earn yet”?
5. **Guardian grant UX:** auto-prompt stake 1000 after 10k grant?
6. **Registry persistence:** Phase 0.5 sled write vs accept restart re-register?

---

*Audit complete. No git commit.*
