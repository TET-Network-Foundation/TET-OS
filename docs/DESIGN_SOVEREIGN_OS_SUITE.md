# Sovereign OS Suite — Messages + File Sharing (Design & Phase 0 Plan)

**Date:** 2026-05-19  
**Audience:** Steve (non-negotiable: TET UI = Sovereign OS, not “just a wallet”)  
**Method:** Code-read + explicit design inference where noted. **Does not modify** `WHITEPAPER_v1.1_DRAFT.md`.  
**Companions:** [`WORKER_MODE_AUDIT.md`](./WORKER_MODE_AUDIT.md), [`UI_STATUS_PHASE0.md`](./UI_STATUS_PHASE0.md), [`CODEBASE_ATLAS.md`](./CODEBASE_ATLAS.md)

---

## Executive summary

| Question | Answer |
|----------|--------|
| Phase 0 に Messages + Files を **フルビジョン**で含めて ship 可能か？ | **No（無条件）** / **Yes（条件付きスコープ）** |
| 条件付きスコープ | **Messages Lite**（E2EE + µTET fee + 5-msg UI + REST/単一 gossip topic）。**Files** は Phase 0 = **mailbox metadata + ローカル保持のみ**（libp2p ファイルストリームは 0.5） |
| 6月末維持の現実性 | Send Coins のみなら **可能**（Sprint 3 完了想定）。フル Suite は **+4〜6週** → **2026年8月初** ship 推奨 |
| 既存資産 | **Inbox タブあり** — 転送 audit ポーリング（`useIncomingMessages.ts`）。**E2EE 基盤あり**（`e2ee.rs`）。**3 libp2p swarms** 稼働（`main.rs:461-571`） |

---

## Part A — 既存 libp2p インフラ

### A.1 現状トポロジ（3 swarms、同一キーでも別 Swarm）

`main.rs` は **3 つの独立 libp2p Swarm** を起動する（`main.rs:461-571`）:

| Swarm | Module | 主用途 | Gossip / RR |
|-------|--------|--------|-------------|
| **network** | `network.rs` | Ledger replication / guardian | Topic: `/tet/v1/ledger` (`network.rs:28`) |
| **p2p_network** | `p2p_network.rs` | AI inference marketplace | Topic: `nexus-inference-v1` (`p2p_network.rs:41`, `596-597`) |
| **block plane** | `p2p.rs` | Blocks, txs, sync, AI workload gossip | Topics: `/tet/v1/blocks`, `/tet/v1/txs`, `/tet/v1/ai-workload` (`p2p.rs:337-339`); RR: block-sync, chain-sync (`p2p.rs:42`, `sync.rs:15-18`) |

**Block-plane `TetBehaviour`** (`p2p.rs:1127-1136`): mdns, ping, gossipsub, identify (`/tet/identify/1.0.0` `p2p.rs:1118-1120`), Kademlia, request-response (block + chain sync).

**Inference-plane `NexusBehaviour`** (`p2p_network.rs:386-394`): Kademlia, gossipsub, identify, autonat, relay, dcutr — **E2EE inference 用**（`p2p_network.rs:784-986`）。

**REST → gossip ブリッジ:** `RestState.gossip_tx` は **block plane** の mpsc（`rest/state.rs:45`, `main.rs:530-582`）。`NetworkEvent` JSON を publish（例: `TransferExecuted` `ledger.rs:794-799`, `models.rs:26-32`）。

### A.2 Messages / Files を載せるべき plane

| 選択肢 | 推奨 | 理由 |
|--------|------|------|
| 4th swarm（messages 専用） | **非推奨 Phase 0** | ポート/NAT/接続数が増え、bootnode 設定が複雑化（`main.rs:560-565`） |
| `p2p_network` に topic 追加 | **非推奨** | 推論スコアリング・E2EE 推論パイプと混線（`p2p_network.rs:566-597`） |
| **block plane に topic 追加** | **推奨** | 既に `gossip_tx` + `TXS_TOPIC` + `NetworkEvent` 拡張パターンあり |

**設計判断:** **同一 block swarm、別 gossip topic**（Messages plane と Block plane の **論理分離**、物理は multi-topic）。

提案 topic:

