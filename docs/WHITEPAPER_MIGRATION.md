# Whitepaper 正本統合 — 移行チェックリスト

**日付:** 2026-05-18  
**決定:** 正本 = **Genesis Draft v1.0 (2026-04-28)** → ルート [`WHITEPAPER.md`](../WHITEPAPER.md)  
**退避:** B 版経済モデル → [`archive/WHITEPAPER_v0_economic.md`](../archive/WHITEPAPER_v0_economic.md)  
**本文状態:** `WHITEPAPER.md` は **GENESIS_V1 全文投入待ち**（プレースホルダー）

**ラベル凡例**

| ラベル | 意味 |
|--------|------|
| **変更必要** | 正本統合後、文言・リンク・対外説明を A 版（Genesis）に合わせる |
| **残してOK** | 実装の内部用語・後方互換として当面維持（WP から切り離して注釈可能） |
| **要判断** | Steve + CTO で v1.1 / 実装どちらを正とするか決める |

---

## 1. 必須調査ファイル

### 1.1 `README.md`（ルート）

| 行・箇所 | 検出内容 | ラベル |
|----------|----------|--------|
| L37–38 | `WHITEPAPER.md` / `LITEPAPER.md` へのリンク（LITEPAPER は archive へ） | **変更必要** |
| その他 | stevemon/CHF/Imperial 直接言及なし | **残してOK** |

### 1.2 `tet-core/README.md`

| 行・箇所 | 検出内容 | ラベル |
|----------|----------|--------|
| L8 | Thermodynamic Execution Tree, CAAC, ZK-Court, PoC/PoR, **80/15/5** | **残してOK**（A 版と整合方向）— 80/15/5 は **要判断**（§11 と突合） |
| L132 | CAAC PoC/PoR | **残してOK** |
| L26–27 | 「height should converge」— 実装未達 | **要判断**（技術 README のみ） |
| stevemon/CHF/Imperial 明示なし | — | **残してOK** |

### 1.3 `tet-network/ui/README.md`

| 行・箇所 | 検出内容 | ラベル |
|----------|----------|--------|
| L43 | `TET_THERMO_STEVEMON_MICRO_SCALE` | **要判断**（env 名は実装；対外 doc では NCU/thermo に言い換え検討） |
| Phase 0 E2E 手順 | CAAC/ZK/mock — A 版方向 | **残してOK** |
| CHF peg / Imperial 明示なし | — | **残してOK** |

### 1.4 `tet-network/ui/app/lib/tetWhitepaper.ts`

| 内容 | 判定 |
|------|------|
| Thermodynamic Execution Tree, ML-DSA, ZK-Court, burn, chain-bound nonce | **A 版ショート要約に近い** |
| stevemon / CHF peg / Imperial Tax / Sharding Plugins **なし** | **残してOK**（UI 内要約として維持可） |
| タイトル `TET Network v0.1` | **変更必要** → Genesis v1.0 表記へ |

### 1.5 `tet-network/ui/app/whitepaper/page.tsx`

| 内容 | ラベル |
|------|--------|
| `tetWhitepaper.ts` の short text のみ表示 | **変更必要** — 全文は PDF または新 WP へのリンクに |
| 「Short version — TET Network v0.1」 | **変更必要** |

### 1.6 `docs/STATUS.md`

| 内容 | ラベル |
|------|--------|
| B 版 WHITEPAPER ベースの表（stevemon, CHF, Imperial Tax, Sharding Plugins） | **変更必要** — Genesis v1.0 ベースに書き直し |
| §C「WP に無い」CAAC/ZK 節 | **変更必要** — 正本切替後は § に移す |

### 1.7 `docs/SPRINT_PLAN.md`

| 内容 | ラベル |
|------|--------|
| 「WHITEPAPER v2 / Phase 0 in 2 weeks」注記 | **変更必要** — Genesis v1.0 正本に言及を統一 |
| stevemon/CHF 直接言及なし | **残してOK** |

### 1.8 `docs/CODEBASE_OVERVIEW.md`

| 内容 | ラベル |
|------|--------|
| B 版 / A 版齟齬の説明全体 | **変更必要** — 正本統合完了後に更新 |

---

## 2. grep 追加ヒット（ドキュメント・UI）

| ファイル | 検出キーワード | ラベル |
|----------|----------------|--------|
| `PUBLIC_API.md` | `community_stevemon_earned_micro` | **要判断**（API フィールド名；WP 非掲載なら **残してOK**） |
| `tet-network/ui/app/os/OsClient.tsx` | `amount_stevemon` | **要判断**（API 互換） |
| `tet-network/ui/app/page.tsx` | `amount_stevemon` | **要判断** |
| `tet-network/ui/app/lib/tx_store.ts` | `amount_stevemon` | **要判断** |
| `tet-network/ui/app/setup/page.tsx` | `stevemon` 表示 | **要判断** |
| `tet-agent-sdk/src/agent_client.ts` | `max_stevemon` | **要判断** |
| `.cursor_nexus_project.md` | micro-stevemon | **要判断** |
| `archive/WHITEPAPER_v0_economic.md` | 全文 B 版 | **残してOK**（archive） |
| `archive/LITEPAPER_v0.md` | CHF peg | **残してOK**（archive） |

