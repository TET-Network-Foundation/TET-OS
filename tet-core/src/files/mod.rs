//! File Sharing — Phase 0 (spec `docs/PHASE_0_FILE_SHARING_SPEC.md`).
//!
//! End-to-end encrypted 1:1 file transfer reusing the Tmail crypto stack (X25519 + ML-KEM-768 +
//! ChaCha20-Poly1305 for E2EE; Ed25519 + ML-DSA-44 for the hybrid signature). Like Tmail, file
//! content is **never** written to the ledger: the signed [`FileEnvelopeV1`] (metadata only) travels
//! over libp2p gossip (`/tet/v1/files/announce`) and the encrypted body lives in a node-local TTL
//! store ([`storage::FileStore`]), pulled on demand via REST.
//!
//! Design invariant: the node is a blind relay — it never sees plaintext filename, MIME, or bytes.

pub mod fetch_codec;
pub mod storage;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

/// Stable `kind` discriminator for v1 envelopes.
pub const FILE_ENVELOPE_KIND: &str = "file_envelope_v1";
/// E2EE scheme identifier (one hybrid KEM encapsulation, HKDF info `"tet-file-v1"`).
pub const FILE_E2EE_SCHEME: &str = "tet-file-hybrid-v1";
/// HKDF `info` used when deriving the per-file symmetric key (spec §3 / §9).
pub const FILE_HKDF_INFO: &[u8] = b"tet-file-v1";

/// Phase 0 hard cap on the encrypted body size (5 MiB).
pub const MAX_FILE_BODY_BYTES: u64 = 5 * 1024 * 1024;

/// libp2p gossip topic carrying the announce envelope (envelope only, no body).
pub const FILES_ANNOUNCE_TOPIC: &str = "/tet/v1/files/announce";
/// libp2p request/response protocol id for body transfer (defined now; wired in Step 4 — see spec §9).
pub const FILES_FETCH_PROTOCOL: &str = "/tet/v1/files/fetch";

/// Per-file fee (µTET), bound into the envelope signature. Settled on-chain via
/// [`crate::protocol::TxV1::FileFee`] (Step 4).
pub const FILE_FEE_MICRO: u64 = 1000;
/// Fee split (basis points, sum = 10_000): treasury / storage node / burn = 25 / 50 / 25.
pub const FEE_SPLIT_TREASURY_BPS: u32 = 2_500;
pub const FEE_SPLIT_STORAGE_BPS: u32 = 5_000;
pub const FEE_SPLIT_BURN_BPS: u32 = 2_500;

/// Deterministic 25/50/25 split of a file fee (spec §7).
///
/// `burn` takes the integer-division remainder (`fee - treasury - storage`), so the three parts
/// always sum to exactly `fee_micro` on every node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileFeeSplit {
    pub treasury_micro: u64,
    pub storage_micro: u64,
    pub burn_micro: u64,
}

pub fn file_fee_split(fee_micro: u64) -> FileFeeSplit {
    let treasury_micro = (fee_micro as u128 * FEE_SPLIT_TREASURY_BPS as u128 / 10_000) as u64;
    let storage_micro = (fee_micro as u128 * FEE_SPLIT_STORAGE_BPS as u128 / 10_000) as u64;
    let burn_micro = fee_micro
        .saturating_sub(treasury_micro)
        .saturating_sub(storage_micro);
    FileFeeSplit {
        treasury_micro,
        storage_micro,
        burn_micro,
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FileEnvelopeError {
    #[error("unsupported file envelope version: {0}")]
    UnsupportedVersion(u32),
    #[error("unexpected envelope kind: {0}")]
    Kind(String),
    #[error("invalid wallet id (expected 64 lowercase hex chars)")]
    InvalidWalletId,
    #[error("invalid file_sha256 (expected 64 lowercase hex chars)")]
    InvalidSha256,
    #[error("file_size out of range (expected 1..={max} bytes, got {got})")]
    SizeOutOfRange { got: u64, max: u64 },
    #[error("signer ed25519 pubkey must equal sender_wallet_id")]
    SignerMismatch,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
}

/// Hybrid signature block (Ed25519 + ML-DSA-44) — identical shape to Tmail's.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHybridSig {
    pub ed25519_pubkey_hex: String,
    pub ed25519_sig_b64: String,
    pub mldsa_pubkey_b64: String,
    pub mldsa_sig_b64: String,
}

/// E2EE material (spec §3). One hybrid KEM encapsulation → one key; filename / MIME / body each use
/// a distinct nonce. The node treats this as an opaque blob — it never decrypts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileE2eeBlock {
    pub v: u32,
    pub scheme: String,
    pub client_ephemeral_pub_b64: String,
    pub receiver_x25519_pub_b64: String,
    pub receiver_mlkem_pub_b64: String,
    pub mlkem_ciphertext_b64: String,
    pub filename_nonce_b64: String,
    pub mime_nonce_b64: String,
    pub body_nonce_b64: String,
}

