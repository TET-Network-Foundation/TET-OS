//! Tmail REST endpoints (spec §A.1 / Appendix A REST catalog).
//!
//! All authentication is hybrid-signature based (Ed25519 + ML-DSA) — no admin token. Tmail is
//! off-ledger: these handlers only touch the node-local [`crate::tmail::store::TmailStore`] buffer
//! and the `/tet/v1/tmail` gossip plane (via [`crate::rest::RestState::broadcast_tmail`]).

use base64::Engine as _;

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
    // Nothing new to or from a wallet the operator hid: it would be stored and never served.
    if state.operator_hide.is_wallet_hidden(&env.receiver_wallet_id)
        || (!env.flags.anonymous && state.operator_hide.is_wallet_hidden(&env.sender_wallet_id))
    {
        return crate::rest::helpers::hidden_by_operator();
    }
    // An anonymous post is checked BEFORE it's stored or relayed: this node holds the receipt the
    // sender just deposited. A post whose proof doesn't verify (a repeat on the same board and day
    // included) is refused with the reason, never kept or relayed. The check, the store and any
    // release run as one unit on a blocking thread (`TmailStore::send_anonymous`), so neither a
    // burst of sends nor a client hanging up mid-check can split them.
    // A fast anonymous post (no proof of its own; docs/plans/FAST_ANON_POSTING.md): accepted only
    // for a posting key a verified proof registered for this board today, within the invisible
    // flood guard. Never for polls. Nothing refused is stored.
    let stored = if env.flags.anonymous && crate::tmail::store::is_fast_post(&env) {
        use crate::tmail::store::FastSendError as F;
        let (store, e2) = (state.tmail.clone(), env.clone());
        let err = |code: StatusCode, msg: &str| (code, Json(serde_json::json!({ "ok": false, "error": msg }))).into_response();
        match tokio::task::spawn_blocking(move || store.send_fast_anonymous(&e2)).await {
            Ok(Ok(stored)) => stored,
            Ok(Err(F::NotRegistered)) => return err(StatusCode::FORBIDDEN, "no proof for this board today yet: the first anonymous post of the day carries one"),
            Ok(Err(F::Poll)) => return err(StatusCode::FORBIDDEN, "a ballot needs its own membership proof"),
            Ok(Err(F::WrongDay)) => return err(StatusCode::BAD_REQUEST, "a posting key is for one UTC day; this post is dated another"),
            Ok(Err(F::Busy)) => return err(StatusCode::TOO_MANY_REQUESTS, "try again in a moment"),
            Ok(Err(F::DailyCap)) => return err(StatusCode::TOO_MANY_REQUESTS, "today's anonymous posts on this board are used; try again tomorrow"),
            Ok(Err(F::NotFast)) => return err(StatusCode::BAD_REQUEST, "not a fast post"),
            Ok(Err(F::Store(e))) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
            Err(j) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("the check didn't finish: {j}")).into_response(),
        }
    } else if env.flags.anonymous {
        let (store, e2) = (state.tmail.clone(), env.clone());
        match tokio::task::spawn_blocking(move || store.send_anonymous(&e2)).await {
            Ok(Ok(stored)) => stored,
            Ok(Err(crate::tmail::store::AnonSendError::NoProof)) => return (StatusCode::BAD_REQUEST, "an anonymous envelope needs its proof").into_response(),
            Ok(Err(crate::tmail::store::AnonSendError::NoReceipt)) => {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "ok": false, "error": "deposit the proof's receipt first" }))).into_response();
            }
            Ok(Err(crate::tmail::store::AnonSendError::Refused(reason))) => {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "ok": false, "error": format!("the anonymous proof doesn't verify: {reason}") }))).into_response();
            }
            // A ballot the poll's rules refuse (closed, not a member list's root, …): the reason, not a 500.
            Ok(Err(crate::tmail::store::AnonSendError::Ballot(reason))) => {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "ok": false, "error": reason }))).into_response();
            }
            Ok(Err(crate::tmail::store::AnonSendError::Store(e))) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
            Err(j) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("the check didn't finish: {j}")).into_response(),
        }
    } else {
        // Shelter's invisible flood guard for a member's named posts (membership itself is checked
        // in `store_tmail`).
        if crate::tmail::shelter::is_shelter_board(&env.receiver_wallet_id) {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
            let member = env.sender_wallet_id.trim().to_ascii_lowercase();
            let may = crate::tmail::shelter::config_from_env().is_some_and(|cfg| state.tmail.shelter_state(&cfg).may_post(&member, now));
            if !may {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "ok": false, "error": "only a member can post here" }))).into_response();
            }
            match state.tmail.shelter_flood_take(&member, now) {
                Ok(()) => {}
                Err(crate::tmail::store::FastSendError::DailyCap) => {
                    return (StatusCode::TOO_MANY_REQUESTS, Json(serde_json::json!({ "ok": false, "error": "that's today's posts; try again tomorrow" }))).into_response();
                }
                Err(_) => return (StatusCode::TOO_MANY_REQUESTS, Json(serde_json::json!({ "ok": false, "error": "try again in a moment" }))).into_response(),
            }
        }
        match state.tmail.store_tmail(&env) {
            Ok(s) => s,
            Err(e @ crate::tmail::store::TmailStoreError::Shelter(_)) => {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "ok": false, "error": e.to_string() }))).into_response();
            }
            Err(e @ crate::tmail::store::TmailStoreError::PollBallot(_)) => {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "ok": false, "error": e.to_string() }))).into_response();
            }
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
        }
    };
    if !stored {
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
/// `GET /tmail/anon/fast/:receiver/:posting_key` — is this posting key registered for this board
/// today? (The page asks before posting: registered means the next post needs no proof.) Reveals
/// nothing a reader of the board doesn't already see: posting keys sign the posts.
pub async fn get_tmail_anon_fast(
    State(state): State<RestState>,
    Path((receiver, posting_key)): Path<(String, String)>,
) -> axum::response::Response {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let bucket = nexus_protocol::tmail_bucket_index_v1(now);
    let reg = state.tmail.fast_registration(&receiver, bucket, &posting_key);
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "bucket": bucket, "registered": reg.is_some() }))).into_response()
}

