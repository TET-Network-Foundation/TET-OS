//! NTAG 424 DNA SUN/SDM checks, AES mode, as described in NXP AN12196
//! ("NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints").
//!
//! - Plain mirroring: the URL carries the UID and SDMReadCtr as hex, plus the SDMMAC.
//! - Encrypted PICCData: the URL carries AES-CBC(K_SDMMetaRead, IV = 0, PICCDataTag ‖ UID ‖
//!   SDMReadCtr ‖ padding), plus the SDMMAC. PICCDataTag 0xC7 = UID mirrored, counter
//!   mirrored, UID length 7.
//!
//! The SDMMAC is CMAC(K_SesSDMFileReadMAC, MAC input), truncated to the 8 odd-indexed bytes,
//! where K_SesSDMFileReadMAC = CMAC(K_SDMFileRead, SV2) and
//! SV2 = 3C C3 00 01 00 80 ‖ UID ‖ SDMReadCtr (LSB first), zero-padded to 16 bytes.
//! The MAC input is the URL text from SDMMACInputOffset up to the MAC; with the usual
//! configuration (SDMMACInputOffset = SDMMACOffset) it is empty.
//!
//! LRP mode and per-tag key diversification (AN10922) are not implemented.

use aes::Aes128;
use aes::cipher::{BlockDecrypt, KeyInit, generic_array::GenericArray};
use cmac::{Cmac, Mac};

pub type Key = [u8; 16];

/// PICCDataTag for "UID mirrored, counter mirrored, 7-byte UID".
pub const PICC_DATA_TAG_UID_CTR_7: u8 = 0xC7;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SunError {
    BadHex(&'static str),
    BadLength {
        what: &'static str,
        want: usize,
        got: usize,
    },
    /// PICCData decrypted to something other than tag 0xC7 (wrong key, or a configuration
    /// this crate doesn't read).
    UnexpectedPiccDataTag(u8),
}

impl std::fmt::Display for SunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SunError::BadHex(what) => write!(f, "{what} is not valid hex"),
            SunError::BadLength { what, want, got } => {
                write!(f, "{what} must be {want} bytes, got {got}")
            }
            SunError::UnexpectedPiccDataTag(t) => write!(
                f,
                "the decrypted data starts with {t:#04x}, not 0xc7: the key is wrong, or the tag uses a setup this tool doesn't read"
            ),
        }
    }
}

impl std::error::Error for SunError {}

/// What one tap's SUN data says, after the check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SunResult {
    pub uid: [u8; 7],
    /// SDMReadCtr as a number.
    pub counter: u32,
    /// Whether the SDMMAC in the URL matches the one computed with the given key.
    pub mac_valid: bool,
}

pub fn parse_hex<const N: usize>(what: &'static str, s: &str) -> Result<[u8; N], SunError> {
    let v = hex::decode(s.trim()).map_err(|_| SunError::BadHex(what))?;
    let got = v.len();
    v.try_into()
        .map_err(|_| SunError::BadLength { what, want: N, got })
}

fn cmac(key: &Key, data: &[u8]) -> [u8; 16] {
    let mut m = <Cmac<Aes128> as Mac>::new_from_slice(key).expect("16-byte key");
    m.update(data);
    m.finalize().into_bytes().into()
}

/// K_SesSDMFileReadMAC for this UID and counter (counter as the 3 bytes LSB first).
pub fn session_mac_key(file_read_key: &Key, uid: &[u8; 7], ctr_le: &[u8; 3]) -> Key {
    let mut sv2 = [0u8; 16];
    sv2[..6].copy_from_slice(&[0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]);
    sv2[6..13].copy_from_slice(uid);
    sv2[13..16].copy_from_slice(ctr_le);
    cmac(file_read_key, &sv2)
}

/// The 8-byte SDMMAC: the odd-indexed bytes of CMAC(session key, MAC input).
pub fn sdmmac(file_read_key: &Key, uid: &[u8; 7], ctr_le: &[u8; 3], mac_input: &[u8]) -> [u8; 8] {
    let full = cmac(&session_mac_key(file_read_key, uid, ctr_le), mac_input);
    let mut out = [0u8; 8];
    for (i, b) in out.iter_mut().enumerate() {
        *b = full[2 * i + 1];
    }
    out
}

/// Constant-time comparison of two MACs.
fn mac_eq(a: &[u8; 8], b: &[u8; 8]) -> bool {
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Plain mirroring. `ctr_hex` is the counter as the tag writes it in the URL (most significant
/// byte first, e.g. "000006").
pub fn verify_plain(
    file_read_key: &Key,
    uid_hex: &str,
    ctr_hex: &str,
    mac_hex: &str,
    mac_input: &[u8],
) -> Result<SunResult, SunError> {
    let uid: [u8; 7] = parse_hex("UID", uid_hex)?;
    let ctr_be: [u8; 3] = parse_hex("counter", ctr_hex)?;
    let mac: [u8; 8] = parse_hex("SDMMAC", mac_hex)?;
    let ctr_le = [ctr_be[2], ctr_be[1], ctr_be[0]];
    let want = sdmmac(file_read_key, &uid, &ctr_le, mac_input);
    Ok(SunResult {
        uid,
        counter: u32::from_le_bytes([ctr_le[0], ctr_le[1], ctr_le[2], 0]),
        mac_valid: mac_eq(&want, &mac),
    })
}

/// Encrypted PICCData (16 bytes, AES). The PICCData is decrypted with `meta_read_key`; the
/// SDMMAC is checked with `file_read_key` (often the same key).
pub fn verify_encrypted(
    meta_read_key: &Key,
    file_read_key: &Key,
    picc_hex: &str,
    mac_hex: &str,
    mac_input: &[u8],
) -> Result<SunResult, SunError> {
    let enc: [u8; 16] = parse_hex("encrypted PICCData", picc_hex)?;
    let mac: [u8; 8] = parse_hex("SDMMAC", mac_hex)?;
    let plain = decrypt_picc_data(meta_read_key, &enc);
    if plain[0] != PICC_DATA_TAG_UID_CTR_7 {
        return Err(SunError::UnexpectedPiccDataTag(plain[0]));
    }
    let uid: [u8; 7] = plain[1..8].try_into().expect("7 bytes");
    let ctr_le: [u8; 3] = plain[8..11].try_into().expect("3 bytes");
    let want = sdmmac(file_read_key, &uid, &ctr_le, mac_input);
    Ok(SunResult {
        uid,
        counter: u32::from_le_bytes([ctr_le[0], ctr_le[1], ctr_le[2], 0]),
        mac_valid: mac_eq(&want, &mac),
    })
}

/// The decrypted PICCData block. AES-CBC with a zero IV over one block is a single block
/// decryption.
pub fn decrypt_picc_data(meta_read_key: &Key, enc: &[u8; 16]) -> [u8; 16] {
    let mut block = GenericArray::from(*enc);
    Aes128::new(&GenericArray::from(*meta_read_key)).decrypt_block(&mut block);
    block.into()
}