```text
/tet/v1/messages     # DirectMessage gossip (ciphertext envelope)
/tet/v1/files-meta   # FileShare metadata only (Phase 0.5+)
```

**Block gossip との分離:** 必須ではない（gossipsub は topic 単位でスコアリング済み `p2p.rs:1093-1097`）。**メッセージ flood がブロック同期を阻害しないよう** `TET_P2P_GOSSIP_MAX_MSG_BYTES` 上限をメッセージ用に別枠（現状 default 128KiB `p2p.rs:342-349`）。

### A.3 新 protocol 追加の影響

| 変更点 | ファイル | 影響 |
|--------|----------|------|
| `MESSAGES_TOPIC` 定数 + subscribe | `p2p.rs` ~1093, ~1147 | 低 — 既存パターン踏襲 |
| `NetworkEvent::DirectMessage { ... }` | `models.rs:6-43` | 中 — 全ノードが deserialize |
| Swarm loop で受信 → REST/WebSocket 配信 | `p2p.rs` loop | 中 |
| `POST /messages/send` → `gossip_tx.send` | 新 `messages.rs` handler | 中 |
| ファイル本体 RR | 新 `request_response` behaviour on block swarm | **高** — Phase 0.5 |

---

## Part B — Messages MVP

### B.0 現状 UI（Steve の「Messages」に近いもの）

| 資産 | 状態 | 参照 |
|------|------|------|
| Tab **"Inbox / Receive"** | 転送受信 UI（Outlook 風） | `OsClient.tsx:69`, `1980-2064` |
| `useIncomingMessages` | `GET /explorer/events` で `action=transfer` をポーリング、**memo は常に空** | `useIncomingMessages.ts:136-184` |
| localStorage | 最大 250 件 `tet.inbox.messages.v1` | `useIncomingMessages.ts:11-12`, `75-79` |
| E2EE チャット | **未実装** | — |
| `POST /messages/*` | **存在しない**（grep 0） | — |

**ギャップ:** 現 Inbox は **「送金通知」** であり、Steve の **E2EE 直接メッセージ + µTET 課金** ではない。タブ名を **Messages** にリブランドし、送金 inbox をサブビューに残すか分離する設計が必要。

### B.1 Protocol design（推奨 envelope）

**オフチェーン payload（libp2p + 任意 REST キャッシュ）:**

```json
{
  "v": 1,
  "kind": "tet_direct_message_v1",
  "msg_id": "<uuid or hash>",
  "sender_wallet_id": "<64-hex>",
  "receiver_wallet_id": "<64-hex>",
  "sent_at_ms": 1710000000000,
  "nonce": 1,
  "ciphertext_b64": "...",
  "client_ephemeral_pub_b64": "...",
  "client_mlkem_pub_b64": "...",
  "mlkem_ciphertext_b64": "...",
  "chacha_nonce_b64": "12-byte",
  "plaintext_sha256_hex": "<optional commit>"
}
```

**Topic 戦略:**

| 案 | Privacy | Phase 0 |
|----|---------|---------|
| グローバル `/tet/v1/messages` | 低（全員が subscribe、暗号化で保護） | **推奨** — 実装単純、Kademlia + gossip で届く |
| 受信者別 topic `/tet/v1/messages/{wallet}` | 高 | **Phase 1** — DHT 提供レコードが必要 |

**推論:** Phase 0 は **グローバル topic + E2EE** で十分（WhatsApp 早期と同型）。メタデータ（誰が誰に送ったか）は gossip 上に **平文**（wallet id）。完全メタ秘匿は Phase 1。

### B.2 E2EE レイヤ（既存コードの再利用）

**既存:** `tet-core/src/e2ee.rs`

| Primitive | 実装 |
|-----------|------|
| X25519 ECDH | `StaticSecret`, `PublicKey` (`e2ee.rs:82-86`) |
| ML-KEM-768 hybrid KDF | `derive_key_hybrid` + HKDF-SHA256 (`e2ee.rs:112-119`) |
| AEAD | ChaCha20-Poly1305 (`e2ee.rs:6-7`, `165-167`) |
| Encrypt path | `encrypt_for_worker` — client ephemeral → worker static (`e2ee.rs:147-168`) |

**Messages 向けマッピング（設計）:**

