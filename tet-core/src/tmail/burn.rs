//! Burn-after-read revoke protocol (spec §A.3.2 Layer 1).
//!
//! When a receiver reads a burn-flagged message it emits a `tmail_burn_revoke_v1` on the same
//! `/tet/v1/tmail` gossip topic. Cooperating nodes drop the ciphertext from their store and stop
//! re-propagating it.
//!
//! **What this is not.** §A.3.2 Layer 3 is explicit and locked (decision #2): this is a
//! *best-effort* network burn, not cryptographic irrecoverability. A non-cooperating peer can keep
//! the ciphertext, and nothing here prevents that. The UI must say so.
//!
//! **Authorization.** A revoke is honoured only when all three hold:
//! 1. its hybrid signature verifies and the signer equals `reader_wallet_id`,
//! 2. the target message is in this node's store and its **signed** `flags.burn_after_read` is set,
//! 3. the signer is the target's sender **or** its receiver.
//!
//! Point 2 is what keeps this from becoming a deletion primitive for ordinary mail: without it,
//! either party could erase any message they were involved in from every node on the network.
//! Burn power exists only where the sender signed up for it.

use serde::{Deserialize, Serialize};

use crate::tmail::envelope::{TmailEnvelopeV1, TmailHybridSig};
use crate::tmail::store::TmailStore;

/// Stable `kind` discriminator (spec §A.3.2, Appendix B gossip registry).
pub const TMAIL_BURN_REVOKE_KIND: &str = "tmail_burn_revoke_v1";

#[derive(Debug, thiserror::Error)]
pub enum TmailBurnRevokeError {
    #[error("unsupported burn revoke version: {0}")]
    UnsupportedVersion(u32),
    #[error("unexpected revoke kind: {0}")]
    Kind(String),
    #[error("empty msg_id")]
    EmptyMsgId,
    #[error("invalid wallet id (expected 64 lowercase hex chars)")]
    InvalidWalletId,
    #[error("signer ed25519 pubkey must equal reader_wallet_id")]
    SignerMismatch,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
    #[error("target message is not burn-after-read; it cannot be revoked")]
    NotBurnable,
    #[error("revoke signer is neither the sender nor the receiver of this message")]
    NotAParty,
    #[error("store error: {0}")]
    Store(String),
}

/// Read receipt / burn revoke (spec §A.3.2 Layer 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailBurnRevokeV1 {
    pub v: u32,
    pub kind: String,
    pub msg_id: String,
    pub reader_wallet_id: String,
    pub read_at_ms: u64,
    pub hybrid_sig: TmailHybridSig,
}

