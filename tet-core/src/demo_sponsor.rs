//! The "Try TET" demo node's file-fee sponsor (docs/DEMO_NODE.md, "File fees").
//!
//! A visitor's disposable wallet has 0 TET. A file it sends is delivered either way; the fee is
//! settled after delivery. On the demo node a **sponsor wallet** pays that fee, under caps, and
//! never for anything else:
//!
//! - **It signs one thing:** a [`TxV1::FileFee`] with `from_wallet` = the sponsor, for a file that
//!   was uploaded **through this node**, whose sender asked for it (a signed request), and that this
//!   node has not sponsored before. There is no other signing path in this module, so it cannot
//!   become a faucet. `demo_sponsor_signs_nothing_but_file_fees` reads this file to keep it so.
//! - **Caps are refusals, not queues:** per client per UTC day, per sender wallet per UTC day, for
//!   everyone per UTC day, and a balance floor below which it stops.
//! - **It never stores an IP address.** The per-client counter is keyed by
//!   `SHA-256(daily salt ‖ client key)`; the salt is random, held in memory only, and replaced each
//!   UTC day. A restart forgets it, which resets the per-client counts for that day (the wallet and
//!   global caps are durable); that is the price of not keeping anything that maps back to an IP.
//! - `FileFee` already allows a payer other than the file's sender, so nothing changes in consensus.
//!
//! Off unless `TET_DEMO_SPONSOR_MNEMONIC_FILE` names a readable file holding the sponsor's 12 words.
//! The seeds never set it.

use crate::protocol::{AttestationV1, HybridSigV1, SignedTxEnvelopeV1, TxV1};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

pub const DAY_MS: u64 = 86_400_000;
/// How far a request's `requested_at_ms` may be from this node's clock.
pub const REQUEST_SKEW_MS: u64 = 5 * 60_000;

const TREE_UPLOADED: &str = "demo_sponsor_uploaded_v1";
const TREE_SPONSORED: &str = "demo_sponsor_sponsored_v1";
const TREE_COUNTS: &str = "demo_sponsor_counts_v1";

/// Why a sponsorship was refused. Each is final for that request: nothing is queued or retried.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// No sponsor on this node.
    NoSponsor,
    BadRequest(String),
    BadSignature,
    StaleRequest,
    /// Not uploaded through this node, not this sender's file, or already sponsored.
    NotSponsorable,
    DailyCapIp,
    DailyCapWallet,
    DailyCapGlobal,
    SponsorLow,
    Submit(String),
}

impl Refusal {
    /// The `reason` the page shows (`docs/DEMO_NODE.md` table).
    pub fn reason(&self) -> &'static str {
        match self {
            Refusal::NoSponsor => "no_sponsor",
            Refusal::BadRequest(_) => "bad_request",
            Refusal::BadSignature => "bad_signature",
            Refusal::StaleRequest => "stale_request",
            Refusal::NotSponsorable => "not_sponsorable",
            Refusal::DailyCapIp => "daily_cap_ip",
            Refusal::DailyCapWallet => "daily_cap_wallet",
            Refusal::DailyCapGlobal => "daily_cap_global",
            Refusal::SponsorLow => "sponsor_low",
            Refusal::Submit(_) => "submit_failed",
        }
    }

    pub fn status(&self) -> u16 {
        match self {
            Refusal::NoSponsor | Refusal::NotSponsorable => 404,
            Refusal::BadRequest(_) | Refusal::StaleRequest => 400,
            Refusal::BadSignature => 401,
            Refusal::SponsorLow => 402,
            Refusal::DailyCapIp | Refusal::DailyCapWallet | Refusal::DailyCapGlobal => 429,
            Refusal::Submit(_) => 503,
        }
    }
}

/// The file's sender asking for its fee to be sponsored. Signed, so a stranger who knows a
/// `file_id` cannot spend the sender's daily allowance.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SponsorFeeRequestV1 {
    pub file_id: String,
    pub sender_wallet_id: String,
    pub requested_at_ms: u64,
    pub hybrid_sig: HybridSigV1,
}

