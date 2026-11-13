//! The two tag documents: round trips, and one pinned canonical text and hash per format, so
//! the canonical form cannot change without a test failing. If one of these fails after a
//! change, the change alters every record's hash: that needs a new format version, not a new
//! expected value.

mod common;

use common::*;
use tet_tag_verify::docs::*;

fn uid() -> Vec<u8> {
    hex::decode("04DE5F1EACC040").unwrap()
}

fn registration() -> TagRegistrationV1 {
    TagRegistrationV1 {
        v: 1,
        kind: REGISTRATION_KIND.into(),
        tag_id: tag_id(&uid()),
        chip: Chip::Ntag424DnaTt,
        product: Product {
            label: "Test bag".into(),
            reference: "TB-1".into(),
            images_sha256: vec!["11".repeat(32)],
        },
        verifier: "https://verify.example.org".into(),
        counter_at_registration: 61,
    }
}

fn claim(reg_sha: &str) -> TagClaimV1 {
    TagClaimV1 {
        v: 1,
        kind: CLAIM_KIND.into(),
        tag_id: tag_id(&uid()),
        registration_record_sha256: reg_sha.into(),
        previous_claim_sha256: None,
        release_sha256: None,
        new_owner: "tet1owner".into(),
        tap: Tap {
            counter: 62,
            tamper: Some(Tamper::Closed),
        },
        verifier_attestation_sha256: "22".repeat(32),
    }
}

#[test]
fn tag_id_is_pinned() {
    assert_eq!(tag_id(&uid()), TAG_ID);
}

#[test]
fn registration_canonical_form_is_pinned() {
    let r = registration();
    r.validate().unwrap();
    assert_eq!(r.canonical_json(), REG_JSON);
    assert_eq!(r.sha256(), REG_SHA);
}

#[test]
fn claim_canonical_form_is_pinned() {
    let c = claim(REG_SHA);
    c.validate().unwrap();
    assert_eq!(c.canonical_json(), CLAIM_JSON);
    assert_eq!(c.sha256(), CLAIM_SHA);
}

#[test]
fn registration_round_trip() {
    let r = registration();
    let back = TagRegistrationV1::from_json(&r.canonical_json()).unwrap();
    assert_eq!(back, r);
    assert_eq!(back.canonical_json(), r.canonical_json());
    // Key order and whitespace in the input don't change the canonical form or the hash.
    let pretty = serde_json::to_string_pretty(&r).unwrap();
    assert_eq!(
        TagRegistrationV1::from_json(&pretty).unwrap().sha256(),
        r.sha256()
    );
}

#[test]
fn claim_round_trip() {
    let mut c = claim(REG_SHA);
    let back = TagClaimV1::from_json(&c.canonical_json()).unwrap();
    assert_eq!(back, c);
    // A transfer: previous claim and release set, no tamper loop.
    c.previous_claim_sha256 = Some("33".repeat(32));
    c.release_sha256 = Some("44".repeat(32));
    c.tap.tamper = None;
    let back = TagClaimV1::from_json(&c.canonical_json()).unwrap();
    assert_eq!(back, c);
    assert!(c.canonical_json().contains("\"tamper\":null"));
}

#[test]
fn bad_documents_are_refused() {
    let mut r = registration();
    r.v = 2;
    assert_eq!(r.validate(), Err(DocError::Version(2)));
    let mut r = registration();
    r.tag_id = "04DE5F1EACC040".into(); // a raw UID instead of the hash
    assert!(r.validate().is_err());
    let mut r = registration();
    r.verifier = "http://verify.example.org".into();
    assert_eq!(r.validate(), Err(DocError::Verifier));
    let extra = registration()
        .canonical_json()
        .replacen('{', "{\"extra\":1,", 1);
    assert!(TagRegistrationV1::from_json(&extra).is_err());
    let mut c = claim(REG_SHA);
    c.release_sha256 = Some("44".repeat(32));
    assert_eq!(c.validate(), Err(DocError::ReleaseWithoutPrevious));
    let mut c = claim(REG_SHA);
    c.kind = REGISTRATION_KIND.into();
    assert!(c.validate().is_err());
}
