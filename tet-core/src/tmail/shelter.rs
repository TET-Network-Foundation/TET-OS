//! Shelter: a members-only space (docs/plans/SHELTER.md, "Implementation v1").
//!
//! - **Off unless configured.** `TET_SHELTER_MODERATOR` (the moderator's wallet) and
//!   `TET_SHELTER_BOARD` (the invite-only board the moderator created) switch it on; with either
//!   unset every Shelter route answers 404 and nothing here applies.
//! - **The log is the membership.** Every step is a signed record ([`ShelterRecordV1`]); the node
//!   replays the accepted records in order ([`replay`]) to know who is a member, who may vouch, who
//!   is suspended, and which cases stand. Nothing else decides it.
//! - **Members:** the moderator, at most [`SHELTER_MOD_INVITES`] in-person invites from the
//!   moderator, then at most [`SHELTER_VOUCHES`] in-person vouches from each member.
//!   `met_in_person=true` is required: it is the voucher's statement, not something TET can check.
//! - **Accountability:** a confirmed bot case removes that member and takes the right to vouch from
//!   whoever vouched for them; a second standing case against the same voucher suspends their
//!   posting for [`SHELTER_SUSPEND_MS`]. An appeal decided within [`SHELTER_APPEAL_MS`] can
//!   overturn a case, which restores everything it took.
//! - **One moderator (v1):** cases and appeals are decided by the same person. Weaker than the
//!   plan's two-person rule; stated to members. The moderator's own invitees are the moderator's
//!   responsibility (there is no one above to apply the voucher rule to).
//! - **Node-local:** Shelter posts are never gossiped, and reads are members-only
//!   ([`verify_read_auth`]).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::Digest as _;

use crate::tmail::envelope::TmailHybridSig;

pub const SHELTER_RECORD_KIND: &str = "tet_shelter_record_v1";
/// In-person invites the moderator can give (the first members).
pub const SHELTER_MOD_INVITES: u32 = 10;
/// In-person vouches each member can give.
pub const SHELTER_VOUCHES: u32 = 3;
/// A second standing case against a voucher suspends their posting this long.
pub const SHELTER_SUSPEND_MS: u64 = 90 * 86_400_000;
/// An appeal must be decided within this long of its case.
pub const SHELTER_APPEAL_MS: u64 = 14 * 86_400_000;
/// A record's time may differ from the node's clock by at most this much when it arrives.
pub const SHELTER_RECORD_SKEW_MS: u64 = 10 * 60_000;
/// A signed read is good for this long.
pub const SHELTER_READ_SKEW_MS: u64 = 2 * 60_000;
/// The anonymous option needs at least this many members in Shelter's own set.
pub const SHELTER_ANON_MIN: usize = 3;
pub const NICKNAME_MAX_CHARS: usize = 24;
pub const REASON_MAX_CHARS: usize = 280;

/// The moderator's wallet and the Shelter board, or `None` (Shelter is off).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShelterConfig {
    pub moderator: String,
    pub board: String,
}

fn is_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn config_from_env() -> Option<ShelterConfig> {
    let get = |k: &str| std::env::var(k).ok().map(|v| v.trim().to_ascii_lowercase()).filter(|v| is_64hex(v));
    let moderator = get("TET_SHELTER_MODERATOR")?;
    let board = get("TET_SHELTER_BOARD")?;
    if moderator == board {
        return None;
    }
    Some(ShelterConfig { moderator, board })
}

