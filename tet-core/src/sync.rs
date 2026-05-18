//! Chain sync wire types and helpers (Sprint 1 — block catch-up).
//!
//! JSON request-response payloads for `/tet/v1/chain-sync/*` live here, separate from
//! [`crate::protocol`] transaction envelopes.

use crate::consensus::RemoteBlockGossip;
use crate::ledger::{BlockRecordV1, Ledger, LedgerError};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

/// libp2p request-response protocol name (hello / status exchange).
pub const CHAIN_SYNC_HELLO_PROTOCOL: &str = "/tet/v1/chain-sync/hello/json";

/// libp2p request-response protocol name (bulk block range fetch).
pub const CHAIN_SYNC_RANGE_PROTOCOL: &str = "/tet/v1/chain-sync/range/json";

/// Max blocks per range response (dual cap: count **or** bytes, whichever first).
pub const MAX_SYNC_BATCH_BLOCKS: u64 = 100;

/// Max serialized JSON bytes per range response (8 MiB).
pub const MAX_SYNC_BATCH_BYTES: usize = 8 * 1024 * 1024;

/// Status handshake exchanged when a block-plane peer connects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainHello {
    /// Chain identity (e.g. genesis hash or `TET_CHAIN_ID`); wired in B.3.
    pub chain_id: String,
    pub block_height: u64,
    pub tip_block_id: String,
    pub state_root: String,
}

/// Inclusive height range pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainSyncRangeRequest {
    /// Inclusive start height (typically `local_height + 1`).
    pub from_height: u64,
    /// Inclusive end height (responder clamps to local tip).
    pub to_height: u64,
}

/// Ordered blocks for `[from_height, to_height]` (responder may truncate via batch caps).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainSyncRangeResponse {
    pub from_height: u64,
    pub to_height: u64,
    /// Ascending by `BlockRecordV1::height`.
    pub blocks: Vec<BlockRecordV1>,
}

impl ChainHello {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}

impl ChainSyncRangeRequest {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    /// Basic structural validation (height order).
    pub fn validate(&self) -> Result<(), ChainSyncValidationError> {
        if self.from_height > self.to_height {
            return Err(ChainSyncValidationError::InvalidHeightRange {
                from: self.from_height,
                to: self.to_height,
            });
        }
        Ok(())
    }
}

impl ChainSyncRangeResponse {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainSyncValidationError {
    InvalidHeightRange { from: u64, to: u64 },
}

impl std::fmt::Display for ChainSyncValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidHeightRange { from, to } => {
                write!(f, "invalid height range: from={from} to={to}")
            }
        }
    }
}

impl std::error::Error for ChainSyncValidationError {}

/// Batch caps for range responses (`TET_SYNC_MAX_BATCH_*`, defaults in [`MAX_SYNC_BATCH_*`]).
pub fn batch_limits() -> (u64, usize) {
    let max_blocks = std::env::var("TET_SYNC_MAX_BATCH_BLOCKS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(MAX_SYNC_BATCH_BLOCKS);
    let max_bytes = std::env::var("TET_SYNC_MAX_BATCH_BYTES")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(MAX_SYNC_BATCH_BYTES);
    (max_blocks, max_bytes)
}

/// Per-peer hello state after a successful chain-sync handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerHelloRecord {
    pub hello: ChainHello,
    /// `peer.block_height - local_height` at ingest time.
    pub height_diff: i64,
    /// `true` when this peer is ahead of us (`height_diff > 0`); B.3b catch-up driver consumes this.
    pub catch_up_pending: bool,
}

/// In-memory registry of peer chain heads (B.3a). Thread-safe via [`SharedHelloRegistry`].
#[derive(Debug, Default)]
pub struct SyncHelloRegistry {
    peers: HashMap<String, PeerHelloRecord>,
    /// Set when any ingested peer reports a higher block height (catch-up driver not run yet).
    pub catch_up_triggered: bool,
}

pub type SharedHelloRegistry = Arc<Mutex<SyncHelloRegistry>>;