/// File transfer envelope (spec §3). All binary fields are base64; `file_sha256` is lowercase hex.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEnvelopeV1 {
    pub v: u32,
    pub kind: String,
    pub file_id: uuid::Uuid,
    pub sender_wallet_id: String,
    pub receiver_wallet_id: String,
    /// Length of the **encrypted** blob in bytes (`1..=MAX_FILE_BODY_BYTES`).
    pub file_size: u64,
    /// SHA-256 of the **encrypted** blob, lowercase hex (integrity, bound into the signature).
    pub file_sha256: String,
    pub filename_encrypted_b64: String,
    pub mime_type_encrypted_b64: String,
    /// libp2p PeerId (base58btc) of the node holding the blob.
    pub storage_node: String,
    #[serde(default)]
    pub fee_micro: u64,
    pub created_at_ms: u64,
    #[serde(default)]
    pub ttl_ms: u64,
    pub e2ee: FileE2eeBlock,
    pub hybrid_sig: FileHybridSig,
}

fn is_wallet_id_64hex(s: &str) -> bool {
    let s = s.trim();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn is_sha256_64hex(s: &str) -> bool {
    let s = s.trim();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Build the hybrid-signature preimage for a file envelope (spec §3.1).
///
/// Format (exact, single line, `|`-separated):
/// `tet file envelope v1|chain_id={}|genesis_hash={}|file_id={}|sender={}|receiver={}|size={}|sha256={}|filename={}|mime={}|storage_node={}|fee_micro={}|created_at_ms={}|mldsa_pk={}`
///
/// Mirrors `crate::tmail::envelope::tmail_envelope_auth_message_bytes`: wallet ids are lowercased and
/// `chain_id` / `genesis_hash` bind the message to this network.
pub fn file_envelope_preimage_v1(env: &FileEnvelopeV1, mldsa_pubkey_b64: &str) -> Vec<u8> {
    let s = format!(
        "tet file envelope v1|chain_id={}|genesis_hash={}|file_id={}|sender={}|receiver={}|size={}|sha256={}|filename={}|mime={}|storage_node={}|fee_micro={}|created_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        env.file_id,
        env.sender_wallet_id.trim().to_ascii_lowercase(),
        env.receiver_wallet_id.trim().to_ascii_lowercase(),
        env.file_size,
        env.file_sha256.trim().to_ascii_lowercase(),
        env.filename_encrypted_b64.trim(),
        env.mime_type_encrypted_b64.trim(),
        env.storage_node.trim(),
        env.fee_micro,
        env.created_at_ms,
        mldsa_pubkey_b64.trim(),
    );
    s.into_bytes()
}

/// Verify a file envelope's hybrid signature and structural invariants (consensus-grade, spec §3.2).
///
/// Checks (in order): version, kind, `file_size` range, `file_sha256` well-formed,
/// sender/receiver well-formed, signer `ed25519_pubkey_hex == sender`, then the hybrid signature.
pub fn verify_file_envelope_v1(env: &FileEnvelopeV1) -> Result<(), FileEnvelopeError> {
    if env.v != 1 {
        return Err(FileEnvelopeError::UnsupportedVersion(env.v));
    }
    if env.kind != FILE_ENVELOPE_KIND {
        return Err(FileEnvelopeError::Kind(env.kind.clone()));
    }
    if env.file_size == 0 || env.file_size > MAX_FILE_BODY_BYTES {
        return Err(FileEnvelopeError::SizeOutOfRange {
            got: env.file_size,
            max: MAX_FILE_BODY_BYTES,
        });
    }
    if !is_sha256_64hex(&env.file_sha256) {
        return Err(FileEnvelopeError::InvalidSha256);
    }
    let sender = env.sender_wallet_id.trim().to_ascii_lowercase();
    let receiver = env.receiver_wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&sender) || !is_wallet_id_64hex(&receiver) {
        return Err(FileEnvelopeError::InvalidWalletId);
    }
    let signer = env.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if signer != sender {
        return Err(FileEnvelopeError::SignerMismatch);
    }
    let msg = file_envelope_preimage_v1(env, &env.hybrid_sig.mldsa_pubkey_b64);
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&env.hybrid_sig.ed25519_sig_b64),
        Some(&env.hybrid_sig.mldsa_pubkey_b64),
        Some(&env.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|e| FileEnvelopeError::Signature(format!("{e:?}")))?;
    Ok(())
}

