# TET NETWORK
## 流動型 P2P コンピュート–エネルギー資源プロトコル
## AI ネイティブ・ソブリン Layer 1

**日本語訳:** Whitepaper v1.1 ドラフト（英語版: WHITEPAPER_v1.1_DRAFT.md）

**バージョン:** Whitepaper v1.1 Draft  
**日付:** 2026-05-21  
**著者:** Steve  
**肩書:** Founder-Architect, TET Network Project  
**連絡先:** yizhenxianshi@gmail.com  

**ステータス:** レビュー用ドラフト。明示的なコミットによるマージまで、[`WHITEPAPER.md`](../WHITEPAPER.md)（Genesis v1.0、2026-04-28）を**置き換えない**。  
**実装参照:** [`docs/WHITEPAPER_v1.0_GAPS.md`](./WHITEPAPER_v1.0_GAPS.md)、[`docs/SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md)、[`docs/CODEBASE_OVERVIEW.md`](./CODEBASE_OVERVIEW.md)、[`docs/STATUS.md`](./STATUS.md)  
**正規コード:** `tet-core/`（Rust）、`tet-network/ui/`（Sovereign OS）

---

## ドキュメント構成

| パート | セクション | 範囲 |
|------|----------|--------|
| **I — Layer 1 プロトコル** | §1–§13 | L1 メカニズム + **Sovereign OS Suite（Phase 0）** |
| **II — Layer 2 アプリケーション** | §14–§16 | 長期プリミティブ（Phase 0 成果物ではない） |
| **III — 未解決課題と比較** | §17–§19 | 正直なギャップ、ピア比較、ロードマップ |

**Phase 0 に関する表現:** 本ドラフトは**パブリックテストネット / 開発者プレビュー**を記述しており、本番メインネットではない。メインネットパラメータ、REST の安定性、経済スケジュールは、明示的に凍結されるまで変更対象のままである。

---

# Part I — Layer 1 プロトコル

## 1. はじめに

今日のクラウド AI インフラは技術的必然ではなく、資本構造である。少数の事業者が推論を価格付けし、可用性を支配し、下流のすべてのアプリケーションに相関障害を押し付けている。すべてのノードを同一のハードウェア競争者として扱うブロックチェーンは、別の希少性トークン（ASIC やステーク）の下で、同じ集中を再現する。

TET Network はプロトコル層で単一の前提に応答する：**コンピュートはエネルギーである**。電力を消費するすべてのデバイスは、原理的には検証済みワークまたはネットワーク保守に貢献できる。プロトコルはスマートフォンをデータセンター規則の下で競争させない。**Context-Aware Adaptive Consensus（CAAC）**はハードウェアの現実から役割を割り当てる：高スループットノードは **Proof of Compute（PoC）** を、制約のあるエッジノードは **Proof of Relay（PoR）** を実行する。

本ホワイトペーパーは、**テストネットが今日出荷するもの**（Part I）と、**研究グレードのアプリケーションプリミティブ**（Part II）、そして**明示的な未解決課題**（Part III）を分離する。批判は Part I のメカニズムを対象とすべきである。Part II は方向性の意図であり、納品コミットメントではない。

### 1.1 Genesis v1.0 との関係

Genesis Draft v1.0（2026-04-28）は、近未来の L1 メカニズムと長期ビジョンを単一の §12 に混在させていた。Version 1.1 はその資料を**再構成**する：

- v1.0 §4–§10、§14 → Part I（番号再付与）
- v1.0 §12.5–§12.7 → Part II §13–§15
- v1.0 §12.1–§12.4（RaaS、マーケットプレイス、エージェント、DeFi）→ §3.3 に要約（Phase 0/1 バインディング面）
- v1.0 §13 ロードマップ → §18
- 新規：§5 エネルギーペグの実装フェーズ；§11 四スロットジェネシス；§13 Sovereign OS；§17 未解決課題；§18 比較；§19 ロードマップ

---

## 2. 設計目標

1. **ジェネシスからのポスト量子セキュリティ** — ML-DSA（FIPS 204）を基本署名ファミリーとし、Phase 0 ではウォレット転送認証に Ed25519 + ML-DSA ハイブリッドを使用（§7 参照）。
2. **ハードウェア適応型コンセンサス** — CAAC が測定または証明された能力から PoC と PoR をルーティングし、単一のグローバルパズルに依存しない。
3. **熱力学的経済バインディング** — トークン発行と推論決済を**検証済み物理コンピュートエネルギー**に結び付け、抽象的なハッシュパズルではない（§5）。これが労働市場（Bittensor）およびコンピュート・アズ・ア・サービス仲介（Gensyn）との差別化要因である。
4. **楽観的実行と暗号学的紛争解決** — Sovereign Runtime がコミットメントを受理し、詐欺は ZK-Court で異議申立て（§8）。
5. **産業資本なしの参加** — エッジ軽量クライアントと PoR 役割が、コンシューマーハードウェア向けにストレージと検証コストを拘束（§9）。
6. **正直なドキュメント** — コードが本文と乖離する箇所は §17 にギャップを記録し、実装負債を粉飾しない。

---

## 3. アーキテクチャ概要

### 3.1 システムコンポーネント

正規ノード実装は **`tet-core`**（`TET-Core` バイナリ）である：

| サブシステム | 主要モジュール | 役割 |
|-----------|-----------------|------|
| 台帳 | `ledger.rs`, `genesis.rs` | sled バックエンド残高、ジェネシス配分、手数料、バーン |
| コンセンサス / マイニング | `consensus.rs` | ブロック生成、gossip 適用、CAAC リーダーヒント |
| REST API | `rest/` | ウォレット、台帳、vision/ZK-Court 向け Axum HTTP 面 |
| P2P（レガシースタック） | `p2p.rs`, `network.rs` | Gossipsub ブロック/tx、台帳スナップショット |
| P2P（Phase 1 スタック） | `p2p_network.rs`, `p2p_keystore.rs` | libp2p swarm、永続 PeerId |
| Vision / CAAC | `vision/caac.rs`, `vision/zk_court.rs`, `vision/thermo_genesis.rs` | 役割、紛争、熱力学的推定 |
| ZK | `zk_verifier.rs`, `methods/`（RISC0 guest） | レシート検証、チャレンジパイプライン |
| ウォレット暗号 | `wallet.rs`, `quantum_shield.rs` | BIP39 → Ed25519 + ML-DSA ハイブリッドメッセージ |

**チェーンバインディング:** ハイブリッド署名メッセージは `chain_id` と `genesis_hash` を埋め込む。正規ジェネシスハッシュは **`tet-core/src/genesis.rs`** で計算される（単一の真実の源）；`ledger.rs` と `wallet.rs` はこれに委譲する。

### 3.2 CAAC + PoC + PoR + ZK-Court（コントロールプレーン）

```text
                    ┌─────────────────────────────────────┐
                    │           TET-Core node              │
                    │  REST (wallet, ledger, vision)       │
                    └──────────────┬──────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
   ┌───────────┐            ┌──────────────┐          ┌─────────────┐
   │  Ledger   │◄──────────│  Consensus   │─────────►│  libp2p     │
   │  (sled)   │            │  auto-mine   │          │  gossipsub  │
   └───────────┘            └──────┬───────┘          └─────────────┘
                                   │
                    workload_flag=0 │ workload_flag=1
                         PoR path  │  PoC + inference
                                   ▼
                          ┌────────────────┐
                          │  ZK-Court      │
                          │  (RISC0 guest) │
                          └────────────────┘
```

### 3.3 Phase 0 / Phase 1 アプリケーション面（バインディング範囲）

以下の v1.0 §12.1–§12.4 機能は**テストネットおよび Phase 1 の範囲内**に残るが、v1.1 では独立したホワイトペーパー章として再番号付けされていない：

| アプリケーション | Phase 0 ステータス | 備考 |
|-------------|----------------|-------|
| 分散推論マーケットプレイス | **部分実装** | REST + Sovereign OS UI；§5 Phase 0 近似による熱力学的価格付け |
| エンタープライズ / AI ワークロードトランザクション | **部分実装** | `workload_flag=1` mempool パス |
| エージェント / M2M クライアント | **部分実装** | `tet-agent-sdk/`；Agent-Gate は Part II |
| ネイティブ L2 RaaS | **研究段階** | テストネットでは未稼働 |

Part II §13–§15（World Brain、Sentient Assets、Agent-Gate）は**明示的に Phase 0 外**である。

---

## 4. Proof of Compute（PoC）と Proof of Relay（PoR）

### 4.1 Proof of Compute（PoC）

十分な GPU/CPU スループットを持つノードは **PoC プロデューサー**として分類される。彼らは：

- AI 推論または重いコンピュートタスクをホット台帳パス外で実行する。
- 結果への暗号学的コミットメント（ハッシュ、ジャーナル）を提出する。
- **チャレンジウィンドウ**中は楽観的決済を受け入れる；紛争は ZK-Court にエスカレート（§8）。

報酬は無意味なパズル上のハッシュレートではなく、**検証済み熱力学的ワーク**（§5）に比例する。

**実装:** `worker_daemon.rs`、`vision/caac.rs`、`consensus.rs`（AI ワークロードブロック）。PoC 適格性は CAAC ワーカーレコードと役割フラグを使用する。

### 4.2 Proof of Relay（PoR）

制約のあるデバイス（モバイル、IoT）は **PoR** ノードとして参加する：

- ブロック、トランザクション、署名済み台帳スナップショットを伝播する。
- 軽量 ML-DSA / ハイブリッド署名検証を実行する。
- フル推論ワークロードは実行**しない**（PoR ルーティングでは `workload_flag=1` を拒否）。

経済報酬は PoC より小さいがゼロではなく、「ユニバーサルマイナー」設計目標を維持する。

**実装:** `p2p.rs` gossip パス、`network.rs` 台帳トピック、ウォレット/台帳読み取りパスでのエッジ検証。

### 4.3 ワークロードフラグ（流動トランザクションルーティング）

トランザクションはバイナリ **`workload_flag`** を持つ：

| フラグ | 意味 | ルーティング先 |
|------|-----------|-----------|
| `0` | 価値転送 / メンテナンス | PoR 適格検証 |
| `1` | AI 推論 / コンピュート要求 | PoC プロデューサーのみ |

フラグ 1 のワークをエッジノードへ誤ルーティングすることは、プロトコル層で拒否される（v1.0 §6、コンセンサスと mempool フィルタによる実装で保持）。

---

## 5. エネルギーペグ — 熱力学的報酬モデル

### 5.1 ビジョン：ソブリン・ペグ

**主張（戦略的）:** TET は、ワーカー固有の熱力学的効率項 **η(W_i)** を通じて、流通供給の各単位を**検証済み物理コンピュートエネルギー**にペグする。ステーク加重の意見に報酬を与える労働トークン市場とも、チェーン層のエネルギー保存則なしに時間単価で価格付けする純粋なコンピュートレンタル API とも異なり、TET は発行を検証済みタスクにわたる **η(W_i) · C(t_i)** の集約に結び付け、ネットワーク難易度 **D(t)** で正規化する。

v1.0 の連続時間式：

```
R(T) = Σ_{i ∈ verified_tasks(T)} [ η(W_i) · C(t_i) ] / D(t)
```

ここで：

- **η(W_i)** — ワーカー *i* の熱力学的効率（単位有用コンピュートあたりの出力エネルギー、または検証済みワークに帰属する等価ジュール）。
- **C(t_i)** — タスク時刻 *t_i* におけるネットワークコンピュート価格。
- **D(t)** — 動的難易度 / 希少性レギュレータ（マイニング難易度と役割は類似するが、コンピュート–エネルギー目標に結び付く）。

**v1.1 ではこの主張を弱めない。** 各フェーズが η を**どのように近似するか**、および形式的 η が未確定の箇所（§17.1）を文書化する。

### 5.2 形式的 η(W_i) — 延期

敵対的ハードウェアなりすまし、クロスベンダー GPU カウンタ、モバイルエンクレーブ証明の下での **η(W_i)** の完全な定義は、**本ドラフトでは確定していない**。§17.1 が必要な仮定を列挙する。それまでは、以下のフェーズが**監査可能なプロキシ**を使用する。

### 5.3 Phase 0 実装（現行テストネット）

**コードパス:** `tet-core/src/vision/thermo_genesis.rs`

台帳決済は、ホワイトペーパー §4.2 エンジニアリングノートに整合する**離散近似**を使用する：

```
R_micro = (C_flops / E_joules_per_flop) × Γ × scale
```

| 記号 | 意味 | ソース |
|--------|---------|--------|
| `C_flops` | 宣言推論 FLOPs | タスク / レシートメタデータ |
| `E_joules_per_flop` | エネルギープロキシ **E**（J/FLOP）、env `TET_JOULES_PER_FLOP` | オペレーター調整可能デフォルト `1e-12` |
| `Γ` | ネットワーク難易度 | `NetworkDifficulty`、env `TET_NETWORK_DIFFICULTY_GAMMA` |
| `scale` | 無次元比 → Stevemon micro への写像 | `TET_THERMO_STEVEMON_MICRO_SCALE` |

**Phase 0 における η:** CAAC 重み付け（`vision/caac.rs`）における**ハードウェアフィンガープリントクラス**（CPU vs GPU vs 特殊用途）および静的 env 効率を通じて間接的に近似 — **デバイスごとの**電力テレメトリ**ではない**。

**ギャップ:** これは完全な Σ[η·C]/D 積分ではなく **(C/E)×Γ** である。ギャップは §17.1 および §17.7（記法の調整）で明示的である。

### 5.4 Phase 1 目標

- **CAAC フィンガープリント + 測定コンピュート**から η を算出（タイミングマイクロタスク、FLOPs/秒帯域、証明済み GPU クラス）。
- 楽観的推論レシートを、スラッシュ経済学（§12）で使用する熱力学的 **R_expected** に結び付ける。
- 離散 `thermo_genesis` 出力をウォレット表示可能な手数料表示（§11）と統一する。

### 5.5 Phase 2 目標

- η を**ハードウェア証明済み電力テレメトリ**（TPM / セキュアエンクレーブ / データセンター PDU API、利用可能な場合）にペグする。
- 監査可能性のため、オンチェーン R を物理エネルギー請求書と突合検証する。

### 5.6 AI 推論決済分割（関連経済学）

転送手数料（§11）とは別に、コード内の AI ユーティリティ決済は、熱力学的 `R_micro` の**50/50**分割をワーカー報酬とプロトコルバーン（`estimate_ai_infer_cost_micro`）の間で使用する。これは v1.0 §11.2「すべてのトランザクション手数料の 50% をバーン」という全フロー向け表現と**同一ではない** — §17.7 および STATUS の `WHITEPAPER_v1.0_GAPS.md` Gap 6 を参照。

---

## 6. Context-Aware Adaptive Consensus（CAAC）

CAAC は、ハードウェアとネットワークコンテキストから各ノードに運用役割を割り当てるルーティングおよび重み付け層である。v1.0 §4 の内容は、本プロジェクトの**中核的な稼働中の主張**としてここに保持される。

### 6.1 役割割り当て

1. **プローブ** — 静的およびマイクロベンチマーク信号（GPU 名、メモリ、オプションのタイミングタスク）。
2. **分類** — PoC vs PoR vs フォールバック重み。
3. **リーダー選出** — ブロック間隔のプロデューサー選択（`consensus.rs`、台帳内 CAAC レコード）。

### 6.2 PoC 重み要因

高性能ノードは以下からより高い **CAAC 重み**を獲得する：

- キャパシティ証明信号（GPU ティア、メモリ）、
- 過去のレイテンシと可用性、
- 検証済み推論配送（ZK-Court と熱力学的履歴に供給）。

### 6.3 PoR 重み要因

エッジノードは以下から重みを獲得する：

- 成功した gossip 伝播、
- 署名検証スループット、
- リレーパス上のアップタイム。

### 6.4 実装ステータス

| 機能 | ステータス |
|---------|--------|
| 台帳内ワーカーレコード | **実装済み** |
| 静的ハードウェアプローブ | **部分実装** |
| 確率的タイミングフィンガープリント（§10） | **部分実装** |
| エポックごとの完全自律再分類 | **未解決**（§17.5） |

---

## 7. ポスト量子暗号

### 7.1 ジェネシスからの ML-DSA

TET は **ML-DSA**（FIPS 204、モジュール格子署名）をプロトコルファミリー PQC スキームとして採用する。ECDSA からの移行は意図的に回避する。

**実装:** `quantum_shield.rs`、`tet-pqc-wasm/`、`wallet.rs` 内 Dilithium クレート。

### 7.2 Phase 0 ハイブリッドウォレット認証

ウォレット転送には**両方**が必要：

- 決定論的 UTF-8 メッセージ上の **Ed25519**（BIP39 シードバイト `[0..32]` → 署名鍵）、および
- 同一メッセージバイト上の **ML-DSA**。

このハイブリッドパスが Sovereign OS の `POST /wallet/transfer` で使用される。`wallet.rs::transfer_hybrid_auth_message_bytes` および UI `ed25519_tet.ts` を参照。

メッセージ内の**チェーンバインディングフィールド**：

```
tet xfer hybrid v1|chain_id=...|genesis_hash=...|to=...|amount_micro=...|nonce=...|mldsa_pubkey_b64=...
```

`genesis_hash` はノード上の `genesis::expected_genesis_hash_from_env()` と一致しなければならない。

### 7.3 ノード ML-DSA キーストア

`pqc_keystore::ensure_node_mldsa_keystore` が、サーバー側操作向けに DB ディレクトリ下へノードレベル ML-DSA 鍵をプロビジョニングする。

### 7.4 量子脅威モデル

ECDSA 保護チェーンは、Shor 能力を持つ敵対者の下で遡及的移行リスクに直面する。TET は NIST ガイダンスに整合する ML-DSA パラメータセットを前提とする；将来標準へのパラメータ機敏性は運用上の懸念であり、Phase 0 のブロッカーではない。

---

## 8. ZK-Court（Lazy Evaluation）

### 8.1 対処する脅威

悪意のある PoC ノードは、モデルを実行せずに**偽造推論**を提出する可能性がある。ZK-Court は**Lazy Evaluation**を提供する：チャレンジウィンドウ中は楽観的受理、その後暗号学的リプレイ。

### 8.2 メカニズム

1. PoC が配送 + コミットメントを記録（`vision/zk_court.rs`）。
2. チャレンジウィンドウが開く（`TET_ZK_COURT_CHALLENGE_MS`、デフォルト 24h）。
3. チャレンジャーがボンドを投稿；`NEXUS_GUEST_ELF` が非空のときパイプラインが **RISC Zero** guest prove を実行。
4. 検証済みレシートが journal ≠ コミットメントを示せば **Guilty**。
5. Guilty 判決で**スラッシュ**（§12）。

### 8.3 プローバーバックエンド

| バックエンド | ステータス |
|---------|--------|
| RISC Zero（`methods/`、`worker_daemon.rs`） | **実装済み**（ビルド済み guest ELF が必要） |
| SP1 | **未統合**（§17.2） |

### 8.4 メインネット安全性

`TET_MAINNET=1` はモック ZK パスを禁止する（`zk_verifier.rs`、`TET_ALLOW_MOCK_ZK=1` で `main.rs` が panic）。開発専用 `MOCKJ1:` / `MOCKZC1:` プレフィックスはメインネットで拒否される。

### 8.5 REST 面（オペレーター）

- `POST /v1/vision/zk-court/challenge` — フルパイプライン
- Params JSON はオペレーター向け `whitepaper_alignment` ブロックを公開（`WHITEPAPER_v1.0_GAPS.md` §6）

---

## 9. ネットワーク層（libp2p）

### 9.1 トランスポートとアイデンティティ

- **トランスポート:** TCP + Noise XX + Yamux（`p2p_network.rs` 内 Phase 1 swarm）。
- **アイデンティティ:** DB ディレクトリ下 `libp2p_keypair.bin` に永続 Ed25519 libp2p キーペア（`p2p_keystore.rs`）。ブートバナーが bootnode 配線用 PeerId をログ出力。
- **ディスカバリ:** mDNS、Kademlia、identify、autonat、relay（compose 依存）。

### 9.2 Gossip トピック（代表例）

| トピック定数 | 目的 |
|----------------|---------|
| `BLOCKS_TOPIC` | ブロック伝播（`p2p.rs`） |
| `TXS_TOPIC` | トランザクション gossip |
| `AI_WORKLOAD_TOPIC` | AI ワークロードアナウンス |
| `TET_LEDGER_TOPIC` | 署名済み台帳スナップショット複製（`network.rs`） |
| `nexus-inference-v1` | 推論 gossip（`p2p_network.rs`） |

### 9.3 同期とテストネット運用

Sprint 1 で**チェーンキャッチアップ**（`sync.rs`）と同期ゲート付き auto-mine を追加。マルチノード docker compose（`tet-core/docker-compose.yml`、`scripts/start-network.sh`）が Phase 0 オペレーター向け推奨パス。`docs/RUNNING_A_NODE.md` を参照。

### 9.4 Cockroach Doctrine（レジリエンス）

データセンター PoC クラスタが失敗しても、PoR メッシュはヘッダー伝播と台帳継続性を維持する；推論スループットは低下するが、チェーンのライブネスは停止しない。これは**設計特性**として残る；惑星規模の PoR 数はまだ公に実証されていない。

---

## 10. ハードウェアフィンガープリント（Sybil 耐性）

### 10.1 攻撃

敵対者が低ティアハードウェアを実行しながら PoC クラス報酬を主張する。

### 10.2 防御（v1.0 §14.2、保持）

**確率的ハードウェアフィンガープリント:** タイミング分布がシリコン固有である非決定論的マイクロタスク。エミュレーションは物理タイミングを大規模に再現しなければならない。

### 10.3 実装

`vision/caac.rs` — 静的プローブ（GPU 名、メモリヒューリスティック）と限定的マイクロベンチマークフック。完全な確率的スケジュールは**部分実装**（§17.5）。

### 10.4 Phase 2

セキュアエンクレーブとの統合（Part II §15 Agent-Gate ピラー 3 参照）により、リクエストごとの ZK なしで存在証明を実現。

---

## 11. トークノミクス

### 11.1 供給上限

**最大供給量:** `10,000,000,000 TET`（`ledger.rs` / `genesis.rs` 内 `MAX_SUPPLY_MICRO`）。

### 11.2 単位表

| 単位 | 定義 | オンチェーン表現 |
|------|------------|---------------------------|
| **TET** | 人間向けトークン | — |
| **Stevemon** | コード/コメント内のサブ単位名 | 1 TET = **10⁶** Stevemon |
| **micro-TET / `*_micro` フィールド** | 整数台帳金額 | `u64` マイクロ単位（= Stevemon アトム） |

**REST 安定性（Phase 0）:** フィールド名はメインネット前に変更される可能性がある（署名では `amount_tet` が `f64` vs `amount_micro` が `u64`）。§17 が API ギャップを文書化する。

### 11.3 ジェネシス四スロット配分

ジェネシスミントは `tet-genesis-v1` ハッシュ（`genesis.rs`）でバインディングされる。四つの論理スロット：

| スロット | ウォレット id | シェア | Phase 0 ミント |
|------|-----------|-------|----------------|
| **Worker pool** | `000…0001`（`WALLET_WORKER_POOL`） | **50%**（5B TET） | ロック済みシステムプールへフルトランシェ |
| **Founder** | `TET_GENESIS_FOUNDER_WALLET_ID` / `TET_FOUNDER_WALLET`（64-hex Ed25519 id） | **25%**（2.5B TET） | ジェネシスでクレジット；**ベスティング / アンロックスケジュール未確定**（§17.3） |
| **Treasury** | `TET_TREASURY_ADDRESS`（必須 64-hex） | **25%**（2.5B TET） | ジェネシスでクレジット |
| **Protocol reserve** | `000…0003`（`WALLET_PROTOCOL_RESERVE`） | **0%**（プレースホルダー） | Phase 0 では**設計上ゼロ** |

レガシーセンチネル `000…0002`（`WALLET_ECOSYSTEM`）は Phase 2B 以降**ミントなし**；財務トランシェは env 設定アドレスへ移行（`WHITEPAPER_v1.0_GAPS.md` §9）。

**リザーブの再利用**（非ゼロミントまたはアドレス変更）は `genesis_hash` を変更 → 新ジェネシスセレモニーなしでは**チェーン非互換**。

### 11.4 Protocol Reserve の目的（Phase 1+）

リザーブスロットは前方互換性のためハッシュペイロードに存在する。想定用途（ガバナンス定義、未配分）：

- セキュリティバグバウンティ
- 緊急運用助成
- オンチェーン提案承認のエコシステム助成
- 潜在的な買い戻し / バーンポリシー（ガバナンス対象）

**Phase 0:** 配分は意図的に**ゼロ**のまま；ノードはジェネシスハッシュ内で `reserve_micro=0` をコミットする。

### 11.5 Sovereign OS マイクロペイメント（Phase 0 — Steve 決定で確定）

**Tmail** および関連 Sovereign OS アクション向けプロトコル手数料（仕様: [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) Appendix C）。金額はメインネット凍結まで**テストネットデフォルト**。

| アクション | 課金 | 台帳フィールド | 備考 |
|--------|--------|--------------|-------|
| **Tmail send** | **1 Stevemon**（= 1 µTET） | `fee_paid_micro = 1` | ほぼ無料 UX；スパムゲート；Phase 0.1 で引き上げの可能性 |
| **Tmail Pin** | **1000 Stevemon** | `pin_stake_micro = 1_000` | 5 メッセージ UI 上限を超える永続スレッド |
| **Anonymous escrow** | **1 TET** | `1_000_000` µTET | 最小ステーク；24h 自動決済 |
| **File share / pin** | TBD | — | サイズ依存手数料 **Phase 0.1** |

**手数料処分（Tmail/Pin/Anonymous プロトコル手数料）:** **50% 財務 / 50% バーン** — §11.6 と同じデフレーションストーリー、決済時に財務アドレスとバーンシンクへルーティング。

**フォーセット（テストネット）:** パブリックシード上で **IP あたり 1 日 100 TET** — プロトコル手数料ではない；オペレーターポリシー。

### 11.6 転送手数料スケジュール（実装済み）

| パラメータ | 値 | コード |
|-----------|-------|------|
| メンテナンス手数料 | 総転送額の **1%** | `PROTOCOL_MAINTENANCE_FEE_BPS = 100` |
| 手数料分割 | **50%** を worker pool、**50%** をバーン | `ledger.rs` 転送決済 |

例（Phase 0 E2E）：`1,000,000` micro（1 TET）送信 → `fee_micro = 10,000`、`net_micro = 990,000`。

**注:** これは**ウォレット転送**パス（`POST /wallet/transfer`）。mempool `POST /ledger/transfer` は別エンベロープ（`SignedTxEnvelopeV1`）を使用する。

### 11.7 デフレーショナリバーン（ビジョン vs 転送パス）

v1.0 §11.2 は持続的使用下で手数料の 50% がバーンされると述べる。実装は**標準ウォレット転送**でこれに一致する。AI 推論経済学はさらに熱力学的 50/50 ワーカー/バーン分割（§5.6）を使用する。v1.1 メインネット文書向け統一ナラティブは**未確定**（§17.7）。

### 11.8 Worker pool エミッション

50% worker pool トランシェは秘密鍵なしの**ロック済み**アドレスへジェネシスでミントされる。プールからプロデューサーへの継続的 PoC/PoR エミッションは `ledger.rs` の coinbase および決済ルールに従う。**エミッションカーブ形状**（定常 vs 減衰）は**未確定**（§17.4）。

---

## 12. 経済セキュリティ（スラッシュモデル）

### 12.1 Lazy-evaluation 詐欺（ZK-Court）

チャレンジウィンドウ中の**証明済み推論詐欺**について、実装は以下を実行する：

```
slash_worker_bond_to_ecosystem_all(worker)
```

すなわち**流動ワーカーボンドの 100%** がエコシステムシンクへバーンされる。これは v1.0 §14.1 および §5.1「没収であり、罰金ではない」に一致する。

**コード:** `vision/zk_court.rs`、`ledger.rs`

### 12.2 パラメトリックモデル（その他の違反クラス — Phase 1+）

v1.0 §14.3 はスラッシュ可能担保を定義する：

```
S = λ · R_expected
```

`λ` デフォルト **100**（`TET_SLASH_LAMBDA_MULTIPLIER`）、`R_expected` は決済アーティファクトに保存される。

**v1.1 の選択（Option A — コードに正直）:**

| 違反クラス | Phase 0 ルール | 将来 |
|---------------|--------------|--------|
| ZK-Court 推論詐欺 | **100% ボンドスラッシュ** | 維持 |
| その他ビザンチン行為（二重署名、無効ブロック等） | アドホック / 部分 | Phase 1 で **min(bond, λ·R_expected) で上限** |

現状 `λ` と `R_expected` は紛争向け**テレメトリ**であり、ZK-Court スラッシュを**上限設定しない**。`WHITEPAPER_v1.0_GAPS.md` §3 を参照。

### 12.3 合理性の議論

100% スラッシュの詐欺では、期待利得はボンド未満でなければならない。将来の上限付き違反では、不等式 `S > R_expected` がメインネット凍結時のパラメータ選択で強制されるべきである。

### 12.4 Founder と財務の運用セキュリティ

Founder プレマインはアンロックポリシーの対象（§17.3）。財務アドレスはテストネットでは env 駆動；本番財務移行には協調ジェネシスまたは転送ポリシーが必要。

---

## 13. Sovereign OS Suite（Phase 0）

> **Phase 0 成果物。** Sovereign OS は TET Network のユーザー向け面である：ウォレットタブではなく、`tet-core` と libp2p に支えられた日常利用の**デスクトップ環境**。完全技術仕様: [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md)。

### 13.1 哲学

- **TET UI ≠ ウォレット** — ユーザーは単一の「Send Coins」ページではなく、OS メタファー（アプリ、ウィンドウ、タスクバー）で生活する。
- **ローカルファースト、ノードバックド** — ブラウザはユーザーの `tet-core` REST API と通信；libp2p はブラウザではなくノードで動作する。
- **アプリより L1** — パブリックテストネット（シード、フォーセット、Docker）は Tmail より前の **Sprint 4** で出荷（§19.1 参照）。

### 13.2 デスクトップシェル — 「1990 年代デスクトップ OS に着想」

ビジュアルデザインはオープン **98.css** スタイリングを使用：グレーのベベルクローム、ドラッグ可能ウィンドウ、タスクバー、スタートメニュー、ブートアニメーション。マーケティングおよび About コピー：

**「Inspired by 1990s desktop OS」** — Microsoft® 商標なし；Microsoft とは無関係、後援も受けていない。

### 13.3 コアアプリケーション（Phase 0）

| アプリ | 役割 |
|-----|------|
| **Wallet** | ハイブリッド Ed25519 + ML-DSA 転送；ジェネシスバインド認証 |
| **Tmail** | 暗号化メッセージング（§13.4） |
| **Files** | ローカルメールボックス、libp2p P2P 転送、オプション有償複製 |
| **Explorer** | ブロック / トランザクション閲覧 |
| **Mini-apps** | 電卓（TET/USD/JPY）、時計（ブロック高）、メモ（暗号化ローカル） |

**Worker** 推論 UI は Phase 0 では**非表示**（開発者向け `SHOW_WORKER_TAB=true`）。プロダクト化された earn パス → Phase 0.5。

**オンボーディング:** `docker compose up` が**ノード + UI** を起動（一般ユーザー向け必須パス）。

### 13.4 Tmail — 五つの機能

| # | 機能 | Phase 0 メカニズム |
|---|---------|-------------------|
| 1 | **Basic E2EE** | X25519 + ML-KEM + ChaCha20-Poly1305（`tet-core/src/e2ee.rs`） |
| 2 | **Time-lock** | **ステークスケジュール** `release_at_ms`（ノードが復号ポリシーを強制）；VDF アップグレード §17.8 |
| 3 | **Burn-after-read** | 既読レシート → gossip revoke；**ベストエフォート**（§17.9） |
| 4 | **Anonymous sender** | Anchor + ephemeral + RISC0 所有権証明；**1 TET** エスクロー |
| 5 | **5-msg window + Pin** | UI 上限；永続化に **1000 Stevemon** ステーク |

Gossip トピック：ブロックプレーン libp2p swarm 上 `/tet/v1/tmail`。暗号文は台帳に**保存されない**；手数料と監査メタデータのみ。

**マーケティング規律:** time-lock、burn、anonymous モードの公称「世界初」主張には、パブリックテストネット上の**受入テスト AT-3、AT-4、AT-5** が必要（Steve 決定）。

### 13.5 Anonymous Mode アーキテクチャ

```
Anchor wallet (persistent, BIP39)
    │ fund + escrow (1 TET minimum)
    ▼
Ephemeral wallet (per-send/session) ──ZK proof──► "anchor owns ephemeral" (RISC0 guest)
    │ send Tmail (gossip shows ephemeral only)
    ▼
Receiver sees anonymous sender; third parties cannot link to anchor
    │
Anchor-only audit trail (REST, hybrid-signed) — voluntary disclosure path
```

- **24h 自動決済**は紛争がなければ未使用エスクローを anchor に返却。
- 悪用抑止：高額エスクロー + ZK-Court スラッシュ連動（§12）。

### 13.6 Phase 0 運用と出荷目標

| 項目 | ポリシー |
|------|--------|
| **出荷目標** | **2026-09-15**（機能凍結 **2026-08-31**、2 週間ポリッシュ） |
| **パブリックシード** | 出荷前 **1×** Hetzner EU（約 $5/月）；トラフィックに応じて 2 ノード目（SPOF 許容） |
| **フォーセット** | **100 TET / 日 / IP** |
| **スプリント計画** | S4 Foundation → S5 Tmail protocol → S6 E2EE+shell → S7 time-lock/burn/pin → S8 Anonymous+ZK → S9 Files → S10 mini-apps → S11 QA |

---

# Part II — Layer 2 アプリケーション（将来ビジョン）

> **Phase 0 成果物ではない。** 以下のセクションはアーキテクチャ意図を記述する。実装は、連合学習、オンチェーン推論経済学、マシン間決済における未解決課題の解決に依存する。

## 14. World Brain（Neural State Transitions）

アイドル期間中、PoC ノードは共有ベースモデルの**連合ファインチューニング**に余剰コンピュートを提供する。チェーン状態は、プライバシー保護エッジテレメトリによって洗練される、生きた改ざん耐性モデルアーティファクトとなる。

**依存関係:** Part I の CAAC + ZK-Court が大規模で稼働；プライバシーとモデルガバナンスの未解決課題。

**ステータス:** 研究 / 未実装。

---

## 15. Sentient Assets（Smart Contracts 2.0）

コントラクトはコンテキスト上の推論を埋め込む — 詐欺パターンを推論するウォレット、ライブエコシステムデータから価格を交渉する資産 — World Brain 状態遷移の上に構築される。

**ステータス:** 研究 / 未実装。

---

## 16. Agent-Gate（Machine-to-Machine Economy）

人間 UX を劣化させずに自律エージェントスウォームに**経済的摩擦**を課す M2M API ゲートウェイ：

1. **Invisible UX** — Sovereign OS ローカルエージェントがバックグラウンドで micro-TET を消費。
2. **State channels** — 高頻度エージェント決済は L1 上で日次ネット決済。
3. **Hardware-enclave PoR** — リクエストごとの ZK なしで Secure Enclave / TrustZone による存在証明。

**ステータス:** 研究 / 未実装；§10 エンクレーブロードマップと重複。

---

# Part III — 未解決課題と比較

## 17. 未解決課題

各項目は率直に述べる；明記がない限り解決は主張しない。

### 17.1 敵対的ハードウェアなりすまし下での η(W_i) の形式的定義

商品ハードウェア上で同時に測定可能、エミュレータタイミング攻撃に耐性があり、R(T) に合成可能な閉形式 η(W_i) が欠如している。Phase 0 は (C/E)×Γ プロキシを使用。**ステータス: 未解決。**

### 17.2 SP1 プローバー統合

ZK-Court パイプラインは ELF 存在時 RISC Zero のみ。SP1 は v1.0 で引用されるが `zk_verifier.rs` に配線されていない。**ステータス: 未解決**（RISC0 部分実装）。

### 17.3 Founder アンロックスケジュール（cliff vs 線形ベスティング）

Founder トランシェはジェネシスでミント；founder 残高の大部分は台帳ポリシーで**ロック**されている可能性がある。メインネット向け cliff vs 線形ベスティングは未決定。**ステータス: 未解決。**

### 17.4 Worker pool エミッションカーブ

ジェネシスで 5B TET をロックプールへミント；継続エミッション率形状（定常 vs 減衰）は未確定。**ステータス: 未解決。**

### 17.5 CAAC ハードウェアフィンガープリント攻撃モデル

タイミングマイクロタスクは記述されている；形式的セキュリティゲーム（エミュレータ、FPGA、モバイルを装うクラウド GPU）は未記述。**ステータス: 未解決**（実装部分）。

### 17.6 クロスチェーンブリッジ設計（Phase 1 相互運用性）

ETH/SOL/BTC カストディ向け正規ブリッジ仕様なし。**ステータス: 未解決。**

### 17.7 スラッシュ規模と経済記法の調整

§12 は ZK 詐欺向け 100% スラッシュを文書化する一方、§14.3 は λ·R_expected パラメトリックモデル。AI 50/50 熱力学的分割 vs グローバル手数料バーン表現は異なる。**ステータス: 部分**（GAPS 文書で文書化；コードは Option A）。

### 17.8 Time-lock 暗号アップグレード

**Phase 0:** Time-lock 配送は**ステークスケジュール release**（署名エンベロープ内 `release_at_ms`；ノードは早期復号を拒否）。信頼は**社会的/プロトコル強制**であり、壁時計暗号的ではない。

**Phase 0.1+:** **Verifiable Delay Function（VDF）** または閾値復号による**トラストレス** time-lock。クラス群 VDF 評価は研究トラック（[`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) §A.2 参照）。

