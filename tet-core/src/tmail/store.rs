//! Tmail node-local store — sled TTL buffer + key directory (spec §A.1, §A.2).
//!
//! Tmail is **off-ledger**: this buffer only holds gossiped/sent envelopes long enough for an
//! offline receiver to pull them via `GET /tmail/inbox/:wallet_id`. Entries expire per
//! `envelope.ttl_ms` (clamped) and a background task ([`TmailStore::prune_expired`]) reaps them.
//!
//! Trees (all opened on the **ledger's** sled `Db`, so deleting `TET_DB_DIR` clears them too):
//! - `tmail_by_receiver_v1` — key `receiver(64 hex ascii) ‖ sent_at_ms(BE u64) ‖ msg_id`, value = envelope JSON.
//!   The fixed 64-byte receiver prefix enables `scan_prefix`; the BE timestamp makes reverse
//!   iteration yield newest-first.
//! - `tmail_by_msg_id_v1` — key `msg_id`, value = receiver wallet id (idempotency / dedup), or a
//!   [`BURNED_PREFIX`] tombstone once the message has been burned (spec §A.3.2). The tombstone is
//!   what stops a re-gossiped envelope from resurrecting a burned message: `store_tmail` refuses
//!   any `msg_id` already present in this tree, burned or live.
//! - `tmail_keys_v1` — key `wallet_id`, value = [`crate::tmail::keys::TmailKeyRegistrationV1`] JSON.
//!
//! **Retention (S7-0, spec Appendix K.1).** A conversation keeps only its newest
//! [`RETAIN_PER_CONVERSATION`] messages. This is a *store* rule, not a display rule: the older ones
//! are deleted, not hidden. Conversation identity in Phase 0 is the counterparty wallet pair
//! (Appendix K.3 — flat threads, one conversation per counterparty), so for an inbox belonging to
//! `receiver` the grouping key is `sender_wallet_id`. **Anonymous mail is the exception:** its
//! sender is always the sentinel, so it is grouped by nullifier instead, and bounded per receiver
//! by [`ANON_RETAIN_PER_RECEIVER`] alongside the TTL.

use crate::tmail::envelope::TmailEnvelopeV1;
use crate::tmail::keys::TmailKeyRegistrationV1;

const TREE_BY_RECEIVER: &str = "tmail_by_receiver_v1";
const TREE_BY_MSG_ID: &str = "tmail_by_msg_id_v1";
const TREE_KEYS: &str = "tmail_keys_v1";
/// Anonymity-set registrations: key `wallet_id`, value = `TmailAnonRegistrationV1` JSON.
const TREE_ANON_REGISTRY: &str = "tmail_anon_registry_v1";
const TREE_POLL_ROOTS: &str = "tmail_poll_roots_v1";
/// Verdict per anonymous message: key `msg_id`, value = [`AnonVerdict`] JSON.
const TREE_ANON_VERDICT: &str = "tmail_anon_verdict_v1";
/// Content-addressed receipt cache: key = SHA-256 of the receipt, value = receipt bytes.
const TREE_ANON_RECEIPTS: &str = "tmail_anon_receipts_v1";
/// Nullifiers already seen, so one member cannot publish two ephemerals per (receiver, bucket).
const TREE_ANON_NULLIFIERS: &str = "tmail_anon_nullifiers_v1";
/// Fast anonymous posting (docs/plans/FAST_ANON_POSTING.md): `receiver|bucket|posting key` →
/// [`FastKey`], written when a post whose proof verified registers its posting key.
const TREE_ANON_FAST_KEYS: &str = "tmail_anon_fast_keys_v1";
/// `receiver|bucket|posting key|msg_id` → arrival ms, for fast posts that arrived (by gossip) before
/// their key's registration verified here. Bounded; see [`FAST_PENDING_PER_KEY`].
const TREE_ANON_FAST_PENDING: &str = "tmail_anon_fast_pending_v1";
/// `receiver|bucket|posting key` → msg_id of a registering post (one with a proof) that is stored
/// here but not yet verified. A gossiped fast post is held only while one exists.
const TREE_ANON_FAST_REGPENDING: &str = "tmail_anon_fast_regpending_v1";
/// Shelter's records, in order (`seq` big-endian → record JSON). The log is the membership.
const TREE_SHELTER_RECORDS: &str = "tmail_shelter_records_v1";
/// Shelter's anonymous-set roots that still count (see [`TmailStore::shelter_refresh_roots`]).
const TREE_SHELTER_ROOTS: &str = "tmail_shelter_roots_v1";
/// Each member's sealed board key: a Tmail envelope (end-to-end encrypted to that member) holding
/// the board's invite. The node keeps ciphertext it can't open; see [`TmailStore::set_shelter_key`].
const TREE_SHELTER_KEYS: &str = "tmail_shelter_keys_v1";
/// Shelter's invisible flood guard: per member key, a burst, then spaced, and a daily cap.
pub const SHELTER_BURST: u32 = 5;
pub const SHELTER_REFILL_MS: u64 = 3_000;
pub const SHELTER_DAILY_CAP: u32 = 100;

/// Fast posts per posting key: a burst, then one per refill interval (an invisible flood guard;
/// the page paces posts so normal conversation never meets it), and a daily cap.
pub const FAST_BURST: f64 = 5.0;
pub const FAST_REFILL_MS: u64 = 3_000;
pub const FAST_DAILY_CAP: u32 = 200;
/// Gossiped fast posts held before their registration verifies here: per key, in all, and for how long.
pub const FAST_PENDING_PER_KEY: usize = 50;
pub const FAST_PENDING_TOTAL: usize = 5_000;
pub const FAST_PENDING_TTL_MS: u64 = 10 * 60 * 1000;
/// One daily ID's share of a board's anonymous posts (of [`ANON_RETAIN_PER_RECEIVER`]), so one
/// member posting fast can't push everyone else off a board. Its own oldest go first.
pub const ANON_RETAIN_PER_DAILY_ID: usize = 20;

/// Cap on cached receipts. Each is ~250 KiB, so this is the one Tmail structure where size, not
/// count, is the binding constraint: 2,000 × 250 KiB ≈ 500 MB.
const DEFAULT_ANON_RECEIPT_CACHE: usize = 2_000;

/// Cap on registrations this node will hold. Registration is free, so the registry is an
/// attacker-writable structure and must be bounded like the message buffer is.
///
/// At the cap the node stops accepting **new** wallets and says so; existing wallets can still
/// update their commitment. The alternative — evicting members — is worse: it silently shrinks
/// other people's anonymity set and invalidates in-flight proofs. Refusing to grow is visible and
/// recoverable; evicting is neither.
const DEFAULT_ANON_MAX_MEMBERS: usize = 50_000;

/// How long a root stays acceptable after this node first computed it.
///
/// Sized from what actually has to happen inside it: build a proof (~33 s measured), gossip the
/// envelope, pull the receipt, verify. Verification happens **on arrival**, so this window does not
/// have to cover a receiver being offline — only the send-to-verify path. 60 min is far more than
/// the measured margin; see `SPRINT_PLAN.md` § S8 for the numbers.
const DEFAULT_ANON_ROOT_WINDOW_MS: u64 = 60 * 60 * 1000;

/// Cap on cached epoch roots. A backstop on memory, **not** a correctness bound — see
/// [`TmailStore::accepts_anon_root`], where an uncached epoch root is recomputed rather than
/// treated as unknown.
const DEFAULT_ANON_ROOT_HISTORY: usize = 512;

/// Epoch length for registry roots: 60 s.
///
/// # Why roots are epoch-based and not per-registration
///
/// The first design recorded a new root on every registration and kept the last 512. Registration
/// is free, so an attacker could push more than 512 registrations inside the acceptance window and
/// evict every honest root from the history — valid proofs would then fail, network-wide, for the
/// cost of some signatures. A denial of service on anonymity itself.
///
/// With epochs the number of roots is bounded by **time**, not by registration volume: 60 per hour
/// however many registrations arrive. A flood changes what the *next* epoch's root will be and
/// nothing else.
///
/// Registrations are admitted to the store immediately and enter the **tree** at the next epoch
/// boundary. A pleasant side effect: two nodes holding the same registrations converge on the same
/// root at the boundary, instead of chasing each other through a sequence of per-registration
/// roots that may never coincide.
const DEFAULT_ANON_EPOCH_MS: u64 = 60_000;

/// Hard cap on how many epoch roots a single acceptance check will compute.
///
/// Acceptance walks back epoch by epoch, and each miss builds a Merkle tree. Without a cap the
/// work is `window_ms / epoch_ms`, which a misconfiguration turns into millions of tree builds per
/// verification — a self-inflicted denial of service, and one that a *smaller* `epoch_ms` makes
/// worse rather than better. With the defaults (60 min / 60 s) the walk is 60 epochs.
///
/// The effective window is therefore `min(window_ms, ANON_MAX_ROOT_SCAN * epoch_ms)`, reported by
/// [`TmailStore::anon_effective_window_ms`] so a shortfall is visible rather than surprising.
const ANON_MAX_ROOT_SCAN: u64 = 128;

/// One commitment update per wallet per 24 h.
///
/// Without this, churning an existing registration is an unmetered way to move the root every
/// epoch forever, which is the same attack wearing a different hat — the member cap does not bind
/// it because the wallet is already a member.
const DEFAULT_ANON_UPDATE_COOLDOWN_MS: u64 = 24 * 60 * 60 * 1000;

/// Tombstone marker written into `tmail_by_msg_id_v1` when a message is burned. The suffix is the
/// original entry's expiry in ms, so `prune_expired` can reap tombstones instead of growing a tree
/// that never shrinks.
const BURNED_PREFIX: &[u8] = b"burned:";

/// Marker written into `tmail_by_msg_id_v1` when a message is dropped by the retention rule.
///
/// Distinct from [`BURNED_PREFIX`] on purpose: "aged out of a conversation" and "destroyed on the
/// sender's instruction" are different facts, and only the latter is a burn. Both stop a
/// re-gossiped copy from coming back, and both carry the original expiry so `prune_expired` reaps
/// them instead of growing a tree that never shrinks.
const PRUNED_PREFIX: &[u8] = b"pruned:";

/// Messages kept per conversation (spec Appendix K.1 / AT-7). Older ones are deleted.
pub const RETAIN_PER_CONVERSATION: usize = 5;

/// Most anonymous messages one receiver keeps, across all anonymous senders.
///
/// Anonymous mail is grouped per nullifier (see [`conversation_key`]), so the per-conversation
/// rule alone would not bound it: every new nullifier is a new conversation. This is the bound,
/// alongside the TTL. Env override: `TET_TMAIL_ANON_RETAIN_PER_RECEIVER`.
pub const ANON_RETAIN_PER_RECEIVER: usize = 100;

const DEFAULT_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_MAX_ENTRIES: usize = 50_000;

