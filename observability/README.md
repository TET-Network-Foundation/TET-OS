# TET Observability (Sprint 0)

このディレクトリは、TET のノード/RPC/worker の主要メトリクスに基づく
Grafana ダッシュボード雛形と Prometheus アラートルールを保管します。

## 使っている Prometheus メトリクス

### Node (substrate 標準)
- `substrate_sub_libp2p_peers_count` (libp2p 接続ピア数)
- `substrate_sub_libp2p_peerset_num_banned_peers` (ban された peer 数)
- `substrate_sub_libp2p_requests_out_failure_total` (libp2p outbound request failures)
- `substrate_rpc_calls_started` (RPC 呼び出し数カウンタ)
- `substrate_rpc_calls_finished` (RPC 完了数カウンタ。`is_error=true` でエラー)

### Worker (tet-worker の /metrics)
- `tet_worker_tx_success_total`
- `tet_worker_tx_fail_total`
- `tet_worker_ollama_fail_total`
- `tet_worker_proof_submission_latency_ms`
- `tet_worker_last_loop_duration_ms`

## P0-3: Peer scoring / eviction（最小）

`tet-core-chain` ノードは、Substrate の `PeerStore`（reputation/ban）を利用します。
最小 DoS 対策として、通知ストリームの churn（短時間に open/close を連発）を検知した peer は
reputation ペナルティにより ban されます（`tet_peer_watchdog`）。

## 配置例

- Prometheus の `alerting` に `observability/prometheus/alerts/tet.yml` を読み込む
- Grafana は `observability/grafana/dashboards/tet-node-rpc-worker.json` をインポートする

Grafana の JSON 内では Prometheus datasource を `${DS_PROMETHEUS}` として参照しています。
あなたの Grafana 環境の datasource uid に合わせて差し替えてください。

