//! Signed sites: a node-local, quota'd store of signed edit chains (docs/plans/SITE_BUILDER.md,
//! option A, with export on the page as well).
//!
//! A **site** is a wallet (its own 12 words, like a board) plus an ordered chain of **edits**. An
//! edit carries `seq`, the previous edit's hash and a `body` (JSON text: add, replace or remove a
//! block, or set the title and language), and is signed by the site's own key, hybrid like every
//! other TET signature. The node accepts an edit only if the site's key signed it and it extends the
//! chain exactly (next `seq`, `prev` = the current head), so the order can't be rewritten without
//! breaking every later signature. Readers re-check every signature and link in their own tab; the
//! node is a store, not an authority.
//!
//! - **Not consensus:** node-local, like Tmail and Files; not gossiped in v1.
//! - **Quotas:** [`SITE_MAX_BYTES`] per site, [`EDIT_MAX_BODY_BYTES`] per edit, and a node-wide
//!   total (`TET_SITES_MAX_TOTAL_BYTES`, default [`DEFAULT_TOTAL_BYTES`]). In public mode every edit
//!   is also charged, by its length, to the client's daily upload budget (the same one as Files), so
//!   one address can't fill the store. Bytes are the limit, not a count of sites, so a flood of tiny
//!   sites can't lock others out. Quotas count each edit as stored (body and signatures), not just
//!   its body.
//! - **Sites expire** [`DEFAULT_TTL_DAYS`] days after their last edit (`TET_SITES_TTL_DAYS`); any
//!   edit renews it. So a filled store frees up again: expired sites are pruned (under the append
//!   lock, at most once a minute) when it fills; a read just treats an expired site as absent. The
//!   page says so, and its export is the lasting copy.
//! - **Fresh edits only:** an edit's signed `created_at_ms` must be within [`EDIT_CLOCK_SKEW_MS`] of
//!   this node's clock, so a site's old (public) signed edits can't be replayed later, e.g. to bring
//!   back a version its owner replaced, once the site has expired.
//! - **Takedown:** a site whose wallet the operator hid isn't served and takes no edits
//!   (`operator_hide.rs`); the chain data is never deleted by that.
//! - Rendering is the page's (one pure function, no author HTML, no scripts).

use serde::{Deserialize, Serialize};
use sha2::Digest as _;

use crate::tmail::envelope::TmailHybridSig;

pub const SITE_EDIT_KIND: &str = "tet_site_edit_v1";
/// Most bytes one edit's body may hold (an image block carries its image, base64).
pub const EDIT_MAX_BODY_BYTES: usize = 1_500_000;
/// Most bytes of edit bodies one site may hold.
pub const SITE_MAX_BYTES: usize = 5 * 1024 * 1024;
/// Most sites one node stores (a sanity bound; bytes are the real limit).
pub const MAX_SITES: usize = 100_000;
/// Default node-wide total of site bytes.
pub const DEFAULT_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const TOTAL_KEY: &[u8] = b"__total_bytes";
/// How far an edit's signed time may be from this node's clock.
pub const EDIT_CLOCK_SKEW_MS: u64 = 10 * 60 * 1000;
/// Default days a site lives after its last edit.
pub const DEFAULT_TTL_DAYS: u64 = 30;

fn skew_ms() -> u64 {
    std::env::var("TET_SITES_EDIT_SKEW_MS").ok().and_then(|v| v.trim().parse::<u64>().ok()).filter(|v| *v > 0).unwrap_or(EDIT_CLOCK_SKEW_MS)
}

