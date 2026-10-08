//! Members-only anonymous polls: per-poll member roots (docs/plans/MEMBERS_POLL.md, option A).
//!
//! A poll has its own wallet; ballots are anonymous Tmail envelopes to it. For a members-only poll
//! the creator lists the eligible members' **wallet ids**, signed by the **poll's own wallet**. The
//! node builds the root itself: the same depth-20 tree as the anonymity registry (`AnonMerkleTree`)
//! over those members' commitments **from its own registry** (ordered by wallet id), refusing the
//! list if any of them isn't registered. The node then accepts a ballot to that poll whose
//! membership proof is against that root, for that poll's UTC day only.
//!
//! - **Every leaf is a real member:** the creator never supplies a root or a commitment, so a poll
//!   can't be stuffed with invented members (a creator-supplied root could hold any leaves at all).
//!
//! - **Immutable:** a poll wallet's root can't be changed once registered (a different root is
//!   refused), so the member list can't be swapped mid-poll.
//! - **One day:** the poll is open on the UTC day in `bucket_index`. The nullifier is one per
//!   (member, receiver, day), so with the poll closing at the end of its day, one nullifier is one
//!   vote. Ballots for any other day are refused.
//! - **Only its own members:** a wallet with a members-only poll accepts proofs against that
//!   poll's root only (the node's anonymity-set roots don't count there, or anyone in the set could
//!   vote). An **open** poll (no list) is registered too, and accepts the anonymity-set roots.
//! - **Closes at 00:00 UTC, really:** a ballot counts only if it's for the poll's day *and* checked
//!   on that day; a ballot dated to the poll's day but sent after the close is refused.
//! - **Only ballots:** a poll wallet stores nothing but anonymous ballots this node verified (named
//!   mail and unverified proofs are refused before storing), and its ballots are exempt from the
//!   per-receiver anonymous cap. Verified ballots are one per member, so they're bounded by the
//!   list (or the anonymity set), and nobody can push real ballots out with junk.
//! - **Anonymous among the listed members only,** and the list is public. A members-only poll lists
//!   at least [`POLL_MIN_MEMBERS`]; the page says the maker chose the list, and that a maker who
//!   controls most of the listed wallets can work out how the others voted.
//! - A poll gets a fresh wallet (the page makes one); only the wallet's own key can register a poll
//!   on it, and after its day the wallet accepts no anonymous mail.
//! - **Node-local (v1):** roots are not gossiped yet; other nodes show those ballots as unverified.
//! - Proofs still have to come from the pinned membership program (`anon::anon_program_accepted`).

use serde::{Deserialize, Serialize};

use crate::tmail::envelope::TmailHybridSig;

pub const TMAIL_POLL_ROOT_KIND: &str = "tmail_poll_root_v1";
/// The most members a poll can list (the tree holds 2^20; a poll needs far fewer).
pub const POLL_MAX_MEMBERS: usize = 1_000;
/// The fewest a members-only poll can list: with one or two, a ballot all but names its voter.
pub const POLL_MIN_MEMBERS: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmailPollRootV1 {
    pub v: u32,
    pub kind: String,
    /// The poll's wallet: the receiver of its ballots, and the signer of this root.
    pub poll_wallet_id: String,
    /// The listed members' wallet ids, sorted ascending, no repeats; empty for an open poll
    /// (anyone in this node's anonymity set).
    pub members: Vec<String>,
    /// The UTC day the poll is open (`tmail_bucket_index_v1`).
    pub bucket_index: u64,
    pub registered_at_ms: u64,
    pub hybrid_sig: TmailHybridSig,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TmailPollRootError {
    #[error("unsupported poll root version or kind")]
    Version,
    #[error("invalid poll wallet id or member wallet id (expected 64 hex)")]
    Malformed,
    #[error("the member list must be sorted ascending with no repeats")]
    Order,
    #[error("a members-only poll lists between {POLL_MIN_MEMBERS} and {POLL_MAX_MEMBERS} members")]
    Members,
    #[error("the poll root must be signed by the poll's own wallet")]
    SignerMismatch,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
}

fn is_64hex(s: &str) -> bool {
    let s = s.trim();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Hybrid-signature pre-image, chain-bound like every other Tmail pre-image:
/// `tet tmail poll root v1|chain_id={}|genesis_hash={}|poll_wallet_id={}|members_sha256={}|bucket_index={}|registered_at_ms={}|mldsa_pk={}`
/// where `members_sha256` is SHA-256 of the member wallet ids joined by `,`.
pub fn tmail_poll_root_auth_message_bytes(r: &TmailPollRootV1, mldsa_pubkey_b64: &str) -> Vec<u8> {
    use sha2::Digest as _;
    let joined = r.members.iter().map(|m| m.trim().to_ascii_lowercase()).collect::<Vec<_>>().join(",");
    format!(
        "tet tmail poll root v1|chain_id={}|genesis_hash={}|poll_wallet_id={}|members_sha256={}|bucket_index={}|registered_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        r.poll_wallet_id.trim().to_ascii_lowercase(),
        hex::encode(sha2::Sha256::digest(joined.as_bytes())),
        r.bucket_index,
        r.registered_at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// A poll root is valid only if the poll's own wallet signed it.
pub fn verify_tmail_poll_root_v1(r: &TmailPollRootV1) -> Result<(), TmailPollRootError> {
    if r.v != 1 || r.kind != TMAIL_POLL_ROOT_KIND {
        return Err(TmailPollRootError::Version);
    }
    let wallet = r.poll_wallet_id.trim().to_ascii_lowercase();
    if !r.members.is_empty() && (r.members.len() < POLL_MIN_MEMBERS || r.members.len() > POLL_MAX_MEMBERS) {
        return Err(TmailPollRootError::Members);
    }
    if !is_64hex(&wallet) || !r.members.iter().all(|m| is_64hex(m) && *m == m.to_ascii_lowercase()) {
        return Err(TmailPollRootError::Malformed);
    }
    if !r.members.windows(2).all(|w| w[0] < w[1]) {
        return Err(TmailPollRootError::Order);
    }
    let signer = r.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if signer != wallet {
        return Err(TmailPollRootError::SignerMismatch);
    }
    let msg = tmail_poll_root_auth_message_bytes(r, &r.hybrid_sig.mldsa_pubkey_b64);
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&r.hybrid_sig.ed25519_sig_b64),
        Some(&r.hybrid_sig.mldsa_pubkey_b64),
        Some(&r.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|e| TmailPollRootError::Signature(format!("{e:?}")))?;
    Ok(())
}

/// A registered poll: the signed list, and the root **the node** computed from its own registry
/// (`None` for an open poll).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPollRoot {
    pub poll: TmailPollRootV1,
    pub root_hex: Option<String>,
}

/// Is a ballot to this poll, proven against `root` for `bucket`, checked during `now_bucket`, one
/// that counts? Only on the poll's day, checked on that day; against the poll's own root, or for an
/// open poll against one of the node's anonymity-set roots (`set_root_ok`).
pub fn poll_accepts(p: &StoredPollRoot, root: &[u8; 32], bucket: u64, now_bucket: u64, set_root_ok: impl FnOnce() -> bool) -> bool {
    if bucket != p.poll.bucket_index || now_bucket != p.poll.bucket_index {
        return false;
    }
    match &p.root_hex {
        Some(r) => r.eq_ignore_ascii_case(&hex::encode(root)),
        None => set_root_ok(),
    }
}
