//! The public signature registry: hash-only signature records (proof codes) that their signers
//! chose to publish, searchable by proof code, file SHA-256, signer and date.
//!
//! - **A record** is a `.sig.json` whose payload is a file's SHA-256 (`application/vnd.tet.sha256`),
//!   signed with both of the signer's keys over the agent-payload pre-image (`agent.rs`). It holds
//!   the file's hash and the signer's public keys, never the file.
//! - **Publishing is the signer's choice, enforced:** a record is accepted only with a **consent**
//!   envelope signed by the record's own two keys (payload type [`CONSENT_PAYLOAD_TYPE`]) over that
//!   record's exact SHA-256. Someone who was given a `.sig.json` privately can't publish it, can't
//!   fill its signer's quota, and can't store re-encoded copies of it (each byte string needs its
//!   own consent). Nothing anonymous is ever in it: anonymous posts and ballots are Tmail, not
//!   records, and stay unlinkable.
//! - The node checks every record's signatures before storing it and stores its **exact bytes**, so
//!   the proof code (40 bits of the record's SHA-256) is the same everywhere. Readers re-check every
//!   record in their own tab.
//! - **Quotas:** a record is at most [`RECORD_MAX_BYTES`]; a node-wide byte cap
//!   (`TET_SIGS_MAX_TOTAL_BYTES`, default [`DEFAULT_TOTAL_BYTES`]); at most
//!   [`MAX_RECORDS_PER_SIGNER`] per signer; in public mode each publish is charged to the client's
//!   daily upload budget, like Files and sites. Records don't expire: a signature is meant to last.
//! - **Takedown:** the operator hiding a signer's wallet stops that signer's records being served.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::Digest as _;

pub const HASH_PAYLOAD_TYPE: &str = "application/vnd.tet.sha256";
pub const PAE_DOMAIN: &str = "tet agent payload v1";
/// The payload type of a signer's consent to publish one record (payload: the record's SHA-256).
pub const CONSENT_PAYLOAD_TYPE: &str = "tet sig publish v1";
pub const RECORD_MAX_BYTES: usize = 16 * 1024;
pub const DEFAULT_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_RECORDS_PER_SIGNER: usize = 1_000;
/// Most records one search returns.
pub const SEARCH_MAX: usize = 50;
/// Most index entries one search reads (a popular file or a busy signer can't make a search load
/// thousands of records); the newest are read first where the index is ordered by time.
pub const SEARCH_SCAN_MAX: usize = 500;

