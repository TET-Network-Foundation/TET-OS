# 6-Sprint Plan — Phase 0 Launch Foundation

**Horizon:** 6 weeks (1 sprint = 1 week)  
**Baseline date:** 2026-05-18  
**Canonical node:** `tet-core/`  

> **Note on “Whitepaper v2 / Phase 0 in 2 weeks”:** ルート `WHITEPAPER.md` に「2 weeks」や「Phase 0」の記述は **ない**。内部目標として `tet-network/ui/README.md`（Phase 0 Autonomous AI Economy E2E）と `SPRINT0_ISSUES.md`（公開 testnet 72h）を参照し、**6 週間で現実的に到達可能な打ち手**に分解した。

**Priority order (fixed):** ブロック同期 → consensus 骨格 → ZK 配線 → インセンティブ層 → inference mock → docs

---

## Sprint 1 — Block sync MVP (P0)

### Deliverables

1. **設計実装:** 単一 libp2p スワーム方針を決定し、ブロック同期用の **pull-based catch-up**（`local_height+1` から順次 apply）を追加。
2. **3 ノード E2E:** 手順書どおり起動後、全ノード `block_height` が **±2 以内**。
3. **診断:** `docs/SYNC_ISSUE.md` の「Phase A/B」を実装済みとしてチェックリスト更新。

### Files (expected touch)

- `tet-core/src/p2p.rs` — sync RPC / ordered apply loop
- `tet-core/src/main.rs` — swarm 統合のエントリ
- `tet-core/src/consensus.rs` — catch-up 呼び出し、skip 理由の構造化ログ
- `tet-core/src/p2p_network.rs`, `tet-core/src/network.rs` — listen 重複の削減または役割分離
- `tet-core/src/tests.rs` — multi-height catch-up 統合テスト
- `docs/SYNC_ISSUE.md` — 実装後の status セクション

### Definition of Done

```bash
cd tet-core
RISC0_SKIP_BUILD=1 cargo test --bin TET-Core block_sync 2>&1 | tail -5
# Expected: tests passed (new integration test name TBD, e.g. catch_up_from_tip_gossip)

# Manual 3-node (release binary rebuilt)
# ... start 5010 boot + 5020/5030 peers with TET_BOOTNODES ...
for p in 5010 5020 5030; do curl -sf http://127.0.0.1:$p/ledger/state | jq -r .block_height; done
# Expected: three integers, max-min <= 2 after 120s
```

---

## Sprint 2 — Consensus skeleton hardening (P0)

### Deliverables

1. **Shared validator set:** `TET_VALIDATOR_IDS` を compose / scripts で必須化。
2. **Leader-only auto-mine:** 非リーダーは `TET_AUTO_MINE` 無効または skip のみ（現状ログで確認済みの動作をテストで固定）。
3. **Fork / parent metadata:** マイニング時 `record_block_record` の `parent_block_id` を常に直前ブロックに一致させる（gossip と backfill の整合）。
4. **Readiness endpoint:** `/ledger/state` に `synced: bool` または `lag_blocks`（同期完了前は明示）。

### Files

- `tet-core/src/consensus.rs`
- `tet-core/src/main.rs`
- `tet-core/docker-compose.yml`, `tet-core/scripts/start-network.sh`
- `tet-core/src/rest/handlers/ledger.rs`

### Definition of Done

```bash
RISC0_SKIP_BUILD=1 cargo test --bin TET-Core auto_miner 2>&1 | tail -5
# Expected: existing auto_miner_* tests pass

TET_VALIDATOR_IDS=alice,bob,carol TET_AUTO_MINE=1 cargo test --bin TET-Core leader 2>&1 | tail -5
# Expected: leader rotation tests pass (add if missing)

curl -s http://127.0.0.1:5020/ledger/state | jq '.synced // .block_height'
# Expected: synced=true OR lag_blocks=0 when caught up
```

---

## Sprint 3 — ZK wiring (P1)

### Deliverables

1. **RISC0 guest CI path:** `RISC0_SKIP_BUILD=0` で CI サブジョブ（または週次）が `methods/` ビルド成功。
2. **`NEXUS_GUEST_ELF` 空時の挙動:** 本番は fail-closed、dev は warn（現状の panic 修正を維持）。
3. **ZK-Court happy path:** mock ではなく guest receipt で `VerifyZkProof` が 1 本通る統合テスト（`TET_ALLOW_MOCK_ZK` なし）。

### Files

- `methods/`, `prover/`, `tet-core/build.rs`
- `tet-core/src/zk_verifier.rs`, `tet-core/src/vision/zk_court.rs`
- `tet-core/src/worker_daemon.rs`
- `.github/workflows/`（tet-core 用、新規または既存拡張）

### Definition of Done

```bash
# Dev (skip build)
RISC0_SKIP_BUILD=1 cargo test --bin TET-Core should_start_worker_daemon 2>&1 | tail -3
# Expected: 1 passed

# Full ZK (machine with risc0 toolchain — may be nightly only)
RISC0_SKIP_BUILD=0 cargo test --bin TET-Core zk_court -- --ignored 2>&1 | tail -5
# Expected: ignored tests pass when run with --ignored on ZK-capable runner
```

---

