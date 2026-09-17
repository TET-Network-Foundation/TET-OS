# Archived — Substrate-era crates

**Archived:** 2026-09-17
**Status:** Dead. Not built, not referenced, not in any workspace.

These two crates are the last surviving fragments of the original **Substrate**
implementation, which was replaced by the custom Rust L1 in `tet-core/`. The bulk of
the Substrate tree (`tet-core-node/`, `tet-network/chain/`) was deleted in
[`32f8eee`](https://github.com/TET-Network-Foundation/TET-OS/commit/32f8eee) (2026-05-20);
these two were missed and stayed tracked until now.

| Path | Was | Why it is dead |
|------|-----|----------------|
| `primitives/` | `tet-primitives` — `parity-scale-codec` + `scale-info` + `sp-core` + `dilithium-rs` pallet primitives | Substrate runtime types. The current ledger uses `sled` + Borsh/serde, not SCALE. |
| `services-tet-core/` | A `subxt` RPC client service | Talks to a Substrate node over RPC. No Substrate node exists. |

## Why archived rather than deleted

Both were git-tracked, so `git rm` would have preserved them in history — but the
specific hazard here is a **name collision**: `services-tet-core` declares
`name = "tet-core"`, the same crate name as the real L1 node. Anyone grepping the tree
for `tet-core` hit two unrelated crates. Moving it under `archive/substrate/` removes
the collision while keeping the code greppable without git archaeology — which is the
failure mode that made this repository hard to reconstruct in the first place
(see `docs/TET_STATE_2026-09.md` §1.1).

Total cost of keeping them: 479 lines.

## Do not reintroduce

Neither crate is in the root `Cargo.toml` workspace — each declares its own
`[workspace]` key, so they were never built by `cargo build` at the repo root.
They are kept for reference only.