/// Hex(SHA-256) of arbitrary bytes — used to validate an uploaded blob against `file_sha256`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest as _, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

// ---------------------------------------------------------------------------------------------
// Sender-only delete (spec §5).
// ---------------------------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum FileDeleteError {
    #[error("invalid wallet id (expected 64 lowercase hex chars)")]
    InvalidWalletId,
    #[error("signer ed25519 pubkey must equal sender_wallet_id")]
    SignerMismatch,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
}

/// Sender-authenticated delete request (spec §5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDeleteRequestV1 {
    pub file_id: uuid::Uuid,
    pub sender_wallet_id: String,
    pub created_at_ms: u64,
    pub hybrid_sig: FileHybridSig,
}

/// Preimage for a delete request (spec §5):
/// `tet file delete v1|chain_id={}|genesis_hash={}|file_id={}|sender={}|created_at_ms={}|mldsa_pk={}`
pub fn file_delete_preimage_v1(req: &FileDeleteRequestV1, mldsa_pubkey_b64: &str) -> Vec<u8> {
    format!(
        "tet file delete v1|chain_id={}|genesis_hash={}|file_id={}|sender={}|created_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        req.file_id,
        req.sender_wallet_id.trim().to_ascii_lowercase(),
        req.created_at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// Verify a delete request's hybrid signature. The Ed25519 signer must equal `sender_wallet_id`.
pub fn verify_file_delete_request_v1(req: &FileDeleteRequestV1) -> Result<(), FileDeleteError> {
    let sender = req.sender_wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&sender) {
        return Err(FileDeleteError::InvalidWalletId);
    }
    let signer = req.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if signer != sender {
        return Err(FileDeleteError::SignerMismatch);
    }
    let msg = file_delete_preimage_v1(req, &req.hybrid_sig.mldsa_pubkey_b64);
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&req.hybrid_sig.ed25519_sig_b64),
        Some(&req.hybrid_sig.mldsa_pubkey_b64),
        Some(&req.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|e| FileDeleteError::Signature(format!("{e:?}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// libp2p request/response messages (protocol `/tet/v1/files/fetch`).
//
// Defined now as Phase-0 foundation; wiring into the live block-plane swarm is deferred to Step 4
// because `request_response::json` caps message size near 1 MiB and 5 MiB bodies need a custom
// size-configurable codec (spec §9). The Phase-0 body transport is REST `GET /files/fetch/:id`.
// ---------------------------------------------------------------------------------------------

/// Request a stored encrypted blob by id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileFetchRequest {
    pub file_id: uuid::Uuid,
}

/// Response carrying the (base64-encoded) encrypted blob, or `found=false`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileFetchResponse {
    pub found: bool,
    pub file_id: uuid::Uuid,
    #[serde(default)]
    pub blob_b64: String,
    #[serde(default)]
    pub file_sha256: String,
}

impl FileFetchResponse {
    pub fn not_found(file_id: uuid::Uuid) -> Self {
        Self {
            found: false,
            file_id,
            blob_b64: String::new(),
            file_sha256: String::new(),
        }
    }

    pub fn from_blob(file_id: uuid::Uuid, blob: &[u8]) -> Self {
        Self {
            found: true,
            file_id,
            blob_b64: base64::engine::general_purpose::STANDARD.encode(blob),
            file_sha256: sha256_hex(blob),
        }
    }
}