pub async fn get_tmail_inbox(
    State(state): State<RestState>,
    Path(wallet_id): Path<String>,
    Query(q): Query<InboxQuery>,
) -> Response {
    let w = wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&w) {
        return (StatusCode::BAD_REQUEST, "wallet must be 64 hex chars").into_response();
    }
    // Hidden by the operator (`operator_hide.rs`): not served on this node's public routes.
    if state.operator_hide.is_wallet_hidden(&w) {
        return crate::rest::helpers::hidden_by_operator();
    }
    // Shelter's board is members-only: even its ciphertext would show post counts and timing.
    if crate::tmail::shelter::is_shelter_board(&w) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "ok": false, "error": "members only" }))).into_response();
    }
    inbox_response(&state, &w, q.limit)
}

/// The inbox rows for `w` (operator hides applied, scheduled messages without their ciphertext).
/// Shared by `/tmail/inbox` and Shelter's members-only `/shelter/inbox`.
pub(crate) fn inbox_response(state: &RestState, w: &str, limit: Option<usize>) -> Response {
    let w = w.to_string();
    let q = InboxQuery { limit };
    // A poll's wallet holds only verified ballots, one per member; a tally reads them all at once.
    let max = if state.tmail.get_poll_root(&w).is_some() { crate::tmail::poll::POLL_MAX_MEMBERS } else { INBOX_MAX_LIMIT };
    let limit = q.limit.unwrap_or(INBOX_DEFAULT_LIMIT).clamp(1, max);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let messages: Vec<crate::tmail::timelock::TmailInboxRowV1> = state
        .tmail
        .get_inbox(&w, limit)
        .iter()
        // A hidden post, or any post by a hidden wallet (its board's directory listing included).
        .filter(|env| {
            !state.operator_hide.is_msg_hidden(env.msg_id.trim())
                && (env.flags.anonymous || !state.operator_hide.is_wallet_hidden(&env.sender_wallet_id))
        })
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

/// `GET /tmail/anon/path/:wallet_id` — the authentication path for one registered wallet.
///
/// Serving this reveals only which leaf belongs to a **public** registration, which is already
/// public. The secret never appears, and the path is useless without it.
///
/// **A client about to post anonymously must not call this.** The request names the wallet, so the
/// node (and anything between) learns which member asked for a path just before an anonymous
/// message appears. Posters page [`get_tmail_anon_leaves`] and compute the path locally. This route
/// stays for operators and test scripts.
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

/// Query for [`get_tmail_anon_leaves`].
#[derive(Debug, Deserialize)]
pub struct AnonLeavesQuery {
    /// Epoch whose tree to page through. Defaults to the current one; a future epoch is refused.
    pub epoch: Option<u64>,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
}

/// Most leaves one page of [`get_tmail_anon_leaves`] returns.
pub const ANON_LEAVES_PAGE_MAX: usize = 4096;

/// `GET /tmail/anon/leaves?epoch=&offset=&limit=` — every leaf of one epoch's tree, in leaf order.
///
/// **This is how a poster gets its authentication path without telling the node who it is.** It
/// downloads the whole tree, finds its own commitment locally and computes the path itself. The
/// request names no wallet, no commitment and no index, so the node learns nothing about which
/// member is about to post. [`get_tmail_anon_path`] is the opposite: it is keyed by wallet id.
///
/// An epoch's leaf set is immutable once the epoch has started (a registration admitted during
/// epoch `e` enters from `e + 1`), so paging a fixed `epoch` by `offset` is consistent across
/// requests. The response carries that epoch's root so the client can check its rebuilt tree.
pub async fn get_tmail_anon_leaves(
    State(state): State<RestState>,
    axum::extract::Query(q): axum::extract::Query<AnonLeavesQuery>,
) -> Response {
    let current = state.tmail.anon_current_epoch();
    let epoch = q.epoch.unwrap_or(current);
    if epoch > current {
        return (StatusCode::BAD_REQUEST, "epoch is in the future").into_response();
    }
    let leaves = state.tmail.anon_leaves_for_epoch(epoch);
    let total = leaves.len();
    let limit = q.limit.unwrap_or(ANON_LEAVES_PAGE_MAX).clamp(1, ANON_LEAVES_PAGE_MAX);
    let start = q.offset.min(total);
    let end = start.saturating_add(limit).min(total);
    let epoch_ms = crate::tmail::store::TmailStore::anon_epoch_ms_public();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "epoch": epoch,
            "merkle_root": hex::encode(state.tmail.anon_root_for_epoch(epoch)),
            "depth": nexus_protocol::TET_ANON_MERKLE_DEPTH,
            "total": total,
            "offset": start,
            "leaves": leaves[start..end].iter().map(hex::encode).collect::<Vec<_>>(),
            "next_offset": (end < total).then_some(end),
            "epoch_ms": epoch_ms,
            "next_epoch_at_ms": (current + 1).saturating_mul(epoch_ms),
            "note": crate::tmail::anon::TMAIL_ANON_DISCLOSURE,
        })),
    )
        .into_response()
}

