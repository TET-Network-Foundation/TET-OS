//! `TmailEnvelopeV1` — Basic E2EE message envelope (spec §A.1.2 / §A.1.3).
//!
//! The envelope carries an end-to-end encrypted payload plus a hybrid (Ed25519 + ML-DSA-44)
//! signature binding the sender to the message. The signature pre-image follows §A.1.3 exactly so
//! that the UI signer and any verifying node agree byte-for-byte.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Stable `kind` discriminator for v1 envelopes.
pub const TMAIL_ENVELOPE_KIND: &str = "tmail_envelope_v1";
/// E2EE scheme identifier (spec §A.1.2 `e2ee.scheme`).
pub const TMAIL_E2EE_SCHEME: &str = "tet-e2ee-hybrid-v1";

#[derive(Debug, thiserror::Error)]
pub enum TmailEnvelopeError {
    #[error("unsupported tmail envelope version: {0}")]
    UnsupportedVersion(u32),
    #[error("unexpected envelope kind: {0}")]
    Kind(String),
    #[error(
        "unsupported flag in this build (time_lock/anonymous out of scope; basic+burn_after_read supported)"
    )]
    UnsupportedFlags,
    #[error(
        "burn block disagrees with the signed flags.burn_after_read, or sets an unsupported field"
    )]
    InconsistentBurnBlock,
    #[error("signer ed25519 pubkey must equal sender_wallet_id")]
    SignerMismatch,
    #[error("invalid wallet id (expected 64 lowercase hex chars)")]
    InvalidWalletId,
    #[error("invalid base64 encoding in field {field}")]
    Encoding { field: &'static str },
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
}

/// Feature flags (spec §A.1.2 `flags`). This build supports `basic`, optionally with
/// `burn_after_read` (S7-1); `time_lock` and `anonymous` are still rejected.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailFlags {
    pub basic: bool,
    #[serde(default)]
    pub time_lock: bool,
    #[serde(default)]
    pub burn_after_read: bool,
    #[serde(default)]
    pub anonymous: bool,
}

impl TmailFlags {
    /// Deterministic canonical encoding used inside the signature pre-image (§A.1.3 `flags`).
    fn canonical(&self) -> String {
        let b = |v: bool| if v { "1" } else { "0" };
        format!(
            "basic={},time_lock={},burn_after_read={},anonymous={}",
            b(self.basic),
            b(self.time_lock),
            b(self.burn_after_read),
            b(self.anonymous),
        )
    }
}

/// E2EE block (spec §A.1.2 `e2ee`). Mirrors the hybrid X25519 + CRYSTALS-Kyber-768 (Round-3) +
/// ChaCha20-Poly1305 scheme in `e2ee.rs`. The node treats this as an opaque blob — it never
/// decrypts.
///
/// **Not ML-KEM.** Kyber Round-3 is byte-incompatible with FIPS-203 ML-KEM-768. The `mlkem_*`
/// field names are legacy; migration is whitepaper §17.17.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailE2eeBlock {
    pub v: u32,
    pub scheme: String,
    pub client_ephemeral_pub_b64: String,
    pub client_mlkem_pub_b64: String,
    pub receiver_x25519_pub_b64: String,
    pub receiver_mlkem_pub_b64: String,
    pub mlkem_ciphertext_b64: String,
    pub nonce_b64: String,
    pub ciphertext_b64: String,
}

/// Hybrid signature block (spec §A.1.2 `hybrid_sig`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailHybridSig {
    pub ed25519_pubkey_hex: String,
    pub ed25519_sig_b64: String,
    pub mldsa_pubkey_b64: String,
    pub mldsa_sig_b64: String,
}

/// Anonymous-mode block (spec §A.1.2 `anonymous`). Out of scope for the Basic task; always `None`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailAnonymous {
    #[serde(default)]
    pub ring_proof_b64: Option<String>,
    #[serde(default)]
    pub stealth_addr: Option<String>,
}

/// Time-lock block (spec §A.1.2 `time_lock`). Out of scope for the Basic task; always `None`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailTimeLock {
    #[serde(default)]
    pub release_at_ms: u64,
    #[serde(default)]
    pub vdf_proof_b64: Option<String>,
}

/// Burn-after-read block (spec §A.1.2 `burn`).
///
/// **This block is not covered by the §A.1.3 signature pre-image** — only `flags` is (via
/// [`TmailFlags::canonical`]). It is therefore malleable in transit and MUST NOT decide behaviour.
/// [`verify_tmail_envelope_v1`] accepts it only when it is redundant with the signed flag, and
/// rejects `max_reads` outright; Phase 0 burn policy is exactly `on_read_receipt` (one read).
/// The signed `flags.burn_after_read` is the authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailBurn {
    #[serde(default)]
    pub burn_after_read: bool,
    #[serde(default)]
    pub max_reads: Option<u32>,
}

/// Tmail E2EE envelope (spec §A.1.2) — Basic, optionally burn-after-read.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailEnvelopeV1 {
    pub v: u32,
    pub kind: String,
    pub msg_id: String,
    pub flags: TmailFlags,
    pub sender_wallet_id: String,
    pub receiver_wallet_id: String,
    pub sent_at_ms: u64,
    /// `0` for basic (no time-lock). Bound into the signature pre-image regardless.
    #[serde(default)]
    pub release_at_ms: u64,
    pub ttl_ms: u64,
    #[serde(default)]
    pub fee_paid_micro: u64,
    #[serde(default)]
    pub pin_stake_micro: u64,
    pub e2ee: TmailE2eeBlock,
    pub hybrid_sig: TmailHybridSig,
    /// Optional feature blocks. `anonymous` and `time_lock` are always `None` in this build;
    /// `burn` may be present but carries no policy (see [`TmailBurn`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anonymous: Option<TmailAnonymous>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_lock: Option<TmailTimeLock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub burn: Option<TmailBurn>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plaintext_commitment_sha256: Option<String>,
}

