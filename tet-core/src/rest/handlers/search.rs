//! TetSearch v1 routes (`crate::search`): a member lists a site (signed by the member and by the
//! site's key); members read the current listings with Shelter's signed reads and search in their
//! own browser. Off unless Shelter is on: publishing needs a human vouch.
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::rest::RestState;
use crate::search::{ListingRefusal, SearchListingV1};
use crate::tmail::shelter as sh;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn refuse(status: StatusCode, reason: impl Into<String>) -> Response {
    (status, Json(serde_json::json!({ "ok": false, "error": reason.into() }))).into_response()
}

pub async fn post_search_list(State(state): State<RestState>, Json(l): Json<SearchListingV1>) -> Response {
    let Some(cfg) = sh::config_from_env() else {
        let r = ListingRefusal::Off;
        return refuse(StatusCode::from_u16(r.status()).unwrap_or(StatusCode::BAD_REQUEST), r.reason());
    };
    let members = state.tmail.shelter_state(&cfg);
    let (search, sites) = (state.search.clone(), state.sites.clone());
    let out = tokio::task::spawn_blocking(move || search.list(&l, now_ms(), |w| members.is_member(w), |s| sites.head(s).is_some())).await;
    match out {
        Ok(Ok(())) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(Err(r)) => refuse(StatusCode::from_u16(r.status()).unwrap_or(StatusCode::BAD_REQUEST), r.reason()),
        Err(e) => refuse(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// The current listings, to a member's signed read only (`x-tet-shelter-auth`).
pub async fn get_search_listings(State(state): State<RestState>, headers: HeaderMap, uri: Uri) -> Response {
    let Some(cfg) = sh::config_from_env() else {
        return refuse(StatusCode::NOT_FOUND, ListingRefusal::Off.reason());
    };
    let Some(h) = headers.get("x-tet-shelter-auth").and_then(|v| v.to_str().ok()) else {
        return refuse(StatusCode::UNAUTHORIZED, "members only: sign the request");
    };
    let who = match sh::verify_read_auth(h, uri.path(), now_ms()) {
        Ok(w) => w,
        Err(e) => return refuse(StatusCode::UNAUTHORIZED, e.to_string()),
    };
    let members = state.tmail.shelter_state(&cfg);
    if !members.is_member(&who) {
        return refuse(StatusCode::FORBIDDEN, "members only: TetSearch results are for vouched members");
    }
    let listings = state.search.current(|w| members.is_member(w), |s| state.sites.head(s).is_some());
    let out: Vec<_> = listings
        .iter()
        .map(|l| {
            let head = state.sites.head(&l.site_wallet_id);
            serde_json::json!({
                "site_wallet_id": l.site_wallet_id,
                "member_wallet_id": l.member_wallet_id,
                "listed_at_ms": l.listed_at_ms,
                "version": head.as_ref().map(|h| h.len).unwrap_or(0),
                "updated_at_ms": head.as_ref().map(|h| h.updated_at_ms).unwrap_or(0),
            })
        })
        .collect();
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "listings": out }))).into_response()
}