pub fn new_hello_registry() -> SharedHelloRegistry {
    Arc::new(Mutex::new(SyncHelloRegistry::default()))
}

impl SyncHelloRegistry {
    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    pub fn catch_up_triggered(&self) -> bool {
        self.catch_up_triggered
    }

    /// Record or update a peer's hello. Returns the stored record.
    pub fn record_peer_hello(
        &mut self,
        peer_id: &str,
        hello: ChainHello,
        local_height: u64,
    ) -> PeerHelloRecord {
        let height_diff = hello.block_height as i64 - local_height as i64;
        let catch_up_pending = height_diff > 0;
        if catch_up_pending {
            self.catch_up_triggered = true;
        }
        let record = PeerHelloRecord {
            hello,
            height_diff,
            catch_up_pending,
        };
        self.peers.insert(peer_id.to_string(), record.clone());
        record
    }

    pub fn remove_peer(&mut self, peer_id: &str) {
        self.peers.remove(peer_id);
    }

    pub fn get(&self, peer_id: &str) -> Option<&PeerHelloRecord> {
        self.peers.get(peer_id)
    }

    /// Snapshot for logs / debug (peer_id → height).
    pub fn heights_snapshot(&self) -> Vec<(String, u64, i64, bool)> {
        self.peers
            .iter()
            .map(|(pid, r)| {
                (
                    pid.clone(),
                    r.hello.block_height,
                    r.height_diff,
                    r.catch_up_pending,
                )
            })
            .collect()
    }

    pub fn clear_catch_up_triggered(&mut self) {
        self.catch_up_triggered = false;
    }

    /// True when any known peer reports a higher canonical height than `local_height`.
    pub fn any_peer_ahead(&self, local_height: u64) -> bool {
        self.peers
            .values()
            .any(|r| r.hello.block_height > local_height)
    }

    /// Highest-height peer that is ahead of us and not blocklisted for catch-up.
    pub fn best_sync_peer(
        &self,
        local_height: u64,
        blacklist: &HashSet<String>,
    ) -> Option<(String, u64)> {
        self.peers
            .iter()
            .filter(|(pid, r)| {
                !blacklist.contains(pid.as_str()) && r.hello.block_height > local_height
            })
            .max_by_key(|(_, r)| r.hello.block_height)
            .map(|(pid, r)| (pid.clone(), r.hello.block_height))
    }
}

/// Convert a stored block record into gossip apply payload (B.3b).
pub fn block_record_to_remote_gossip(block: &BlockRecordV1) -> RemoteBlockGossip {
    RemoteBlockGossip {
        block_height: block.height,
        block_id: block.block_id.clone(),
        parent_block_id: block.parent_block_id.clone(),
        producer_id: block.producer_id.clone(),
        base_reward_micro: block.reward.base_reward_micro,
        compute_reward_micro: block.reward.compute_reward_micro,
        total_reward_micro: block.reward.total_reward_micro,
        state_root: block.state_root.clone(),
        txs: block.txs.clone(),
    }
}

/// Plan the next inclusive height range for catch-up (`from = local+1`, capped by batch size).
pub fn plan_catch_up_range_request(local_height: u64, peer_height: u64) -> ChainSyncRangeRequest {
    let (max_blocks, _) = batch_limits();
    let from_height = local_height.saturating_add(1);
    let batch_end = from_height.saturating_add(max_blocks.saturating_sub(1));
    let to_height = peer_height.min(batch_end);
    ChainSyncRangeRequest {
        from_height,
        to_height,
    }
}

/// Catch-up driver phase (B.3b).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum CatchUpPhase {
    #[default]
    Idle,
    Requesting { peer_id: String },
}

/// Events fed into [`CatchUpDriver`] from the block-plane swarm loop.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatchUpDriverEvent {
    Triggered,
    RangeFailed { peer_id: String, reason: String },
    PeerRemoved { peer_id: String },
    BatchApplied {
        peer_id: String,
        applied: usize,
        failed: bool,
    },
}

/// Side effect for the swarm loop to execute (send RR, clear latch).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatchUpAction {
    None,
    SendRangeRequest {
        peer_id: String,
        request: ChainSyncRangeRequest,
    },
    ClearCatchUpTriggered,
}

