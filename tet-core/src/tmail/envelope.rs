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
    #[error("flags.time_lock requires release_at_ms strictly after sent_at_ms")]
    InvalidReleaseTime,
    #[error("release_at_ms must be 0 unless flags.time_lock is set")]
    UnexpectedReleaseTime,
    #[error(
        "time_lock block disagrees with the signed release_at_ms, or carries a VDF proof (Phase 0.1)"
    )]
    InconsistentTimeLockBlock,
    #[error("anonymous envelope requires sender_wallet_id = ANONYMOUS_SENTINEL and an anonymous block")]
    MalformedAnonymous,
    #[error("anonymous envelope signer must equal anonymous.ephemeral_wallet_id")]
    EphemeralSignerMismatch,
    #[error("anchor proof journal disagrees with the envelope: {0}")]
    InconsistentAnchorProof(&'static str),
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

/// `sender_wallet_id` for an anonymous envelope (spec §A.1.2).
///
/// Not a wallet id and deliberately not 64-hex, so it can never collide with a real one or be
/// mistaken for a lookup key.
pub const ANONYMOUS_SENTINEL: &str = "anonymous";

/// The anchor proof carried by an anonymous envelope — **metadata only, ~300 bytes**.
///
/// The receipt itself is **not** here. A real receipt is ~335 KiB base64 against a 128 KiB gossip
/// ceiling (`p2p.rs`), so the envelope announces the proof and the receiver pulls it
/// (`/tet/v1/anon-receipt`). `receipt_sha256_hex` is what makes the pull safe: the receipt is
/// content-addressed, so any peer may serve it and a wrong one is detected before it is verified.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailAnchorProof {
    /// Guest image id the receipt must verify against, as 8 little-endian u32 words in hex.
    pub image_id_hex: String,
    /// The risc0 journal (268 bytes), base64. Carries root, nullifier, ephemeral, receiver, bucket.
    pub journal_b64: String,
    /// SHA-256 of the serialized receipt, hex. The pull key.
    pub receipt_sha256_hex: String,
}

/// Anonymous-mode block (spec §A.1.2 `anonymous`).
///
/// **Not covered by the §A.1.3 pre-image** — like the `burn` and `time_lock` blocks. It is not left
/// unchecked, though: [`verify_tmail_envelope_v1`] requires the journal to agree with the
/// ephemeral, the receiver and the bucket, and the envelope signature is made by the ephemeral key
/// itself. Swapping this block for another *valid* proof therefore requires a valid proof **for the
/// same ephemeral, receiver and bucket**, which only the member holding that secret can produce.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailAnonymous {
    /// 64-hex Ed25519 key that signs this envelope. The anchor is nowhere in it.
    pub ephemeral_wallet_id: String,
    /// The membership proof. `None` marks a **fast post** (docs/plans/FAST_ANON_POSTING.md): no
    /// proof of its own; it is accepted only if this ephemeral (the member's posting key for this
    /// board and UTC day) was registered by an earlier post whose proof verified. A post that
    /// carries a proof is judged by that proof alone and never falls back to the fast path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_proof: Option<TmailAnchorProof>,
}