impl TmailEnvelopeV1 {
    /// `payload_sha256` for §A.1.3: hex(SHA256(decoded ciphertext)) per Appendix F step 2.
    pub fn payload_sha256_hex(&self) -> Result<String, TmailEnvelopeError> {
        let ct = base64::engine::general_purpose::STANDARD
            .decode(self.e2ee.ciphertext_b64.trim().as_bytes())
            .map_err(|_| TmailEnvelopeError::Encoding {
                field: "e2ee.ciphertext_b64",
            })?;
        let mut h = Sha256::new();
        h.update(&ct);
        Ok(hex::encode(h.finalize()))
    }
}

fn is_wallet_id_64hex(s: &str) -> bool {
    let s = s.trim();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Build the hybrid-signature pre-image for a Tmail envelope (spec §A.1.3).
///
/// Format (exact, `|`-separated):
/// `tet tmail envelope v1|chain_id={}|genesis_hash={}|msg_id={}|flags={}|sender={}|receiver={}|release_at_ms={}|fee_micro={}|payload_sha256={}|mldsa_pk={}`
///
/// Mirrors `transfer_hybrid_auth_message_bytes` (wallet.rs): both the sender and receiver wallet ids
/// are lowercased, and `chain_id` / `genesis_hash` bind the message to this network.
pub fn tmail_envelope_auth_message_bytes(
    env: &TmailEnvelopeV1,
    mldsa_pubkey_b64: &str,
) -> Result<Vec<u8>, TmailEnvelopeError> {
    let payload_sha256 = env.payload_sha256_hex()?;
    let s = format!(
        "tet tmail envelope v1|chain_id={}|genesis_hash={}|msg_id={}|flags={}|sender={}|receiver={}|release_at_ms={}|fee_micro={}|payload_sha256={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        env.msg_id.trim(),
        env.flags.canonical(),
        env.sender_wallet_id.trim().to_ascii_lowercase(),
        env.receiver_wallet_id.trim().to_ascii_lowercase(),
        env.release_at_ms,
        env.fee_paid_micro,
        payload_sha256,
        mldsa_pubkey_b64.trim(),
    );
    Ok(s.into_bytes())
}

/// Verify a Tmail envelope's hybrid signature (spec §A.1.3).
///
/// Checks (in order):
/// 1. version / kind discriminators,
/// 2. flags are within this build's scope — `basic`, optionally plus `burn_after_read` (S7-1).
///    `time_lock` and `anonymous` remain out of scope,
/// 3. the unsigned `burn` block, if present, is redundant with the signed flag,
/// 4. sender/receiver wallet ids are well-formed 64-hex,
/// 5. signer `ed25519_pubkey_hex` equals `sender_wallet_id` (non-anonymous binding),
/// 6. hybrid (Ed25519 + ML-DSA-44) signature over the §A.1.3 pre-image.
///
/// Same pattern as `verify_envelope_v1`: both signatures must validate over identical bytes.
///
/// **Why burn needs no new signed field.** `flags.burn_after_read` is already inside the pre-image
/// through [`TmailFlags::canonical`], so enabling it here changes no signature format and
/// invalidates nothing already signed. The `burn` block is *not* in the pre-image, which is why it
/// may not carry policy — see [`TmailBurn`].
pub fn verify_tmail_envelope_v1(env: &TmailEnvelopeV1) -> Result<(), TmailEnvelopeError> {
    if env.v != 1 {
        return Err(TmailEnvelopeError::UnsupportedVersion(env.v));
    }
    if env.kind != TMAIL_ENVELOPE_KIND {
        return Err(TmailEnvelopeError::Kind(env.kind.clone()));
    }
    // S7-1 relaxes this gate for `burn_after_read` only. Everything else stays closed.
    if !env.flags.basic
        || env.flags.time_lock
        || env.flags.anonymous
        || env.anonymous.is_some()
        || env.time_lock.is_some()
    {
        return Err(TmailEnvelopeError::UnsupportedFlags);
    }
    // The burn block is unsigned (§A.1.3 covers `flags`, not `burn`). Accept it only when it adds
    // nothing the signature does not already cover, so a peer cannot flip burn policy in transit.
    if let Some(burn) = env.burn.as_ref()
        && (burn.burn_after_read != env.flags.burn_after_read || burn.max_reads.is_some())
    {
        return Err(TmailEnvelopeError::InconsistentBurnBlock);
    }

    let sender = env.sender_wallet_id.trim().to_ascii_lowercase();
    let receiver = env.receiver_wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&sender) || !is_wallet_id_64hex(&receiver) {
        return Err(TmailEnvelopeError::InvalidWalletId);
    }

    let signer = env
        .hybrid_sig
        .ed25519_pubkey_hex
        .trim()
        .to_ascii_lowercase();
    if signer != sender {
        return Err(TmailEnvelopeError::SignerMismatch);
    }

    let msg = tmail_envelope_auth_message_bytes(env, &env.hybrid_sig.mldsa_pubkey_b64)?;
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&env.hybrid_sig.ed25519_sig_b64),
        Some(&env.hybrid_sig.mldsa_pubkey_b64),
        Some(&env.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|e| TmailEnvelopeError::Signature(format!("{e:?}")))?;

    Ok(())
}