**ステータス: 未解決**（VDF）；Phase 0 パスは**ポリシーにより実装済み**。

### 17.9 Burn-after-reading 暗号保証

**Phase 0:** Burn は**ベストエフォート**：協調ピアが既読レシート gossip 後に暗号文を削除；悪意のアーカイバは暗号化 blob を保持しうる。UI コピーはこれを明示する。

**Phase 1+:** 前方秘匿セッション + 暗号鍵破棄証明；CRDT 全体 revoke 研究の可能性。

**ステータス: 未解決**（強保証）；Phase 0 パスは**ベストエフォート**。

### 17.10 REST API 完全性

`POST /wallet/transfer` に `tx_hash` / ブロック確認フィールドがない；`amount_tet` f64 vs 署名 `amount_micro` u64。**ステータス: 未解決**（Phase 1）。

### 17.11 パブリックテストネット規模でのマルチノード同期

キャッチアップドライバは存在；72h パブリックテストネットソーク未完了。**ステータス: 部分**（`docs/SYNC_ISSUE.md`）。

### 17.12 二重 genesis_hash バグクラス（2026-05-20 解決）

ウォレット vs 台帳ジェネシスハッシュ乖離がすべてのハイブリッド転送を破壊。`genesis.rs` で修正。**ステータス: テストネットでクローズ**；プロセス教訓として記録。

