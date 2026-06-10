//! File Sharing REST endpoints (spec `docs/PHASE_0_FILE_SHARING_SPEC.md` §5).
//!
//! All sender-authenticated actions use hybrid signatures (Ed25519 + ML-DSA) — no admin token.
//! File Sharing is off-ledger: these handlers only touch the node-local
//! [`crate::files::storage::FileStore`] and the `/tet/v1/files/announce` gossip plane (via
//! [`crate::rest::RestState::broadcast_file_announce`]).

use axum::{
    Json,
    body::Bytes,
    extract::{Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine as _;
use serde::Deserialize;

use crate::files::{
    FILE_FEE_MICRO, FileDeleteError, FileDeleteRequestV1, FileEnvelopeError, FileEnvelopeV1,
    verify_file_delete_request_v1, verify_file_envelope_v1,
};
use crate::protocol::{SignedTxEnvelopeV1, TxV1};
use crate::rest::RestState;
use crate::rest::helpers::verify_envelope_v1;

const INBOX_DEFAULT_LIMIT: usize = 50;
const INBOX_MAX_LIMIT: usize = 200;

fn is_wallet_id_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn envelope_error_status(e: &FileEnvelopeError) -> StatusCode {
    match e {
        FileEnvelopeError::Signature(_) | FileEnvelopeError::SignerMismatch => {
            StatusCode::UNAUTHORIZED
        }
        _ => StatusCode::BAD_REQUEST,
    }
}

fn delete_error_status(e: &FileDeleteError) -> StatusCode {
    match e {
        FileDeleteError::Signature(_) | FileDeleteError::SignerMismatch => StatusCode::UNAUTHORIZED,
        _ => StatusCode::BAD_REQUEST,
    }
}

/// `POST /files/upload` — multipart (`envelope` JSON field + `body` blob field). Verifies the
/// envelope, checks `sha256(body) == file_sha256` and the size cap, stores blob + meta + inbox, then
/// gossips the announce. Returns `202 { file_id, storage_node }`.
///
/// A `DefaultBodyLimit` is applied on the route (spec §5) to allow the 5 MiB body.
pub async fn post_files_upload(State(state): State<RestState>, mut multipart: Multipart) -> Response {
    let mut envelope: Option<FileEnvelopeV1> = None;
    let mut body: Option<Bytes> = None;

    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let name = field.name().unwrap_or("").to_string();
                match name.as_str() {
                    "envelope" => match field.text().await {
                        Ok(text) => match serde_json::from_str::<FileEnvelopeV1>(&text) {
                            Ok(env) => envelope = Some(env),
                            Err(e) => {
                                return (
                                    StatusCode::BAD_REQUEST,
                                    format!("invalid envelope JSON: {e}"),
                                )
                                    .into_response();
                            }
                        },
                        Err(e) => {
                            return (
                                StatusCode::BAD_REQUEST,
                                format!("could not read envelope field: {e}"),
                            )
                                .into_response();
                        }
                    },
                    "body" => match field.bytes().await {
                        Ok(b) => body = Some(b),
                        Err(e) => {
                            return (
                                StatusCode::BAD_REQUEST,
                                format!("could not read body field: {e}"),
                            )
                                .into_response();
                        }
                    },
                    _ => {}
                }
            }
            Ok(None) => break,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, format!("multipart error: {e}")).into_response();
            }
        }
    }

    let Some(env) = envelope else {
        return (StatusCode::BAD_REQUEST, "missing `envelope` field").into_response();
    };
    let Some(body) = body else {
        return (StatusCode::BAD_REQUEST, "missing `body` field").into_response();
    };

    if let Err(e) = verify_file_envelope_v1(&env) {
        return (envelope_error_status(&e), format!("{e}")).into_response();
    }

    match state.files.store_with_blob(&env, &body) {
        Ok(_) => {}
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("{e}")).into_response();
        }
    }

    state.broadcast_file_announce(&env).await;
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "ok": true,
            "file_id": env.file_id,
            "storage_node": env.storage_node,
            // Step 4 fee settlement: the storage node's consensus wallet id (50% payout target)
            // so the sender can build + submit the `TxV1::FileFee` to `/files/fee`.
            "storage_wallet": crate::consensus::local_node_id_from_env(),
            "fee_micro": env.fee_micro,
            "status": "accepted",
        })),
    )
        .into_response()
}

