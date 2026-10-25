//! `serve` (prototype): a small verifier that answers `GET /tap?…` with the same report as
//! `verify`, and refuses a tap whose counter did not go up since the last accepted one.
//!
//! - Keys come from a file that only its owner may read (mode 0600), in one of two shapes, all hex:
//!   per tag `{"<uid>": "<key>", …}` (one key for PICCData and MAC, as `verify --key`), or
//!   `{"master": …, "aid": …, "sid": …}` with the tag's key derived per AN10922 (`diversify`). With a
//!   master key, encrypted PICCData also needs `"meta"`, the PICCData key (K_SDMMetaRead): the UID is
//!   inside it, so the tag's key can't be derived before it is read.
//! - The last accepted counter per UID is kept in a state file, written whole after each accepted
//!   tap (temporary file, then rename).
//! - One log line per request: tag ID, counter, result. Key material is never logged, echoed or
//!   put in an error message.
//!
//! No rate limiting yet.

use std::collections::BTreeMap;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::diversify::{diversification_input, diversify_aes128};
use crate::docs::tag_id;
use crate::report::{
    DOES_NOT_SHOW, DOES_NOT_SHOW_HEADING, REASON_NOT_VALID, REASON_REPLAYED, Report, SHOWS_HEADING,
    report,
};
use crate::sun::{Key, PICC_DATA_TAG_UID_CTR_7, decrypt_picc_data, parse_hex, sdmmac};
use crate::url::{self, verify_url};

/// The longest request line accepted ("GET /tap?… HTTP/1.1"), in bytes.
pub const MAX_REQUEST_LINE: usize = 2048;
/// The most per-tag keys one keys file may hold. Each encrypted tap is tried against every key, so
/// this bounds the work one request can cause; the number loaded is printed at start.
pub const MAX_KEYS: usize = 100_000;

/// The keys, as loaded. No `Debug`: nothing here is ever printed.
pub enum Keys {
    PerTag(Vec<([u8; 7], Key)>),
    Master {
        master: Key,
        aid: [u8; 3],
        sid: Vec<u8>,
        meta: Option<Key>,
    },
}

impl Keys {
    /// What was loaded, for the start-up line: counts and shape, never a key.
    pub fn describe(&self) -> String {
        match self {
            Keys::PerTag(v) => format!("{} per-tag keys (at most {MAX_KEYS})", v.len()),
            Keys::Master { meta, .. } => format!(
                "a master key (AN10922){}",
                if meta.is_some() {
                    ", with a PICCData key"
                } else {
                    ", no PICCData key: encrypted taps can't be read"
                }
            ),
        }
    }
}

fn hex_field<const N: usize>(v: &serde_json::Value, what: &str) -> Result<[u8; N], String> {
    // The message names the field, never its value.
    let s = v
        .as_str()
        .ok_or_else(|| format!("{what} in the keys file is not a string"))?;
    parse_hex::<N>("key", s).map_err(|_| format!("{what} in the keys file is not {N} bytes of hex"))
}

