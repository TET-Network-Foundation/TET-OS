//! `POST /prove_anon` — the anonymous-membership proof (guest mode 3, spec §A.4.3).
//!
//! Input is exactly what `tet-network/ui/app/lib/anon_poster.mjs` sends: the member secret, its
//! leaf index and authentication path (computed by the client from the whole registry), the
//! ephemeral key the envelope will be signed with, the receiver and the day bucket. Output is what
//! the node needs: the receipt (bincode, as `zk_verifier` decodes it), the journal, the image id
//! and the receipt's SHA-256 (its pull key).

use axum::{http::StatusCode, response::IntoResponse, response::Response, Json};
use base64::Engine as _;
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::Deserialize;
use sha2::{Digest as _, Sha256};

/// `nexus_protocol::TET_ANON_MERKLE_DEPTH`.
pub const ANON_MERKLE_DEPTH: usize = 20;

/// The request body, as the browser sends it.
#[derive(Debug, Deserialize)]
pub struct ProveAnonRequest {
    pub secret_hex: String,
    pub index: u32,
    pub siblings_hex: Vec<String>,
    pub ephemeral_hex: String,
    pub receiver_hex: String,
    pub bucket: u64,
}

/// Validated guest input, in the order the guest reads it after the mode byte.
#[derive(Debug, PartialEq, Eq)]
pub struct AnonGuestInput {
    pub secret: [u8; 32],
    pub index: u32,
    pub siblings: Vec<[u8; 32]>,
    pub ephemeral: [u8; 32],
    pub receiver: [u8; 32],
    pub bucket: u64,
}

fn hex32(field: &str, s: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(s.trim()).map_err(|_| format!("{field}: not hex"))?;
    <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| format!("{field}: must be 32 bytes"))
}

/// Check every field before any proving starts. A malformed path would otherwise surface as a
/// guest panic after seconds of work, with an error that names nothing.
pub fn parse_prove_anon(req: &ProveAnonRequest) -> Result<AnonGuestInput, String> {
    if req.siblings_hex.len() != ANON_MERKLE_DEPTH {
        return Err(format!(
            "siblings_hex: expected {ANON_MERKLE_DEPTH} entries, got {}",
            req.siblings_hex.len()
        ));
    }
    let siblings = req
        .siblings_hex
        .iter()
        .enumerate()
        .map(|(i, s)| hex32(&format!("siblings_hex[{i}]"), s))
        .collect::<Result<Vec<_>, _>>()?;
    if u64::from(req.index) >= 1u64 << ANON_MERKLE_DEPTH {
        return Err("index: outside the tree".into());
    }
    Ok(AnonGuestInput {
        secret: hex32("secret_hex", &req.secret_hex)?,
        index: req.index,
        siblings,
        ephemeral: hex32("ephemeral_hex", &req.ephemeral_hex)?,
        receiver: hex32("receiver_hex", &req.receiver_hex)?,
        bucket: req.bucket,
    })
}

/// `image_id` as 8 little-endian words in hex — `tmail::anon::encode_image_id_hex`.
fn image_id_hex(id: &[u32; 8]) -> String {
    hex::encode(id.iter().flat_map(|w| w.to_le_bytes()).collect::<Vec<u8>>())
}

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(serde_json::json!({ "error": msg }))).into_response()
}

/// Prove one membership. Proving is CPU-bound for tens of seconds, so it runs on the blocking pool.
pub async fn prove_anon_handler(Json(body): Json<ProveAnonRequest>) -> Response {
    if methods::NEXUS_GUEST_ELF.is_empty() {
        // The UI maps 503 to "the native prover is not usable", not to a retryable failure.
        return err(
            StatusCode::SERVICE_UNAVAILABLE,
            "anonymous guest ELF is empty — build tet-prover-host without RISC0_SKIP_BUILD=1",
        );
    }
    let input = match parse_prove_anon(&body) {
        Ok(i) => i,
        Err(e) => return err(StatusCode::BAD_REQUEST, &e),
    };
    let joined = tokio::task::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let env = ExecutorEnv::builder()
            .write(&3u8)
            .and_then(|b| b.write(&input.secret))
            .and_then(|b| b.write(&input.index))
            .and_then(|b| b.write(&input.siblings))
            .and_then(|b| b.write(&input.ephemeral))
            .and_then(|b| b.write(&input.receiver))
            .and_then(|b| b.write(&input.bucket))
            .map_err(|e| format!("executor env: {e}"))?
            .build()
            .map_err(|e| format!("executor env: {e}"))?;
        let receipt = default_prover()
            .prove(env, methods::NEXUS_GUEST_ELF)
            .map_err(|e| format!("prove: {e}"))?
            .receipt;
        receipt
            .verify(methods::NEXUS_GUEST_ID)
            .map_err(|e| format!("local verify: {e}"))?;
        let receipt_bytes = bincode::serialize(&receipt).map_err(|e| format!("receipt: {e}"))?;
        let b64 = base64::engine::general_purpose::STANDARD;
        Ok(serde_json::json!({
            "receipt_b64": b64.encode(&receipt_bytes),
            "receipt_sha256_hex": hex::encode(Sha256::digest(&receipt_bytes)),
            "journal_b64": b64.encode(&receipt.journal.bytes),
            "image_id_hex": image_id_hex(&methods::NEXUS_GUEST_ID),
        }))
    })
    .await;
    match joined {
        Ok(Ok(v)) => (StatusCode::OK, Json(v)).into_response(),
        Ok(Err(e)) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &format!("prover task: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> ProveAnonRequest {
        ProveAnonRequest {
            secret_hex: "42".repeat(32),
            index: 3,
            siblings_hex: vec!["aa".repeat(32); ANON_MERKLE_DEPTH],
            ephemeral_hex: "11".repeat(32),
            receiver_hex: "cd".repeat(32),
            bucket: 20_000,
        }
    }

    #[test]
    fn a_well_formed_request_parses_in_guest_order() {
        let i = parse_prove_anon(&valid()).unwrap();
        assert_eq!(i.secret, [0x42; 32]);
        assert_eq!(i.siblings.len(), ANON_MERKLE_DEPTH);
        assert_eq!((i.index, i.bucket), (3, 20_000));
    }

    #[test]
    fn a_short_path_is_refused_before_proving() {
        let mut r = valid();
        r.siblings_hex.pop();
        assert!(parse_prove_anon(&r).unwrap_err().contains("expected 20"));
    }

    #[test]
    fn a_bad_field_is_named() {
        let mut r = valid();
        r.receiver_hex = "zz".into();
        assert!(parse_prove_anon(&r).unwrap_err().starts_with("receiver_hex"));
        let mut r = valid();
        r.siblings_hex[5] = "ab".into();
        assert!(parse_prove_anon(&r).unwrap_err().starts_with("siblings_hex[5]"));
    }

    #[test]
    fn image_id_hex_matches_tet_core_encoding() {
        // `encode_image_id_hex` writes each word little-endian.
        assert_eq!(image_id_hex(&[1, 0, 0, 0, 0, 0, 0, 0x0102_0304]), format!("01{}04030201", "0".repeat(54)));
    }
}