const TREE_RECORDS: &str = "sigs_records_v1"; // record sha256 -> StoredRecord
const TREE_BY_CODE: &str = "sigs_by_code_v1"; // 10 hex || record sha256 -> ()
// file sha256 || published_at be || record sha256 -> (): oldest first, so the first marking of a file
// is always read, however many others mark the same file later.
const TREE_BY_FILE: &str = "sigs_by_file_v2";
const TREE_BY_SIGNER: &str = "sigs_by_signer_v1"; // signer || published_at be || record sha256 -> ()
const TREE_BY_TIME: &str = "sigs_by_time_v1"; // published_at be || record sha256 -> ()
const TREE_META: &str = "sigs_meta_v1";
const TOTAL_KEY: &[u8] = b"total_bytes";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredRecord {
    /// The record's exact bytes, base64.
    pub record_b64: String,
    pub record_sha256: String,
    pub file_sha256: String,
    pub signer_ed25519: String,
    pub published_at_ms: u64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SigsError {
    #[error("not a record: {0}")]
    Malformed(String),
    #[error("only hash-only signatures (a file's SHA-256) can be published")]
    NotHashOnly,
    #[error("the record's signatures don't verify: {0}")]
    Signature(String),
    #[error("publishing needs the signer's consent for exactly this record: {0}")]
    Consent(String),
    #[error("a record may be at most {RECORD_MAX_BYTES} bytes")]
    TooBig,
    #[error("this signer has published the most records this node keeps ({MAX_RECORDS_PER_SIGNER})")]
    SignerFull,
    #[error("this node's signature registry is full")]
    StoreFull,
    #[error("store: {0}")]
    Store(String),
}

#[derive(Deserialize)]
struct Envelope {
    #[serde(rename = "payloadType")]
    payload_type: String,
    payload: String,
    signatures: Vec<SigEntry>,
    tet: TetBlock,
}
#[derive(Deserialize)]
struct SigEntry {
    keyid: String,
    sig: String,
}
#[derive(Deserialize)]
struct TetBlock {
    v: u32,
    pae: String,
    agent_ed25519_pubkey_hex: String,
    agent_mldsa44_pubkey_b64: String,
}

fn total_cap() -> u64 {
    std::env::var("TET_SIGS_MAX_TOTAL_BYTES").ok().and_then(|v| v.trim().parse().ok()).filter(|v| *v > 0).unwrap_or(DEFAULT_TOTAL_BYTES)
}

/// A verified envelope: (payload type, payload, signer ed25519 hex, signer ML-DSA-44 key b64).
fn verify_envelope(bytes: &[u8]) -> Result<(String, Vec<u8>, String, String), SigsError> {
    if bytes.len() > RECORD_MAX_BYTES {
        return Err(SigsError::TooBig);
    }
    let e: Envelope = serde_json::from_slice(bytes).map_err(|x| SigsError::Malformed(x.to_string()))?;
    if e.tet.v != 1 || e.tet.pae != PAE_DOMAIN {
        return Err(SigsError::Malformed("unsupported envelope version".into()));
    }
    let payload_type = e.payload_type.trim().to_string();
    let payload = base64::engine::general_purpose::STANDARD.decode(e.payload.trim()).map_err(|_| SigsError::Malformed("payload isn't base64".into()))?;
    let signer = e.tet.agent_ed25519_pubkey_hex.trim().to_string();
    if signer.len() != 64 || !signer.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err(SigsError::Malformed("the ed25519 key is not 64 lowercase hex".into()));
    }
    let ml_pub = e.tet.agent_mldsa44_pubkey_b64.trim().to_string();
    let ml_pub_bytes = base64::engine::general_purpose::STANDARD.decode(&ml_pub).map_err(|_| SigsError::Malformed("ml-dsa key isn't base64".into()))?;
    let ml_keyid = format!("tet-mldsa44:{}", hex::encode(sha2::Sha256::digest(&ml_pub_bytes)));
    let ed = e.signatures.iter().filter(|s| s.keyid.starts_with("tet-ed25519:")).collect::<Vec<_>>();
    let ml = e.signatures.iter().filter(|s| s.keyid.starts_with("tet-mldsa44:")).collect::<Vec<_>>();
    if e.signatures.len() != 2 || ed.len() != 1 || ml.len() != 1 {
        return Err(SigsError::Malformed("expected exactly one ed25519 and one ml-dsa-44 signature".into()));
    }
    if ed[0].keyid != format!("tet-ed25519:{signer}") || ml[0].keyid != ml_keyid {
        return Err(SigsError::Malformed("a keyid doesn't match the key it names".into()));
    }
    let sig = crate::protocol::HybridSigV1 {
        ed25519_pubkey_hex: signer.clone(),
        ed25519_sig_b64: ed[0].sig.clone(),
        mldsa_pubkey_b64: ml_pub,
        mldsa_sig_b64: ml[0].sig.clone(),
    };
    let ml_pub = sig.mldsa_pubkey_b64.clone();
    crate::agent::verify_agent_payload(&signer, &sig, &payload_type, &payload).map_err(|x| SigsError::Signature(format!("{x:?}")))?;
    Ok((payload_type, payload, signer, ml_pub))
}

/// Parse and verify a record's exact bytes: (file sha256, signer). Pure.
pub fn verify_record(bytes: &[u8]) -> Result<(String, String), SigsError> {
    let (payload_type, payload, signer, _) = verify_envelope(bytes)?;
    if payload_type != HASH_PAYLOAD_TYPE || payload.len() != 32 {
        return Err(SigsError::NotHashOnly);
    }
    Ok((hex::encode(payload), signer))
}

