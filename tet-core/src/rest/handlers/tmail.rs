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
use crate::tmail::anon::{TmailAnonRegistrationError, TmailAnonRegistrationV1};
use crate::tmail::burn::{BurnRevokeOutcome, TmailBurnRevokeError, TmailBurnRevokeV1};
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

/// `GET /tmail/inbox/:wallet_id?limit=N` — non-expired messages addressed to `wallet_id`, newest
/// first, at most [`crate::tmail::store::RETAIN_PER_CONVERSATION`] per conversation (S7-0).
/// Phase 0: unauthenticated read (public), server filters to mail addressed to this wallet.
///
/// **Scheduled messages are listed without their ciphertext.** A row whose `flags.time_lock` is set
/// and whose `release_at_ms` has not arrived comes back with `locked: true`, a `locked_note`, and
/// **no `e2ee` field** — the receiver sees that something is scheduled, and for when, without the
/// payload (spec §A.2.4).
///
/// This is **scheduled release, not an enforced lock**: the ciphertext reached every relaying node
/// at send time, and withholding is this node's policy about its own API, nothing more. See
/// [`crate::tmail::timelock`] and the `locked_note` text. Real enforcement (stake forfeit, VDF) is
/// Phase 0.1.
///
/// One clock reading is taken for the whole response so rows cannot disagree about "now".
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
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let messages: Vec<crate::tmail::timelock::TmailInboxRowV1> = state
        .tmail
        .get_inbox(&w, limit)
        .iter()
        .map(|env| {
            let verdict = if env.flags.anonymous {
                state.tmail.get_anon_verdict(env.msg_id.trim())
            } else {
                None
            };
            crate::tmail::timelock::to_inbox_row_with_verdict(env, now_ms, verdict)
        })
        .collect();
    let locked_count = messages.iter().filter(|m| m.locked).count();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "wallet_id": w,
            "count": messages.len(),
            "locked_count": locked_count,
            "messages": messages,
        })),
    )
        .into_response()
}

/// `GET /tmail/keys/:wallet_id` — the wallet's registered X25519 + Kyber-768 (Round-3) public
/// keys, or `404`. Field names say `mlkem`; the algorithm is not ML-KEM (WP §17.17).
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

/// HTTP status for a revoke rejection: signature/identity is `401`, policy is `403`, shape is
/// `400`. A node-local storage failure is the caller's problem only insofar as nothing happened.
fn burn_revoke_error_status(e: &TmailBurnRevokeError) -> StatusCode {
    match e {
        TmailBurnRevokeError::Signature(_) | TmailBurnRevokeError::SignerMismatch => {
            StatusCode::UNAUTHORIZED
        }
        TmailBurnRevokeError::NotAParty | TmailBurnRevokeError::NotBurnable => {
            StatusCode::FORBIDDEN
        }
        TmailBurnRevokeError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    }
}

/// `POST /tmail/read-receipt` — a party signals it has read a burn-after-read message, which
/// destroys the ciphertext here and announces the revoke to peers (spec §A.3.2 Layer 1).
///
/// Body is a hybrid-signed [`TmailBurnRevokeV1`]. Authorization is
/// [`crate::tmail::burn::apply_burn_revoke`] — the same function the gossip receive path uses, so
/// REST and gossip cannot diverge. In practice the caller is the **receiver** (that is what a read
/// receipt is); the sender is also a party and may revoke what they sent.
///
/// **Burn locally first, announce second.** A node only gossips a revoke it was able to authorize
/// against its own copy of the message, so an unauthorizable revoke is never amplified onward. If
/// this node does not hold the message there is nothing to authorize against and the call is a
/// `404` — the caller should retry against a node that has it.
///
/// Best-effort by construction (§A.3.2 Layer 3, locked decision #2): cooperating nodes purge,
/// non-cooperating peers may retain encrypted copies. Nothing here makes that claim stronger.
pub async fn post_tmail_read_receipt(
    State(state): State<RestState>,
    Json(rev): Json<TmailBurnRevokeV1>,
) -> Response {
    let outcome = match crate::tmail::burn::apply_burn_revoke(&state.tmail, &rev) {
        Ok(o) => o,
        Err(e) => return (burn_revoke_error_status(&e), format!("{e}")).into_response(),
    };
    match outcome {
        BurnRevokeOutcome::Burned { msg_id } => {
            crate::metrics::inc_tmail_burned();
            state.broadcast_tmail_burn_revoke(&rev).await;
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({
                    "ok": true,
                    "msg_id": msg_id,
                    "status": "burned",
                    "note": "Best-effort burn. Cooperating nodes will purge after read receipt. \
                             Non-cooperating peers may retain encrypted copies.",
                })),
            )
                .into_response()
        }
        // Idempotent: gossip delivers duplicates, and re-announcing would keep the revoke
        // circulating forever.
        BurnRevokeOutcome::AlreadyBurned { msg_id } => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": true,
                "msg_id": msg_id,
                "status": "already_burned",
            })),
        )
            .into_response(),
        BurnRevokeOutcome::UnknownMessage { msg_id } => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "ok": false,
                "msg_id": msg_id,
                "status": "unknown_message",
                "error": "this node does not hold that message, so it cannot authorize the revoke",
            })),
        )
            .into_response(),
    }
}

