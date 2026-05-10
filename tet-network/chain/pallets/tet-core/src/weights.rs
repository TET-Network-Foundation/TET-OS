//! Minimal weights for `pallet_tet_core`.
//!
//! Phase 0 note: these are intentionally conservative placeholders to avoid `#[pallet::weight(0)]`.

use frame_support::weights::{constants::RocksDbWeight, Weight};
use frame_support::traits::Get;
use core::marker::PhantomData;

pub trait WeightInfo {
	fn submit_inference_receipt(
		model_id_len: u32,
		ed25519_sig_len: u32,
		mldsa_pubkey_len: u32,
		mldsa_sig_len: u32,
	) -> Weight;
	fn submit_zk_challenge(proof_len: u32, public_inputs_len: u32, vkey_hash_len: u32) -> Weight;
	fn transfer_with_memo(memo_len: u32) -> Weight;
	fn transfer_with_memo_raw(dest_len: u32, memo_len: u32) -> Weight;
	fn submit_ai_proof() -> Weight;
	fn set_slash_lambda() -> Weight;
	fn open_zk_court_case() -> Weight;
	fn submit_zk_evidence() -> Weight;
	fn finalize_zk_court_case() -> Weight;
	fn slash_worker() -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
	fn submit_inference_receipt(
		model_id_len: u32,
		ed25519_sig_len: u32,
		mldsa_pubkey_len: u32,
		mldsa_sig_len: u32,
	) -> Weight {
		// Phase 0 "Brutal Path":
		// - Ed25519 verification
		// - ML-DSA verification (heavy)
		// - 2-3 storage writes + 1 transfer
		//
		// We intentionally price this high. This is not benchmark-derived yet.
		let bytes =
			model_id_len as u64 + ed25519_sig_len as u64 + mldsa_pubkey_len as u64 + mldsa_sig_len as u64;
		Weight::from_parts(900_000_000, 0)
			.saturating_add(Weight::from_parts(bytes.saturating_mul(50_000), 0))
			.saturating_add(T::DbWeight::get().reads(4_u64))
			.saturating_add(T::DbWeight::get().writes(3_u64))
	}

	fn submit_ai_proof() -> Weight {
		Weight::from_parts(25_000_000, 0)
			.saturating_add(T::DbWeight::get().reads(2_u64))
			.saturating_add(T::DbWeight::get().writes(1_u64))
	}
	fn transfer_with_memo(memo_len: u32) -> Weight {
		// One balances transfer + event.
		Weight::from_parts(45_000_000, 0)
			.saturating_add(Weight::from_parts((memo_len as u64).saturating_mul(20_000), 0))
			.saturating_add(T::DbWeight::get().reads(2_u64))
			.saturating_add(T::DbWeight::get().writes(2_u64))
	}
	fn transfer_with_memo_raw(dest_len: u32, memo_len: u32) -> Weight {
		// Adds a small decode/convert overhead.
		let bytes = dest_len as u64 + memo_len as u64;
		Weight::from_parts(55_000_000, 0)
			.saturating_add(Weight::from_parts(bytes.saturating_mul(20_000), 0))
			.saturating_add(T::DbWeight::get().reads(2_u64))
			.saturating_add(T::DbWeight::get().writes(2_u64))
	}
	fn submit_zk_challenge(proof_len: u32, public_inputs_len: u32, vkey_hash_len: u32) -> Weight {
		// ZK proof verification is *extremely* expensive. We price it accordingly.
		let bytes = proof_len as u64 + public_inputs_len as u64 + vkey_hash_len as u64;
		Weight::from_parts(2_500_000_000, 0)
			.saturating_add(Weight::from_parts(bytes.saturating_mul(150_000), 0))
			.saturating_add(T::DbWeight::get().reads(2_u64))
			.saturating_add(T::DbWeight::get().writes(2_u64))
	}
	fn set_slash_lambda() -> Weight {
		Weight::from_parts(5_000_000, 0).saturating_add(T::DbWeight::get().writes(1_u64))
	}
	fn open_zk_court_case() -> Weight {
		Weight::from_parts(10_000_000, 0).saturating_add(T::DbWeight::get().writes(1_u64))
	}
	fn submit_zk_evidence() -> Weight {
		Weight::from_parts(12_000_000, 0)
			.saturating_add(T::DbWeight::get().reads(1_u64))
			.saturating_add(T::DbWeight::get().writes(1_u64))
	}
	fn finalize_zk_court_case() -> Weight {
		Weight::from_parts(12_000_000, 0)
			.saturating_add(T::DbWeight::get().reads(1_u64))
			.saturating_add(T::DbWeight::get().writes(1_u64))
	}
	fn slash_worker() -> Weight {
		Weight::from_parts(8_000_000, 0)
			.saturating_add(T::DbWeight::get().reads(1_u64))
			.saturating_add(T::DbWeight::get().writes(1_u64))
	}
}