## Sprint 4 — Incentive layer (P1)

### Deliverables

1. **AI settlement + thermodynamic rewards:** 既存 80/15/5（`enterprise.rs` / README）と §5.2 R(T) 経路が **マルチノード同期後**も一貫することを E2E テストで確認（§11 tokenomics との対応は v1.1 Gap 6 参照）。
2. **Worker stake gate:** `p2p_network` の `MIN_WORKER_STAKE_MICRO` 拒否が integration test でカバー。
3. **Slashing stub → MVP:** ZK-Court 敗訴時の bond forfeit が 1 シナリオで台帳残高に反映（既存 ledger API 利用）。

### Files

- `tet-core/src/ledger.rs`
- `tet-core/src/vision/zk_court.rs`
- `tet-core/src/p2p_network.rs`
- `tet-core/src/tests.rs`

### Definition of Done

```bash
RISC0_SKIP_BUILD=1 cargo test --bin TET-Core worker_ai_reward 2>&1 | tail -5
# Expected: vesting / reward tests pass

RISC0_SKIP_BUILD=1 cargo test --bin TET-Core slash 2>&1 | tail -5
# Expected: new or existing slash scenario passes
```

---

## Sprint 5 — Inference mock E2E (P2)

### Deliverables

1. **Single-swarm inference topic:** `nexus-inference-v1` をブロック mesh と共存（Sprint 1 統合の上）。
2. **Phase 0 UI path:** `tet-network/ui/README.md` の env で request → worker → result が **1 ローカル mesh** で完走。
3. **Optional:** `POST /v1/compute` がシャード数 > 0 で 200 を返し、台帳に workload 痕跡。

### Files

- `tet-core/src/p2p_network.rs`, `tet-core/src/rest/handlers/network.rs`, `ai.rs`
- `tet-network/ui/`（最小 wiring のみ）
- `tet-core/docker-compose.yml`

### Definition of Done

```bash
# Per tet-network/ui/README.md Phase 0 block
RISC0_SKIP_BUILD=1 TET_AUTO_MINE=1 TET_ALLOW_MOCK_ZK=1 TET_DEV_FORCE_POC=1 \
  cargo run --bin TET-Core &
sleep 15
curl -sf -X POST http://127.0.0.1:5010/v1/compute -H 'Content-Type: application/json' \
  -d '{"prompt":"ping","wallet_id":"..."}' | jq .
# Expected: HTTP 200, job id or result field present (exact schema per handler)

RISC0_SKIP_BUILD=1 cargo test --bin TET-Core inference 2>&1 | tail -5
# Expected: p2p inference loop tests pass
```

---

## Sprint 6 — Docs, release, Docker recovery (P2)

### Deliverables

1. **`docs/STATUS.md` 更新** — Sprint 1–5 完了分をステータス昇格。
2. **Operator runbook:** 3-node + bootnode PeerId + `TET_VALIDATOR_IDS` を `tet-core/README.md` に統合（重複削減）。
3. **Docker E2E:** Mac Docker Desktop 復旧後、`docker compose up` で 3 ノード + UI smoke（ブロック済み項目のクローズ）。
4. **Commit / tag:** `Phase 0 foundation` タグ；**push は CI 緑後**.

### Files

- `docs/STATUS.md`, `docs/SYNC_ISSUE.md`, `docs/SPRINT_PLAN.md`
- `tet-core/README.md`, `README.md`
- `tet-core/Dockerfile`, `tet-core/docker-compose.yml`
- `.dockerignore`

### Definition of Done

```bash
cd tet-core && docker compose up -d --build
sleep 90
curl -sf http://localhost:5010/ledger/state && curl -sf http://localhost:5020/ledger/state
# Expected: both JSON; |height_5010 - height_5020| <= 2

git ls-files | grep '^target/' | wc -l
# Expected: 0
```

---

## Risk register (realistic)

| Risk | Impact | Mitigation |
|------|--------|------------|
| 3 swarms 統合が 1 週間で終わらない | Sprint 1 スリップ | 先に pull-sync のみ `p2p.rs` に追加し、統合は Sprint 2 |
| RISC0 CI が重い | Sprint 3 未完了 | `RISC0_SKIP_BUILD=1` を default CI、`zk` job を optional |
| Docker Desktop 未復旧 | Sprint 6 DoD 未達 | ローカル `cargo run` E2E を Phase 0 完了基準に |
| ホワイトペーパーと実装の用語乖離 | docs 混乱 | `STATUS.md` で「WP 記載なし」を明示（維持） |

---

## Mapping to current gaps

| Gap | Sprint |
|-----|--------|
| height 15/0/0 | 1 |
| Validator / leader / parent metadata | 2 |
| ZK-Court production path | 3 |
| ZK-Court slash / stake / §14.3 collateral | 4 |
| Inference gossip E2E | 5 |
| Docker + STATUS refresh | 6 |

---

## Out of scope (6 weeks)

- 公開 testnet 72h 連続稼働（`SPRINT0_ISSUES.md` のフル項目）
- Stripe 本番連携
- Substrate / Solana アーカイブ復活
- Neural State Transition / Sentient Assets（`SPRINT0_ISSUES.md` §E）

これらは Phase 1 以降のバックログとする。
