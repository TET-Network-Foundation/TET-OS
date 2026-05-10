#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::vec::Vec;
use codec::{Decode, Encode, MaxEncodedLen};
use scale_info::TypeInfo;
use sp_core::H256;

/// Phase 0: the "Inference Wedge".
///
/// This is intentionally scoped to high-performance inference settlement only.
#[derive(Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
pub struct InferenceReceipt {
	/// Unique task identifier (domain separator for replay/dedup).
	pub task_id: H256,
	/// Worker identity (Ed25519 pubkey bytes).
	pub worker_pubkey: [u8; 32],
	/// Model identifier (e.g. `b"llama3:8b"`).
	pub model_id: Vec<u8>,
	/// Hash of the input payload (prompt + policy + nonce envelope).
	pub input_hash: [u8; 32],
	/// Hash of the output payload (model output).
	pub output_hash: [u8; 32],
	/// Nonce issued by the system to prevent replay.
	pub nonce: u64,
	/// Worker Ed25519 signature over a canonical message derived from fields above.
	pub worker_signature: Vec<u8>,
	/// Worker ML-DSA (Dilithium / FIPS 204) public key bytes.
	///
	/// Phase 0 is "brutal": the chain must be able to verify real PQ signatures.
	pub mldsa_pubkey: Vec<u8>,
	/// Worker ML-DSA (Dilithium / FIPS 204) signature bytes.
	pub mldsa_signature: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo, MaxEncodedLen)]
pub struct SettlementRecord {
	/// The task this settlement corresponds to.
	pub task_id: H256,
	/// Whether the receipt was accepted.
	pub accepted: bool,
	/// Amount paid out to the worker (smallest unit).
	pub reward_paid_stevemon: u128,
	/// Amount burned as part of this settlement (smallest unit).
	pub burned_stevemon: u128,
}