#[derive(Debug, thiserror::Error)]
pub enum TmailStoreError {
    #[error("sled error: {0}")]
    Sled(#[from] sled::Error),
    #[error("serialization error: {0}")]
    Serde(String),
    #[error("empty msg_id")]
    EmptyMsgId,
    #[error("invalid receiver wallet id (expected 64 hex)")]
    InvalidReceiver,
    #[error("tmail buffer full (max_entries={0})")]
    Full(usize),
    #[error("key registration verification failed: {0}")]
    KeyVerify(String),
    #[error("this wallet is a poll: {0}")]
    PollBallot(String),
    #[error("fast anonymous post: {0}")]
    FastPost(String),
    #[error("Shelter: {0}")]
    Shelter(String),
}

pub struct TmailStore {
    by_receiver: sled::Tree,
    by_msg_id: sled::Tree,
    keys: sled::Tree,
    anon_registry: sled::Tree,
    anon_verdict: sled::Tree,
    anon_receipts: sled::Tree,
    anon_nullifiers: sled::Tree,
    /// Members-only poll roots, by poll wallet (tmail/poll.rs). Immutable once set.
    poll_roots: sled::Tree,
    fast_keys: sled::Tree,
    fast_pending: sled::Tree,
    fast_regpending: sled::Tree,
    /// Per posting key: (tokens, last refill ms, UTC day, posts that day). In memory: a restart
    /// refills the burst, which the per-address limits still bound.
    fast_flood: std::sync::Mutex<std::collections::HashMap<String, (f64, u64, u64, u32)>>,
    /// Memoised `(epoch, root)`. Purely a cache — a miss is recomputed from the registry, so
    /// losing it (restart, eviction, flood) costs time and never acceptance.
    anon_roots: std::sync::Mutex<Vec<(u64, [u8; 32])>>,
    /// Serialises an anonymous send's check → store → (on failure) release, so a release can never
    /// interleave with another store of the same message and free a nullifier a stored post holds.
    /// Serialises [`Self::send_anonymous`] (check → store → release). Only ever taken on a
    /// blocking thread, never on the async runtime.
    anon_send_lock: std::sync::Mutex<()>,
    shelter_records: sled::Tree,
    shelter_roots: sled::Tree,
    shelter_keys: sled::Tree,
    /// Serialises Shelter record checks and appends (check against the state, then append).
    shelter_lock: std::sync::Mutex<()>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(default)
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(default)
}

fn is_wallet_id_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// How long messages and posts are kept: (default, longest), as `store_tmail` applies them.
pub fn retention_ms() -> (u64, u64) {
    (effective_ttl_ms(0), effective_ttl_ms(u64::MAX))
}

/// Effective TTL after clamping: `0` (unset) → default; otherwise capped at the max.
fn effective_ttl_ms(ttl_ms: u64) -> u64 {
    let max = env_u64("TET_TMAIL_MAX_TTL_MS", MAX_TTL_MS);
    if ttl_ms == 0 {
        env_u64("TET_TMAIL_DEFAULT_TTL_MS", DEFAULT_TTL_MS).min(max)
    } else {
        ttl_ms.min(max)
    }
}

fn is_expired(env: &TmailEnvelopeV1, now: u64) -> bool {
    let expire_at = env.sent_at_ms.saturating_add(effective_ttl_ms(env.ttl_ms));
    now > expire_at
}

/// Effective per-conversation retention. Env override exists so tests and operators can move it
/// without a rebuild; `0` is rejected by `env_usize`'s filter, so the cap can never be disabled
/// into "keep nothing".
fn retain_per_conversation() -> usize {
    env_usize("TET_TMAIL_RETAIN_PER_CONVERSATION", RETAIN_PER_CONVERSATION)
}

fn anon_retain_per_daily_id() -> usize {
    env_usize("TET_TMAIL_ANON_RETAIN_PER_DAILY_ID", ANON_RETAIN_PER_DAILY_ID)
}

fn anon_retain_per_receiver() -> usize {
    env_usize("TET_TMAIL_ANON_RETAIN_PER_RECEIVER", ANON_RETAIN_PER_RECEIVER)
}

fn is_anonymous(env: &TmailEnvelopeV1) -> bool {
    env.anonymous.is_some()
}

/// An anonymous post without a proof of its own: valid only for a registered posting key.
pub fn is_fast_post(env: &TmailEnvelopeV1) -> bool {
    env.anonymous.as_ref().is_some_and(|a| a.anchor_proof.is_none())
}

fn fast_key(receiver: &str, bucket: u64, posting_key: &str) -> String {
    format!("{}|{bucket:020}|{}", receiver.trim().to_ascii_lowercase(), posting_key.trim().to_ascii_lowercase())
}

/// A posting key's registration: the nullifier its proof carried (the daily ID's source).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct FastKey {
    pub nullifier_hex: String,
    pub registered_at_ms: u64,
    pub by_msg_id: String,
}

/// Why a fast post was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FastSendError {
    /// Not an anonymous post without a proof.
    NotFast,
    /// A poll takes only ballots with their own proof.
    Poll,
    /// Posting keys are per UTC day; this post is dated another day.
    WrongDay,
    /// No post with a verified proof has registered this key for this board today.
    NotRegistered,
    /// The invisible flood guard: posted faster than a person types. Try again in a moment.
    Busy,
    /// The day's cap for this key.
    DailyCap,
    Store(String),
}

/// Conversation key for an inbox entry (Appendix K.3, Phase 0 flat threads): the counterparty.
///
/// **Anonymous mail is keyed by its nullifier, not its sender.** Every anonymous envelope has the
/// same `sender_wallet_id` (the sentinel), so keying by sender made all anonymous mail to a
/// receiver one conversation, and the sixth anonymous message from a sixth member evicted the
/// first. A nullifier is one per (member, receiver, day), which is the closest thing to a
/// counterparty an anonymous sender has. Anonymous mail is bounded per receiver instead, by
/// [`ANON_RETAIN_PER_RECEIVER`].
///
/// A post with a proof is keyed by its proof's nullifier, as always. A **fast post** (no proof;
/// docs/plans/FAST_ANON_POSTING.md) is keyed by the nullifier of the post that registered its posting
/// key, or, while that one is still being checked here, of the registering post waiting here. So
/// all of one member's posts on one board on one day are one group, which holds
/// [`ANON_RETAIN_PER_DAILY_ID`].
///
/// **Only a VERIFIED nullifier groups** (#98): never the journal a post announces. An unverified
/// post, and a fast post whose key isn't registered here yet, is its own group, so posts that may
/// later fail can never share a verified post's group and push it out.
fn conversation_key_with(env: &TmailEnvelopeV1, verified_nullifier: impl FnOnce() -> Option<String>) -> String {
    if env.anonymous.is_some() {
        return match verified_nullifier() {
            Some(n) => format!("anonymous:{n}"),
            None => format!("anonymous:unverified:{}", env.msg_id.trim()),
        };
    }
    env.sender_wallet_id.trim().to_ascii_lowercase()
}

fn receiver_index_key(receiver: &str, sent_at_ms: u64, msg_id: &str) -> Vec<u8> {
    let mut k = Vec::with_capacity(receiver.len() + 8 + msg_id.len());
    k.extend_from_slice(receiver.as_bytes());
    k.extend_from_slice(&sent_at_ms.to_be_bytes());
    k.extend_from_slice(msg_id.as_bytes());
    k
}

impl TmailStore {
    /// Open the Tmail trees on the ledger's sled `Db` (see [`crate::ledger::Ledger::sled_db`]).
    pub fn open(db: &sled::Db) -> Result<Self, TmailStoreError> {
        Ok(Self {
            by_receiver: db.open_tree(TREE_BY_RECEIVER)?,
            by_msg_id: db.open_tree(TREE_BY_MSG_ID)?,
            keys: db.open_tree(TREE_KEYS)?,
            anon_registry: db.open_tree(TREE_ANON_REGISTRY)?,
            anon_verdict: db.open_tree(TREE_ANON_VERDICT)?,
            anon_receipts: db.open_tree(TREE_ANON_RECEIPTS)?,
            anon_nullifiers: db.open_tree(TREE_ANON_NULLIFIERS)?,
            poll_roots: db.open_tree(TREE_POLL_ROOTS)?,
            fast_keys: db.open_tree(TREE_ANON_FAST_KEYS)?,
            fast_pending: db.open_tree(TREE_ANON_FAST_PENDING)?,
            fast_regpending: db.open_tree(TREE_ANON_FAST_REGPENDING)?,
            fast_flood: std::sync::Mutex::new(std::collections::HashMap::new()),
            anon_roots: std::sync::Mutex::new(Vec::new()),
            anon_send_lock: std::sync::Mutex::new(()),
            shelter_records: db.open_tree(TREE_SHELTER_RECORDS)?,
            shelter_roots: db.open_tree(TREE_SHELTER_ROOTS)?,
            shelter_keys: db.open_tree(TREE_SHELTER_KEYS)?,
            shelter_lock: std::sync::Mutex::new(()),
        })
    }

    fn max_entries() -> usize {
        env_usize("TET_TMAIL_MAX_ENTRIES", DEFAULT_MAX_ENTRIES)
    }

    /// Buffer a (already signature-verified) envelope.
    ///
    /// Returns `Ok(true)` if newly stored, `Ok(false)` if a message with the same `msg_id` was
    /// already present (idempotent duplicate). Callers MUST have run
    /// [`crate::tmail::envelope::verify_tmail_envelope_v1`] first.
    pub fn store_tmail(&self, env: &TmailEnvelopeV1) -> Result<bool, TmailStoreError> {
        // A fast post (anonymous, no proof) is stored only through `send_fast_anonymous` /
        // `receive_fast_anonymous`, which check its posting key's registration first.
        if is_fast_post(env) {
            return Err(TmailStoreError::FastPost("a fast post needs a registered posting key".into()));
        }
        // Shelter's board takes named posts only from a current, unsuspended member (anonymous ones
        // prove membership against Shelter's own root instead).
        if !env.flags.anonymous
            && let Some(cfg) = crate::tmail::shelter::config_from_env()
            && cfg.board == env.receiver_wallet_id.trim().to_ascii_lowercase()
            && !self.shelter_state(&cfg).may_post(&env.sender_wallet_id.trim().to_ascii_lowercase(), now_ms())
        {
            return Err(TmailStoreError::Shelter("only a member can post here".into()));
        }
        self.store_tmail_inner(env, true)
    }

    /// Tests only: store as `store_tmail` does but without the poll-ballot gate, to fill a poll's
    /// inbox without real proofs.
    #[cfg(test)]
    pub fn store_tmail_ungated_for_tests(&self, env: &TmailEnvelopeV1) -> Result<bool, TmailStoreError> {
        self.store_tmail_inner(env, false)
    }