| 役割 | Phase 0 推奨 |
|------|----------------|
| **Sender** | 毎メッセージ **ephemeral X25519** + 受信者の **登録済み X25519 pub**（worker register と同型 `worker.rs:197-206`） |
| **Receiver static X25519** | `POST /worker/register` の `x25519_pubkey_b64` **または** 新 `GET /messages/keys/:wallet`（ledger meta に保存） |
| **ML-DSA** | Envelope **auth**（spam 防止・非否認）— `wallet.rs` hybrid と同型の新 preimage `tet direct message v1|...` |
| **Ed25519** | `wallet_id` = verifying key（`HybridSigV1.ed25519_pubkey_hex` `protocol.rs:110-115`） |
| **Forward secrecy** | **Phase 0 不要**（Steve 合意どおり）。Phase 1: Double Ratchet / Session keys |

**Ed25519 pubkey から X25519 への変換:** コードベースに **標準変換は未実装**（推論）。Phase 0 推奨:

1. **明示的に** register 時に `x25519_pubkey_b64` を載せる（既存フィールド `WorkerRegisterReq` `types.rs:201-202`）、または  
2. UI で mnemonic から **両鍵**を導出して公開（`ed25519_tet.ts` + 新 x25519 導出）。

**ML-DSA の役割:** ciphertext の改ざん検知 + 「この wallet が送った」証明。**FS には寄与しない。**

### B.3 Storage

| Phase | 保管 | 実装イメージ |
|-------|------|----------------|
| **0** | 受信者 **IndexedDB/localStorage** に E2EE のまま | UI `messages.ts`; 会話ごと **最新 5 件**のみ UI 表示 |
| **0** ノード | 任意: sled `meta` に **暗号化 blob なし**の索引のみ（`msg_id`, hash, fee audit seq） | 推論 — 24h TTL |
| **0.5** | libp2p 上で 3–5 peer が encrypted blob を保持（pin） | stake 連動 |
| **1** | TET stake 永続ストア | Filecoin-like は Phase 1 |

**Steve の「5 messages limit」:**

| 層 | 実装 |
|----|------|
| **UI** | 会話スレッドで `slice(-5)` 表示；古い件は「archived / unlock with Pin」 |
| **localStorage** | 推奨: 会話あたり max 5 **復号済み** or max 50 **暗号文**（設定可能） |
| **Ledger** | **ciphertext を載せない**（D.2）— `message_delivered_v1` audit のみ |
| **Gossip** | ノード側: 24h 後に re-publish しない / メモリ LRU（推論、env `TET_MESSAGE_TTL_MS`） |
| **Pin** | Phase 0.5: µTET stake → meta KV + gossip retain flag |

### B.4 µTET fee

| 項目 | 推奨 Phase 0 | 根拠 |
|------|----------------|------|
| 単価 | **100 micro-TET (0.0001 TET)** / message | Steve 例；spam に対し転送 fee より軽い |
| 徴収 | **On-chain micro-transfer** または dedicated `MessageFee` audit + `Transfer` の fee 部分 | 既存 fee 分割: 20% network fee → 50% pool / 50% burn の半分が burn、残り treasury（`ledger.rs:129-131`, `1900+` transfer path） |
| 新規 `TxV1::MessageFee` | Phase 0 **任意** — 最小は `Transfer` + memo hash で代用 | `protocol.rs` に variant 無し（`30-90`） |
| Treasury vs burn | **既存 transfer と同じ BPS**（`NETWORK_FEE_BPS` 2000）を message fee にも適用 | 一貫性 |
| 無料枠 | **10 msg / day / wallet**（推論、meta counter） | 新規ユーザー優しさ |

**consensus.rs:** Message fee は **ブロック報酬には含めない**（`VerifyZkProof` / `EnterpriseInference` のみ `consensus.rs:461-486`）。単純な transfer 系で十分。

### B.5 REST API（新規・提案）

| Method | Path | Phase | Body / 動作 |
|--------|------|-------|-------------|
| POST | `/messages/send` | 0 | ciphertext envelope + hybrid sigs → verify → **ledger fee settle** → `gossip_tx` publish |
| GET | `/messages/inbox` | 0 | **ローカルノードが受け取った** gossip バッファ（in-memory deque per wallet） |
| GET | `/messages/keys/:wallet_id` | 0 | `x25519_pubkey_b64`, `mlkem_pubkey_b64`（register から or meta） |
| GET | `/messages/preview-fee` | 0 | `fee_micro`, free_quota_remaining |
| POST | `/messages/pin` | 0.5 | stake_micro, msg_id |