const _: fn() = || {
    let _ = anon_registration_error_status;
    let _: Option<TmailAnonRegistrationError> = None;
};

/// `PUT /tmail/anon/receipt` — the sender deposits its membership receipt on its own node.
///
/// Announce-then-pull needs somebody to answer the pull. The sender's node is the first such
/// somebody; every node that later verifies the receipt may cache and serve it too, so the sender
/// going offline does not strand the messages it already sent.
///
/// The body is `{ receipt_sha256_hex, receipt_b64 }` and the hash is **checked against the bytes**,
/// not trusted. That is what makes it safe for this endpoint to be unauthenticated: the store is
/// content-addressed, so the worst a caller can do is insert data under its own hash.
pub async fn put_tmail_anon_receipt(
    State(state): State<RestState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let hash = body
        .get("receipt_sha256_hex")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let b64 = body
        .get("receipt_b64")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()) else {
        return (StatusCode::BAD_REQUEST, "receipt_b64 is not valid base64").into_response();
    };
    match state.tmail.put_anon_receipt(&hash, &bytes) {
        Ok(true) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": true,
                "receipt_sha256_hex": hash,
                "bytes": bytes.len(),
                "cached": state.tmail.anon_receipt_count(),
            })),
        )
            .into_response(),
        Ok(false) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false,
                "error": "receipt_b64 does not hash to receipt_sha256_hex",
            })),
        )
            .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
    }
}