/// `tet demo sponsor fee v1|chain_id=…|genesis_hash=…|file_id=…|sender=…|requested_at_ms=…|mldsa_pk=…`
pub fn sponsor_request_auth_message_bytes(
    file_id: &str,
    sender_wallet_id: &str,
    requested_at_ms: u64,
    mldsa_pubkey_b64: &str,
) -> Vec<u8> {
    format!(
        "tet demo sponsor fee v1|chain_id={}|genesis_hash={}|file_id={}|sender={}|requested_at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        file_id.trim(),
        sender_wallet_id.trim().to_ascii_lowercase(),
        requested_at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// The request is signed, at ML-DSA-44, by the sender it names.
pub fn verify_request_signature(req: &SponsorFeeRequestV1) -> Result<(), Refusal> {
    let sender = req.sender_wallet_id.trim().to_ascii_lowercase();
    if req.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase() != sender {
        return Err(Refusal::BadSignature);
    }
    let msg = sponsor_request_auth_message_bytes(&req.file_id, &sender, req.requested_at_ms, &req.hybrid_sig.mldsa_pubkey_b64);
    if crate::quantum_shield::verify_ed25519(&sender, &req.hybrid_sig.ed25519_sig_b64, &msg).is_err()
        || crate::wallet::verify_mldsa44_b64(&req.hybrid_sig.mldsa_pubkey_b64, &req.hybrid_sig.mldsa_sig_b64, &msg).is_err()
    {
        return Err(Refusal::BadSignature);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub struct Caps {
    pub per_client: u32,
    pub per_wallet: u32,
    pub global: u32,
    pub floor_micro: u64,
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key).ok().and_then(|v| v.trim().parse().ok()).unwrap_or(default)
}

impl Caps {
    pub fn from_env() -> Self {
        Self {
            per_client: env_u64("TET_DEMO_SPONSOR_PER_IP", 5) as u32,
            per_wallet: env_u64("TET_DEMO_SPONSOR_PER_WALLET", 5) as u32,
            global: env_u64("TET_DEMO_SPONSOR_GLOBAL", 500) as u32,
            floor_micro: env_u64("TET_DEMO_SPONSOR_FLOOR_TET", 10) * crate::ledger::STEVEMON,
        }
    }
}

pub struct DemoSponsor {
    words: zeroize::Zeroizing<String>,
    wallet_id: String,
    mldsa_pubkey_b64: String,
    caps: Caps,
    uploaded: sled::Tree,
    sponsored: sled::Tree,
    counts: sled::Tree,
    /// `(utc day, salt)`. Memory only.
    salt: Mutex<(u64, [u8; 32])>,
    /// One decision at a time, so two requests cannot both pass a cap with one slot left.
    pub decide_lock: tokio::sync::Mutex<()>,
}

impl DemoSponsor {
    /// From `TET_DEMO_SPONSOR_MNEMONIC_FILE`. `None` when it is unset, or names a file that does not
    /// exist yet (the demo overlay always sets it; the operator adds the words once the wallet is
    /// funded). A file that exists but is unusable is an error: an operator who wrote one should not
    /// get a node that silently has no sponsor.
    pub fn from_env(db: &sled::Db) -> Result<Option<Self>, String> {
        let Some(path) = std::env::var("TET_DEMO_SPONSOR_MNEMONIC_FILE").ok().filter(|p| !p.trim().is_empty()) else {
            return Ok(None);
        };
        if !std::path::Path::new(path.trim()).exists() {
            log::warn!("[demo-sponsor] off: {} does not exist", path.trim());
            return Ok(None);
        }
        let words = std::fs::read_to_string(path.trim())
            .map_err(|e| format!("demo sponsor: cannot read {}: {e}", path.trim()))?;
        Self::new(db, words.trim(), Caps::from_env()).map(Some)
    }

    pub fn new(db: &sled::Db, words: &str, caps: Caps) -> Result<Self, String> {
        let words = zeroize::Zeroizing::new(words.split_whitespace().collect::<Vec<_>>().join(" "));
        let ed = crate::wallet::ed25519_signing_key_from_mnemonic(&words)
            .map_err(|e| format!("demo sponsor: not a valid mnemonic ({e:?})"))?;
        let kp = crate::wallet::mldsa44_keypair_from_mnemonic(&words)
            .map_err(|e| format!("demo sponsor: ML-DSA key ({e:?})"))?;
        use base64::Engine as _;
        let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(kp.public_key());
        let mut salt = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut salt);
        Ok(Self {
            wallet_id: hex::encode(ed.verifying_key().to_bytes()),
            words,
            mldsa_pubkey_b64,
            caps,
            uploaded: db.open_tree(TREE_UPLOADED).map_err(|e| e.to_string())?,
            sponsored: db.open_tree(TREE_SPONSORED).map_err(|e| e.to_string())?,
            counts: db.open_tree(TREE_COUNTS).map_err(|e| e.to_string())?,
            salt: Mutex::new((0, salt)),
            decide_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }

    /// `POST /files/upload` accepted this file here: it may be sponsored, for this sender.
    pub fn record_upload(&self, file_id: &str, sender_wallet_id: &str) {
        let _ = self.uploaded.insert(
            file_id.trim().as_bytes(),
            sender_wallet_id.trim().to_ascii_lowercase().as_bytes(),
        );
    }

    /// The per-client counter key for today. The client key never reaches storage.
    fn client_hash(&self, day: u64, client_key: &str) -> String {
        let mut g = self.salt.lock().unwrap_or_else(|p| p.into_inner());
        if g.0 != day {
            let mut fresh = [0u8; 32];
            rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut fresh);
            *g = (day, fresh);
            self.prune_before(day);
        }
        let mut h = Sha256::new();
        h.update(g.1);
        h.update(client_key.as_bytes());
        hex::encode(h.finalize())
    }

    fn prune_before(&self, day: u64) {
        let keep = format!("{day:010}|");
        for k in self.counts.iter().keys().flatten() {
            if !k.starts_with(keep.as_bytes()) {
                let _ = self.counts.remove(k);
            }
        }
    }

    fn count(&self, key: &str) -> u32 {
        self.counts
            .get(key.as_bytes())
            .ok()
            .flatten()
            .and_then(|v| v.as_ref().try_into().ok().map(u32::from_le_bytes))
            .unwrap_or(0)
    }

    fn bump(&self, key: &str) {
        let n = self.count(key).saturating_add(1);
        let _ = self.counts.insert(key.as_bytes(), &n.to_le_bytes());
    }

    /// Check a request and, if every check passes, return the signed fee transaction. Commits
    /// nothing; call [`Self::commit`] once the transaction was accepted into the mempool.
    ///
    /// Order: structure, signature, freshness, the file, the caps, the balance floor.
    pub fn decide(
        &self,
        req: &SponsorFeeRequestV1,
        client_key: &str,
        now_ms: u64,
        sponsor_spendable_micro: u64,
        file_sender: Option<String>,
    ) -> Result<(SignedTxEnvelopeV1, Commit), Refusal> {
        let file_id = req.file_id.trim().to_string();
        if uuid::Uuid::parse_str(&file_id).is_err() {
            return Err(Refusal::BadRequest("file_id must be a UUID".into()));
        }
        let sender = req.sender_wallet_id.trim().to_ascii_lowercase();
        if sender.len() != 64 || !sender.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(Refusal::BadRequest("sender_wallet_id must be 64 hex".into()));
        }

        verify_request_signature(req)?;
        if now_ms.abs_diff(req.requested_at_ms) > REQUEST_SKEW_MS {
            return Err(Refusal::StaleRequest);
        }

        // Uploaded through this node, by this sender, per both the upload record and the stored
        // envelope; and not sponsored before.
        let uploaded_by = self
            .uploaded
            .get(file_id.as_bytes())
            .ok()
            .flatten()
            .map(|v| String::from_utf8_lossy(&v).to_string());
        if uploaded_by.as_deref() != Some(sender.as_str())
            || file_sender.map(|s| s.trim().to_ascii_lowercase()).as_deref() != Some(sender.as_str())
            || self.sponsored.contains_key(file_id.as_bytes()).unwrap_or(true)
        {
            return Err(Refusal::NotSponsorable);
        }

        let day = now_ms / DAY_MS;
        let client = format!("{day:010}|c|{}", self.client_hash(day, client_key));
        let wallet = format!("{day:010}|w|{sender}");
        let global = format!("{day:010}|g");
        if self.count(&client) >= self.caps.per_client {
            return Err(Refusal::DailyCapIp);
        }
        if self.count(&wallet) >= self.caps.per_wallet {
            return Err(Refusal::DailyCapWallet);
        }
        if self.count(&global) >= self.caps.global {
            return Err(Refusal::DailyCapGlobal);
        }
        if sponsor_spendable_micro < self.caps.floor_micro.saturating_add(crate::files::FILE_FEE_MICRO) {
            return Err(Refusal::SponsorLow);
        }

        let env = self.sign_file_fee(&file_id).map_err(Refusal::Submit)?;
        Ok((env, Commit { file_id, keys: [client, wallet, global] }))
    }

    /// Record a sponsorship that reached the mempool: the file is done, and each cap counts it.
    pub fn commit(&self, c: Commit) {
        let _ = self.sponsored.insert(c.file_id.as_bytes(), &[1u8]);
        for k in &c.keys {
            self.bump(k);
        }
        let _ = self.counts.flush();
        let _ = self.sponsored.flush();
    }

    /// The only signing this module does.
    fn sign_file_fee(&self, file_id: &str) -> Result<SignedTxEnvelopeV1, String> {
        let tx = TxV1::FileFee {
            from_wallet: self.wallet_id.clone(),
            storage_wallet: crate::consensus::local_node_id_from_env(),
            file_id: file_id.to_string(),
            fee_micro: crate::files::FILE_FEE_MICRO,
        };
        let msg = crate::wallet::tx_v1_auth_message_bytes(&tx, &self.mldsa_pubkey_b64)?;
        let sig = crate::agent::sign_agent_message_bytes(&self.words, &msg).map_err(|e| e.to_string())?;
        Ok(SignedTxEnvelopeV1 {
            v: 1,
            tx,
            sig,
            attestation: AttestationV1 { platform: String::new(), report_b64: String::new() },
        })
    }
}

/// What [`DemoSponsor::commit`] records once the fee transaction is accepted.
pub struct Commit {
    file_id: String,
    keys: [String; 3],
}
