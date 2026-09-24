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
//! `receiver` the grouping key is `sender_wallet_id`.

use crate::tmail::envelope::TmailEnvelopeV1;
use crate::tmail::keys::TmailKeyRegistrationV1;

const TREE_BY_RECEIVER: &str = "tmail_by_receiver_v1";
const TREE_BY_MSG_ID: &str = "tmail_by_msg_id_v1";
const TREE_KEYS: &str = "tmail_keys_v1";
/// Anonymity-set registrations: key `wallet_id`, value = `TmailAnonRegistrationV1` JSON.
const TREE_ANON_REGISTRY: &str = "tmail_anon_registry_v1";

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

/// Cap on remembered roots. One entry per root *change*, not per registration.
const DEFAULT_ANON_ROOT_HISTORY: usize = 512;

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
}

pub struct TmailStore {
    by_receiver: sled::Tree,
    by_msg_id: sled::Tree,
    keys: sled::Tree,
    anon_registry: sled::Tree,
    /// `(root, first_seen_ms)`, newest last. In memory: a restart drops it, after which only the
    /// current root is accepted until the registry changes again. That is a liveness cost measured
    /// in one proof, not a correctness problem.
    anon_roots: std::sync::Mutex<Vec<([u8; 32], u64)>>,
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

/// Conversation key for an inbox entry (Appendix K.3, Phase 0 flat threads): the counterparty.
fn conversation_key(env: &TmailEnvelopeV1) -> String {
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
            anon_roots: std::sync::Mutex::new(Vec::new()),
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
        self.by_receiver.insert(key, val)?;
        self.by_msg_id
            .insert(msg_id.as_bytes(), receiver.as_bytes())?;
        // Retention is applied at write time so the store never holds more than the rule allows,
        // even if nothing ever calls `GET /tmail/inbox`. Enforcing it only on read would make the
        // cap a display convention again -- exactly what S7-0 exists to stop being true.
        self.enforce_retention(&receiver, &conversation_key(env))?;
        Ok(true)
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
        let keep = retain_per_conversation();

        // (sent_at_ms, key, msg_id, expire_at) for this conversation, newest first.
        let mut rows: Vec<(u64, Vec<u8>, String, u64)> = Vec::new();
        for item in self.by_receiver.scan_prefix(receiver.as_bytes()) {
            let Ok((k, v)) = item else { continue };
            let Ok(env) = serde_json::from_slice::<TmailEnvelopeV1>(&v) else {
                continue;
            };
            if conversation_key(&env) != counterparty {
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
    /// [`retain_per_conversation`] **per conversation** (spec Appendix K.1).
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
            let counterparty = conversation_key(&env);
            let slot = per_conversation.entry(counterparty.clone()).or_insert(0);
            if *slot >= keep && !self.is_pinned(&receiver, &counterparty) {
                continue;
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
}

impl TmailStore {
    fn anon_max_members() -> usize {
        env_usize("TET_TMAIL_ANON_MAX_MEMBERS", DEFAULT_ANON_MAX_MEMBERS)
    }

    fn anon_root_window_ms() -> u64 {
        env_u64("TET_TMAIL_ANON_ROOT_WINDOW_MS", DEFAULT_ANON_ROOT_WINDOW_MS)
    }

    fn anon_root_history() -> usize {
        env_usize("TET_TMAIL_ANON_ROOT_HISTORY", DEFAULT_ANON_ROOT_HISTORY)
    }

    /// Admit a (already signature-verified) registration.
    ///
    /// Callers MUST have run [`crate::tmail::anon::verify_tmail_anon_registration_v1`]. Both the
    /// local and the gossip path go through here, so neither can be weaker than the other.
    pub fn register_anon(
        &self,
        reg: &crate::tmail::anon::TmailAnonRegistrationV1,
    ) -> Result<AnonRegisterOutcome, TmailStoreError> {
        let wallet = reg.wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&wallet) {
            return Err(TmailStoreError::InvalidReceiver);
        }
        let existing = self.get_anon_registration(&wallet);
        let outcome = match existing {
            Some(prev) => {
                if prev.commitment_hex.eq_ignore_ascii_case(&reg.commitment_hex)
                    && prev.registered_at_ms == reg.registered_at_ms
                {
                    return Ok(AnonRegisterOutcome::Duplicate);
                }
                if prev.registered_at_ms > reg.registered_at_ms {
                    return Ok(AnonRegisterOutcome::Stale);
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
        let val = serde_json::to_vec(reg).map_err(|e| TmailStoreError::Serde(e.to_string()))?;
        self.anon_registry.insert(wallet.as_bytes(), val)?;
        self.note_anon_root();
        Ok(outcome)
    }

    pub fn get_anon_registration(
        &self,
        wallet_id: &str,
    ) -> Option<crate::tmail::anon::TmailAnonRegistrationV1> {
        let w = wallet_id.trim().to_ascii_lowercase();
        let v = self.anon_registry.get(w.as_bytes()).ok().flatten()?;
        serde_json::from_slice(&v).ok()
    }

    pub fn anon_member_count(&self) -> usize {
        self.anon_registry.len()
    }

    /// Leaves in canonical order: **sorted by wallet id ascending**.
    ///
    /// Leaf order is the Merkle index, so this ordering is consensus-in-miniature: two nodes with
    /// identical registrations must produce identical roots or membership proofs stop verifying
    /// across nodes. sled iterates keys in lexicographic order, which for lowercase-hex wallet ids
    /// is exactly that.
    pub fn anon_leaves(&self) -> Vec<[u8; 32]> {
        let mut out = Vec::new();
        for item in self.anon_registry.iter() {
            let Ok((_k, v)) = item else { continue };
            let Ok(reg) =
                serde_json::from_slice::<crate::tmail::anon::TmailAnonRegistrationV1>(&v)
            else {
                continue;
            };
            let Ok(bytes) = hex::decode(reg.commitment_hex.trim()) else {
                continue;
            };
            if let Ok(arr) = <[u8; 32]>::try_from(bytes.as_slice()) {
                out.push(arr);
            }
        }
        out
    }

    /// Index of a wallet's leaf in canonical order, for building its authentication path.
    pub fn anon_leaf_index(&self, wallet_id: &str) -> Option<usize> {
        let target = wallet_id.trim().to_ascii_lowercase();
        let mut i = 0usize;
        for item in self.anon_registry.iter() {
            let Ok((k, _v)) = item else { continue };
            if k.as_ref() == target.as_bytes() {
                return Some(i);
            }
            i += 1;
        }
        None
    }

    pub fn anon_tree(&self) -> crate::tmail::anon::AnonMerkleTree {
        crate::tmail::anon::AnonMerkleTree::build(self.anon_leaves())
    }

    pub fn anon_root(&self) -> [u8; 32] {
        self.anon_tree().root()
    }

    /// Record the current root with the time it was first seen. Called on every registry change.
    fn note_anon_root(&self) {
        let root = self.anon_root();
        let now = now_ms();
        let Ok(mut hist) = self.anon_roots.lock() else {
            return;
        };
        if hist.last().map(|(r, _)| *r == root).unwrap_or(false) {
            return;
        }
        hist.push((root, now));
        let cap = Self::anon_root_history();
        if hist.len() > cap {
            let excess = hist.len() - cap;
            hist.drain(0..excess);
        }
        let window = Self::anon_root_window_ms();
        hist.retain(|(_, t)| now.saturating_sub(*t) <= window);
    }

    /// Is `root` acceptable for a proof attached to a message in `bucket_index`?
    ///
    /// Three conditions, deliberately independent:
    ///
    /// 1. it is this node's **current** root — always accepted, so a node that just restarted and
    ///    lost its history still works;
    /// 2. or it is a root this node computed within [`anon_root_window_ms`] — covers the window
    ///    between a sender building a proof and the receiving node verifying it;
    /// 3. **and** the message's bucket is within ±1 of now. This is an outer bound that the window
    ///    cannot override: a root from a month ago is refused even if somebody sets the window to a
    ///    month, because the bucket already pins the message to a day.
    pub fn accepts_anon_root(&self, root: &[u8; 32], bucket_index: u64) -> bool {
        let now = now_ms();
        let now_bucket = nexus_protocol::tmail_bucket_index_v1(now);
        if bucket_index.abs_diff(now_bucket) > 1 {
            return false;
        }
        if self.anon_root() == *root {
            return true;
        }
        let window = Self::anon_root_window_ms();
        let Ok(hist) = self.anon_roots.lock() else {
            return false;
        };
        hist.iter()
            .any(|(r, t)| r == root && now.saturating_sub(*t) <= window)
    }

    /// How many roots are currently remembered (for diagnostics and tests).
    pub fn anon_root_history_len(&self) -> usize {
        self.anon_roots.lock().map(|h| h.len()).unwrap_or(0)
    }
}