    fn store_tmail_inner(&self, env: &TmailEnvelopeV1, poll_gate: bool) -> Result<bool, TmailStoreError> {
        let msg_id = env.msg_id.trim();
        if msg_id.is_empty() {
            return Err(TmailStoreError::EmptyMsgId);
        }
        let receiver = env.receiver_wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&receiver) {
            return Err(TmailStoreError::InvalidReceiver);
        }
        // Idempotency: skip if we've already seen this msg_id (gossip + self-store both call here).
        if self.by_msg_id.contains_key(msg_id.as_bytes())? {
            return Ok(false);
        }
        // Capacity guard: reap expired first, then reject if still at the cap.
        let max = Self::max_entries();
        if self.by_receiver.len() >= max {
            let _ = self.prune_expired();
            if self.by_receiver.len() >= max {
                return Err(TmailStoreError::Full(max));
            }
        }
        let val = serde_json::to_vec(env).map_err(|e| TmailStoreError::Serde(e.to_string()))?;
        let key = receiver_index_key(&receiver, env.sent_at_ms, msg_id);
        // A poll's wallet stores only anonymous ballots this node verified (tmail/poll.rs), so junk
        // can't crowd real ballots out. Gossip and REST both come through here. Checked after
        // everything that can refuse for other reasons, because it claims the ballot's nullifier.
        let claimed = if poll_gate && self.get_poll_root(&receiver).is_some() {
            Some(self.poll_ballot_gate(env).map_err(TmailStoreError::PollBallot)?)
        } else {
            None
        };
        let written = self
            .by_receiver
            .insert(key, val)
            .and_then(|_| self.by_msg_id.insert(msg_id.as_bytes(), receiver.as_bytes()));
        if let Err(e) = written {
            // Not stored: give the nullifier back, or the member's vote is lost (a resend would be
            // refused as a replay).
            if let Some(nullifier) = claimed {
                self.release_anon_nullifier(&nullifier, msg_id);
            }
            return Err(e.into());
        }
        // Retention is applied at write time so the store never holds more than the rule allows,
        // even if nothing ever calls `GET /tmail/inbox`. Enforcing it only on read would make the
        // cap a display convention again -- exactly what S7-0 exists to stop being true.
        self.enforce_retention(&receiver, &self.conversation_key(env))?;
        if is_anonymous(env) {
            self.enforce_anonymous_cap(&receiver)?;
        }
        Ok(true)
    }

    /// Delete anonymous mail past the newest [`ANON_RETAIN_PER_RECEIVER`] for one receiver.
    ///
    /// Same ordering and the same [`PRUNED_PREFIX`] marker as [`Self::enforce_retention`], so two
    /// nodes holding the same mail drop the same messages, and a re-gossiped one stays dropped.
    pub fn enforce_anonymous_cap(&self, receiver: &str) -> Result<usize, TmailStoreError> {
        let receiver = receiver.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&receiver) {
            return Ok(0);
        }
        let keep = self.anon_keep_for(&receiver);
        let mut rows: Vec<(u64, Vec<u8>, String, u64)> = Vec::new();
        let verified = |msg_id: &str| matches!(self.get_anon_verdict(msg_id), Some(AnonVerdict::Verified { .. }));
        for item in self.by_receiver.scan_prefix(receiver.as_bytes()) {
            let Ok((k, v)) = item else { continue };
            let Ok(env) = serde_json::from_slice::<TmailEnvelopeV1>(&v) else {
                continue;
            };
            if !is_anonymous(&env) {
                continue;
            }
            let expire_at = env.sent_at_ms.saturating_add(effective_ttl_ms(env.ttl_ms));
            rows.push((env.sent_at_ms, k.to_vec(), env.msg_id.trim().to_string(), expire_at));
        }
        if rows.len() <= keep {
            return Ok(0);
        }
        // Verified posts first, then newest: unverified (pending) envelopes can never push a verified
        // post out, however many arrive.
        rows.sort_by(|a, b| verified(&b.2).cmp(&verified(&a.2)).then_with(|| b.0.cmp(&a.0)).then_with(|| b.1.cmp(&a.1)));
        let mut removed = 0usize;
        for (_sent, key, msg_id, expire_at) in rows.into_iter().skip(keep) {
            if matches!(self.by_receiver.remove(&key), Ok(Some(_))) {
                removed += 1;
            }
            if !msg_id.is_empty() {
                let mut mark = PRUNED_PREFIX.to_vec();
                mark.extend_from_slice(expire_at.to_string().as_bytes());
                self.by_msg_id.insert(msg_id.as_bytes(), mark)?;
            }
        }
        Ok(removed)
    }

    /// Delete everything past the newest [`retain_per_conversation`] messages in one conversation.
    ///
    /// Conversation = `(receiver, counterparty)` (Appendix K.3 flat threads). Returns how many
    /// entries were deleted.
    ///
    /// Dropped entries keep a [`PRUNED_PREFIX`] marker in `tmail_by_msg_id_v1`, so a peer
    /// re-gossiping an aged-out message cannot reinsert it and start the churn again.
    pub fn enforce_retention(
        &self,
        receiver: &str,
        counterparty: &str,
    ) -> Result<usize, TmailStoreError> {
        let receiver = receiver.trim().to_ascii_lowercase();
        let counterparty = counterparty.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&receiver) {
            return Ok(0);
        }
        if self.is_pinned(&receiver, &counterparty) {
            return Ok(0);
        }
        // One daily ID's share of the board's anonymous posts; named conversations keep theirs.
        let keep = if counterparty.starts_with("anonymous:") { anon_retain_per_daily_id() } else { retain_per_conversation() };

        // (sent_at_ms, key, msg_id, expire_at) for this conversation, newest first.
        let mut rows: Vec<(u64, Vec<u8>, String, u64)> = Vec::new();
        for item in self.by_receiver.scan_prefix(receiver.as_bytes()) {
            let Ok((k, v)) = item else { continue };
            let Ok(env) = serde_json::from_slice::<TmailEnvelopeV1>(&v) else {
                continue;
            };
            if self.conversation_key(&env) != counterparty {
                continue;
            }
            let expire_at = env.sent_at_ms.saturating_add(effective_ttl_ms(env.ttl_ms));
            rows.push((
                env.sent_at_ms,
                k.to_vec(),
                env.msg_id.trim().to_string(),
                expire_at,
            ));
        }
        if rows.len() <= keep {
            return Ok(0);
        }
        // Newest first, tie-broken by key so the ordering is total and deletion is deterministic
        // across nodes -- two nodes holding the same conversation must drop the same messages.
        rows.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));

        let mut removed = 0usize;
        for (_sent, key, msg_id, expire_at) in rows.into_iter().skip(keep) {
            if matches!(self.by_receiver.remove(&key), Ok(Some(_))) {
                removed += 1;
            }
            if !msg_id.is_empty() {
                let mut mark = PRUNED_PREFIX.to_vec();
                mark.extend_from_slice(expire_at.to_string().as_bytes());
                self.by_msg_id.insert(msg_id.as_bytes(), mark)?;
            }
        }
        Ok(removed)
    }

    /// Is this conversation pinned, and therefore exempt from the retention rule?
    ///
    /// **Always `false` in Phase 0 — there is no way to pin.** Pin is a 1_000 µTET fee settled by
    /// `TxV1::TmailPin`, which is batched into the Phase 1 genesis (see
    /// `PHASE_1_GENESIS_SPEC.md` §2 and `SPRINT_PLAN.md` § S7), so no pin record can exist yet.
    ///
    /// This is a seam, not dead code: `enforce_retention` and `get_inbox` both consult it, so when
    /// the Phase 1 pin store lands the exemption is already wired and AT-7(b) turns green by
    /// replacing this body. It is also what makes AT-7(b) fail *for the right reason* today —
    /// "nothing can pin" rather than an unexplained off-by-one.
    pub fn is_pinned(&self, _receiver: &str, _counterparty: &str) -> bool {
        false
    }

    /// Was this message dropped by the retention rule (as opposed to burned, or never seen)?
    pub fn is_retention_pruned(&self, msg_id: &str) -> bool {
        self.by_msg_id
            .get(msg_id.trim().as_bytes())
            .ok()
            .flatten()
            .is_some_and(|v| v.starts_with(PRUNED_PREFIX))
    }

    /// Return up to `limit` non-expired envelopes addressed to `wallet_id`, newest first, capped at
    /// [`retain_per_conversation`] **per conversation** (spec Appendix K.1), and anonymous mail at
    /// [`ANON_RETAIN_PER_RECEIVER`] in total.
    ///
    /// The cap is applied here as well as at write time. That is deliberate belt-and-braces: the
    /// store is the authority and `enforce_retention` already deleted the overflow, but a stale row
    /// (a crash between insert and enforce, an older DB) must not leak past the documented API
    /// contract just because pruning lagged.
    pub fn get_inbox(&self, wallet_id: &str, limit: usize) -> Vec<TmailEnvelopeV1> {
        let receiver = wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&receiver) {
            return Vec::new();
        }
        let now = now_ms();
        let keep = retain_per_conversation();
        let anon_keep = self.anon_keep_for(&receiver);
        let mut anon_seen = 0usize;
        let mut per_conversation: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        let mut out = Vec::new();
        // `scan_prefix(..).rev()` → descending key order → descending sent_at_ms → newest first.
        for item in self.by_receiver.scan_prefix(receiver.as_bytes()).rev() {
            if out.len() >= limit {
                break;
            }
            let Ok((_k, v)) = item else { continue };
            let Ok(env) = serde_json::from_slice::<TmailEnvelopeV1>(&v) else {
                continue;
            };
            if is_expired(&env, now) {
                continue;
            }
            // Defensive server-side filter: only deliver mail actually addressed to this wallet.
            if env.receiver_wallet_id.trim().to_ascii_lowercase() != receiver {
                continue;
            }
            // Iteration is newest-first, so the first `keep` seen per conversation are the ones
            // retention would have kept.
            let counterparty = self.conversation_key(&env);
            let keep_here = if counterparty.starts_with("anonymous:") { anon_retain_per_daily_id() } else { keep };
            let slot = per_conversation.entry(counterparty.clone()).or_insert(0);
            if *slot >= keep_here && !self.is_pinned(&receiver, &counterparty) {
                continue;
            }
            if is_anonymous(&env) {
                if anon_seen >= anon_keep {
                    continue;
                }
                anon_seen += 1;
            }
            *slot += 1;
            out.push(env);
        }
        out
    }

    /// Delete every expired entry from both indexes. Returns the number removed.
    pub fn prune_expired(&self) -> usize {
        let now = now_ms();
        let mut to_delete: Vec<(Vec<u8>, String)> = Vec::new();
        for item in self.by_receiver.iter() {
            let Ok((k, v)) = item else { continue };
            match serde_json::from_slice::<TmailEnvelopeV1>(&v) {
                Ok(env) => {
                    if is_expired(&env, now) {
                        to_delete.push((k.to_vec(), env.msg_id.trim().to_string()));
                    }
                }
                // Undecodable value: drop it (no msg_id known for the secondary index).
                Err(_) => to_delete.push((k.to_vec(), String::new())),
            }
        }
        let mut removed = 0usize;
        for (k, msg_id) in to_delete {
            if matches!(self.by_receiver.remove(&k), Ok(Some(_))) {
                removed += 1;
            }
            if !msg_id.is_empty() {
                let _ = self.by_msg_id.remove(msg_id.as_bytes());
            }
        }
        // Burn tombstones and retention markers live in the other tree and would otherwise never be
        // reaped. Drop each one once the message it stands for would have expired anyway — past
        // that point a re-gossiped copy is refused by `is_expired` instead.
        let mut stale_tombs: Vec<Vec<u8>> = Vec::new();
        for item in self.by_msg_id.iter() {
            let Ok((k, v)) = item else { continue };
            let prefix_len = if v.starts_with(BURNED_PREFIX) {
                BURNED_PREFIX.len()
            } else if v.starts_with(PRUNED_PREFIX) {
                PRUNED_PREFIX.len()
            } else {
                continue;
            };
            let expire_at = std::str::from_utf8(&v[prefix_len..])
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            if now > expire_at {
                stale_tombs.push(k.to_vec());
            }
        }
        for k in stale_tombs {
            let _ = self.by_msg_id.remove(&k);
        }
        removed
    }

    /// Locate the `by_receiver` index key for `msg_id`, if the message is live here.
    ///
    /// The index key is `receiver(64 ascii) ‖ sent_at_ms(BE u64) ‖ msg_id`, so the msg_id is the
    /// key suffix past byte 72 — matched directly, with no deserialization.
    fn index_key_for_msg_id(&self, msg_id: &str) -> Option<Vec<u8>> {
        let raw = self.by_msg_id.get(msg_id.as_bytes()).ok().flatten()?;
        if raw.starts_with(BURNED_PREFIX) {
            return None;
        }
        let receiver = String::from_utf8(raw.to_vec()).ok()?;
        if !is_wallet_id_64hex(&receiver) {
            return None;
        }
        const PREFIX_LEN: usize = 64 + 8;
        for item in self.by_receiver.scan_prefix(receiver.as_bytes()) {
            let Ok((k, _v)) = item else { continue };
            if k.len() > PREFIX_LEN && &k[PREFIX_LEN..] == msg_id.as_bytes() {
                return Some(k.to_vec());
            }
        }
        None
    }

    /// The stored envelope for `msg_id`, or `None` if this node does not hold it (never seen,
    /// expired, or burned).
    pub fn get_by_msg_id(&self, msg_id: &str) -> Option<TmailEnvelopeV1> {
        let key = self.index_key_for_msg_id(msg_id.trim())?;
        let v = self.by_receiver.get(&key).ok().flatten()?;
        serde_json::from_slice(&v).ok()
    }

    /// Has this message been burned here? True only for a tombstone, not for "never seen".
    pub fn is_burned(&self, msg_id: &str) -> bool {
        self.by_msg_id
            .get(msg_id.trim().as_bytes())
            .ok()
            .flatten()
            .is_some_and(|v| v.starts_with(BURNED_PREFIX))
    }

    /// Remove a message's ciphertext and leave a tombstone (spec §A.3.2 Layer 1).
    ///
    /// Returns `Ok(true)` if a live entry was removed, `Ok(false)` if there was nothing to remove.
    /// The `msg_id` entry is **replaced, not deleted**: dropping it would let the next gossip
    /// re-delivery of the same envelope pass `store_tmail`'s dedup check and restore the message
    /// we were just told to destroy.
    ///
    /// Callers MUST have authorized the revoke first
    /// ([`crate::tmail::burn::authorize_burn_revoke`]) — this method does no policy check.
    /// Remove a message entirely, leaving no tombstone (a later delivery may store it again).
    pub fn forget_by_msg_id(&self, msg_id: &str) -> Result<bool, TmailStoreError> {
        let msg_id = msg_id.trim();
        let Some(key) = self.index_key_for_msg_id(msg_id) else {
            return Ok(false);
        };
        let removed = self.by_receiver.remove(&key)?.is_some();
        self.by_msg_id.remove(msg_id.as_bytes())?;
        Ok(removed)
    }

    pub fn delete_by_msg_id(&self, msg_id: &str) -> Result<bool, TmailStoreError> {
        let msg_id = msg_id.trim();
        let Some(key) = self.index_key_for_msg_id(msg_id) else {
            return Ok(false);
        };
        // Compute the expiry before dropping the value, so the tombstone can be reaped on the same
        // schedule the message itself would have been.
        let expire_at = self
            .by_receiver
            .get(&key)?
            .and_then(|v| serde_json::from_slice::<TmailEnvelopeV1>(&v).ok())
            .map(|env| env.sent_at_ms.saturating_add(effective_ttl_ms(env.ttl_ms)))
            .unwrap_or_else(|| now_ms().saturating_add(effective_ttl_ms(0)));

        let removed = self.by_receiver.remove(&key)?.is_some();
        let mut tomb = BURNED_PREFIX.to_vec();
        tomb.extend_from_slice(expire_at.to_string().as_bytes());
        self.by_msg_id.insert(msg_id.as_bytes(), tomb)?;
        Ok(removed)
    }

    /// Register (or refresh) a wallet's Tmail KEM public keys. Verifies the hybrid signature first,
    /// then stores with **latest-wins** semantics (a stale `registered_at_ms` is ignored).
    pub fn register_key(&self, reg: &TmailKeyRegistrationV1) -> Result<(), TmailStoreError> {
        crate::tmail::keys::verify_tmail_key_registration_v1(reg)
            .map_err(|e| TmailStoreError::KeyVerify(format!("{e}")))?;
        let wallet = reg.wallet_id.trim().to_ascii_lowercase();
        if let Some(existing) = self.get_key(&wallet)
            && existing.registered_at_ms > reg.registered_at_ms
        {
            // Incoming registration is older than what we have: keep the newer one.
            return Ok(());
        }
        let val = serde_json::to_vec(reg).map_err(|e| TmailStoreError::Serde(e.to_string()))?;
        self.keys.insert(wallet.as_bytes(), val)?;
        Ok(())
    }

    /// Look up a wallet's registered Tmail KEM public keys, if any.
    pub fn get_key(&self, wallet_id: &str) -> Option<TmailKeyRegistrationV1> {
        let wallet = wallet_id.trim().to_ascii_lowercase();
        let v = self.keys.get(wallet.as_bytes()).ok().flatten()?;
        serde_json::from_slice(&v).ok()
    }
}