/// Read the keys file. Refused unless only its owner can read or write it.
pub fn load_keys(path: &Path) -> Result<Keys, String> {
    let mut f = std::fs::File::open(path)
        .map_err(|e| format!("can't open the keys file {}: {}", path.display(), e.kind()))?;
    let mode = f
        .metadata()
        .map_err(|e| format!("can't read the keys file's mode: {}", e.kind()))?
        .permissions()
        .mode()
        & 0o777;
    if mode & 0o077 != 0 {
        return Err(format!(
            "the keys file {} is mode {mode:04o}; it must be 0600 (chmod 600)",
            path.display()
        ));
    }
    let mut text = String::new();
    std::io::Read::read_to_string(&mut f, &mut text)
        .map_err(|e| format!("can't read the keys file: {}", e.kind()))?;
    // serde_json's own messages can quote the input, so only the position is passed on.
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        format!(
            "the keys file is not valid JSON (line {}, column {})",
            e.line(),
            e.column()
        )
    })?;
    let obj = v.as_object().ok_or("the keys file must be a JSON object")?;
    if obj.contains_key("master") {
        for name in obj.keys() {
            if !["master", "aid", "sid", "meta"].contains(&name.as_str()) {
                return Err(format!(
                    "the keys file has a master key and also '{name}'; allowed: master, aid, sid, meta"
                ));
            }
        }
        let master = hex_field::<16>(&obj["master"], "master")?;
        let aid = hex_field::<3>(obj.get("aid").ok_or("the keys file has no aid")?, "aid")?;
        let sid = obj
            .get("sid")
            .ok_or("the keys file has no sid")?
            .as_str()
            .and_then(|s| hex::decode(s.trim()).ok())
            .ok_or("sid in the keys file is not hex")?;
        // Check now that UID ‖ AID ‖ SID fits AN10922's input, rather than on the first tap.
        diversify_aes128(&master, &diversification_input(&[0; 7], &aid, &sid))
            .map_err(|e| e.to_string())?;
        let meta = obj
            .get("meta")
            .map(|m| hex_field::<16>(m, "meta"))
            .transpose()?;
        return Ok(Keys::Master {
            master,
            aid,
            sid,
            meta,
        });
    }
    if obj.len() > MAX_KEYS {
        return Err(format!(
            "the keys file has {} keys; at most {MAX_KEYS}",
            obj.len()
        ));
    }
    let mut keys: Vec<([u8; 7], Key)> = Vec::with_capacity(obj.len());
    for (u, k) in obj {
        let uid = parse_hex::<7>("UID", u)
            .map_err(|_| format!("'{u}' in the keys file is not a 7-byte UID in hex"))?;
        if keys.iter().any(|(seen, _)| *seen == uid) {
            return Err(format!("the UID {u} is in the keys file twice"));
        }
        keys.push((uid, hex_field::<16>(k, &format!("the key for UID {u}"))?));
    }
    Ok(Keys::PerTag(keys))
}

/// The last accepted counter per UID (lowercase hex).
type State = BTreeMap<String, u32>;

fn load_state(path: &Path) -> Result<State, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("the state file {} is not valid: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(State::new()),
        Err(e) => Err(format!("can't read the state file {}: {e}", path.display())),
    }
}

/// Write the whole state to a temporary file next to it, flush it to disk, then rename it over
/// the old one, so a crash leaves either the old state or the new one.
fn save_state(path: &Path, state: &State) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)?;
    f.write_all(serde_json::to_string_pretty(state)?.as_bytes())?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::File::open(dir)?.sync_all()?;
    }
    Ok(())
}

pub struct Server {
    keys: Keys,
    state_path: PathBuf,
    state: Mutex<State>,
    log: Mutex<Box<dyn Write + Send>>,
    checks: AtomicU64,
}

impl Server {
    /// Load the keys and the state. `log` gets one line per request.
    pub fn load(keys: &Path, state: &Path, log: Box<dyn Write + Send>) -> Result<Server, String> {
        let keys = load_keys(keys)?;
        let st = load_state(state)?;
        Ok(Server {
            keys,
            state_path: state.to_path_buf(),
            state: Mutex::new(st),
            log: Mutex::new(log),
            checks: AtomicU64::new(0),
        })
    }

    pub fn describe(&self) -> String {
        self.keys.describe()
    }

    fn log(&self, tag: Option<&str>, counter: Option<u32>, result: &str) {
        let counter = counter.map_or("-".to_string(), |c| c.to_string());
        let mut w = self.log.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(
            w,
            "tag_id={} counter={counter} result={result}",
            tag.unwrap_or("-")
        );
        let _ = w.flush();
    }

    /// How many SDMMAC checks have run, real or the no-key path's stand-in. Tests use it to see
    /// that an unknown tag costs the same work as a known one.
    pub fn checks_run(&self) -> u64 {
        self.checks.load(Ordering::Relaxed)
    }