/// Check that `consent` is the record's own signer agreeing to publish exactly `record`. Pure.
pub fn verify_consent(record: &[u8], consent: &[u8]) -> Result<(), SigsError> {
    let (_, _, rec_signer, rec_ml) = verify_envelope(record)?;
    let (ty, payload, signer, ml) = verify_envelope(consent).map_err(|e| SigsError::Consent(e.to_string()))?;
    if ty != CONSENT_PAYLOAD_TYPE {
        return Err(SigsError::Consent("not a consent to publish".into()));
    }
    if signer != rec_signer || ml != rec_ml {
        return Err(SigsError::Consent("signed by a different key than the record".into()));
    }
    if payload != sha2::Sha256::digest(record).to_vec() {
        return Err(SigsError::Consent("it's for a different record".into()));
    }
    Ok(())
}

pub struct SigStore {
    records: sled::Tree,
    by_code: sled::Tree,
    by_file: sled::Tree,
    by_signer: sled::Tree,
    by_time: sled::Tree,
    meta: sled::Tree,
    lock: std::sync::Mutex<()>,
}

#[derive(Debug, Default, Clone)]
pub struct SigQuery {
    /// 10 hex digits: a proof code's 40 bits.
    pub code_prefix: Option<String>,
    pub file_sha256: Option<String>,
    pub signer: Option<String>,
    pub from_ms: Option<u64>,
    pub to_ms: Option<u64>,
}

impl SigStore {
    pub fn open(db: &sled::Db) -> Result<Self, sled::Error> {
        let store = Self::open_trees(db)?;
        // The file index moved to a time-ordered key (v2). Rebuild it from the records if an older
        // index exists, so no record is left out of file searches; then drop the old index.
        if db.tree_names().iter().any(|n| n.as_ref() == b"sigs_by_file_v1") {
            for (_, v) in store.records.iter().filter_map(|r| r.ok()) {
                if let Ok(r) = serde_json::from_slice::<StoredRecord>(&v) {
                    let mut fk = r.file_sha256.as_bytes().to_vec();
                    fk.extend_from_slice(&r.published_at_ms.to_be_bytes());
                    fk.extend_from_slice(r.record_sha256.as_bytes());
                    store.by_file.insert(fk, &[])?;
                }
            }
            db.drop_tree("sigs_by_file_v1")?;
        }
        Ok(store)
    }

    fn open_trees(db: &sled::Db) -> Result<Self, sled::Error> {
        Ok(Self {
            records: db.open_tree(TREE_RECORDS)?,
            by_code: db.open_tree(TREE_BY_CODE)?,
            by_file: db.open_tree(TREE_BY_FILE)?,
            by_signer: db.open_tree(TREE_BY_SIGNER)?,
            by_time: db.open_tree(TREE_BY_TIME)?,
            meta: db.open_tree(TREE_META)?,
            lock: std::sync::Mutex::new(()),
        })
    }

    /// Records held now.
    pub fn record_count(&self) -> usize {
        self.records.len()
    }

    pub fn total_bytes(&self) -> u64 {
        self.meta.get(TOTAL_KEY).ok().flatten().and_then(|v| <[u8; 8]>::try_from(v.as_ref()).ok()).map(u64::from_be_bytes).unwrap_or(0)
    }

    /// Verify and store a record's exact bytes, with its signer's consent for exactly those bytes.
    /// `Ok((record, true))` newly stored, `false` already here.
    pub fn publish(&self, bytes: &[u8], consent: &[u8], now_ms: u64) -> Result<(StoredRecord, bool), SigsError> {
        let (file_sha256, signer) = verify_record(bytes)?;
        verify_consent(bytes, consent)?;
        let rh = hex::encode(sha2::Sha256::digest(bytes));
        let _g = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(v) = self.records.get(rh.as_bytes()).map_err(|x| SigsError::Store(x.to_string()))? {
            let r: StoredRecord = serde_json::from_slice(&v).map_err(|x| SigsError::Store(x.to_string()))?;
            return Ok((r, false));
        }
        if self.by_signer.scan_prefix(signer.as_bytes()).count() >= MAX_RECORDS_PER_SIGNER {
            return Err(SigsError::SignerFull);
        }
        let total = self.total_bytes();
        let r = StoredRecord {
            record_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
            record_sha256: rh.clone(),
            file_sha256: file_sha256.clone(),
            signer_ed25519: signer.clone(),
            published_at_ms: now_ms,
        };
        let val = serde_json::to_vec(&r).map_err(|x| SigsError::Store(x.to_string()))?;
        // The cap counts what is actually stored: the record (base64, with its fields) and its four
        // index entries, not just the raw record.
        let cost = (val.len() + 64 + 10 + 64 + 64 + 64 + 8 + 64 + 8 + 64) as u64;
        if total + cost > total_cap() {
            return Err(SigsError::StoreFull);
        }
        let st = |x: sled::Error| SigsError::Store(x.to_string());
        self.records.insert(rh.as_bytes(), val).map_err(st)?;
        self.by_code.insert(format!("{}{}", &rh[..10], rh).as_bytes(), &[]).map_err(st)?;
        let mut fk = file_sha256.as_bytes().to_vec();
        fk.extend_from_slice(&now_ms.to_be_bytes());
        fk.extend_from_slice(rh.as_bytes());
        self.by_file.insert(fk, &[]).map_err(st)?;
        let mut sk = signer.as_bytes().to_vec();
        sk.extend_from_slice(&now_ms.to_be_bytes());
        sk.extend_from_slice(rh.as_bytes());
        self.by_signer.insert(sk, &[]).map_err(st)?;
        let mut tk = now_ms.to_be_bytes().to_vec();
        tk.extend_from_slice(rh.as_bytes());
        self.by_time.insert(tk, &[]).map_err(st)?;
        self.meta.insert(TOTAL_KEY, &(total + cost).to_be_bytes()).map_err(st)?;
        Ok((r, true))
    }