// ---------------------------------------------------------------------------
// Anonymity-set registry (spec §A.4.3).
// ---------------------------------------------------------------------------

/// What the registry stores: the signed registration plus **our** admission time.
///
/// `registered_at_ms` inside the registration is chosen by the sender and cannot be trusted for
/// epoch placement or rate limiting; `admitted_at_ms` is this node's own clock.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StoredAnonRegistration {
    pub registration: crate::tmail::anon::TmailAnonRegistrationV1,
    pub admitted_at_ms: u64,
}

/// Outcome of admitting a registration, so callers can log and respond without re-deriving it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnonRegisterOutcome {
    /// New wallet added to the set.
    Added,
    /// Existing wallet's commitment replaced.
    Updated,
    /// Byte-identical to what we already hold.
    Duplicate,
    /// An older `registered_at_ms` than the one on file; ignored.
    Stale,
    /// Registry is at its member cap and this is a new wallet.
    Full(usize),
    /// This wallet updated its commitment too recently.
    UpdateTooSoon { retry_after_ms: u64 },
}

impl TmailStore {
    fn anon_max_members() -> usize {
        env_usize("TET_TMAIL_ANON_MAX_MEMBERS", DEFAULT_ANON_MAX_MEMBERS)
    }

    fn anon_root_window_ms() -> u64 {
        env_u64("TET_TMAIL_ANON_ROOT_WINDOW_MS", DEFAULT_ANON_ROOT_WINDOW_MS)
    }

    fn anon_root_cache_cap() -> usize {
        env_usize("TET_TMAIL_ANON_ROOT_HISTORY", DEFAULT_ANON_ROOT_HISTORY)
    }

    fn anon_epoch_ms() -> u64 {
        env_u64("TET_TMAIL_ANON_EPOCH_MS", DEFAULT_ANON_EPOCH_MS)
    }

    fn anon_update_cooldown_ms() -> u64 {
        env_u64(
            "TET_TMAIL_ANON_UPDATE_COOLDOWN_MS",
            DEFAULT_ANON_UPDATE_COOLDOWN_MS,
        )
    }

    /// Epoch length, for callers that need to compute a boundary (the UI countdown).
    pub fn anon_epoch_ms_public() -> u64 {
        Self::anon_epoch_ms()
    }

    /// Epoch index for a wall-clock instant. Node-local Tmail policy, not consensus.
    pub fn anon_epoch_index(now_ms: u64) -> u64 {
        now_ms / Self::anon_epoch_ms()
    }

    pub fn anon_current_epoch(&self) -> u64 {
        Self::anon_epoch_index(now_ms())
    }

