//! The CLI, run as a program: fixed inputs must give the pinned canonical texts and hashes of
//! tests/common (the same values doc_formats.rs checks against the library).

mod common;

use common::*;
use std::process::{Command, Output};

const ZERO: &str = "00000000000000000000000000000000";
/// AN12196 page 12, via sdm-backend test_sun1 (see sun_vectors.rs for the source).
const P12_URL: &str =
    "https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086";

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_tet-tag-verify"))
        .args(args)
        .output()
        .expect("runs")
}

fn stdout(o: &Output) -> String {
    String::from_utf8(o.stdout.clone()).unwrap()
}

fn scratch(name: &str, text: &str) -> std::path::PathBuf {
    let dir = std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let p = dir.join(name);
    std::fs::write(&p, text).unwrap();
    p
}

#[test]
fn verify_text() {
    let o = run(&["verify", "--key", ZERO, "--url", P12_URL]);
    assert_eq!(o.status.code(), Some(0));
    let out = stdout(&o);
    assert!(out.contains("Signature:  VALID for this key"));
    assert!(out.contains("Counter:    61"));
    assert!(out.contains("What this does not show"));
}

#[test]
fn verify_json() {
    let o = run(&[
        "verify",
        "--key",
        ZERO,
        "--url",
        P12_URL,
        "--json",
        "--last-counter",
        "60",
    ]);
    assert_eq!(o.status.code(), Some(0));
    let v: serde_json::Value = serde_json::from_str(&stdout(&o)).unwrap();
    assert_eq!(v["valid"], true);
    assert_eq!(v["mode"], "encrypted");
    assert_eq!(v["uid"], "04de5f1eacc040");
    assert_eq!(v["counter"], 61);
    assert_eq!(v["counter_went_up"], true);
    assert_eq!(v["tag_id"], TAG_ID);
    assert_eq!(v["mac_input_used"], "");
    assert_eq!(v["shows"].as_array().unwrap().len(), 1);
    assert_eq!(v["does_not_show"].as_array().unwrap().len(), 4);
}

#[test]
fn verify_json_reports_the_mac_input_and_an_invalid_signature() {
    // AN12196 page 18 data with the wrong MAC from sdm-backend test_sun2_wrong_sdmmac.
    let url = "https://www.my424dna.com/?picc_data=FD91EC264309878BE6345CBE53BADF40&enc=CEE9A53E3E463EF1F459635736738962&cmac=3CC1E7F6C6C33B33";
    let o = run(&[
        "verify",
        "--key",
        ZERO,
        "--url",
        url,
        "--mac-input-from",
        "enc",
        "--json",
    ]);
    assert_eq!(o.status.code(), Some(1));
    let v: serde_json::Value = serde_json::from_str(&stdout(&o)).unwrap();
    assert_eq!(v["valid"], false);
    assert_eq!(
        v["mac_input_used"],
        "CEE9A53E3E463EF1F459635736738962&cmac="
    );
    assert_eq!(v["counter_went_up"], serde_json::Value::Null);
}

#[test]
fn verify_bad_input_exits_2() {
    assert_eq!(
        run(&["verify", "--key", "zz", "--url", P12_URL])
            .status
            .code(),
        Some(2)
    );
}

fn registration_args() -> Vec<&'static str> {
    vec![
        "doc",
        "registration",
        "--uid",
        "04DE5F1EACC040",
        "--chip",
        "ntag424dna_tt",
        "--product",
        "Test bag",
        "--ref",
        "TB-1",
        "--image-sha256",
        "1111111111111111111111111111111111111111111111111111111111111111",
        "--verifier-url",
        "https://verify.example.org",
        "--counter",
        "61",
    ]
}

#[test]
fn doc_registration_gives_the_pinned_text_and_hash() {
    let o = run(&registration_args());
    assert_eq!(o.status.code(), Some(0));
    assert_eq!(stdout(&o), format!("{REG_JSON}\n{REG_SHA}\n"));
}

#[test]
fn doc_claim_gives_the_pinned_text_and_hash() {
    let att = "22".repeat(32);
    let o = run(&[
        "doc",
        "claim",
        "--uid",
        "04DE5F1EACC040",
        "--registration-sha256",
        REG_SHA,
        "--new-owner",
        "tet1owner",
        "--counter",
        "62",
        "--tamper",
        "closed",
        "--attestation-sha256",
        &att,
    ]);
    assert_eq!(o.status.code(), Some(0));
    assert_eq!(stdout(&o), format!("{CLAIM_JSON}\n{CLAIM_SHA}\n"));
}

#[test]
fn doc_claim_with_release_but_no_previous_is_refused() {
    let h = "33".repeat(32);
    let o = run(&[
        "doc",
        "claim",
        "--uid",
        "04DE5F1EACC040",
        "--registration-sha256",
        REG_SHA,
        "--new-owner",
        "x",
        "--counter",
        "1",
        "--release-sha256",
        &h,
        "--attestation-sha256",
        &h,
    ]);
    assert_eq!(o.status.code(), Some(2));
}

#[test]
fn doc_hash_recanonicalises() {
    // Pretty-printed with the keys in another order: same hash as the pinned canonical text.
    let v: serde_json::Value = serde_json::from_str(REG_JSON).unwrap();
    let pretty = serde_json::to_string_pretty(&v)
        .unwrap()
        .replacen("\"chip\"", "\"chip\" ", 1);
    let o = run(&[
        "doc",
        "hash",
        scratch("reg.json", &pretty).to_str().unwrap(),
    ]);
    assert_eq!(o.status.code(), Some(0));
    assert_eq!(stdout(&o), format!("{REG_SHA}\n"));
    let o = run(&[
        "doc",
        "hash",
        scratch("claim.json", CLAIM_JSON).to_str().unwrap(),
    ]);
    assert_eq!(stdout(&o), format!("{CLAIM_SHA}\n"));
}

#[test]
fn doc_hash_refuses_an_invalid_document() {
    for (name, text) in [
        ("notjson.json", "not json"),
        ("nokind.json", "{\"v\":1}"),
        ("extra.json", &REG_JSON.replacen('{', "{\"extra\":1,", 1)),
        ("v2.json", &REG_JSON.replace("\"v\":1", "\"v\":2")),
    ] {
        let o = run(&["doc", "hash", scratch(name, text).to_str().unwrap()]);
        assert_eq!(o.status.code(), Some(1), "{name}");
        assert!(o.stdout.is_empty(), "{name}");
    }
}

#[test]
fn readme_says_what_the_cli_says() {
    let readme = include_str!("../README.md");
    for s in tet_tag_verify::report::DOES_NOT_SHOW {
        assert!(
            readme.contains(&format!("- {s}\n")),
            "README is missing: {s}"
        );
    }
    assert!(readme.contains(
        "Planned, not wired: the registration hash is meant to be anchored through the existing hash-only stamp (#148)."
    ));
}

#[test]
fn doc_registration_needs_a_counter() {
    // The pinned arguments without "--counter 61": refused with a clear error, nothing printed.
    let mut args = registration_args();
    let i = args.iter().position(|a| *a == "--counter").unwrap();
    args.drain(i..i + 2);
    let o = run(&args);
    assert_eq!(o.status.code(), Some(2));
    assert!(o.stdout.is_empty());
    let err = String::from_utf8(o.stderr).unwrap();
    assert!(err.contains("--counter"), "{err}");
}