---

## 3. grep 追加ヒット（Rust 実装 — コード変更は別タスク）

> 本タスクでは **.rs は変更しない**。WP 移行の「要判断」記録のみ。

| ファイル | 検出キーワード | ラベル |
|----------|----------------|--------|
| `tet-core/src/ledger.rs` | `stevemon`, `CHF`, `chf_top_up`, `META_*STEVEMON*` | **要判断** — 内部単位名として維持 vs リネーム |
| `tet-core/src/oracle.rs` | CHF oracle stub | **要判断** |
| `tet-core/src/vision/thermo_genesis.rs` | `WHITEPAPER_STEVEMON_PER_TET`, §4.2 コメント | **要判断** — コメントを Genesis § に合わせる |
| `tet-core/src/tests.rs` | `stevemon`, CHF AML test | **残してOK**（テスト） |
| `tet-core/src/worker_engine.rs` | `stevemon_micro` reward | **要判断** |
| `tet-core/src/rest/handlers/enterprise.rs` | 80/15/5 settlement | **要判断** — WP §11 / §13 と統一 |
| `tet_ledger.json` | `fiat_mint_stevemon_micro` 等 | **残してOK**（ローカルデータ） |

**Imperial Tax / Sharding Plugins** — `.rs` 内文字列 grep **0 件**（B 版 WP 専用語はコードに未埋め込み）。

---

## 4. Step 4 — PDF と UI 要約

### 4.1 `tet-network/ui/public/tet-network-whitepaper.pdf`

| 項目 | 値 |
|------|-----|
| 存在 | **あり** |
| パス | `tet-network/ui/public/tet-network-whitepaper.pdf` |
| サイズ | **1,888,349 bytes**（約 1.8 MB） |
| 最終更新 | **2026-04-28 20:39:26**（ローカル `stat`） |
| テキスト抽出 | **未実施**（`pdftotext` 未インストール） |

| 判定 | 説明 |
|------|------|
| **版の推定** | 更新日が Genesis v1.0 **2026-04-28** と同日 → **おそらく A 版（Genesis）** |
| **REGEN_NEEDED** | **条件付き YES** — ルート `WHITEPAPER.md` に全文投入後、PDF と § 構造・図表を **diff 検証**し、差分があれば再生成 |
| フラグ | `REGEN_NEEDED: CONDITIONAL`（全文 MD 投入まで保留） |

### 4.2 `tet-network/ui/app/lib/tetWhitepaper.ts`

| 項目 | 判定 |
|------|------|
| 版 | **A 版に近いショート要約**（TET, ML-DSA, ZK-Court, thermodynamic, 非 stevemon/CHF） |
| stevemon / CHF peg / Imperial Tax / Sharding | **なし** |
| 推奨 | 正本 MD 確定後、§1 要約に差し替え or PDF へのリンクに一本化 |
| REGEN_NEEDED | **NO**（短文のため手編集で可）。PDF 再生成とは独立 |

### 4.3 `tet-network/ui/app/whitepaper/page.tsx`

- 上記 TS のラッパーのみ → **変更必要**（表記 v0.1 → Genesis v1.0、全文リンク）

---

## 5. 推奨次アクション（コミット前）

1. Steve が **`GENESIS_V1.md` 全文**を共有 → `WHITEPAPER.md` プレースホルダー置換  
2. `README.md` の Further reading を更新（`LITEPAPER` → archive または削除）  
3. `docs/STATUS.md` / `CODEBASE_OVERVIEW.md` を Genesis 正本前提に再生成  
4. PDF と新 `WHITEPAPER.md` の目視 diff → `REGEN_NEEDED` 確定  
5. **別 PR** で UI / API の stevemon 表示名を「TET / micro-TET」等に整理（要判断）

---

## 6. 変更ファイル一覧（本タスク）

| 操作 | パス |
|------|------|
| 新規 | `archive/WHITEPAPER_v0_economic.md` |
| 新規 | `archive/LITEPAPER_v0.md` |
| 新規 | `WHITEPAPER.md`（プレースホルダー） |
| 新規 | `docs/WHITEPAPER_MIGRATION.md` |
| 新規 | `docs/WHITEPAPER_V1.1_GAPS.md` |
| 削除 | `WHITEPAPER.md`（B 版・archive へ移動済み） |
| 削除 | `LITEPAPER.md`（archive へ移動済み） |

**git:** `git add` は実施していない（指示どおり unstaged）。
