//! SUN/SDM test vectors. Expected values are copied, not computed here.
//!
//! Source: nfc-developer/sdm-backend, tests/test_libsdm.py at commit
//! 37585f0c76eded73798b936b17aa5e187075b78f
//! (https://github.com/nfc-developer/sdm-backend/blob/37585f0c76eded73798b936b17aa5e187075b78f/tests/test_libsdm.py).
//! That file is "implemented based on the examples provided in AN12196"; each test below names
//! the sdm-backend test it comes from and the AN12196 page that test cites, where it cites one.
//! Only AES-mode vectors are used (LRP is not implemented here).

use tet_tag_verify::sun::{self, decrypt_picc_data, parse_hex};
use tet_tag_verify::url::{Mode, verify_url};

const ZERO: [u8; 16] = [0; 16];

fn h<const N: usize>(s: &str) -> [u8; N] {
    parse_hex::<N>("test", s).unwrap()
}

/// sdm-backend test_sun1, "From AN12196 page 12":
/// https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086
/// all-zero keys; expects PICCDataTag 0xC7, UID 04DE5F1EACC040, read counter 61.
#[test]
fn an12196_p12_encrypted_picc_data() {
    let url = "https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086";
    let c = verify_url(&ZERO, None, url, None).unwrap();
    assert_eq!(c.mode, Mode::Encrypted);
    assert!(
        c.result.mac_valid,
        "SDMMAC 94EED9EE65337086 should check with the all-zero key"
    );
    assert_eq!(c.result.uid, h::<7>("04DE5F1EACC040"));
    assert_eq!(c.result.counter, 61);
    let plain = decrypt_picc_data(&ZERO, &h::<16>("EF963FF7828658A599F3041510671E88"));
    assert_eq!(plain[0], 0xC7);
}

/// sdm-backend test_sun2, "FROM AN12196 page 18":
/// https://www.my424dna.com/?picc_data=FD91EC264309878BE6345CBE53BADF40&enc=CEE9A53E3E463EF1F459635736738962&cmac=ECC1E7F6C6C73BF6
/// all-zero keys; the MAC input is the URL text from the enc value up to the MAC
/// ("CEE9…8962&cmac="); expects UID 04958CAA5C5E80, read counter 8.
#[test]
fn an12196_p18_encrypted_with_file_data_in_mac_input() {
    let url = "https://www.my424dna.com/?picc_data=FD91EC264309878BE6345CBE53BADF40&enc=CEE9A53E3E463EF1F459635736738962&cmac=ECC1E7F6C6C73BF6";
    let c = verify_url(&ZERO, None, url, Some("enc")).unwrap();
    assert!(c.result.mac_valid);
    assert_eq!(c.result.uid, h::<7>("04958CAA5C5E80"));
    assert_eq!(c.result.counter, 8);
}

/// sdm-backend test_sun2_wrong_sdmmac: same data, SDMMAC 3CC1E7F6C6C33B33 must fail.
#[test]
fn an12196_p18_wrong_mac_fails() {
    let url = "https://www.my424dna.com/?picc_data=FD91EC264309878BE6345CBE53BADF40&enc=CEE9A53E3E463EF1F459635736738962&cmac=3CC1E7F6C6C33B33";
    let c = verify_url(&ZERO, None, url, Some("enc")).unwrap();
    assert!(!c.result.mac_valid);
}

/// sdm-backend test_sun3_custom (no AN12196 page cited): separate keys,
/// meta 42aff114f2cb3b6141be6dc95dfc5416, file b62a9baf092439bd43c62aee96b970c5;
/// MAC input is the enc-file-data hex alone (SDMMAC_PARAM = ""); expects UID 041d3c8a2d6b80, counter 291.
#[test]
fn sdm_backend_custom_separate_keys() {
    let meta = h::<16>("42aff114f2cb3b6141be6dc95dfc5416");
    let file = h::<16>("b62a9baf092439bd43c62aee96b970c5");
    let r = sun::verify_encrypted(
        &meta,
        &file,
        "8ACADDEF0A9B62CDAE39A16B83FC14DE",
        "238B2543A8DEBAD8",
        b"B8436E11F627BB7F543FCC0C1E0D1A89",
    )
    .unwrap();
    assert!(r.mac_valid);
    assert_eq!(r.uid, h::<7>("041d3c8a2d6b80"));
    assert_eq!(r.counter, 291);
}

/// sdm-backend test_plain_sdm (no AN12196 page cited): plain mirroring, all-zero key,
/// UID 041E3C8A2D6B80, counter 000006 (as written in the URL), SDMMAC 4B00064004B0B3D3.
#[test]
fn plain_mirroring() {
    let url = "https://example.org/tag?uid=041E3C8A2D6B80&ctr=000006&cmac=4B00064004B0B3D3";
    let c = verify_url(&ZERO, None, url, None).unwrap();
    assert_eq!(c.mode, Mode::Plain);
    assert!(c.result.mac_valid);
    assert_eq!(c.result.counter, 6);
}

/// sdm-backend test_plain_sdm_wrong: SDMMAC AB00064004B0B3AB must fail.
#[test]
fn plain_mirroring_wrong_mac_fails() {
    let r = sun::verify_plain(&ZERO, "041E3C8A2D6B80", "000006", "AB00064004B0B3AB", b"").unwrap();
    assert!(!r.mac_valid);
}

/// Not from a source: the right MAC under a different key must fail, and a wrong key on
/// encrypted PICCData must not decrypt to tag 0xC7.
#[test]
fn wrong_key_fails() {
    let other = h::<16>("00000000000000000000000000000001");
    let r = sun::verify_plain(&other, "041E3C8A2D6B80", "000006", "4B00064004B0B3D3", b"").unwrap();
    assert!(!r.mac_valid);
    let url = "https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086";
    assert!(verify_url(&other, None, url, None).is_err());
}

/// Not from a source: a MAC-input start placed after the MAC is refused, not read as an empty
/// input (which would leave the data meant to be covered unchecked).
#[test]
fn mac_input_after_mac_is_refused() {
    let url = "https://www.my424dna.com/?picc_data=FD91EC264309878BE6345CBE53BADF40&cmac=ECC1E7F6C6C73BF6&enc=CEE9A53E3E463EF1F459635736738962";
    assert!(verify_url(&ZERO, None, url, Some("enc")).is_err());
}

/// Not from a source: a repeated parameter (two MACs here) is refused, not resolved silently.
#[test]
fn repeated_parameter_is_refused() {
    let url = "https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=0000000000000000&c=94EED9EE65337086";
    assert!(verify_url(&ZERO, None, url, None).is_err());
}