/// `POST /files/announce` — verify a file envelope and gossip it (metadata only; no blob). Buffers
/// the meta locally so the receiver's node can list it even before the blob is pulled.
pub async fn post_files_announce(
    State(state): State<RestState>,
    Json(env): Json<FileEnvelopeV1>,
) -> Response {
    if let Err(e) = verify_file_envelope_v1(&env) {
        return (envelope_error_status(&e), format!("{e}")).into_response();
    }
    match state.files.store_meta(&env) {
        Ok(_) => {}
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response();
        }
    }
    state.broadcast_file_announce(&env).await;
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "ok": true,
            "file_id": env.file_id,
            "status": "accepted",
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct InboxQuery {
    pub limit: Option<usize>,
}

/// `GET /files/inbox/:wallet_id?limit=N` — non-expired file envelopes addressed to `wallet_id`,
/// newest first. Phase 0: unauthenticated read (public), server filters to this wallet.
pub async fn get_files_inbox(
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
    let files = state.files.get_inbox(&w, limit);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "wallet_id": w,
            "count": files.len(),
            "files": files,
        })),
    )
        .into_response()
}

/// `GET /files/fetch/:file_id` — return the encrypted blob bytes (octet-stream), or `404`.
///
/// Step 4: on a local-store miss with a known announce envelope, the body is pulled from the
/// storage node over the libp2p `/tet/v1/files/fetch` protocol (custom 8 MiB codec), verified
/// against the envelope's `file_sha256`, cached locally, then served — so the receiver's node
/// transparently fetches cross-node bodies without any UI change.
pub async fn get_files_fetch(
    State(state): State<RestState>,
    Path(file_id): Path<String>,
) -> Response {
    let id = file_id.trim();
    if uuid::Uuid::parse_str(id).is_err() {
        return (StatusCode::BAD_REQUEST, "file_id must be a UUID").into_response();
    }
    if let Some(bytes) = state.files.get_blob(id) {
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        )
            .into_response();
    }
    if let Some(bytes) = fetch_blob_from_peer(&state, id).await {
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        )
            .into_response();
    }
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({
            "ok": false,
            "file_id": id,
            "error": "no blob stored for this file_id (unknown or expired)",
        })),
    )
        .into_response()
}

/// Local-miss path of [`get_files_fetch`]: pull the encrypted blob from the announced storage
/// node over libp2p, verify integrity against the envelope, and cache it locally. Returns `None`
/// on any failure (caller answers 404); decode/hash/store run on the blocking pool.
async fn fetch_blob_from_peer(state: &RestState, file_id: &str) -> Option<Vec<u8>> {
    let env = state.files.get_meta(file_id)?;
    let fetch_tx = state.files_fetch_tx.as_ref()?;
    let (resp_tx, resp_rx) = tokio::sync::oneshot::channel();
    fetch_tx
        .send(crate::p2p::FilesFetchCmd {
            storage_node: env.storage_node.clone(),
            file_id: env.file_id,
            resp: resp_tx,
        })
        .await
        .ok()?;
    let resp = match tokio::time::timeout(std::time::Duration::from_secs(35), resp_rx).await {
        Ok(Ok(Ok(resp))) => resp,
        Ok(Ok(Err(e))) => {
            log::warn!("[files] libp2p fetch failed file_id={file_id}: {e}");
            return None;
        }
        _ => {
            log::warn!("[files] libp2p fetch timed out / channel closed file_id={file_id}");
            return None;
        }
    };
    if !resp.found {
        log::info!(
            "[files] libp2p fetch: peer does not hold file_id={file_id} (storage_node={})",
            env.storage_node
        );
        return None;
    }
    let state2 = state.clone();
    let file_id_owned = file_id.to_string();
    tokio::task::spawn_blocking(move || {
        let blob = base64::engine::general_purpose::STANDARD
            .decode(resp.blob_b64.as_bytes())
            .ok()?;
        // Integrity: the announce envelope's signed sha256/size are authoritative.
        if blob.len() as u64 != env.file_size || crate::files::sha256_hex(&blob) != env.file_sha256
        {
            log::warn!(
                "[files] libp2p fetch integrity mismatch file_id={file_id_owned}; discarding"
            );
            return None;
        }
        if let Err(e) = state2.files.store_with_blob(&env, &blob) {
            // Serve the verified bytes even if local caching fails (e.g. store at capacity).
            log::warn!("[files] could not cache fetched blob file_id={file_id_owned}: {e}");
        }
        Some(blob)
    })
    .await
    .ok()
    .flatten()
}

