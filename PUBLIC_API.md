# TET Public API (Stub)

This document defines the public developer surface for TET's **Supercompute** gateway.

## Authentication

All requests must include:

- Header: `x-api-key: <TET_API_KEY>`

If `TET_API_KEY` is not configured server-side, the gateway will return `503`.

## Base URL

Default local:

- `http://localhost:5010`

## Stateless identity (CRITICAL)

TET-Core is a **stateless public node**. The server does not keep an "active wallet" per HTTP client.

Identity-based endpoints require **either**:

- **Query param**: `wallet_id=<64-hex Ed25519 public key>` (e.g. `GET /ledger/me?wallet_id=...`), or
- **Header**: `x-tet-wallet-id: <64-hex Ed25519 public key>` (for POST/secured flows)

If the required identity field is missing/invalid, the request is rejected.

## 1) Network power & tokenomics stats

### `GET /network/power`

Returns the same economic fields as `GET /network/stats` (backward-compatible shape: `NetworkPowerSnapshot`).

### `GET /network/stats`

Ledger-backed tokenomics for dashboards: active workers (heartbeat TTL), TFLOPS sum, cumulative burn, community mint, total supply cap, and an **algorithmic** `tet_price_usd` (pre-sale floor `tet_presale_usd`, default **0.05**, overridable with `TET_PRESALE_USD_PER_TET`). With **zero** active workers, `tet_price_usd` equals the pre-sale floor (stable demos — no RNG).

**Response (JSON)**:

```json
{
  "total_compute_tflops": 16.0,
  "active_worker_nodes": 2,
  "community_stevemon_earned_micro": 123000000,
  "total_burned_micro": 5000000000,
  "tet_price_usd": 0.0525,
  "tet_presale_usd": 0.05,
  "total_supply_micro": 1000000000000000000
}
```

## 2) Supercompute Orchestration

### `POST /v1/compute`

Runs a compute job through sharding → verification → aggregation → reward (stub).

**Request (JSON)**:

```json
{
  "plugin": "ai_inference",
  "model": "tet/poc",
  "input": "your prompt or dataset",
  "shard_chars": 1200,
  "redundancy": 1,
  "geo": "CH",
  "payment": { "v": 1, "tx": { /* ... */ }, "sig": { /* ... */ }, "attestation": { /* ... */ } }
}
```

**plugin values**

- `ai_inference`
- `video_render` (uses `frames_total`, `shard_frames`)
- `scientific_compute` (uses `grid_w`, `grid_h`, `tile_w`, `tile_h`)

**Response (JSON)**: includes shard plan and merged output.

## 3) Worker Registration

### `POST /worker/register`

Registers or heartbeats a worker node.

```json
{
  "wallet": "worker-wallet-id",
  "hardware_id_hex": "hardware-id-hex",
  "ed25519_pubkey_hex": "ed25519-pubkey-hex",
  "tflops_est": 8.0
}
```

## 4) Sovereign Push (Auto-Update Stub)

### `GET /system/update`

Workers poll this endpoint for signed updates.

Requires env:

- `TET_UPDATE_VERSION_HASH`
- `TET_UPDATE_SIG_B64`
- `TET_FOUNDER_WALLET` (signature pubkey)

Response:

```json
{
  "version_hash": "sha256:...",
  "sig_b64": "....",
  "signer_pubkey_hex": "....",
  "note": "Workers should self-update when version_hash changes."
}
```