### 17.13 AI 推論のためのマイニングハードウェア再利用

Bitcoin および PoW 系アルトコインネットワークは、年間おおよそ **~150 TWh**（オーダー・オブ・マグニチュードの業界推定；出典・年で数値は異なる）を消費するが、ハッシュパズル完了以外に**有用な計算出力**は生まない。TET の CAAC worker モデルは、原理的には、PoW 向けにすでに配備されている同一クラスの GPU ハードウェア上で、低利益ウィンドウ中に **AI 推論報酬**を得るため **GPU マイナーの二重用途化**が可能かもしれない。

**スコープ（候補 vs 除外）:**

| クラス | 例 | TET 再利用 |
|-------|----------|-----------|
| **GPU PoW マイナー** | GRIN、Ergo、Ethereum Classic、その他 general-compute 向き PoW | アイドル時間切替の **候補** |
| **SHA-256 ASIC マイナー** | Bitcoin core ハッシュレート | **除外** — 一般 AI 推論とハードウェア非適合 |

**メカニズム（推測）:** PoW マイニングと TET worker モードの間のアイドル時間自動切替。**リアルタイム収益性オラクル**（hashprice vs 熱力学推論報酬 `R_micro`、§5.3）および CAAC 役割分類（§6）でゲート。

**未解決の問い:**

