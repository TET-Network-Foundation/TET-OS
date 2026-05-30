use crate::{
    attestation::{AttestationReport, verify_attestation_report},
    ledger::{MAX_SUPPLY_MICRO, STEVEMON, WORKER_MIN_STAKE_MICRO},
    protocol::{SignedTxEnvelopeV1, TxV1},
    rest::{
        RestState, WalletRecoverReq, WalletSlashReq, WalletStakeSignedReq,
        helpers::{require_admin_bearer, std_lock, verify_envelope_v1},
    },
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
    response::IntoResponse,
};

use axum::http::StatusCode;

async fn post_signer_link_impl(
    State(state): State<RestState>,
    _headers: HeaderMap,
    Json(env): Json<SignedTxEnvelopeV1>,
) -> impl IntoResponse {
    if env.v != 1 {
        return (StatusCode::BAD_REQUEST, "unsupported envelope version").into_response();
    }

    // Always require an attestation proof for signer↔core linking so the UI badge is meaningful.
    if env.attestation.platform.is_empty() || env.attestation.report_b64.is_empty() {
        return (StatusCode::UNAUTHORIZED, "attestation required").into_response();
    }

    let tx_bytes = match verify_envelope_v1(&env) {
        Ok(b) => b,
        Err(e) => return (StatusCode::UNAUTHORIZED, e).into_response(),
    };
    let report = AttestationReport {
        v: 1,
        platform: env.attestation.platform.clone(),
        report_b64: env.attestation.report_b64.clone(),
    };
    if let Err(e) = verify_attestation_report(&report, &tx_bytes) {
        return (StatusCode::UNAUTHORIZED, e.to_string()).into_response();
    }

    let TxV1::SignerLink { wallet_id } = env.tx else {
        return (StatusCode::BAD_REQUEST, "expected signer_link tx").into_response();
    };
    if wallet_id.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "wallet_id required").into_response();
    }
    // Stateless server: do not store per-client wallet state server-side.
    // The signature + attestation on this request is the only proof required.
    let _ = state; // keep signature stable; state may be used later for audit logging.
    (StatusCode::OK, "ok").into_response()
}

/// `GET /wallet/mnemonic/new` — **deprecated**. Mnemonics must never be minted or transmitted from the core (non-custodial).
async fn get_wallet_mnemonic_new_impl() -> impl IntoResponse {
    (
        StatusCode::GONE,
        Json(serde_json::json!({
            "error": "DEPRECATED",
            "message": "Server-assisted mnemonic generation is disabled. Load /assets/wallet_client_bundled.js and generate client-side.",
        })),
    )
        .into_response()
}

async fn post_wallet_new_impl() -> impl IntoResponse {
    (
        StatusCode::GONE,
        Json(serde_json::json!({
            "error": "DEPRECATED",
            "message": "Server-assisted wallet creation is disabled. Use client-side BIP39 + POST /wallet/active_public with wallet_id only.",
        })),
    )
        .into_response()
}

async fn post_wallet_recover_impl(Json(_req): Json<WalletRecoverReq>) -> impl IntoResponse {
    (
        StatusCode::GONE,
        Json(serde_json::json!({
            "error": "DEPRECATED",
            "message": "Server-side mnemonic recovery is disabled. Use client-side BIP39 + POST /wallet/active_public with wallet_id only.",
        })),
    )
        .into_response()
}

async fn post_wallet_set_active_impl(
    State(_state): State<RestState>,
    Json(_req): Json<WalletRecoverReq>,
) -> impl IntoResponse {
    (
        StatusCode::GONE,
        Json(serde_json::json!({
            "error": "DEPRECATED",
            "message": "Server-side mnemonic activation is disabled. Use POST /wallet/active_public with wallet_id only.",
        })),
    )
        .into_response()
}

fn verify_ed25519_hex_on_message(from_hex: &str, msg: &[u8], sig_hex: &str) -> Result<(), String> {
    crate::wallet::verify_ed25519_hex_message(from_hex, msg, sig_hex)
}

fn stake_hybrid_auth_message_bytes(
    wallet_id_hex: &str,
    amount_micro: u64,
    nonce: u64,
    mldsa_pubkey_b64: &str,
) -> Vec<u8> {
    let w = wallet_id_hex.trim().to_ascii_lowercase();
    let p = mldsa_pubkey_b64.trim();
    format!("tet stake hybrid v1|{w}|{amount_micro}|{nonce}|{p}").into_bytes()
}