/// `GET /tmail/anon/receipt/:hash` — serve a cached receipt. Content-addressed, so any node that
/// has one may serve it.
pub async fn get_tmail_anon_receipt(
    State(state): State<RestState>,
    Path(hash): Path<String>,
) -> Response {
    match state.tmail.get_anon_receipt(&hash) {
        Some(bytes) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": true,
                "receipt_sha256_hex": hash.trim().to_ascii_lowercase(),
                "receipt_b64": base64::engine::general_purpose::STANDARD.encode(&bytes),
            })),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "error": "not held by this node" })),
        )
            .into_response(),
    }
}

/// `POST /tmail/poll/root` — register a members-only poll's member root (tmail/poll.rs), signed by
/// the poll's own wallet. Immutable once set; the poll must be open today (UTC).
pub async fn post_tmail_poll_root(State(state): State<RestState>, Json(r): Json<crate::tmail::poll::TmailPollRootV1>) -> Response {
    if let Err(e) = crate::tmail::poll::verify_tmail_poll_root_v1(&r) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "ok": false, "error": e.to_string() }))).into_response();
    }
    let now_bucket = nexus_protocol::tmail_bucket_index_v1(
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
    );
    if r.bucket_index != now_bucket {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "ok": false, "error": "a poll is registered on the UTC day it opens" }))).into_response();
    }
    match state.tmail.register_poll_root(&r) {
        Ok(stored) => {
            let root_hex = state.tmail.get_poll_root(&r.poll_wallet_id).map(|p| p.root_hex);
            (StatusCode::ACCEPTED, Json(serde_json::json!({ "ok": true, "stored": stored, "root_hex": root_hex }))).into_response()
        }
        Err(e) => {
            let status = if e.starts_with("this poll already") { StatusCode::CONFLICT } else { StatusCode::BAD_REQUEST };
            (status, Json(serde_json::json!({ "ok": false, "error": e }))).into_response()
        }
    }
}

/// `GET /tmail/poll/root/:wallet_id` — a poll's registered member root, or 404.
pub async fn get_tmail_poll_root(State(state): State<RestState>, Path(wallet_id): Path<String>) -> Response {
    match state.tmail.get_poll_root(&wallet_id) {
        Some(r) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "poll_root": r }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "ok": false }))).into_response(),
    }
}

/// `GET /tmail/anon/commitment/:wallet_id` — a member's public commitment (registrations are
/// public), so a poll's creator can build the poll's member tree.
pub async fn get_tmail_anon_commitment(State(state): State<RestState>, Path(wallet_id): Path<String>) -> Response {
    match state.tmail.get_anon_registration(&wallet_id) {
        Some(r) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "wallet_id": r.wallet_id, "commitment_hex": r.commitment_hex }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "ok": false, "error": "not a registered member" }))).into_response(),
    }
}