impl WeightInfo for () {
	fn submit_inference_receipt(
		model_id_len: u32,
		ed25519_sig_len: u32,
		mldsa_pubkey_len: u32,
		mldsa_sig_len: u32,
	) -> Weight {
		let bytes =
			model_id_len as u64 + ed25519_sig_len as u64 + mldsa_pubkey_len as u64 + mldsa_sig_len as u64;
		Weight::from_parts(900_000_000, 0)
			.saturating_add(Weight::from_parts(bytes.saturating_mul(50_000), 0))
			.saturating_add(RocksDbWeight::get().reads(4_u64))
			.saturating_add(RocksDbWeight::get().writes(3_u64))
	}

	fn submit_ai_proof() -> Weight {
		Weight::from_parts(25_000_000, 0)
			.saturating_add(RocksDbWeight::get().reads(2_u64))
			.saturating_add(RocksDbWeight::get().writes(1_u64))
	}
	fn transfer_with_memo(memo_len: u32) -> Weight {
		Weight::from_parts(45_000_000, 0)
			.saturating_add(Weight::from_parts((memo_len as u64).saturating_mul(20_000), 0))
			.saturating_add(RocksDbWeight::get().reads(2_u64))
			.saturating_add(RocksDbWeight::get().writes(2_u64))
	}
	fn transfer_with_memo_raw(dest_len: u32, memo_len: u32) -> Weight {
		let bytes = dest_len as u64 + memo_len as u64;
		Weight::from_parts(55_000_000, 0)
			.saturating_add(Weight::from_parts(bytes.saturating_mul(20_000), 0))
			.saturating_add(RocksDbWeight::get().reads(2_u64))
			.saturating_add(RocksDbWeight::get().writes(2_u64))
	}
	fn submit_zk_challenge(proof_len: u32, public_inputs_len: u32, vkey_hash_len: u32) -> Weight {
		let bytes = proof_len as u64 + public_inputs_len as u64 + vkey_hash_len as u64;
		Weight::from_parts(2_500_000_000, 0)
			.saturating_add(Weight::from_parts(bytes.saturating_mul(150_000), 0))
			.saturating_add(RocksDbWeight::get().reads(2_u64))
			.saturating_add(RocksDbWeight::get().writes(2_u64))
	}
	fn set_slash_lambda() -> Weight {
		Weight::from_parts(5_000_000, 0).saturating_add(RocksDbWeight::get().writes(1_u64))
	}
	fn open_zk_court_case() -> Weight {
		Weight::from_parts(10_000_000, 0).saturating_add(RocksDbWeight::get().writes(1_u64))
	}
	fn submit_zk_evidence() -> Weight {
		Weight::from_parts(12_000_000, 0)
			.saturating_add(RocksDbWeight::get().reads(1_u64))
			.saturating_add(RocksDbWeight::get().writes(1_u64))
	}
	fn finalize_zk_court_case() -> Weight {
		Weight::from_parts(12_000_000, 0)
			.saturating_add(RocksDbWeight::get().reads(1_u64))
			.saturating_add(RocksDbWeight::get().writes(1_u64))
	}
	fn slash_worker() -> Weight {
		Weight::from_parts(8_000_000, 0)
			.saturating_add(RocksDbWeight::get().reads(1_u64))
			.saturating_add(RocksDbWeight::get().writes(1_u64))
	}
}

