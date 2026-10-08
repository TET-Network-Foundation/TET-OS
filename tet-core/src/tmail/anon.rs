//! Anonymous-membership registry (spec §A.4.3, Phase 0 gossip registry).
//!
//! A wallet publishes a commitment `C = SHA256("tet-anon-v1" ‖ secret)`, hybrid-signed by that
//! wallet. Nodes keep every registration they have seen, build a fixed-depth Merkle tree over them,
//! and a member proves in zero knowledge that their `C` is a leaf under the root — revealing only
//! that they are *one of* the registered wallets.
//!
//! # What this registry is and is not
//!
//! **Off-ledger.** Registrations gossip like Tmail envelopes; nothing touches a balance or a
//! `state_root`. Option 2 (a consensus registry with one canonical root) is Phase 1.
//!
//! **Node-local anonymity set.** A node can only prove membership against what it has seen, so the
//! set is "registrations your node knows", not "all registrations". Two nodes can hold different
//! sets and therefore different roots; that is why acceptance is a time window over recent roots
//! rather than a single value.
//!
//! **Free, therefore not sybil resistance.** Anyone can register any number of wallets. Membership
//! narrows a sender to a countable published set, which is strictly better than "anyone who can
//! invent a seed", but it does not make identities costly. That is the Phase 1 escrow.

use serde::{Deserialize, Serialize};

use crate::tmail::envelope::TmailHybridSig;

/// Locked disclosure for anonymous mode (spec §A.4.7). Served with every registry response and
/// shown in the UI. Do not soften it: the anonymity set on today's testnet really is small, and
/// registration really is free.
pub const TMAIL_ANON_DISCLOSURE: &str =
    "Anonymous among the registrations your node has seen - on today's testnet that set is small \
     and anonymity is correspondingly weak. Registration is free; sybil resistance arrives with \
     the Phase 1 escrow.";

/// Stable `kind` discriminator.
pub const TMAIL_ANON_REGISTRATION_KIND: &str = "tmail_anon_registration_v1";

#[derive(Debug, thiserror::Error)]
pub enum TmailAnonRegistrationError {
    #[error("unsupported registration version: {0}")]
    UnsupportedVersion(u32),
    #[error("unexpected registration kind: {0}")]
    Kind(String),
    #[error("invalid wallet id (expected 64 lowercase hex chars)")]
    InvalidWalletId,
    #[error("invalid commitment (expected 64 lowercase hex chars)")]
    InvalidCommitment,
    #[error("signer ed25519 pubkey must equal wallet_id")]
    SignerMismatch,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
}

/// A wallet's anonymity-set membership commitment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailAnonRegistrationV1 {
    pub v: u32,
    pub kind: String,
    /// 64-hex Ed25519 wallet id. The signer, and the registry key.
    pub wallet_id: String,
    /// 64-hex `SHA256("tet-anon-v1" ‖ secret)`. The secret never leaves the device.
    pub commitment_hex: String,
    pub registered_at_ms: u64,
    pub hybrid_sig: TmailHybridSig,
}

