//! AN10922 key diversification, AES-128. Expected values are copied, not computed here.
//!
//! Source: NXP AN10922 "Symmetric key diversifications", section 2.2.1 (AES-128), the worked
//! example in that section. The vector was written down from the document and then confirmed by
//! an independent implementation of the same steps; an exact 128-bit match rules out a
//! misremembered value. Check the section number against the document when it is to hand.
//!
//! What the example does not cover: an input short enough that 0x01 ‖ D fits one block
//! (16 bytes or less). AN10922 is read here as padding to two blocks regardless; that case has no
//! published vector in this file, and `short_input_runs_two_blocks` only pins the reading.

use aes::Aes128;
use cmac::{Cmac, Mac};
use tet_tag_verify::diversify::{
    DiversifyError, MAX_INPUT, diversification_input, diversify_aes128,
};
use tet_tag_verify::sun::parse_hex;

fn h<const N: usize>(s: &str) -> [u8; N] {
    parse_hex::<N>("test", s).unwrap()
}

/// AN10922 section 2.2.1, AES-128 example: master key 00112233445566778899AABBCCDDEEFF,
/// UID 04782E21801D80, AID 3042F5, system identifier 4E585020416275 ("NXP Abu").
const MASTER: &str = "00112233445566778899AABBCCDDEEFF";
const UID: &str = "04782E21801D80";
const AID: &str = "3042F5";
const SID: &str = "4E585020416275";
const DIVERSIFIED: &str = "A8DD63A3B89D54B37CA802473FDA9175";

#[test]
fn an10922_aes128_example() {
    let d = diversification_input(&h::<7>(UID), &h::<3>(AID), &h::<7>(SID));
    assert_eq!(d.len(), 17);
    let k = diversify_aes128(&h::<16>(MASTER), &d).unwrap();
    assert_eq!(k, h::<16>(DIVERSIFIED));
}

/// For 0x01 ‖ D of 17 to 32 bytes AN10922 is plain SP 800-38B CMAC, so the result must match an
/// independent CMAC implementation (the `cmac` crate), on both the padded (K2) and the full
/// two-block (K1) path.
#[test]
fn matches_sp800_38b_cmac_for_two_block_inputs() {
    let master = h::<16>(MASTER);
    for len in 16..=MAX_INPUT {
        let d: Vec<u8> = (0..len as u8).map(|i| i.wrapping_mul(37).wrapping_add(5)).collect();
        let mut m = vec![0x01u8];
        m.extend_from_slice(&d);
        let mut c = <Cmac<Aes128> as Mac>::new_from_slice(&master).unwrap();
        c.update(&m);
        let want: [u8; 16] = c.finalize().into_bytes().into();
        assert_eq!(diversify_aes128(&master, &d).unwrap(), want, "D of {len} bytes");
    }
}

/// An input of 15 bytes or less (0x01 ‖ D in one block): AN10922 is read as still padding to two
/// blocks with K2, which differs from one-block SP 800-38B CMAC. No published vector covers this;
/// if the document turns out to say otherwise, this test and `diversify_aes128` change together.
#[test]
fn short_input_runs_two_blocks() {
    let master = h::<16>(MASTER);
    let d = h::<7>(UID);
    let two_block = diversify_aes128(&master, &d).unwrap();
    let mut c = <Cmac<Aes128> as Mac>::new_from_slice(&master).unwrap();
    c.update(&[&[0x01u8][..], &d[..]].concat());
    let one_block: [u8; 16] = c.finalize().into_bytes().into();
    assert_ne!(two_block, one_block);
    assert_eq!(diversify_aes128(&master, &d).unwrap(), two_block, "deterministic");
}

#[test]
fn input_length_limits() {
    let master = h::<16>(MASTER);
    assert_eq!(diversify_aes128(&master, &[]), Err(DiversifyError::EmptyInput));
    assert_eq!(
        diversify_aes128(&master, &[0u8; 32]),
        Err(DiversifyError::InputTooLong(32))
    );
    assert!(diversify_aes128(&master, &[0u8; 31]).is_ok());
    assert!(diversify_aes128(&master, &[0u8; 1]).is_ok());
}
