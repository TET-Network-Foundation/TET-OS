# TET Network — Whitepaper vs Implementation Status

**Generated:** 2026-05-18 (updated for Genesis Draft v1.0)  
**Canonical whitepaper:** [`WHITEPAPER.md`](../WHITEPAPER.md) / [`GENESIS_V1.md`](../GENESIS_V1.md) (§1–§17, 2026-04-28)  
**Deprecated economics:** [`archive/WHITEPAPER_v0_economic.md`](../archive/WHITEPAPER_v0_economic.md)  
**Implementation:** `tet-core/` (Rust L1 node)

> UI short summary: `tet-network/ui/app/lib/tetWhitepaper.ts` (Genesis v1.0). PDF: `tet-network/ui/public/tet-network-whitepaper.pdf` (~1.8 MB, 2026-04-28) — byte-level diff deferred to Phase 0 ship.

## Status legend

| Symbol | Meaning |
|--------|---------|
| ❌ | 未着手 |
| 🟡 | 概念のみ |
| 🟠 | 骨格あり |
| 🟢 | mock / dev 動作 |
| ✅ | 単体ノードで継続利用可能 |

「本番」= 単一 `tet-core` ノード基準。マルチノード同期・公開 testnet 72h は未達（[`SYNC_ISSUE.md`](./SYNC_ISSUE.md)）。

---

## A. Genesis v1.0 (`WHITEPAPER.md`) コンポーネント

| コンポーネント | 目的（1文） | ステータス | 実装パス |
|----------------|-------------|------------|----------|
| **§4 CAAC — PoC** | GPU クラスタで推論実行・楽観的/ZK 検証 | 🟠 | `vision/caac.rs`, `worker_daemon.rs`, `consensus.rs` |
| **§4 CAAC — PoR** | エッジでリレー・PQC 軽量検証 | 🟠 | `vision/caac.rs`, `p2p.rs` |
| **§5.1 Sovereign Runtime** | 楽観的コミット + challenge window → ZK-Court | 🟠 | `vision/zk_court.rs`, `rest/`, `tet-network/ui/app/os/` |
| **§5.2 R(T) / Sovereign Peg** | 熱力学報酬・1 TET = 検証可能物理仕事 | 🟠 | `vision/thermo_genesis.rs`（式は WP と部分一致；η 未定義） |
| **§6 Fluid tx (workload flag)** | flag 0/1 で CAAC ルーティング | 🟢 | `protocol.rs`, enterprise inference TX |
| **§7 Weight Locality** | モデル重みのクラスタキャッシュ | 🟡 | 設計のみ；地理ルーティング未 |
| **§8 Edge light clients** | ヘッダ + Merkle branch 検証 | 🟠 | `ledger.rs` state root；SPV プロトコル未 |
| **§9 Cockroach Doctrine** | PoR メッシュで台帳継続 | 🟠 | `p2p.rs`, `replication.rs`；マルチノード未検証 |
| **§10 ML-DSA** | ジェネシスから PQC 署名 | 🟢 | `quantum_shield.rs`, `tet-pqc-wasm/` |
| **§11 Tokenomics** | 10B cap、25/50/25、50% fee burn | 🟠 | `ledger.rs` cap/burn；配分は要突合 |
| **§11.2 vs AI 80/15/5** | inference 決済スプリット | 🟢 | `ledger.rs`, `enterprise.rs`（**WP §11 に未記載** → Gap 6） |
| **§12.1–12.4 Applications** | RaaS、marketplace、agents、DeFi | 🟠 | REST + UI；L2 RaaS 本番未 |
| **§12.5–12.7 Future Work** | World Brain / Sentient Assets / Agent-Gate | 🟡 | 本文で Phase 0/1 対象外；コードなし |
| **§13 Roadmap Phase 0–2** | inference wedge → CAAC → fluid grid | 🟠 | Phase 0 UI README；L1 同期は Sprint 1 |
| **§14.1 ZK-Court disputes** | 不正推論の slash | 🟠 | `vision/zk_court.rs`, `tests.rs` |
| **§14.2 Hardware fingerprinting** | Sybil 対策 micro-tasks | 🟠 | `caac.rs` 静的 probe のみ |
| **§14.3 Economic finality** | S = λ·R_expected | 🟡 | 本文あり；bond 実装は部分 |

---

## B. Legacy / archive のみ（正本に非掲載）

| 項目 | 備考 | ステータス | 実装 |
|------|------|------------|------|
| CHF 1:1 peg | `archive/WHITEPAPER_v0_economic.md` | 🟢（legacy） | `ledger.rs` `chf_top_up_mint` — **要 Steve 判断**（廃止 vs 別プロダクト） |
| Imperial Tax 99/1 | deprecated WP | 🟠 | ワーカー mint 経路に類似ロジックの可能性；用語は非正本 |
| Sharding Plugins | deprecated WP | 🟠 | シャードシミュレーション；≠ §5.1 Sovereign Runtime |
| P2P DEX (Quantum Gate) | `archive/LITEPAPER_v0.md` | 🟠 | `p2p_dex.rs` |

---

## C. 正本に明示なし — 実装に存在

| コンポーネント | ステータス | 実装パス |
|----------------|------------|----------|
| libp2p メッシュ / block gossip | 🟠 | `p2p.rs`, `p2p_network.rs`, `network.rs` |
| Consensus / auto-mine | 🟢 / 🟠 | `consensus.rs` |
| 80/15/5 AI utility settlement | 🟢 | `enterprise.rs`, `ledger.rs` |
| Substrate / Solana 実験 | 🟡 ARCHIVED | `tet-core-node/`, `nexus-onchain/` |

---

## D. ギャップ要約

1. **§12.1–12.4 が binding scope**；§12.5–12.7 は Future Work（WP L173–177）。  
2. **マルチノード `block_height` 同期**未検証 — [`SYNC_ISSUE.md`](./SYNC_ISSUE.md)。  
3. **§11 tokenomics と 80/15/5** — 一本化は v1.1（[`WHITEPAPER_V1.1_GAPS.md`](./WHITEPAPER_V1.1_GAPS.md) Gap 6）。  
4. Sprint / Phase 用語は [`SPRINT_PLAN.md`](./SPRINT_PLAN.md) と WP §13 を併読。

---

## E. 参照

| 文書 | パス |
|------|------|
| Whitepaper (canonical) | `WHITEPAPER.md`, `GENESIS_V1.md` |
| v0 economics (archive) | `archive/WHITEPAPER_v0_economic.md` |
| Litepaper (archive) | `archive/LITEPAPER_v0.md` |
| v1.1 gaps | `docs/WHITEPAPER_V1.1_GAPS.md` |
| Launch report | `docs/WHITEPAPER_V1.0_LAUNCH.md` |
