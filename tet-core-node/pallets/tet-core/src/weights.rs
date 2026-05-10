#![cfg_attr(rustfmt, rustfmt_skip)]
#![allow(unused_parens)]
#![allow(unused_imports)]

use core::marker::PhantomData;
use frame_support::weights::Weight;

pub trait WeightInfo {
	fn transfer_with_memo_raw(memo_len: u32, zk_receipt_len: u32) -> Weight;
	fn submit_ai_inference(prompt_len: u32, response_len: u32, zk_receipt_len: u32) -> Weight;
	fn register_node_profile() -> Weight;
	fn request_ai_inference(prompt_len: u32) -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);
impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
	fn transfer_with_memo_raw(memo_len: u32, zk_receipt_len: u32) -> Weight {
		// Account for memo length to avoid low-cost large payloads.
		let base = Weight::from_parts(50_000_000, 0);
		let per_byte_memo = Weight::from_parts(50_000, 0);
		let per_byte_zk = Weight::from_parts(100_000, 0);
		base.saturating_add(per_byte_memo.saturating_mul(memo_len.into()))
			.saturating_add(per_byte_zk.saturating_mul(zk_receipt_len.into()))
	}

	fn submit_ai_inference(prompt_len: u32, response_len: u32, zk_receipt_len: u32) -> Weight {
		let base = Weight::from_parts(25_000_000, 0);
		let per_byte = Weight::from_parts(100, 0);
		let per_byte_zk = Weight::from_parts(100_000, 0);
		base.saturating_add(per_byte.saturating_mul(prompt_len.saturating_add(response_len).into()))
			.saturating_add(per_byte_zk.saturating_mul(zk_receipt_len.into()))
	}

	fn register_node_profile() -> Weight {
		Weight::from_parts(15_000_000, 0)
	}

	fn request_ai_inference(prompt_len: u32) -> Weight {
		let base = Weight::from_parts(22_000_000, 0);
		let per_byte = Weight::from_parts(500, 0);
		base.saturating_add(per_byte.saturating_mul(prompt_len.into()))
	}
}

impl WeightInfo for () {
	fn transfer_with_memo_raw(memo_len: u32, zk_receipt_len: u32) -> Weight {
		let base = Weight::from_parts(50_000_000, 0);
		let per_byte_memo = Weight::from_parts(50_000, 0);
		let per_byte_zk = Weight::from_parts(100_000, 0);
		base.saturating_add(per_byte_memo.saturating_mul(memo_len.into()))
			.saturating_add(per_byte_zk.saturating_mul(zk_receipt_len.into()))
	}

	fn submit_ai_inference(prompt_len: u32, response_len: u32, zk_receipt_len: u32) -> Weight {
		let base = Weight::from_parts(25_000_000, 0);
		let per_byte = Weight::from_parts(100, 0);
		let per_byte_zk = Weight::from_parts(100_000, 0);
		base.saturating_add(per_byte.saturating_mul(prompt_len.saturating_add(response_len).into()))
			.saturating_add(per_byte_zk.saturating_mul(zk_receipt_len.into()))
	}

	fn register_node_profile() -> Weight {
		Weight::from_parts(15_000_000, 0)
	}

	fn request_ai_inference(prompt_len: u32) -> Weight {
		let base = Weight::from_parts(22_000_000, 0);
		let per_byte = Weight::from_parts(500, 0);
		base.saturating_add(per_byte.saturating_mul(prompt_len.into()))
	}
}