- **インセンティブ整合性** — 期待値で切替は単一プロトコルマイニングを上回るか、プールロックイン / 分散が支配するか？
- **切替レイテンシと冷却** — PoW カーネルと推論ランタイム間の往復における熱サイクルとドライバ再ロードコスト。
- **不正防止 / フィンガープリント** — プロトコル切替を跨いでも CAAC ハードウェア証明（§10）が安定しなければならない；エミュレータタイミング攻撃は悪化しうる。
- **マイニングプール経済** — PPS、FPPS、stratum 型契約との統合。プール ToS 違反やハッシュレートコミットメント二重支出なしに可能か。

**ステータス:** research / 将来方向。**Phase 0 では出荷しない。** Phase 1+ の探索のみ；デュアルマイニング製品化へのコミットメントはない。

---

## 18. 比較表

### 18.1 Layer 1 ポジショニング

公開プロジェクト資料（2026-05）からの事実要約。不確実な場合：**unknown / not stated**。

| プロジェクト | コンセンサス | 証明モデル | ハードウェアモデル | トークンペグ | PQ 耐性 | レイヤー位置 |
|---------|-----------|-------------|----------------|-----------|---------------|----------------|
| **TET Network** | CAAC（PoC + PoR）、L1 テストネット | 楽観的推論 + ZK-Court（RISC0）；ハイブリッド Ed25519+ML-DSA 転送 | 適応型役割；フィンガープリント部分 | **エネルギー/コンピュートペグ（η ビジョン；Phase 0 (C/E)×Γ プロキシ）** | ML-DSA ジェネシス + ハイブリッドウォレット | Sovereign L1 + OS UI |
| **Bittensor** | サブネットマイナー上の Yuma コンセンサス | 労働/市場 proof of intelligence | サブネット固有マイナー | 労働市場価格付け（TAO） | ベースで PQ ネイティブではない | Intelligence marketplace L1 |
| **Gensyn** | コンピュート調整（rollup 中心ドキュメント） | 検証可能 ML コンピュート証明 | GPU ワーカー | コンピュート・アズ・ア・サービス決済 | unknown / not stated | Compute layer / L2-ish |
| **Ritual** | EVM + 特殊ノード（公開ドキュメント） | オンチェーン推論オーケストレーション | ノード特殊化 | Gas / ETH 経済層 | Ethereum 前提を継承 | Inference chain / L2 |
| **Render** | Solana 隣接ワークロードネットワーク | ジョブ完了証明 | GPU レンダーファーム | ワークユニット価格付け（RENDER） | Solana スタック | Compute marketplace |
| **Filecoin** | Expected コンセンサス + PoRep/PoSt | ストレージ replication 証明 | ストレージハードウェア | ストレージ市場価格付け | PQ ネイティブではない | Storage layer |