/// In-memory catch-up state machine (B.3b). Driven from `p2p.rs` swarm events + tick.
#[derive(Debug, Default)]
pub struct CatchUpDriver {
    phase: CatchUpPhase,
    blacklist: HashSet<String>,
}

pub type SharedCatchUpDriver = Arc<Mutex<CatchUpDriver>>;

pub fn new_catch_up_driver() -> SharedCatchUpDriver {
    Arc::new(Mutex::new(CatchUpDriver::default()))
}

impl CatchUpDriver {
    pub fn phase(&self) -> &CatchUpPhase {
        &self.phase
    }

    pub fn is_idle(&self) -> bool {
        matches!(self.phase, CatchUpPhase::Idle)
    }

    pub fn blacklist_peer(&mut self, peer_id: impl Into<String>) {
        self.blacklist.insert(peer_id.into());
    }

    pub fn is_blacklisted(&self, peer_id: &str) -> bool {
        self.blacklist.contains(peer_id)
    }

    pub fn handle(
        &mut self,
        event: CatchUpDriverEvent,
        registry: &SyncHelloRegistry,
        local_height: u64,
    ) -> CatchUpAction {
        match event {
            CatchUpDriverEvent::Triggered => {
                if !matches!(self.phase, CatchUpPhase::Idle) {
                    return CatchUpAction::None;
                }
                if !registry.catch_up_triggered() {
                    return CatchUpAction::None;
                }
                if !registry.any_peer_ahead(local_height) {
                    return CatchUpAction::ClearCatchUpTriggered;
                }
                self.start_request(registry, local_height)
            }
            CatchUpDriverEvent::BatchApplied {
                peer_id,
                applied,
                failed,
            } => {
                if !matches!(
                    &self.phase,
                    CatchUpPhase::Requesting { peer_id: active } if active == &peer_id
                ) {
                    return CatchUpAction::None;
                }
                self.phase = CatchUpPhase::Idle;
                if failed || applied == 0 {
                    self.blacklist.insert(peer_id);
                    return self.try_continue(registry, local_height);
                }
                if !registry.any_peer_ahead(local_height) {
                    return CatchUpAction::ClearCatchUpTriggered;
                }
                self.start_request(registry, local_height)
            }
            CatchUpDriverEvent::RangeFailed { peer_id, reason } => {
                log::warn!("[sync] catch-up range failed peer={peer_id} reason={reason}");
                if matches!(
                    &self.phase,
                    CatchUpPhase::Requesting { peer_id: active } if active == &peer_id
                ) {
                    self.phase = CatchUpPhase::Idle;
                }
                self.blacklist.insert(peer_id);
                self.try_continue(registry, local_height)
            }
            CatchUpDriverEvent::PeerRemoved { peer_id } => {
                if matches!(
                    &self.phase,
                    CatchUpPhase::Requesting { peer_id: active } if active == &peer_id
                ) {
                    self.phase = CatchUpPhase::Idle;
                    return self.try_continue(registry, local_height);
                }
                CatchUpAction::None
            }
        }
    }

    fn start_request(
        &mut self,
        registry: &SyncHelloRegistry,
        local_height: u64,
    ) -> CatchUpAction {
        let Some((peer_id, peer_height)) = registry.best_sync_peer(local_height, &self.blacklist)
        else {
            return if registry.any_peer_ahead(local_height) {
                CatchUpAction::None
            } else {
                CatchUpAction::ClearCatchUpTriggered
            };
        };
        let request = plan_catch_up_range_request(local_height, peer_height);
        self.phase = CatchUpPhase::Requesting {
            peer_id: peer_id.clone(),
        };
        CatchUpAction::SendRangeRequest { peer_id, request }
    }

    fn try_continue(
        &mut self,
        registry: &SyncHelloRegistry,
        local_height: u64,
    ) -> CatchUpAction {
        if !registry.any_peer_ahead(local_height) {
            return CatchUpAction::ClearCatchUpTriggered;
        }
        if matches!(self.phase, CatchUpPhase::Idle) {
            self.start_request(registry, local_height)
        } else {
            CatchUpAction::None
        }
    }
}

