# Role: public-rpc

## 目的

外部ユーザが利用する RPC の境界ノード。
「public 面」を最小化し、危険な RPC を絶対に公開しない。

## 必要ポート（例）

- RPC (JSON-RPC / WebSocket): `9933/9944` のいずれか、または reverse proxy 側の公開ポート
- Prometheus: scraping 用に `9616` 等（採用する node 設定に準ずる）

## 必須フラグ（最小）

- `--chain tet_testnet`
- `--tet-rpc-profile public`
- Keystore / dev keys は載せない（load しない方針）

## 公開面の防御方針（必須）

- reverse proxy / WAF を必ず前段に置く（レート制限・ボディ制限・IP 制御）
- `--tet-rpc-profile public` により substrate RPC は `rpc_methods = safe` 相当に制限される
- `tet_healthSummary` のようなカスタム RPC は dashboards 用であり、公開面での挙動を doc に固定する
- P0-3 の最小 DoS 対策として、通知ストリームの churn（短時間の open/close 連発）が観測された peer は
  reputation ペナルティで ban される（`tet_peer_watchdog`）。

## DoD（最低限）

- `author_submitExtrinsic` のような potentially-unsafe RPC が外部から `Method not found` 相当で拒否されること
- rate limit が有効であること

