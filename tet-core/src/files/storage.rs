//! File Sharing node-local store — sled blob buffer + meta + inbox index (spec §4).
//!
//! Off-ledger, like Tmail's [`crate::tmail::store::TmailStore`]. Trees are opened on the **ledger's**
//! sled `Db` so that deleting `TET_DB_DIR` also clears buffered files:
//! - `files_blob_v1` — key `file_id`, value = encrypted blob bytes.
//! - `files_meta_v1` — key `file_id`, value = [`FileEnvelopeV1`] JSON.
//! - `files_inbox_v1` — key `receiver(64 hex ascii) ‖ created_at_ms(BE u64) ‖ file_id`, value =
//!   `file_id`. The fixed 64-byte receiver prefix enables `scan_prefix`; the BE timestamp makes
//!   reverse iteration yield newest-first.
//!
//! Entries expire 30 days after `created_at_ms`; [`FileStore::prune_expired`] reaps them.

use crate::files::{FileEnvelopeV1, MAX_FILE_BODY_BYTES, sha256_hex};

const TREE_BLOB: &str = "files_blob_v1";
const TREE_META: &str = "files_meta_v1";
const TREE_INBOX: &str = "files_inbox_v1";
/// file_id → the stored blob's length (u64 big-endian), written and removed with the blob, so the
/// total is a sum of small values — never a read of the blobs themselves.
const TREE_SIZES: &str = "files_blob_size_v1";

const DEFAULT_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_MAX_ENTRIES: usize = 10_000;

#[derive(Debug, thiserror::Error)]
pub enum FileStoreError {
    #[error("sled error: {0}")]
    Sled(#[from] sled::Error),
    #[error("serialization error: {0}")]
    Serde(String),
    #[error("invalid receiver wallet id (expected 64 hex)")]
    InvalidReceiver,
    #[error("blob too large: {got} > {max} bytes")]
    BlobTooLarge { got: u64, max: u64 },
    #[error("blob sha256 mismatch: envelope={expected} actual={actual}")]
    Sha256Mismatch { expected: String, actual: String },
    #[error("file store full (max_entries={0})")]
    Full(usize),
    #[error("file id {0} is already used by another file")]
    IdTaken(String),
    #[error("file storage full: {stored} + {incoming} bytes > cap {cap}")]
    StorageFull { stored: u64, incoming: u64, cap: u64 },
}

pub struct FileStore {
    blob: sled::Tree,
    meta: sled::Tree,
    inbox: sled::Tree,
    sizes: sled::Tree,
    /// Held across "check, then write" for a body: who owns a file id, and whether it fits under the
    /// total cap, must not change between the check and the write (two uploads racing for one id
    /// would otherwise both pass, and the second would overwrite the first).
    write_lock: std::sync::Mutex<()>,
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
    let max = env_u64("TET_FILES_MAX_TTL_MS", MAX_TTL_MS);
    if ttl_ms == 0 {
        env_u64("TET_FILES_DEFAULT_TTL_MS", DEFAULT_TTL_MS).min(max)
    } else {
        ttl_ms.min(max)
    }
}

fn is_expired(env: &FileEnvelopeV1, now: u64) -> bool {
    let expire_at = env.created_at_ms.saturating_add(effective_ttl_ms(env.ttl_ms));
    now > expire_at
}

fn inbox_key(receiver: &str, created_at_ms: u64, file_id: &str) -> Vec<u8> {
    let mut k = Vec::with_capacity(receiver.len() + 8 + file_id.len());
    k.extend_from_slice(receiver.as_bytes());
    k.extend_from_slice(&created_at_ms.to_be_bytes());
    k.extend_from_slice(file_id.as_bytes());
    k
}

impl FileStore {
    /// Open the file-sharing trees on the ledger's sled `Db`.
    pub fn open(db: &sled::Db) -> Result<Self, FileStoreError> {
        let store = Self {
            blob: db.open_tree(TREE_BLOB)?,
            meta: db.open_tree(TREE_META)?,
            inbox: db.open_tree(TREE_INBOX)?,
            sizes: db.open_tree(TREE_SIZES)?,
            write_lock: std::sync::Mutex::new(()),
        };
        // Blobs stored before the size index existed are measured once, here.
        if store.sizes.is_empty() && !store.blob.is_empty() {
            for item in store.blob.iter() {
                let Ok((k, v)) = item else { continue };
                store.sizes.insert(k, &(v.len() as u64).to_be_bytes())?;
            }
        }
        Ok(store)
    }

    fn size_of(&self, file_id: &[u8]) -> u64 {
        self.sizes
            .get(file_id)
            .ok()
            .flatten()
            .and_then(|v| <[u8; 8]>::try_from(v.as_ref()).ok())
            .map(u64::from_be_bytes)
            .unwrap_or(0)
    }

