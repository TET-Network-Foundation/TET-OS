use crate::{mock::*, Error, Event};
use frame_support::{assert_noop, assert_ok};
use frame_support::BoundedVec;
use frame_support::pallet_prelude::ConstU32;

#[test]
fn accepts_valid_mock_proof() {
	new_test_ext().execute_with(|| {
		System::set_block_number(1);

		let task_id = [7u8; 32].into();
		let model_id = BoundedVec::<u8, ConstU32<64>>::try_from(vec![9u8; 4]).unwrap();
		let input_hash = [1u8; 32];
		let output_hash = [2u8; 32];
		let nonce = 1u64;
		let timestamp_ms = 2u64;
		let worker_pubkey = [3u8; 32];
		let worker_sig = BoundedVec::<u8, ConstU32<512>>::try_from(vec![4u8; 96]).unwrap();
		let capability_hint = 1u32;

		assert_ok!(
			TetCompute::submit_inference_proof(
				RuntimeOrigin::signed(1),
				task_id,
				model_id,
				input_hash,
				output_hash,
				nonce,
				timestamp_ms,
				worker_pubkey,
				worker_sig.clone(),
				capability_hint
			)
		);

		// Extrinsic emits `InferenceProven` and then `RewardIssued`; the last event is RewardIssued.
		System::assert_last_event(Event::RewardIssued { worker: 1, amount_stevemon: 5u128 }.into());
	});
}

#[test]
fn rejects_empty_signature() {
	new_test_ext().execute_with(|| {
		System::set_block_number(1);
		let task_id = [0u8; 32].into();
		let model_id = BoundedVec::<u8, ConstU32<64>>::try_from(vec![0u8; 1]).unwrap();
		let input_hash = [0u8; 32];
		let output_hash = [0u8; 32];
		let nonce = 0u64;
		let timestamp_ms = 0u64;
		let worker_pubkey = [0u8; 32];
		let worker_sig = BoundedVec::<u8, ConstU32<512>>::try_from(vec![]).unwrap();
		let capability_hint = 0u32;

		assert_noop!(
			TetCompute::submit_inference_proof(
				RuntimeOrigin::signed(1),
				task_id,
				model_id,
				input_hash,
				output_hash,
				nonce,
				timestamp_ms,
				worker_pubkey,
				worker_sig,
				capability_hint
			),
			Error::<Test>::InvalidProof
		);
	});
}