/// `POST /files/fee` — submit a hybrid-signed [`TxV1::FileFee`] settlement (Phase 0 Step 4,
/// spec §7). Prechecks only (no ledger mutation): envelope signature, exact fee amount, signer ==
/// payer, spendable balance. Enqueues into the mempool and gossips so any producer can mine it;
/// the 25/50/25 treasury/storage/burn split is applied deterministically at block-apply time.
pub async fn post_files_fee(
    State(state): State<RestState>,
    Json(env): Json<SignedTxEnvelopeV1>,
) -> Response {
    if let Err(e) = verify_envelope_v1(&env) {
        return (StatusCode::UNAUTHORIZED, e).into_response();
    }
    let TxV1::FileFee {
        from_wallet,
        storage_wallet,
        file_id,
        fee_micro,
    } = env.tx.clone()
    else {
        return (StatusCode::BAD_REQUEST, "expected file_fee tx").into_response();
    };
    if fee_micro != FILE_FEE_MICRO {
        return (
            StatusCode::BAD_REQUEST,
            format!("fee_micro must be exactly {FILE_FEE_MICRO}"),
        )
            .into_response();
    }
    if uuid::Uuid::parse_str(file_id.trim()).is_err() {
        return (StatusCode::BAD_REQUEST, "file_id must be a UUID").into_response();
    }
    let from = from_wallet.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&from) {
        return (StatusCode::BAD_REQUEST, "from_wallet must be 64 hex chars").into_response();
    }
    if env.sig.ed25519_pubkey_hex.trim().to_ascii_lowercase() != from {
        return (
            StatusCode::UNAUTHORIZED,
            "signer must equal from_wallet",
        )
            .into_response();
    }
    if storage_wallet.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "storage_wallet required").into_response();
    }
    let spendable = state.ledger.spendable_balance_micro_now(&from).unwrap_or(0);
    if spendable < fee_micro {
        return (StatusCode::BAD_REQUEST, "insufficient funds").into_response();
    }
    if let Err(e) = state.enqueue_mempool_tx(env.clone()).await {
        return (StatusCode::TOO_MANY_REQUESTS, e.to_string()).into_response();
    }
    state.broadcast_mempool_tx(&env).await;
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "ok": true,
            "status": "pending",
            "queued": true,
            "file_id": file_id,
            "fee_micro": fee_micro,
        })),
    )
        .into_response()
}

/// `DELETE /files/:file_id` — sender-only cancel. Body is a hybrid-signed [`FileDeleteRequestV1`];
/// the signer must equal the stored envelope's `sender_wallet_id`.
pub async fn delete_files(
    State(state): State<RestState>,
    Path(file_id): Path<String>,
    Json(req): Json<FileDeleteRequestV1>,
) -> Response {
    let id = file_id.trim();
    if req.file_id.to_string() != id {
        return (
            StatusCode::BAD_REQUEST,
            "path file_id must equal body file_id",
        )
            .into_response();
    }
    if let Err(e) = verify_file_delete_request_v1(&req) {
        return (delete_error_status(&e), format!("{e}")).into_response();
    }
    // Authorization: only the original sender may delete.
    match state.files.get_meta(id) {
        Some(env) => {
            let stored_sender = env.sender_wallet_id.trim().to_ascii_lowercase();
            let req_sender = req.sender_wallet_id.trim().to_ascii_lowercase();
            if stored_sender != req_sender {
                return (
                    StatusCode::FORBIDDEN,
                    "only the original sender may delete this file",
                )
                    .into_response();
            }
        }
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "ok": false, "file_id": id, "error": "not found" })),
            )
                .into_response();
        }
    }
    let existed = state.files.delete_file(id);
    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "file_id": id, "deleted": existed })),
    )
        .into_response()
}