    /// Write a blob and its size, refusing it if the total would pass [`Self::max_total_bytes`].
    /// Every path that stores a body comes through here (uploads and blobs fetched from peers).
    fn insert_blob(&self, file_id: &[u8], blob: &[u8]) -> Result<(), FileStoreError> {
        if let Some(cap) = Self::max_total_bytes() {
            let stored = self.total_blob_bytes().saturating_sub(self.size_of(file_id));
            let incoming = blob.len() as u64;
            if stored.saturating_add(incoming) > cap {
                return Err(FileStoreError::StorageFull { stored, incoming, cap });
            }
        }
        self.blob.insert(file_id, blob)?;
        self.sizes.insert(file_id, &(blob.len() as u64).to_be_bytes())?;
        Ok(())
    }

    fn remove_blob(&self, file_id: &[u8]) {
        let _ = self.blob.remove(file_id);
        let _ = self.sizes.remove(file_id);
    }

    pub fn max_body_bytes() -> u64 {
        env_u64("TET_FILES_MAX_BODY_BYTES", MAX_FILE_BODY_BYTES)
    }

    /// The most bytes of file bodies this node keeps in total (`TET_FILES_MAX_TOTAL_BYTES`); `None`
    /// (the default) means no cap beyond the entry count. A node taking large files sets it.
    pub fn max_total_bytes() -> Option<u64> {
        std::env::var("TET_FILES_MAX_TOTAL_BYTES").ok().and_then(|v| v.trim().parse::<u64>().ok()).filter(|v| *v > 0)
    }

    /// The bytes of file bodies stored now (from the size index; blobs are not read).
    pub fn total_blob_bytes(&self) -> u64 {
        self.sizes
            .iter()
            .values()
            .filter_map(|v| v.ok())
            .filter_map(|v| <[u8; 8]>::try_from(v.as_ref()).ok())
            .map(u64::from_be_bytes)
            .sum()
    }

    /// Whether `incoming` more bytes fit under [`Self::max_total_bytes`].
    pub fn has_room_for(&self, incoming: u64) -> bool {
        match Self::max_total_bytes() {
            None => true,
            Some(cap) => self.total_blob_bytes().saturating_add(incoming) <= cap,
        }
    }

    fn max_entries() -> usize {
        env_usize("TET_FILES_MAX_ENTRIES", DEFAULT_MAX_ENTRIES)
    }

    /// Buffer an envelope's **metadata** (meta + inbox index), dedup by `file_id`.
    ///
    /// Returns `Ok(true)` if newly stored, `Ok(false)` if `file_id` was already present. Callers MUST
    /// have run [`crate::files::verify_file_envelope_v1`] first. Used by `POST /files/announce` and
    /// the gossip-receive path (which carry no blob).
    pub fn store_meta(&self, env: &FileEnvelopeV1) -> Result<bool, FileStoreError> {
        let receiver = env.receiver_wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&receiver) {
            return Err(FileStoreError::InvalidReceiver);
        }
        let file_id = env.file_id.to_string();
        if self.meta.contains_key(file_id.as_bytes())? {
            return Ok(false);
        }
        let max = Self::max_entries();
        if self.meta.len() >= max {
            let _ = self.prune_expired();
            if self.meta.len() >= max {
                return Err(FileStoreError::Full(max));
            }
        }
        let val = serde_json::to_vec(env).map_err(|e| FileStoreError::Serde(e.to_string()))?;
        self.meta.insert(file_id.as_bytes(), val)?;
        self.inbox.insert(
            inbox_key(&receiver, env.created_at_ms, &file_id),
            file_id.as_bytes(),
        )?;
        Ok(true)
    }

    /// Store the encrypted blob for an already-known envelope, validating size + sha256.
    pub fn put_blob(&self, env: &FileEnvelopeV1, blob: &[u8]) -> Result<(), FileStoreError> {
        let max = Self::max_body_bytes();
        if blob.len() as u64 > max {
            return Err(FileStoreError::BlobTooLarge {
                got: blob.len() as u64,
                max,
            });
        }
        let actual = sha256_hex(blob);
        let expected = env.file_sha256.trim().to_ascii_lowercase();
        if actual != expected {
            return Err(FileStoreError::Sha256Mismatch { expected, actual });
        }
        let _w = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        self.insert_blob(env.file_id.to_string().as_bytes(), blob)?;
        Ok(())
    }

