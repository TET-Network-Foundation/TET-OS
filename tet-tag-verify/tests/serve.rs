//! `serve`, run in-process on an ephemeral port and spoken to over plain TCP, so every request goes
//! through the real HTTP stack. Taps are the AN12196 / sdm-backend vectors of sun_vectors.rs, plus
//! taps made here for a master key (no published vector covers serve's key lookup).

mod common;

use aes::Aes128;
use aes::cipher::{BlockEncrypt, KeyInit, generic_array::GenericArray};
use common::TAG_ID;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tet_tag_verify::diversify::{diversification_input, diversify_aes128};
use tet_tag_verify::report::{
    DOES_NOT_SHOW, DOES_NOT_SHOW_HEADING, SHOWS_HEADING, SHOWS_INVALID, shows_valid,
};
use tet_tag_verify::serve::{MAX_REQUEST_LINE, Server, run};
use tet_tag_verify::sun::{Key, parse_hex, sdmmac};

const ZERO: &str = "00000000000000000000000000000000";
/// AN12196 page 12 (sdm-backend test_sun1): all-zero key, UID 04DE5F1EACC040, counter 61.
const P12: &str = "/tap?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086";
const P12_UID: &str = "04de5f1eacc040";
/// sdm-backend test_plain_sdm: all-zero key, UID 041E3C8A2D6B80, counter 6.
const PLAIN: &str = "/tap?uid=041E3C8A2D6B80&ctr=000006&cmac=4B00064004B0B3D3";
const JSON: &str = "application/json";
const HTML: &str = "text/html";

/// The log, captured.
#[derive(Clone, Default)]
struct Log(Arc<Mutex<Vec<u8>>>);

impl Write for Log {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Log {
    fn lines(&self) -> Vec<String> {
        String::from_utf8(self.0.lock().unwrap().clone())
            .unwrap()
            .lines()
            .map(str::to_string)
            .collect()
    }
}

/// A fresh directory for one test.
fn dir(name: &str) -> PathBuf {
    let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("serve-{name}"));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn keys_file(d: &Path, json: &str, mode: u32) -> PathBuf {
    let p = d.join("keys.json");
    std::fs::write(&p, json).unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode)).unwrap();
    p
}

fn load(d: &Path, keys_json: &str, log: &Log) -> Server {
    Server::load(
        &keys_file(d, keys_json, 0o600),
        &d.join("state.json"),
        Box::new(log.clone()),
    )
    .unwrap_or_else(|e| panic!("load: {e}"))
}

/// Start `server` on an ephemeral localhost port, on its own thread.
fn start(server: Server) -> SocketAddr {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    l.set_nonblocking(true).unwrap();
    let addr = l.local_addr().unwrap();
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                run(tokio::net::TcpListener::from_std(l).unwrap(), server)
                    .await
                    .unwrap()
            })
    });
    addr
}

struct Resp {
    status: u16,
    head: String,
    body: String,
}

fn send(addr: SocketAddr, raw: &str) -> Resp {
    let mut s = TcpStream::connect(addr).unwrap();
    s.write_all(raw.as_bytes()).unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).unwrap();
    let (head, body) = out.split_once("\r\n\r\n").expect("a response");
    Resp {
        status: head[9..12].parse().unwrap(),
        head: head.to_ascii_lowercase(),
        body: body.to_string(),
    }
}

fn get(addr: SocketAddr, target: &str, accept: &str) -> Resp {
    send(
        addr,
        &format!(
            "GET {target} HTTP/1.1\r\nHost: localhost\r\nAccept: {accept}\r\nConnection: close\r\n\r\n"
        ),
    )
}

fn get_json(addr: SocketAddr, target: &str) -> serde_json::Value {
    let r = get(addr, target, JSON);
    assert_eq!(r.status, 200, "{}", r.body);
    serde_json::from_str(&r.body).unwrap()
}

fn state(d: &Path) -> Option<serde_json::Value> {
    std::fs::read_to_string(d.join("state.json"))
        .ok()
        .map(|t| serde_json::from_str(&t).unwrap())
}

fn per_tag(uid: &str, key: &str) -> String {
    format!("{{\"{uid}\": \"{key}\"}}")
}

