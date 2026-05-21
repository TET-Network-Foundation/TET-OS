# Worker Mode Audit — 「AI Worker を動かして TET を稼ぐ」

**Date:** 2026-05-19  
**Method:** Code-read only (no tet-core / UI changes). Line refs are `Nexus_Network` paths at audit time.  
**Companions:** [`CODEBASE_ATLAS.md`](./CODEBASE_ATLAS.md), [`WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md), [`UI_STATUS_PHASE0.md`](./UI_STATUS_PHASE0.md), [`RUNNING_A_NODE.md`](./RUNNING_A_NODE.md)

---

## Executive summary

| Question | Answer |
|----------|--------|
| Phase 0 で「家の Mac で AI worker → TET 稼ぎ」は **realistic** か？ | **No**（Send Coins ユーザー向けの製品フローとしては不可。オペレーター向け PoC ラボ構成なら **Partial**） |
| コアの実装度 | **Partial** — 登録・bond・enterprise 需要・daemon・ZK proof・coinbase thermo reward・ZK-Court はコードあり。リモート worker への支払いと UI/一般ユーザー導線は未接続 |
| Phase 0 UI で front-page にすべきか | **Hidden / advanced**（既存 Worker タブはモニタリング寄り。「稼ぐ」約束は Phase 0.5+） |

---

## Section verdicts

| § | Topic | Verdict |
|---|--------|---------|
| 1 | Worker 登録 | **Partial** — REST + ledger bond あり。registry は **in-memory のみ** |
| 2 | AI inference 実行 | **Partial** — Ollama executor + enterprise mempool poll + ZK proof。分散 dispatch は未成熟 |
| 3 | Reward 計算・支払い | **Partial** — 複数経路が混在。async worker 完了だけでは worker wallet に utility 支払いされない |
| 4 | ZK-Court | **Partial** — delivery 記録・challenge window・slash 実装。async enterprise 完了時の `record_inference_delivered_full` は **未接続** |
| 5 | E2E シナリオ a–h | 下表参照（多く **No / Partial**） |
| 6 | UI | **Partial** — Worker タブ・cockpit あり。stake/register/daemon 起動は **No** |
| 7 | agent-sdk | **No**（worker mode 専用ではない。`ignition.ts` は demand 側） |

---

## 1. Worker 登録

### 1.1 Registry の所在と永続化

| Layer | Persistence | Code |
|-------|-------------|------|
| Heartbeat registry (`WorkerRegistry`) | **In-memory only**（プロセス再起動で消える） | `tet-core/src/worker_network.rs:1-23`, `main.rs:586` |
| Worker bond (Sybil stake) | **Ledger KV** (`worker_stakes_v1`) | `ledger.rs:2577-2593`, `120` (`MIN_WORKER_STAKE_MICRO`) |
| CAAC role (PoC / PoR) | **Ledger KV** | `ledger.rs:2787`, `vision.rs:85-97` |

`RestState.workers` は `Arc<Mutex<WorkerRegistry>>` として起動時に空で初期化される（`main.rs:586`）。

### 1.2 登録 API

| Item | Value |
|------|--------|
| Route | `POST /worker/register` (`routes.rs:271`) |
| Handler | `post_worker_register` → `post_worker_register_impl` (`worker.rs:17-107`, `545-549`) |

**Request schema** (`rest/types.rs:197-206`):

```json
{
  "wallet": "<64-hex>",
  "hardware_id_hex": "<string>",
  "ed25519_pubkey_hex": "<64-hex>",
  "x25519_pubkey_b64": "<optional>",
  "mlkem_pubkey_b64": "<optional>",
  "tflops_est": <optional f64>
}
```

### 1.3 登録ゲート（必須条件）

1. **Founder は不可** — `worker.rs:33-44`
2. **Founding cert がある場合** — `hardware_id_hex` 一致必須 (`worker.rs:47-57`)
3. **Worker bond** — `ledger.worker_bond_micro(w) >= MIN_WORKER_STAKE_MICRO`（**1_000 TET** = `1_000 * STEVEMON`, `ledger.rs:120`）
4. **Genesis Guardian** — bond 不足時、初回は grant のみで `GRANT_ISSUED_STAKE_REQUIRED`（`worker.rs:59-78`, `ledger.rs:2226-2228`）

Stake API（bond を ledger にロック）:

| Route | Handler | Notes |
|-------|---------|-------|
| `POST /ledger/stake` | `post_ledger_stake` → `stake_worker_bond_micro` (`ledger.rs:1226-1278`, `routes.rs:165-166`) | Hybrid Ed25519 + ML-DSA（`types.rs:88-91`） |
| `POST /ledger/unstake` | `unstake_worker_bond_micro` (`ledger.rs:1284-1337`) | |

Legacy `/wallet/stake` より **worker bond + `/ledger/stake`** が推奨（`ledger.rs:116-120` コメント）。

### 1.4 一般ユーザーの登録手順（現状）

| Path | Worker 登録 | Stake | 評価 |
|------|-------------|-------|------|
| **UI (`OsClient` Worker タブ)** | **No** — `post_worker/register` 呼び出しなし（repo 全体 grep 0 件） | **No** | **Placeholder 寄り** |
| **CLI `tet-worker heartbeat`** | **Yes** — `POST /worker/register` (`bin/tet-worker.rs:105-155`) | 別途 `POST /ledger/stake` 必要 | **Partial** |
| **agent-sdk** | **No** worker register example | — | **No** |
| **tet-core 内蔵** | 自動 register なし（daemon は mnemonic のみ） | 手動 stake | **Partial** |

### 1.5 結論（§1）

**Partial** — API と ledger bond は実装済み。registry は RAM のみで、Phase 0 一般ユーザーが UI だけで「Become Worker」できる導線はない。

---

## 2. AI inference 実行

### 2.1 モデル格納

| Backend | Storage | Entry | Used by worker_daemon? |
|---------|---------|-------|------------------------|
| **Ollama**（本番 executor 境界） | ローカル Ollama デamon（`TET_OLLAMA_URL_BASE`） | `executor.rs:76-80`, `worker_engine.rs:60-68` | **Yes**（`worker_daemon.rs:157-158` → `run_local_inference`） |
| **Candle GGUF**（Llama 3 8B 4bit） | ディスク DL（HF 等） | `worker_ai.rs:1-8`, `GET/POST /worker/model/*` | **No** on daemon path（別 REST 経路） |

`worker_daemon` は mock fallback を拒否する（`worker_daemon.rs:160-164`）。

### 2.2 Task dispatch メカニズム

| Mode | Mechanism | Code |
|------|-----------|------|
| **Enterprise demand (on-chain)** | `EnterpriseInference` tx がブロックに入ると `AiWorkloadTask` が meta KV に作成 → daemon が **poll** | `ledger.rs:1543-1573`, `worker_daemon.rs:101`, `list_unprocessed_ai_workload_tasks` `ledger.rs:1109-1127` |
| **Enterprise submit (async)** | `POST .../enterprise/inference/submit` → **mempool enqueue** | `enterprise.rs:271-381` |
| **Enterprise sync (REST)** | `POST /enterprise/inference` — **同一 tet-core 上**で registry から worker を選び **ローカル** inference | `enterprise.rs:116-210`（リモート Mac ではない） |
| **Consumer `POST /ai/infer`** | 登録 worker の **先頭** or `TET_DEFAULT_WORKER_ID` → P2P `post_ai_utility_impl` | `ai.rs:693-860` |
| **Centralized scheduler** | **No** | — |
| **P2P task pull** | **Partial** — `p2p_network.rs` に inference gossip / settlement 片あり | Atlas §2.8 |

評価: **Polling-based + 同期 REST が混在**。真の「家の Mac が pull して alone 実行」は **enterprise mempool + worker_daemon** 経路のみで、前提条件が重い（§5）。

### 2.3 Supported models

- リクエスト `model` 文字列 or env `TET_DEFAULT_MODEL` / `TET_OLLAMA_MODEL`（`executor.rs:57-74`）
- llama.cpp 直結ではなく **Ollama API** が Phase 1 デフォルト（`executor.rs:3-5`）
- `worker_ai` の GGUF は **オプション / 別ダウンロードフロー**（`worker.rs:110-116`）

### 2.4 Worker 側実行パス（`worker_daemon` loop）

```
tick (poll_ms, default 2000)
  → list_unprocessed_ai_workload_tasks(16)
  → skip if mempool already has VerifyZkProof for task_id
  → run_inference_for_task → worker_engine::run_local_inference (Ollama)
  → prove_zk_court_task_receipt (RISC0, NEXUS_GUEST_ELF)
  → enqueue VerifyZkProof tx to mempool
```

Refs: `worker_daemon.rs:88-140`, `190-240`, `242-277`.

**Daemon 起動条件** (`worker_daemon.rs:54-73`, `main.rs:612-626`):

| Condition | Required |
|-----------|----------|
| `TET_WORKER_DAEMON` ≠ 0/false | default **enabled** |
| `NEXUS_GUEST_ELF` non-empty | **Yes**（CI は `RISC0_SKIP_BUILD=1` で空 → daemon 起動しない） |
| CAAC role **POC** on ledger **or** local `caac::profile().role == Poc` | **Yes** |
| `TET_WORKER_MNEMONIC` or `TET_WALLET_MNEMONIC` | **Yes**（`initial_wallet` と一致、alias は `TET_WORKER_DAEMON_ALLOW_WALLET_ALIAS`） |

### 2.5 Commitment

- Protocol: `zk_court_inference_commitment_v1(prompt, response, flops_u64, worker_pubkey_bytes)`（`worker_daemon.rs:257-258`, `nexus-protocol`）
- ZK guest journal: `ZkCourtJournalV1`（`worker_daemon.rs:211-230`）
- On-chain tx: `TxV1::VerifyZkProof { task_id, image_id, journal_b64, receipt_b64 }`

### 2.6 `record_inference_delivered_full` の呼び出し条件

| Caller | When | Path |
|--------|------|------|
| `post_ai_infer` **local_fallback** のみ | 同期推論成功後、`pool_half` と共に ZK-Court artifact 登録 | `ai.rs:813-824` |
| **worker_daemon / enterprise async 完了** | **No** — VerifyZkProof enqueue のみ。delivery 記録なし | `worker_daemon.rs:120-139` |
| Tests | 手動 | `tests.rs:3002+` |

評価: async worker earn フローでは **ZK-Court challenge window が自動では開かない**（§4）。

### 2.7 結論（§2）

**Partial** — ローカル Ollama + ZK proof + mempool は動く設計。**リモート worker へのタスク配送と完了検証の製品一体化は未完了**。

---

## 3. Reward 計算と支払い

### 3.1 Thermodynamic formula \((C_{\text{flops}}/E) \times \Gamma\)

| Function | Role | Code |
|----------|------|------|
| `discrete_thermodynamic_reward_stevemon_micro` | §4.2 → **Stevemon micro** | `thermo_genesis.rs:62-78` |
| `compute_reward_for_block` | ブロック内 `VerifyZkProof` の flops 合計 → compute leg | `consensus.rs:461-496` |
| `reward_for_block` | `base + compute` | `consensus.rs:499-506` |

Env: `TET_JOULES_PER_FLOP`, `TET_NETWORK_DIFFICULTY_GAMMA`, `TET_THERMO_STEVEMON_MICRO_SCALE`（`thermo_genesis.rs:42-50`）。

### 3.2 支払い経路（誰 → 誰）

| Event | Payer / source | Recipient | Mechanism | Worker balance↑? |
|-------|----------------|-----------|-----------|------------------|
| **AI utility (enterprise sync)** | Enterprise wallet | **Registered worker** 80% gross | `settle_ai_utility_payment` | **Yes**（即時 balance） | `enterprise.rs:212-217`, `ledger.rs:5469-5544` |
| **AI infer local_fallback** | Payer | `system:worker_pool` 半分 + burn | `settle_ai_inference_dynamic_charge` | Worker は founder ローカル実行 — **not home worker** | `ai.rs:744-778` |
| **Block coinbase (compute leg)** | `system:worker_pool` | **Block producer** (`producer_id`) | `apply_block_reward_to_balance_map` | **Only if worker wallet == miner** | `ledger.rs:1619-1644`, `consensus.rs:501-505` |
| **Block coinbase (base leg)** | worker pool | producer | same | same |
| **mint_worker_network_reward** | worker pool | worker（**90日 vest**）+ 1% imperial | `ledger.rs:5260-5308` | **Yes**（vest lock、デフォルト 90d `ledger.rs:136`, `560-564`） |
| **Genesis Guardian grant** | worker pool | new worker | `grant_genesis_guardian_if_eligible` | **Yes**（bond 前の一時 grant） | `ledger.rs:2226-2228` |

**重要:** `VerifyZkProof` がブロックに入っても、**compute_reward_micro は署名者 worker ではなくブロック生産者へ**（`ledger.rs:1583-1586`）。Worker が inference しただけでは thermo coinbase を自動取得しない。

**重要:** `EnterpriseInference` の **async**（mempool → daemon → VerifyZkProof）では、ブロック apply 時に **payer の `amount_micro` を worker へ送金する処理はない**（タスク meta 作成のみ `ledger.rs:1543-1573`）。Utility 80% 支払いは **同期** `POST /enterprise/inference` のみ（`enterprise.rs:212-217`）。

### 3.3 Reward 単位・頻度

| Type | Unit | Frequency |
|------|------|-----------|
| Thermo compute in coinbase | Stevemon micro | **Per block**（そのブロックに含まれる VerifyZkProof flops 合算） |
| Base block reward | Stevemon micro | Per block（`TET_BASE_BLOCK_REWARD`, `consensus.rs:426+`） |
| Utility settlement | Stevemon micro | **Per successful sync enterprise infer** |
| `mint_worker_network_reward` | Stevemon micro | Per REST/energy proof event（別 PoC 経路、`network.rs:292` 等） |

### 3.4 Wallet balance が増えるまでのステップ（async worker 理想経路）

1. Worker が `POST /ledger/stake` で ≥1000 TET bond（`ledger.rs:120`）
2. `POST /v1/vision/caac/complete` で POC role（`vision.rs:42-109`）
3. tet-core 起動: guest ELF + mnemonic + `initial_wallet` = worker（`main.rs:612-618`）
4. 他者が `enterprise/inference/submit` → ブロックに `EnterpriseInference` → `AiWorkloadTask` 作成
5. Daemon: infer → `VerifyZkProof` → mempool
6. **POC leader** がブロック生成・apply（`consensus.rs:382-387`, `676+`）
7. **Gap:** 手順 5 だけでは worker spendable balance は **utility 支払いなし**。増えるのは (a) 同一 wallet が **producer** で compute coinbase を取る、(b) 別経路 `mint_worker_network_reward`、(c) 同期 enterprise が同 wallet を registry で選ばれた場合のみ

### 3.5 結論（§3）

**Partial** — 式と coinbase / utility / vest は実装。**「worker が inference したらその wallet に TET」という単一 E2E は async 経路では成立していない**。

---

## 4. ZK-Court との接続

### 4.1 Challenge window

- Default **24h**: `TET_ZK_COURT_CHALLENGE_MS` default `86_400_000`（`zk_court.rs:64-68`）
- `record_inference_delivered_full` → artifact + dispute `ChallengeOpen`（`zk_court.rs:116-152`, `160-180`）
- Persist: memory `DISPUTES` / `ARTIFACTS` + ledger KV（`zk_court.rs:87-91`, `183-191`）

### 4.2 Lazy evaluation / slash

| Step | Behavior | Code |
|------|----------|------|
| Challenge submit | Challenger bond lock, `EvidencePending`, `lazy_eval_suspected = true` | `zk_court.rs:216-258` |
| Prove | RISC0 `prove_zk_court_receipt`; timeout → **dismissed** | `zk_court.rs:334-367` |
| Guilty | Receipt OK **かつ** journal ≠ commitment → slash | `zk_court.rs:372-397` |
| Slash amount | **Full liquid worker bond** → ecosystem（λ×R_expected は未使用） | `apply_slash_verdict` `zk_court.rs:423+`, `slash_worker_bond_to_ecosystem_all` `ledger.rs:3043+` |
| Invalid proof in block candidate | Producer worker bond slash on verify fail | `consensus.rs:556-566` |

### 4.3 Stake bond と回収

- Active worker: `MIN_WORKER_STAKE_MICRO`（1000 TET）
- ZK-Court guilty: `slash_worker_bond_to_ecosystem_all` or `slash_worker_bond_zk_court_burn_all`（ledger）
- Unstake: `POST /ledger/unstake`（bond 解放、処理済みタスク等の制約は ledger 内）

### 4.4 worker_daemon 経路とのギャップ

Async worker 完了は **`record_inference_delivered_full` を呼ばない** → §14.1 optimistic window が **enterprise async earn では実質スキップ**。

### 4.5 結論（§4）

**Partial** — Court パイプラインは [`WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md) 通り保守的に実装。**メインの worker daemon フローに未配線**。

---

## 5. End-to-end シナリオ（Send Coins ユーザー → TET 稼ぎ）

前提: Phase 0 の典型ユーザー = UI で wallet unlock + Send Coins。Worker タブは存在するがバックエンド導線なし。

| Step | 実装 | Endpoint / CLI | Primary files | Blocker |
|------|--------|----------------|---------------|---------|
| **a.** UI で "Become Worker" | **Partial** | Worker タブのみ（`OsClient.tsx:73`, `339+`） | 専用 onboarding **No** |
| **b.** Worker 登録 + stake bond | **Partial** | `POST /ledger/stake`, `POST /worker/register`, `POST /v1/vision/caac/complete` | `ledger.rs:1226+`, `worker.rs:17+`, `vision.rs:42+` | UI 未配線。1000 TET + hybrid 署名。CAAC POC 必須（daemon） |
| **c.** Network が task dispatch | **Partial** | `POST /enterprise/inference/submit` | `enterprise.rs:271+`, `ledger.rs:1543+` | 需要側が signed tx を投げる必要。一般ユーザーは AI Task UI のみ（別フロー） |
| **d.** Worker が inference | **Partial** | （プロセス内 daemon） | `worker_daemon.rs:157+` | 同一マシンで tet-core + Ollama + RISC0 guest。UI からは起動不可 |
| **e.** Worker が結果 deliver | **Partial** | mempool `VerifyZkProof` | `worker_daemon.rs:127-138` | REST "deliver" ではなく tx 提出。`record_inference_delivered_full` **なし** |
| **f.** Challenge window | **No**（async path） | `POST /v1/vision/zk-court/challenge` | `zk_court.rs:116+` | async worker 完了で window 未オープン |
| **g.** Worker が reward 受取 | **Partial** | （coinbase / utility） | `consensus.rs:461+`, `enterprise.rs:212+` | async では utility なし。coinbase は **miner** 向け |
| **h.** Wallet balance 増加 | **No**（典型 Mac user） | `GET /ledger/me?wallet_id=` | `ledger.rs` balances | 上記ギャップの合成 |

### UI「Start Mining (GPU)」の実態

- `onStartMiningGpu` は **ローカル state + ログ文言のみ**（`OsClient.tsx:1504-1517`）。tet-core daemon 起動・register・stake は行わない。
- Cockpit `estimated_total_rewards_micro` は **`balance_micro` と同値**（`worker.rs:499`）— 累計報酬ではない。

---

## 6. UI 側の対応状態

| Item | Status | Evidence |
|------|--------|----------|
| Worker タブ | **Yes** | `OsClient.tsx:73` |
| Cockpit / stats / SSE logs | **Partial** | `worker_cockpit.ts`, `fetchWorkerCockpit`, `GET /worker/cockpit/:wallet` |
| "Earn TET by running inference" コピー | **Partial** — ログ文言・AI Task 説明に期待値（`OsClient.tsx:1432-1438`, `1515-1516`） | 実際の earn 導線なし |
| Stake / register / CAAC from UI | **No** | grep: no `/worker/register` in `tet-network/ui` |
| Phase 0 backlog ID | **No UI-P0-4** — [`UI_STATUS_PHASE0.md`](./UI_STATUS_PHASE0.md) は UI-P0-1〜3 のみ（Send Coins / sync / genesis） |
| Phase 0 で UI から worker 起動 | **未計画**（ドキュメント上） | Worker は read-mostly モニタ |

評価: **Partial（見せるが、Phase 0 MVP の約束にはしない）**

---

## 7. agent-sdk の関与

| Item | Status | Evidence |
|------|--------|----------|
| Worker mode 専用 API | **No** | `tet-agent-sdk/examples/`: `ignition.ts`（inference **demand**）, `attacker.ts` |
| `AgentClient.requestInference` | Consumer 側 | `ignition.ts:17` |
| Wallet 導出 | `wallet_from_mnemonic.ts` — UI `ed25519_tet.ts` と **不一致リスク**（Atlas / daily log） | Phase 0 Send Coins とは別系統 |
| Mac worker ship の正しい path（Steve） | **独立 tet-core プロセス + env**（§2.4）がコード上の正。**UI < agent-sdk** for Phase 0 earn |

---

## 8. Steve 向け戦略推奨

### Phase 0 realistic か？

**いいえ** — 次をすべて満たすオペレーター以外は「稼いだ」と言えない:

1. ≥ **1000 TET** worker bond（`ledger.rs:120`）
2. **POC** CAAC + **RISC0 guest ビルド**（`RISC0_SKIP_BUILD` 不可）
3. **tet-core** を worker wallet / mnemonic で起動（ブラウザ UI だけでは不可）
4. **Ollama** 常駐
5. **需要**（enterprise submit）と **POC miner** がブロックに載せる — かつ async では **utility 支払いが worker wallet に紐づかない**設計ギャップ

Send Coins だけ触ったユーザーが家の Mac で「セットアップして稼ぐ」は **Phase 0 スコープ外**。

### 足りないもの（優先度順）

| Priority | Gap | Suggested sprint |
|----------|-----|------------------|
| P0.5-1 | Async 完了時 `settle_ai_utility_payment` または `amount_micro` escrow → worker credit on `VerifyZkProof` apply | Phase 0.5 |
| P0.5-2 | `worker_daemon` 完了時 `record_inference_delivered_full` | Phase 0.5 |
| P0.5-3 | UI: stake + register + CAAC + env チェックリスト（または one-shot script） | Phase 0.5 (**UI-P0-4** 候補) |
| P1-1 | Worker registry persistence（ledger or gossip） | Phase 1 |
| P1-2 | リモート inference（タスクを worker ノードで実行、validator は proof のみ） | Phase 1 |
| P1-3 | Compute reward の worker 分配（miner≠worker のとき） | Phase 1 |

### Phase 0: front-page vs hidden

| Strategy | Recommendation |
|----------|----------------|
| **Front-page 「Earn TET」** | **非推奨** — 法的/製品期待値リスク。現 UI の "Start Mining" は誤解を招く（`OsClient.tsx:1504-1517`） |
| **Hidden / Advanced** | **推奨** — Worker タブは **ops / demo**（cockpit, pool stats）。Phase 0 ヒーローは Send Coins + explorer |
| **Messaging** | 「Worker network preview — operator setup required」程度に抑える |

### 結論（Steve）

コードベースは **whitepaper vision の実験床**としては rich（bond, daemon, ZK, thermo coinbase, ZK-Court）。しかし **Phase 0 一般ユーザー向け DePIN earn プロダクトではない**。Ship 判断: **Worker mode は見せない（または Advanced に格下げ）**し、Phase 0.5 で **async settlement + UI onboarding + ドキュメント化された `tet-core` + Ollama + guest ビルド手順** を一括で deliver するのが安全。

---

## Appendix — Key env vars

| Variable | Purpose | File:line |
|----------|---------|-----------|
| `TET_WORKER_DAEMON` | Enable daemon (default on) | `worker_daemon.rs:30-37` |
| `TET_WORKER_DAEMON_POLL_MS` | Poll interval | `worker_daemon.rs:40-46` |
| `TET_WORKER_MNEMONIC` / `TET_WALLET_MNEMONIC` | Sign VerifyZkProof | `worker_daemon.rs:19-27` |
| `TET_OLLAMA_URL_BASE` | Inference backend | `executor.rs:76-80` |
| `RISC0_SKIP_BUILD` | Empty guest → no daemon | `worker_daemon.rs:58-62` |
| `TET_ZK_COURT_CHALLENGE_MS` | Challenge window | `zk_court.rs:64-68` |
| `TET_WORKER_VEST_MS` | Reward vesting | `ledger.rs:560-564` |
| `TET_AUTO_MINE` | Block production | `consensus.rs:594-601` |

---

*Audit complete. No git commit (per task).*
