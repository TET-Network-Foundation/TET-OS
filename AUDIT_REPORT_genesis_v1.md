## TET Core - Holistic Code & Security Audit (genesis_v1)

作成日: 2026-04-20

### 対象
- `tet-core/src/ledger.rs`
- `tet-core/src/rest.rs`
- `tet-core/src/network.rs`
- `tet-core/src/worker_ai.rs`
- `worker_dashboard.html`
- `tet-core/src/ui.html`
- `tet-core/src/ui.js`
- `tet-core/src/main.rs`

---

## 1. Crash / Safety（ノードクラッシュ防止）

### unwrap() 排除（本番コード）
- 監査対象の本番コード内で `unwrap()` によるpanic経路を潰した。
- 代表例: `tet-core/src/worker_ai.rs` の `lock().unwrap()` を廃止し、毒化Mutexでもpanicせずエラーを返す実装へ変更。

---

## 2. P2P Gossip Security（軍用レベルの検証）

### ML-DSA-44 必須化（PQC有効時）
- `tet-core/src/network.rs` にて、PQC有効時は **ML-DSA-44(pubkey+sig)が欠落しているだけで Reject**。
- 検証失敗は **disconnect + BAN（PeerId単位、継続時間付き）**。

### スパム耐性
- 不正署名が秒間閾値を超えるとBANするレート制御を実装/維持。

---

## 3. Data-at-Rest Encryption（sled / AES-256-GCM）

### 既存暗号化の動作確認
- `ledger.rs` の `encrypt_value` / `decrypt_value` により、walletメタデータがAES-256-GCMで暗号化される設計を確認。

### “常時ON”条件の強化
- `TET_DB_KEY_B64` / `TET_DB_KEY` が設定されているのに `TET_DB_ENCRYPT` が未設定の場合、
  **デフォルトを `strict` 扱い**に変更（鍵があるのに平文運用にならない）。

### テスト担保
- strict暗号化時にsensitive metaが平文で保存されないことをテストで担保（ciphertext != plaintext）。

---

## 4. UI-Driven Download Consent（Visual Consent）

### 追加API
- `GET /worker/model/status`
  - AI Brain(GGUF 5GB+) の `ready/downloading/progress/error` を返す。
- `POST /worker/model/download`
  - バックグラウンドでダウンロード開始（single-flight）。

### Worker Dashboard（Start Earning 強制ロック）
- `worker_dashboard.html` の Worker タブに以下を実装:
  - 「DOWNLOAD AI BRAIN (5GB+)」ボタン
  - 進捗バー（UIはポーリングでリアルタイム更新）
  - AI BrainがReadyになるまで `Start earning` を disabled（視覚的にも not-allowed）

---

## 5. Hardware / Mobile Warning（UI）
- Worker タブに要件警告ボックスを追加:
  - Desktop(Mac/PC) only
  - Minimum 8GB RAM
  - Mobile(iOS/Android) unsupported
  - 発熱リスク注意

---

## 6. Vision Tab Rewrite（Founder Tone）
- `worker_dashboard.html` の Vision セクション文面を全面改稿:
  - 攻撃的/反骨/DePIN志向
  - 「No OpenAI」「No censorship」「PQC」「Llama 3」明記

---

## 7. Cache Busting（genesis_v1）
- `tet-core/src/ui.html`: `/assets/wallet_client_bundled.js?v=genesis_v1` と `/assets/ui.js?v=genesis_v1`
- `tet-core/src/ui.js`: 動的ロードも `?v=genesis_v1`
- `worker_dashboard.html`: 動的ロードも `?v=genesis_v1`

---

## 8. Verification
- `cargo test` 全通過（18 tests OK）
- lintエラーなし

