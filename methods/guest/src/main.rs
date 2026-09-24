#![no_main]
#![no_std]

extern crate alloc;

use alloc::string::String;
use risc0_zkvm::guest::env;
use sha2::{Digest as _, Sha256};

risc0_zkvm::guest::entry!(main);

use nexus_protocol::{
    InferenceJournalV1, TMAIL_ANCHOR_JOURNAL_KIND, TmailAnchorOwnsEphemeralV1, ZkCourtJournalV1,
    tmail_ephemeral_seed_v1, zk_court_inference_commitment_v1,
};

/// `0` = legacy inference payment journal (existing inference receipts).
/// `1` = ZK-Court commitment verification → commits [`ZkCourtJournalV1`].
/// `2` = Tmail anchor-ownership of an ephemeral → commits [`TmailAnchorOwnsEphemeralV1`].
fn main() {
    let mode: u8 = env::read();
    match mode {
        0 => guest_inference_journal_v1(),
        1 => guest_zk_court_commitment_v1(),
        2 => guest_tmail_anchor_owns_ephemeral_v1(),
        _ => panic!("unknown guest mode"),
    }
}

/// Tmail Anonymous Mode, spec §A.4.3.
///
/// **The anchor seed is a private witness and is never committed.** `env::read` inputs stay inside
/// the proof; only `env::commit` reaches the journal. The journal carries the ephemeral pubkey, the
/// receiver and the bucket — nothing from which the anchor can be recovered, by construction rather
/// than by policy.
///
/// What the proof establishes: this ephemeral really is `HKDF(anchor_seed, receiver ‖ bucket)`, so
/// the sender could not have picked it freely. One anchor therefore yields exactly one ephemeral
/// per receiver per 24 h bucket, which is what stops a single 15.8 s proof from authorising an
/// unbounded stream of messages.
fn guest_tmail_anchor_owns_ephemeral_v1() {
    let anchor_seed: [u8; 32] = env::read();
    let receiver_wallet_bytes: [u8; 32] = env::read();
    let bucket_index: u64 = env::read();

    let ephemeral_seed =
        tmail_ephemeral_seed_v1(&anchor_seed, &receiver_wallet_bytes, bucket_index);
    let signing = ed25519_dalek::SigningKey::from_bytes(&ephemeral_seed);
    let ephemeral_pubkey_bytes = signing.verifying_key().to_bytes();

    env::commit(&TmailAnchorOwnsEphemeralV1 {
        journal_kind: TMAIL_ANCHOR_JOURNAL_KIND,
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