fn is_wallet_id_64hex(s: &str) -> bool {
    let s = s.trim();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Hybrid-signature pre-image for a burn revoke.
///
/// Format (exact, `|`-separated):
/// `tet tmail burn revoke v1|chain_id={}|genesis_hash={}|msg_id={}|reader={}|read_at_ms={}|mldsa_pk={}`
///
/// Same shape as `tmail_envelope_auth_message_bytes` / `tmail_key_registration_auth_message_bytes`,
/// including the `chain_id` + `genesis_hash` binding that keeps a revoke from replaying onto
/// another network.
pub fn tmail_burn_revoke_auth_message_bytes(
    rev: &TmailBurnRevokeV1,
    mldsa_pubkey_b64: &str,
) -> Vec<u8> {
    format!(
        "tet tmail burn revoke v1|chain_id={}|genesis_hash={}|msg_id={}|reader={}|read_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        rev.msg_id.trim(),
        rev.reader_wallet_id.trim().to_ascii_lowercase(),
        rev.read_at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// Verify a revoke's own hybrid signature. Proves **who signed**, not whether they may burn.
///
/// Authorization against the target message is [`authorize_burn_revoke`] — the two are separate
/// because the signature can be checked without the store, and a node that does not hold the
/// message cannot authorize at all.
pub fn verify_tmail_burn_revoke_v1(rev: &TmailBurnRevokeV1) -> Result<(), TmailBurnRevokeError> {
    if rev.v != 1 {
        return Err(TmailBurnRevokeError::UnsupportedVersion(rev.v));
    }
    if rev.kind != TMAIL_BURN_REVOKE_KIND {
        return Err(TmailBurnRevokeError::Kind(rev.kind.clone()));
    }
    if rev.msg_id.trim().is_empty() {
        return Err(TmailBurnRevokeError::EmptyMsgId);
    }
    let reader = rev.reader_wallet_id.trim().to_ascii_lowercase();
    if !is_wallet_id_64hex(&reader) {
        return Err(TmailBurnRevokeError::InvalidWalletId);
    }
    let signer = rev.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if signer != reader {
        return Err(TmailBurnRevokeError::SignerMismatch);
    }
    let msg = tmail_burn_revoke_auth_message_bytes(rev, &rev.hybrid_sig.mldsa_pubkey_b64);
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&rev.hybrid_sig.ed25519_sig_b64),
        Some(&rev.hybrid_sig.mldsa_pubkey_b64),
        Some(&rev.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|e| TmailBurnRevokeError::Signature(format!("{e:?}")))?;
    Ok(())
}

/// May this (already signature-verified) revoke burn this message?
///
/// Sender **or** receiver, and only for a message whose signed flag opted into burning.
pub fn authorize_burn_revoke(
    rev: &TmailBurnRevokeV1,
    target: &TmailEnvelopeV1,
) -> Result<(), TmailBurnRevokeError> {
    if !target.flags.burn_after_read {
        return Err(TmailBurnRevokeError::NotBurnable);
    }
    let reader = rev.reader_wallet_id.trim().to_ascii_lowercase();
    let sender = target.sender_wallet_id.trim().to_ascii_lowercase();
    let receiver = target.receiver_wallet_id.trim().to_ascii_lowercase();
    if reader != sender && reader != receiver {
        return Err(TmailBurnRevokeError::NotAParty);
    }
    Ok(())
}

/// What happened to a revoke on this node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BurnRevokeOutcome {
    /// Ciphertext removed from this node's store.
    Burned { msg_id: String },
    /// Already burned here (tombstoned) — idempotent no-op.
    AlreadyBurned { msg_id: String },
    /// This node does not hold the message, so it cannot authorize the revoke.
    ///
    /// Deliberately **not** tombstoned. A tombstone written on an unverifiable revoke would let
    /// anyone pre-block delivery of any `msg_id` they can guess, so an unknown message is simply
    /// dropped. The cost is the narrow race where a revoke outruns its own message; the message
    /// then survives here until its TTL. Read receipts are emitted after delivery, so the message
    /// normally arrives first.
    UnknownMessage { msg_id: String },
}

/// Verify, authorize and apply a burn revoke against the node-local store.
///
/// Shared by the gossip receive path and `POST /tmail/read-receipt` so both enforce identically —
/// the S4 lesson from `handle_tx_broadcast`, where the receive path was weaker than REST.
pub fn apply_burn_revoke(
    store: &TmailStore,
    rev: &TmailBurnRevokeV1,
) -> Result<BurnRevokeOutcome, TmailBurnRevokeError> {
    verify_tmail_burn_revoke_v1(rev)?;
    let msg_id = rev.msg_id.trim().to_string();

    let Some(target) = store.get_by_msg_id(&msg_id) else {
        if store.is_burned(&msg_id) {
            return Ok(BurnRevokeOutcome::AlreadyBurned { msg_id });
        }
        return Ok(BurnRevokeOutcome::UnknownMessage { msg_id });
    };
    authorize_burn_revoke(rev, &target)?;
    store
        .delete_by_msg_id(&msg_id)
        .map_err(|e| TmailBurnRevokeError::Store(format!("{e}")))?;
    Ok(BurnRevokeOutcome::Burned { msg_id })
}
