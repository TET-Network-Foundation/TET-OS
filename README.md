# TET-Core — Tradable Energy Token (TET)

TET-Core is the reference node implementation for the TET network: a stake-gated worker registry, a persistent ledger, and demand-side APIs (consumer + enterprise) that settle payments using a deterministic 80/15/5 split.

## Quick start

### Prerequisites

- Rust toolchain (stable)
- Node.js (18+ recommended)

### Build

```bash
cargo build
npm install
npm run build-wallet-client
```

### Run (local)

```bash
# default bind: 127.0.0.1:5010 (override with `TET_REST_BIND=0.0.0.0:5010` in containers)
cargo run
```

Open:

- `http://localhost:5010/` — public landing page (`tet-core/src/index.html`)
- `http://localhost:5010/app` — worker app (`worker_dashboard.html`)
- `http://localhost:5010/worker_dashboard.html` — legacy deep link (301 → `/app`)
- `http://localhost:5010/core` — legacy core UI (`tet-core/src/ui.html`)

## Persistence & safety

### Ledger persistence

The ledger is **persistent on disk** via **sled** (`tet.db` by default). On restart, the node re-opens the database and state remains intact.

Additionally, the node writes a best-effort **JSON snapshot** to support crash-safe restore pathways.

Key locations:

- Ledger DB dir: `TET_DB_DIR` (default: `tet.db`)
- Snapshot JSON path: `TET_LEDGER_JSON_PATH` (optional; otherwise derived from DB dir)

### Graceful shutdown

The HTTP server uses graceful shutdown on **SIGTERM/SIGINT/CTRL-C** and will:

- flush sled to disk
- write the JSON snapshot (best effort)

This is implemented in `tet-core/src/rest.rs` and called automatically when the process receives a termination signal.

## Tokenomics (core rules)

### Units (Micro‑TET)

Internally, TET uses micro units (`STEVEMON = 100_000_000` micro per 1 TET). SDKs convert decimal inputs into micro units without float precision loss.

### AI settlement split (golden rule)

For demand-side payments settled through `settle_ai_utility_payment()`:

- **80%** → worker
- **15%** → `dex:treasury`
- **5%** → burned (reduces total supply)

Implementation: `tet-core/src/ledger.rs` (`settle_ai_utility_payment`)

## Genesis Guardians

The system auto-grants a fixed amount to the first N workers from `system:worker_pool`.

Current settings (see `tet-core/src/ledger.rs`):

- Guardians total: `GENESIS_GUARDIANS_TOTAL = 10_000`
- Grant per guardian: `GENESIS_GUARDIAN_GRANT_MICRO = 10_000 TET`

Worker heartbeat registration endpoint: `POST /worker/register`

## Enterprise API

### Route

- `POST /enterprise/inference`

### Security model

- Uses `SignedTxEnvelopeV1` (`tet-core/src/protocol.rs`)
- Enterprise jobs are **crypto-bound**: signatures cover the canonical message
  `tet enterprise inference v1|wallet|nonce|amount_micro|prompt_sha256_hex|model|attestation_required|mldsa_pubkey_b64`
- Server validates that `prompt` hashes to `prompt_sha256_hex` (anti-swap)
- Optional routing constraint: `attestation_required=true` routes only to workers with a verified founding certificate

## SDKs

### Browser SDK

- `tet-core/src/tet_sdk.js`
- served at `GET /assets/tet_sdk.js`

### Node.js SDK (ESM)

- `tet-core/src/tet_sdk_node.mjs`
- served at `GET /assets/tet_sdk_node.mjs`

Example (Node 18+):

```js
import { TetEnterpriseSDK } from "./assets/tet_sdk_node.mjs";
const tet = new TetEnterpriseSDK(process.env.TET_MNEMONIC, { coreBase: process.env.TET_CORE_BASE });
console.log(await tet.inference({ prompt: "Draw a futuristic city", amount: "0.001", model: "TET-Vision-v1" }));
```

## Stateless identity (CRITICAL)

TET-Core is a **stateless public node**. The server never stores an "active wallet" per client.

- **Query identity**: `GET /ledger/me?wallet_id=<64hex>`
- **Header identity**: `x-tet-wallet-id: <64hex>`

Endpoints that require identity will reject requests without either:

- `wallet_id` query param (where documented), or
- `x-tet-wallet-id` header

Identity-sensitive endpoints (non-exhaustive):

- `GET /ledger/me?wallet_id=...` (**required**)
- `GET /genesis/1000/status?wallet_id=...` (**required**)
- `POST /genesis/1000/claim` (requires `x-tet-wallet-id` + hybrid sig headers)
- `POST /ai/utility` (requires `x-tet-wallet-id`)
- `POST /ledger/mint_demo` (requires `x-tet-wallet-id` + hybrid sig headers)
- `GET /founder/audit.csv` (requires `x-api-key` + `x-tet-wallet-id` matching configured founder)

## Development notes

### Tests

```bash
cargo test
```

### Code layout

- `tet-core/src/ledger.rs` — persistent ledger (balances, locks, staking, tokenomics)
- `tet-core/src/rest.rs` — HTTP API and routing
- `tet-core/src/protocol.rs` — `SignedTxEnvelopeV1` / `TxV1`
- `tet-core/src/wallet.rs` — canonical signature message builders + verification helpers
- `tet-core/src/worker_ai.rs` — local inference + model download state
- `worker_dashboard.html` — worker UI
- `tet-core/src/ui.html` + `tet-core/src/ui.js` — core UI

