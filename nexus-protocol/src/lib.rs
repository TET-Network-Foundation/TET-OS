#![cfg_attr(not(feature = "std"), no_std)]

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

/// Canonical journal format committed by the zkVM guest and decoded by host/clients.
///
/// This must remain backwards-compatible. Introduce `InferenceJournalV2` rather than
/// modifying fields in-place once deployed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceJournalV1 {
    pub worker_pubkey_bytes: [u8; 32],
    pub prompt_hash: [u8; 32],
    pub response_hash: [u8; 32],
    pub cost_micro: u64,
}

/// ZK-Court Phase 1.5: commitment verified in-guest; committed after successful hash check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkCourtJournalV1 {
    pub commitment_sha256: [u8; 32],
    pub flops_u64: u64,
    pub worker_pubkey_bytes: [u8; 32],
}

/// Domain-separated commitment over inference transcript + FLOPs + worker identity (32-byte pubkey).
/// Host and guest **must** use this exact construction.
pub fn zk_court_inference_commitment_v1(
    prompt: &str,
    response: &str,
    flops_le: u64,
    worker_pubkey: &[u8; 32],
) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"TET_ZK_COURT_COMMIT_V1");
    h.update(prompt.as_bytes());
    h.update([0xff]);
    h.update(response.as_bytes());
    h.update([0xff]);
    h.update(flops_le.to_le_bytes());
    h.update(worker_pubkey.as_slice());
    h.finalize().into()
}

// ---------------------------------------------------------------------------
// Tmail Anonymous Mode (spec §A.4) — anchor-ownership journal and derivations.
//
// Host, zkVM guest and browser must produce byte-identical values here. Every construction is
// domain-separated and defined once, for the same reason the §A.1.3 Tmail pre-image is: a
// mismatch is silent and shows up as "every proof is rejected".
// ---------------------------------------------------------------------------

/// Length of a scheduled-release / anonymity bucket: 24 h in milliseconds.
pub const TMAIL_BUCKET_MS: u64 = 86_400_000;

/// Bucket index for a send time. `floor(sent_at_ms / 86_400_000)`.
///
/// Together with the receiver, this is what makes an ephemeral single-use: one anchor derives
/// exactly one ephemeral per `(receiver, bucket)`, so a receipt cannot be reused to sign an
/// unbounded stream of messages.
///
/// **Node-local, not consensus.** Acceptance compares this against the receiving node's own clock
/// (±1 bucket). Two nodes disagreeing at a boundary accept or reject one Tmail message
/// differently; no balance moves and no `state_root` is touched, so this is emphatically **not** a
/// `PHASE_1_GENESIS_SPEC` §1 wall-clock-in-apply case. Do not "fix" it by threading
/// `block.timestamp` through — Tmail is off-ledger.
pub fn tmail_bucket_index_v1(sent_at_ms: u64) -> u64 {
    sent_at_ms / TMAIL_BUCKET_MS
}

/// Deterministic ephemeral secret seed: `HKDF-SHA256(anchor_seed, info = domain ‖ receiver ‖ bucket)`.
///
/// The anchor regenerates its entire audit trail from this and its own seed — nothing about the
/// anchor↔ephemeral relation is written to any replicated store (spec §A.4.4, and the
/// "only proves, never stores" principle).
pub fn tmail_ephemeral_seed_v1(
    anchor_seed: &[u8; 32],
    receiver_wallet: &[u8; 32],
    bucket_index: u64,
) -> [u8; 32] {
    let hk = hkdf::Hkdf::<Sha256>::new(None, anchor_seed.as_slice());
    let mut info = [0u8; 16 + 32 + 8];
    info[..16].copy_from_slice(b"tet-ephemeral-v1");
    info[16..48].copy_from_slice(receiver_wallet.as_slice());
    info[48..].copy_from_slice(&bucket_index.to_le_bytes());
    let mut out = [0u8; 32];
    // Only fails for absurd output lengths; 32 bytes is always valid for SHA-256.
    hk.expand(&info, &mut out).expect("hkdf expand 32 bytes");
    out
}

/// Anchor-ownership journal (spec §A.4.3), committed by guest mode 2.
///
/// **What it proves:** the committed `ephemeral_pubkey_bytes` is the correct HKDF derivation for
/// this `(receiver, bucket)` from *some* anchor seed the prover knows. So one anchor yields exactly
/// one ephemeral per receiver per 24 h.
///
/// **What it deliberately does not contain:** anything identifying the anchor. Not the anchor
/// pubkey, not a hash of it — a hash of a public value is invertible by scanning known wallets, and
/// committing one would hand every verifier a deanonymisation index. Unlinkability therefore holds
/// against anyone holding every receipt ever published.
///
/// **What it does not achieve, stated plainly:** this bounds ephemerals *per anchor*; it does not
/// bound *anchors*. Anyone can generate seeds. Making an anchor costly is the 1 TET escrow, which
/// is AT-5(b) and Phase 1 — until then Anonymous Mode has binding, not sybil resistance.
///
/// # Why this journal carries an explicit `journal_kind`
///
/// Under risc0's word-aligned serde, this struct's payload and [`ZkCourtJournalV1`] are **both 264
/// bytes** — `32·4 + 32·4 + 8` versus `32·4 + 8 + 32·4`. They are byte-level permutations of each
/// other, so decoding one as the other succeeds *and* re-serializes to identical bytes: a
/// round-trip check cannot separate them and whichever type a verifier tries first wins. A genuine
/// ZK-Court receipt would then be reported as a Tmail anchor proof, or the reverse.
///
/// The tag makes the encoding self-describing and the length distinct (268 bytes), so the ambiguity
/// is removed at the wire level rather than by hoping the match arms stay in the right order.
/// [`TMAIL_ANCHOR_JOURNAL_KIND`] must be checked on decode, not merely deserialized.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TmailAnchorOwnsEphemeralV1 {
    /// Always [`TMAIL_ANCHOR_JOURNAL_KIND`]. Present so this journal cannot be confused with a
    /// same-length one of a different type.
    pub journal_kind: u32,
    pub ephemeral_pubkey_bytes: [u8; 32],
    pub receiver_wallet_bytes: [u8; 32],
    pub bucket_index: u64,
}

/// Discriminator for [`TmailAnchorOwnsEphemeralV1`] (ASCII "TMA1" little-endian).
pub const TMAIL_ANCHOR_JOURNAL_KIND: u32 = u32::from_le_bytes(*b"TMA1");
