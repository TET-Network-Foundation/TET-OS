# Role: validator

## 目的

コンセンサス権限を持つノード（プロポーズ/投票）。

## 必要ポート（例）

- P2P: `30333`
- RPC (JSON-RPC): `9933/9944`（このテンプレでは通常同一ポート設定でも可）
- Prometheus: node の `--prometheus-external`/設定に準ずる（利用するなら）

## 必須フラグ（最小）

- `--chain tet_testnet`（将来 mainnet も同様）
- `--validator`（もしくはオーソリティになる構成）
- Keystore（本番キー）を必ずロード（`--alice/--bob/...` のショートカットは本番で禁止）

## 永続データ/バックアップ

- RocksDB（または採用DB）のバックアップ（スナップショット+復元手順）
- keystore のバックアップと復元手順