**注意:** ブラウザ UI は **tet-core REST** 経由（`tet_core_http.ts`）。libp2p は **ノードが** subscribe。Phase 0 で「ブラウザだけで P2P」は **不可** — UI は接続先ノードの inbox API を poll（Inbox と同型 `useIncomingMessages.ts:203`）。

### B.6 UI design

| 要素 | 推奨 |
|------|------|
| Tab | **`Messages`**（`Inbox / Receive` を統合 or サブタブ） |
| Conversation list | Address book 連携（`AddressBookPanel` 既存 `OsClient.tsx:2065`） |
| Thread view | 最新 **5** メッセージ、古いものはグレーアウト + Pin CTA |
| Compose | wallet_id + textarea + **fee preview** + Send |
| Pin | Phase 0.5 — µTET 表示 |

**新規コンポーネント（E.1 参照）:** `MessagesTab.tsx`, `lib/messages.ts`, `lib/e2ee.ts`（UI 側 ChaCha — または WASM 化 `tet-pqc-wasm` 連携）。

---

## Part C — File Sharing MVP

### C.1 Protocol（Phase 0 vs 0.5）

| Phase | 本体 transport | Metadata |
|-------|----------------|----------|
| **0** | **Sender device のみ**（mailbox）— drag-drop → SHA-256 CID → share metadata | REST `POST /files/share` + local IndexedDB |
| **0.5** | libp2p **request-response** `/tet/v1/files/chunk` on block swarm | gossip `/tet/v1/files-meta` |
| **1** | Stake-paid replication | DHT provide |

**Envelope（metadata）:**

```json
{
  "v": 1,
  "kind": "tet_file_share_v1",
  "file_cid": "sha256:...",
  "file_size": 12345,
  "sender_wallet_id": "...",
  "receiver_wallet_ids": ["..."],
  "expiration_ts_ms": 1710000000000,
  "stake_micro": 500000,
  "hybrid_sig": { ... }
}
```

### C.2 Storage incentives

| 機能 | Phase 0 | Phase 0.5+ |
|------|---------|------------|
| keep-alive stake | UI で stake 表示のみ / ledger lock **未実装** | `stake_worker_bond` パターン流用（`ledger.rs:2597`）を file pin に |
| expire → drop | ローカル TTL | gossip 再配信停止 |

### C.3 REST（提案）

| Path | Phase |
|------|-------|
| `POST /files/share` | 0 — metadata + audit |
| `GET /files/inbox` | 0 |
| `POST /files/upload` | 0 — **HTTP multipart → ノードローカル store**（推論） |
| `GET /files/download/:cid` | 0.5 — libp2p stream |

### C.4 UI

| Tab | Phase 0 |
|-----|---------|
| **Files** | Drop zone + recipient picker + stake slider（**ローカルモード**明示） |
| Received list | CID + size + expiry |

---

## Part D — Ledger / consensus 影響

### D.1 新規 `TxV1` variants

**現状 `TxV1`:** `SignerLink`, `FoundingMemberEnroll`, `Transfer`, `GenesisBridge`, `EnterpriseInference`, `VerifyZkProof`（`protocol.rs:30-90`）— **Message/File なし**。

| 案 | On-chain body | Phase 0 推奨 |
|----|---------------|----------------|
| A | `TxV1::MessageSent { sender, receiver, ciphertext_hash, fee_micro, nonce }` | **メタのみ** — mempool に載せるかは **任意**（spam: 載せない方がよい） |
| B | 既存 `Transfer` + audit `action: "message_fee_v1"` | **最小変更** |
| C | libp2p only、ledger は触らない | fee 徴収が **オフレッジャ** になり信頼性低下 |

**Phase 0 推奨（Steve 方針と一致）:**

- **fee / stake:** on-chain（`Transfer` または小額専用 transfer + audit）
- **ciphertext / file bytes:** **libp2p（+ ノード RAM バッファ）のみ**
- **consensus block:** Message tx を **必須で含めない**（ブロックサイズ爆発回避）

