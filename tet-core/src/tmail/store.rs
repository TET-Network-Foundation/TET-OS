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
//! - `tmail_by_msg_id_v1` — key `msg_id`, value = receiver wallet id (idempotency / dedup).
//! - `tmail_keys_v1` — key `wallet_id`, value = [`crate::tmail::keys::TmailKeyRegistrationV1`] JSON.

use crate::tmail::envelope::TmailEnvelopeV1;
use crate::tmail::keys::TmailKeyRegistrationV1;

const TREE_BY_RECEIVER: &str = "tmail_by_receiver_v1";
const TREE_BY_MSG_ID: &str = "tmail_by_msg_id_v1";
const TREE_KEYS: &str = "tmail_keys_v1";

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
        removed
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