    /// Admit a (already signature-verified) registration.
    ///
    /// Callers MUST have run [`crate::tmail::anon::verify_tmail_anon_registration_v1`]. Both the
    /// local and the receive paths go through here, so neither can be weaker than the other.
    ///
    /// The registration is stored now and enters the Merkle tree at the **next epoch boundary**.
    pub fn register_anon(
        &self,
        reg: &crate::tmail::anon::TmailAnonRegistrationV1,
    ) -> Result<AnonRegisterOutcome, TmailStoreError> {
        let wallet = reg.wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&wallet) {
            return Err(TmailStoreError::InvalidReceiver);
        }
        let now = now_ms();
        let existing = self.get_stored_anon(&wallet);
        let outcome = match existing {
            Some(prev) => {
                // Same commitment is a NO-OP, whatever the claimed `registered_at_ms`.
                //
                // The cooldown exists to stop root churn, and re-announcing an unchanged
                // commitment churns nothing: the leaf is identical, so the tree and the root are
                // identical. Treating it as an update meant a client that re-sent its own
                // registration -- on reconnect, on retry, or simply on a second run -- was refused
                // with 429 for a request that would have changed nothing. Found in the live run.
                if prev
                    .registration
                    .commitment_hex
                    .eq_ignore_ascii_case(&reg.commitment_hex)
                {
                    return Ok(AnonRegisterOutcome::Duplicate);
                }
                if prev.registration.registered_at_ms > reg.registered_at_ms {
                    return Ok(AnonRegisterOutcome::Stale);
                }
                // Cooldown is measured on OUR admission clock, not the sender's claimed
                // `registered_at_ms`, which they choose freely.
                let cooldown = Self::anon_update_cooldown_ms();
                let elapsed = now.saturating_sub(prev.admitted_at_ms);
                if elapsed < cooldown {
                    return Ok(AnonRegisterOutcome::UpdateTooSoon {
                        retry_after_ms: cooldown - elapsed,
                    });
                }
                AnonRegisterOutcome::Updated
            }
            None => {
                let max = Self::anon_max_members();
                if self.anon_registry.len() >= max {
                    return Ok(AnonRegisterOutcome::Full(max));
                }
                AnonRegisterOutcome::Added
            }
        };
        let stored = StoredAnonRegistration {
            registration: reg.clone(),
            admitted_at_ms: now,
        };
        let val = serde_json::to_vec(&stored).map_err(|e| TmailStoreError::Serde(e.to_string()))?;
        self.anon_registry.insert(wallet.as_bytes(), val)?;
        Ok(outcome)
    }

    pub fn get_stored_anon(&self, wallet_id: &str) -> Option<StoredAnonRegistration> {
        let w = wallet_id.trim().to_ascii_lowercase();
        let v = self.anon_registry.get(w.as_bytes()).ok().flatten()?;
        serde_json::from_slice(&v).ok()
    }

    pub fn get_anon_registration(
        &self,
        wallet_id: &str,
    ) -> Option<crate::tmail::anon::TmailAnonRegistrationV1> {
        self.get_stored_anon(wallet_id).map(|s| s.registration)
    }

    /// Register a members-only poll (signature already verified). The node computes the root from
    /// **its own registry**: every listed wallet must be a registered member, and its registered
    /// commitment is the leaf; the creator supplies no leaves. `Ok(true)` stored, `Ok(false)` the
    /// same list was already registered; a different list for the same poll is refused.
    pub fn register_poll_root(&self, r: &crate::tmail::poll::TmailPollRootV1) -> Result<bool, String> {
        let key = r.poll_wallet_id.trim().to_ascii_lowercase();
        if r.members.is_empty() {
            if let Some(existing) = self.get_poll_root(&key) {
                if existing.root_hex.is_none() && existing.poll.bucket_index == r.bucket_index {
                    return Ok(false);
                }
                return Err("this poll already has a different member list; a poll's members can't be changed".into());
            }
            let stored = crate::tmail::poll::StoredPollRoot { poll: r.clone(), root_hex: None };
            let bytes = serde_json::to_vec(&stored).map_err(|e| e.to_string())?;
            self.poll_roots.insert(key.as_bytes(), bytes).map_err(|e| e.to_string())?;
            let _ = self.poll_roots.flush();
            return Ok(true);
        }
        let mut leaves = Vec::with_capacity(r.members.len());
        for m in &r.members {
            let Some(reg) = self.get_anon_registration(m) else {
                return Err(format!("{}… is not a registered member", &m[..8.min(m.len())]));
            };
            let bytes: [u8; 32] = hex::decode(reg.commitment_hex.trim())
                .ok()
                .and_then(|b| b.try_into().ok())
                .ok_or("a member's registered commitment is malformed")?;
            leaves.push(bytes);
        }
        let root_hex = Some(hex::encode(crate::tmail::anon::AnonMerkleTree::build(leaves).root()));
        if let Some(existing) = self.get_poll_root(&key) {
            if existing.root_hex == root_hex && existing.poll.bucket_index == r.bucket_index {
                return Ok(false);
            }
            return Err("this poll already has a different member list; a poll's members can't be changed".into());
        }
        let stored = crate::tmail::poll::StoredPollRoot { poll: r.clone(), root_hex };
        let bytes = serde_json::to_vec(&stored).map_err(|e| e.to_string())?;
        self.poll_roots.insert(key.as_bytes(), bytes).map_err(|e| e.to_string())?;
        let _ = self.poll_roots.flush();
        Ok(true)
    }

    /// A poll's wallet takes an envelope only if it's an anonymous ballot whose receipt is here and
    /// verifies now. The verdict is recorded (and the nullifier claimed) on the way.
    fn poll_ballot_gate(&self, env: &TmailEnvelopeV1) -> Result<String, String> {
        let Some(anon) = env.anonymous.as_ref().filter(|_| env.flags.anonymous) else {
            return Err("it takes only anonymous ballots".into());
        };
        // One proof, one ballot: a poll never takes a fast post (no proof of its own), or a member
        // with a registered posting key could vote again and again.
        let Some(proof) = anon.anchor_proof.as_ref() else {
            return Err("a ballot needs its own membership proof".into());
        };
        let Some(receipt) = self.get_anon_receipt(&proof.receipt_sha256_hex) else {
            return Err("a ballot's proof receipt must be deposited first".into());
        };
        match crate::tmail::anon::verify_anonymous_proof(self, env, &receipt) {
            AnonVerdict::Verified { nullifier_hex, verified_at_ms } => {
                let _ = self.set_anon_verdict(env.msg_id.trim(), &AnonVerdict::Verified { nullifier_hex: nullifier_hex.clone(), verified_at_ms });
                Ok(nullifier_hex)
            }
            AnonVerdict::Failed { reason, .. } => Err(format!("ballot refused: {reason}")),
            other => Err(format!("ballot not verified: {other:?}")),
        }
    }

    /// How many anonymous messages to keep for `receiver`: a poll keeps all its (verified, so one
    /// per member) ballots; everyone else the newest [`ANON_RETAIN_PER_RECEIVER`].
    fn anon_keep_for(&self, receiver: &str) -> usize {
        if self.get_poll_root(receiver).is_some() { usize::MAX } else { anon_retain_per_receiver() }
    }

    pub fn get_poll_root(&self, poll_wallet_id: &str) -> Option<crate::tmail::poll::StoredPollRoot> {
        let v = self.poll_roots.get(poll_wallet_id.trim().to_ascii_lowercase().as_bytes()).ok()??;
        serde_json::from_slice(&v).ok()
    }

    /// Messages and posts held now (all inboxes).
    pub fn message_count(&self) -> usize {
        self.by_receiver.len()
    }

    pub fn anon_member_count(&self) -> usize {
        self.anon_registry.len()
    }

    /// Leaves effective for `epoch`, in canonical order (**wallet id ascending**).
    ///
    /// A registration admitted during epoch `e` is included from epoch `e + 1`. Leaf order is the
    /// Merkle index, so this ordering is consensus-in-miniature: two nodes with the same
    /// registrations must produce the same root or membership proofs stop verifying across nodes.
    /// sled iterates keys lexicographically, which for lowercase-hex wallet ids is exactly that.
    pub fn anon_leaves_for_epoch(&self, epoch: u64) -> Vec<[u8; 32]> {
        let mut out = Vec::new();
        for item in self.anon_registry.iter() {
            let Ok((_k, v)) = item else { continue };
            let Ok(stored) = serde_json::from_slice::<StoredAnonRegistration>(&v) else {
                continue;
            };
            if Self::anon_epoch_index(stored.admitted_at_ms) >= epoch {
                continue;
            }
            let Ok(bytes) = hex::decode(stored.registration.commitment_hex.trim()) else {
                continue;
            };
            if let Ok(arr) = <[u8; 32]>::try_from(bytes.as_slice()) {
                out.push(arr);
            }
        }
        out
    }

    /// Index of a wallet's leaf within `epoch`'s tree, for building its authentication path.
    pub fn anon_leaf_index_for_epoch(&self, wallet_id: &str, epoch: u64) -> Option<usize> {
        let target = wallet_id.trim().to_ascii_lowercase();
        let mut i = 0usize;
        for item in self.anon_registry.iter() {
            let Ok((k, v)) = item else { continue };
            let Ok(stored) = serde_json::from_slice::<StoredAnonRegistration>(&v) else {
                continue;
            };
            if Self::anon_epoch_index(stored.admitted_at_ms) >= epoch {
                continue;
            }
            if k.as_ref() == target.as_bytes() {
                return Some(i);
            }
            i += 1;
        }
        None
    }

    pub fn anon_leaf_index(&self, wallet_id: &str) -> Option<usize> {
        self.anon_leaf_index_for_epoch(wallet_id, self.anon_current_epoch())
    }

    pub fn anon_tree_for_epoch(&self, epoch: u64) -> crate::tmail::anon::AnonMerkleTree {
        crate::tmail::anon::AnonMerkleTree::build(self.anon_leaves_for_epoch(epoch))
    }

    pub fn anon_tree(&self) -> crate::tmail::anon::AnonMerkleTree {
        self.anon_tree_for_epoch(self.anon_current_epoch())
    }

    /// Root for a given epoch, memoised.
    ///
    /// The cache is an optimisation, never an authority: a miss recomputes. That is the whole
    /// difference from the previous design, where the root history was a lossy ring buffer and an
    /// attacker could evict honest roots out of it by registering faster than the cap.
    ///
    /// # The invariant that makes the cache sound
    ///
    /// **A past epoch's leaf set is immutable.** A registration admitted now carries
    /// `admitted_at_ms = now`, so it enters the tree only from the *next* epoch onward and can
    /// never alter the leaves of an epoch already gone. A cached root therefore always equals what
    /// recomputation would produce.
    ///
    /// Drop the epoch gating and that stops being true: past epochs would inherit every later
    /// registration, the cache would disagree with recomputation, and acceptance would silently
    /// depend on whatever happened to be cached. The flood guard clears the cache before its final
    /// assertion precisely so it cannot pass that way.
    pub fn anon_root_for_epoch(&self, epoch: u64) -> [u8; 32] {
        if let Ok(cache) = self.anon_roots.lock()
            && let Some((_, root)) = cache.iter().find(|(e, _)| *e == epoch)
        {
            return *root;
        }
        let root = self.anon_tree_for_epoch(epoch).root();
        if let Ok(mut cache) = self.anon_roots.lock() {
            if !cache.iter().any(|(e, _)| *e == epoch) {
                cache.push((epoch, root));
            }
            let cap = Self::anon_root_cache_cap();
            if cache.len() > cap {
                let excess = cache.len() - cap;
                cache.drain(0..excess);
            }
        }
        root
    }

    pub fn anon_root(&self) -> [u8; 32] {
        self.anon_root_for_epoch(self.anon_current_epoch())
    }

    /// Is `root` acceptable for a proof attached to a message in `bucket_index`?
    ///
    /// Three independent conditions:
    ///
    /// 1. the message's bucket is within ±1 of now — an **outer bound the window cannot override**,
    ///    so a root from a month ago is refused however the window is configured;
    /// 2. and `root` is the root of some epoch inside [`anon_root_window_ms`];
    /// 3. the current epoch always qualifies, so a node that just restarted still works.
    ///
    /// Epoch roots are **recomputed** when not cached, so acceptance does not depend on this node
    /// having been awake, or on an attacker not having flooded the cache. Registration volume
    /// cannot evict an honest root from the accepted set, because the set is defined by time.
    pub fn accepts_anon_root(&self, root: &[u8; 32], bucket_index: u64) -> bool {
        let now = now_ms();
        let now_bucket = nexus_protocol::tmail_bucket_index_v1(now);
        if bucket_index.abs_diff(now_bucket) > 1 {
            return false;
        }
        let epoch_ms = Self::anon_epoch_ms();
        let current = Self::anon_epoch_index(now);
        let span = Self::anon_root_window_ms()
            .div_ceil(epoch_ms)
            .min(ANON_MAX_ROOT_SCAN);
        let oldest = current.saturating_sub(span);
        let mut e = current;
        loop {
            if self.anon_root_for_epoch(e) == *root {
                return true;
            }
            if e == oldest {
                return false;
            }
            e -= 1;
        }
    }

    /// A page of registrations for anti-entropy sync, ordered by wallet id.
    ///
    /// Returns `(registrations, next_cursor)`. `after` is exclusive, so a caller pages by feeding
    /// back the last wallet id it received. Ordering is the same lexicographic order the Merkle
    /// leaves use, so a full sync reconstructs the peer's set exactly.
    pub fn anon_registrations_after(
        &self,
        after: Option<&str>,
        limit: usize,
    ) -> (Vec<crate::tmail::anon::TmailAnonRegistrationV1>, Option<String>) {
        let mut out = Vec::new();
        let mut last: Option<String> = None;
        let iter: Box<dyn Iterator<Item = _>> = match after {
            Some(a) => {
                let start = a.trim().to_ascii_lowercase();
                Box::new(self.anon_registry.range(start.clone().into_bytes()..))
            }
            None => Box::new(self.anon_registry.iter()),
        };
        for item in iter {
            let Ok((k, v)) = item else { continue };
            let wallet = String::from_utf8_lossy(k.as_ref()).to_string();
            if let Some(a) = after
                && wallet == a.trim().to_ascii_lowercase()
            {
                continue; // `after` is exclusive
            }
            if out.len() >= limit {
                return (out, last);
            }
            if let Ok(stored) = serde_json::from_slice::<StoredAnonRegistration>(&v) {
                out.push(stored.registration);
                last = Some(wallet);
            }
        }
        (out, None)
    }

    /// Anonymous messages held here that have no verdict yet, as `(msg_id, envelope)`.
    ///
    /// Drives the receipt pull: when a receipt arrives, these are the messages it might belong to,
    /// and the content address decides which. Bounded by the message store's own cap.
    pub fn pending_anon_envelopes(&self) -> Vec<(String, TmailEnvelopeV1)> {
        let mut out = Vec::new();
        for item in self.by_receiver.iter() {
            let Ok((_k, v)) = item else { continue };
            let Ok(env) = serde_json::from_slice::<TmailEnvelopeV1>(&v) else {
                continue;
            };
            if !env.flags.anonymous {
                continue;
            }
            let msg_id = env.msg_id.trim().to_string();
            if matches!(
                self.get_anon_verdict(&msg_id),
                None | Some(AnonVerdict::Pending)
            ) {
                out.push((msg_id, env));
            }
        }
        out
    }

    /// Test-only: drop the memoised epoch roots, forcing recomputation.
    #[cfg(test)]
    pub fn clear_anon_root_cache_for_tests(&self) {
        if let Ok(mut c) = self.anon_roots.lock() {
            c.clear();
        }
    }

    /// Test-only: write a pre-built stored registration, bypassing signature verification.
    ///
    /// Exists so the flood guard can create volume without signing thousands of real ML-DSA
    /// registrations, which would dominate its runtime. Never compiled into a release binary.
    #[cfg(test)]
    pub fn insert_stored_anon_for_tests(
        &self,
        wallet_id: &str,
        stored: &StoredAnonRegistration,
    ) -> Result<(), TmailStoreError> {
        let val = serde_json::to_vec(stored).map_err(|e| TmailStoreError::Serde(e.to_string()))?;
        self.anon_registry
            .insert(wallet_id.trim().to_ascii_lowercase().as_bytes(), val)?;
        Ok(())
    }

    /// The window actually enforced, after the scan cap. Reported by `GET /tmail/anon/root` so a
    /// configuration whose window exceeds `ANON_MAX_ROOT_SCAN * epoch_ms` is visible, not silently
    /// short.
    pub fn anon_effective_window_ms(&self) -> u64 {
        let epoch_ms = Self::anon_epoch_ms();
        Self::anon_root_window_ms().min(ANON_MAX_ROOT_SCAN.saturating_mul(epoch_ms))
    }

    /// How many epoch roots are currently cached (diagnostics and tests).
    pub fn anon_root_cache_len(&self) -> usize {
        self.anon_roots.lock().map(|h| h.len()).unwrap_or(0)
    }

}