#[test]
fn first_tap_is_valid_and_the_same_tap_again_is_replayed() {
    let d = dir("replay");
    let log = Log::default();
    let addr = start(load(&d, &per_tag(P12_UID, ZERO), &log));

    let v = get_json(addr, P12);
    assert_eq!(v["result"], "VALID");
    assert_eq!(v["valid"], true);
    assert_eq!(v["reason"], serde_json::Value::Null);
    assert_eq!(v["replayed"], false);
    assert_eq!(v["mode"], "encrypted");
    assert_eq!(v["uid"], P12_UID);
    assert_eq!(v["counter"], 61);
    assert_eq!(v["counter_went_up"], serde_json::Value::Null);
    assert_eq!(v["tag_id"], TAG_ID);
    assert_eq!(v["mac_input_used"], "");
    assert_eq!(v["shows"][0], shows_valid(61));
    assert_eq!(
        v["does_not_show"].as_array().unwrap().len(),
        DOES_NOT_SHOW.len()
    );
    assert_eq!(state(&d).unwrap(), serde_json::json!({ P12_UID: 61 }));

    let v = get_json(addr, P12);
    assert_eq!(v["result"], "INVALID");
    assert_eq!(v["valid"], false);
    assert_eq!(v["reason"], "replayed");
    assert_eq!(v["replayed"], true);
    assert_eq!(v["counter"], 61);
    assert_eq!(v["counter_went_up"], false);
    assert_eq!(state(&d).unwrap(), serde_json::json!({ P12_UID: 61 }));

    assert_eq!(
        log.lines(),
        [
            format!("tag_id={TAG_ID} counter=61 result=VALID"),
            format!("tag_id={TAG_ID} counter=61 result=INVALID"),
        ]
    );
}

/// The replay check reads the state file, not only memory: a new server on the same state
/// refuses the tap the old one accepted.
#[test]
fn a_replay_is_refused_after_a_restart() {
    let d = dir("restart");
    let first = start(load(&d, &per_tag(P12_UID, ZERO), &Log::default()));
    assert_eq!(get_json(first, P12)["result"], "VALID");
    let second = start(load(&d, &per_tag(P12_UID, ZERO), &Log::default()));
    let v = get_json(second, P12);
    assert_eq!(v["reason"], "replayed");
    assert_eq!(v["replayed"], true);
}

/// Accepted only when the counter is above the stored one: 60 → 61 goes through; 61 and 62
/// stored refuse a tap at 61.
#[test]
fn only_a_counter_above_the_stored_one_is_accepted() {
    for (stored, accepted) in [(60, true), (61, false), (62, false)] {
        let d = dir(&format!("stored-{stored}"));
        std::fs::write(d.join("state.json"), format!("{{\"{P12_UID}\": {stored}}}")).unwrap();
        let addr = start(load(&d, &per_tag(P12_UID, ZERO), &Log::default()));
        let v = get_json(addr, P12);
        assert_eq!(v["valid"], accepted, "stored {stored}");
        assert_eq!(v["replayed"], !accepted, "stored {stored}");
        assert_eq!(v["counter_went_up"], accepted, "stored {stored}");
        let want = if accepted { 61 } else { stored };
        assert_eq!(state(&d).unwrap()[P12_UID], want, "stored {stored}");
    }
}

/// The key is found (the PICCData is untouched), so the request reaches the MAC check and only
/// the MAC can refuse it. Nothing is stored.
#[test]
fn a_tampered_cmac_is_invalid() {
    let d = dir("tampered");
    let addr = start(load(&d, &per_tag(P12_UID, ZERO), &Log::default()));
    let tampered = P12.replace("c=94EED9EE65337086", "c=94EED9EE65337087");
    let v = get_json(addr, &tampered);
    assert_eq!(v["result"], "INVALID");
    assert_eq!(v["valid"], false);
    assert_eq!(v["reason"], "signature does not match");
    assert_eq!(v["replayed"], false);
    assert_eq!(v["shows"][0], SHOWS_INVALID);
    assert_eq!(state(&d), None);
    // And the genuine tap is still accepted afterwards.
    assert_eq!(get_json(addr, P12)["result"], "VALID");
}

#[test]
fn plain_mirroring_is_read_too() {
    let d = dir("plain");
    let addr = start(load(&d, &per_tag("041e3c8a2d6b80", ZERO), &Log::default()));
    let v = get_json(addr, PLAIN);
    assert_eq!(v["result"], "VALID");
    assert_eq!(v["mode"], "plain");
    assert_eq!(v["counter"], 6);
    assert_eq!(get_json(addr, PLAIN)["reason"], "replayed");
}

