//! `POST /sigs/publish` and `GET /sigs/search` (`crate::sigs`).

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine as _;
use serde::Deserialize;

use crate::rest::RestState;
use crate::sigs::{SigQuery, SigsError};

#[derive(Deserialize)]
pub struct PublishBody {
    /// The record's exact bytes, base64 (so its proof code is the same everywhere).
    pub record_b64: String,
    /// The signer's consent to publish exactly this record (`sigs::CONSENT_PAYLOAD_TYPE`), base64.
    pub consent_b64: String,
}

/// `POST /sigs/publish` — publish a hash-only signature record its signer chose to make public.
/// Its signatures are checked first; a signer the operator hid can't publish.
pub async fn post_sigs_publish(State(state): State<RestState>, Json(b): Json<PublishBody>) -> Response {
    let bad = |s: StatusCode, e: String| (s, Json(serde_json::json!({ "ok": false, "error": e }))).into_response();
    let (Ok(bytes), Ok(consent)) = (
        base64::engine::general_purpose::STANDARD.decode(b.record_b64.trim()),
        base64::engine::general_purpose::STANDARD.decode(b.consent_b64.trim()),
    ) else {
        return bad(StatusCode::BAD_REQUEST, "record_b64 and consent_b64 must be base64".into());
    };
    match crate::sigs::verify_record(&bytes) {
        Ok((_, signer)) if state.operator_hide.is_wallet_hidden(&signer) => return crate::rest::helpers::hidden_by_operator(),
        Ok(_) => {}
        Err(e) => return bad(StatusCode::BAD_REQUEST, e.to_string()),
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    match state.sigs.publish(&bytes, &consent, now) {
        Ok((r, stored)) => (StatusCode::ACCEPTED, Json(serde_json::json!({ "ok": true, "stored": stored, "record_sha256": r.record_sha256, "published_at_ms": r.published_at_ms }))).into_response(),
        Err(e @ (SigsError::SignerFull | SigsError::StoreFull)) => bad(StatusCode::INSUFFICIENT_STORAGE, e.to_string()),
        Err(e) => bad(StatusCode::BAD_REQUEST, e.to_string()),
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    /// A proof code's 40 bits: 10 hex digits.
    pub code: Option<String>,
    pub file: Option<String>,
    pub signer: Option<String>,
    pub from: Option<u64>,
    pub to: Option<u64>,
}

fn hex_of(s: &Option<String>, len: usize) -> Result<Option<String>, ()> {
    match s.as_deref().map(|v| v.trim().to_ascii_lowercase()) {
        None => Ok(None),
        Some(v) if v.len() == len && v.chars().all(|c| c.is_ascii_hexdigit()) => Ok(Some(v)),
        Some(_) => Err(()),
    }
}

/// `GET /sigs/search?code=|file=|signer=&from=&to=` — published records, newest first (≤ 50).
/// Readers re-check every record's signatures in their own tab. Records by a signer the operator
/// hid aren't served.
pub async fn get_sigs_search(State(state): State<RestState>, Query(q): Query<SearchQuery>) -> Response {
    let (Ok(code_prefix), Ok(file_sha256), Ok(signer)) = (hex_of(&q.code, 10), hex_of(&q.file, 64), hex_of(&q.signer, 64)) else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "ok": false, "error": "code is 10 hex digits; file and signer are 64" }))).into_response();
    };
    let found: Vec<_> = state
        .sigs
        .search(&SigQuery { code_prefix, file_sha256, signer, from_ms: q.from, to_ms: q.to })
        .into_iter()
        .filter(|r| !state.operator_hide.is_wallet_hidden(&r.signer_ed25519))
        .collect();
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "records": found }))).into_response()
}