/// Local chain status for hello request/response.
pub fn build_chain_hello(ledger: &Ledger) -> Result<ChainHello, LedgerError> {
    let block_height = ledger.block_height()?;
    let state_root = ledger.compute_state_root();
    let tip_block_id = ledger
        .chain_tip()?
        .map(|t| t.block_id)
        .unwrap_or_default();
    Ok(ChainHello {
        chain_id: crate::ledger::chain_id_from_env(),
        block_height,
        tip_block_id,
        state_root,
    })
}

/// Build a range response from canonical blocks on disk (dual batch cap).
pub fn build_chain_sync_range_response(
    ledger: &Ledger,
    req: &ChainSyncRangeRequest,
) -> ChainSyncRangeResponse {
    let (max_blocks, max_bytes) = batch_limits();
    build_chain_sync_range_response_with_caps(ledger, req, max_blocks, max_bytes)
}

fn build_chain_sync_range_response_with_caps(
    ledger: &Ledger,
    req: &ChainSyncRangeRequest,
    max_blocks: u64,
    max_bytes: usize,
) -> ChainSyncRangeResponse {
    let empty = |from: u64, to: u64| ChainSyncRangeResponse {
        from_height: from,
        to_height: to,
        blocks: vec![],
    };

    if req.validate().is_err() {
        return empty(req.from_height, req.to_height);
    }

    let local_height = match ledger.block_height() {
        Ok(h) => h,
        Err(e) => {
            log::warn!("[sync] range: block_height read failed: {e}");
            return empty(req.from_height, req.to_height);
        }
    };

    if req.from_height > local_height {
        return empty(req.from_height, req.to_height);
    }

    let to_height = req.to_height.min(local_height);
    if req.from_height > to_height {
        return empty(req.from_height, req.to_height);
    }

    let mut blocks = Vec::new();
    let mut bytes_used = 0usize;
    let mut actual_to = req.from_height.saturating_sub(1);

    for h in req.from_height..=to_height {
        if blocks.len() as u64 >= max_blocks {
            break;
        }
        let block_id = match ledger.canonical_block_id_at_height(h) {
            Ok(Some(id)) => id,
            Ok(None) => break,
            Err(e) => {
                log::warn!("[sync] range: canonical id at height={h}: {e}");
                break;
            }
        };
        let block = match ledger.block_record_by_id(&block_id) {
            Ok(Some(b)) => b,
            Ok(None) => break,
            Err(e) => {
                log::warn!("[sync] range: block_record_by_id {block_id}: {e}");
                break;
            }
        };
        let encoded_len = match serde_json::to_vec(&block) {
            Ok(v) => v.len(),
            Err(e) => {
                log::warn!("[sync] range: encode block height={h}: {e}");
                break;
            }
        };
        if !blocks.is_empty() && bytes_used.saturating_add(encoded_len) > max_bytes {
            break;
        }
        bytes_used = bytes_used.saturating_add(encoded_len);
        actual_to = h;
        blocks.push(block);
    }

    ChainSyncRangeResponse {
        from_height: req.from_height,
        to_height: if blocks.is_empty() {
            req.from_height.saturating_sub(1)
        } else {
            actual_to
        },
        blocks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::BlockRewardRecordV1;

    fn sample_block(height: u64) -> BlockRecordV1 {
        BlockRecordV1 {
            v: 1,
            height,
            block_id: format!("block-{height}"),
            parent_block_id: if height == 0 {
                None
            } else {
                Some(format!("block-{}", height - 1))
            },
            producer_id: "producer-a".to_string(),
            tx_hashes: vec![],
            txs: vec![],
            state_root: format!("root-{height}"),
            reward: BlockRewardRecordV1 {
                base_reward_micro: 1,
                compute_reward_micro: 0,
                total_reward_micro: 1,
            },
            caac_weight: 1,
            cumulative_weight: height as u128,
            canonical: true,
            ts_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn chain_hello_json_roundtrip() {
        let hello = ChainHello {
            chain_id: "tet-dev-genesis".to_string(),
            block_height: 15,
            tip_block_id: "block-15".to_string(),
            state_root: "abc123".to_string(),
        };
        let json = hello.to_json().expect("encode");
        let back = ChainHello::from_json(&json).expect("decode");
        assert_eq!(back, hello);
        assert!(json.contains("\"block_height\":15"));
    }

    #[test]
    fn chain_sync_range_request_json_roundtrip() {
        let req = ChainSyncRangeRequest {
            from_height: 1,
            to_height: 100,
        };
        let json = req.to_json().expect("encode");
        let back = ChainSyncRangeRequest::from_json(&json).expect("decode");
        assert_eq!(back, req);
        req.validate().expect("valid range");
    }

    #[test]
    fn chain_sync_range_request_rejects_inverted_range() {
        let req = ChainSyncRangeRequest {
            from_height: 10,
            to_height: 5,
        };
        assert!(matches!(
            req.validate(),
            Err(ChainSyncValidationError::InvalidHeightRange { .. })
        ));
    }

    #[test]
    fn chain_sync_range_response_json_roundtrip_with_blocks() {
        let resp = ChainSyncRangeResponse {
            from_height: 1,
            to_height: 2,
            blocks: vec![sample_block(1), sample_block(2)],
        };
        let json = resp.to_json().expect("encode");
        let back = ChainSyncRangeResponse::from_json(&json).expect("decode");
        assert_eq!(back.from_height, 1);
        assert_eq!(back.to_height, 2);
        assert_eq!(back.blocks.len(), 2);
        assert_eq!(back.blocks[0].height, 1);
        assert_eq!(back.blocks[1].block_id, "block-2");
    }

    #[test]
    fn sync_batch_constants_match_design_doc() {
        assert_eq!(MAX_SYNC_BATCH_BLOCKS, 100);
        assert_eq!(MAX_SYNC_BATCH_BYTES, 8 * 1024 * 1024);
    }

    #[test]
    fn chain_sync_protocol_ids_are_stable() {
        assert_eq!(CHAIN_SYNC_HELLO_PROTOCOL, "/tet/v1/chain-sync/hello/json");
        assert_eq!(CHAIN_SYNC_RANGE_PROTOCOL, "/tet/v1/chain-sync/range/json");
    }

    #[test]
    fn hello_registry_record_and_remove() {
        let mut reg = SyncHelloRegistry::default();
        let hello = ChainHello {
            chain_id: "tet-local-dev".to_string(),
            block_height: 10,
            tip_block_id: "block-10".to_string(),
            state_root: "r".to_string(),
        };
        let rec = reg.record_peer_hello("peer-a", hello.clone(), 3);
        assert_eq!(rec.height_diff, 7);
        assert!(rec.catch_up_pending);
        assert!(reg.catch_up_triggered());
        assert_eq!(reg.peer_count(), 1);

        reg.remove_peer("peer-a");
        assert_eq!(reg.peer_count(), 0);
        assert!(reg.get("peer-a").is_none());
        assert!(reg.catch_up_triggered());
    }

    #[test]
    fn hello_registry_no_catch_up_when_peer_not_ahead() {
        let mut reg = SyncHelloRegistry::default();
        let hello = ChainHello {
            chain_id: "tet".to_string(),
            block_height: 5,
            tip_block_id: "b5".to_string(),
            state_root: "r".to_string(),
        };
        let rec = reg.record_peer_hello("peer-b", hello, 5);
        assert_eq!(rec.height_diff, 0);
        assert!(!rec.catch_up_pending);
        assert!(!reg.catch_up_triggered());
    }

    #[test]
    fn hello_registry_update_replaces_peer() {
        let mut reg = SyncHelloRegistry::default();
        reg.record_peer_hello(
            "p1",
            ChainHello {
                chain_id: "t".into(),
                block_height: 1,
                tip_block_id: "b1".into(),
                state_root: "r".into(),
            },
            0,
        );
        reg.record_peer_hello(
            "p1",
            ChainHello {
                chain_id: "t".into(),
                block_height: 9,
                tip_block_id: "b9".into(),
                state_root: "r".into(),
            },
            1,
        );
        assert_eq!(reg.get("p1").unwrap().hello.block_height, 9);
        assert_eq!(reg.peer_count(), 1);
    }

    #[test]
    fn batch_limits_default_constants() {
        let (blocks, bytes) = batch_limits();
        assert_eq!(blocks, MAX_SYNC_BATCH_BLOCKS);
        assert_eq!(bytes, MAX_SYNC_BATCH_BYTES);
    }

    #[test]
    fn plan_catch_up_range_request_caps_batch() {
        let req = plan_catch_up_range_request(3, 50);
        assert_eq!(req.from_height, 4);
        assert_eq!(req.to_height, 50);
        let req2 = plan_catch_up_range_request(3, 10);
        assert_eq!(req2.to_height, 10);
    }

    #[test]
    fn catch_up_driver_idle_to_requesting_on_trigger() {
        let mut reg = SyncHelloRegistry::default();
        reg.record_peer_hello(
            "peer-a",
            ChainHello {
                chain_id: "t".into(),
                block_height: 5,
                tip_block_id: "b5".into(),
                state_root: "r".into(),
            },
            0,
        );
        let mut driver = CatchUpDriver::default();
        let action = driver.handle(CatchUpDriverEvent::Triggered, &reg, 0);
        assert!(matches!(
            action,
            CatchUpAction::SendRangeRequest { ref peer_id, .. } if peer_id == "peer-a"
        ));
        assert!(matches!(
            driver.phase(),
            CatchUpPhase::Requesting { peer_id } if peer_id == "peer-a"
        ));
    }

    #[test]
    fn catch_up_driver_clears_trigger_when_synced() {
        let mut reg = SyncHelloRegistry::default();
        reg.catch_up_triggered = true;
        let mut driver = CatchUpDriver::default();
        let action = driver.handle(CatchUpDriverEvent::Triggered, &reg, 5);
        assert_eq!(action, CatchUpAction::ClearCatchUpTriggered);
    }

    #[test]
    fn catch_up_driver_batch_applied_requests_next_batch() {
        let mut reg = SyncHelloRegistry::default();
        reg.record_peer_hello(
            "peer-a",
            ChainHello {
                chain_id: "t".into(),
                block_height: 10,
                tip_block_id: "b10".into(),
                state_root: "r".into(),
            },
            0,
        );
        let mut driver = CatchUpDriver::default();
        driver.phase = CatchUpPhase::Requesting {
            peer_id: "peer-a".into(),
        };
        let action = driver.handle(
            CatchUpDriverEvent::BatchApplied {
                peer_id: "peer-a".into(),
                applied: 2,
                failed: false,
            },
            &reg,
            2,
        );
        assert!(matches!(action, CatchUpAction::SendRangeRequest { .. }));
        assert!(matches!(driver.phase(), CatchUpPhase::Requesting { .. }));
    }

    #[test]
    fn catch_up_driver_apply_failure_blacklists_and_switches_peer() {
        let mut reg = SyncHelloRegistry::default();
        reg.record_peer_hello(
            "bad",
            ChainHello {
                chain_id: "t".into(),
                block_height: 5,
                tip_block_id: "b5".into(),
                state_root: "r".into(),
            },
            0,
        );
        reg.record_peer_hello(
            "good",
            ChainHello {
                chain_id: "t".into(),
                block_height: 5,
                tip_block_id: "b5".into(),
                state_root: "r".into(),
            },
            0,
        );
        let mut driver = CatchUpDriver::default();
        driver.phase = CatchUpPhase::Requesting {
            peer_id: "bad".into(),
        };
        let action = driver.handle(
            CatchUpDriverEvent::BatchApplied {
                peer_id: "bad".into(),
                applied: 0,
                failed: true,
            },
            &reg,
            0,
        );
        assert!(driver.is_blacklisted("bad"));
        assert!(matches!(
            action,
            CatchUpAction::SendRangeRequest { ref peer_id, .. } if peer_id == "good"
        ));
    }

    #[test]
    fn catch_up_driver_range_failed_blacklists_peer() {
        let mut reg = SyncHelloRegistry::default();
        reg.record_peer_hello(
            "peer-a",
            ChainHello {
                chain_id: "t".into(),
                block_height: 5,
                tip_block_id: "b5".into(),
                state_root: "r".into(),
            },
            0,
        );
        reg.record_peer_hello(
            "peer-b",
            ChainHello {
                chain_id: "t".into(),
                block_height: 6,
                tip_block_id: "b6".into(),
                state_root: "r".into(),
            },
            0,
        );
        let mut driver = CatchUpDriver::default();
        driver.phase = CatchUpPhase::Requesting {
            peer_id: "peer-a".into(),
        };
        let action = driver.handle(
            CatchUpDriverEvent::RangeFailed {
                peer_id: "peer-a".into(),
                reason: "timeout".into(),
            },
            &reg,
            0,
        );
        assert!(driver.is_blacklisted("peer-a"));
        assert!(matches!(
            action,
            CatchUpAction::SendRangeRequest { ref peer_id, .. } if peer_id == "peer-b"
        ));
    }

    #[test]
    fn catch_up_driver_peer_removed_while_requesting_retries() {
        let mut reg = SyncHelloRegistry::default();
        reg.record_peer_hello(
            "peer-b",
            ChainHello {
                chain_id: "t".into(),
                block_height: 5,
                tip_block_id: "b5".into(),
                state_root: "r".into(),
            },
            0,
        );
        let mut driver = CatchUpDriver::default();
        driver.phase = CatchUpPhase::Requesting {
            peer_id: "gone".into(),
        };
        let action = driver.handle(
            CatchUpDriverEvent::PeerRemoved {
                peer_id: "gone".into(),
            },
            &reg,
            0,
        );
        assert!(matches!(
            action,
            CatchUpAction::SendRangeRequest { ref peer_id, .. } if peer_id == "peer-b"
        ));
    }

    fn open_temp_ledger() -> Ledger {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = dir.path().join("db");
        std::mem::forget(dir);
        Ledger::open(db.to_str().unwrap()).expect("ledger open")
    }

    #[test]
    fn build_range_empty_when_from_above_local_height() {
        let ledger = open_temp_ledger();
        ledger.set_block_height_exact(3).expect("height");
        for h in 1..=3 {
            ledger
                .record_block_record(&sample_block(h))
                .expect("record");
        }
        let resp = build_chain_sync_range_response(
            &ledger,
            &ChainSyncRangeRequest {
                from_height: 10,
                to_height: 20,
            },
        );
        assert!(resp.blocks.is_empty());
        assert_eq!(resp.from_height, 10);
    }

    #[test]
    fn build_range_returns_ordered_blocks_up_to_tip() {
        let ledger = open_temp_ledger();
        for h in 1..=5 {
            ledger
                .record_block_record(&sample_block(h))
                .expect("record");
        }
        ledger.set_block_height_exact(5).expect("height");
        let resp = build_chain_sync_range_response(
            &ledger,
            &ChainSyncRangeRequest {
                from_height: 2,
                to_height: 99,
            },
        );
        assert_eq!(resp.blocks.len(), 4);
        assert_eq!(resp.blocks[0].height, 2);
        assert_eq!(resp.blocks[3].height, 5);
        assert_eq!(resp.to_height, 5);
    }

    #[test]
    fn build_range_respects_block_count_cap() {
        let ledger = open_temp_ledger();
        for h in 1..=5 {
            ledger
                .record_block_record(&sample_block(h))
                .expect("record");
        }
        ledger.set_block_height_exact(5).expect("height");
        let resp = build_chain_sync_range_response_with_caps(
            &ledger,
            &ChainSyncRangeRequest {
                from_height: 1,
                to_height: 5,
            },
            2,
            16 * 1024 * 1024,
        );
        assert_eq!(resp.blocks.len(), 2);
        assert_eq!(resp.to_height, 2);
    }
}