    /// The PICCData key and MAC key for this tap, or None when there is none. Every per-tag key is
    /// looked at, with no early exit, so the time taken doesn't depend on where in the file the
    /// tag is, or whether it is there.
    fn keys_for(
        &self,
        encrypted: Option<&[u8; 16]>,
        plain_uid: Option<[u8; 7]>,
    ) -> Option<(Key, Key)> {
        match (&self.keys, encrypted) {
            (Keys::PerTag(v), Some(enc)) => {
                // The UID is inside the PICCData; the right key is the one that decrypts it to
                // tag 0xC7 and the UID that key is filed under.
                let mut hit = None;
                for (uid, k) in v {
                    let p = decrypt_picc_data(k, enc);
                    if p[0] == PICC_DATA_TAG_UID_CTR_7 && p[1..8] == uid[..] {
                        hit = Some((*k, *k));
                    }
                }
                hit
            }
            (Keys::PerTag(v), None) => {
                let u = plain_uid?;
                let mut hit = None;
                for (uid, k) in v {
                    if *uid == u {
                        hit = Some((*k, *k));
                    }
                }
                hit
            }
            (
                Keys::Master {
                    master,
                    aid,
                    sid,
                    meta,
                },
                Some(enc),
            ) => {
                let meta = (*meta)?;
                let p = decrypt_picc_data(&meta, enc);
                if p[0] != PICC_DATA_TAG_UID_CTR_7 {
                    return None;
                }
                let k =
                    diversify_aes128(master, &diversification_input(&p[1..8], aid, sid)).ok()?;
                Some((meta, k))
            }
            (
                Keys::Master {
                    master, aid, sid, ..
                },
                None,
            ) => {
                let u = plain_uid?;
                let k = diversify_aes128(master, &diversification_input(&u, aid, sid)).ok()?;
                Some((k, k))
            }
        }
    }

    /// Check one tap. `target` is the request target, e.g. "/tap?picc_data=…&cmac=…".
    fn tap(&self, target: &str) -> Result<Answer, String> {
        // The URL's form is checked in full before any key is looked up, so a malformed URL gets
        // the same 400 whether or not this verifier has a key for the tag.
        let missing = |what| url::UrlError::Missing(what).to_string();
        let param = |names: &[&str]| url::param(target, names).map_err(|e| e.to_string());
        let enc = param(&["picc_data", "e"])?
            .map(|h| parse_hex::<16>("encrypted PICCData", h))
            .transpose()
            .map_err(|e| e.to_string())?;
        let mac = param(&["cmac", "c"])?.ok_or_else(|| missing("SDMMAC (cmac= or c=)"))?;
        parse_hex::<8>("SDMMAC", mac).map_err(|e| e.to_string())?;
        let plain_uid = match enc {
            Some(_) => None,
            None => {
                let uid = param(&["uid"])?
                    .ok_or_else(|| missing("encrypted data (picc_data= or e=) or UID (uid=)"))?;
                let ctr = param(&["ctr"])?.ok_or_else(|| missing("counter (ctr=)"))?;
                parse_hex::<3>("counter", ctr).map_err(|e| e.to_string())?;
                Some(parse_hex::<7>("UID", uid).map_err(|e| e.to_string())?)
            }
        };

        // The two arms do the same work: for an encrypted tap one block decryption, then an
        // SDMMAC (two CMACs over the same lengths). An unknown tag must not be answered sooner
        // than a known tag with a wrong signature, or the delay would tell them apart.
        let checked = match self.keys_for(enc.as_ref(), plain_uid) {
            Some((meta_key, mac_key)) => {
                let c = verify_url(&meta_key, Some(&mac_key), target, None).ok();
                self.checks.fetch_add(1, Ordering::Relaxed);
                c
            }
            None => {
                dummy_check(enc.as_ref());
                self.checks.fetch_add(1, Ordering::Relaxed);
                None
            }
        };
        // No key and a wrong signature get the same answer, with nothing about the tag in it.
        let Some(c) = checked.filter(|c| c.result.mac_valid) else {
            return Ok(Answer::refused(REASON_NOT_VALID, false, None));
        };

        // The signature checked: from here the tag is one this verifier holds a key for.
        let uid = hex::encode(c.result.uid);
        let verified = (tag_id(&c.result.uid), c.result.counter);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let last = state.get(&uid).copied();
        if last.is_some_and(|l| c.result.counter <= l) {
            return Ok(Answer::refused(REASON_REPLAYED, true, Some(verified)));
        }
        let mut next = state.clone();
        next.insert(uid, c.result.counter);
        // Not accepted unless it is on disk: otherwise a restart would take the same tap again.
        save_state(&self.state_path, &next)
            .map_err(|e| format!("can't save the state file: {}", e.kind()))?;
        *state = next;
        Ok(Answer {
            report: Some(report(&c, last)),
            result: "VALID",
            reason: None,
            replayed: false,
            logged: Some(verified),
        })
    }
}

/// The no-key path's stand-in for `verify_url`: the same block decryption (encrypted taps only,
/// as there) and the same SDMMAC computation, under a fixed key, with the result thrown away.
fn dummy_check(enc: Option<&[u8; 16]>) {
    if let Some(e) = enc {
        std::hint::black_box(decrypt_picc_data(&DUMMY_KEY, e));
    }
    std::hint::black_box(sdmmac(&DUMMY_KEY, &[0; 7], &[0; 3], b""));
}

