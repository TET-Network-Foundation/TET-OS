# TET Network UI — Phase 0 Ship Status (Sprint 2 alignment)

**Date:** 2026-05-19  
**Scope:** Static analysis of `tet-network/ui` only (no runtime / no UI server started).  
**Backend reference commit:** `68a4b94` (Phase 2B + 2C on `main`).  
**Related:** [`RUNNING_A_NODE.md`](./RUNNING_A_NODE.md), [`CODEBASE_OVERVIEW.md`](./CODEBASE_OVERVIEW.md), [`WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md)

---

## 1. UI overview

| Item | Value |
|------|--------|
| **Path** | `tet-network/ui/` |
| **Framework** | **Next.js 16.1.6** (App Router, `app/` directory) |
| **UI library** | React **19.2.3**, Tailwind CSS **4** |
| **Crypto / wallet** | `@polkadot/keyring`, `@polkadot/util-crypto`, `bip39` (in-app mnemonic wallet) |
| **Primary product surface** | **Sovereign OS** — single large client component `app/os/OsClient.tsx` (~2.9k lines) at `/os` |
| **API access** | Browser → `tet_core_http.ts` → direct `NEXT_PUBLIC_TET_CORE_URL` **or** same-origin proxy `/tet-node-api/*` → TET-Core Axum REST |

### Directory layout (effective)

```
tet-network/ui/
├── app/
│   ├── os/              # Main desktop UI (OsClient.tsx)
│   ├── page.tsx         # Wallet onboarding wizard → /os
│   ├── explorer/        # Redirects to /os (legacy routes)
│   ├── worker/          # Redirects to /os
│   ├── api/             # Next routes (ollama, tet infer proxy helpers)
│   ├── tet-node-api/    # Reverse proxy to TET-Core
│   ├── components/      # TopNav only
│   └── lib/             # HTTP client, chain_binding, hybrid signing, i18n, …
├── package.json
└── next.config.ts
```

There is **no** top-level `pages/`, `hooks/`, or `components/` tree beyond `TopNav`. Logic lives in `app/lib/*` and `OsClient.tsx`.

### Build / TypeScript (static)

| Check | Result |
|-------|--------|
| `npm run build` (`next build`) | **PASS** (2026-05-19) |
| TypeScript | **No errors** reported during build |
| `npm run lint` | **Not run** (out of scope) |

Default API base when env unset: **`/tet-node-api`** (proxied to `127.0.0.1:5010` etc. via `app/tet-node-api/[...path]/route.ts`).

---

## 2. Major screens and features

| Route / tab | Purpose | Notes |
|-------------|---------|--------|
| `/` | Mnemonic wallet create / import / PIN | Redirects to `/os` after unlock |
| `/os` | **Sovereign OS** (all primary features) | See tabs below |
| `/explorer`, `/worker` | Legacy URLs | **`redirect("/os")`** |
| `/whitepaper`, `/understand`, `/participate`, `/setup` | Marketing / onboarding copy | Little or no live chain coupling |
| `/create-wallet` | Wallet helper | Redirect / wizard related |

### Tabs inside `/os` (`OsClient.tsx`)

| Tab | Function |
|-----|----------|
| **Transactions** | Local tx history + explorer event–derived transfers |
| **Send Coins** | UI form; **does not** call `POST /ledger/transfer` |
| **Inbox / Receive** | Incoming transfer display (audit events) |
| **Address Book** | Local address book |
| **AI Task Terminal** | Enterprise inference submit (`/enterprise/inference/submit`), hybrid-signed |
| **Explorer** | Block search, latest blocks table, network stats cards |
| **Worker** | Worker cockpit, GPU mining CTA, CAAC line, stats poll |

**Heartbeat / status bar:** shows `● LIVE` when `GET /status` succeeds — **not** ledger P2P `synced` from `/ledger/state`.

---

## 3. REST API matrix (screen × endpoint)

Base paths may use vision aliases (`/v1/vision/...`) with fallback to legacy (`/ledger/...`, `/network/...`). Proxy: `/tet-node-api`.

| Endpoint | Used by | Purpose |
|----------|---------|---------|
| `GET /status` | OS telemetry loop | **Chain “LIVE”** gate (HTTP reachability only) |
| `GET /network/stats` or `/v1/vision/network/stats` | Explorer tab, telemetry | Supply, burn, `consensus_block_height`, worker pool balance |
| `GET /market/index` or `/v1/vision/market/index` | Telemetry fallback | `total_supply_micro` |
| `GET /ledger/blocks` | Explorer tab | Recent blocks (UI shows **8** of **20** returned) |
| `GET /ledger/block/:height` | Explorer search | Block detail + txs |
| `GET /explorer/tx/:hash` | Explorer search | Tx detail |
| `GET /explorer/events` | Telemetry, Transactions, Inbox | Audit log / transfers |
| `GET /ledger/me?wallet_id=` | Wallet balance poll | **`balance_micro_tet`** (not `/ledger/balance/{wallet}`) |
| `POST /ledger/initial_airdrop/claim` | Welcome flow | Hybrid-signed claim |
| `POST /enterprise/inference/submit` | AI Task | Hybrid-signed inference |
| `POST /ai/infer`, `GET /ai/nonce` | Legacy / alternate infer paths | Present in client lib |
| `GET /worker/stats/:wallet` | Worker tab | Worker stats |
| `GET /worker/cockpit/:wallet` | Worker tab | Cockpit JSON |
| `GET /v1/vision/network/config` | Telemetry | `connected_peers` (not sync lag) |
| `GET /v1/vision/pqc/status` | Options / diagnostics | PQC probe |
| `GET /v1/vision/thermo/genesis` | **Defined in client, unused in OsClient** | Thermo metadata |
| `GET /ledger/state` | — | **Not called anywhere in UI** |
| `GET /ledger/balance/:wallet` | — | **Not called** (uses `/ledger/me` instead) |
| `POST /ledger/transfer` | — | **Not called** (Send Coins is stub) |
| `POST /tx/submit` | — | **Not called** |

---

## 4. Sprint 2 breaking changes — follow-up status

### 4.1 Genesis hash includes Treasury address (B.2)

| | |
|-|-|
| **Impact** | **あり — P0 blocker** for any hybrid-signed L1 message unless env workaround |

**Evidence:** `app/lib/chain_binding.ts` builds genesis hash locally when `NEXT_PUBLIC_TET_GENESIS_HASH` is unset:

```text
# UI (current) — excerpt of payload fields
|ecosystem=${WALLET_ECOSYSTEM}|ecosystem_micro=...
|worker_pool=system:worker_pool|...

# tet-core (Phase 2B) — deterministic_genesis_hash()
|treasury=${treasury_wallet_id}|treasury_micro=...
|worker_pool=000...0001|  (WALLET_WORKER_POOL sentinel)
```

**Affected UI flows:**

- `expectedChainBinding()` → enterprise inference (`tet_core_http.ts`)
- AI infer hybrid (`ai_infer_hybrid.ts`)
- Initial airdrop claim hybrid (`postInitialAirdropClaim`)

**Mitigation today:** set `NEXT_PUBLIC_TET_GENESIS_HASH` to the **exact** hash from a running node (`ledger.genesis_hash()` or startup logs). UI does **not** read hash from `GET /ledger/state` or `/status`.

**Not present in UI:** `NEXT_PUBLIC_TET_TREASURY_ADDRESS` (treasury is node-only; correct for operators, invisible to UI).

---

### 4.2 `/ledger/state` sync object extension (Phase 2A)

| | |
|-|-|
| **Impact** | **あり — P0** for “show sync status” MVP; **なし** for read-only explorer if user only cares that blocks load |

**Evidence:**

- No references to `/ledger/state`, `sync.lag_blocks`, `sync.active`, or `sync.in_progress_request` in `tet-network/ui`.
- `ChainConnectionStatus` in `tet_core_http.ts` is only `"connecting" | "synced" | "disconnected"`.
- `OsClient.tsx` sets `chainStatus = "synced"` when `GET /status` returns OK — **orthogonal** to ledger `synced: false` during catch-up.

**Risk:** UI shows **● LIVE** while node is still behind peers (`lag_blocks > 0`), misleading for testnet operators.

---

### 4.3 Coinbase 25/50/25 + Treasury receiver (B.2)

| | |
|-|-|
| **Impact** | **なし** for balances; **部分** for block “coinbase detail” accuracy |

**Evidence:**

- Block detail uses `GET /ledger/block/:height` → `block` + `txs[]` only. No `reward` or `coinbase_receivers` in `LedgerBlockDetailJson`.
- Empty tx list labeled `(coinbase-only block)` — still correct for coinbase-only blocks.
- Treasury mint is **not** surfaced in UI (no treasury address field, no genesis allocation breakdown).
- Audit `block_reward_v1` / `coinbase_receivers` in node logs are **not** parsed in Explorer.

---

### 4.4 `GET /ledger/balance/{wallet}` unchanged

| | |
|-|-|
| **Impact** | **なし** |

UI never called this path; it uses `GET /ledger/me?wallet_id=`.

---

### 4.5 `POST /ledger/transfer` unchanged

| | |
|-|-|
| **Impact** | **なし** (transfer was already not implemented) |

`onSendCoins()` only appends ledger log text; optional `POST` to middleware `/execute` for memo demo — **not** L1 transfer.

---

## 5. Phase 0 ship MVP — coverage

| MVP requirement | Status | Notes |
|-----------------|--------|--------|
| **Sync status** (`synced` or syncing + lag) | **未実装** | Uses `/status` LIVE only; `/ledger/state` unused |
| **block height visible** | **部分実装** | Explorer: latest table + `consensus_block_height` from network stats; no dedicated tip banner |
| **state_root visible** | **部分実装** | Per-block in Explorer table (truncated) and block detail (full) |
| **Recent N blocks** | **部分実装** | **8** rows hard-coded (`slice(0, 8)`); API returns up to **20** |
| **Wallet balance** | **実装済み** | `/ledger/me` every ~5s when wallet unlocked |
| **Transfer** | **未実装** | Send Coins tab is placeholder; hybrid xfer signing not wired |

---

## 6. Recommended fixes (estimate)

| ID | Fix | Size | Priority | Suggested sprint |
|----|-----|------|----------|----------------|
| **UI-P0-1** | Align `chain_binding.ts` with tet-core `deterministic_genesis_hash(founder, treasury)`: `treasury` field, worker pool sentinel `000…0001`, `NEXT_PUBLIC_TET_TREASURY_ADDRESS` support | **M** | **P0** | Phase 0 ship hotfix (Sprint 2.5 or pre-ship patch) |
| **UI-P0-2** | Poll `GET /ledger/state`; map `synced`, `sync.lag_blocks`, `sync.active` to status bar (replace or augment LIVE) | **M** | **P0** | Same |
| **UI-P0-3** | Wire **Send Coins** → hybrid `POST /ledger/transfer` (reuse wallet session + `transfer_hybrid_auth_message_bytes` parity with core) | **L** | **P0** | Phase 0 ship or Sprint 3 |
| **UI-P1-1** | Optional `NEXT_PUBLIC_TET_GENESIS_HASH` auto-fetch from node `/status` or dedicated config endpoint | **S** | **P1** | Sprint 3 |
| **UI-P1-2** | Show tip `state_root` + height from `/ledger/state` on Explorer header | **S** | **P1** | Sprint 3 |
| **UI-P1-3** | Increase recent blocks list (use full 20 or N env); link row → block detail | **S** | **P1** | Sprint 3 |
| **UI-P2-1** | Block reward / coinbase breakdown (needs REST extension or audit parse) for 25/50/25 visibility | **L** | **P2** | Post–Phase 0 (API design with core) |
| **UI-P2-2** | Treasury allocation display on setup / network panel | **S** | **P2** | Post–Phase 0 |
| **UI-P2-3** | Re-enable dedicated `/explorer` routes (currently redirect) for deep links | **S** | **P2** | Backlog |

**Size key:** S ≈ hours, M ≈ 0.5–1 day, L ≈ 2–3 days.

---

## 7. Phase 0 ship blockers (summary)

1. **Genesis hash drift (UI-P0-1)** — Hybrid-signed inference, airdrop claim, and enterprise flows will **fail signature verification** on a fresh Phase 2B node unless operators manually set `NEXT_PUBLIC_TET_GENESIS_HASH`. This is the highest-risk functional break.
2. **False “LIVE” sync indicator (UI-P0-2)** — Operators cannot see catch-up / lag; conflicts with [`RUNNING_A_NODE.md`](./RUNNING_A_NODE.md) troubleshooting that references `/ledger/state`.
3. **Transfer not wired (UI-P0-3)** — Explicit Phase 0 MVP gap; i18n still says “wiring … next”.

**Non-blockers for read-only explorer demos:** recent blocks, state roots, balance via `/ledger/me`, block/tx search — **work** if node is up and CORS/proxy is configured, even without genesis hash fix (until user triggers signed POST).

---

## 8. Verification notes for Steve

| Question | Answer |
|----------|--------|
| Section 3 Docker in `RUNNING_A_NODE.md` still valid? | **Yes** — `tet-core/README.md` documents `docker compose up` for `tet-node-1`…`3`. |
| Run UI against 3-node testnet without code changes? | **Possible** for read-only; set `NEXT_PUBLIC_TET_GENESIS_HASH` + `NEXT_PUBLIC_TET_CORE_URL` (or proxy). |
| `npm run build` sufficient for CI gate? | **Yes** for compile; E2E still **UNKNOWN** (not run). |

---

## 9. Related docs

- [`RUNNING_A_NODE.md`](./RUNNING_A_NODE.md) — node env, `/ledger/state` semantics  
- [`CODEBASE_OVERVIEW.md`](./CODEBASE_OVERVIEW.md) — monorepo map  
- [`STATUS.md`](./STATUS.md) — WP vs implementation matrix  
- [`tet-core/README.md`](../tet-core/README.md) — Docker quick start  