async fn get_wallet_transfer_nonce_impl(
    State(state): State<RestState>,
    Path(wallet): Path<String>,
) -> impl IntoResponse {
    let w = wallet.trim().to_ascii_lowercase();
    if w.is_empty() {
        return (StatusCode::BAD_REQUEST, "wallet required").into_response();
    }
    if w.len() > 128 {
        return (StatusCode::BAD_REQUEST, "wallet id too long").into_response();
    }
    match state.ledger.wallet_last_transfer_nonce(&w) {
        Ok(last) => {
            let next = last.saturating_add(1);
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "wallet_id": w,
                    "last_nonce": last,
                    "next_nonce": next,
                })),
            )
                .into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

/// `POST /wallet/transfer` — hybrid-signed transfer routed through consensus.
///
/// Accepts a [`SignedTxEnvelopeV1`] carrying a [`TxV1::Transfer`]. The flow is:
/// verify hybrid signature (Ed25519 + ML-DSA via `verify_envelope_v1`) → balance precheck →
/// enqueue into the local mempool → gossip to peers (`txs` topic) so any producer can mine it.
/// **No `x-api-key`.**
///
/// Unlike the legacy direct-mutation path, this never touches `balances` directly: the envelope
/// is re-verified and applied deterministically by every node at block-apply time
/// (`tx_hash_for_env` → `verify_envelope_v1`), so a Send Coins call can no longer create a
/// local-only fork. Returns `202 Accepted` with the pending `tx_hash`.
async fn post_wallet_transfer_impl(
    State(state): State<RestState>,
    Json(env): Json<SignedTxEnvelopeV1>,
) -> axum::response::Response {
    if env.v != 1 {
        return (StatusCode::BAD_REQUEST, "unsupported envelope version").into_response();
    }
    // Hybrid signature verification (Ed25519 + ML-DSA) — shared, unchanged logic.
    if let Err(e) = verify_envelope_v1(&env) {
        return (StatusCode::UNAUTHORIZED, e).into_response();
    }
    let TxV1::Transfer {
        from_wallet,
        to_wallet,
        amount_micro,
        fee_bps: _,
    } = env.tx.clone()
    else {
        return (StatusCode::BAD_REQUEST, "expected transfer tx").into_response();
    };
    let from = from_wallet.trim().to_ascii_lowercase();
    let to = to_wallet.trim().to_ascii_lowercase();
    if from.len() != 64 || !from.chars().all(|c| c.is_ascii_hexdigit()) {
        return (
            StatusCode::BAD_REQUEST,
            "from_wallet must be 64 hex characters (Ed25519 verifying key)",
        )
            .into_response();
    }
    if to.is_empty() {
        return (StatusCode::BAD_REQUEST, "to_wallet required").into_response();
    }
    if from == to {
        return (StatusCode::BAD_REQUEST, "cannot transfer to self").into_response();
    }
    if amount_micro == 0 || amount_micro > MAX_SUPPLY_MICRO {
        return (StatusCode::BAD_REQUEST, "invalid amount").into_response();
    }
    // Precheck only (no DB mutation): reject obvious insufficient-funds before queueing.
    let spendable = state.ledger.spendable_balance_micro_now(&from).unwrap_or(0);
    if spendable < amount_micro {
        return (StatusCode::BAD_REQUEST, "Insufficient funds").into_response();
    }
    let tx_hash = match crate::consensus::tx_hash_for_env(&env) {
        Ok(h) => h,
        Err(e) => return (StatusCode::UNAUTHORIZED, e).into_response(),
    };
    if let Err(e) = state.enqueue_mempool_tx(env.clone()).await {
        return (StatusCode::TOO_MANY_REQUESTS, e.to_string()).into_response();
    }
    // Propagate the pending tx so any producer node can include it in a block.
    state.broadcast_mempool_tx(&env).await;

    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "ok": true,
            "status": "pending",
            "tx_hash": tx_hash,
            "from_wallet_id": from,
            "to_wallet_id": to,
            "amount_micro": amount_micro,
        })),
    )
        .into_response()
}

