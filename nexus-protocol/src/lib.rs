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
