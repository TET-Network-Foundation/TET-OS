//! Testnet practice grants (docs/plans/TESTNET_REWARDS.md): the welcome grant.
//!
//! 100 TET (practice unit, can't be exchanged for money) for the opening 1,000 people, one per
//! person, decided by an anonymous membership proof with a grant-specific nullifier:
//! - the proof's receiver is the grant's own id (`SHA-256("tet grant welcome v1")`) and its day is
//!   fixed at 0, so each registered member has exactly one welcome nullifier, forever;
//! - the claim names the wallet to pay and is signed by the proof's one-time key, so the paid
//!   wallet isn't linked to a member key;
//! - **weak today, and said so:** "one per person" is one per registration in the node's open
//!   anonymity set, and registering is free, so one person can claim more than once. The switch to
//!   vouched members (Shelter's per-list root) is designed in the plan and waits for Shelter.
//!
//! The payer is a wallet whose words live only on the host (`TET_GRANT_MNEMONIC_FILE`), like the
//! demo's file-fee sponsor; a grant is an ordinary signed transfer anyone can check on the chain.
//! Off (every route 404) when the file isn't there.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::protocol::{AttestationV1, SignedTxEnvelopeV1, TxV1};
use crate::tmail::envelope::TmailHybridSig;

pub const GRANT_WELCOME: &str = "welcome";
pub const GRANT_CLAIM_KIND: &str = "tet_grant_claim_v1";
/// 100 TET (practice unit).
pub const WELCOME_AMOUNT_MICRO: u64 = 100_000_000;

/// What the grant transfer sends so that exactly [`WELCOME_AMOUNT_MICRO`] arrives: the transfer fee
/// (the consensus minimum rate) comes out of the amount, so the grant wallet sends a little more.
/// The smallest amount whose net is at least the grant, from `fees::charge` itself.
pub fn welcome_transfer_micro() -> u64 {
    let bps = crate::fees::TRANSFER_FEE_BPS_MIN;
    let mut g = WELCOME_AMOUNT_MICRO.saturating_mul(10_000) / (10_000 - bps);
    loop {
        let net = crate::fees::charge(crate::fees::FeeKind::Transfer { fee_bps: bps }, g).map(|s| s.net_micro).unwrap_or(0);
        if net >= WELCOME_AMOUNT_MICRO {
            return g;
        }
        g += 1;
    }
}
/// The opening 1,000 people.
pub const WELCOME_CAP: u64 = 1_000;
/// The payer keeps at least this much (10 TET, practice).
pub const PAYER_FLOOR_MICRO: u64 = 10_000_000;
/// A claim's time may differ from the node's clock by at most this much.
pub const CLAIM_SKEW_MS: u64 = 10 * 60_000;

const TREE_CLAIMS: &str = "grants_welcome_claims_v1"; // nullifier -> Claimed
const TREE_PAID: &str = "grants_welcome_paid_v1"; // payout wallet -> nullifier
const TREE_META: &str = "grants_meta_v1";
const COUNT_KEY: &[u8] = b"welcome_count";

