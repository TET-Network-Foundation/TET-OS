# Public RPC Surface (tet-rpc-profile=public)

このドキュメントは、`tet-core-chain` ノードを「公開 RPC（public testnet）」として運用するための最小要件をまとめます。

## 前提（必須）

1. 公開 RPC は **必ず reverse proxy / WAF / rate-limit** の背後で運用してください。
   - 典型例: nginx + `limit_req`（IP 単位）+ リクエストボディサイズ制限
2. `--tet-rpc-profile public` を指定してください。
   - これにより substrate の RPC は `rpc_methods = safe` に強制されます。
   - さらに RPC rate limit（未指定時）も有効化されます。

## fail-closed（重要）

`--tet-rpc-profile public` 実行時は fail-closed を入れています。

- `--dev` は拒否されます（`--tet-rpc-profile public` では起動できません）
- `--alice/--bob/...` のような dev key ショートカットも拒否されます

本番では keystore / env / KMS 等で明示的に本番キーをロードしてください。

## 期待する拒否挙動（例）

公開 RPC では potentially-unsafe な RPC（例: `author_submitExtrinsic`）は外部から呼べない想定です。

次のスモークチェックを利用してください（ノード起動後）:

```bash
RPC_HTTP_URL=http://127.0.0.1:9933 ./scripts/check_public_rpc_allowlist.sh
```

## Observability

RPC 呼び出しの監視は Prometheus メトリクスを利用します。
ダッシュボードとアラートは `observability/` 配下を参照してください。

