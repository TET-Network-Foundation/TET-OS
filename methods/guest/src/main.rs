#![no_main]
#![no_std]

extern crate alloc;

use alloc::string::String;
use risc0_zkvm::guest::env;
use sha2::{Digest as _, Sha256};

risc0_zkvm::guest::entry!(main);

use alloc::vec::Vec;
use nexus_protocol::{
    InferenceJournalV1, TET_ANON_MERKLE_DEPTH, TMAIL_ANON_JOURNAL_KIND, TmailAnonMembershipV1,
    ZkCourtJournalV1, tet_anon_commitment_v1, tet_anon_merkle_root_from_path_v1,
    tet_anon_nullifier_v1, zk_court_inference_commitment_v1,
};

/// `0` = legacy inference payment journal (existing inference receipts).
/// `1` = ZK-Court commitment verification → commits [`ZkCourtJournalV1`].
/// `3` = Tmail anonymous membership (hash-only) → commits [`TmailAnonMembershipV1`].
///
/// Mode `2` was an anchor-derives-ephemeral proof using in-guest Ed25519. Removed 2026-09-24: it
/// cost 11-19 min per proof to assert "I know a seed that derives this ephemeral", which anyone
/// can assert by inventing a seed. Mode 3 proves registry membership instead, in 60 s, using only
/// SHA-256. The number is not reused.
fn main() {
    let mode: u8 = env::read();
    match mode {
        0 => guest_inference_journal_v1(),
        1 => guest_zk_court_commitment_v1(),
        3 => guest_tmail_anon_membership_v1(),
        _ => panic!("unknown guest mode"),
    }
}

/// Anonymous membership, Semaphore-style and **hash-only** (spec §A.4.3).
///
/// Proves: "I know a secret whose commitment is a leaf under this registry root", plus a nullifier
/// binding that secret to one `(receiver, bucket)`. The Merkle path is a private witness, so which
/// leaf is never revealed — the anonymity set is every member under the root.
///
/// Everything here is SHA-256, which the zkVM accelerates. The previous construction derived an
/// Ed25519 public key in-guest on unaccelerated `curve25519-dalek` and cost 11-19 minutes per
/// proof, for a claim ("I know a seed") that anyone can make.
///
/// `ephemeral_pubkey` is read and committed, not derived: the journal binds the proof to that
/// ephemeral, and uniqueness comes from the nullifier instead of from key derivation.
fn guest_tmail_anon_membership_v1() {
    let secret: [u8; 32] = env::read();
    let merkle_index: u32 = env::read();
    let siblings: Vec<[u8; 32]> = env::read();
    let ephemeral_pubkey_bytes: [u8; 32] = env::read();
    let receiver_wallet_bytes: [u8; 32] = env::read();
    let bucket_index: u64 = env::read();

    assert!(
        siblings.len() == TET_ANON_MERKLE_DEPTH,
        "authentication path must be exactly TET_ANON_MERKLE_DEPTH long: a variable-length path \
         would let the prover pick a shallower tree and forge membership, and would also leak the \
         registry size through proof shape"
    );

    let leaf = tet_anon_commitment_v1(&secret);
    let merkle_root = tet_anon_merkle_root_from_path_v1(&leaf, merkle_index, &siblings);
    let nullifier = tet_anon_nullifier_v1(&secret, &receiver_wallet_bytes, bucket_index);

    env::commit(&TmailAnonMembershipV1 {
        journal_kind: TMAIL_ANON_JOURNAL_KIND,
        merkle_root,
        nullifier,
        ephemeral_pubkey_bytes,
        receiver_wallet_bytes,
        bucket_index,
    });
}

fn guest_inference_journal_v1() {
    let prompt: String = env::read();
    let response: String = env::read();
    let worker_pubkey_bytes: [u8; 32] = env::read();

    assert!(!response.is_empty(), "Empty response!");

    let prompt_hash: [u8; 32] = Sha256::digest(prompt.as_bytes()).into();
    let response_hash: [u8; 32] = Sha256::digest(response.as_bytes()).into();

    let cost_micro = (response.as_bytes().len() as u64).saturating_mul(10).max(1);

    env::commit(&InferenceJournalV1 {
        worker_pubkey_bytes,
        prompt_hash,
        response_hash,
        cost_micro,
    });
}

fn guest_zk_court_commitment_v1() {
    let prompt: String = env::read();
    let response: String = env::read();
    let flops: u64 = env::read();
    let worker_pubkey_bytes: [u8; 32] = env::read();
    let commitment_claimed: [u8; 32] = env::read();

    let computed =
        zk_court_inference_commitment_v1(&prompt, &response, flops, &worker_pubkey_bytes);
    assert!(
        computed == commitment_claimed,
        "ZK-Court: commitment mismatch (lazy eval / tampering suspected)"
    );

    env::commit(&ZkCourtJournalV1 {
        commitment_sha256: computed,
        flops_u64: flops,
        worker_pubkey_bytes,
    });
}
