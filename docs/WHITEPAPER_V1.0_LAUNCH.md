# Whitepaper Genesis v1.0 — 正本反映 完了レポート

**日付:** 2026-05-18  
**正本:** [`WHITEPAPER.md`](../WHITEPAPER.md), [`GENESIS_V1.md`](../GENESIS_V1.md)  
**タスク:** 仕上げ + 旧経済モデル参照のドキュメント/UI クリーンアップ（`.rs` 変更なし）

---

## 1. § 番号差し替え (`docs/WHITEPAPER_V1.1_GAPS.md`)

| 状態 | **完了** |
|------|----------|
| 内容 | 6 Gap すべて [`WHITEPAPER.md`](../WHITEPAPER.md) からの直接引用 + 行番号（L76–88, L135–147, L173–199, L219–221 等） |
| 注記 | Gap 3 は §5.1 Sovereign Runtime（optimistic window）+ §14.1 を併記 — 旧「§5.1 = Sharding Plugins」前提を削除 |

---

## 2. `README.md`（ルート）

| 項目 | 結果 |
|------|------|
| 変更 | **あり** |
| LITEPAPER | `./LITEPAPER.md` → [`archive/LITEPAPER_v0.md`](../archive/LITEPAPER_v0.md)（deprecated 注記付き） |
| WHITEPAPER | リンク維持 + Genesis v1.0 説明 |
| 追加リンク | `GENESIS_V1.md`, `docs/WHITEPAPER_V1.1_GAPS.md` |
| stevemon / CHF / Imperial / Sharding | **grep 0 件**（変更不要） |

**diff サマリー:** Further reading セクションのみ（4 行 → 6 行、正本・archive・gaps 明示）。

---

## 3. `tet-core/README.md`

| 項目 | 結果 |
|------|------|
| 変更 | **あり（最小）** |
| 置換 | Tokenomics 節の **Stevemon** → **micro-TET**（コード定数 `STEVEMON` は実名として残す） |
| CHF / Imperial | **grep 0 件**（他箇所は既に CAAC / ZK-Court / 80-15-5 で Genesis 整合） |

**diff サマリー:** 1 段落（Units 説明 + §5.2 との関係 1 文）。

---

## 4. `docs/*` 確認

| ファイル | 結果 | 対応 |
|----------|------|------|
| `docs/STATUS.md` | **変更必要**だった | Genesis v1.0 ベースに **全面書き換え** |
| `docs/CODEBASE_OVERVIEW.md` | **変更必要**だった | §0 正本表、§3 マッピング表、§9 査読メモ、読了ログを更新 |
| `docs/SPRINT_PLAN.md` | **最小修正** | Imperial tax → AI settlement / §14.3 slash 表現 |
| `docs/WHITEPAPER_MIGRATION.md` | **未更新** | 移行完了済み；必要なら「完了」ステータス追記のみ（本タスクではスコープ外） |

---

## 5. `tet-network/ui/app/lib/tetWhitepaper.ts`

| 項目 | 内容 |
|------|------|
| 変更 | **あり** |
| バージョン | `Genesis Draft v1.0` |
| 日付 | `2026-04-28` |
| 本文 | §1–§17 章立てサマリー + CAAC, PoC, PoR, Sovereign Runtime, ZK-Court, ML-DSA, Sovereign Peg, Cockroach Doctrine |
| Future Work | §12.5–12.7 を明示ラベル |
| 旧 v0.1 Thermodynamic Execution Tree 単独要約 | 置換 |

---

## 6. `tet-network/ui/app/whitepaper/page.tsx`

| 項目 | 結果 |
|------|------|
| 変更 | **あり（最小）** |
| 内容 | サブタイトルを `TET_WHITEPAPER_VERSION` + `TET_WHITEPAPER_DATE` から表示；Future Work 注記 1 行 |
| レンダリング | `whitespace-pre-wrap` のまま — 問題なし |

---

## 7. PDF 再生成

| フラグ | **延期（Phase 0 ship 直前）** |
|--------|-------------------------------|
| 理由 | 正本 MD が 2026-05-18 に確定；既存 PDF は 2026-04-28 更新（~1.8 MB）で **おそらく同一版**だがバイト diff 未実施。ship 直前に `pdftotext` / 目次 diff で `REGEN_NEEDED` を確定する方が安全 |
| パス | `tet-network/ui/public/tet-network-whitepaper.pdf` |

---

## 8. 残課題（v1.1 / 実装）

| 項目 | 参照 |
|------|------|
| η(Wᵢ)、challenge window、watcher 報酬 | [`WHITEPAPER_V1.1_GAPS.md`](./WHITEPAPER_V1.1_GAPS.md) Gap 1, 3 |
| §14.2 probabilistic fingerprinting 具体化 | Gap 2 |
| §12.7 state channel モデル | Gap 4（Future Work のままか要 Steve 判断） |
| §11 vs 80/15/5 vs R(T) 一本化 | Gap 6 |
| API/UI の `stevemon` フィールド名 | コード変更 PR — **要 Steve 判断**（`WHITEPAPER_MIGRATION.md`） |
| Legacy `chf_top_up_mint` | **要 Steve 判断** — 廃止宣言 vs 別製品 |
| マルチノード同期 | [`SYNC_ISSUE.md`](./SYNC_ISSUE.md), [`SPRINT_PLAN.md`](./SPRINT_PLAN.md) |

---

## 9. 変更ファイル一覧（本タスク・ドキュメント + UI のみ）

| 操作 | パス |
|------|------|
| 更新 | `docs/WHITEPAPER_V1.1_GAPS.md` |
| 更新 | `README.md` |
| 更新 | `tet-core/README.md` |
| 更新 | `docs/STATUS.md` |
| 更新 | `docs/CODEBASE_OVERVIEW.md` |
| 更新 | `docs/SPRINT_PLAN.md` |
| 更新 | `tet-network/ui/app/lib/tetWhitepaper.ts` |
| 更新 | `tet-network/ui/app/whitepaper/page.tsx` |
| 新規 | `docs/WHITEPAPER_V1.0_LAUNCH.md` |

**未変更（正本として既に確定）:** `WHITEPAPER.md`, `GENESIS_V1.md`, `archive/*`  
**未変更（制約）:** すべての `.rs`  
**git:** `git add` 未実施 · commit 未実施

---

## 10. 検証コマンド

```bash
cd /Users/sengokukazuma/Nexus_Network
rg -i 'stevemon|CHF peg|Imperial Tax|Sharding Plugins' README.md tet-core/README.md docs/STATUS.md docs/SPRINT_PLAN.md docs/CODEBASE_OVERVIEW.md
git diff --stat docs/ README.md tet-core/README.md tet-network/ui/app/lib/tetWhitepaper.ts tet-network/ui/app/whitepaper/page.tsx
```
