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

// ---------------------------------------------------------------------------
// Semaphore-style anonymous membership (hash-only). Spec §A.4.3, redesign 2026-09-24.
//
// Replaces the anchor-derives-ephemeral construction, which cost 11-19 min of in-guest Ed25519 and
// proved almost nothing: "I know a seed that derives this ephemeral" is trivially true for anyone
// who invents a seed. Membership in a published registry is a claim with content, and it is all
// SHA-256 — which the zkVM accelerates.
// ---------------------------------------------------------------------------

/// Merkle depth. 2^20 = 1,048,576 members; the tree is fixed-depth so proof size and guest cost do
/// not vary with registry size, and so a small registry cannot be distinguished from a large one by
/// timing the proof.
pub const TET_ANON_MERKLE_DEPTH: usize = 20;

/// Registry leaf for a member: `SHA256("tet-anon-v1" ‖ seed)`.
///
/// The wallet publishes this commitment, hybrid-signed. `seed` never leaves the device — the
/// commitment is what goes in the registry, and inverting it means breaking SHA-256 on a 32-byte
/// high-entropy preimage.
pub fn tet_anon_commitment_v1(seed: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"tet-anon-v1");
    h.update(seed.as_slice());
    h.finalize().into()
}

/// Nullifier: `SHA256("tet-null-v1" ‖ seed ‖ receiver ‖ bucket)`.
///
/// One member yields exactly one nullifier per `(receiver, bucket)`, so nodes rejecting a repeat
/// bound how many ephemerals a member can publish per counterparty per day. It reveals nothing:
/// the preimage contains the secret seed, so unlike a hash of a public wallet id it cannot be
/// inverted by enumeration.
pub fn tet_anon_nullifier_v1(
    seed: &[u8; 32],
    receiver_wallet: &[u8; 32],
    bucket_index: u64,
) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"tet-null-v1");
    h.update(seed.as_slice());
    h.update(receiver_wallet.as_slice());
    h.update(bucket_index.to_le_bytes());
    h.finalize().into()
}

/// Domain-separated Merkle parent. Separated from leaf hashing so a leaf can never be presented as
/// an internal node (second-preimage on the tree).
pub fn tet_anon_merkle_parent_v1(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"tet-node-v1");
    h.update(left.as_slice());
    h.update(right.as_slice());
    h.finalize().into()
}

/// Recompute a root from a leaf and its authentication path. `index` bit `i` selects whether the
/// running hash is the right child at level `i`.
pub fn tet_anon_merkle_root_from_path_v1(
    leaf: &[u8; 32],
    index: u32,
    siblings: &[[u8; 32]],
) -> [u8; 32] {
    let mut cur = *leaf;
    let mut i = 0usize;
    while i < siblings.len() {
        let bit = (index >> i) & 1;
        cur = if bit == 0 {
            tet_anon_merkle_parent_v1(&cur, &siblings[i])
        } else {
            tet_anon_merkle_parent_v1(&siblings[i], &cur)
        };
        i += 1;
    }
    cur
}

/// Anonymous-membership journal (hash-only construction).
///
/// `ephemeral_pubkey_bytes` is a **committed input**, not derived in-guest: the prover chooses it,
/// and the journal binds the proof to that choice. No curve arithmetic is needed, because
/// uniqueness comes from the nullifier rather than from deriving a key. One member gets one
/// nullifier per `(receiver, bucket)`, so they can publish one ephemeral for that pair; a second
/// would need either the same nullifier (rejected) or a different member secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TmailAnonMembershipV1 {
    /// Always [`TMAIL_ANON_JOURNAL_KIND`].
    pub journal_kind: u32,
    /// Registry root the membership was proved against.
    pub merkle_root: [u8; 32],
    /// One per `(member, receiver, bucket)`.
    pub nullifier: [u8; 32],
    pub ephemeral_pubkey_bytes: [u8; 32],
    pub receiver_wallet_bytes: [u8; 32],
    pub bucket_index: u64,
}

/// Discriminator for [`TmailAnonMembershipV1`] (ASCII "TAM1").
pub const TMAIL_ANON_JOURNAL_KIND: u32 = u32::from_le_bytes(*b"TAM1");
