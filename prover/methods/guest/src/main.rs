//! Minimal transfer prove guest: read (dest, value, memo), commit the same payload as public journal output.
//! AI 推論の指紋は別ゲスト `methods/guest_ai`（`/prove_ai`）を参照。
#![no_main]
#![no_std]

extern crate alloc;

use alloc::string::String;
use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

risc0_zkvm::guest::entry!(main);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferProveInput {
    pub dest: String,
    pub value: String,
    pub memo: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferProveCommit {
    pub dest: String,
    pub value: String,
    pub memo: String,
}

fn main() {
    let input: TransferProveInput = env::read();
    env::commit(&TransferProveCommit {
        dest: input.dest,
        value: input.value,
        memo: input.memo,
    });
}