/// Is `wallet` this node's Shelter board?
pub fn is_shelter_board(wallet: &str) -> bool {
    config_from_env().is_some_and(|c| c.board == wallet.trim().to_ascii_lowercase())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShelterAction {
    /// The moderator lets someone in (met in person).
    Invite,
    /// A member vouches for someone (met in person).
    Vouch,
    /// A member leaves.
    Withdraw,
    /// A member sets their nickname (`text`).
    Nickname,
    /// The moderator confirms that a member's key is run by a bot (`text`: the reason).
    Case,
    /// The moderator decides the appeal of a case (`subject`: the case id; `decision`:
    /// `overturn` or `keep`; `text`: the reason).
    Appeal,
}

impl ShelterAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Invite => "invite",
            Self::Vouch => "vouch",
            Self::Withdraw => "withdraw",
            Self::Nickname => "nickname",
            Self::Case => "case",
            Self::Appeal => "appeal",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShelterRecordV1 {
    pub v: u32,
    pub kind: String,
    pub action: ShelterAction,
    pub signer: String,
    /// A wallet (invite, vouch, withdraw, case), the signer's own (nickname), or a case id (appeal).
    pub subject: String,
    #[serde(default)]
    pub met_in_person: bool,
    /// A nickname, or a case's or appeal's reason.
    #[serde(default)]
    pub text: String,
    /// An appeal's decision: `overturn` or `keep`. Empty otherwise.
    #[serde(default)]
    pub decision: String,
    pub at_ms: u64,
    pub hybrid_sig: TmailHybridSig,
}

/// `tet shelter record v1|chain_id=…|genesis_hash=…|action=…|signer=…|subject=…|met_in_person=…|text_sha256=…|decision=…|at_ms=…|mldsa_pk=…`
pub fn record_auth_message_bytes(r: &ShelterRecordV1, mldsa_pubkey_b64: &str) -> Vec<u8> {
    format!(
        "tet shelter record v1|chain_id={}|genesis_hash={}|action={}|signer={}|subject={}|met_in_person={}|text_sha256={}|decision={}|at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        r.action.as_str(),
        r.signer.trim().to_ascii_lowercase(),
        r.subject.trim().to_ascii_lowercase(),
        r.met_in_person,
        hex::encode(sha2::Sha256::digest(r.text.as_bytes())),
        r.decision,
        r.at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// A record's id: SHA-256 of what was signed. A case is referred to by its id.
pub fn record_id(r: &ShelterRecordV1) -> String {
    hex::encode(sha2::Sha256::digest(record_auth_message_bytes(r, &r.hybrid_sig.mldsa_pubkey_b64)))
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ShelterError {
    #[error("Shelter is not open on this node")]
    Off,
    #[error("unsupported record version or kind")]
    Version,
    #[error("malformed record: {0}")]
    Malformed(&'static str),
    #[error("the record must be signed by its signer's own wallet")]
    SignerMismatch,
    #[error("hybrid signature verification failed")]
    Signature,
    #[error("the record's time is too far from now; check the device clock")]
    Clock,
    #[error("{0}")]
    Refused(&'static str),
}

/// Shape and signature. Whether the record is allowed is [`ShelterState::apply`]'s job.
pub fn verify_record(r: &ShelterRecordV1) -> Result<(), ShelterError> {
    if r.v != 1 || r.kind != SHELTER_RECORD_KIND {
        return Err(ShelterError::Version);
    }
    let signer = r.signer.trim().to_ascii_lowercase();
    if !is_64hex(&signer) || r.signer != signer {
        return Err(ShelterError::Malformed("signer"));
    }
    // A wallet, or (for an appeal) a case id: 64 lowercase hex either way.
    if !is_64hex(&r.subject) || r.subject != r.subject.to_ascii_lowercase() {
        return Err(ShelterError::Malformed("subject"));
    }
    if r.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase() != signer {
        return Err(ShelterError::SignerMismatch);
    }
    crate::quantum_shield::verify_hybrid(
        &signer,
        Some(&r.hybrid_sig.ed25519_sig_b64),
        Some(&r.hybrid_sig.mldsa_pubkey_b64),
        Some(&r.hybrid_sig.mldsa_sig_b64),
        &record_auth_message_bytes(r, &r.hybrid_sig.mldsa_pubkey_b64),
    )
    .map_err(|_| ShelterError::Signature)
}

/// A nickname: 1–24 characters, letters, digits, spaces, `_`, `-`, `.`; no leading or trailing
/// space; not a word the page uses for something else.
pub fn nickname_ok(n: &str) -> bool {
    let count = n.chars().count();
    if count == 0 || count > NICKNAME_MAX_CHARS || n.trim() != n {
        return false;
    }
    if !n.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '-' || c == '.') {
        return false;
    }
    let lower = n.to_lowercase();
    !["anonymous", "anon", "moderator", "mod", "tet", "匿名", "管理人", "モデレーター", "版主"].contains(&lower.as_str())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ShelterMember {
    pub wallet: String,
    /// Who let them in: the moderator (invite) or a member (vouch). `None` for the moderator.
    pub via: Option<String>,
    pub joined_at_ms: u64,
    pub nickname: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ShelterCase {
    pub id: String,
    pub subject: String,
    /// Who had let the subject in.
    pub voucher: Option<String>,
    pub at_ms: u64,
    pub reason: String,
    /// `None` until an appeal is decided; then `overturn` or `keep`.
    pub appeal: Option<String>,
    pub appeal_at_ms: Option<u64>,
}

impl ShelterCase {
    pub fn stands(&self) -> bool {
        self.appeal.as_deref() != Some("overturn")
    }
}

/// Who is in, from the records, in order.
#[derive(Debug, Clone, Default)]
pub struct ShelterState {
    pub members: BTreeMap<String, ShelterMember>,
    /// Invites (moderator) or vouches (member) given, by giver. Leaving or removal doesn't refund.
    pub given: BTreeMap<String, u32>,
    pub cases: Vec<ShelterCase>,
    /// Members removed by a case, kept to restore them if it's overturned.
    removed: BTreeMap<String, ShelterMember>,
    /// Wallets that left; they can be let in again.
    left: BTreeSet<String>,
}

impl ShelterState {
    pub fn new(cfg: &ShelterConfig) -> Self {
        let mut s = Self::default();
        s.members.insert(
            cfg.moderator.clone(),
            ShelterMember { wallet: cfg.moderator.clone(), via: None, joined_at_ms: 0, nickname: None },
        );
        s
    }

    pub fn is_member(&self, w: &str) -> bool {
        self.members.contains_key(&w.trim().to_ascii_lowercase())
    }

    fn standing_cases_against_voucher(&self, voucher: &str) -> Vec<&ShelterCase> {
        self.cases.iter().filter(|c| c.stands() && c.voucher.as_deref() == Some(voucher)).collect()
    }

    /// May `w` vouch? A member who isn't the moderator, with no standing case against someone they
    /// let in, with vouches left.
    pub fn vouches_left(&self, cfg: &ShelterConfig, w: &str) -> u32 {
        if !self.is_member(w) {
            return 0;
        }
        let limit = if w == cfg.moderator { SHELTER_MOD_INVITES } else { SHELTER_VOUCHES };
        if w != cfg.moderator && !self.standing_cases_against_voucher(w).is_empty() {
            return 0;
        }
        limit.saturating_sub(self.given.get(w).copied().unwrap_or(0))
    }

    /// Until when `w`'s posting is suspended (two standing cases against people they let in), or
    /// `None`.
    pub fn suspended_until(&self, w: &str) -> Option<u64> {
        let cases = self.standing_cases_against_voucher(w);
        if cases.len() < 2 {
            return None;
        }
        Some(cases[1].at_ms.saturating_add(SHELTER_SUSPEND_MS))
    }

    pub fn may_post(&self, w: &str, now_ms: u64) -> bool {
        self.is_member(w) && self.suspended_until(w).is_none_or(|t| now_ms >= t)
    }

    /// The members whose keys count for the anonymous option now: current, not suspended.
    pub fn anon_eligible(&self, now_ms: u64) -> Vec<String> {
        self.members.keys().filter(|w| self.may_post(w, now_ms)).cloned().collect()
    }

    /// Apply one verified record. On `Err` the state is unchanged.
    pub fn apply(&mut self, cfg: &ShelterConfig, r: &ShelterRecordV1) -> Result<(), ShelterError> {
        let signer = r.signer.as_str();
        let subject = r.subject.as_str();
        match r.action {
            ShelterAction::Invite | ShelterAction::Vouch => {
                if r.action == ShelterAction::Invite && signer != cfg.moderator {
                    return Err(ShelterError::Refused("only the moderator invites; members vouch"));
                }
                if r.action == ShelterAction::Vouch && signer == cfg.moderator {
                    return Err(ShelterError::Refused("the moderator invites; members vouch"));
                }
                if !r.met_in_person {
                    return Err(ShelterError::Refused("you can only let in someone you met in person"));
                }
                if !self.is_member(signer) {
                    return Err(ShelterError::Refused("only a member can vouch"));
                }
                if subject == cfg.board {
                    return Err(ShelterError::Refused("that is the Shelter board itself"));
                }
                if self.is_member(subject) {
                    return Err(ShelterError::Refused("already a member"));
                }
                if self.removed.contains_key(subject) {
                    return Err(ShelterError::Refused("this key was removed by a case"));
                }
                if self.vouches_left(cfg, signer) == 0 {
                    return Err(if r.action == ShelterAction::Invite {
                        ShelterError::Refused("the moderator's invites are used")
                    } else if self.given.get(signer).copied().unwrap_or(0) >= SHELTER_VOUCHES {
                        ShelterError::Refused("you have vouched for 3 people already")
                    } else {
                        ShelterError::Refused("you can't vouch: someone you vouched for was confirmed as a bot")
                    });
                }
                *self.given.entry(signer.to_string()).or_insert(0) += 1;
                self.left.remove(subject);
                self.members.insert(
                    subject.to_string(),
                    ShelterMember { wallet: subject.to_string(), via: Some(signer.to_string()), joined_at_ms: r.at_ms, nickname: None },
                );
            }
            ShelterAction::Withdraw => {
                if signer != subject {
                    return Err(ShelterError::Refused("only a member can withdraw their own key"));
                }
                if signer == cfg.moderator {
                    return Err(ShelterError::Refused("the moderator can't leave"));
                }
                if self.members.remove(subject).is_none() {
                    return Err(ShelterError::Refused("not a member"));
                }
                self.left.insert(subject.to_string());
            }
            ShelterAction::Nickname => {
                if signer != subject || !self.is_member(signer) {
                    return Err(ShelterError::Refused("only a member sets their own nickname"));
                }
                if !nickname_ok(&r.text) {
                    return Err(ShelterError::Refused("a nickname is 1–24 letters, digits, spaces, _ - or ."));
                }
                let wanted = r.text.to_lowercase();
                if self.members.values().any(|m| m.wallet != signer && m.nickname.as_deref().map(str::to_lowercase).as_deref() == Some(wanted.as_str())) {
                    return Err(ShelterError::Refused("another member has that nickname"));
                }
                if let Some(m) = self.members.get_mut(signer) {
                    m.nickname = Some(r.text.clone());
                }
            }
            ShelterAction::Case => {
                if signer != cfg.moderator {
                    return Err(ShelterError::Refused("only the moderator decides cases"));
                }
                if subject == cfg.moderator {
                    return Err(ShelterError::Refused("the moderator can't be a case's subject"));
                }
                let reason_len = r.text.trim().chars().count();
                if reason_len == 0 || reason_len > REASON_MAX_CHARS {
                    return Err(ShelterError::Refused("a case needs its reason (up to 280 characters)"));
                }
                let Some(m) = self.members.remove(subject) else {
                    return Err(ShelterError::Refused("not a member"));
                };
                self.cases.push(ShelterCase {
                    id: record_id(r),
                    subject: subject.to_string(),
                    voucher: m.via.clone().filter(|v| *v != cfg.moderator),
                    at_ms: r.at_ms,
                    reason: r.text.trim().to_string(),
                    appeal: None,
                    appeal_at_ms: None,
                });
                self.removed.insert(subject.to_string(), m);
            }
            ShelterAction::Appeal => {
                if signer != cfg.moderator {
                    return Err(ShelterError::Refused("only the moderator decides appeals"));
                }
                if r.decision != "overturn" && r.decision != "keep" {
                    return Err(ShelterError::Refused("an appeal's decision is overturn or keep"));
                }
                let reason_len = r.text.trim().chars().count();
                if reason_len == 0 || reason_len > REASON_MAX_CHARS {
                    return Err(ShelterError::Refused("an appeal needs its reason (up to 280 characters)"));
                }
                let Some(i) = self.cases.iter().position(|c| c.id == subject) else {
                    return Err(ShelterError::Refused("no such case"));
                };
                if self.cases[i].appeal.is_some() {
                    return Err(ShelterError::Refused("this case's appeal was already decided"));
                }
                if r.at_ms > self.cases[i].at_ms.saturating_add(SHELTER_APPEAL_MS) {
                    return Err(ShelterError::Refused("the 14 days for an appeal have passed"));
                }
                self.cases[i].appeal = Some(r.decision.clone());
                self.cases[i].appeal_at_ms = Some(r.at_ms);
                if r.decision == "overturn" {
                    let who = self.cases[i].subject.clone();
                    if let Some(m) = self.removed.remove(&who) {
                        self.members.insert(who, m);
                    }
                }
            }
        }
        Ok(())
    }
}

/// Replay records in order; any that no longer apply are skipped (none should be: each was
/// checked against the same state when it was accepted).
pub fn replay<'a>(cfg: &ShelterConfig, records: impl IntoIterator<Item = &'a ShelterRecordV1>) -> ShelterState {
    let mut s = ShelterState::new(cfg);
    for r in records {
        let _ = s.apply(cfg, r);
    }
    s
}

/// One line of the log members see: never more than the record says.
pub fn log_line(r: &ShelterRecordV1) -> serde_json::Value {
    serde_json::json!({
        "id": record_id(r),
        "action": r.action,
        "by": r.signer,
        "subject": r.subject,
        "met_in_person": r.met_in_person,
        "text": r.text,
        "decision": r.decision,
        "at_ms": r.at_ms,
    })
}

/// `tet shelter read v1|chain_id=…|genesis_hash=…|wallet=…|path=…|at_ms=…|mldsa_pk=…`
pub fn read_auth_message_bytes(wallet: &str, path: &str, at_ms: u64, mldsa_pubkey_b64: &str) -> Vec<u8> {
    format!(
        "tet shelter read v1|chain_id={}|genesis_hash={}|wallet={}|path={}|at_ms={}|mldsa_pk={}",
        crate::genesis::chain_id_from_env(),
        crate::genesis::expected_genesis_hash_from_env(),
        wallet.trim().to_ascii_lowercase(),
        path,
        at_ms,
        mldsa_pubkey_b64.trim(),
    )
    .into_bytes()
}

/// A signed read: `x-tet-shelter-auth: <wallet>.<at_ms>.<ed25519 sig>.<ML-DSA public key>.<ML-DSA sig>`
/// (base64 parts; `.` never occurs in base64). Valid for [`SHELTER_READ_SKEW_MS`] and for the one
/// route it names. Returns the reader's wallet; membership is the caller's check.
pub fn verify_read_auth(header: &str, path: &str, now_ms: u64) -> Result<String, ShelterError> {
    let parts: Vec<&str> = header.trim().split('.').collect();
    let [wallet, at, ed_sig, pk, pq_sig] = parts.as_slice() else {
        return Err(ShelterError::Malformed("auth header"));
    };
    let wallet = wallet.to_ascii_lowercase();
    if !is_64hex(&wallet) {
        return Err(ShelterError::Malformed("auth wallet"));
    }
    let at: u64 = at.parse().map_err(|_| ShelterError::Malformed("auth time"))?;
    if at.abs_diff(now_ms) > SHELTER_READ_SKEW_MS {
        return Err(ShelterError::Clock);
    }
    crate::quantum_shield::verify_hybrid(&wallet, Some(ed_sig), Some(pk), Some(pq_sig), &read_auth_message_bytes(&wallet, path, at, pk))
        .map_err(|_| ShelterError::Signature)?;
    Ok(wallet)
}