/// A tag the file has no key for: refused with the same status and shape as any other refusal,
/// and nothing about the tag (UID, counter, tag ID) is echoed back.
#[test]
fn a_uid_without_a_key_is_invalid_and_nothing_about_it_is_echoed() {
    let d = dir("nokey");
    let log = Log::default();
    // The same all-zero key, filed under another UID: P12 decrypts with it, to a UID not in the file.
    let addr = start(load(&d, &per_tag("04958caa5c5e80", ZERO), &log));
    for target in [P12, PLAIN] {
        let r = get(addr, target, JSON);
        assert_eq!(r.status, 200);
        let v: serde_json::Value = serde_json::from_str(&r.body).unwrap();
        assert_eq!(v["result"], "INVALID", "{target}");
        assert_eq!(v["valid"], false);
        assert_eq!(v["reason"], "no key for this tag");
        assert_eq!(v["replayed"], false);
        assert_eq!(v["uid"], "");
        assert_eq!(v["tag_id"], "");
        assert_eq!(v["counter"], 0);
        for secret in [P12_UID, "041e3c8a2d6b80", TAG_ID] {
            assert!(
                !r.body.to_lowercase().contains(secret),
                "{target} echoed {secret}"
            );
        }
    }
    assert_eq!(state(&d), None);
    assert_eq!(log.lines(), ["tag_id=- counter=- result=INVALID"; 2]);
}

#[test]
fn a_keys_file_others_can_read_is_refused() {
    let key = "8a1f00c3d2e4b5a6978869504132f1e0";
    for mode in [0o644, 0o640, 0o604, 0o660] {
        let d = dir(&format!("mode-{mode:o}"));
        let err = Server::load(
            &keys_file(&d, &per_tag(P12_UID, key), mode),
            &d.join("state.json"),
            Box::new(Log::default()),
        )
        .err()
        .unwrap_or_else(|| panic!("mode {mode:o} was accepted"));
        assert!(err.contains("must be 0600"), "{err}");
        assert!(!err.contains(key));
    }
    // The binary refuses to start, before it listens.
    let d = dir("mode-cli");
    let keys = keys_file(&d, &per_tag(P12_UID, key), 0o644);
    let o = std::process::Command::new(env!("CARGO_BIN_EXE_tet-tag-verify"))
        .args(["serve", "--listen", "127.0.0.1:0", "--keys"])
        .arg(&keys)
        .arg("--state")
        .arg(d.join("state.json"))
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(2));
    let stderr = String::from_utf8(o.stderr).unwrap();
    assert!(stderr.contains("must be 0600"), "{stderr}");
    assert!(!stderr.contains("listening"));
    assert!(!stderr.contains(key));
}

/// Bad key material is refused without being quoted.
#[test]
fn keys_file_errors_never_quote_a_key() {
    let short = "8a1f00c3d2e4b5a6978869504132f1";
    let not_hex = "8a1f00c3d2e4b5a6978869504132f1zz";
    for json in [
        per_tag(P12_UID, short),
        per_tag(P12_UID, not_hex),
        format!("{{\"master\": \"{short}\", \"aid\": \"f5f4f3\", \"sid\": \"\"}}"),
        format!("{{\"{P12_UID}\": \"{not_hex}\""),
    ] {
        let d = dir("badkey");
        let err = Server::load(
            &keys_file(&d, &json, 0o600),
            &d.join("state.json"),
            Box::new(Log::default()),
        )
        .err()
        .unwrap_or_else(|| panic!("accepted {json}"));
        assert!(!err.contains(short) && !err.contains(not_hex), "{err}");
    }
}