pub fn ttl_ms() -> u64 {
    if let Some(ms) = std::env::var("TET_SITES_TTL_MS").ok().and_then(|v| v.trim().parse::<u64>().ok()).filter(|v| *v > 0) {
        return ms;
    }
    std::env::var("TET_SITES_TTL_DAYS").ok().and_then(|v| v.trim().parse::<u64>().ok()).filter(|v| *v > 0).unwrap_or(DEFAULT_TTL_DAYS) * 86_400_000
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn total_bytes_cap() -> u64 {
    std::env::var("TET_SITES_MAX_TOTAL_BYTES").ok().and_then(|v| v.trim().parse().ok()).filter(|v| *v > 0).unwrap_or(DEFAULT_TOTAL_BYTES)
}
/// Most edits one site may have (a page is rebuilt from all of them).
pub const SITE_MAX_EDITS: u64 = 2_000;

const TREE_EDITS: &str = "sites_edits_v1";
const TREE_HEADS: &str = "sites_heads_v1";
const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteEditV1 {
    pub v: u32,
    pub kind: String,
    pub site_wallet_id: String,
    pub seq: u64,
    /// The previous edit's hash (64 hex), or 64 zeros for the first edit.
    pub prev_hash: String,
    /// The edit itself, as JSON text exactly as signed.
    pub body: String,
    pub created_at_ms: u64,
    pub hybrid_sig: TmailHybridSig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SiteHead {
    pub len: u64,
    pub head_hash: String,
    /// Bytes this site's edits take as stored.
    pub bytes: usize,
    /// When this node last took an edit for it; the site expires a TTL after this.
    #[serde(default)]
    pub updated_at_ms: u64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SiteEditError {
    #[error("unsupported edit version or kind")]
    Version,
    #[error("invalid site wallet id (expected 64 hex)")]
    Malformed,
    #[error("an edit must be signed by the site's own wallet")]
    SignerMismatch,
    #[error("hybrid signature verification failed: {0}")]
    Signature(String),
    #[error("the edit body must be a JSON object with an op of add, replace, remove or meta")]
    Body,
    #[error("an edit's body may hold at most {EDIT_MAX_BODY_BYTES} bytes")]
    TooBig,
    #[error("this edit doesn't extend the site: expected seq {expected_seq} after {expected_prev}")]
    NotNext { expected_seq: u64, expected_prev: String },
    #[error("this site is full ({SITE_MAX_BYTES} bytes or {SITE_MAX_EDITS} edits)")]
    SiteFull,
    #[error("this node's site store is full")]
    StoreFull,
    #[error("an edit must be signed now (its time is more than 10 minutes from this node's clock)")]
    Stale,
    #[error("store: {0}")]
    Store(String),
}

fn is_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn body_sha256(body: &str) -> String {
    hex::encode(sha2::Sha256::digest(body.as_bytes()))
}

/// The hybrid-signature pre-image, chain-bound like every other TET pre-image:
/// `tet site edit v1|chain_id={}|genesis_hash={}|site={}|seq={}|prev={}|body_sha256={}|created_at_ms={}|mldsa_pk={}`
pub fn site_edit_auth_message_bytes(e: &SiteEditV1, mldsa_pubkey_b64: &str) -> Vec<u8> {
    format!(
        "tet site edit v1|chain_id={}|genesis_hash={}|site={}|seq={}|prev={}|body_sha256={}|created_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        e.site_wallet_id.trim().to_ascii_lowercase(),
        e.seq,
        e.prev_hash.trim().to_ascii_lowercase(),
        body_sha256(&e.body),
        e.created_at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// An edit's hash, which the next edit names as `prev`:
/// SHA-256 of `tet site edit hash v1|site={}|seq={}|prev={}|body_sha256={}`.
pub fn site_edit_hash(e: &SiteEditV1) -> String {
    let s = format!(
        "tet site edit hash v1|site={}|seq={}|prev={}|body_sha256={}",
        e.site_wallet_id.trim().to_ascii_lowercase(),
        e.seq,
        e.prev_hash.trim().to_ascii_lowercase(),
        body_sha256(&e.body),
    );
    hex::encode(sha2::Sha256::digest(s.as_bytes()))
}

/// Shape, size and signature (not the chain position: that's the store's, under its lock).
pub fn verify_site_edit_v1(e: &SiteEditV1) -> Result<(), SiteEditError> {
    if e.v != 1 || e.kind != SITE_EDIT_KIND {
        return Err(SiteEditError::Version);
    }
    let site = e.site_wallet_id.trim().to_ascii_lowercase();
    if !is_64hex(&site) || !is_64hex(e.prev_hash.trim()) {
        return Err(SiteEditError::Malformed);
    }
    if e.body.len() > EDIT_MAX_BODY_BYTES {
        return Err(SiteEditError::TooBig);
    }
    let ok_body = serde_json::from_str::<serde_json::Value>(&e.body)
        .ok()
        .and_then(|v| v.get("op").and_then(|o| o.as_str()).map(|o| matches!(o, "add" | "replace" | "remove" | "meta")))
        .unwrap_or(false);
    if !ok_body {
        return Err(SiteEditError::Body);
    }
    let signer = e.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if signer != site {
        return Err(SiteEditError::SignerMismatch);
    }
    let msg = site_edit_auth_message_bytes(e, &e.hybrid_sig.mldsa_pubkey_b64);
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&e.hybrid_sig.ed25519_sig_b64),
        Some(&e.hybrid_sig.mldsa_pubkey_b64),
        Some(&e.hybrid_sig.mldsa_sig_b64),
        &msg,
    )
    .map_err(|err| SiteEditError::Signature(format!("{err:?}")))
}

pub struct SiteStore {
    edits: sled::Tree,
    heads: sled::Tree,
    /// Every write (append, prune, total) is serialised under this lock, so two edits can't both
    /// claim the same `seq` and the byte total can't drift. The value is when pruning last ran.
    append_lock: std::sync::Mutex<u64>,
}

fn edit_key(site: &str, seq: u64) -> Vec<u8> {
    let mut k = site.as_bytes().to_vec();
    k.push(b'/');
    k.extend_from_slice(&seq.to_be_bytes());
    k
}

impl SiteStore {
    pub fn open(db: &sled::Db) -> Result<Self, sled::Error> {
        Ok(Self { edits: db.open_tree(TREE_EDITS)?, heads: db.open_tree(TREE_HEADS)?, append_lock: std::sync::Mutex::new(0) })
    }

    /// Sites held now (expired ones not yet pruned included).
    pub fn site_count(&self) -> usize {
        self.heads.len().saturating_sub(usize::from(self.heads.contains_key(TOTAL_KEY).unwrap_or(false)))
    }

    /// Bytes of edit bodies held across all sites.
    pub fn total_bytes(&self) -> u64 {
        self.heads.get(TOTAL_KEY).ok().flatten().and_then(|v| <[u8; 8]>::try_from(v.as_ref()).ok()).map(u64::from_be_bytes).unwrap_or(0)
    }

    fn raw_head(&self, site: &str) -> Option<SiteHead> {
        let v = self.heads.get(site.as_bytes()).ok()??;
        serde_json::from_slice(&v).ok()
    }

    pub(crate) fn expired(h: &SiteHead) -> bool {
        // A head without a time (from before times were kept) counts as just edited, never as old.
        h.updated_at_ms != 0 && now_ms().saturating_sub(h.updated_at_ms) > ttl_ms()
    }

    /// A site's head, or `None` if it has none or has expired. Read-only: never deletes.
    pub fn head(&self, site: &str) -> Option<SiteHead> {
        self.raw_head(&site.trim().to_ascii_lowercase()).filter(|h| !Self::expired(h))
    }

    /// Callers hold `append_lock`.
    fn remove_site(&self, site: &str, bytes: usize) {
        let mut prefix = site.as_bytes().to_vec();
        prefix.push(b'/');
        for k in self.edits.scan_prefix(prefix).keys().filter_map(|k| k.ok()) {
            let _ = self.edits.remove(k);
        }
        if matches!(self.heads.remove(site.as_bytes()), Ok(Some(_))) {
            let _ = self.heads.insert(TOTAL_KEY, &self.total_bytes().saturating_sub(bytes as u64).to_be_bytes());
        }
    }

    /// Drop every expired site. Callers hold `append_lock`. Returns how many.
    fn prune_expired_locked(&self) -> usize {
        let mut n = 0;
        let rows: Vec<(String, SiteHead)> = self
            .heads
            .iter()
            .filter_map(|r| r.ok())
            .filter(|(k, _)| k.as_ref() != TOTAL_KEY)
            .filter_map(|(k, v)| Some((String::from_utf8(k.to_vec()).ok()?, serde_json::from_slice::<SiteHead>(&v).ok()?)))
            .collect();
        for (id, h) in rows {
            if Self::expired(&h) {
                self.remove_site(&id, h.bytes);
                n += 1;
            }
        }
        n
    }

    /// Append a verified edit if it extends the site's chain exactly. Returns the new head.
    /// Callers MUST have run [`verify_site_edit_v1`].
    pub fn append(&self, e: &SiteEditV1) -> Result<SiteHead, SiteEditError> {
        let site = e.site_wallet_id.trim().to_ascii_lowercase();
        if e.created_at_ms.abs_diff(now_ms()) > skew_ms() {
            return Err(SiteEditError::Stale);
        }
        let mut last_prune = self.append_lock.lock().unwrap_or_else(|p| p.into_inner());
        // An expired site starts over: drop its old edits first (under the lock).
        if let Some(h) = self.raw_head(&site).filter(Self::expired) {
            self.remove_site(&site, h.bytes);
        }
        let head = self.head(&site);
        let (expected_seq, expected_prev, bytes) = match &head {
            Some(h) => (h.len, h.head_hash.clone(), h.bytes),
            None => (0, ZERO_HASH.to_string(), 0),
        };
        if e.seq != expected_seq || !e.prev_hash.trim().eq_ignore_ascii_case(&expected_prev) {
            return Err(SiteEditError::NotNext { expected_seq, expected_prev });
        }
        // Quotas count the edit as stored: body and signatures.
        let val = serde_json::to_vec(e).map_err(|x| SiteEditError::Store(x.to_string()))?;
        let size = val.len();
        if bytes + size > SITE_MAX_BYTES || e.seq >= SITE_MAX_EDITS {
            return Err(SiteEditError::SiteFull);
        }
        let over = |t: u64| (head.is_none() && self.heads.len() >= MAX_SITES) || t + size as u64 > total_bytes_cap();
        if over(self.total_bytes()) {
            // Pruning scans every site, so it runs at most once a minute, not on every refused edit.
            if now_ms().saturating_sub(*last_prune) > 60_000 {
                *last_prune = now_ms();
                self.prune_expired_locked();
            }
            if over(self.total_bytes()) {
                return Err(SiteEditError::StoreFull);
            }
        }
        let total = self.total_bytes();
        let new_head = SiteHead { len: e.seq + 1, head_hash: site_edit_hash(e), bytes: bytes + size, updated_at_ms: now_ms() };
        let hval = serde_json::to_vec(&new_head).map_err(|x| SiteEditError::Store(x.to_string()))?;
        self.edits.insert(edit_key(&site, e.seq), val).map_err(|x| SiteEditError::Store(x.to_string()))?;
        self.heads.insert(site.as_bytes(), hval).map_err(|x| SiteEditError::Store(x.to_string()))?;
        self.heads
            .insert(TOTAL_KEY, &(total + size as u64).to_be_bytes())
            .map_err(|x| SiteEditError::Store(x.to_string()))?;
        let _ = self.heads.flush();
        Ok(new_head)
    }

    /// A site's edits in order (empty if none).
    pub fn edits(&self, site: &str) -> Vec<SiteEditV1> {
        let site = site.trim().to_ascii_lowercase();
        let mut prefix = site.as_bytes().to_vec();
        prefix.push(b'/');
        self.edits.scan_prefix(prefix).filter_map(|r| r.ok()).filter_map(|(_, v)| serde_json::from_slice(&v).ok()).collect()
    }
}
