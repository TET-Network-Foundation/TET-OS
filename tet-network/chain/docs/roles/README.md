# Node Roles (tet-core-chain)

`tet-core-chain` の運用では、ETH/BTC クラスの「公開面」を最小化しつつ、
ネットワーク中の役割を分離するのが安全です。

このディレクトリには、以下のロールをテンプレとしてまとめています:

- `validator`
- `full`
- `archive`
- `sentry`
- `public-rpc`
- `indexer`

各ロールは主に次を記載しています:

- 必要ポート（P2P / RPC / Prometheus）
- 必須フラグ（最小セット）
- 永続データの方針（保存/バックアップ/スナップショット）
- 公開面の防御方針（特に `public-rpc`）

