#![cfg_attr(not(feature = "std"), no_std)]
extern crate alloc;

// TET Compute Pallet (Proof of Compute)
// Minimal pallet scaffold for the latest Polkadot SDK.

pub use pallet::*;

#[cfg(test)]
mod mock;

#[cfg(test)]
mod tests;

pub mod weights;

#[frame_support::pallet]
pub mod pallet {
	use crate::weights::WeightInfo;
	use frame_support::pallet_prelude::*;
	use frame_system::pallet_prelude::*;
	use sp_core::H256;

	#[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
	pub struct InferenceProof {
		pub task_id: H256,
		pub model_id: BoundedVec<u8, ConstU32<64>>,
		pub input_hash: [u8; 32],
		pub output_hash: [u8; 32],
		pub nonce: u64,
		pub timestamp_ms: u64,
		pub worker_pubkey: [u8; 32],
		pub worker_sig: BoundedVec<u8, ConstU32<512>>,
		pub capability_hint: u32,
	}

	#[pallet::pallet]
	pub struct Pallet<T>(_);

	#[pallet::config]
	pub trait Config: frame_system::Config {
		type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
		type WeightInfo: crate::weights::WeightInfo;
	}

	#[pallet::event]
	#[pallet::generate_deposit(pub(super) fn deposit_event)]
	pub enum Event<T: Config> {
		InferenceProven {
			worker: T::AccountId,
			task_id: H256,
			model_id: BoundedVec<u8, ConstU32<64>>,
			input_hash: [u8; 32],
			output_hash: [u8; 32],
			nonce: u64,
			timestamp_ms: u64,
			worker_pubkey: [u8; 32],
			worker_sig_len: u32,
			capability_hint: u32,
		},
		RewardIssued { worker: T::AccountId, amount_stevemon: u128 },
	}

	#[pallet::storage]
	pub type SeenTasks<T: Config> = StorageMap<_, Blake2_128Concat, H256, (), OptionQuery>;

	/// Minimal CAAC gate: worker capability hint must be >= this threshold.
	#[pallet::storage]
	pub type MinWorkerCapability<T: Config> = StorageValue<_, u32, ValueQuery>;

	#[pallet::error]
	pub enum Error<T> {
		InvalidProof,
		AlreadySubmitted,
		InsufficientCapability,
	}

	#[pallet::call]
	impl<T: Config> Pallet<T> {
		#[pallet::call_index(0)]
		#[pallet::weight(T::WeightInfo::submit_inference_proof())]
		pub fn submit_inference_proof(
			origin: OriginFor<T>,
			task_id: H256,
			model_id: BoundedVec<u8, ConstU32<64>>,
			input_hash: [u8; 32],
			output_hash: [u8; 32],
			nonce: u64,
			timestamp_ms: u64,
			worker_pubkey: [u8; 32],
			worker_sig: BoundedVec<u8, ConstU32<512>>,
			capability_hint: u32,
		) -> DispatchResult {
			let worker = ensure_signed(origin)?;
			ensure!(!SeenTasks::<T>::contains_key(task_id), Error::<T>::AlreadySubmitted);
			ensure!(worker_sig.len() >= 64, Error::<T>::InvalidProof);
			let min_cap = MinWorkerCapability::<T>::get();
			ensure!(capability_hint >= min_cap, Error::<T>::InsufficientCapability);
			let proof = InferenceProof {
				task_id,
				model_id: model_id.clone(),
				input_hash,
				output_hash,
				nonce,
				timestamp_ms,
				worker_pubkey,
				worker_sig: worker_sig.clone(),
				capability_hint,
			};
			SeenTasks::<T>::insert(task_id, ());

			Self::deposit_event(Event::InferenceProven {
				worker: worker.clone(),
				task_id: proof.task_id,
				model_id: proof.model_id.clone(),
				input_hash: proof.input_hash,
				output_hash: proof.output_hash,
				nonce: proof.nonce,
				timestamp_ms: proof.timestamp_ms,
				worker_pubkey: proof.worker_pubkey,
				worker_sig_len: worker_sig.len() as u32,
				capability_hint: proof.capability_hint,
			});
			Self::deposit_event(Event::RewardIssued { worker, amount_stevemon: 5u128 });
			Ok(())
		}

		#[pallet::call_index(1)]
		#[pallet::weight(T::WeightInfo::set_min_worker_capability())]
		pub fn set_min_worker_capability(
			origin: OriginFor<T>,
			min_capability: u32,
		) -> DispatchResult {
			// Minimal MVP gate configuration is operator-controlled.
			ensure_root(origin)?;
			MinWorkerCapability::<T>::put(min_capability);
			Ok(())
		}
	}
}