/// Time-lock block (spec §A.1.2 `time_lock`).
///
/// **Not covered by the §A.1.3 signature pre-image** — but the top-level `release_at_ms` *is*, so
/// the schedule itself is signed and this block is redundant. Same rule as [`TmailBurn`]: accepted
/// only when it restates the signed value, and `vdf_proof_b64` is rejected outright because the VDF
/// path is Phase 0.1 (spec §A.2.3, locked decision #1) and must not look supported.
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
/// 2. flags are within this build's scope — `basic`, optionally plus `burn_after_read` (S7-1)
///    and/or `time_lock` (S7-2). `anonymous` remains out of scope,
/// 3. the schedule is coherent: `release_at_ms` is set iff `flags.time_lock` is,
/// 4. the unsigned `burn` / `time_lock` blocks, if present, are redundant with the signed fields,
/// 5. sender/receiver wallet ids are well-formed 64-hex,
/// 6. signer `ed25519_pubkey_hex` equals `sender_wallet_id` (non-anonymous binding),
/// 7. hybrid (Ed25519 + ML-DSA-44) signature over the §A.1.3 pre-image.
///
/// Same pattern as `verify_envelope_v1`: both signatures must validate over identical bytes.
///
/// **Why neither feature needs a new signed field.** `flags.burn_after_read`, `flags.time_lock` and
/// `release_at_ms` are all already inside the pre-image (`TmailFlags::canonical`, and
/// `release_at_ms` as its own field), so enabling them changes no signature format and invalidates
/// nothing already signed. The `burn` and `time_lock` *blocks* are not in the pre-image, which is
/// why they may not carry policy — see [`TmailBurn`] and [`TmailTimeLock`].
pub fn verify_tmail_envelope_v1(env: &TmailEnvelopeV1) -> Result<(), TmailEnvelopeError> {
    if env.v != 1 {
        return Err(TmailEnvelopeError::UnsupportedVersion(env.v));
    }
    if env.kind != TMAIL_ENVELOPE_KIND {
        return Err(TmailEnvelopeError::Kind(env.kind.clone()));
    }
    // S7-1 opened `burn_after_read`, S7-2 `time_lock`, S8 `anonymous`. `basic` is still required:
    // every envelope is a Basic E2EE envelope with features layered on, never instead of.
    if !env.flags.basic {
        return Err(TmailEnvelopeError::UnsupportedFlags);
    }
    // The flag and the block must agree. A flag with no block has no proof to check; a block with
    // no flag is a proof nothing consults.
    if env.flags.anonymous != env.anonymous.is_some() {
        return Err(TmailEnvelopeError::MalformedAnonymous);
    }
    // The schedule must be coherent with the flag, both of which are signed. A `release_at_ms`
    // without the flag would be a signed value the node ignores; the flag without a future
    // `release_at_ms` would present as "scheduled" while releasing immediately. Both mislead the
    // receiver, so both are refused rather than normalised.
    if env.flags.time_lock {
        if env.release_at_ms <= env.sent_at_ms {
            return Err(TmailEnvelopeError::InvalidReleaseTime);
        }
    } else if env.release_at_ms != 0 {
        return Err(TmailEnvelopeError::UnexpectedReleaseTime);
    }
    if let Some(tl) = env.time_lock.as_ref()
        && (tl.release_at_ms != env.release_at_ms || tl.vdf_proof_b64.is_some())
    {
        return Err(TmailEnvelopeError::InconsistentTimeLockBlock);
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
    if !is_wallet_id_64hex(&receiver) {
        return Err(TmailEnvelopeError::InvalidWalletId);
    }
    let signer = env
        .hybrid_sig
        .ed25519_pubkey_hex
        .trim()
        .to_ascii_lowercase();

    if let Some(anon) = env.anonymous.as_ref() {
        // Anonymous: the sender field is the sentinel and the SIGNER is the ephemeral. The anchor
        // appears nowhere, which is the entire point.
        if sender != ANONYMOUS_SENTINEL {
            return Err(TmailEnvelopeError::MalformedAnonymous);
        }
        let ephemeral = anon.ephemeral_wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&ephemeral) {
            return Err(TmailEnvelopeError::InvalidWalletId);
        }
        if signer != ephemeral {
            return Err(TmailEnvelopeError::EphemeralSignerMismatch);
        }
        // A post with a proof must be consistent with it. A fast post (no proof) is structurally
        // just a signed anonymous envelope here; the store accepts it only for a registered key.
        if let Some(proof) = anon.anchor_proof.as_ref() {
            verify_anchor_proof_consistency(env, proof, &ephemeral, &receiver)?;
        }
    } else {
        // Named: the signer is the sender.
        if !is_wallet_id_64hex(&sender) {
            return Err(TmailEnvelopeError::InvalidWalletId);
        }
        if signer != sender {
            return Err(TmailEnvelopeError::SignerMismatch);
        }
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

/// The nullifier an anonymous envelope's announced journal carries, as lowercase hex.
///
/// `None` for a non-anonymous envelope or a journal that does not decode. This reads the
/// **announced** journal, not a verified one: callers that need the proof checked use
/// [`crate::tmail::anon::verify_anonymous_proof`]. The store uses it only to group mail, which a
/// forged value cannot abuse beyond the per-receiver anonymous cap.
pub fn anonymous_nullifier_hex(env: &TmailEnvelopeV1) -> Option<String> {
    // A fast post carries no journal: its nullifier is its posting key's registration's.
    let proof = env.anonymous.as_ref()?.anchor_proof.as_ref()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(proof.journal_b64.trim().as_bytes())
        .ok()?;
    let journal: nexus_protocol::TmailAnonMembershipV1 =
        risc0_zkvm::serde::from_slice(&bytes).ok()?;
    (journal.journal_kind == nexus_protocol::TMAIL_ANON_JOURNAL_KIND)
        .then(|| hex::encode(journal.nullifier))
}

/// Check that the announced journal actually describes **this** envelope.
///
/// The receipt is pulled later; this runs on the metadata alone and is what makes deferring the
/// pull safe. Every check binds values already present, so a mismatched journal is rejected before
/// any network fetch happens.
///
/// It deliberately does **not** verify the receipt — that needs the ~335 KiB body, which is the
/// whole reason for announce-then-pull. A message that passes this is *proof pending*, never
/// verified.
fn verify_anchor_proof_consistency(
    env: &TmailEnvelopeV1,
    proof: &TmailAnchorProof,
    ephemeral: &str,
    receiver: &str,
) -> Result<(), TmailEnvelopeError> {
    let journal_bytes = base64::engine::general_purpose::STANDARD
        .decode(proof.journal_b64.trim().as_bytes())
        .map_err(|_| TmailEnvelopeError::Encoding {
            field: "anonymous.anchor_proof.journal_b64",
        })?;
    let journal: nexus_protocol::TmailAnonMembershipV1 =
        risc0_zkvm::serde::from_slice(&journal_bytes)
            .map_err(|_| TmailEnvelopeError::InconsistentAnchorProof("journal does not decode"))?;

    if journal.journal_kind != nexus_protocol::TMAIL_ANON_JOURNAL_KIND {
        return Err(TmailEnvelopeError::InconsistentAnchorProof("wrong journal kind"));
    }
    let eph_bytes = hex::decode(ephemeral)
        .ok()
        .and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok())
        .ok_or(TmailEnvelopeError::InvalidWalletId)?;
    if journal.ephemeral_pubkey_bytes != eph_bytes {
        return Err(TmailEnvelopeError::InconsistentAnchorProof(
            "journal ephemeral does not match the signer",
        ));
    }
    let rx_bytes = hex::decode(receiver)
        .ok()
        .and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok())
        .ok_or(TmailEnvelopeError::InvalidWalletId)?;
    if journal.receiver_wallet_bytes != rx_bytes {
        return Err(TmailEnvelopeError::InconsistentAnchorProof(
            "journal receiver does not match the envelope",
        ));
    }
    // The bucket comes from the envelope's own `sent_at_ms`, so one proof authorises one
    // (member, receiver, 24 h) window and cannot be carried into the next day.
    if journal.bucket_index != nexus_protocol::tmail_bucket_index_v1(env.sent_at_ms) {
        return Err(TmailEnvelopeError::InconsistentAnchorProof(
            "journal bucket does not match sent_at_ms",
        ));
    }
    if hex::decode(proof.receipt_sha256_hex.trim())
        .map(|b| b.len() != 32)
        .unwrap_or(true)
    {
        return Err(TmailEnvelopeError::InconsistentAnchorProof(
            "receipt_sha256_hex must be 32 bytes of hex",
        ));
    }
    Ok(())
}
