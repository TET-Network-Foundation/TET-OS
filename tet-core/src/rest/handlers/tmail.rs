//! Tmail REST endpoints (spec §A.1 / Appendix A REST catalog).
//!
//! All authentication is hybrid-signature based (Ed25519 + ML-DSA) — no admin token. Tmail is
//! off-ledger: these handlers only touch the node-local [`crate::tmail::store::TmailStore`] buffer
//! and the `/tet/v1/tmail` gossip plane (via [`crate::rest::RestState::broadcast_tmail`]).

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::rest::RestState;
use crate::tmail::envelope::{TmailEnvelopeError, TmailEnvelopeV1, verify_tmail_envelope_v1};
use crate::tmail::keys::{TmailKeyError, TmailKeyRegistrationV1, verify_tmail_key_registration_v1};

const INBOX_DEFAULT_LIMIT: usize = 50;
const INBOX_MAX_LIMIT: usize = 200;

fn is_wallet_id_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Map an envelope verification error to the right HTTP status: signature/identity failures are
/// `401`, everything else (malformed/unsupported) is `400`.
fn envelope_error_status(e: &TmailEnvelopeError) -> StatusCode {
    match e {
        TmailEnvelopeError::Signature(_) | TmailEnvelopeError::SignerMismatch => {
            StatusCode::UNAUTHORIZED
        }
        _ => StatusCode::BAD_REQUEST,
    }
}

fn key_error_status(e: &TmailKeyError) -> StatusCode {
    match e {
        TmailKeyError::Signature(_) | TmailKeyError::SignerMismatch => StatusCode::UNAUTHORIZED,
        _ => StatusCode::BAD_REQUEST,
    }
}

/// `POST /tmail/send` — verify a Basic E2EE envelope, buffer it locally, and gossip it to peers.
///
/// Path: verify hybrid sig (`verify_tmail_envelope_v1`) → `store_tmail` (local buffer, dedup by
/// `msg_id`) → `broadcast_tmail` (gossip). Returns `202 Accepted { msg_id, status: "accepted" }`.
pub async fn post_tmail_send(
    State(state): State<RestState>,
    Json(env): Json<TmailEnvelopeV1>,
) -> Response {
    if let Err(e) = verify_tmail_envelope_v1(&env) {
        return (envelope_error_status(&e), format!("{e}")).into_response();
    }
    match state.tmail.store_tmail(&env) {
        Ok(true) => {}
        Ok(false) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "ok": false,
                    "msg_id": env.msg_id,
                    "status": "duplicate",
                })),
            )
                .into_response();
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response();
        }
    }
    // Propagate to peers so an offline receiver's node can buffer it too.
    state.broadcast_tmail(&env).await;
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "ok": true,
            "msg_id": env.msg_id,
            "status": "accepted",
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct InboxQuery {
    pub limit: Option<usize>,
}

/// `GET /tmail/inbox/:wallet_id?limit=N` — non-expired envelopes addressed to `wallet_id`, newest
/// first. Phase 0: unauthenticated read (public), server filters to mail addressed to this wallet.
pub async fn get_tmail_inbox(
    State(state): State<RestState>,
    Path(wallet_id): Path<String>,
    Query(q): Query<InboxQuery>,
) -> Response {
    let w = wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&w) {
        return (StatusCode::BAD_REQUEST, "wallet must be 64 hex chars").into_response();
    }
    let limit = q
        .limit
        .unwrap_or(INBOX_DEFAULT_LIMIT)
        .clamp(1, INBOX_MAX_LIMIT);
    let messages = state.tmail.get_inbox(&w, limit);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "wallet_id": w,
            "count": messages.len(),
            "messages": messages,
        })),
    )
        .into_response()
}

/// `GET /tmail/keys/:wallet_id` — the wallet's registered X25519 + ML-KEM public keys, or `404`.
pub async fn get_tmail_keys(
    State(state): State<RestState>,
    Path(wallet_id): Path<String>,
) -> Response {
    let w = wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&w) {
        return (StatusCode::BAD_REQUEST, "wallet must be 64 hex chars").into_response();
    }
    match state.tmail.get_key(&w) {
        Some(registration) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": true,
                "registration": registration,
            })),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "ok": false,
                "wallet_id": w,
                "error": "no tmail keys registered for this wallet",
            })),
        )
            .into_response(),
    }
}

fn register_key_response(state: &RestState, reg: TmailKeyRegistrationV1) -> Response {
    if let Err(e) = verify_tmail_key_registration_v1(&reg) {
        return (key_error_status(&e), format!("{e}")).into_response();
    }
    match state.tmail.register_key(&reg) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": true,
                "wallet_id": reg.wallet_id.trim().to_ascii_lowercase(),
                "registered_at_ms": reg.registered_at_ms,
            })),
        )
            .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
    }
}

/// `PUT` / `POST /tmail/keys/:wallet_id` — register/refresh keys; the path wallet must match the
/// body. Role-decoupled per spec §A.1.4 (no `/worker/register` dependency, no admin token).
pub async fn put_tmail_keys(
    State(state): State<RestState>,
    Path(wallet_id): Path<String>,
    Json(reg): Json<TmailKeyRegistrationV1>,
) -> Response {
    let path_w = wallet_id.trim().to_ascii_lowercase();
    let body_w = reg.wallet_id.trim().to_ascii_lowercase();
    if path_w != body_w {
        return (
            StatusCode::BAD_REQUEST,
            "path wallet_id must equal body wallet_id",
        )
            .into_response();
    }
    register_key_response(&state, reg)
}
