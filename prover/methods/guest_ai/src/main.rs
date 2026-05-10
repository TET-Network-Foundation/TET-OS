//! AI 推論の完全性「指紋」: `prompt` と `response` を結合して SHA-256 し、`env::commit` で公開する。
#![no_main]
#![no_std]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use risc0_zkvm::guest::env;
use risc0_zkvm::sha::{Impl, Sha256};
use serde::{Deserialize, Serialize};

risc0_zkvm::guest::entry!(main);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AiInferenceInput {
	pub prompt: String,
	pub response: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AiInferenceCommit {
	/// `prompt || RS || response` の SHA-256（32 バイト）。
	pub fingerprint: [u8; 32],
}

fn main() {
	let input: AiInferenceInput = env::read();
	let mut buf = Vec::new();
	buf.extend_from_slice(input.prompt.as_bytes());
	buf.push(0x1e); // ASCII RS — プロンプトと応答の境界
	buf.extend_from_slice(input.response.as_bytes());
	let digest = Impl::hash_bytes(&buf);
	let mut fingerprint = [0u8; 32];
	fingerprint.copy_from_slice(digest.as_bytes());
	env::commit(&AiInferenceCommit { fingerprint });
}