### 18.2 セキュアメッセージング vs TET Tmail（Phase 0 目標）

**L1 + メッセージング**を二軸で差別化 — コンセンサスのみではない：

| 機能 | Signal | Telegram | Session | **TET Tmail（Phase 0）** |
|------------|--------|----------|---------|-------------------------|
| **libp2p / 分散トランスポート** | No | No | Yes | **Yes** |
| **ポスト量子（ML-DSA / ML-KEM パス）** | No | No | No | **Yes** |
| **オンチェーン手数料 / 監査メタデータ** | No | No | No | **Yes** |
| **Time-lock 配送** | No | No | No | **Yes**（ステークスケジュール） |
| **ネットワーク burn-after-read** | No | Limited（timer） | No | **Yes**（ベストエフォート） |
| **ZK 匿名送信者 + anchor 監査** | No | No | Partial（Session ID） | **Yes**（1 TET エスクロー） |

**過大主張しないこと:** 行は **2026-09-15** 出荷目標がパブリックテストネット上で AT-3..AT-5 を通過することを前提とする。それまでは表は**設計意図**である。

**出典（参考）:** TET — 本文書 + `tet-core` + [`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md)；Signal/Telegram/Session — 公開製品ドキュメント。

**L1 注意:** TET テストネットはまだ惑星規模 PoR、SP1 証明、閉形式 η を実証していない。

---

## 19. ロードマップ

### 19.1 Phase 0 — Sovereign OS + パブリックテストネット（現行）

**スプリント順序**（[`SOVEREIGN_OS_PHASE0_SPEC.md`](./SOVEREIGN_OS_PHASE0_SPEC.md) §B.1 参照）：

| スプリント | フォーカス |
|--------|--------|
| **S4** | **L1 Foundation** — 1 パブリックシード（Hetzner EU）、フォーセット 100 TET/日/IP、Docker node+UI、CI/CD、運用ドキュメント |
| **S5** | Tmail protocol + REST + gossip |
| **S6** | Tmail E2EE + Win95 shell |
| **S7** | Time-lock + burn + Pin |
| **S8** | Anonymous Mode + ZK guest |
| **S9** | Files P2P |
| **S10** | Mini-apps（Calculator, Clock, Notes） |
| **S11** | QA + ship |

**成果物:**

- **出荷可能なパブリックテストネット**（UI のみではない）：シード、フォーセット、`docker compose up`
- **Sovereign OS**（§13）：Wallet、Tmail（5 機能）、Files、mini-apps
- 熱力学的価格付け**近似**（§5.3）
- ML-DSA + Ed25519 ハイブリッドウォレット
- ZK-Court + Anonymous Tmail RISC0 パス（dev ELF；必要に応じ CI stub）

**明示的非目標:** Part II プリミティブ（§14–§16）、メインネット凍結、SP1、クロスチェーンブリッジ、プロダクト化 AI Worker earn（Phase 0.5）。

**目標:** **2026-09-15** パブリック Phase 0 出荷（機能凍結 **2026-08-31**）。オペレーター / ビルダープレビュー — 金融プロモーションではない。

### 19.2 Phase 1 — CAAC + 経済学ハードニング

- 完全 CAAC 役割自動化；改善フィンガープリント（§17.5）
- SP1 バックエンドオプション（§17.2）
- VDF time-lock（§17.8）；より強い burn 保証（§17.9）
- Founder ベスティング + REST API 安定性（§17.3、§17.10）
- λ·R_expected を用いた上限付きスラッシュクラス（§12.2）
- ガバナンス経由のオプション Protocol Reserve 資金（§11.4）
- 2 番目のパブリックシード + トラフィック SPOF 緩和

### 19.3 Phase 2 — ポスト量子流動グリッド

- 証明済み電力テレメトリからの η（§5.5）
- 連合学習 / World Brain（§14）
- Sentient assets + Agent-Gate（§15–§16）
- エッジ参加テーゼに向けたスケールアウト

---

## 20. 結論

TET Network は漸進的な L1 の微調整ではない。**ハードウェア適応型コンセンサス**、**ポスト量子署名**、および労働市場や集中型推論 API とは異なる**エネルギー連動発行哲学**を結合する。Version 1.1 は構造を正直にする：Part I は構築・テストするもの；Part II はプロトコルが向かう先；Part III は依然として数学、コード、または両方を要するもの。

テストネットは、二重 `genesis_hash` 実装のようなバグを、永続的なメインネット障害になる前に発見するために存在する。メカニズムを反証できるエンジニアは、本番ではなくテストネットでそうすべきである。

---

## 21. ビルダーへの呼びかけ

求める専門性（v1.0 の精神は変更なし）：

- Rust システムプログラミング（コンセンサス、台帳、ネットワーク）
- 大規模 libp2p
- zkVM エンジニアリング（現行 RISC Zero；将来 SP1）
- 応用暗号（ML-DSA、ハイブリッドプロトコル）
- 分散 ML インフラ

技術的批判：**yizhenxianshi@gmail.com**（件名: Core Builder Application）

---

## 22. 参考文献

### コアコンセンサスと暗号経済学

[1] Nakamoto, S. (2008). *Bitcoin: A Peer-to-Peer Electronic Cash System.*  
[2] Buterin, V. (2014). *Ethereum: A Next-Generation Smart Contract and Decentralized Application Platform.*  
[3] Sompolinsky, Y., & Zohar, A. (2015). *Secure High-Rate Transaction Processing in Bitcoin.*  
[4] Buterin, V., & Griffith, V. (2017). *Casper the Friendly Finality Gadget.*

### ゼロ知識とポスト量子暗号

[5] Ben-Sasson, E., et al. (2014). *SNARKs for C: Verifying Program Executions Succinctly and in Zero Knowledge.*  
[6] RISC Zero Team. (2023). *RISC Zero zkVM.*  
[7] Succinct Labs. (2024). *SP1 zkVM.*  
[8] NIST. (2024). *FIPS 204: ML-DSA.*

### 分散 AI とネットワーク

[9] Rao, Y. (2021). *Bittensor: A Peer-to-Peer Intelligence Market.*  
[10] Borzunov, A., et al. (2022). *Petals: Collaborative Inference and Fine-tuning of Large Models.*  
[11] AI@Meta. (2024). *Llama 3 Model Card.*  
[12] Protocol Labs. (2019). *libp2p.*

### 熱力学とハードウェアセキュリティ

[13] McMahan, B., et al. (2017). *Communication-Efficient Learning of Deep Networks from Decentralized Data.*  
[14] Landauer, R. (1961). *Irreversibility and Heat Generation in the Computing Process.*  
[15] Bennett, C. H. (1982). *The Thermodynamics of Computation.*  
[16] Suh, G. E., & Devadas, S. (2007). *Physical Unclonable Functions for Device Authentication.*

### 実装付録（非規範）

- `tet-core/src/genesis.rs` — 正規 `genesis_hash`
- `tet-core/src/vision/thermo_genesis.rs` — Phase 0 熱力学的推定
- `tet-core/src/ledger.rs` — 手数料、バーン、ジェネシス配分
- `docs/WHITEPAPER_v1.0_GAPS.md` — v1.0 vs コード監査トレイル

---

*Whitepaper v1.1 Draft 終了 — 2026-05-21*
