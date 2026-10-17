//! Per-tag key diversification, AES-128, as described in NXP AN10922 ("Symmetric key
//! diversifications"), section 2.2.1.
//!
//! The diversification input D is UID ‖ AID ‖ system identifier, 1 to 31 bytes. M = 0x01 ‖ D.
//! When M is shorter than 32 bytes it is padded with 0x80 and then zeros to 32 bytes, and the
//! CMAC subkey K2 is used; a 32-byte M uses K1. The diversified key is CMAC(master, M) over those
//! two blocks.
//!
//! For M of 17 to 32 bytes this is exactly SP 800-38B CMAC. For M of 16 bytes or shorter,
//! AN10922 still runs two blocks (SP 800-38B would stop at one). That reading of the document is
//! implemented here and is not covered by a published vector yet; see tests/diversify_vectors.rs.
//!
//! Only AES-128 is implemented (the NTAG 424 DNA key size); AN10922's other key types are not.

use crate::sun::Key;
use aes::Aes128;
use aes::cipher::{BlockEncrypt, KeyInit, generic_array::GenericArray};

/// The longest diversification input AN10922 allows for AES-128 (0x01 ‖ D must fit two blocks).
pub const MAX_INPUT: usize = 31;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiversifyError {
    EmptyInput,
    InputTooLong(usize),
}

impl std::fmt::Display for DiversifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DiversifyError::EmptyInput => write!(f, "the diversification input is empty"),
            DiversifyError::InputTooLong(n) => write!(
                f,
                "the diversification input is {n} bytes; AN10922 allows at most {MAX_INPUT} for AES-128"
            ),
        }
    }
}

impl std::error::Error for DiversifyError {}

/// The diversification input D = UID ‖ AID ‖ system identifier, as AN10922 lays it out.
pub fn diversification_input(uid: &[u8], aid: &[u8], system_id: &[u8]) -> Vec<u8> {
    let mut d = Vec::with_capacity(uid.len() + aid.len() + system_id.len());
    d.extend_from_slice(uid);
    d.extend_from_slice(aid);
    d.extend_from_slice(system_id);
    d
}

/// The diversified AES-128 key for `input` (D, 1 to 31 bytes) under `master`.
pub fn diversify_aes128(master: &Key, input: &[u8]) -> Result<Key, DiversifyError> {
    if input.is_empty() {
        return Err(DiversifyError::EmptyInput);
    }
    if input.len() > MAX_INPUT {
        return Err(DiversifyError::InputTooLong(input.len()));
    }
    // M = 0x01 ‖ D, padded to two blocks with 0x80 00… when shorter.
    let mut m = [0u8; 32];
    m[0] = 0x01;
    m[1..=input.len()].copy_from_slice(input);
    let padded = input.len() < MAX_INPUT;
    if padded {
        m[input.len() + 1] = 0x80;
    }
    let cipher = Aes128::new(&GenericArray::from(*master));
    let k1 = double(encrypt_block(&cipher, [0u8; 16]));
    let k2 = double(k1);
    let subkey = if padded { k2 } else { k1 };
    let x = encrypt_block(&cipher, m[..16].try_into().expect("16 bytes"));
    let mut last = [0u8; 16];
    for (i, l) in last.iter_mut().enumerate() {
        *l = x[i] ^ m[16 + i] ^ subkey[i];
    }
    Ok(encrypt_block(&cipher, last))
}

fn encrypt_block(cipher: &Aes128, block: [u8; 16]) -> [u8; 16] {
    let mut b = GenericArray::from(block);
    cipher.encrypt_block(&mut b);
    b.into()
}

/// The CMAC subkey step: shift left by one bit, and fold the carried-out bit back in as 0x87
/// (SP 800-38B, section 6.1, for a 128-bit block).
fn double(b: [u8; 16]) -> [u8; 16] {
    let mut out = [0u8; 16];
    let mut carry = 0u8;
    for (o, &x) in out.iter_mut().zip(b.iter()).rev() {
        *o = (x << 1) | carry;
        carry = x >> 7;
    }
    if carry == 1 {
        out[15] ^= 0x87;
    }
    out
}