fn anon_registration_error_status(msg: &str) -> StatusCode {
    if msg.contains("signature") || msg.contains("signer") {
        StatusCode::UNAUTHORIZED
    } else {
        StatusCode::BAD_REQUEST
    }
}

/// `POST /tmail/anon/register` — publish this wallet's anonymity-set commitment (spec §A.4.3).
///
/// Goes through [`crate::rest::RestState::submit_local_anon_registration`], the single entry point:
/// it admits **and** announces over both gossip and the direct `/tet/v1/anon-register` request.
/// There is no admit-only path for a local registration, because a member who is in their own
/// node's set and nobody else's has proofs that fail everywhere with nothing pointing at delivery.
///
/// Registration is free and therefore **not sybil resistance** — see the disclosure text. The
/// node's registry is capped; at the cap new wallets are refused rather than existing members
/// evicted, since evicting silently shrinks other people's anonymity set.
pub async fn post_tmail_anon_register(
    State(state): State<RestState>,
    Json(reg): Json<TmailAnonRegistrationV1>,
) -> Response {
    match state.submit_local_anon_registration(&reg).await {
        Ok(outcome) => {
            let tag = format!("{outcome:?}").to_lowercase();
            let full = matches!(outcome, crate::tmail::store::AnonRegisterOutcome::Full(_));
            let too_soon = matches!(
                outcome,
                crate::tmail::store::AnonRegisterOutcome::UpdateTooSoon { .. }
            );
            let status = if full {
                StatusCode::INSUFFICIENT_STORAGE
            } else if too_soon {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::ACCEPTED
            };
            (
                status,
                Json(serde_json::json!({
                    "ok": !full && !too_soon,
                    "wallet_id": reg.wallet_id.trim().to_ascii_lowercase(),
                    "outcome": tag,
                    "members": state.tmail.anon_member_count(),
                    "effective_from_epoch": state.tmail.anon_current_epoch() + 1,
                    "note": crate::tmail::anon::TMAIL_ANON_DISCLOSURE,
                })),
            )
                .into_response()
        }
        Err(e) => (anon_registration_error_status(&e), e).into_response(),
    }
}

/// `GET /tmail/anon/root` — this node's current registry root, member count and window.
///
/// The root is **node-local**: it covers the registrations this node has seen, which is also the
/// anonymity set a proof verified here is anonymous within.
pub async fn get_tmail_anon_root(State(state): State<RestState>) -> Response {
    let tree = state.tmail.anon_tree();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "merkle_root": hex::encode(tree.root()),
            "members": state.tmail.anon_member_count(),
            "depth": nexus_protocol::TET_ANON_MERKLE_DEPTH,
            "epoch": state.tmail.anon_current_epoch(),
            "roots_cached": state.tmail.anon_root_cache_len(),
            "root_window_ms": state.tmail.anon_effective_window_ms(),
            "note": crate::tmail::anon::TMAIL_ANON_DISCLOSURE,
        })),
    )
        .into_response()
}

