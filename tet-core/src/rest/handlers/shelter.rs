//! Shelter routes (tmail/shelter.rs; docs/plans/SHELTER.md).
//!
//! - `GET /shelter/status`: is Shelter open on this node? Nothing else.
//! - `POST /shelter/record`: a signed record (invite, vouch, withdraw, nickname, case, appeal).
//! - `POST /shelter/key`: a member's board key, sealed to them (served only in their `/shelter/me`).
//! - Signed reads (`x-tet-shelter-auth`, [`crate::tmail::shelter::verify_read_auth`]):
//!   - `GET /shelter/me`: the signer's own standing (any signer; a non-member learns only that);
//!   - members only: `GET /shelter/members`, `/shelter/log`, `/shelter/inbox`, `/shelter/anon/leaves`.
//!
//! Every route answers 404 while Shelter is off.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    Json,
};

use crate::rest::state::RestState;
use crate::tmail::shelter::{self as sh, ShelterConfig, ShelterError};

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn refuse(code: StatusCode, msg: impl Into<String>) -> Response {
    (code, Json(serde_json::json!({ "ok": false, "error": msg.into() }))).into_response()
}

fn off() -> Response {
    refuse(StatusCode::NOT_FOUND, "Shelter is not open on this node")
}

/// The signer of a read, checked for this route and time. Membership is checked separately.
fn reader(headers: &HeaderMap, uri: &Uri) -> Result<String, Response> {
    let Some(h) = headers.get("x-tet-shelter-auth").and_then(|v| v.to_str().ok()) else {
        return Err(refuse(StatusCode::UNAUTHORIZED, "members only: sign the request"));
    };
    sh::verify_read_auth(h, uri.path(), now_ms()).map_err(|e| refuse(StatusCode::UNAUTHORIZED, e.to_string()))
}

/// A current member's read, or the response that refuses it.
fn member(state: &RestState, headers: &HeaderMap, uri: &Uri) -> Result<(ShelterConfig, sh::ShelterState, String), Response> {
    let cfg = sh::config_from_env().ok_or_else(off)?;
    let who = reader(headers, uri)?;
    let st = state.tmail.shelter_state(&cfg);
    if !st.is_member(&who) {
        return Err(refuse(StatusCode::FORBIDDEN, "members only"));
    }
    Ok((cfg, st, who))
}

pub async fn get_shelter_status() -> Response {
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "on": sh::config_from_env().is_some() }))).into_response()
}

pub async fn post_shelter_record(State(state): State<RestState>, Json(r): Json<sh::ShelterRecordV1>) -> Response {
    let store = state.tmail.clone();
    match tokio::task::spawn_blocking(move || store.submit_shelter_record(&r, now_ms())).await {
        Ok(Ok(id)) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "id": id }))).into_response(),
        Ok(Err(ShelterError::Off)) => off(),
        Ok(Err(e @ (ShelterError::Signature | ShelterError::SignerMismatch))) => refuse(StatusCode::UNAUTHORIZED, e.to_string()),
        Ok(Err(e @ ShelterError::Refused(_))) => refuse(StatusCode::FORBIDDEN, e.to_string()),
        Ok(Err(e @ ShelterError::Duplicate)) => refuse(StatusCode::CONFLICT, e.to_string()),
        Ok(Err(e)) => refuse(StatusCode::BAD_REQUEST, e.to_string()),
        Err(j) => refuse(StatusCode::INTERNAL_SERVER_ERROR, format!("the check didn't finish: {j}")),
    }
}

/// `POST /shelter/key`: hand a member the board key, sealed to them (a named Tmail envelope).
pub async fn post_shelter_key(State(state): State<RestState>, Json(env): Json<crate::tmail::envelope::TmailEnvelopeV1>) -> Response {
    if sh::config_from_env().is_none() {
        return off();
    }
    if let Err(e) = crate::tmail::envelope::verify_tmail_envelope_v1(&env) {
        return refuse(StatusCode::UNAUTHORIZED, e.to_string());
    }
    match state.tmail.set_shelter_key(&env) {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(e) => refuse(StatusCode::FORBIDDEN, e),
    }
}