### D.2 Ledger storage cost

| データ | On-chain? |
|--------|-----------|
| ciphertext | **No** |
| file bytes | **No** |
| `(sender, receiver, msg_hash, fee_micro, ts)` | **Yes** — audit tree / explorer（既存 `GET /explorer/events` `routes.rs:242`） |

---

## Part E — Phase 0 実装計画

### E.1 新規ファイル（提案）

| Path | Role |
|------|------|
| `tet-core/src/messages.rs` | Envelope types, gossip encode/decode, fee helper |
| `tet-core/src/files.rs` | File metadata, local blob store trait |
| `tet-core/src/rest/handlers/messages.rs` | REST |
| `tet-core/src/rest/handlers/files.rs` | REST |
| `tet-network/ui/app/lib/e2ee.ts` | ChaCha + X25519（@noble/curves 等） |
| `tet-network/ui/app/lib/messages.ts` | API client + IndexedDB |
| `tet-network/ui/app/lib/files.ts` | Local file CID |
| `tet-network/ui/app/os/MessagesTab.tsx` | UI |
| `tet-network/ui/app/os/FilesTab.tsx` | UI |

### E.2 既存ファイル変更

| File | Change |
|------|--------|
| `p2p.rs` | `MESSAGES_TOPIC`, subscribe, inbound handler → `RestState` inbox buffer |
| `models.rs` | `NetworkEvent::DirectMessage` |
| `protocol.rs` | （任意）`MessageFee` tx |
| `lib.rs`, `main.rs` | `mod messages`, `mod files` |
| `rest/routes.rs` | 新 routes |
| `OsClient.tsx` | Tabs: `Messages`, `Files` |
| `useIncomingMessages.ts` | 送金 inbox と DM を分離（または併存） |

### E.3 工数見積もり（1 FTE、MVP）

| Component | Dev-days | Notes |
|-----------|----------|-------|
| `MESSAGES_TOPIC` + `NetworkEvent` + swarm handler | **4** | `p2p.rs`, `models.rs` |
| `messages` REST + fee audit + gossip publish | **5** | `gossip_tx` pattern `ledger.rs:711-719` |
| Ledger: message fee settle (reuse transfer fee) | **2** | |
| UI `e2ee.ts` + key directory (`/messages/keys`) | **6** | ML-DSA WASM 既存 UI パターンに合わせる |
| `MessagesTab` + 5-msg UX + compose | **5** | |
| Files: local CID + metadata REST + tab | **4** | 无 libp2p stream |
| Integration tests (2-node gossip + send) | **4** | |
| Docs + RUNNING_A_NODE 更新 | **2** | |
| **合計** | **32** | ≈ **6.5 週**（バッファ込み **7–8 週**） |

**削減版（6月末ターゲット用 “Messages Lite”）— 20 dev-days:**

| 削る | 残す |
|------|------|
| libp2p（初版は REST store + polling only） | E2EE + fee + 5-msg UI |
| Files tab | Send Coins + Messages |
| Pin / stake file | — |
| TxV1 new variant | audit + Transfer micro-fee |

### E.4 Phase 0 ship との関係

| シナリオ | 6月末 | 品質 |
|----------|-------|------|
| **A. Send Coins のみ** | ✅ | Sovereign OS 訴求 **弱い** |
| **B. Messages Lite（REST）** | ⚠️ タイト | 日常利用 **1日1回** の種はできる |
| **C. Messages + gossip + Files local** | ❌ → **8月初** | Steve のビジョンに **近い** |
| **D. Phase 0（6月末）+ Phase 0.1（8月）Suite** | ✅ 推奨 | 期日とビジョンの **両立** |

---

## Part F — 「5 messages limit」実装（Steve 哲学）

```text
Send (µTET) → gossip/REST → Receiver node buffer
                              ↓
                    UI decrypt → thread store
                              ↓
              Display last 5 / older hidden
                              ↓
     [Pin] (0.5) stake → persist meta + extended local retain
```

| 層 | 実装 |
|----|------|
| Receiver UI | `messages.ts`: `MAX_VISIBLE = 5` per `conversationId` |
| Local backup | Optional export encrypted blob（推論） |
| Ledger | `audit: message_delivered_v1` with `payload_sha256` only |
| Gossip TTL | Node: `VecDeque` capped per `(sender,receiver)` + env TTL 24h |
| Pin | Phase 0.5: `stake_micro` locks in `worker_stakes` or new `file_pins` tree |

