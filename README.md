# TET Network

Post-quantum Layer 1 (ML-DSA), AI-native workloads, and hardware-adaptive consensus — implemented primarily in Rust (`tet-core`).

> ⚠️ **Phase 0 Alpha**: TET Network is in active development. The current
> codebase is a developer preview targeting Phase 0 public testnet launch.
> The whitepaper specification may be updated to v1.1 before mainnet.
> See [docs/RUNNING_A_NODE.md](docs/RUNNING_A_NODE.md) for known limitations
> and operational guidance.

## Canonical Components

- `tet-core/` — Sovereign Layer 1 node (Rust). **The canonical L1.**
- `tet-network/ui/` — Sovereign OS frontend (Next.js)
- `tet-agent-sdk/` — M2M agent client (TypeScript)
- `tet-pqc-wasm/` — Post-quantum signature WASM (ML-DSA-44)
- `methods/`, `prover/` — RISC0 zkVM foundation for ZK-Court

## Archived (removed from repo)

Substrate / Solana experiments and the legacy `nexus network/` tree were **removed from this repository** (2026-05-20) to reduce clone size and CI noise. Canonical L1 is **`tet-core/`** only.

| Former path | Was |
|-------------|-----|
| `tet-core-node/` | Substrate node template |
| `tet-network/chain/` | Duplicate Substrate chain template |
| `nexus-onchain/` | Solana Anchor experiment |
| `nexus network/` | Legacy nested copies |

To recover sources, check git history before the removal commit on `main`.

## Quick Start

See [`tet-core/README.md`](./tet-core/README.md) to run a node in 5 minutes.

### Local testnet (Docker)

```bash
cd tet-core
docker compose up -d
sleep 30
curl http://localhost:5010/ledger/state
curl http://localhost:5020/ledger/state
# UI: http://localhost:3000
```

## Further reading

- [`WHITEPAPER.md`](./WHITEPAPER.md) — **Genesis Draft v1.0** canonical protocol (CAAC, PoC/PoR, Sovereign Runtime, ZK-Court, ML-DSA)
- [`GENESIS_V1.md`](./GENESIS_V1.md) — English manuscript (same body as `WHITEPAPER.md`)
- [`archive/LITEPAPER_v0.md`](./archive/LITEPAPER_v0.md) — deprecated short overview (v0 economic framing)
- [`docs/WHITEPAPER_V1.1_GAPS.md`](./docs/WHITEPAPER_V1.1_GAPS.md) — v1.1 discussion gaps
- [`PUBLIC_API.md`](./PUBLIC_API.md) — public HTTP surface summary