#[test]
fn only_get_is_allowed() {
    let d = dir("methods");
    let addr = start(load(&d, &per_tag(P12_UID, ZERO), &Log::default()));
    for m in ["POST", "PUT", "DELETE", "HEAD"] {
        let r = send(
            addr,
            &format!(
                "{m} {P12} HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            ),
        );
        assert_eq!(r.status, 405, "{m}");
        assert!(r.head.contains("allow: get"), "{m}");
    }
    // None of those counted as a tap.
    assert_eq!(state(&d), None);
    assert_eq!(get_json(addr, P12)["result"], "VALID");
}

#[test]
fn a_request_line_over_2kb_is_refused() {
    let d = dir("long");
    let addr = start(load(&d, &per_tag(P12_UID, ZERO), &Log::default()));
    // "GET " + target + " HTTP/1.1" is 13 bytes beyond the target.
    let pad = |line: usize| format!("{P12}&x={}", "a".repeat(line - 13 - P12.len() - 3));
    let at_limit = pad(MAX_REQUEST_LINE);
    assert_eq!(format!("GET {at_limit} HTTP/1.1").len(), MAX_REQUEST_LINE);
    assert_eq!(get(addr, &at_limit, JSON).status, 200);
    assert_eq!(get(addr, &pad(MAX_REQUEST_LINE + 1), JSON).status, 414);
}

#[test]
fn the_html_page_has_both_sections() {
    let d = dir("html");
    let addr = start(load(&d, &per_tag(P12_UID, ZERO), &Log::default()));
    let r = get(addr, P12, HTML);
    assert_eq!(r.status, 200);
    assert!(r.head.contains("content-type: text/html"));
    assert!(r.body.contains("<h1>VALID</h1>"));
    assert!(r.body.contains(&format!("<h2>{SHOWS_HEADING}</h2>")));
    assert!(r.body.contains(&format!("<li>{}</li>", shows_valid(61))));
    assert!(
        r.body
            .contains(&format!("<h2>{DOES_NOT_SHOW_HEADING}</h2>"))
    );
    for s in DOES_NOT_SHOW {
        assert!(r.body.contains(&format!("<li>{s}</li>")), "missing: {s}");
    }
    let r = get(addr, P12, HTML);
    assert!(r.body.contains("<h1>INVALID: replayed</h1>"));
    assert!(
        r.body
            .contains(&format!("<h2>{DOES_NOT_SHOW_HEADING}</h2>"))
    );
}

// A master key (AN10922). These taps are made here with the library's own SDMMAC and the aes
// crate, so they test serve's key lookup, not the crypto (sun_vectors.rs and
// diversify_vectors.rs cover that against published vectors).

const MASTER: &str = "00112233445566778899aabbccddeeff";
const META: &str = "3c4d5e6f708192a3b4c5d6e7f8091a2b";
const AID: &str = "3042f5";
const SID: &str = "4e585020416275";
const UID: &str = "04782e21801d80";

fn master_keys(meta: bool) -> String {
    let meta = if meta {
        format!(", \"meta\": \"{META}\"")
    } else {
        String::new()
    };
    format!("{{\"master\": \"{MASTER}\", \"aid\": \"{AID}\", \"sid\": \"{SID}\"{meta}}}")
}

fn h<const N: usize>(s: &str) -> [u8; N] {
    parse_hex::<N>("test", s).unwrap()
}

fn derived() -> Key {
    let d = diversification_input(&h::<7>(UID), &h::<3>(AID), &hex::decode(SID).unwrap());
    diversify_aes128(&h::<16>(MASTER), &d).unwrap()
}

fn plain_tap(mac_key: &Key, ctr: u32) -> String {
    let ctr_le = [ctr as u8, (ctr >> 8) as u8, (ctr >> 16) as u8];
    let mac = sdmmac(mac_key, &h::<7>(UID), &ctr_le, b"");
    format!(
        "/tap?uid={}&ctr={:06X}&cmac={}",
        UID.to_uppercase(),
        ctr,
        hex::encode_upper(mac)
    )
}

fn encrypted_tap(meta: &Key, mac_key: &Key, ctr: u32) -> String {
    let ctr_le = [ctr as u8, (ctr >> 8) as u8, (ctr >> 16) as u8];
    let mut block = [0u8; 16];
    block[0] = 0xC7;
    block[1..8].copy_from_slice(&h::<7>(UID));
    block[8..11].copy_from_slice(&ctr_le);
    block[11..].copy_from_slice(&[0x5a, 0x17, 0x9c, 0x02, 0xe4]);
    let mut b = GenericArray::from(block);
    Aes128::new(&GenericArray::from(*meta)).encrypt_block(&mut b);
    let mac = sdmmac(mac_key, &h::<7>(UID), &ctr_le, b"");
    format!(
        "/tap?picc_data={}&cmac={}",
        hex::encode_upper(b),
        hex::encode_upper(mac)
    )
}

#[test]
fn a_master_key_checks_with_the_derived_key_only() {
    let d = dir("master-plain");
    let log = Log::default();
    let addr = start(load(&d, &master_keys(false), &log));
    // MAC'd with the master key itself: the tag's key is the derived one, so this fails.
    let v = get_json(addr, &plain_tap(&h::<16>(MASTER), 5));
    assert_eq!(v["reason"], "signature does not match");
    let v = get_json(addr, &plain_tap(&derived(), 5));
    assert_eq!(v["result"], "VALID");
    assert_eq!(v["counter"], 5);
    assert_eq!(
        get_json(addr, &plain_tap(&derived(), 5))["reason"],
        "replayed"
    );
    assert_eq!(get_json(addr, &plain_tap(&derived(), 6))["result"], "VALID");
    // Encrypted PICCData can't be read without a PICCData key.
    let v = get_json(addr, &encrypted_tap(&h::<16>(META), &derived(), 7));
    assert_eq!(v["reason"], "no key for this tag");
}

#[test]
fn a_master_key_with_a_piccdata_key_reads_encrypted_taps() {
    let d = dir("master-enc");
    let addr = start(load(&d, &master_keys(true), &Log::default()));
    let meta = h::<16>(META);
    let v = get_json(addr, &encrypted_tap(&meta, &h::<16>(MASTER), 9));
    assert_eq!(v["reason"], "signature does not match");
    let v = get_json(addr, &encrypted_tap(&meta, &derived(), 9));
    assert_eq!(v["result"], "VALID");
    assert_eq!(v["mode"], "encrypted");
    assert_eq!(v["uid"], UID);
    assert_eq!(v["counter"], 9);
    assert_eq!(
        get_json(addr, &encrypted_tap(&meta, &derived(), 9))["reason"],
        "replayed"
    );
}

/// One line per request, three fields, and never a key, a UID or anything from the URL.
#[test]
fn the_log_has_one_line_per_request_and_nothing_else() {
    let d = dir("log");
    let log = Log::default();
    let addr = start(load(&d, &master_keys(true), &log));
    let meta = h::<16>(META);
    let targets = [
        plain_tap(&derived(), 3),
        plain_tap(&derived(), 3),
        encrypted_tap(&meta, &derived(), 4),
        plain_tap(&h::<16>(MASTER), 8),
        "/tap?uid=zz".to_string(),
        "/elsewhere".to_string(),
    ];
    for t in &targets {
        get(addr, t, JSON);
    }
    send(
        addr,
        "POST /tap HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
    let lines = log.lines();
    assert_eq!(lines.len(), targets.len() + 1, "{lines:?}");
    let tag = tet_tag_verify::docs::tag_id(&h::<7>(UID));
    assert_eq!(lines[0], format!("tag_id={tag} counter=3 result=VALID"));
    assert_eq!(lines[1], format!("tag_id={tag} counter=3 result=INVALID"));
    assert_eq!(lines[2], format!("tag_id={tag} counter=4 result=VALID"));
    assert_eq!(lines[3], format!("tag_id={tag} counter=8 result=INVALID"));
    assert_eq!(lines[4], "tag_id=- counter=- result=INVALID");
    assert_eq!(lines[5], "tag_id=- counter=- result=404");
    assert_eq!(lines[6], "tag_id=- counter=- result=405");
    let all = lines.join("\n").to_lowercase();
    for secret in [MASTER, META, &hex::encode(derived()), UID, AID, SID] {
        assert!(!all.contains(secret), "the log holds {secret}");
    }
}

/// The README names the reasons serve gives, from the one place they are defined.
#[test]
fn readme_names_the_reasons_serve_gives() {
    use tet_tag_verify::report::{REASON_BAD_SIGNATURE, REASON_NO_KEY, REASON_REPLAYED};
    let readme = include_str!("../README.md");
    assert!(readme.contains("## serve (prototype)"));
    for r in [REASON_BAD_SIGNATURE, REASON_REPLAYED, REASON_NO_KEY] {
        assert!(readme.contains(&format!("`{r}`")), "README is missing: {r}");
    }
    assert!(readme.contains("No rate limiting yet (planned)."));
}
