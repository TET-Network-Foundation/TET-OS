//! Tmail key directory — receiver KEM public-key registration (spec §A.1.4).
//!
//! A sender needs the receiver's X25519 + ML-KEM-768 public keys to build the E2EE block. Wallets
//! publish them via `PUT /tmail/keys/:wallet_id` (or `POST /tmail/keys/register`), authenticated by
//! a hybrid (Ed25519 + ML-DSA) signature over a dedicated preimage — no admin token. Storage lives
//! in [`crate::tmail::store::TmailStore`].

use serde::{Deserialize, Serialize};

use crate::tmail::envelope::TmailHybridSig;

#[derive(Debug, thiserror::Error)]
pub enum TmailKeyError {
    #[error("invalid wallet id (expected 64 lowercase hex chars)")]
    InvalidWalletId,
    #[error("missing x25519/mlkem public key")]
    MissingKey,
    #[error("signer ed25519 pubkey must equal wallet_id")]
    SignerMismatch,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
}

/// Receiver KEM public-key registration (spec §A.1.4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailKeyRegistrationV1 {
    pub wallet_id: String,
    pub x25519_pub_b64: String,
    pub mlkem_pub_b64: String,
    pub registered_at_ms: u64,
    pub hybrid_sig: TmailHybridSig,
}

fn is_wallet_id_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Hybrid-signature preimage for a key registration.
///
/// Format (exact, `|`-separated):
/// `tet tmail key v1|chain_id={}|genesis_hash={}|wallet_id={}|x25519_pub={}|mlkem_pub={}|registered_at_ms={}|mldsa_pk={}`
pub fn tmail_key_registration_auth_message_bytes(
    reg: &TmailKeyRegistrationV1,
    mldsa_pubkey_b64: &str,
) -> Vec<u8> {
    format!(
        "tet tmail key v1|chain_id={}|genesis_hash={}|wallet_id={}|x25519_pub={}|mlkem_pub={}|registered_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        reg.wallet_id.trim().to_ascii_lowercase(),
        reg.x25519_pub_b64.trim(),
        reg.mlkem_pub_b64.trim(),
        reg.registered_at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// Verify a key registration's hybrid signature (same pattern as `verify_tmail_envelope_v1`).
///
/// The Ed25519 signer must equal `wallet_id` — a wallet may only register its own keys.
pub fn verify_tmail_key_registration_v1(reg: &TmailKeyRegistrationV1) -> Result<(), TmailKeyError> {
    let wallet = reg.wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&wallet) {
        return Err(TmailKeyError::InvalidWalletId);
    }
    if reg.x25519_pub_b64.trim().is_empty() || reg.mlkem_pub_b64.trim().is_empty() {
        return Err(TmailKeyError::MissingKey);
    }
    let signer = reg.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if signer != wallet {
        return Err(TmailKeyError::SignerMismatch);
    }
    let msg = tmail_key_registration_auth_message_bytes(reg, &reg.hybrid_sig.mldsa_pubkey_b64);
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&reg.hybrid_sig.ed25519_sig_b64),
        Some(&reg.hybrid_sig.mldsa_pubkey_b64),
        Some(&reg.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|e| TmailKeyError::Signature(format!("{e:?}")))?;
    Ok(())
}
