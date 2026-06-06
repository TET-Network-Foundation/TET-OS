use crate::rest::RestState;
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde_json::json;

/// `GET /health/swarm`
///
/// Liveness of the block-plane libp2p swarm event loop. External monitoring can poll this to detect a
/// stalled loop (the 2026-06 wedge failure mode) before it cascades into an OS-level TCP lockup.
///
/// Returns `200` while healthy (loop ticked within the stall threshold, or still booting) and `503`
/// when the loop is stalled, so a plain HTTP healthcheck flags the node without parsing the body.
pub async fn get_health_swarm(State(state): State<RestState>) -> impl IntoResponse {
    let stall_threshold_ms = crate::swarm_health::stall_threshold_ms_from_env();
    let now_ms = crate::swarm_health::now_ms();

    let Some(health) = state.swarm_health.as_ref() else {
        // Block swarm disabled for this node — report explicitly rather than faking health.
        return (
            StatusCode::OK,
            Json(json!({
                "enabled": false,
                "healthy": true,
                "detail": "block-plane swarm disabled (P2P off)",
            })),
        );
    };

    let started = health.started();
    let since_last_tick_ms = health.since_last_tick_ms(now_ms);
    let healthy = health.is_healthy(now_ms, stall_threshold_ms);

    let body = json!({
        "enabled": true,
        "healthy": healthy,
        "started": started,
        "last_event_loop_tick_ago_ms": since_last_tick_ms,
        "last_tick_ms": health.last_tick_ms(),
        "tick_count": health.tick_count(),
        "peer_count": health.connected_peers(),
        "listening_count": health.listeners(),
        "stall_threshold_ms": stall_threshold_ms,
    });

    let status = if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(body))
}