    fn get(&self, rh: &str) -> Option<StoredRecord> {
        serde_json::from_slice(&self.records.get(rh.as_bytes()).ok()??).ok()
    }

    /// Records matching every given criterion, at most [`SEARCH_MAX`]: for a file, the earliest first
    /// (the first marking can't be pushed out by later ones); otherwise the newest first. With no
    /// code, file or signer, the newest records in the date range.
    pub fn search(&self, q: &SigQuery) -> Vec<StoredRecord> {
        let hashes: Vec<String> = if let Some(c) = &q.code_prefix {
            self.by_code.scan_prefix(c.as_bytes()).keys().filter_map(|k| k.ok()).take(SEARCH_SCAN_MAX).filter_map(|k| String::from_utf8(k[10..].to_vec()).ok()).collect()
        } else if let Some(f) = &q.file_sha256 {
            self.by_file.scan_prefix(f.as_bytes()).keys().filter_map(|k| k.ok()).take(SEARCH_SCAN_MAX).filter_map(|k| String::from_utf8(k[72..].to_vec()).ok()).collect()
        } else if let Some(s) = &q.signer {
            // Ordered by publish time: read the newest first.
            self.by_signer.scan_prefix(s.as_bytes()).keys().rev().filter_map(|k| k.ok()).take(SEARCH_SCAN_MAX).filter_map(|k| String::from_utf8(k[72..].to_vec()).ok()).collect()
        } else {
            // Date only: walk the time index newest first, inside the range, and stop at the limit.
            let lo = q.from_ms.unwrap_or(0).to_be_bytes().to_vec();
            let mut hi = q.to_ms.unwrap_or(u64::MAX).to_be_bytes().to_vec();
            hi.push(0xff);
            self.by_time.range(lo..hi).keys().rev().filter_map(|k| k.ok()).take(SEARCH_MAX).filter_map(|k| String::from_utf8(k[8..].to_vec()).ok()).collect()
        };
        let mut out: Vec<StoredRecord> = hashes
            .iter()
            .filter_map(|h| self.get(h))
            .filter(|r| q.file_sha256.as_ref().is_none_or(|f| &r.file_sha256 == f))
            .filter(|r| q.signer.as_ref().is_none_or(|s| &r.signer_ed25519 == s))
            .filter(|r| q.from_ms.is_none_or(|t| r.published_at_ms >= t))
            .filter(|r| q.to_ms.is_none_or(|t| r.published_at_ms <= t))
            .collect();
        // A file's search lists the earliest markings first (who marked it first is what matters, and
        // later copies by others can't push it out); everything else lists the newest first.
        if q.file_sha256.is_some() {
            out.sort_by(|a, b| a.published_at_ms.cmp(&b.published_at_ms));
        } else {
            out.sort_by(|a, b| b.published_at_ms.cmp(&a.published_at_ms));
        }
        out.truncate(SEARCH_MAX);
        out
    }
}