---

## 主要設計判断（サマリー）

| 判断 | 推奨 |
|------|------|
| libp2p topology | **block plane に `/tet/v1/messages` を追加**；4th swarm しない |
| E2EE | **既存 `e2ee.rs` パターン**（X25519 + ML-KEM + ChaCha）；register で X25519 公開 |
| Hybrid sig | **新 preimage + Ed25519/ML-DSA**；wallet_id = identity |
| On-chain vs off-chain | **fee メタ on-chain、ciphertext off-chain** |
| Phase 0 Files | **ローカル mailbox のみ**；P2P file stream は 0.5 |
| 既存 Inbox | **送金通知は残す**；DM は Messages タブへ |

---

## Phase 0 ship 判定

### 「Messages + Files を Phase 0 に含める」は可能か？

**Yes — with conditions:**

1. **Messages:** Phase 0 必須。**Files:** Phase 0 は **metadata + ローカル** のみ（フル P2P は 0.5）。  
2. **6月末**に **フル**（gossip + Files stream + Pin）を約束するのは **No**。  
3. **Messages Lite**（E2EE + fee + 5-msg + REST、gossip は best-effort または 0.1 で可）なら **6月末可能**（+2–3 週、Send Coins と並行）。

### 期日影響 — 最小推奨

| 案 | 説明 |
|----|------|
| **推奨: Phase 0 + Phase 0.1 分離** | **2026-06-30:** Send Coins + sync + genesis（現 Sprint 4–5）+ **Messages Lite REST**（タブあり、P2P は “beta” ラベル）。**2026-08-01:** gossip Messages + Files P2P + Pin。 |
| 代替: 期日延長 | **単一 ship 2026-08-01** — フル Suite |
| 非推奨: 機能削りすぎ | Messages を送金 memo だけにする → **OS 差別化が弱い** |

### Sprint 4–5–6 分配案

| Sprint | 目標（〜週） | 成果物 |
|--------|-------------|--------|
| **Sprint 4** | Messages プロトコル + ledger fee audit + `POST /messages/send`（REST buffer） | 2-node 手動テスト |
| **Sprint 5** | UI `e2ee.ts` + `MessagesTab` + 5-msg + fee preview；Inbox 整理 | デモ可能 |
| **Sprint 6** | `MESSAGES_TOPIC` gossip；Files tab local；ハードニング | Phase 0.1 準備 |

（Sprint 3 = UI-P0 Send Coins 完了想定 — [`UI_STATUS_PHASE0.md`](./UI_STATUS_PHASE0.md)）

### 主要技術リスク

| Risk | Severity | Mitigation |
|------|----------|------------|
| **3 swarms 複雑度** | Med | Messages は block swarm のみ触る |
| **ブラウザは P2P しない** | High（UX） | 常に “your node URL” を前提；将来 WASM libp2p は Phase 2 |
| **ML-DSA UI 署名遅延** | Med | メッセージ fee は Ed25519 のみ Phase 0（推論）→ 0.1 で hybrid 必須化 |
| **メタデータ漏洩**（sender/receiver 平文 gossip） | Med | ドキュメントで明示；Phase 1 sealed sender |
| **Inbox 既存との混乱** | Low | タブ分離 + コピー |
| **6月末スコープクリープ** | High | Messages Lite 契約を PRD に固定 |

---

## Steve に判断を求める項目

1. **6月末:** Send Coins only vs **Messages Lite** vs **full suite → August**?  
2. **Message fee:** 100 µTET / msg と **10 free/day** でよいか？  
3. **Files Phase 0:** タブを出すか（local-only 明示）／Phase 0.1 まで隠すか？  
4. **On-chain:** `Transfer`+audit のみ vs 新 `TxV1::MessageSent`?  
5. **X25519 公開:** worker register キー流用 vs 専用 `/messages/keys`?  
6. **グローバル gossip topic** でメタ平文を許容するか？  
7. **PRD:** “Sovereign OS” = Send + Messages 必須、Files optional を文書化するか？

---

*Design doc complete. No code changes. No git commit.*