pub async fn get_shelter_me(State(state): State<RestState>, headers: HeaderMap, uri: Uri) -> Response {
    let Some(cfg) = sh::config_from_env() else { return off() };
    let who = match reader(&headers, &uri) {
        Ok(w) => w,
        Err(r) => return r,
    };
    let st = state.tmail.shelter_state(&cfg);
    let Some(m) = st.members.get(&who) else {
        return (StatusCode::OK, Json(serde_json::json!({ "ok": true, "member": false }))).into_response();
    };
    let now = now_ms();
    let anon_set = state.tmail.shelter_anon_set(&cfg, now);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "member": true,
            "moderator": who == cfg.moderator,
            "board": cfg.board,
            "nickname": m.nickname,
            "via": m.via,
            "joined_at_ms": m.joined_at_ms,
            "vouches_left": st.vouches_left(&cfg, &who),
            "suspended_until": st.suspended_until(&who).filter(|t| *t > now),
            "anon_set_size": anon_set.len(),
            "anon_min": sh::SHELTER_ANON_MIN,
            "in_anon_set": anon_set.iter().any(|(w, _)| *w == who),
            // The board key, sealed to this member (their page opens it; the node can't).
            "sealed_key": state.tmail.shelter_key_for(&who),
        })),
    )
        .into_response()
}

pub async fn get_shelter_members(State(state): State<RestState>, headers: HeaderMap, uri: Uri) -> Response {
    let (cfg, st, _) = match member(&state, &headers, &uri) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let members: Vec<_> = st
        .members
        .values()
        .map(|m| {
            serde_json::json!({
                "wallet": m.wallet,
                "nickname": m.nickname,
                "via": m.via,
                "joined_at_ms": m.joined_at_ms,
                "moderator": m.wallet == cfg.moderator,
            })
        })
        .collect();
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "moderator": cfg.moderator, "members": members }))).into_response()
}

pub async fn get_shelter_log(State(state): State<RestState>, headers: HeaderMap, uri: Uri) -> Response {
    let (_, st, _) = match member(&state, &headers, &uri) {
        Ok(x) => x,
        Err(r) => return r,
    };
    // Nicknames are members' own choice, not decisions: the log lists the rest.
    let lines: Vec<_> = state
        .tmail
        .shelter_records()
        .iter()
        .filter(|r| r.action != sh::ShelterAction::Nickname)
        .map(sh::log_line)
        .collect();
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "log": lines, "cases": st.cases }))).into_response()
}

#[derive(Debug, serde::Deserialize)]
pub struct ShelterInboxQuery {
    pub limit: Option<usize>,
}

pub async fn get_shelter_inbox(State(state): State<RestState>, headers: HeaderMap, uri: Uri, Query(q): Query<ShelterInboxQuery>) -> Response {
    let (cfg, _, _) = match member(&state, &headers, &uri) {
        Ok(x) => x,
        Err(r) => return r,
    };
    crate::rest::handlers::tmail::inbox_response(&state, &cfg.board, q.limit)
}

pub async fn get_shelter_anon_leaves(State(state): State<RestState>, headers: HeaderMap, uri: Uri) -> Response {
    let (cfg, _, _) = match member(&state, &headers, &uri) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let now = now_ms();
    let set = state.tmail.shelter_anon_set(&cfg, now);
    state.tmail.shelter_refresh_roots(&cfg, now);
    let leaves: Vec<String> = set.iter().map(|(_, c)| hex::encode(c)).collect();
    let root = (set.len() >= sh::SHELTER_ANON_MIN)
        .then(|| hex::encode(crate::tmail::anon::AnonMerkleTree::build(set.iter().map(|(_, c)| *c).collect()).root()));
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "leaves": leaves, "root": root, "min": sh::SHELTER_ANON_MIN }))).into_response()
}