// ---------------------------------------------------------------------------
// Anonymous message verdicts — verify on ARRIVAL, read the stored verdict later.
// ---------------------------------------------------------------------------

/// Is an anonymous proof failure the same on every node (a bad receipt, a journal that doesn't
/// match, another program, a repeat)? Not when the only problem is that this node doesn't (yet)
/// recognise the registry root the proof was made against.
pub fn failure_is_definitive(reason: &str) -> bool {
    !reason.starts_with("registry root not recognised")
}

/// Why [`TmailStore::send_anonymous`] didn't store a post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnonSendError {
    /// The envelope says anonymous but carries no proof.
    NoProof,
    /// The proof's receipt wasn't deposited first.
    NoReceipt,
    /// The proof doesn't verify (a repeat on the same board and day included).
    Refused(String),
    /// It verified, but the poll's rules refuse this ballot (the claim was released): a 403.
    Ballot(String),
    /// It verified but couldn't be stored (the claim was released).
    Store(String),
}

impl AnonSendError {
    /// A verified post that `store_tmail` refused: a poll's rules (a 403 with the reason), or a
    /// store failure (a 500).
    pub fn from_store(e: TmailStoreError) -> Self {
        match e {
            TmailStoreError::PollBallot(_) => AnonSendError::Ballot(e.to_string()),
            other => AnonSendError::Store(other.to_string()),
        }
    }
}

/// What this node concluded about an anonymous message's proof.
///
/// Stored when the message arrives, not computed when it is read. That is what keeps the root
/// window small: the window must cover send → verify, not send → *someone opens their inbox*, which
/// could be days.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AnonVerdict {
    /// The receipt has not been pulled or checked yet. **Never render this as anonymous-verified.**
    Pending,
    /// Receipt verified against the image id, journal matched, root accepted, nullifier unused.
    Verified { nullifier_hex: String, verified_at_ms: u64 },
    /// Checked and refused. `reason` is for operators, not for trusting.
    Failed { reason: String, failed_at_ms: u64 },
}

impl TmailStore {
    fn anon_receipt_cache_cap() -> usize {
        env_usize("TET_TMAIL_ANON_RECEIPT_CACHE", DEFAULT_ANON_RECEIPT_CACHE)
    }

    /// Record a verdict. **A Failed verdict also deletes the envelope** (tombstoned, so a gossip
    /// re-delivery can't bring it back): an anonymous post whose proof doesn't verify is never kept,
    /// served or counted, whichever path delivered it. Every verdict path goes through here.
    pub fn set_anon_verdict(&self, msg_id: &str, verdict: &AnonVerdict) -> Result<(), TmailStoreError> {
        let val = serde_json::to_vec(verdict).map_err(|e| TmailStoreError::Serde(e.to_string()))?;
        self.anon_verdict.insert(msg_id.trim().as_bytes(), val)?;
        // Every failure deletes: nothing failed is kept, served or counted. A definite failure is
        // tombstoned, so a re-delivery can't bring it back. "Root not recognised" depends on this
        // node's view of the registry, so that one is deleted WITHOUT a tombstone: if the post is
        // genuine and arrives again once this node knows the root, it can still be checked and kept.
        // (Keeping it instead would let anyone post with a proof against a tree they made up.)
        // Fast posting: a post WITH a proof registers its posting key once the proof verifies here,
        // and the fast posts waiting here for it follow its verdict.
        if let Some(env) = self.get_by_msg_id(msg_id)
            && let Some(anon) = env.anonymous.as_ref()
            && anon.anchor_proof.is_some()
        {
            let k = fast_key(&env.receiver_wallet_id, nexus_protocol::tmail_bucket_index_v1(env.sent_at_ms), &anon.ephemeral_wallet_id);
            match verdict {
                AnonVerdict::Pending => {
                    let _ = self.fast_regpending.insert(k.as_bytes(), msg_id.trim().as_bytes());
                }
                AnonVerdict::Verified { nullifier_hex, .. } => {
                    let _ = self.fast_regpending.remove(k.as_bytes());
                    self.register_fast_key(&env, &k, nullifier_hex);
                }
                AnonVerdict::Failed { reason, .. } => {
                    let _ = self.fast_regpending.remove(k.as_bytes());
                    self.drop_fast_pending(&k, failure_is_definitive(reason));
                }
            }
        }
        if let AnonVerdict::Failed { reason, .. } = verdict {
            if failure_is_definitive(reason) {
                self.delete_by_msg_id(msg_id)?;
            } else {
                self.forget_by_msg_id(msg_id)?;
            }
        }
        Ok(())
    }

    // ── Fast anonymous posting (docs/plans/FAST_ANON_POSTING.md) ─────────────────────────────

    /// The group an inbox entry belongs to (see [`conversation_key_with`]).
    fn conversation_key(&self, env: &TmailEnvelopeV1) -> String {
        conversation_key_with(env, || {
            let anon = env.anonymous.as_ref()?;
            if anon.anchor_proof.is_some() {
                // A post with a proof: the nullifier its proof gave it, once verified here.
                return match self.get_anon_verdict(env.msg_id.trim()) {
                    Some(AnonVerdict::Verified { nullifier_hex, .. }) => Some(nullifier_hex),
                    _ => None,
                };
            }
            // A fast post: its key's registration (made by a verified proof), or none yet.
            let bucket = nexus_protocol::tmail_bucket_index_v1(env.sent_at_ms);
            self.fast_registration(&env.receiver_wallet_id, bucket, &anon.ephemeral_wallet_id).map(|r| r.nullifier_hex)
        })
    }

    /// A post whose proof verified here registers its posting key for its board and day, and the
    /// fast posts waiting for it are verified with its nullifier. Never for polls (one proof, one
    /// ballot). The first registration of a key stands.
    fn register_fast_key(&self, env: &TmailEnvelopeV1, k: &str, nullifier_hex: &str) {
        if self.get_poll_root(&env.receiver_wallet_id.trim().to_ascii_lowercase()).is_some() {
            return;
        }
        let now = now_ms();
        if self.fast_keys.get(k.as_bytes()).ok().flatten().is_none() {
            let reg = FastKey { nullifier_hex: nullifier_hex.to_string(), registered_at_ms: now, by_msg_id: env.msg_id.trim().to_string() };
            if let Ok(v) = serde_json::to_vec(&reg) {
                let _ = self.fast_keys.insert(k.as_bytes(), v);
            }
        }
        let prefix = format!("{k}|");
        let waiting: Vec<(Vec<u8>, String)> = self
            .fast_pending
            .scan_prefix(prefix.as_bytes())
            .filter_map(|r| r.ok())
            .map(|(key, _)| {
                let id = String::from_utf8_lossy(&key[prefix.len()..]).to_string();
                (key.to_vec(), id)
            })
            .collect();
        for (key, id) in waiting {
            let _ = self.fast_pending.remove(key);
            if self.get_by_msg_id(&id).is_some() {
                let _ = self.anon_verdict.insert(
                    id.as_bytes(),
                    serde_json::to_vec(&AnonVerdict::Verified { nullifier_hex: nullifier_hex.to_string(), verified_at_ms: now }).unwrap_or_default(),
                );
            }
        }
        self.prune_fast(now);
    }