    /// Convenience for `POST /files/upload`: store meta + inbox + blob in one call. Returns whether
    /// the meta was newly stored (the blob is always written/overwritten).
    pub fn store_with_blob(
        &self,
        env: &FileEnvelopeV1,
        blob: &[u8],
    ) -> Result<bool, FileStoreError> {
        // Validate the blob before touching the indexes.
        let max = Self::max_body_bytes();
        if blob.len() as u64 > max {
            return Err(FileStoreError::BlobTooLarge {
                got: blob.len() as u64,
                max,
            });
        }
        let actual = sha256_hex(blob);
        let expected = env.file_sha256.trim().to_ascii_lowercase();
        if actual != expected {
            return Err(FileStoreError::Sha256Mismatch { expected, actual });
        }
        let _w = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        // A file id belongs to the first envelope stored under it. Ids can be chosen (a "stamp" derives
        // one from a hash anyone holding the .sig.json can compute), so another envelope under the
        // same id must not overwrite its body. The identical envelope may be uploaded again.
        if let Some(existing) = self.get_meta(&env.file_id.to_string())
            && (existing.sender_wallet_id.trim().to_ascii_lowercase() != env.sender_wallet_id.trim().to_ascii_lowercase()
                || existing.file_sha256.trim().to_ascii_lowercase() != env.file_sha256.trim().to_ascii_lowercase()
                || existing.receiver_wallet_id.trim().to_ascii_lowercase() != env.receiver_wallet_id.trim().to_ascii_lowercase())
        {
            return Err(FileStoreError::IdTaken(env.file_id.to_string()));
        }
        // Room first, so a full store leaves no index entry for a file it can't keep.
        if let Some(cap) = Self::max_total_bytes() {
            let id = env.file_id.to_string();
            let stored = self.total_blob_bytes().saturating_sub(self.size_of(id.as_bytes()));
            let incoming = blob.len() as u64;
            if stored.saturating_add(incoming) > cap {
                return Err(FileStoreError::StorageFull { stored, incoming, cap });
            }
        }
        let newly = self.store_meta(env)?;
        self.insert_blob(env.file_id.to_string().as_bytes(), blob)?;
        Ok(newly)
    }

    /// Fetch the encrypted blob bytes for `file_id`, if present and not expired.
    pub fn get_blob(&self, file_id: &str) -> Option<Vec<u8>> {
        // Respect TTL: a present-but-expired file should read as absent.
        if let Some(env) = self.get_meta(file_id)
            && is_expired(&env, now_ms())
        {
            return None;
        }
        self.blob
            .get(file_id.as_bytes())
            .ok()
            .flatten()
            .map(|v| v.to_vec())
    }

    /// Fetch the stored envelope (meta) for `file_id`, if present.
    pub fn get_meta(&self, file_id: &str) -> Option<FileEnvelopeV1> {
        let v = self.meta.get(file_id.as_bytes()).ok().flatten()?;
        serde_json::from_slice(&v).ok()
    }

    /// Return up to `limit` non-expired envelopes addressed to `wallet_id`, newest first.
    pub fn get_inbox(&self, wallet_id: &str, limit: usize) -> Vec<FileEnvelopeV1> {
        let receiver = wallet_id.trim().to_ascii_lowercase();
        if !is_wallet_id_64hex(&receiver) {
            return Vec::new();
        }
        let now = now_ms();
        let mut out = Vec::new();
        for item in self.inbox.scan_prefix(receiver.as_bytes()).rev() {
            if out.len() >= limit {
                break;
            }
            let Ok((_k, file_id_bytes)) = item else {
                continue;
            };
            let Ok(file_id) = std::str::from_utf8(&file_id_bytes) else {
                continue;
            };
            let Some(env) = self.get_meta(file_id) else {
                continue;
            };
            if is_expired(&env, now) {
                continue;
            }
            if env.receiver_wallet_id.trim().to_ascii_lowercase() != receiver {
                continue;
            }
            out.push(env);
        }
        out
    }

    /// Delete a file's blob + meta + inbox entry. Returns `true` if the meta existed.
    pub fn delete_file(&self, file_id: &str) -> bool {
        let existed = match self.get_meta(file_id) {
            Some(env) => {
                let receiver = env.receiver_wallet_id.trim().to_ascii_lowercase();
                let _ = self
                    .inbox
                    .remove(inbox_key(&receiver, env.created_at_ms, file_id));
                true
            }
            None => false,
        };
        self.remove_blob(file_id.as_bytes());
        let _ = self.meta.remove(file_id.as_bytes());
        existed
    }

    /// Delete every expired entry across all three trees. Returns the number of files removed.
    pub fn prune_expired(&self) -> usize {
        let now = now_ms();
        let mut expired: Vec<String> = Vec::new();
        for item in self.meta.iter() {
            let Ok((k, v)) = item else { continue };
            let Ok(file_id) = std::str::from_utf8(&k).map(|s| s.to_string()) else {
                continue;
            };
            match serde_json::from_slice::<FileEnvelopeV1>(&v) {
                Ok(env) => {
                    if is_expired(&env, now) {
                        expired.push(file_id);
                    }
                }
                // Undecodable meta: drop it too.
                Err(_) => expired.push(file_id),
            }
        }
        let mut removed = 0usize;
        for file_id in expired {
            if self.delete_file(&file_id) {
                removed += 1;
            } else {
                // meta was undecodable; still clear blob/meta best-effort.
                self.remove_blob(file_id.as_bytes());
                let _ = self.meta.remove(file_id.as_bytes());
            }
        }
        removed
    }

    /// Number of buffered files (meta entries).
    pub fn len(&self) -> usize {
        self.meta.len()
    }

    pub fn is_empty(&self) -> bool {
        self.meta.is_empty()
    }
}
