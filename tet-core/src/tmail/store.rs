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

use crate::tmail::envelope::TmailEnvelopeV1;
use crate::tmail::keys::TmailKeyRegistrationV1;

const TREE_BY_RECEIVER: &str = "tmail_by_receiver_v1";
const TREE_BY_MSG_ID: &str = "tmail_by_msg_id_v1";
const TREE_KEYS: &str = "tmail_keys_v1";

/// Tombstone marker written into `tmail_by_msg_id_v1` when a message is burned. The suffix is the
/// original entry's expiry in ms, so `prune_expired` can reap tombstones instead of growing a tree
/// that never shrinks.
const BURNED_PREFIX: &[u8] = b"burned:";

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
        Ok(true)
    }

    /// Return up to `limit` non-expired envelopes addressed to `wallet_id`, newest first.
    pub fn get_inbox(&self, wallet_id: &str, limit: usize) -> Vec<TmailEnvelopeV1> {
        let receiver = wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&receiver) {
            return Vec::new();
        }
        let now = now_ms();
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
        // Burn tombstones live in the other tree and would otherwise never be reaped. Drop each
        // one once the message it stands for would have expired anyway — past that point a
        // re-gossiped copy is refused by `is_expired` instead.
        let mut stale_tombs: Vec<Vec<u8>> = Vec::new();
        for item in self.by_msg_id.iter() {
            let Ok((k, v)) = item else { continue };
            if !v.starts_with(BURNED_PREFIX) {
                continue;
            }
            let expire_at = std::str::from_utf8(&v[BURNED_PREFIX.len()..])
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
