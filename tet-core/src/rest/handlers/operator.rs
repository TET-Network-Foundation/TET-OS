//! Operator routes for the hide list (`operator_hide.rs`). Not on the public allow-list; each one
//! also requires a loopback connection and the admin key, so the operator runs them inside the
//! node's container (`deploy/operator-hide.sh`). Every hide/unhide is written to the operator log.

use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use std::net::SocketAddr;

use crate::operator_hide::HideKind;
use crate::rest::RestState;

#[derive(Debug, Deserialize)]
pub struct HideReq {
    pub kind: HideKind,
    pub id: String,
    #[serde(default)]
    pub reason: String,
}

#[allow(clippy::result_large_err)]
fn operator_only(peer: Option<ConnectInfo<SocketAddr>>, headers: &HeaderMap) -> Result<(), Response> {
    if !peer.map(|c| c.0.ip().is_loopback()).unwrap_or(false) {
        return Err((StatusCode::FORBIDDEN, "operator routes answer only on loopback").into_response());
    }
    crate::rest::helpers::require_admin_bearer(headers)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `POST /operator/hide` `{kind: wallet|msg|file, id, reason}`.
pub async fn post_operator_hide(
    State(state): State<RestState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    // Authenticate before parsing: an unauthenticated caller learns nothing about the body format.
    if let Err(r) = operator_only(peer, &headers) {
        return r;
    }
    let req: HideReq = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("body: {e}")).into_response(),
    };
    if req.reason.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "a reason is required (it goes in the operator log)").into_response();
    }
    match state.operator_hide.hide(req.kind, &req.id, &req.reason, now_ms()) {
        Ok(row) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "hidden": row }))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// `POST /operator/unhide` `{kind, id, reason}`.
pub async fn post_operator_unhide(
    State(state): State<RestState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    // Authenticate before parsing: an unauthenticated caller learns nothing about the body format.
    if let Err(r) = operator_only(peer, &headers) {
        return r;
    }
    let req: HideReq = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("body: {e}")).into_response(),
    };
    match state.operator_hide.unhide(req.kind, &req.id, &req.reason, now_ms()) {
        Ok(was) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "was_hidden": was }))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// `GET /operator/hidden` — the current list.
pub async fn get_operator_hidden(
    State(state): State<RestState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
) -> Response {
    if let Err(r) = operator_only(peer, &headers) {
        return r;
    }
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "hidden": state.operator_hide.list() }))).into_response()
}