    /// The registering post failed: its waiting fast posts go too (tombstoned if the failure is
    /// definitive, forgotten if it only depends on this node's view, like their registration).
    fn drop_fast_pending(&self, k: &str, definitive: bool) {
        let prefix = format!("{k}|");
        let waiting: Vec<(Vec<u8>, String)> = self
            .fast_pending
            .scan_prefix(prefix.as_bytes())
            .filter_map(|r| r.ok())
            .map(|(key, _)| (key.to_vec(), String::from_utf8_lossy(&key[prefix.len()..]).to_string()))
            .collect();
        for (key, id) in waiting {
            let _ = self.fast_pending.remove(key);
            let _ = if definitive { self.delete_by_msg_id(&id) } else { self.forget_by_msg_id(&id) };
        }
    }

    /// Registrations older than yesterday, and pending fast posts older than
    /// [`FAST_PENDING_TTL_MS`] (with their messages), are dropped.
    fn prune_fast(&self, now: u64) {
        let today = nexus_protocol::tmail_bucket_index_v1(now);
        for item in self.fast_keys.iter() {
            let Ok((k, _)) = item else { continue };
            let key = String::from_utf8_lossy(&k).to_string();
            if let Some(b) = key.split('|').nth(1).and_then(|b| b.parse::<u64>().ok())
                && b + 1 < today
            {
                let _ = self.fast_keys.remove(&k);
            }
        }
        for item in self.fast_pending.iter() {
            let Ok((k, v)) = item else { continue };
            let at = v.as_ref().try_into().map(u64::from_be_bytes).unwrap_or(0);
            if now.saturating_sub(at) > env_usize("TET_TMAIL_FAST_PENDING_TTL_MS", FAST_PENDING_TTL_MS as usize) as u64 {
                let _ = self.fast_pending.remove(&k);
                // `receiver|bucket|posting key|msg_id`: the first three never contain '|' (hex and a
                // number); the msg_id is everything after them, whatever it contains, so a '|' in a
                // msg_id can't point this at another message.
                let key = String::from_utf8_lossy(&k).to_string();
                if let Some(id) = key.splitn(4, '|').nth(3) {
                    let _ = self.forget_by_msg_id(id);
                }
            }
        }
    }

    /// The registration of a posting key for a board on a UTC day, if any.
    pub fn fast_registration(&self, receiver: &str, bucket: u64, posting_key: &str) -> Option<FastKey> {
        let v = self.fast_keys.get(fast_key(receiver, bucket, posting_key).as_bytes()).ok().flatten()?;
        serde_json::from_slice(&v).ok()
    }

    /// The invisible flood guard: a burst of [`FAST_BURST`], then one post per
    /// [`FAST_REFILL_MS`], at most [`FAST_DAILY_CAP`] a UTC day, per posting key.
    fn fast_flood_take(&self, k: &str, now: u64, interval: bool) -> Result<(), FastSendError> {
        // Env overrides exist for tests and operators, like the other store limits.
        let burst = env_usize("TET_TMAIL_FAST_BURST", FAST_BURST as usize) as f64;
        let refill_ms = env_usize("TET_TMAIL_FAST_REFILL_MS", FAST_REFILL_MS as usize) as f64;
        let cap = env_usize("TET_TMAIL_FAST_DAILY_CAP", FAST_DAILY_CAP as usize) as u32;
        self.flood_take(k, now, interval, burst, refill_ms, cap)
    }

    /// A token bucket per key (`burst`, one more every `refill_ms`) and a daily cap; in memory.
    fn flood_take(&self, k: &str, now: u64, interval: bool, burst: f64, refill_ms: f64, cap: u32) -> Result<(), FastSendError> {
        let today = nexus_protocol::tmail_bucket_index_v1(now);
        let mut map = self.fast_flood.lock().unwrap_or_else(|p| p.into_inner());
        let e = map.entry(k.to_string()).or_insert((burst, now, today, 0));
        if e.2 != today {
            *e = (burst, now, today, 0);
        }
        if e.3 >= cap {
            return Err(FastSendError::DailyCap);
        }
        if interval {
            let refill = now.saturating_sub(e.1) as f64 / refill_ms;
            e.0 = (e.0 + refill).min(burst);
            e.1 = now;
            if e.0 < 1.0 {
                return Err(FastSendError::Busy);
            }
            e.0 -= 1.0;
        }
        e.3 += 1;
        Ok(())
    }

    fn fast_checks(&self, env: &TmailEnvelopeV1, now: u64) -> Result<(String, u64, String), FastSendError> {
        if !env.flags.anonymous || !is_fast_post(env) {
            return Err(FastSendError::NotFast);
        }
        let receiver = env.receiver_wallet_id.trim().to_ascii_lowercase();
        if self.get_poll_root(&receiver).is_some() {
            return Err(FastSendError::Poll);
        }
        let bucket = nexus_protocol::tmail_bucket_index_v1(env.sent_at_ms);
        if bucket != nexus_protocol::tmail_bucket_index_v1(now) {
            return Err(FastSendError::WrongDay);
        }
        let posting_key = env.anonymous.as_ref().map(|a| a.ephemeral_wallet_id.trim().to_ascii_lowercase()).unwrap_or_default();
        Ok((receiver, bucket, posting_key))
    }

    /// A fast post from a client (REST): stored, verified, only if its posting key is registered for
    /// this board today and the flood guard allows it. Nothing refused is stored. Blocking.
    pub fn send_fast_anonymous(&self, env: &TmailEnvelopeV1) -> Result<bool, FastSendError> {
        let _g = self.anon_send_lock.lock().unwrap_or_else(|p| p.into_inner());
        let now = now_ms();
        let (receiver, bucket, posting_key) = self.fast_checks(env, now)?;
        let reg = self.fast_registration(&receiver, bucket, &posting_key).ok_or(FastSendError::NotRegistered)?;
        if self.by_msg_id.contains_key(env.msg_id.trim().as_bytes()).unwrap_or(false) {
            return Ok(false);
        }
        self.fast_flood_take(&fast_key(&receiver, bucket, &posting_key), now, true)?;
        let stored = self.store_tmail_inner(env, true).map_err(|e| FastSendError::Store(e.to_string()))?;
        if stored {
            let v = AnonVerdict::Verified { nullifier_hex: reg.nullifier_hex, verified_at_ms: now };
            let _ = self.anon_verdict.insert(env.msg_id.trim().as_bytes(), serde_json::to_vec(&v).unwrap_or_default());
        }
        Ok(stored)
    }

    /// A fast post from a peer (gossip). Registered key: stored, verified (daily cap; the interval was
    /// the sending node's to keep). Not registered here yet: held as pending ONLY while a registering
    /// post for that exact key is stored here awaiting its proof, within [`FAST_PENDING_PER_KEY`] and
    /// [`FAST_PENDING_TOTAL`]; otherwise dropped. Nothing unverified is served as verified.
    pub fn receive_fast_anonymous(&self, env: &TmailEnvelopeV1) -> Result<bool, FastSendError> {
        let _g = self.anon_send_lock.lock().unwrap_or_else(|p| p.into_inner());
        let now = now_ms();
        let (receiver, bucket, posting_key) = self.fast_checks(env, now)?;
        let k = fast_key(&receiver, bucket, &posting_key);
        if self.by_msg_id.contains_key(env.msg_id.trim().as_bytes()).unwrap_or(false) {
            return Ok(false);
        }
        if let Some(reg) = self.fast_registration(&receiver, bucket, &posting_key) {
            self.fast_flood_take(&k, now, false)?;
            let stored = self.store_tmail_inner(env, true).map_err(|e| FastSendError::Store(e.to_string()))?;
            if stored {
                let v = AnonVerdict::Verified { nullifier_hex: reg.nullifier_hex, verified_at_ms: now };
                let _ = self.anon_verdict.insert(env.msg_id.trim().as_bytes(), serde_json::to_vec(&v).unwrap_or_default());
            }
            return Ok(stored);
        }
        // Not registered here (yet). Hold it only if its registering post is here, waiting.
        self.prune_fast(now);
        if self.fast_regpending.get(k.as_bytes()).ok().flatten().is_none() {
            return Err(FastSendError::NotRegistered);
        }
        let prefix = format!("{k}|");
        if self.fast_pending.scan_prefix(prefix.as_bytes()).count() >= FAST_PENDING_PER_KEY || self.fast_pending.len() >= FAST_PENDING_TOTAL {
            return Err(FastSendError::Busy);
        }
        self.fast_flood_take(&k, now, false)?;
        let stored = self.store_tmail_inner(env, true).map_err(|e| FastSendError::Store(e.to_string()))?;
        if stored {
            let _ = self.anon_verdict.insert(env.msg_id.trim().as_bytes(), serde_json::to_vec(&AnonVerdict::Pending).unwrap_or_default());
            let _ = self.fast_pending.insert(format!("{k}|{}", env.msg_id.trim()).as_bytes(), &now.to_be_bytes());
        }
        Ok(stored)
    }

    pub fn get_anon_verdict(&self, msg_id: &str) -> Option<AnonVerdict> {
        let v = self.anon_verdict.get(msg_id.trim().as_bytes()).ok().flatten()?;
        serde_json::from_slice(&v).ok()
    }

    /// Claim a nullifier for a message. `Ok(false)` means it was already used by a *different*
    /// message — the replay rule.
    ///
    /// Re-claiming for the same `msg_id` is idempotent, so a duplicate delivery of one message does
    /// not look like a replay.
    /// Check, store and (on a failed store) release, as one unit under `anon_send_lock`: an
    /// anonymous post from a client is kept only if its proof verifies now (its receipt was
    /// deposited first). Blocking: call it on a blocking thread. `Ok(true)` stored, `Ok(false)` the
    /// same message was already stored.
    pub fn send_anonymous(&self, env: &TmailEnvelopeV1) -> Result<bool, AnonSendError> {
        let _g = self.anon_send_lock.lock().unwrap_or_else(|p| p.into_inner());
        let proof = env.anonymous.as_ref().and_then(|a| a.anchor_proof.as_ref()).ok_or(AnonSendError::NoProof)?;
        let bytes = self.get_anon_receipt(&proof.receipt_sha256_hex).ok_or(AnonSendError::NoReceipt)?;
        let nullifier_hex = match crate::tmail::anon::verify_anonymous_proof(self, env, &bytes) {
            AnonVerdict::Verified { nullifier_hex, verified_at_ms } => {
                let v = AnonVerdict::Verified { nullifier_hex: nullifier_hex.clone(), verified_at_ms };
                match self.store_tmail(env) {
                    Ok(stored) => {
                        let _ = self.set_anon_verdict(env.msg_id.trim(), &v);
                        return Ok(stored);
                    }
                    Err(e) => {
                        // Not stored: give the nullifier back (only this message's claim), or the
                        // member's post for the day is used up with nothing posted.
                        if self.get_by_msg_id(env.msg_id.trim()).is_none() {
                            self.release_anon_nullifier(&nullifier_hex, env.msg_id.trim());
                        }
                        return Err(AnonSendError::from_store(e));
                    }
                }
            }
            AnonVerdict::Failed { reason, .. } => reason,
            AnonVerdict::Pending => "couldn't be checked yet".to_string(),
        };
        Err(AnonSendError::Refused(nullifier_hex))
    }

