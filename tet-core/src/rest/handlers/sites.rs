//! `POST /sites/edit` and `GET /sites/:site_id` (`crate::sites`).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::rest::RestState;
use crate::sites::{verify_site_edit_v1, SiteEditError, SiteEditV1};

fn is_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// `POST /sites/edit` — append one signed edit to a site. Refused unless the site's own key signed
/// it and it extends the chain exactly; a site the operator hid takes nothing.
pub async fn post_site_edit(State(state): State<RestState>, Json(e): Json<SiteEditV1>) -> Response {
    if let Err(err) = verify_site_edit_v1(&e) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "ok": false, "error": err.to_string() }))).into_response();
    }
    if state.operator_hide.is_wallet_hidden(&e.site_wallet_id) {
        return crate::rest::helpers::hidden_by_operator();
    }
    match state.sites.append(&e) {
        Ok(head) => (StatusCode::ACCEPTED, Json(serde_json::json!({ "ok": true, "head": head }))).into_response(),
        Err(err @ SiteEditError::NotNext { .. }) => (StatusCode::CONFLICT, Json(serde_json::json!({ "ok": false, "error": err.to_string() }))).into_response(),
        Err(err @ SiteEditError::Stale) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "ok": false, "error": err.to_string() }))).into_response(),
        Err(err @ (SiteEditError::SiteFull | SiteEditError::StoreFull)) => (StatusCode::INSUFFICIENT_STORAGE, Json(serde_json::json!({ "ok": false, "error": err.to_string() }))).into_response(),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "ok": false, "error": err.to_string() }))).into_response(),
    }
}

/// `GET /sites/:site_id` — a site's whole signed edit chain, in order, and its head. Readers check
/// every signature and link themselves; a site the operator hid isn't served (410).
pub async fn get_site(State(state): State<RestState>, Path(site): Path<String>) -> Response {
    let site = site.trim().to_ascii_lowercase();
    if !is_64hex(&site) {
        return (StatusCode::BAD_REQUEST, "site must be 64 hex chars").into_response();
    }
    if state.operator_hide.is_wallet_hidden(&site) {
        return crate::rest::helpers::hidden_by_operator();
    }
    match state.sites.head(&site) {
        Some(head) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "head": head, "edits": state.sites.edits(&site) }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "ok": false, "error": "no such site on this node" }))).into_response(),
    }
}