/// `GET /tmail/anon/path/:wallet_id` — the authentication path a member needs to build a proof.
///
/// Serving this reveals only which leaf belongs to a **public** registration, which is already
/// public. The secret never appears, and the path is useless without it.
pub async fn get_tmail_anon_path(
    State(state): State<RestState>,
    Path(wallet_id): Path<String>,
) -> Response {
    let w = wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&w) {
        return (StatusCode::BAD_REQUEST, "wallet must be 64 hex chars").into_response();
    }
    let Some(index) = state.tmail.anon_leaf_index(&w) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "ok": false,
                "wallet_id": w,
                "error": "not registered on this node -- registration may still be propagating",
            })),
        )
            .into_response();
    };
    let tree = state.tmail.anon_tree();
    let Some(siblings) = tree.path(index) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "path unavailable").into_response();
    };
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "wallet_id": w,
            "index": index,
            "merkle_root": hex::encode(tree.root()),
            "siblings": siblings.iter().map(hex::encode).collect::<Vec<_>>(),
            "depth": nexus_protocol::TET_ANON_MERKLE_DEPTH,
        })),
    )
        .into_response()
}

const _: fn() = || {
    let _ = anon_registration_error_status;
    let _: Option<TmailAnonRegistrationError> = None;
};

/// `POST /tmail/anon/send` — start an anonymous send. **Returns `202` with a job id.**
///
/// Proving takes ~33 s, so this cannot be a request that returns the result. The client polls
/// `GET /tmail/anon/job/:job_id`.
///
/// Two states are reported separately on purpose:
///
/// - `registration_propagating` — the sender's own registration is not in this node's tree yet.
///   It resolves at the **next epoch boundary**, which is deterministic, so the response carries
///   `eligible_at_ms` and the UI shows a countdown rather than a spinner. Send is refused until
///   then, rather than queued, because a queued send would silently produce a proof against a root
///   the sender is not in.
/// - `proving` — the proof is being built.
///
/// Collapsing them would tell the user "wait" without saying whether *they* are not ready or the
/// *machine* is, which are different problems with different fixes.
pub async fn post_tmail_anon_send(
    State(state): State<RestState>,
    Json(req): Json<serde_json::Value>,
) -> Response {
    let wallet = req
        .get("wallet_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !is_wallet_id_64hex(&wallet) {
        return (StatusCode::BAD_REQUEST, "wallet_id must be 64 hex chars").into_response();
    }
    if state.tmail.get_stored_anon(&wallet).is_none() {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "ok": false,
                "state": "not_registered",
                "error": "this wallet has no anonymity-set registration on this node",
                "note": crate::tmail::anon::TMAIL_ANON_DISCLOSURE,
            })),
        )
            .into_response();
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if let Some(eligible_at_ms) =
        crate::tmail::anon::registration_eligible_at_ms(&state.tmail, &wallet)
    {
        return (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({
                "ok": true,
                "state": "registration_propagating",
                "eligible_at_ms": eligible_at_ms,
                "seconds_remaining": eligible_at_ms.saturating_sub(now) / 1000,
                "note": "Your registration enters this node's anonymity set at the next epoch \
                         boundary. Sending is disabled until then.",
            })),
        )
            .into_response();
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    let job = crate::tmail::anon::AnonSendJob {
        job_id: job_id.clone(),
        state: crate::tmail::anon::AnonSendJobState::Proving { started_at_ms: now },
        created_at_ms: now,
    };
    if let Ok(mut jobs) = state.anon_jobs.lock() {
        jobs.insert(job_id.clone(), job.clone());
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "ok": true,
            "job_id": job_id,
            "state": "proving",
            "poll": format!("/tmail/anon/job/{job_id}"),
            "expected_duration_ms": 33_000,
            "note": crate::tmail::anon::TMAIL_ANON_DISCLOSURE,
        })),
    )
        .into_response()
}

/// `GET /tmail/anon/job/:job_id` — poll an anonymous send.
pub async fn get_tmail_anon_job(
    State(state): State<RestState>,
    Path(job_id): Path<String>,
) -> Response {
    let job = state
        .anon_jobs
        .lock()
        .ok()
        .and_then(|j| j.get(job_id.trim()).cloned());
    match job {
        Some(j) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "job": j }))).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "ok": false,
                "job_id": job_id,
                "error": "unknown job -- jobs are node-local and do not survive a restart",
            })),
        )
            .into_response(),
    }
}