fn is_64hex(s: &str) -> bool {
    let s = s.trim();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Hybrid-signature pre-image.
///
/// Format (exact, `|`-separated):
/// `tet tmail anon registration v1|chain_id={}|genesis_hash={}|wallet_id={}|commitment={}|registered_at_ms={}|mldsa_pk={}`
///
/// Same shape and the same chain binding as every other Tmail pre-image, so a registration cannot
/// be replayed onto another network.
pub fn tmail_anon_registration_auth_message_bytes(
    reg: &TmailAnonRegistrationV1,
    mldsa_pubkey_b64: &str,
) -> Vec<u8> {
    format!(
        "tet tmail anon registration v1|chain_id={}|genesis_hash={}|wallet_id={}|commitment={}|registered_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        reg.wallet_id.trim().to_ascii_lowercase(),
        reg.commitment_hex.trim().to_ascii_lowercase(),
        reg.registered_at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// Verify a registration's hybrid signature.
///
/// The wallet signs its own commitment, so a registration cannot be forged for someone else's
/// wallet. It says nothing about whether the wallet *should* be in the set — registration is free,
/// by design, until the Phase 1 escrow.
pub fn verify_tmail_anon_registration_v1(
    reg: &TmailAnonRegistrationV1,
) -> Result<(), TmailAnonRegistrationError> {
    if reg.v != 1 {
        return Err(TmailAnonRegistrationError::UnsupportedVersion(reg.v));
    }
    if reg.kind != TMAIL_ANON_REGISTRATION_KIND {
        return Err(TmailAnonRegistrationError::Kind(reg.kind.clone()));
    }
    let wallet = reg.wallet_id.trim().to_ascii_lowercase();
    if !is_64hex(&wallet) {
        return Err(TmailAnonRegistrationError::InvalidWalletId);
    }
    if !is_64hex(&reg.commitment_hex) {
        return Err(TmailAnonRegistrationError::InvalidCommitment);
    }
    let signer = reg.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if signer != wallet {
        return Err(TmailAnonRegistrationError::SignerMismatch);
    }
    let msg = tmail_anon_registration_auth_message_bytes(reg, &reg.hybrid_sig.mldsa_pubkey_b64);
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&reg.hybrid_sig.ed25519_sig_b64),
        Some(&reg.hybrid_sig.mldsa_pubkey_b64),
        Some(&reg.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|e| TmailAnonRegistrationError::Signature(format!("{e:?}")))?;
    Ok(())
}

/// Empty-subtree hash at each level, so a sparse tree costs `O(members)` rather than `O(2^depth)`.
///
/// `E[0]` is the empty *leaf*; `E[k] = parent(E[k-1], E[k-1])`. Domain-separated from real leaves
/// so an empty slot can never be presented as a member commitment.
pub fn empty_subtree_hashes() -> [[u8; 32]; nexus_protocol::TET_ANON_MERKLE_DEPTH + 1] {
    use sha2::{Digest as _, Sha256};
    let mut out = [[0u8; 32]; nexus_protocol::TET_ANON_MERKLE_DEPTH + 1];
    let mut h = Sha256::new();
    h.update(b"tet-anon-empty-v1");
    out[0] = h.finalize().into();
    for d in 1..=nexus_protocol::TET_ANON_MERKLE_DEPTH {
        out[d] = nexus_protocol::tet_anon_merkle_parent_v1(&out[d - 1], &out[d - 1]);
    }
    out
}

/// A built tree: every level, so both the root and any member's authentication path come from one
/// construction rather than two that might disagree.
pub struct AnonMerkleTree {
    levels: Vec<Vec<[u8; 32]>>,
    empties: [[u8; 32]; nexus_protocol::TET_ANON_MERKLE_DEPTH + 1],
    leaf_count: usize,
}

impl AnonMerkleTree {
    /// Build from leaves in their canonical order.
    ///
    /// Leaf order **is** the index, so the ordering must be deterministic across nodes or two nodes
    /// with identical registrations would compute different roots. Callers supply leaves sorted by
    /// wallet id; see [`crate::tmail::store::TmailStore::anon_leaves`].
    pub fn build(leaves: Vec<[u8; 32]>) -> Self {
        let empties = empty_subtree_hashes();
        let leaf_count = leaves.len();
        let mut levels: Vec<Vec<[u8; 32]>> = Vec::with_capacity(
            nexus_protocol::TET_ANON_MERKLE_DEPTH + 1,
        );
        levels.push(leaves);
        for d in 0..nexus_protocol::TET_ANON_MERKLE_DEPTH {
            let cur = &levels[d];
            let mut next = Vec::with_capacity(cur.len().div_ceil(2));
            let mut i = 0usize;
            while i < cur.len() {
                let l = cur[i];
                let r = if i + 1 < cur.len() {
                    cur[i + 1]
                } else {
                    empties[d]
                };
                next.push(nexus_protocol::tet_anon_merkle_parent_v1(&l, &r));
                i += 2;
            }
            levels.push(next);
        }
        Self {
            levels,
            empties,
            leaf_count,
        }
    }

    /// Root of the fixed-depth tree. An empty registry has the all-empty root, which is a valid
    /// value rather than an error — a node with no registrations simply has an anonymity set of
    /// zero and can verify nothing.
    pub fn root(&self) -> [u8; 32] {
        self.levels[nexus_protocol::TET_ANON_MERKLE_DEPTH]
            .first()
            .copied()
            .unwrap_or(self.empties[nexus_protocol::TET_ANON_MERKLE_DEPTH])
    }

    /// Authentication path for a leaf index, always exactly `TET_ANON_MERKLE_DEPTH` long.
    pub fn path(&self, index: usize) -> Option<Vec<[u8; 32]>> {
        if index >= self.leaf_count {
            return None;
        }
        let mut siblings = Vec::with_capacity(nexus_protocol::TET_ANON_MERKLE_DEPTH);
        let mut i = index;
        for d in 0..nexus_protocol::TET_ANON_MERKLE_DEPTH {
            let level = &self.levels[d];
            let sib = i ^ 1;
            siblings.push(level.get(sib).copied().unwrap_or(self.empties[d]));
            i >>= 1;
        }
        Some(siblings)
    }
}

/// Verify an anonymous envelope's proof, given the pulled receipt bytes, and produce a verdict.
///
/// This is **phase two** of announce-then-pull. Phase one (`verify_tmail_envelope_v1`) already
/// established that the journal describes this envelope; it could not check the proof, because the
/// proof is ~250 KiB and does not fit in a gossip message.
///
/// Checks, in order, cheapest first:
///
/// 1. the receipt's SHA-256 matches what the envelope announced — so a peer cannot serve a
///    different receipt, and this costs one hash rather than a verification;
/// 2. the receipt verifies against the image id, and its journal is byte-identical to the
///    announced one;
/// 3. the journal's `merkle_root` is a root this node accepts (epoch window + bucket bound);
/// 4. the nullifier has not been used by a different message.
///
/// Order matters: 1 and 2 are the integrity of what we were handed, 3 and 4 are policy. Running
/// policy first would let a peer make us do registry work on a receipt that was never valid.
pub fn verify_anonymous_proof(
    store: &crate::tmail::store::TmailStore,
    env: &crate::tmail::envelope::TmailEnvelopeV1,
    receipt_bytes: &[u8],
) -> crate::tmail::store::AnonVerdict {
    use base64::Engine as _;
    use sha2::{Digest as _, Sha256};

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let fail = |reason: &str| crate::tmail::store::AnonVerdict::Failed {
        reason: reason.to_string(),
        failed_at_ms: now,
    };

    let Some(anon) = env.anonymous.as_ref() else {
        return fail("not an anonymous envelope");
    };

    // 1. content address
    let actual = hex::encode(Sha256::digest(receipt_bytes));
    if !actual.eq_ignore_ascii_case(anon.anchor_proof.receipt_sha256_hex.trim()) {
        return fail("receipt hash does not match the announced receipt_sha256_hex");
    }

    // 2. the proof itself
    let Ok(image_id) = decode_image_id_hex(&anon.anchor_proof.image_id_hex) else {
        return fail("malformed image_id_hex");
    };
    // The receipt must come from TET's own membership program: a valid receipt from any other
    // program proves nothing about membership. Checked before any proof work.
    if !anon_program_accepted(&image_id) {
        return fail(&format!(
            "proof from an unrecognised proving program (image id {})",
            encode_image_id_hex(&image_id)
        ));
    }
    let receipt_b64 = base64::engine::general_purpose::STANDARD.encode(receipt_bytes);
    let verified = match crate::zk_verifier::verify_tx_receipt_and_journal(
        image_id,
        anon.anchor_proof.journal_b64.trim(),
        &receipt_b64,
    ) {
        Ok(v) => v,
        Err(e) => return fail(&format!("receipt verification failed: {e}")),
    };
    let journal = match verified {
        crate::zk_verifier::VerifiedZkJournal::TmailAnon(j) => j,
        _ => return fail("receipt proves a different claim than anonymous membership"),
    };

    // 3. is the root one we accept?
    let bucket = nexus_protocol::tmail_bucket_index_v1(env.sent_at_ms);
    if !store.accepts_anon_root(&journal.merkle_root, bucket) {
        return fail("registry root not recognised, or outside the acceptance window");
    }

    // 4. replay
    let nullifier_hex = hex::encode(journal.nullifier);
    match store.claim_anon_nullifier(&nullifier_hex, env.msg_id.trim()) {
        Ok(true) => {}
        Ok(false) => return fail("nullifier already used by another message (replay)"),
        Err(e) => return fail(&format!("nullifier store error: {e}")),
    }

    crate::tmail::store::AnonVerdict::Verified {
        nullifier_hex,
        verified_at_ms: now,
    }
}

/// `image_id_hex` is 8 little-endian `u32` words, 64 hex chars.
fn decode_image_id_hex(s: &str) -> Result<[u32; 8], ()> {
    let bytes = hex::decode(s.trim()).map_err(|_| ())?;
    if bytes.len() != 32 {
        return Err(());
    }
    let mut out = [0u32; 8];
    for (i, w) in out.iter_mut().enumerate() {
        *w = u32::from_le_bytes([
            bytes[i * 4],
            bytes[i * 4 + 1],
            bytes[i * 4 + 2],
            bytes[i * 4 + 3],
        ]);
    }
    Ok(out)
}

/// Render an image id as the hex the envelope carries.
pub fn encode_image_id_hex(id: &[u32; 8]) -> String {
    let mut bytes = Vec::with_capacity(32);
    for w in id {
        bytes.extend_from_slice(&w.to_le_bytes());
    }
    hex::encode(bytes)
}

/// When does this wallet's registration become provable on this node?
///
/// `None` means it already is. `Some(ms)` is the epoch boundary at which it will be — deterministic,
/// so the UI shows seconds remaining instead of guessing.
pub fn registration_eligible_at_ms(
    store: &crate::tmail::store::TmailStore,
    wallet_id: &str,
) -> Option<u64> {
    if store.anon_leaf_index(wallet_id).is_some() {
        return None;
    }
    let stored = store.get_stored_anon(wallet_id)?;
    let epoch_ms = crate::tmail::store::TmailStore::anon_epoch_ms_public();
    let admitted_epoch = stored.admitted_at_ms / epoch_ms;
    Some((admitted_epoch + 1) * epoch_ms)
}

/// The anonymous-membership proving programs this node accepts, as `encode_image_id_hex` strings.
///
/// Pinned, not taken from the build: the seeds build without the guest (`RISC0_SKIP_BUILD=1`), so
/// their `methods::NEXUS_GUEST_ID` is a stub. The entry is the membership program as built from this
/// repository (the image id the prover returns). Changing the guest means adding its id here; the
/// `zk-real` workflow fails if a real-guest build produces an id that isn't listed.
pub const ANON_GUEST_IMAGE_IDS: &[&str] = &["fb25a2eb80df841a7191f025a46bf19a93bc19a228998d7bb4ea4c85bf1d49b5"];

/// Is `id` a membership program this node accepts: a pinned id, this build's own real guest (never
/// the all-zero stub of a guest-less build), or one the operator added in
/// `TET_ANON_ACCEPTED_IMAGE_IDS` (comma-separated)?
pub fn anon_program_accepted(id: &[u32; 8]) -> bool {
    let h = encode_image_id_hex(id);
    if ANON_GUEST_IMAGE_IDS.iter().any(|x| x.eq_ignore_ascii_case(&h)) {
        return true;
    }
    if methods::NEXUS_GUEST_ID.iter().any(|w| *w != 0) && *id == methods::NEXUS_GUEST_ID {
        return true;
    }
    std::env::var("TET_ANON_ACCEPTED_IMAGE_IDS")
        .map(|v| v.split(',').any(|x| x.trim().eq_ignore_ascii_case(&h)))
        .unwrap_or(false)
}

