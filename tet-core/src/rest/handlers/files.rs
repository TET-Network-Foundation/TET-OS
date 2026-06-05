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
use serde::Deserialize;

use crate::files::{
    FileDeleteError, FileDeleteRequestV1, FileEnvelopeError, FileEnvelopeV1,
    verify_file_delete_request_v1, verify_file_envelope_v1,
};
use crate::rest::RestState;

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
pub async fn get_files_fetch(
    State(state): State<RestState>,
    Path(file_id): Path<String>,
) -> Response {
    let id = file_id.trim();
    if uuid::Uuid::parse_str(id).is_err() {
        return (StatusCode::BAD_REQUEST, "file_id must be a UUID").into_response();
    }
    match state.files.get_blob(id) {
        Some(bytes) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "ok": false,
                "file_id": id,
                "error": "no blob stored for this file_id (unknown or expired)",
            })),
        )
            .into_response(),
    }
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
