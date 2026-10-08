//! Operator hide: the node operator stops serving a board, post or file on this node's public routes.
//!
//! - **Node-local, not consensus.** Nothing here touches the ledger, a block or a balance; chain data
//!   is never deleted. Other nodes keep whatever copies they already hold.
//! - **What can be hidden:** a wallet (a board: posts sent *to* it and posts sent *by* it, so its
//!   directory listing disappears too), a Tmail message by `msg_id`, a file by `file_id`. A thread
//!   is hidden by hiding its posts' `msg_id`s; the operator finds them with the board's invite on
//!   their own machine (`tet-network/ui/scripts/operator_thread_ids.mjs`), so the node never gets a
//!   board key.
//! - **Every use is logged** to the operator's own log: one JSON line per hide/unhide in
//!   `TET_OPERATOR_LOG` (default `<data dir>/operator.log`), and the same line in the node log.
//! - Enforced on every public route that returns content (Tmail inbox, files inbox, file fetch) and
//!   on peer file fetches; `operator_hidden_items_are_not_served_on_any_public_route` checks each.

use serde::{Deserialize, Serialize};
use std::io::Write as _;

const TREE: &str = "operator_hidden_v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HideKind {
    Wallet,
    Msg,
    File,
}

impl HideKind {
    fn prefix(self) -> &'static str {
        match self {
            HideKind::Wallet => "wallet:",
            HideKind::Msg => "msg:",
            HideKind::File => "file:",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HiddenItem {
    pub kind: HideKind,
    pub id: String,
    pub reason: String,
    pub hidden_at_ms: u64,
}

/// Normalise an id for its kind, or refuse it.
pub fn normalize_id(kind: HideKind, id: &str) -> Result<String, String> {
    let id = id.trim().to_ascii_lowercase();
    let ok = match kind {
        HideKind::Wallet => id.len() == 64 && id.chars().all(|c| c.is_ascii_hexdigit()),
        HideKind::File => uuid::Uuid::parse_str(&id).is_ok(),
        HideKind::Msg => !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
    };
    if ok { Ok(id) } else { Err(format!("not a valid {kind:?} id")) }
}

#[derive(Clone)]
pub struct OperatorHide {
    tree: sled::Tree,
}

impl OperatorHide {
    pub fn open(db: &sled::Db) -> Result<Self, sled::Error> {
        Ok(Self { tree: db.open_tree(TREE)? })
    }

    fn key(kind: HideKind, id: &str) -> Vec<u8> {
        format!("{}{}", kind.prefix(), id.trim().to_ascii_lowercase()).into_bytes()
    }

    fn has(&self, kind: HideKind, id: &str) -> bool {
        // Fail closed: a read error counts as hidden.
        self.tree.contains_key(Self::key(kind, id)).unwrap_or(true)
    }

    pub fn is_wallet_hidden(&self, wallet_id: &str) -> bool {
        self.has(HideKind::Wallet, wallet_id)
    }
    pub fn is_msg_hidden(&self, msg_id: &str) -> bool {
        self.has(HideKind::Msg, msg_id)
    }
    pub fn is_file_hidden(&self, file_id: &str) -> bool {
        self.has(HideKind::File, file_id)
    }

    /// Hide an item and log it. Returns the stored row.
    pub fn hide(&self, kind: HideKind, id: &str, reason: &str, now_ms: u64) -> Result<HiddenItem, String> {
        let id = normalize_id(kind, id)?;
        let reason: String = reason.trim().chars().take(500).collect();
        let row = HiddenItem { kind, id: id.clone(), reason, hidden_at_ms: now_ms };
        let bytes = serde_json::to_vec(&row).map_err(|e| e.to_string())?;
        self.tree.insert(Self::key(kind, &id), bytes).map_err(|e| e.to_string())?;
        self.tree.flush().map_err(|e| e.to_string())?;
        log_operator_action("hide", &row);
        Ok(row)
    }

    /// Serve an item again and log it. `Ok(false)` if it wasn't hidden.
    pub fn unhide(&self, kind: HideKind, id: &str, reason: &str, now_ms: u64) -> Result<bool, String> {
        let id = normalize_id(kind, id)?;
        let was = self.tree.remove(Self::key(kind, &id)).map_err(|e| e.to_string())?.is_some();
        self.tree.flush().map_err(|e| e.to_string())?;
        let reason: String = reason.trim().chars().take(500).collect();
        log_operator_action("unhide", &HiddenItem { kind, id, reason, hidden_at_ms: now_ms });
        Ok(was)
    }

    pub fn list(&self) -> Vec<HiddenItem> {
        self.tree
            .iter()
            .filter_map(|kv| kv.ok())
            .filter_map(|(_, v)| serde_json::from_slice::<HiddenItem>(&v).ok())
            .collect()
    }
}

/// Where the operator's log goes: `TET_OPERATOR_LOG`, else `operator.log` next to the database.
pub fn operator_log_path() -> std::path::PathBuf {
    if let Some(p) = std::env::var("TET_OPERATOR_LOG").ok().filter(|p| !p.trim().is_empty()) {
        return p.into();
    }
    let db = std::env::var("TET_DB_DIR").unwrap_or_else(|_| "tet.db".into());
    std::path::Path::new(&db).parent().map(|d| d.join("operator.log")).unwrap_or_else(|| "operator.log".into())
}

fn log_operator_action(action: &str, row: &HiddenItem) {
    let line = serde_json::json!({ "action": action, "kind": row.kind, "id": row.id, "reason": row.reason, "at_ms": row.hidden_at_ms }).to_string();
    log::warn!("[operator] {line}");
    let path = operator_log_path();
    match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut f) => {
            if let Err(e) = writeln!(f, "{line}") {
                log::error!("[operator] could not write {}: {e}", path.display());
            }
        }
        Err(e) => log::error!("[operator] could not open {}: {e}", path.display()),
    }
}