/// The no-key path's key. Not a secret: it only makes that path do the same work.
const DUMMY_KEY: Key = [0x5a; 16];

/// What `GET /tap` answers. An accepted tap: the `verify --json` report plus result, reason
/// (null) and replayed (false). A refused tap: result, reason and replayed only, with no UID,
/// counter or tag ID.
#[derive(Serialize)]
struct Answer {
    #[serde(flatten)]
    report: Option<Report>,
    result: &'static str,
    reason: Option<&'static str>,
    replayed: bool,
    /// Tag ID and counter for the log line: only when the signature checked (accepted or
    /// replayed). Never sent.
    #[serde(skip)]
    logged: Option<(String, u32)>,
}

impl Answer {
    fn refused(reason: &'static str, replayed: bool, logged: Option<(String, u32)>) -> Answer {
        Answer {
            report: None,
            result: "INVALID",
            reason: Some(reason),
            replayed,
            logged,
        }
    }
}

/// Escaping for element text (the page puts nothing into attributes).
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn html(a: &Answer) -> String {
    let mut out = String::from(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>tet-tag-verify</title></head><body>\n",
    );
    out += &format!(
        "<h1>{}{}</h1>\n",
        a.result,
        a.reason
            .map_or(String::new(), |r| format!(": {}", escape(r)))
    );
    // A refused tap gets only the result and the fixed "does not show" list: nothing about the tag.
    let dns: Vec<String> = DOES_NOT_SHOW.iter().map(|s| s.to_string()).collect();
    let sections = match &a.report {
        Some(r) => {
            out += &format!(
                "<p>Counter: {}</p>\n<p>Tag ID: {}</p>\n",
                r.counter,
                escape(&r.tag_id)
            );
            vec![
                (SHOWS_HEADING, r.shows.clone()),
                (DOES_NOT_SHOW_HEADING, r.does_not_show.clone()),
            ]
        }
        None => vec![(DOES_NOT_SHOW_HEADING, dns)],
    };
    for (heading, lines) in sections {
        out += &format!("<h2>{heading}</h2>\n<ul>\n");
        for l in lines {
            out += &format!("<li>{}</li>\n", escape(&l));
        }
        out += "</ul>\n";
    }
    out + "</body></html>\n"
}

fn plain(status: StatusCode, text: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        text.to_string(),
    )
        .into_response()
}

async fn handle(
    axum::extract::State(s): axum::extract::State<Arc<Server>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    let target = uri.path_and_query().map_or(uri.path(), |p| p.as_str());
    // "<method> <target> HTTP/1.1"
    if method.as_str().len() + 1 + target.len() + 9 > MAX_REQUEST_LINE {
        s.log(None, None, "414");
        return plain(StatusCode::URI_TOO_LONG, "request line too long\n");
    }
    if uri.path() != "/tap" {
        s.log(None, None, "404");
        return plain(StatusCode::NOT_FOUND, "not found\n");
    }
    if method != Method::GET {
        s.log(None, None, "405");
        let mut r = plain(StatusCode::METHOD_NOT_ALLOWED, "GET only\n");
        r.headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET"));
        return r;
    }
    let json = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("application/json"));
    let mut resp = match s.tap(target) {
        Ok(a) => {
            let (tag, counter) = a.logged.as_ref().map(|(t, c)| (t.as_str(), *c)).unzip();
            s.log(tag, counter, a.result);
            if json {
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    serde_json::to_string_pretty(&a).expect("answer serialises"),
                )
                    .into_response()
            } else {
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                    html(&a),
                )
                    .into_response()
            }
        }
        // A URL that can't be read (missing or repeated parameter, bad hex). These messages
        // name parameters, never key material.
        Err(e) => {
            s.log(None, None, "INVALID");
            plain(StatusCode::BAD_REQUEST, &format!("{e}\n"))
        }
    };
    let h = resp.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'"),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    resp
}

pub fn router(server: Arc<Server>) -> Router {
    Router::new().fallback(handle).with_state(server)
}

/// Answer requests on `listener` until the process ends.
pub async fn run(listener: tokio::net::TcpListener, server: Arc<Server>) -> std::io::Result<()> {
    axum::serve(listener, router(server)).await
}
