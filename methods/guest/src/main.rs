#![no_main]
#![no_std]

extern crate alloc;

use alloc::string::String;
use risc0_zkvm::guest::env;
use sha2::{Digest as _, Sha256};

risc0_zkvm::guest::entry!(main);

use nexus_protocol::{
    InferenceJournalV1, ZkCourtJournalV1, zk_court_inference_commitment_v1,
};

/// `0` = legacy inference payment journal (existing inference receipts).
/// `1` = ZK-Court commitment verification → commits [`ZkCourtJournalV1`].
fn main() {
    let mode: u8 = env::read();
    match mode {
        0 => guest_inference_journal_v1(),
        1 => guest_zk_court_commitment_v1(),
        _ => panic!("unknown guest mode"),
    }
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