/// The welcome grant's receiver id: what the membership proof is made out to (64 hex).
pub fn welcome_receiver_hex() -> String {
    hex::encode(Sha256::digest(b"tet grant welcome v1"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrantClaimV1 {
    pub v: u32,
    pub kind: String,
    pub grant: String,
    /// The wallet to pay.
    pub payout_wallet: String,
    /// The membership proof (its receipt is deposited with `PUT /tmail/anon/receipt` first).
    pub receipt_sha256_hex: String,
    pub journal_b64: String,
    pub image_id_hex: String,
    pub claimed_at_ms: u64,
    /// Signed by the proof's one-time key (`ed25519_pubkey_hex` = the journal's ephemeral key).
    pub hybrid_sig: TmailHybridSig,
}

/// `PAE("tet grant claim v1", [chain_id, genesis_hash, grant, payout_wallet, receipt_sha256, claimed_at_ms, mldsa_pk])`.
pub fn claim_auth_message_bytes(c: &GrantClaimV1, mldsa_pubkey_b64: &str) -> Vec<u8> {
    let chain = crate::genesis::chain_id_from_env();
    let genesis = crate::genesis::expected_genesis_hash_from_env();
    let at = c.claimed_at_ms.to_string();
    let payout = c.payout_wallet.trim().to_ascii_lowercase();
    let receipt = c.receipt_sha256_hex.trim().to_ascii_lowercase();
    crate::agent::pae(
        "tet grant claim v1",
        &[chain.as_bytes(), genesis.as_bytes(), c.grant.as_bytes(), payout.as_bytes(), receipt.as_bytes(), at.as_bytes(), mldsa_pubkey_b64.trim().as_bytes()],
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GrantRefusal {
    Off,
    BadRequest(String),
    BadSignature,
    Stale,
    NoReceipt,
    ProofFailed(String),
    NotThisGrant,
    RootUnknown,
    AlreadyClaimed,
    WalletAlreadyGranted,
    CapReached,
    PayerLow,
    Submit(String),
}

impl GrantRefusal {
    pub fn status(&self) -> u16 {
        match self {
            Self::Off => 404,
            Self::BadRequest(_) | Self::Stale | Self::NoReceipt | Self::NotThisGrant => 400,
            Self::BadSignature | Self::ProofFailed(_) | Self::RootUnknown => 401,
            Self::AlreadyClaimed | Self::WalletAlreadyGranted => 409,
            Self::CapReached => 410,
            Self::PayerLow => 503,
            Self::Submit(_) => 502,
        }
    }
    pub fn reason(&self) -> String {
        match self {
            Self::Off => "grants are not on at this node".into(),
            Self::BadRequest(s) => s.clone(),
            Self::BadSignature => "the claim isn't signed by the proof's one-time key".into(),
            Self::Stale => "the claim's time is too far from now; check the device clock".into(),
            Self::NoReceipt => "deposit the proof's receipt first".into(),
            Self::ProofFailed(s) => format!("the membership proof doesn't verify: {s}"),
            Self::NotThisGrant => "the proof isn't made out to the welcome grant (day 0)".into(),
            Self::RootUnknown => "the proof is against a registry root this node doesn't recognise".into(),
            Self::AlreadyClaimed => "this member has already claimed the welcome grant".into(),
            Self::WalletAlreadyGranted => "this wallet has already received the welcome grant".into(),
            Self::CapReached => "the opening 1,000 welcome grants are all granted".into(),
            Self::PayerLow => "the grant wallet is low; try again later".into(),
            Self::Submit(s) => format!("the grant transfer wasn't accepted: {s}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claimed {
    pub payout_wallet: String,
    pub tx_hash: Option<String>,
    pub granted_at_ms: u64,
}

pub struct GrantPayer {
    wallet_id: String,
    words: zeroize::Zeroizing<String>,
    mldsa_pubkey_b64: String,
    claims: sled::Tree,
    paid: sled::Tree,
    meta: sled::Tree,
    /// One decision at a time (check → submit → record), so two claims can't share a nullifier or
    /// a payout wallet, or pass the cap together.
    pub decide_lock: tokio::sync::Mutex<()>,
    _guard: Mutex<()>,
}

/// What [`GrantPayer::commit`] records once the transfer reached the mempool.
pub struct GrantCommit {
    nullifier_hex: String,
    payout_wallet: String,
    tx_hash: Option<String>,
    now_ms: u64,
}

impl GrantPayer {
    /// From `TET_GRANT_MNEMONIC_FILE`; `None` when unset or the file doesn't exist.
    pub fn from_env(db: &sled::Db) -> Result<Option<Self>, String> {
        let Some(path) = std::env::var("TET_GRANT_MNEMONIC_FILE").ok().filter(|p| !p.trim().is_empty()) else {
            return Ok(None);
        };
        if !std::path::Path::new(path.trim()).exists() {
            log::warn!("[grants] off: {} does not exist", path.trim());
            return Ok(None);
        }
        let words = std::fs::read_to_string(path.trim()).map_err(|e| format!("grants: cannot read {}: {e}", path.trim()))?;
        Self::new(db, words.trim()).map(Some)
    }

    pub fn new(db: &sled::Db, words: &str) -> Result<Self, String> {
        use base64::Engine as _;
        let words = zeroize::Zeroizing::new(words.split_whitespace().collect::<Vec<_>>().join(" "));
        let ed = crate::wallet::ed25519_signing_key_from_mnemonic(&words).map_err(|e| format!("grants: not a valid mnemonic ({e:?})"))?;
        let kp = crate::wallet::mldsa44_keypair_from_mnemonic(&words).map_err(|e| format!("grants: ML-DSA key ({e:?})"))?;
        Ok(Self {
            wallet_id: hex::encode(ed.verifying_key().to_bytes()),
            words,
            mldsa_pubkey_b64: base64::engine::general_purpose::STANDARD.encode(kp.public_key()),
            claims: db.open_tree(TREE_CLAIMS).map_err(|e| e.to_string())?,
            paid: db.open_tree(TREE_PAID).map_err(|e| e.to_string())?,
            meta: db.open_tree(TREE_META).map_err(|e| e.to_string())?,
            decide_lock: tokio::sync::Mutex::new(()),
            _guard: Mutex::new(()),
        })
    }

    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }

    /// Tests only: pretend `n` grants were made.
    #[cfg(test)]
    pub fn set_granted_for_tests(&self, n: u64) {
        let _ = self.meta.insert(COUNT_KEY, &n.to_le_bytes());
    }

    pub fn granted(&self) -> u64 {
        self.meta.get(COUNT_KEY).ok().flatten().and_then(|v| v.as_ref().try_into().ok().map(u64::from_le_bytes)).unwrap_or(0)
    }

    /// Check a claim; if every check passes, return the signed transfer. Commits nothing; call
    /// [`Self::commit`] once the transfer is in the mempool. Order: shape, signature, clock, the
    /// proof (receipt, program, journal), the grant's receiver and day, the root, replays, the cap,
    /// the payer's balance.
    pub fn decide(
        &self,
        c: &GrantClaimV1,
        store: &crate::tmail::store::TmailStore,
        now_ms: u64,
        payer_spendable_micro: u64,
    ) -> Result<(SignedTxEnvelopeV1, GrantCommit), GrantRefusal> {
        use base64::Engine as _;
        if c.v != 1 || c.kind != GRANT_CLAIM_KIND || c.grant != GRANT_WELCOME {
            return Err(GrantRefusal::BadRequest("unsupported claim".into()));
        }
        let payout = c.payout_wallet.trim().to_ascii_lowercase();
        if payout.len() != 64 || !payout.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return Err(GrantRefusal::BadRequest("payout_wallet must be 64 hex".into()));
        }
        if payout == self.wallet_id {
            return Err(GrantRefusal::BadRequest("the grant wallet can't pay itself".into()));
        }
        let signer = c.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase();
        crate::quantum_shield::verify_hybrid(
            &signer,
            Some(&c.hybrid_sig.ed25519_sig_b64),
            Some(&c.hybrid_sig.mldsa_pubkey_b64),
            Some(&c.hybrid_sig.mldsa_sig_b64),
            &claim_auth_message_bytes(c, &c.hybrid_sig.mldsa_pubkey_b64),
        )
        .map_err(|_| GrantRefusal::BadSignature)?;
        if c.claimed_at_ms.abs_diff(now_ms) > CLAIM_SKEW_MS {
            return Err(GrantRefusal::Stale);
        }
        let receipt = store.get_anon_receipt(c.receipt_sha256_hex.trim()).ok_or(GrantRefusal::NoReceipt)?;
        if !hex::encode(Sha256::digest(&receipt)).eq_ignore_ascii_case(c.receipt_sha256_hex.trim()) {
            return Err(GrantRefusal::ProofFailed("the receipt doesn't match its hash".into()));
        }
        let image_id = crate::tmail::anon::decode_image_id_hex_pub(&c.image_id_hex).map_err(|_| GrantRefusal::ProofFailed("malformed image id".into()))?;
        if !crate::tmail::anon::anon_program_accepted(&image_id) {
            return Err(GrantRefusal::ProofFailed("proof from an unrecognised proving program".into()));
        }
        let receipt_b64 = base64::engine::general_purpose::STANDARD.encode(&receipt);
        let journal = match crate::zk_verifier::verify_tx_receipt_and_journal(image_id, c.journal_b64.trim(), &receipt_b64) {
            Ok(crate::zk_verifier::VerifiedZkJournal::TmailAnon(j)) => j,
            Ok(_) => return Err(GrantRefusal::ProofFailed("the receipt proves something else".into())),
            Err(e) => return Err(GrantRefusal::ProofFailed(e.to_string())),
        };
        decide_journal(self, &journal, &signer, &payout, store, now_ms, payer_spendable_micro)
    }

    fn sign_transfer(&self, to: &str) -> Result<SignedTxEnvelopeV1, String> {
        let tx = TxV1::Transfer { from_wallet: self.wallet_id.clone(), to_wallet: to.to_string(), amount_micro: welcome_transfer_micro(), fee_bps: crate::fees::TRANSFER_FEE_BPS_MIN };
        let msg = crate::wallet::tx_v1_auth_message_bytes(&tx, &self.mldsa_pubkey_b64)?;
        let sig = crate::agent::sign_agent_message_bytes(&self.words, &msg).map_err(|e| e.to_string())?;
        Ok(SignedTxEnvelopeV1 { v: 1, tx, sig, attestation: AttestationV1 { platform: String::new(), report_b64: String::new() } })
    }

    /// Record a grant whose transfer reached the mempool.
    pub fn commit(&self, g: GrantCommit) {
        let _l = self._guard.lock().unwrap_or_else(|p| p.into_inner());
        let rec = Claimed { payout_wallet: g.payout_wallet.clone(), tx_hash: g.tx_hash, granted_at_ms: g.now_ms };
        let _ = self.claims.insert(g.nullifier_hex.as_bytes(), serde_json::to_vec(&rec).unwrap_or_default());
        let _ = self.paid.insert(g.payout_wallet.as_bytes(), g.nullifier_hex.as_bytes());
        let n = self.granted().saturating_add(1);
        let _ = self.meta.insert(COUNT_KEY, &n.to_le_bytes());
        let _ = self.claims.flush();
    }
}

/// The policy half of [`GrantPayer::decide`], after the proof itself verified: separate so tests
/// can drive it with a journal directly.
pub(crate) fn decide_journal(
    p: &GrantPayer,
    journal: &nexus_protocol::TmailAnonMembershipV1,
    signer: &str,
    payout: &str,
    store: &crate::tmail::store::TmailStore,
    now_ms: u64,
    payer_spendable_micro: u64,
) -> Result<(SignedTxEnvelopeV1, GrantCommit), GrantRefusal> {
    if hex::encode(journal.ephemeral_pubkey_bytes) != signer {
        return Err(GrantRefusal::BadSignature);
    }
    if hex::encode(journal.receiver_wallet_bytes) != welcome_receiver_hex() || journal.bucket_index != 0 {
        return Err(GrantRefusal::NotThisGrant);
    }
    let now_bucket = nexus_protocol::tmail_bucket_index_v1(now_ms);
    if !store.accepts_anon_root(&journal.merkle_root, now_bucket) {
        return Err(GrantRefusal::RootUnknown);
    }
    let nullifier_hex = hex::encode(journal.nullifier);
    if p.claims.contains_key(nullifier_hex.as_bytes()).unwrap_or(true) {
        return Err(GrantRefusal::AlreadyClaimed);
    }
    if p.paid.contains_key(payout.as_bytes()).unwrap_or(true) {
        return Err(GrantRefusal::WalletAlreadyGranted);
    }
    if p.granted() >= WELCOME_CAP {
        return Err(GrantRefusal::CapReached);
    }
    if payer_spendable_micro < PAYER_FLOOR_MICRO.saturating_add(welcome_transfer_micro()) {
        return Err(GrantRefusal::PayerLow);
    }
    let env = p.sign_transfer(payout).map_err(GrantRefusal::Submit)?;
    let tx_hash = crate::consensus::tx_hash_for_env(&env).ok();
    Ok((env, GrantCommit { nullifier_hex, payout_wallet: payout.to_string(), tx_hash, now_ms }))
}