async fn post_wallet_stake_impl(
    State(state): State<RestState>,
    Json(req): Json<WalletStakeSignedReq>,
) -> axum::response::Response {
    const MAX_B64_FIELD: usize = 32_768;
    if req.wallet_id.len() > 256
        || req.ed25519_sig_hex.len() > 200
        || req.mldsa_pubkey_b64.len() > MAX_B64_FIELD
        || req.mldsa_sig_b64.len() > MAX_B64_FIELD
    {
        return (StatusCode::BAD_REQUEST, "fields exceed maximum length").into_response();
    }
    let w = req.wallet_id.trim().to_ascii_lowercase();
    if w.len() != 64 || !w.chars().all(|c| c.is_ascii_hexdigit()) {
        return (StatusCode::BAD_REQUEST, "wallet_id must be 64 hex chars").into_response();
    }
    if req.nonce == 0 {
        return (StatusCode::BAD_REQUEST, "nonce must be > 0").into_response();
    }
    if !req.amount_tet.is_finite() || req.amount_tet <= 0.0 {
        return (StatusCode::BAD_REQUEST, "invalid amount").into_response();
    }
    let amount_micro = (req.amount_tet * STEVEMON as f64).round().max(0.0) as u64;
    if amount_micro == 0 || amount_micro > MAX_SUPPLY_MICRO {
        return (StatusCode::BAD_REQUEST, "invalid amount").into_response();
    }
    let msg = stake_hybrid_auth_message_bytes(&w, amount_micro, req.nonce, &req.mldsa_pubkey_b64);
    if let Err(e) = verify_ed25519_hex_on_message(&w, &msg, &req.ed25519_sig_hex) {
        return (StatusCode::UNAUTHORIZED, e).into_response();
    }
    if let Err(e) = crate::wallet::verify_mldsa_b64(&req.mldsa_pubkey_b64, &req.mldsa_sig_b64, &msg)
    {
        return (StatusCode::UNAUTHORIZED, e.to_string()).into_response();
    }
    match state.ledger.stake_micro(&w, amount_micro, Some(req.nonce)) {
        Ok((staked_micro, new_stake_micro)) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "wallet_id": w,
                "staked_micro": staked_micro,
                "new_stake_micro": new_stake_micro,
            })),
        )
            .into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn post_wallet_slash_impl(
    State(state): State<RestState>,
    headers: HeaderMap,
    Json(req): Json<WalletSlashReq>,
) -> axum::response::Response {
    if let Err(r) = require_admin_bearer(&headers) {
        return r;
    }
    let w = req.wallet_id.trim().to_ascii_lowercase();
    if w.is_empty() || w.len() > 256 {
        return (StatusCode::BAD_REQUEST, "wallet_id required").into_response();
    }
    if !req.amount_tet.is_finite() || req.amount_tet <= 0.0 {
        return (StatusCode::BAD_REQUEST, "invalid amount").into_response();
    }
    let amount_micro = (req.amount_tet * STEVEMON as f64).round().max(0.0) as u64;
    if amount_micro == 0 {
        return (StatusCode::BAD_REQUEST, "invalid amount").into_response();
    }
    match state.ledger.slash_stake_micro(&w, amount_micro) {
        Ok((slashed_micro, new_stake_micro)) => {
            if new_stake_micro < WORKER_MIN_STAKE_MICRO && !state.ledger.is_active_worker(&w) {
                let mut reg = std_lock(&state.workers);
                reg.remove_wallet(&w);
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "wallet_id": w,
                    "slashed_micro": slashed_micro,
                    "new_stake_micro": new_stake_micro,
                    "min_required_stake_micro": WORKER_MIN_STAKE_MICRO,
                })),
            )
                .into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

pub async fn get_wallet_mnemonic_new() -> impl IntoResponse {
    get_wallet_mnemonic_new_impl().await
}

pub async fn post_wallet_new() -> impl IntoResponse {
    post_wallet_new_impl().await
}

pub async fn post_wallet_recover(Json(req): Json<WalletRecoverReq>) -> impl IntoResponse {
    post_wallet_recover_impl(Json(req)).await
}

pub async fn post_wallet_set_active(
    State(state): State<RestState>,
    Json(req): Json<WalletRecoverReq>,
) -> impl IntoResponse {
    post_wallet_set_active_impl(State(state), Json(req)).await
}

pub async fn get_wallet_transfer_nonce(
    State(state): State<RestState>,
    Path(wallet): Path<String>,
) -> impl IntoResponse {
    get_wallet_transfer_nonce_impl(State(state), Path(wallet)).await
}

pub async fn post_wallet_transfer(
    State(state): State<RestState>,
    Json(env): Json<SignedTxEnvelopeV1>,
) -> axum::response::Response {
    post_wallet_transfer_impl(State(state), Json(env)).await
}

pub async fn post_wallet_stake(
    State(state): State<RestState>,
    Json(req): Json<WalletStakeSignedReq>,
) -> axum::response::Response {
    post_wallet_stake_impl(State(state), Json(req)).await
}

pub async fn post_wallet_slash(
    State(state): State<RestState>,
    headers: HeaderMap,
    Json(req): Json<WalletSlashReq>,
) -> axum::response::Response {
    post_wallet_slash_impl(State(state), headers, Json(req)).await
}

pub async fn post_signer_link(
    State(state): State<RestState>,
    headers: HeaderMap,
    Json(env): Json<SignedTxEnvelopeV1>,
) -> impl IntoResponse {
    post_signer_link_impl(State(state), headers, Json(env)).await
}
