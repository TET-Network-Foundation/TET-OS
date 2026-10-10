//! Testnet practice grants (crate::grants): `GET /grants/status`, `POST /grants/welcome`.
//! Both answer 404 while the grant payer is off.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::grants::{GrantClaimV1, GrantRefusal};
use crate::rest::helpers::verify_envelope_v1;
use crate::rest::state::RestState;

fn refuse(r: GrantRefusal) -> Response {
    (StatusCode::from_u16(r.status()).unwrap_or(StatusCode::BAD_REQUEST), Json(serde_json::json!({ "ok": false, "reason": r.reason() }))).into_response()
}

/// How many welcome grants are granted, of how many, and how much each is (practice unit).
pub async fn get_grants_status(State(state): State<RestState>) -> Response {
    let Some(p) = state.grant_payer.clone() else { return refuse(GrantRefusal::Off) };
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "welcome": {
                "granted": p.granted(),
                "cap": crate::grants::WELCOME_CAP,
                "amount_micro": crate::grants::WELCOME_AMOUNT_MICRO,
                "receiver": crate::grants::welcome_receiver_hex(),
                "grant_wallet": p.wallet_id(),
                "one_per": "registration in the open anonymity set (weak: registering is free)",
            },
        })),
    )
        .into_response()
}

pub async fn post_grants_welcome(State(state): State<RestState>, Json(c): Json<GrantClaimV1>) -> Response {
    let Some(p) = state.grant_payer.clone() else { return refuse(GrantRefusal::Off) };
    let _one_at_a_time = p.decide_lock.lock().await;
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let spendable = state.ledger.spendable_balance_micro_now(p.wallet_id()).unwrap_or(0);
    let store = state.tmail.clone();
    let (p2, c2) = (p.clone(), c.clone());
    let decided = tokio::task::spawn_blocking(move || p2.decide(&c2, &store, now_ms, spendable)).await;
    let (env, commit) = match decided {
        Ok(Ok(x)) => x,
        Ok(Err(r)) => return refuse(r),
        Err(e) => return refuse(GrantRefusal::Submit(e.to_string())),
    };
    if let Err(e) = verify_envelope_v1(&env) {
        return refuse(GrantRefusal::Submit(e));
    }
    let tx_hash = crate::consensus::tx_hash_for_env(&env).ok();
    if let Err(e) = state.submit_local_tx(env).await {
        return refuse(GrantRefusal::Submit(e.to_string()));
    }
    p.commit(commit);
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "ok": true, "granted_micro": crate::grants::WELCOME_AMOUNT_MICRO, "to": c.payout_wallet.trim().to_ascii_lowercase(), "tx_hash": tx_hash })),
    )
        .into_response()
}