    /// Undo [`Self::claim_anon_nullifier`] for a message that wasn't stored after all. Only the
    /// claim by this `msg_id` is removed; anyone else's stands.
    pub fn release_anon_nullifier(&self, nullifier_hex: &str, msg_id: &str) {
        let key = nullifier_hex.trim().to_ascii_lowercase();
        let _ = self.anon_nullifiers.compare_and_swap(key.as_bytes(), Some(msg_id.trim().as_bytes()), None as Option<&[u8]>);
    }

    pub fn claim_anon_nullifier(
        &self,
        nullifier_hex: &str,
        msg_id: &str,
    ) -> Result<bool, TmailStoreError> {
        let key = nullifier_hex.trim().to_ascii_lowercase();
        match self.anon_nullifiers.get(key.as_bytes())? {
            Some(existing) if existing.as_ref() != msg_id.trim().as_bytes() => Ok(false),
            Some(_) => Ok(true),
            None => {
                self.anon_nullifiers
                    .insert(key.as_bytes(), msg_id.trim().as_bytes())?;
                Ok(true)
            }
        }
    }

    /// Store a receipt under its own SHA-256.
    ///
    /// Content-addressed on purpose: **any** node may cache and serve a receipt it has verified,
    /// and a bad cache entry cannot forge anything because the key is the hash of the value. The
    /// caller supplies the expected hash and this refuses a mismatch rather than trusting the peer.
    pub fn put_anon_receipt(
        &self,
        expected_sha256_hex: &str,
        bytes: &[u8],
    ) -> Result<bool, TmailStoreError> {
        use sha2::{Digest as _, Sha256};
        let actual = hex::encode(Sha256::digest(bytes));
        if !actual.eq_ignore_ascii_case(expected_sha256_hex.trim()) {
            return Ok(false);
        }
        if self.anon_receipts.len() >= Self::anon_receipt_cache_cap() {
            // Receipts are large; drop the oldest key rather than grow without bound. Losing a
            // cached receipt costs a re-pull, never correctness -- the hash is the authority.
            if let Ok(Some((k, _))) = self.anon_receipts.first() {
                let _ = self.anon_receipts.remove(k);
            }
        }
        self.anon_receipts.insert(actual.as_bytes(), bytes)?;
        Ok(true)
    }

    pub fn get_anon_receipt(&self, sha256_hex: &str) -> Option<Vec<u8>> {
        let k = sha256_hex.trim().to_ascii_lowercase();
        self.anon_receipts.get(k.as_bytes()).ok().flatten().map(|v| v.to_vec())
    }

    pub fn anon_receipt_count(&self) -> usize {
        self.anon_receipts.len()
    }
}

// ── Shelter (tmail/shelter.rs; docs/plans/SHELTER.md) ──────────────────────────────────────────

/// Shelter's anonymous-set roots that still count, and the leaves of the newest.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct ShelterRoots {
    /// The newest set's leaves (registry commitments, hex), to tell whether the next set only adds.
    leaves: Vec<String>,
    /// Roots that count, with when each was first seen. Cleared whenever a leaf goes away.
    roots: Vec<(String, u64)>,
}

impl TmailStore {
    pub fn shelter_records(&self) -> Vec<crate::tmail::shelter::ShelterRecordV1> {
        self.shelter_records
            .iter()
            .filter_map(|r| r.ok())
            .filter_map(|(_, v)| serde_json::from_slice(&v).ok())
            .collect()
    }

    pub fn shelter_state(&self, cfg: &crate::tmail::shelter::ShelterConfig) -> crate::tmail::shelter::ShelterState {
        crate::tmail::shelter::replay(cfg, &self.shelter_records())
    }

    /// Check a record (shape, signature, clock, and the rules against the current state) and
    /// append it. Nothing refused is stored.
    pub fn submit_shelter_record(&self, r: &crate::tmail::shelter::ShelterRecordV1, now: u64) -> Result<String, crate::tmail::shelter::ShelterError> {
        use crate::tmail::shelter::{self as sh, ShelterError};
        let cfg = sh::config_from_env().ok_or(ShelterError::Off)?;
        sh::verify_record(r)?;
        if r.at_ms.abs_diff(now) > sh::SHELTER_RECORD_SKEW_MS {
            return Err(ShelterError::Clock);
        }
        let _g = self.shelter_lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut state = self.shelter_state(&cfg);
        state.apply(&cfg, r)?;
        let seq = self.shelter_records.len() as u64;
        let bytes = serde_json::to_vec(r).map_err(|_| ShelterError::Malformed("record"))?;
        self.shelter_records.insert(seq.to_be_bytes(), bytes).map_err(|_| ShelterError::Refused("couldn't store the record"))?;
        let _ = self.shelter_records.flush();
        tracing::info!(target: "shelter", "{}", sh::log_line(r));
        drop(_g);
        self.shelter_refresh_roots(&cfg, now);
        Ok(sh::record_id(r))
    }

    /// Shelter's anonymous set now: the current, unsuspended members who joined the anonymity
    /// registry, ordered by wallet, with their registered commitments.
    pub fn shelter_anon_set(&self, cfg: &crate::tmail::shelter::ShelterConfig, now: u64) -> Vec<(String, [u8; 32])> {
        self.shelter_state(cfg)
            .anon_eligible(now)
            .into_iter()
            .filter_map(|w| {
                let reg = self.get_anon_registration(&w)?;
                let c: [u8; 32] = hex::decode(reg.commitment_hex.trim()).ok()?.try_into().ok()?;
                Some((w, c))
            })
            .collect()
    }

    /// Bring the roots that count up to date. A set that only **adds** members keeps the earlier
    /// roots (everyone in them is still in); a set that loses anyone (left, removed, suspended)
    /// clears them, and drops today's fast-posting keys for the board, so a removed member's proof
    /// or posting key stops working at once. Fewer than [`crate::tmail::shelter::SHELTER_ANON_MIN`]
    /// members: no root counts.
    pub fn shelter_refresh_roots(&self, cfg: &crate::tmail::shelter::ShelterConfig, now: u64) {
        let set = self.shelter_anon_set(cfg, now);
        let leaves: Vec<String> = set.iter().map(|(_, c)| hex::encode(c)).collect();
        let mut st: ShelterRoots = self
            .shelter_roots
            .get(b"state")
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        let lost = st.leaves.iter().any(|l| !leaves.contains(l));
        if lost {
            st.roots.clear();
            let prefix = format!("{}|", cfg.board);
            let keys: Vec<_> = self.fast_keys.scan_prefix(prefix.as_bytes()).filter_map(|r| r.ok()).map(|(k, _)| k).collect();
            for k in keys {
                let _ = self.fast_keys.remove(k);
            }
        }
        if set.len() >= crate::tmail::shelter::SHELTER_ANON_MIN {
            let root = hex::encode(crate::tmail::anon::AnonMerkleTree::build(set.iter().map(|(_, c)| *c).collect()).root());
            if !st.roots.iter().any(|(r, _)| *r == root) {
                st.roots.push((root, now));
            }
            let excess = st.roots.len().saturating_sub(64);
            st.roots.drain(..excess);
        } else {
            st.roots.clear();
        }
        st.leaves = leaves;
        if let Ok(v) = serde_json::to_vec(&st) {
            let _ = self.shelter_roots.insert(b"state", v);
        }
    }

    /// Does a proof against `root` count for Shelter's board now? Only Shelter's own roots, never
    /// the node's open anonymity set.
    pub fn shelter_accepts_root(&self, root: &[u8; 32], bucket: u64, now_bucket: u64) -> bool {
        let Some(cfg) = crate::tmail::shelter::config_from_env() else { return false };
        if bucket.abs_diff(now_bucket) > 1 {
            return false;
        }
        self.shelter_refresh_roots(&cfg, now_ms());
        let want = hex::encode(root);
        self.shelter_roots
            .get(b"state")
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_slice::<ShelterRoots>(&v).ok())
            .is_some_and(|st| st.roots.iter().any(|(r, _)| *r == want))
    }

    /// Keep a member's sealed board key: a named envelope (signature already verified) to a current
    /// member, from the member who let them in, the moderator, or the member themselves (the only
    /// ones who should hand them the key). Replaces the previous one. Never served but to that
    /// member's own signed read.
    pub fn set_shelter_key(&self, env: &TmailEnvelopeV1) -> Result<(), &'static str> {
        let cfg = crate::tmail::shelter::config_from_env().ok_or("Shelter is not open on this node")?;
        if env.flags.anonymous || env.anonymous.is_some() {
            return Err("a sealed key is a named envelope");
        }
        let to = env.receiver_wallet_id.trim().to_ascii_lowercase();
        let from = env.sender_wallet_id.trim().to_ascii_lowercase();
        let st = self.shelter_state(&cfg);
        let Some(m) = st.members.get(&to) else { return Err("not a member") };
        if !(from == cfg.moderator || from == to || m.via.as_deref() == Some(from.as_str())) {
            return Err("only the member who let them in, the moderator, or the member can hand them the key");
        }
        let v = serde_json::to_vec(env).map_err(|_| "malformed")?;
        if v.len() > 16 * 1024 {
            return Err("too large for a board key");
        }
        self.shelter_keys.insert(to.as_bytes(), v).map_err(|_| "couldn't store it")?;
        Ok(())
    }

    pub fn shelter_key_for(&self, member: &str) -> Option<TmailEnvelopeV1> {
        let v = self.shelter_keys.get(member.trim().to_ascii_lowercase().as_bytes()).ok()??;
        serde_json::from_slice(&v).ok()
    }

    /// The invisible flood guard for a member's named posts in Shelter: a burst of
    /// [`SHELTER_BURST`], then one per [`SHELTER_REFILL_MS`], up to [`SHELTER_DAILY_CAP`] a day.
    pub fn shelter_flood_take(&self, wallet: &str, now: u64) -> Result<(), FastSendError> {
        let burst = env_usize("TET_SHELTER_BURST", SHELTER_BURST as usize) as f64;
        let refill = env_usize("TET_SHELTER_REFILL_MS", SHELTER_REFILL_MS as usize) as f64;
        let cap = env_usize("TET_SHELTER_DAILY_CAP", SHELTER_DAILY_CAP as usize) as u32;
        self.flood_take(&format!("shelter|{}", wallet.trim().to_ascii_lowercase()), now, true, burst, refill, cap)
    }
}
