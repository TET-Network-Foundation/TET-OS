# Key Management Runbook (tet-core-chain)

## Scope

`tet-core-chain` と `tet-worker` のキー運用（本番運用に相当）についての最小 Runbook。

## 本番キーの必須方針（fail-closed）

- `--tet-rpc-profile public` では `--dev` と `--alice/--bob/...` の dev key ショートカットを拒否します。
- `tet` / `tet_testnet` チェーン指定時は、`--dev` や dev key ショートカットを拒否します。
- 本番キーは必ず `--keystore` / keystore 環境（またはそれに準ずる明示的ロード）で投入してください。

## キー更新（ローテーション）手順（最小）

1. 新しい keystore（または KMS/署名基盤）を準備
2. ノードを安全に停止（可能なら最小ダウンタイム手順で）
3. keystore を差し替え
4. ノード起動後、以下を確認
   - RPC が期待通りに動作（`--tet-rpc-profile public` の場合は allowlist 前提）
   - Prometheus の主要 SLO（peer、rpc、worker、tx fail rate）が正常範囲
5. ステータス監視を維持しつつ、段階的に切り替え完了

## キー漏洩インシデント（最小）

1. まず外部公開面を止める（public-rpc を切り離す/リバプロで遮断）
2. 漏洩が疑われるキーに紐づくノード/ワーカーを停止
3. 影響範囲の推定
   - いつから漏れていた可能性があるか
   - どのエンドポイントを通じて利用されたか
4. キーを失効/ローテーション
5. チェーン側の整合性確認（必要なら復旧手順へ）
6. 再発防止（運用ログ、監査、権限分離、KMS導入など）

## 参照

- `docs/rpc-public.md`（公開RPCの前提と fail-closed）
- `observability/`（ダッシュボード/アラート）

