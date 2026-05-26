use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};

use crate::rest::RestState;

pub async fn get_core_root() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "service": "tet-core",
            "version": env!("CARGO_PKG_VERSION"),
            "ok": true,
            "endpoints": "/health, /ledger/state, /v1/..."
        })),
    )
}

pub async fn post_logout(State(state): State<RestState>) -> impl IntoResponse {
    state.ledger.flush_and_snapshot_best_effort();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true
        })),
    )
}

pub async fn get_status(State(state): State<RestState>) -> impl IntoResponse {
    #[derive(serde::Serialize)]
    struct R {
        founder_wallet_id: String,
        pqc_active: bool,
        attestation_required: bool,
        guardian_count: u64,
        fee_total_tet: f64,
        cost_guard_limit_usd: f64,
        cost_guard_used_usd: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        dex_usdc_settlement_solana_address: Option<String>,
    }

    let founder = state.ledger.founder_wallet_public().unwrap_or_default();
    let guardian_count = state.ledger.founding_guardian_count().unwrap_or(0);
    let fee_total = state.ledger.fee_total_micro().unwrap_or(0);
    let fee_total_tet = fee_total as f64 / crate::ledger::STEVEMON as f64;
    let limit = std::env::var("TET_COST_GUARD_USD_LIMIT")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(50.0);
    let _month = {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let month_index = secs / (86_400 * 30);
        format!("m{month_index}")
    };
    // Cost guard used USD is not currently persisted on-ledger in this snapshot.
    let used = 0.0;
    let dex_addr = std::env::var("TET_DEX_SOLANA_USDC_ADDRESS")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (
        StatusCode::OK,
        Json(R {
            founder_wallet_id: founder,
            pqc_active: crate::quantum_shield::pqc_active(),
            attestation_required: crate::attestation::attestation_required(),
            guardian_count,
            fee_total_tet,
            cost_guard_limit_usd: limit,
            cost_guard_used_usd: used,
            dex_usdc_settlement_solana_address: dex_addr,
        }),
    )
}
