//! Tmail key directory — receiver KEM public-key registration (spec §A.1.4).
//!
//! A sender needs the receiver's X25519 + Kyber-768 (Round-3) public keys to build the E2EE
//! block. The `mlkem_*` names are legacy; the algorithm is not ML-KEM (WP §17.17). Wallets
//! publish them via `PUT /tmail/keys/:wallet_id` (or `POST /tmail/keys/register`), authenticated by
//! a hybrid (Ed25519 + ML-DSA) signature over a dedicated preimage — no admin token. Storage lives
//! in [`crate::tmail::store::TmailStore`].
//!
//! **Only v2 is accepted** (2026-10-11): the pre-image is PAE-encoded (length-prefixed fields under
//! the domain [`TMAIL_KEY_PAE_DOMAIN`], the agent payloads' encoding), so no field can be shifted
//! into another. A registration without `v: 2` — the older `|`-joined pre-image, or one stored
//! before signatures were checked — is refused here, and pages refuse to encrypt to it: the owner
//! re-registers by opening TET once. Pages verify the signature themselves before encrypting
//! (`tet-network/ui/app/lib/tmail_keys.ts` `verifyTmailKeyRegistration`), so a node that served
//! someone else's keys for a wallet is caught: it can't sign as that wallet.

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
    #[error("an older key registration (not v2): re-register by opening TET once")]
    Legacy,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
}

/// The PAE domain of a key registration's pre-image (v2).
pub const TMAIL_KEY_PAE_DOMAIN: &str = "tet tmail key v2";

/// Receiver KEM public-key registration (spec §A.1.4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailKeyRegistrationV1 {
    /// Pre-image version: only `2` is accepted (absent = an older, refused registration).
    #[serde(default)]
    pub v: u32,
    pub wallet_id: String,
    pub x25519_pub_b64: String,
    pub mlkem_pub_b64: String,
    pub registered_at_ms: u64,
    pub hybrid_sig: TmailHybridSig,
}

fn is_wallet_id_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Hybrid-signature pre-image for a key registration (v2): PAE under [`TMAIL_KEY_PAE_DOMAIN`] of
/// `chain_id, genesis_hash, wallet_id, x25519_pub_b64, mlkem_pub_b64, registered_at_ms (decimal),
/// mldsa_pk_b64`. Byte-exact with the page's `tmailKeyRegistrationAuthMessageBytes`.
pub fn tmail_key_registration_auth_message_bytes(
    reg: &TmailKeyRegistrationV1,
    mldsa_pubkey_b64: &str,
) -> Vec<u8> {
    let chain = crate::genesis::chain_id_from_env();
    let genesis = crate::genesis::expected_genesis_hash_from_env();
    let wallet = reg.wallet_id.trim().to_ascii_lowercase();
    let at = reg.registered_at_ms.to_string();
    crate::agent::pae(
        TMAIL_KEY_PAE_DOMAIN,
        &[
            chain.as_bytes(),
            genesis.as_bytes(),
            wallet.as_bytes(),
            reg.x25519_pub_b64.trim().as_bytes(),
            reg.mlkem_pub_b64.trim().as_bytes(),
            at.as_bytes(),
            mldsa_pubkey_b64.trim().as_bytes(),
        ],
    )
}

/// Verify a key registration's hybrid signature (same pattern as `verify_tmail_envelope_v1`).
///
/// The Ed25519 signer must equal `wallet_id` — a wallet may only register its own keys.
pub fn verify_tmail_key_registration_v1(reg: &TmailKeyRegistrationV1) -> Result<(), TmailKeyError> {
    if reg.v != 2 {
        return Err(TmailKeyError::Legacy);
    }
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
