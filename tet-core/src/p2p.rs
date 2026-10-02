//! Local P2P "nervous system" (mDNS discovery, liveness, gossipsub, and block-sync RPC).
//!
//! Scope: establish that multiple nodes can discover peers, exchange signed transaction/block
//! messages, and maintain lightweight sync/backfill channels around the ledger.

use base64::Engine as _;
use futures::StreamExt;
use libp2p::core::transport::Transport as _;
use libp2p::core::upgrade;
use libp2p::gossipsub;
use libp2p::identify;
use libp2p::identity;
use libp2p::kad;
use libp2p::mdns;
use libp2p::multiaddr::Protocol;
use libp2p::noise;
use libp2p::ping;
use libp2p::request_response;
use libp2p::swarm::{NetworkBehaviour, Swarm, SwarmEvent};
use libp2p::tcp;
use libp2p::yamux;
use libp2p::{Multiaddr, PeerId, StreamProtocol};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::error::Error;
use std::net::Ipv4Addr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, mpsc};

use crate::models::NetworkEvent;
use crate::protocol::SignedTxEnvelopeV1;
use crate::sync::{
    CHAIN_SYNC_HELLO_PROTOCOL, CHAIN_SYNC_RANGE_PROTOCOL, CatchUpAction, CatchUpDriverEvent,
    ChainHello, ChainSyncRangeRequest, ChainSyncRangeResponse, InProgressRangeRequest,
    SharedBlockSyncBoard, SharedCatchUpDriver, SharedHelloRegistry, block_record_to_remote_gossip,
    build_chain_hello, build_chain_sync_range_response, set_in_progress_range,
};
use std::sync::Arc;

type AnyErr = Box<dyn Error + Send + Sync + 'static>;

pub const BLOCK_SYNC_PROTOCOL: &str = "/tet/v1/block-sync/json";
pub const DEFAULT_MAX_ORPHANS: usize = 256;
pub const DEFAULT_ORPHAN_TTL_MS: u64 = 10 * 60 * 1000;
pub const DEFAULT_MAX_BACKFILL_DEPTH: usize = 64;
const DEFAULT_BLACKLIST_MAX_PEERS: usize = 4096;
const DEFAULT_BLACKLIST_TTL_MS: u64 = 30 * 60 * 1000;
const DEFAULT_PENDING_BACKFILL_MAX: usize = 2048;
const DEFAULT_PENDING_BACKFILL_TTL_MS: u64 = 2 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockRequest {
    pub block_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockResponse {
    pub block_id: String,
    pub block: Option<crate::ledger::BlockRecordV1>,
}

#[derive(Debug, Clone)]
struct OrphanEntry {
    block: crate::ledger::BlockRecordV1,
    received_from: Option<PeerId>,
    depth: usize,
    inserted_at_ms: u64,
}

#[derive(Debug)]
pub struct OrphanBuffer {
    max_orphans: usize,
    ttl_ms: u64,
    entries: HashMap<String, OrphanEntry>,
    order: VecDeque<String>,
}

impl OrphanBuffer {
    pub fn new(max_orphans: usize, ttl_ms: u64) -> Self {
        Self {
            max_orphans: max_orphans.max(1),
            ttl_ms,
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn insert(
        &mut self,
        block: crate::ledger::BlockRecordV1,
        received_from: Option<PeerId>,
        depth: usize,
        now_ms: u64,
    ) {
        self.prune_expired(now_ms);
        if self.entries.contains_key(&block.block_id) {
            self.entries.insert(
                block.block_id.clone(),
                OrphanEntry {
                    block,
                    received_from,
                    depth,
                    inserted_at_ms: now_ms,
                },
            );
            return;
        }
        self.order.push_back(block.block_id.clone());
        self.entries.insert(
            block.block_id.clone(),
            OrphanEntry {
                block,
                received_from,
                depth,
                inserted_at_ms: now_ms,
            },
        );
        while self.entries.len() > self.max_orphans {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            } else {
                break;
            }
        }
    }

    pub fn remove(&mut self, block_id: &str) -> Option<crate::ledger::BlockRecordV1> {
        self.entries.remove(block_id).map(|e| e.block)
    }

    pub fn children_of(
        &mut self,
        parent_id: &str,
        now_ms: u64,
    ) -> Vec<crate::ledger::BlockRecordV1> {
        self.prune_expired(now_ms);
        self.entries
            .values()
            .filter(|e| e.block.parent_block_id.as_deref() == Some(parent_id))
            .map(|e| e.block.clone())
            .collect()
    }

    pub fn depth_for(&self, block_id: &str) -> usize {
        self.entries.get(block_id).map(|e| e.depth).unwrap_or(0)
    }

    pub fn received_from(&self, block_id: &str) -> Option<PeerId> {
        self.entries.get(block_id).and_then(|e| e.received_from)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    fn prune_expired(&mut self, now_ms: u64) {
        if self.ttl_ms == 0 {
            return;
        }
        self.entries
            .retain(|_, e| now_ms.saturating_sub(e.inserted_at_ms) <= self.ttl_ms);
        self.order.retain(|id| self.entries.contains_key(id));
    }
}

#[derive(Debug)]
struct BoundedPeerBlacklist {
    max_peers: usize,
    ttl_ms: u64,
    entries: HashMap<PeerId, u64>,
    order: VecDeque<PeerId>,
}

impl BoundedPeerBlacklist {
    fn from_env() -> Self {
        let max_peers = std::env::var("TET_P2P_BLACKLIST_MAX_PEERS")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(DEFAULT_BLACKLIST_MAX_PEERS)
            .max(1);
        let ttl_ms = std::env::var("TET_P2P_BLACKLIST_TTL_MS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(DEFAULT_BLACKLIST_TTL_MS);
        Self {
            max_peers,
            ttl_ms,
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn insert(&mut self, peer: PeerId, now_ms: u64) {
        self.prune(now_ms);
        if !self.entries.contains_key(&peer) {
            self.order.push_back(peer);
        }
        self.entries.insert(peer, now_ms);
        while self.entries.len() > self.max_peers {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            } else {
                break;
            }
        }
    }

    fn contains(&mut self, peer: &PeerId, now_ms: u64) -> bool {
        self.prune(now_ms);
        self.entries.contains_key(peer)
    }

    fn prune(&mut self, now_ms: u64) {
        if self.ttl_ms > 0 {
            self.entries
                .retain(|_, inserted| now_ms.saturating_sub(*inserted) <= self.ttl_ms);
        }
        self.order.retain(|peer| self.entries.contains_key(peer));
    }
}

#[derive(Debug, Clone)]
struct PendingBackfillEntry {
    block_id: String,
    depth: usize,
    inserted_at_ms: u64,
}

fn pending_backfill_max_from_env() -> usize {
    std::env::var("TET_PENDING_BACKFILL_MAX")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_PENDING_BACKFILL_MAX)
        .max(1)
}

fn pending_backfill_ttl_ms_from_env() -> u64 {
    std::env::var("TET_PENDING_BACKFILL_TTL_MS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_PENDING_BACKFILL_TTL_MS)
}

fn prune_pending_backfill(
    pending: &mut HashMap<request_response::OutboundRequestId, PendingBackfillEntry>,
    now_ms: u64,
    max_entries: usize,
    ttl_ms: u64,
) {
    if ttl_ms > 0 {
        pending.retain(|_, e| now_ms.saturating_sub(e.inserted_at_ms) <= ttl_ms);
    }
    if pending.len() <= max_entries {
        return;
    }
    let mut by_age = pending
        .iter()
        .map(|(id, e)| (*id, e.inserted_at_ms))
        .collect::<Vec<_>>();
    by_age.sort_by_key(|(_, ts)| *ts);
    for (id, _) in by_age.into_iter().take(pending.len() - max_entries) {
        pending.remove(&id);
    }
}

#[derive(NetworkBehaviour)]
#[behaviour(to_swarm = "Event")]
struct TetBehaviour {
    mdns: mdns::tokio::Behaviour,
    ping: ping::Behaviour,
    gossipsub: gossipsub::Behaviour,
    identify: identify::Behaviour,
    kademlia: kad::Behaviour<kad::store::MemoryStore>,
    block_sync: request_response::json::Behaviour<BlockRequest, BlockResponse>,
    chain_sync_hello: request_response::json::Behaviour<ChainHello, ChainHello>,
    chain_sync_range:
        request_response::json::Behaviour<ChainSyncRangeRequest, ChainSyncRangeResponse>,
    /// File Sharing body transfer (`/tet/v1/files/fetch`, Step 4) — custom 8 MiB codec because the
    /// stock json codec caps requests at 1 MiB and is not size-configurable.
    files_fetch: request_response::Behaviour<crate::files::fetch_codec::FilesFetchCodec>,
    /// Direct tx submission — see [`TX_SUBMIT_PROTOCOL`].
    tx_submit: request_response::json::Behaviour<TxSubmitRequest, TxSubmitResponse>,
    anon_register: request_response::json::Behaviour<AnonRegisterRequest, AnonRegisterResponse>,
    anon_receipt: request_response::json::Behaviour<AnonReceiptRequest, AnonReceiptResponse>,
    anon_sync: request_response::json::Behaviour<AnonSyncRequest, AnonSyncResponse>,
}

#[derive(Debug)]
enum Event {
    Mdns(mdns::Event),
    Ping(ping::Event),
    Gossipsub(gossipsub::Event),
    Identify(identify::Event),
    Kademlia(kad::Event),
    BlockSync(request_response::Event<BlockRequest, BlockResponse>),
    ChainSyncHello(request_response::Event<ChainHello, ChainHello>),
    ChainSyncRange(request_response::Event<ChainSyncRangeRequest, ChainSyncRangeResponse>),
    FilesFetch(request_response::Event<crate::files::FileFetchRequest, crate::files::FileFetchResponse>),
    TxSubmit(request_response::Event<TxSubmitRequest, TxSubmitResponse>),
    AnonRegister(request_response::Event<AnonRegisterRequest, AnonRegisterResponse>),
    AnonReceipt(request_response::Event<AnonReceiptRequest, AnonReceiptResponse>),
    AnonSync(request_response::Event<AnonSyncRequest, AnonSyncResponse>),
}

impl From<request_response::Event<AnonSyncRequest, AnonSyncResponse>> for Event {
    fn from(e: request_response::Event<AnonSyncRequest, AnonSyncResponse>) -> Self {
        Self::AnonSync(e)
    }
}

impl From<request_response::Event<AnonReceiptRequest, AnonReceiptResponse>> for Event {
    fn from(e: request_response::Event<AnonReceiptRequest, AnonReceiptResponse>) -> Self {
        Self::AnonReceipt(e)
    }
}

impl From<request_response::Event<AnonRegisterRequest, AnonRegisterResponse>> for Event {
    fn from(e: request_response::Event<AnonRegisterRequest, AnonRegisterResponse>) -> Self {
        Self::AnonRegister(e)
    }
}

impl From<request_response::Event<TxSubmitRequest, TxSubmitResponse>> for Event {
    fn from(e: request_response::Event<TxSubmitRequest, TxSubmitResponse>) -> Self {
        Self::TxSubmit(e)
    }
}
impl From<mdns::Event> for Event {
    fn from(e: mdns::Event) -> Self {
        Self::Mdns(e)
    }
}
impl From<ping::Event> for Event {
    fn from(e: ping::Event) -> Self {
        Self::Ping(e)
    }
}
impl From<gossipsub::Event> for Event {
    fn from(e: gossipsub::Event) -> Self {
        Self::Gossipsub(e)
    }
}
impl From<identify::Event> for Event {
    fn from(e: identify::Event) -> Self {
        Self::Identify(e)
    }
}
impl From<kad::Event> for Event {
    fn from(e: kad::Event) -> Self {
        Self::Kademlia(e)
    }
}
impl From<request_response::Event<BlockRequest, BlockResponse>> for Event {
    fn from(e: request_response::Event<BlockRequest, BlockResponse>) -> Self {
        Self::BlockSync(e)
    }
}
impl From<request_response::Event<ChainHello, ChainHello>> for Event {
    fn from(e: request_response::Event<ChainHello, ChainHello>) -> Self {
        Self::ChainSyncHello(e)
    }
}
impl From<request_response::Event<ChainSyncRangeRequest, ChainSyncRangeResponse>> for Event {
    fn from(e: request_response::Event<ChainSyncRangeRequest, ChainSyncRangeResponse>) -> Self {
        Self::ChainSyncRange(e)
    }
}
impl From<request_response::Event<crate::files::FileFetchRequest, crate::files::FileFetchResponse>>
    for Event
{
    fn from(
        e: request_response::Event<crate::files::FileFetchRequest, crate::files::FileFetchResponse>,
    ) -> Self {
        Self::FilesFetch(e)
    }
}

/// Ask the swarm task to pull an encrypted file body from a peer over `/tet/v1/files/fetch`
/// (Step 4). Sent by the REST fetch handler on a local-store miss; the swarm resolves
/// `storage_node` to a connected peer, performs the request/response, and answers on `resp`.
pub struct FilesFetchCmd {
    /// libp2p PeerId (base58) of the node holding the blob, per the announce envelope.
    /// Unparseable/unknown values fall back to the first connected peer.
    pub storage_node: String,
    pub file_id: uuid::Uuid,
    pub resp: tokio::sync::oneshot::Sender<Result<crate::files::FileFetchResponse, String>>,
}

/// Direct transaction submission (`/tet/v1/tx-submit`) — the second path for transactions.
///
/// Blocks reach a follower two ways: gossip, and the pull-based catch-up RPC. Transactions had
/// only gossip, so any weakness in gossip made them undeliverable with no fallback — and gossip
/// turned out to have one: a follower can end up with an incomplete record of a peer's topic
/// subscriptions (observed 2026-09-22, `/tet/v1/txs` missing from an otherwise healthy peer), and
/// then `publish` fails with `InsufficientPeers` forever. This protocol gives transactions the
/// same shape blocks already have: gossip for fan-out, a direct request when you know who to ask.
pub const TX_SUBMIT_PROTOCOL: &str = "/tet/v1/tx-submit";

/// Direct anonymity-set registration (`/tet/v1/anon-register`) — the second path for registrations.
///
/// Same reasoning as [`TX_SUBMIT_PROTOCOL`], applied before the same thing goes wrong again. A
/// registration that does not reach a peer is worse than a transaction that does not: the member
/// is silently absent from that peer's anonymity set, so their proofs fail there with no
/// diagnostic pointing at delivery. Gossip for fan-out, a direct request to bootnodes for
/// certainty.
pub const ANON_REGISTER_PROTOCOL: &str = "/tet/v1/anon-register";

/// Receipt pull (`/tet/v1/anon-receipt`) — the second half of announce-then-pull.
///
/// An anonymous envelope carries ~7 KB of proof metadata and the receipt's SHA-256; the receipt
/// itself is ~250 KB and does not fit a 128 KiB gossip message. This fetches it.
///
/// Content-addressed, which is what makes it safe to ask anyone: the request is a hash and the
/// response is checked against it before anything else happens. A node that has verified a receipt
/// may cache and serve it, so the sender going offline does not strand every message it sent.
pub const ANON_RECEIPT_PROTOCOL: &str = "/tet/v1/anon-receipt";

/// Anti-entropy sync of the anonymity registry (`/tet/v1/anon-registry-sync`).
///
/// # Why gossip is not enough
///
/// Registrations propagate forward only: you learn one if you were listening when it was published.
/// A node that joins later holds a strict subset of its peers' registries, computes a different
/// Merkle root, and then correctly rejects perfectly valid proofs built against the peer's root.
/// Observed CH↔HEL on 2026-09-25: follower `members=1`, seed `members=2`, roots divergent.
///
/// This is the same shape as transactions in S4 and blocks since S1: **gossip gives you the
/// present, never the past**, so anything that must converge needs a pull as well as a push.
///
/// It runs on a timer as well as on connect, because the 2026-09-22 lost-subscription bug showed a
/// node can be connected and healthy while silently receiving nothing on a topic. Periodic root
/// comparison detects that; a join-only sync would not.
pub const ANON_REGISTRY_SYNC_PROTOCOL: &str = "/tet/v1/anon-registry-sync";

/// Registrations per page. Each carries an ML-DSA signature, so a page is the unit of verification
/// work a peer can ask of us in one request.
pub const ANON_SYNC_PAGE: usize = 256;
/// Hard cap on pages per sync round: `256 * 200 = 51,200`, just over the 50,000 member cap, so a
/// complete registry fits and nothing larger can be walked.
pub const ANON_SYNC_MAX_PAGES: u32 = 200;
/// How often to re-compare roots with peers.
pub const ANON_SYNC_INTERVAL_SEC: u64 = 300;
/// Wall-clock budget for *verifying* synced registrations, per peer per sync round.
///
/// Admission runs a hybrid Ed25519 + ML-DSA-44 verification per registration. Measured on this
/// machine (`s8_measure_sync_verification_cost`, 300 registrations): **2.39 ms each**, so a
/// [`ANON_SYNC_PAGE`] page costs ~0.61 s and a full 50,000-member registry ~119 s of pure
/// verification. Unbounded, one peer claiming a full registry could hold the sync path for two
/// minutes per round.
///
/// 30 s admits ~12,500 registrations per peer per round. A registry larger than that converges
/// across several rounds via the resume cursor rather than in one — slower, but never at the cost
/// of the node's responsiveness, and never by admitting anything unverified.
pub const ANON_SYNC_VERIFY_BUDGET_MS: u64 = 30_000;

/// The verification budget in force, honouring `TET_ANON_SYNC_VERIFY_BUDGET_MS`.
fn anon_sync_verify_budget() -> Duration {
    Duration::from_millis(
        std::env::var("TET_ANON_SYNC_VERIFY_BUDGET_MS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(ANON_SYNC_VERIFY_BUDGET_MS),
    )
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnonSyncRequest {
    pub v: u32,
    /// Exclusive cursor: the last wallet id already held. `None` starts from the beginning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_wallet: Option<String>,
    /// `0` is a **probe**: reply with the root and total only, no registrations. Anti-entropy sends
    /// this first and pages only on a mismatch, so the steady state costs one small round trip
    /// rather than a registry transfer.
    pub limit: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnonSyncResponse {
    /// The responder's current epoch root, hex.
    pub merkle_root_hex: String,
    pub epoch: u64,
    pub total_members: usize,
    #[serde(default)]
    pub registrations: Vec<crate::tmail::anon::TmailAnonRegistrationV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Inbound `anon-registry-sync` budget per peer per second. Low: a sync round is a handful of
/// requests, and serving a page reads and serializes up to [`ANON_SYNC_PAGE`] records.
fn anon_sync_rps_from_env() -> u64 {
    std::env::var("TET_ANON_SYNC_RPS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(2)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnonReceiptRequest {
    pub v: u32,
    /// SHA-256 of the receipt, hex.
    pub receipt_sha256_hex: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnonReceiptResponse {
    pub found: bool,
    /// Receipt bytes, base64. Empty when `found` is false.
    #[serde(default)]
    pub receipt_b64: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnonRegisterRequest {
    pub v: u32,
    pub registration: crate::tmail::anon::TmailAnonRegistrationV1,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnonRegisterResponse {
    pub accepted: bool,
    /// `added` | `updated` | `duplicate` | `stale` | `full` | `rejected` | `rate_limited`
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Ask peers to take a registration directly, bypassing gossip.
#[derive(Debug, Clone)]
pub struct AnonRegisterCmd {
    pub registration: crate::tmail::anon::TmailAnonRegistrationV1,
}

/// Inbound `anon-register` budget per peer per second (`TET_ANON_REGISTER_RPS`, default 5).
///
/// Lower than tx-submit's 10: registration is free and permanent-ish, so it is a cheaper thing to
/// flood with. Verification is ML-DSA, so the budget is spent before verifying, not after.
fn anon_register_rps_from_env() -> u64 {
    std::env::var("TET_ANON_REGISTER_RPS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(5)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TxSubmitRequest {
    pub v: u32,
    pub env: SignedTxEnvelopeV1,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TxSubmitResponse {
    pub accepted: bool,
    /// `enqueued` | `already_queued` | `already_applied` | `rejected` | `rate_limited`
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Ask peers to take a transaction directly, bypassing gossip.
#[derive(Debug, Clone)]
pub struct TxSubmitCmd {
    pub env: SignedTxEnvelopeV1,
}

/// Inbound `tx_submit` budget per peer per second (`TET_TX_SUBMIT_RPS`, default 10).
fn tx_submit_rps_from_env() -> u64 {
    std::env::var("TET_TX_SUBMIT_RPS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(10)
}

/// Fixed-window per-peer limiter for inbound `tx_submit`. Verification is the expensive part
/// (ML-DSA), so the budget is spent before `handle_tx_broadcast` runs, not after.
#[derive(Default)]
pub(crate) struct TxSubmitRateLimiter {
    windows: std::collections::HashMap<PeerId, (std::time::Instant, u64)>,
}

impl TxSubmitRateLimiter {
    pub(crate) fn allow(&mut self, peer: &PeerId, max_per_sec: u64) -> bool {
        let now = std::time::Instant::now();
        let entry = self.windows.entry(*peer).or_insert((now, 0));
        if now.duration_since(entry.0) >= Duration::from_secs(1) {
            *entry = (now, 0);
        }
        entry.1 = entry.1.saturating_add(1);
        entry.1 <= max_per_sec
    }

    /// Drop windows for peers we have not heard from in a while so this cannot grow unbounded.
    pub(crate) fn prune(&mut self) {
        let now = std::time::Instant::now();
        self.windows
            .retain(|_, (started, _)| now.duration_since(*started) < Duration::from_secs(60));
    }
}

pub const BLOCKS_TOPIC: &str = "/tet/v1/blocks";
pub const TXS_TOPIC: &str = "/tet/v1/txs";
pub const AI_WORKLOAD_TOPIC: &str = "/tet/v1/ai-workload";
/// Tmail Basic E2EE gossip plane (spec §A.1). Always subscribed, like blocks/txs.
pub const TMAIL_TOPIC: &str = "/tet/v1/tmail";
#[deprecated(note = "Use sharded /tet/v1/* topics")]
pub const GLOBAL_STATE_TOPIC: &str = "tet-global-state";
pub const DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES: usize = 128 * 1024;

fn global_gossip_max_msg_bytes() -> usize {
    std::env::var("TET_P2P_GOSSIP_MAX_MSG_BYTES")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .map(|n| n.clamp(48 * 1024, 512 * 1024))
        .unwrap_or(DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES)
}

fn split_p2p_peer(mut addr: Multiaddr) -> Option<(Multiaddr, PeerId)> {
    match addr.pop() {
        Some(Protocol::P2p(peer)) => Some((addr, peer)),
        Some(p) => {
            addr.push(p);
            None
        }
        None => None,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn hello_timeout_sec_from_env() -> u64 {
    std::env::var("TET_HELLO_TIMEOUT_SEC")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(10)
}

fn bootnode_redial_sec_from_env() -> u64 {
    std::env::var("TET_BOOTNODE_REDIAL_SEC")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(30)
}

/// Periodic chain_hello resend interval in seconds (Option A). `0` disables resend.
fn chain_hello_interval_sec_from_env() -> u64 {
    std::env::var("TET_CHAIN_HELLO_INTERVAL_SEC")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(15)
}

/// Swarm idle-connection timeout (Fix 1). libp2p 0.55 defaults this to
/// `Duration::ZERO`, which closes a connection the moment no behaviour requests
/// keep-alive — the root cause of the idle isolation bug. `TET_IDLE_TIMEOUT_SEC`
/// overrides it (default 300s, `0` = effectively infinite).
fn idle_timeout_from_env() -> Duration {
    let secs = std::env::var("TET_IDLE_TIMEOUT_SEC")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(300);
    if secs == 0 {
        // "Infinite" without risking timer Instant overflow: ~10 years.
        Duration::from_secs(60 * 60 * 24 * 3650)
    } else {
        Duration::from_secs(secs)
    }
}

/// Periodic Kademlia bootstrap re-trigger interval in seconds (Fix 2).
/// `TET_KAD_BOOTSTRAP_INTERVAL_SEC` (default 60, `0` = disabled). Bootstrap is
/// otherwise only run once at startup, so a node that loses all peers can never
/// recover its routing table ("No known peers"). Re-running is harmless when the
/// table is empty (Kademlia skips internally).
fn kad_bootstrap_interval_sec_from_env() -> u64 {
    std::env::var("TET_KAD_BOOTSTRAP_INTERVAL_SEC")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(60)
}

fn listen_bound_loopback(listen: &Multiaddr) -> bool {
    listen
        .iter()
        .any(|p| matches!(p, Protocol::Ip4(ip) if ip == Ipv4Addr::LOCALHOST))
}

/// When nodes listen on loopback, mDNS often advertises LAN IPs; remap so dials reach the listener.
fn remap_discovered_addr_for_listen(discovered: Multiaddr, listen: &Multiaddr) -> Multiaddr {
    if !listen_bound_loopback(listen) {
        return discovered;
    }
    let mut out = Multiaddr::empty();
    let mut remapped = false;
    for proto in discovered.iter() {
        if matches!(proto, Protocol::Ip4(_)) && !remapped {
            out.push(Protocol::Ip4(Ipv4Addr::LOCALHOST));
            remapped = true;
        } else {
            out.push(proto);
        }
    }
    if remapped { out } else { discovered }
}

fn gossip_mesh_params_from_env() -> (usize, usize, usize) {
    let mesh_n = std::env::var("TET_GOSSIP_MESH_N")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(6);
    let mesh_n_low = std::env::var("TET_GOSSIP_MESH_N_LOW")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(4);
    let mesh_n_high = std::env::var("TET_GOSSIP_MESH_N_HIGH")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(12);
    (mesh_n, mesh_n_low, mesh_n_high)
}

/// Tracks bootnode hello deadlines, dead state, and periodic re-dial (A.4).
#[derive(Debug)]
struct BootnodeWatch {
    bootnode_ids: HashSet<PeerId>,
    bootnode_dial_addrs: HashMap<PeerId, Multiaddr>,
    hello_sent_at: HashMap<PeerId, u64>,
    hello_answered: HashSet<PeerId>,
    dead: HashSet<PeerId>,
    last_redial_at: HashMap<PeerId, u64>,
}

impl BootnodeWatch {
    fn from_env() -> Self {
        let mut bootnode_ids = HashSet::new();
        let mut bootnode_dial_addrs = HashMap::new();
        for raw in crate::vision::fluid_net::bootnode_addrs_from_env() {
            if let Ok(addr) = raw.parse::<Multiaddr>() {
                if let Some((_, pid)) = split_p2p_peer(addr.clone()) {
                    bootnode_ids.insert(pid);
                    bootnode_dial_addrs.insert(pid, addr);
                }
            }
        }
        Self {
            bootnode_ids,
            bootnode_dial_addrs,
            hello_sent_at: HashMap::new(),
            hello_answered: HashSet::new(),
            dead: HashSet::new(),
            last_redial_at: HashMap::new(),
        }
    }

    fn is_bootnode(&self, peer: &PeerId) -> bool {
        self.bootnode_ids.contains(peer)
    }

    fn is_dead(&self, peer: &PeerId) -> bool {
        self.dead.contains(peer)
    }

    fn on_hello_sent(&mut self, peer: PeerId) {
        if self.is_bootnode(&peer) && !self.dead.contains(&peer) {
            self.hello_sent_at.insert(peer, now_ms());
        }
    }

    fn on_hello_received(&mut self, peer: PeerId) {
        if self.is_bootnode(&peer) {
            self.hello_answered.insert(peer);
            self.dead.remove(&peer);
            self.hello_sent_at.remove(&peer);
        }
    }

    fn mark_bootnode_dead(&mut self, peer: PeerId) {
        if self.is_bootnode(&peer) && self.dead.insert(peer) {
            self.hello_sent_at.remove(&peer);
            println!("[P2P-block] ☠️ bootnode dead (no hello within timeout): {peer}");
            log::warn!("[p2p][block] bootnode dead peer_id={peer}");
        }
    }

    async fn request_hello_from_connected_peers(
        swarm: &mut Swarm<TetBehaviour>,
        ledger: &crate::ledger::Ledger,
        exclude: &HashSet<PeerId>,
    ) {
        let Ok(our_hello) = build_chain_hello(ledger) else {
            return;
        };
        let local = *swarm.local_peer_id();
        for peer in swarm.connected_peers().cloned().collect::<Vec<_>>() {
            if peer == local || exclude.contains(&peer) {
                continue;
            }
            swarm
                .behaviour_mut()
                .chain_sync_hello
                .send_request(&peer, our_hello.clone());
            println!("[P2P-block] 👋 fallback chain_hello → {peer} (bootnode recovery)");
        }
    }

    async fn tick(
        &mut self,
        swarm: &mut Swarm<TetBehaviour>,
        listen: &Multiaddr,
        ledger: &crate::ledger::Ledger,
        hello_registry: &SharedHelloRegistry,
        catch_up_driver: &SharedCatchUpDriver,
        block_sync_board: &SharedBlockSyncBoard,
        pending_catch_up_range: &mut HashMap<request_response::OutboundRequestId, PeerId>,
        peer_dial_book: &HashMap<PeerId, Multiaddr>,
        dialing: &mut HashSet<PeerId>,
    ) {
        let now = now_ms();
        let timeout_ms = hello_timeout_sec_from_env().saturating_mul(1000);
        let redial_ms = bootnode_redial_sec_from_env().saturating_mul(1000);

        let mut newly_dead = Vec::new();
        for peer in self.bootnode_ids.clone() {
            if self.dead.contains(&peer) {
                let last = self.last_redial_at.get(&peer).copied().unwrap_or(0);
                let due = now.saturating_sub(last) >= redial_ms;
                // Fix 3: skip if already connected or a dial is in flight, to avoid
                // overlapping dials to the same endpoint (AddrInUse / os error 48).
                let in_flight = swarm.is_connected(&peer) || dialing.contains(&peer);
                if due && !in_flight {
                    if let Some(addr) = self.bootnode_dial_addrs.get(&peer).cloned() {
                        dialing.insert(peer);
                        let _ = swarm.dial(addr);
                        self.last_redial_at.insert(peer, now);
                        println!("[P2P-block] 🔁 bootnode re-dial attempt: {peer}");
                    }
                }
                continue;
            }
            if self.hello_answered.contains(&peer) {
                continue;
            }
            let Some(sent_at) = self.hello_sent_at.get(&peer).copied() else {
                continue;
            };
            if now.saturating_sub(sent_at) >= timeout_ms {
                newly_dead.push(peer);
            }
        }

        let had_newly_dead = !newly_dead.is_empty();
        for peer in newly_dead {
            self.mark_bootnode_dead(peer);
            let _ = swarm.disconnect_peer_id(peer);
            catch_up_driver
                .lock()
                .await
                .blacklist_peer(peer.to_string());
            dialing.remove(&peer);
        }

        if had_newly_dead {
            self.run_bootnode_recovery_fallback(
                swarm,
                listen,
                ledger,
                hello_registry,
                catch_up_driver,
                block_sync_board,
                pending_catch_up_range,
                peer_dial_book,
                dialing,
            )
            .await;
        } else if self.bootnode_ids.iter().any(|p| self.dead.contains(p)) {
            self.dial_known_followers(swarm, listen, peer_dial_book, dialing);
        }
    }

    fn dial_known_followers(
        &self,
        swarm: &mut Swarm<TetBehaviour>,
        listen: &Multiaddr,
        peer_dial_book: &HashMap<PeerId, Multiaddr>,
        dialing: &mut HashSet<PeerId>,
    ) {
        let local = *swarm.local_peer_id();
        for (pid, addr) in peer_dial_book {
            if *pid == local || self.is_bootnode(pid) || self.is_dead(pid) {
                continue;
            }
            if swarm.is_connected(pid) || dialing.contains(pid) {
                continue;
            }
            dialing.insert(*pid);
            let dial = remap_discovered_addr_for_listen(addr.clone(), listen);
            match swarm.dial(dial) {
                Ok(()) => println!("[P2P-block] 🔗 follower re-dial (bootnode recovery): {pid}"),
                Err(e) => println!("[P2P-block] follower re-dial failed {pid}: {e}"),
            }
        }
    }

    async fn run_bootnode_recovery_fallback(
        &self,
        swarm: &mut Swarm<TetBehaviour>,
        listen: &Multiaddr,
        ledger: &crate::ledger::Ledger,
        hello_registry: &SharedHelloRegistry,
        catch_up_driver: &SharedCatchUpDriver,
        block_sync_board: &SharedBlockSyncBoard,
        pending_catch_up_range: &mut HashMap<request_response::OutboundRequestId, PeerId>,
        peer_dial_book: &HashMap<PeerId, Multiaddr>,
        dialing: &mut HashSet<PeerId>,
    ) {
        let exclude = self.dead.clone();
        let local = *swarm.local_peer_id();
        let gossip_peers: Vec<PeerId> = swarm
            .connected_peers()
            .cloned()
            .filter(|p| *p != local && !exclude.contains(p))
            .collect();
        for peer in gossip_peers {
            if bootnode_explicit_peers_enabled() {
                swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer);
            }
        }
        self.dial_known_followers(swarm, listen, peer_dial_book, dialing);
        Self::request_hello_from_connected_peers(swarm, ledger, &exclude).await;
        let local_height = ledger.block_height().unwrap_or(0);
        let mut reg = hello_registry.lock().await;
        if reg.peer_count() == 0 || reg.any_peer_ahead(local_height) {
            reg.force_catch_up_triggered();
        }
        drop(reg);
        try_start_catch_up(
            block_sync_board,
            catch_up_driver,
            hello_registry,
            ledger,
            swarm,
            pending_catch_up_range,
        )
        .await;
    }
}

fn block_sync_behaviour() -> request_response::json::Behaviour<BlockRequest, BlockResponse> {
    request_response::json::Behaviour::new(
        [(
            StreamProtocol::new(BLOCK_SYNC_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(Duration::from_secs(20)),
    )
}

fn chain_sync_hello_behaviour() -> request_response::json::Behaviour<ChainHello, ChainHello> {
    request_response::json::Behaviour::new(
        [(
            StreamProtocol::new(CHAIN_SYNC_HELLO_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(Duration::from_secs(10)),
    )
}

fn tx_submit_behaviour() -> request_response::json::Behaviour<TxSubmitRequest, TxSubmitResponse> {
    request_response::json::Behaviour::new(
        [(
            StreamProtocol::new(ANON_REGISTER_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(Duration::from_secs(10)),
    )
}

fn anon_register_behaviour()
-> request_response::json::Behaviour<AnonRegisterRequest, AnonRegisterResponse> {
    request_response::json::Behaviour::new(
        [(
            StreamProtocol::new(ANON_REGISTER_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(Duration::from_secs(10)),
    )
}

fn anon_receipt_behaviour()
-> request_response::json::Behaviour<AnonReceiptRequest, AnonReceiptResponse> {
    request_response::json::Behaviour::new(
        [(
            StreamProtocol::new(ANON_RECEIPT_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        // Longer than the others: the response is ~350 KB base64 over a possibly slow link.
        request_response::Config::default().with_request_timeout(Duration::from_secs(30)),
    )
}

fn anon_sync_behaviour() -> request_response::json::Behaviour<AnonSyncRequest, AnonSyncResponse> {
    request_response::json::Behaviour::new(
        [(
            StreamProtocol::new(ANON_REGISTRY_SYNC_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(Duration::from_secs(20)),
    )
}

fn chain_sync_range_behaviour()
-> request_response::json::Behaviour<ChainSyncRangeRequest, ChainSyncRangeResponse> {
    request_response::json::Behaviour::new(
        [(
            StreamProtocol::new(CHAIN_SYNC_RANGE_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(Duration::from_secs(10)),
    )
}

fn files_fetch_behaviour()
-> request_response::Behaviour<crate::files::fetch_codec::FilesFetchCodec> {
    request_response::Behaviour::with_codec(
        crate::files::fetch_codec::FilesFetchCodec,
        [(
            StreamProtocol::new(crate::files::FILES_FETCH_PROTOCOL),
            request_response::ProtocolSupport::Full,
        )],
        // Generous timeout: a 5 MiB body over a cross-region link can take a while.
        request_response::Config::default().with_request_timeout(Duration::from_secs(30)),
    )
}

async fn ingest_remote_chain_hello(
    registry: &SharedHelloRegistry,
    ledger: &crate::ledger::Ledger,
    peer: PeerId,
    hello: ChainHello,
    bootnode_watch: Option<&mut BootnodeWatch>,
) {
    if let Some(watch) = bootnode_watch {
        watch.on_hello_received(peer);
    }
    let local_height = ledger.block_height().unwrap_or(0);
    let peer_s = peer.to_string();
    let mut reg = registry.lock().await;
    let record = reg.record_peer_hello(&peer_s, hello, local_height);
    println!(
        "[P2P-block] 🤝 chain_hello from {peer} height={} tip={} local={local_height} diff={} catch_up_pending={}",
        record.hello.block_height,
        record.hello.tip_block_id,
        record.height_diff,
        record.catch_up_pending,
    );
    if record.catch_up_pending {
        println!("[P2P-block] 🔔 catch-up trigger set (peer ahead; B.3b driver pending)");
    }
    let snap = reg.heights_snapshot();
    println!(
        "[P2P-block] sync_hello map peers={} catch_up_triggered={} snapshot={snap:?}",
        reg.peer_count(),
        reg.catch_up_triggered(),
    );
    log::info!(
        "[p2p][block] sync_hello peers={} catch_up_triggered={}",
        reg.peer_count(),
        reg.catch_up_triggered(),
    );
}

async fn run_catch_up_action(
    action: CatchUpAction,
    block_sync_board: &SharedBlockSyncBoard,
    swarm: &mut Swarm<TetBehaviour>,
    hello_registry: &SharedHelloRegistry,
    catch_up_driver: &SharedCatchUpDriver,
    pending_catch_up_range: &mut HashMap<request_response::OutboundRequestId, PeerId>,
) {
    match action {
        CatchUpAction::None => {}
        CatchUpAction::ClearCatchUpTriggered => {
            hello_registry.lock().await.clear_catch_up_triggered();
            set_in_progress_range(block_sync_board, None).await;
            println!("[P2P-block] ✅ catch-up complete; catch_up_triggered=false");
            log::info!("[p2p][block] catch-up complete");
        }
        CatchUpAction::SendRangeRequest { peer_id, request } => {
            let Ok(pid) = peer_id.parse::<PeerId>() else {
                log::warn!("[p2p][block] catch-up invalid peer_id={peer_id}");
                catch_up_driver.lock().await.blacklist_peer(peer_id);
                return;
            };
            set_in_progress_range(
                block_sync_board,
                Some(InProgressRangeRequest {
                    peer_id: peer_id.clone(),
                    from_height: request.from_height,
                    to_height: request.to_height,
                }),
            )
            .await;
            let rid = swarm
                .behaviour_mut()
                .chain_sync_range
                .send_request(&pid, request.clone());
            pending_catch_up_range.insert(rid, pid);
            println!(
                "[P2P-block] 📥 catch-up range → {peer_id} heights {}..{}",
                request.from_height, request.to_height
            );
        }
    }
}

async fn try_start_catch_up(
    block_sync_board: &SharedBlockSyncBoard,
    catch_up_driver: &SharedCatchUpDriver,
    hello_registry: &SharedHelloRegistry,
    ledger: &crate::ledger::Ledger,
    swarm: &mut Swarm<TetBehaviour>,
    pending_catch_up_range: &mut HashMap<request_response::OutboundRequestId, PeerId>,
) {
    let local_height = ledger.block_height().unwrap_or(0);
    let action = {
        let mut driver = catch_up_driver.lock().await;
        if !driver.is_idle() {
            return;
        }
        let reg = hello_registry.lock().await;
        if !reg.catch_up_triggered() {
            return;
        }
        driver.handle(CatchUpDriverEvent::Triggered, &reg, local_height)
    };
    run_catch_up_action(
        action,
        block_sync_board,
        swarm,
        hello_registry,
        catch_up_driver,
        pending_catch_up_range,
    )
    .await;
}

async fn apply_catch_up_blocks(
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    blocks: Vec<crate::ledger::BlockRecordV1>,
) -> (usize, bool) {
    let mut applied = 0usize;
    for block in blocks {
        let height = block.height;
        let block_id = block.block_id.clone();
        let gossip = block_record_to_remote_gossip(&block);
        match crate::consensus::apply_remote_block_from_gossip(
            ledger.clone(),
            mempool.clone(),
            gossip,
        )
        .await
        {
            Ok(crate::consensus::RemoteBlockApplyOutcome::Applied { block_height, .. }) => {
                applied += 1;
                println!(
                    "[P2P-block] ✅ catch-up applied height={} block_id={block_id}",
                    block_height
                );
            }
            Ok(crate::consensus::RemoteBlockApplyOutcome::Skipped { reason }) => {
                if reason.contains("missing previous blocks") {
                    println!(
                        "[P2P-block] ❌ catch-up apply gap height={height} block_id={block_id}: {reason}"
                    );
                    return (applied, true);
                }
                println!(
                    "[P2P-block] ⏭️ catch-up apply skipped height={height} block_id={block_id}: {reason}"
                );
            }
            Ok(other) => {
                println!(
                    "[P2P-block] ⚠️ catch-up apply outcome height={height} block_id={block_id}: {other:?}"
                );
            }
            Err(e) => {
                println!(
                    "[P2P-block] ❌ catch-up apply rejected height={height} block_id={block_id}: {}",
                    e.message()
                );
                return (applied, true);
            }
        }
    }
    (applied, false)
}

async fn on_catch_up_range_response(
    peer: PeerId,
    response: ChainSyncRangeResponse,
    block_sync_board: &SharedBlockSyncBoard,
    catch_up_driver: &SharedCatchUpDriver,
    hello_registry: &SharedHelloRegistry,
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    swarm: &mut Swarm<TetBehaviour>,
    pending_catch_up_range: &mut HashMap<request_response::OutboundRequestId, PeerId>,
) {
    let peer_s = peer.to_string();
    println!(
        "[P2P-block] 📦 catch-up range from {peer} blocks={} to_height={}",
        response.blocks.len(),
        response.to_height
    );

    if response.blocks.is_empty() {
        set_in_progress_range(block_sync_board, None).await;
        let action = {
            let mut driver = catch_up_driver.lock().await;
            let reg = hello_registry.lock().await;
            let local_height = ledger.block_height().unwrap_or(0);
            driver.handle(
                CatchUpDriverEvent::RangeFailed {
                    peer_id: peer_s,
                    reason: "empty range response".into(),
                },
                &reg,
                local_height,
            )
        };
        run_catch_up_action(
            action,
            block_sync_board,
            swarm,
            hello_registry,
            catch_up_driver,
            pending_catch_up_range,
        )
        .await;
        return;
    }

    let (applied, failed) = apply_catch_up_blocks(ledger.clone(), mempool, response.blocks).await;
    set_in_progress_range(block_sync_board, None).await;
    let local_height = ledger.block_height().unwrap_or(0);
    let action = {
        let mut driver = catch_up_driver.lock().await;
        let reg = hello_registry.lock().await;
        driver.handle(
            CatchUpDriverEvent::BatchApplied {
                peer_id: peer_s,
                applied,
                failed,
            },
            &reg,
            local_height,
        )
    };
    run_catch_up_action(
        action,
        block_sync_board,
        swarm,
        hello_registry,
        catch_up_driver,
        pending_catch_up_range,
    )
    .await;
}

async fn on_catch_up_range_failed(
    peer: PeerId,
    reason: String,
    block_sync_board: &SharedBlockSyncBoard,
    catch_up_driver: &SharedCatchUpDriver,
    hello_registry: &SharedHelloRegistry,
    ledger: &crate::ledger::Ledger,
    swarm: &mut Swarm<TetBehaviour>,
    pending_catch_up_range: &mut HashMap<request_response::OutboundRequestId, PeerId>,
) {
    set_in_progress_range(block_sync_board, None).await;
    let local_height = ledger.block_height().unwrap_or(0);
    let action = {
        let mut driver = catch_up_driver.lock().await;
        let reg = hello_registry.lock().await;
        driver.handle(
            CatchUpDriverEvent::RangeFailed {
                peer_id: peer.to_string(),
                reason,
            },
            &reg,
            local_height,
        )
    };
    run_catch_up_action(
        action,
        block_sync_board,
        swarm,
        hello_registry,
        catch_up_driver,
        pending_catch_up_range,
    )
    .await;
}

pub fn parse_block_listen_multiaddr(listen: &str) -> Result<Multiaddr, AnyErr> {
    listen
        .trim()
        .parse::<Multiaddr>()
        .map_err(|e| -> AnyErr { format!("invalid block listen multiaddr {listen:?}: {e}").into() })
}

fn orphan_buffer_from_env() -> OrphanBuffer {
    let max_orphans = std::env::var("TET_P2P_MAX_ORPHANS")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_MAX_ORPHANS);
    let ttl_ms = std::env::var("TET_P2P_ORPHAN_TTL_MS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_ORPHAN_TTL_MS);
    OrphanBuffer::new(max_orphans, ttl_ms)
}

fn max_backfill_depth_from_env() -> usize {
    std::env::var("TET_P2P_MAX_BACKFILL_DEPTH")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_MAX_BACKFILL_DEPTH)
        .max(1)
}

fn local_node_wants_ai_workload() -> bool {
    crate::vision::caac::profile().role == crate::vision::caac::NodeRelayRole::Poc
}

/// Result of admitting a gossiped transaction. Returned rather than logged so the admission
/// rules can be tested without a swarm.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TxGossipOutcome {
    Enqueued { tx_hash: String, mempool_len: usize },
    AlreadyQueued { tx_hash: String },
    AlreadyApplied { tx_hash: String },
    Rejected { reason: String },
}

/// Admit a transaction learned from a peer into the local mempool.
///
/// **A gossiped tx is never trusted more than a REST-submitted one.** Every check the REST
/// submit path runs, runs here, in the same order:
///
/// 1. `tx_hash_for_env` — which calls `verify_envelope_v1`, so this covers envelope version,
///    the hybrid Ed25519 + ML-DSA signatures, and the chain binding (chain id + genesis hash in
///    the signed preimage). A tx signed against a different genesis cannot enter this mempool.
/// 2. `is_tx_applied` — a tx already mined into a block is dropped rather than re-queued. The
///    REST path has always checked this; the gossip path did not, so a peer replaying an old
///    envelope could park a dead tx in every mempool on the network until a miner discarded it.
/// 3. mempool duplicate check.
/// 4. `enqueue_without_broadcast` — the byte/count caps and lowest-fee eviction. The previous
///    called `mp.push()` directly and bypassed all of it, which let a peer grow this node's
///    mempool without bound.
///
/// This never mutates the ledger and never re-publishes: a tx received here is not added to
/// `pending_rebroadcast`, so it is forwarded onward only by gossipsub's own mesh propagation,
/// never amplified by us.
pub(crate) async fn handle_tx_broadcast(
    ledger: &Arc<crate::ledger::Ledger>,
    mempool: &Arc<tokio::sync::Mutex<Vec<crate::protocol::SignedTxEnvelopeV1>>>,
    env: crate::protocol::SignedTxEnvelopeV1,
) -> TxGossipOutcome {
    let tx_hash = match crate::consensus::tx_hash_for_env(&env) {
        Ok(h) => h,
        Err(e) => {
            return TxGossipOutcome::Rejected {
                reason: format!("bad signature: {e}"),
            };
        }
    };

    if ledger.is_tx_applied(&tx_hash).unwrap_or(false) {
        return TxGossipOutcome::AlreadyApplied { tx_hash };
    }

    {
        let mp = mempool.lock().await;
        if mp.iter().any(|e| {
            crate::consensus::tx_hash_for_env(e)
                .map(|h| h == tx_hash)
                .unwrap_or(false)
        }) {
            return TxGossipOutcome::AlreadyQueued { tx_hash };
        }
    }

    match crate::rest::state::enqueue_without_broadcast(mempool, env).await {
        Ok(_evicted) => {
            let mempool_len = mempool.lock().await.len();
            TxGossipOutcome::Enqueued {
                tx_hash,
                mempool_len,
            }
        }
        Err(e) => TxGossipOutcome::Rejected {
            reason: format!("mempool admission: {e}"),
        },
    }
}

/// Result of handling a Tmail gossip event. Returned rather than logged so the receive path can be
/// driven from a test without a swarm — the same reason [`TxGossipOutcome`] exists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TmailGossipOutcome {
    Stored { msg_id: String },
    Duplicate { msg_id: String },
    Burned { msg_id: String },
    AlreadyBurned { msg_id: String },
    UnknownBurnTarget { msg_id: String },
    /// An anonymity-set registration was admitted (or was already known).
    Registered { wallet_id: String, outcome: String },
    Rejected { reason: String },
}

/// Admit a registration learned from anywhere (gossip, direct request, or local REST).
///
/// **The single verification point.** The local path and both receive paths call this, so a
/// registration can never be admitted on weaker terms because it arrived a different way — the
/// mistake `handle_tx_broadcast` was written to fix, applied before it can happen here.
pub(crate) fn admit_anon_registration(
    tmail_store: &Arc<crate::tmail::store::TmailStore>,
    registration: &crate::tmail::anon::TmailAnonRegistrationV1,
) -> Result<crate::tmail::store::AnonRegisterOutcome, String> {
    crate::tmail::anon::verify_tmail_anon_registration_v1(registration)
        .map_err(|e| format!("registration: {e}"))?;
    tmail_store
        .register_anon(registration)
        .map_err(|e| format!("registry: {e}"))
}

/// Handle a Tmail-plane event learned from a peer: an envelope to buffer, or a burn revoke to
/// apply (spec §A.1, §A.3.2).
///
/// **This is the whole receive path.** The swarm arm does nothing but call this and log the
/// outcome, so a test that drives this function covers the same code the network does — which is
/// the point. A guard that reimplemented the dispatch instead would be testing itself.
///
/// Neither branch re-broadcasts: an event received here is forwarded onward only by gossipsub's
/// own mesh propagation, never amplified by us. Neither branch touches the ledger.
pub(crate) fn handle_tmail_network_event(
    tmail_store: &Arc<crate::tmail::store::TmailStore>,
    event: &crate::models::NetworkEvent,
) -> TmailGossipOutcome {
    match event {
        crate::models::NetworkEvent::TmailGossip { envelope } => {
            if let Err(e) = crate::tmail::envelope::verify_tmail_envelope_v1(envelope) {
                return TmailGossipOutcome::Rejected {
                    reason: format!("envelope: {e}"),
                };
            }
            match tmail_store.store_tmail(envelope) {
                Ok(true) => TmailGossipOutcome::Stored {
                    msg_id: envelope.msg_id.clone(),
                },
                // Also the burned case: a tombstoned msg_id is refused here, which is what stops a
                // re-gossiped envelope from undoing a burn.
                Ok(false) => TmailGossipOutcome::Duplicate {
                    msg_id: envelope.msg_id.clone(),
                },
                Err(e) => TmailGossipOutcome::Rejected {
                    reason: format!("store: {e}"),
                },
            }
        }
        crate::models::NetworkEvent::TmailAnonRegistration { registration } => {
            match admit_anon_registration(tmail_store, registration) {
                Ok(outcome) => TmailGossipOutcome::Registered {
                    wallet_id: registration.wallet_id.clone(),
                    outcome: format!("{outcome:?}"),
                },
                Err(reason) => TmailGossipOutcome::Rejected { reason },
            }
        }
        crate::models::NetworkEvent::TmailBurnRevoke { revoke } => {
            match crate::tmail::burn::apply_burn_revoke(tmail_store, revoke) {
                Ok(crate::tmail::burn::BurnRevokeOutcome::Burned { msg_id }) => {
                    crate::metrics::inc_tmail_burned();
                    TmailGossipOutcome::Burned { msg_id }
                }
                Ok(crate::tmail::burn::BurnRevokeOutcome::AlreadyBurned { msg_id }) => {
                    TmailGossipOutcome::AlreadyBurned { msg_id }
                }
                Ok(crate::tmail::burn::BurnRevokeOutcome::UnknownMessage { msg_id }) => {
                    TmailGossipOutcome::UnknownBurnTarget { msg_id }
                }
                Err(e) => TmailGossipOutcome::Rejected {
                    reason: format!("burn revoke: {e}"),
                },
            }
        }
        other => TmailGossipOutcome::Rejected {
            reason: format!("not a tmail event: {other:?}"),
        },
    }
}

/// Whether a bootnode is registered as a gossipsub **explicit peer** (`TET_GOSSIP_BOOTNODE_EXPLICIT`,
/// default on — the historical behaviour).
///
/// Explicit peers are a mesh *bypass* for trusted relays: gossipsub sends them everything directly
/// and, crucially, `get_random_peers` excludes them, so they can never be grafted into the mesh.
/// On a node whose only peer is its bootnode that leaves the mesh permanently empty — which is
/// exactly what the public seed's followers show. Set to `0` to dial bootnodes as ordinary peers
/// so they are eligible for the mesh.
fn bootnode_explicit_peers_enabled() -> bool {
    std::env::var("TET_GOSSIP_BOOTNODE_EXPLICIT")
        .ok()
        .as_deref()
        .map(|v| !(v == "0" || v.eq_ignore_ascii_case("false")))
        .unwrap_or(true)
}

/// How often to check whether peers still show us their topic subscriptions
/// (`TET_GOSSIP_RESUBSCRIBE_SEC`, default 30; `0` disables the check).
fn gossip_resubscribe_interval_sec() -> u64 {
    std::env::var("TET_GOSSIP_RESUBSCRIBE_SEC")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(30)
}

fn network_event_topics(
    msg: &str,
    blocks_topic: &gossipsub::IdentTopic,
    txs_topic: &gossipsub::IdentTopic,
    ai_topic: &gossipsub::IdentTopic,
    tmail_topic: &gossipsub::IdentTopic,
    files_topic: &gossipsub::IdentTopic,
) -> Vec<gossipsub::IdentTopic> {
    match serde_json::from_str::<NetworkEvent>(msg) {
        Ok(NetworkEvent::BlockMined { txs, .. }) => {
            let mut topics = vec![blocks_topic.clone()];
            if txs
                .iter()
                .any(|env| matches!(env.tx, crate::protocol::TxV1::EnterpriseInference { .. }))
            {
                topics.push(ai_topic.clone());
            }
            topics
        }
        Ok(NetworkEvent::TmailGossip { .. })
        | Ok(NetworkEvent::TmailBurnRevoke { .. })
        | Ok(NetworkEvent::TmailAnonRegistration { .. }) => {
            vec![tmail_topic.clone()]
        }
        Ok(NetworkEvent::FileAnnounce { .. }) => {
            vec![files_topic.clone()]
        }
        Ok(NetworkEvent::TransferExecuted { .. })
        | Ok(NetworkEvent::FaucetExecuted { .. })
        | Ok(NetworkEvent::TxBroadcast { .. }) => {
            vec![txs_topic.clone()]
        }
        Err(_) => vec![txs_topic.clone()],
    }
}

/// Node-local map from block `producer_id` to the libp2p `PeerId` allowed to publish its blocks,
/// from `TET_PRODUCER_PEERS="<producer_id>=<PeerId>,…"`. Empty when unset: no check, as before.
///
/// This is a mitigation, not a signature. Blocks carry no producer signature yet (that is the Phase 1
/// header change); what gossipsub does authenticate, in `ValidationMode::Strict`, is the message
/// author. Relays forward the author's signed message unchanged, so a block relayed by another seed
/// still names the producer's PeerId as its source.
#[derive(Debug, Clone, Default)]
pub(crate) struct ProducerPeers(std::collections::HashMap<String, PeerId>);

impl ProducerPeers {
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        let mut map = std::collections::HashMap::new();
        for entry in raw.split(',').map(str::trim).filter(|e| !e.is_empty()) {
            let (id, peer) = entry
                .split_once('=')
                .ok_or_else(|| format!("TET_PRODUCER_PEERS entry {entry:?} is not <producer_id>=<PeerId>"))?;
            let id = id.trim().to_ascii_lowercase();
            if id.is_empty() {
                return Err(format!("TET_PRODUCER_PEERS entry {entry:?} has an empty producer_id"));
            }
            let peer: PeerId = peer
                .trim()
                .parse()
                .map_err(|e| format!("TET_PRODUCER_PEERS entry {entry:?}: bad PeerId: {e}"))?;
            if map.insert(id.clone(), peer).is_some() {
                return Err(format!("TET_PRODUCER_PEERS names producer {id:?} twice"));
            }
        }
        Ok(Self(map))
    }

    pub(crate) fn from_env() -> Result<Self, String> {
        Self::parse(&std::env::var("TET_PRODUCER_PEERS").unwrap_or_default())
    }

    /// May this gossip `source` publish a block naming `producer_id`? `Ok` when no map is configured.
    /// Once one is, an unmapped producer, a missing source or a different source are all refused.
    pub(crate) fn check_block_source(&self, producer_id: &str, source: Option<&PeerId>) -> Result<(), String> {
        if self.0.is_empty() {
            return Ok(());
        }
        let id = producer_id.trim().to_ascii_lowercase();
        let Some(expected) = self.0.get(&id) else {
            return Err(format!("producer {id:?} has no configured PeerId"));
        };
        match source {
            Some(src) if src == expected => Ok(()),
            Some(src) => Err(format!("block for producer {id:?} published by {src}, expected {expected}")),
            None => Err(format!("block for producer {id:?} has no gossip source")),
        }
    }
}

/// Gossip validation verdict for a decoded event. Legacy balance events carry no signature and
/// are never applied, so they are rejected: the mesh stops forwarding them and the publisher's
/// peer score drops. Everything else is accepted here and checked by its own handler.
pub(crate) fn gossip_event_acceptance(
    event: &NetworkEvent,
    source: Option<&PeerId>,
    producer_peers: &ProducerPeers,
) -> gossipsub::MessageAcceptance {
    match event {
        NetworkEvent::TransferExecuted { .. } | NetworkEvent::FaucetExecuted { .. } => {
            gossipsub::MessageAcceptance::Reject
        }
        NetworkEvent::BlockMined { producer_id, .. }
            if producer_peers.check_block_source(producer_id, source).is_err() =>
        {
            gossipsub::MessageAcceptance::Reject
        }
        _ => gossipsub::MessageAcceptance::Accept,
    }
}

/// Offload a heavy, read-only [`build_chain_hello`] (full O(N) balance scan for the state root) onto a
/// blocking thread so it never stalls the swarm event loop (root cause of the 2026-06 wedges).
async fn build_chain_hello_offloaded(
    ledger: &Arc<crate::ledger::Ledger>,
) -> Result<ChainHello, crate::ledger::LedgerError> {
    let ledger = ledger.clone();
    match tokio::task::spawn_blocking(move || build_chain_hello(ledger.as_ref())).await {
        Ok(res) => res,
        Err(join) => Err(crate::ledger::LedgerError::Invalid(format!(
            "chain_hello blocking task failed: {join}"
        ))),
    }
}

/// Like [`build_chain_hello_offloaded`] but always yields a [`ChainHello`], applying the same
/// best-effort fallback the inline responder used — and crucially running the fallback's
/// `compute_state_root` (also O(N)) on the blocking pool too.
async fn build_chain_hello_resilient(ledger: &Arc<crate::ledger::Ledger>) -> ChainHello {
    let ledger = ledger.clone();
    tokio::task::spawn_blocking(move || {
        build_chain_hello(ledger.as_ref()).unwrap_or_else(|e| {
            log::warn!("[p2p][chain-sync] hello build failed: {e}");
            ChainHello {
                chain_id: crate::ledger::chain_id_from_env(),
                block_height: ledger.block_height().unwrap_or(0),
                tip_block_id: String::new(),
                state_root: ledger
                        .compute_state_root()
                        .unwrap_or_else(|_| crate::ledger::Ledger::STATE_ROOT_UNAVAILABLE.to_string()),
            }
        })
    })
    .await
    .unwrap_or_else(|join| {
        log::warn!("[p2p][chain-sync] hello task panicked: {join}");
        ChainHello {
            chain_id: crate::ledger::chain_id_from_env(),
            block_height: 0,
            tip_block_id: String::new(),
            state_root: String::new(),
        }
    })
}

/// Offload the heavy, read-only [`build_chain_sync_range_response`] (reads/decrypts up to 100 blocks)
/// onto a blocking thread so the swarm loop keeps accepting connections while it runs.
async fn build_chain_sync_range_response_offloaded(
    ledger: &Arc<crate::ledger::Ledger>,
    request: &ChainSyncRangeRequest,
) -> Option<ChainSyncRangeResponse> {
    let ledger = ledger.clone();
    let request = request.clone();
    match tokio::task::spawn_blocking(move || {
        build_chain_sync_range_response(ledger.as_ref(), &request)
    })
    .await
    {
        Ok(resp) => Some(resp),
        Err(join) => {
            log::warn!("[p2p][chain-sync] range build task failed: {join}");
            None
        }
    }
}

/// Offload a single read-only block lookup ([`Ledger::block_record_by_id`]) onto a blocking thread.
async fn block_record_by_id_offloaded(
    ledger: &Arc<crate::ledger::Ledger>,
    block_id: String,
) -> Option<crate::ledger::BlockRecordV1> {
    let ledger = ledger.clone();
    tokio::task::spawn_blocking(move || ledger.block_record_by_id(&block_id).ok().flatten())
        .await
        .unwrap_or(None)
}

/// Handles returned by [`start_mdns_ping_swarm`]: gossip publish channel, files-fetch command
/// channel (`/tet/v1/files/fetch`), and the swarm task join handle.
pub type BlockSwarmHandles = (
    mpsc::Sender<String>,
    mpsc::Sender<FilesFetchCmd>,
    mpsc::Sender<TxSubmitCmd>,
    mpsc::Sender<AnonRegisterCmd>,
    tokio::task::JoinHandle<()>,
);

/// Start a libp2p swarm task and return a Sender you can use to publish gossip messages.
#[allow(clippy::too_many_arguments)]
pub fn start_mdns_ping_swarm(
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    keypair: identity::Keypair,
    listen: Multiaddr,
    hello_registry: SharedHelloRegistry,
    catch_up_driver: SharedCatchUpDriver,
    block_sync_board: SharedBlockSyncBoard,
    tmail_store: Arc<crate::tmail::store::TmailStore>,
    file_store: Arc<crate::files::storage::FileStore>,
    swarm_health: crate::swarm_health::SharedSwarmHealth,
) -> Result<BlockSwarmHandles, AnyErr> {
    let (tx, rx) = mpsc::channel::<String>(256);
    let (files_fetch_tx, files_fetch_rx) = mpsc::channel::<FilesFetchCmd>(32);
    let (tx_submit_tx, tx_submit_rx) = mpsc::channel::<TxSubmitCmd>(256);
    let (anon_register_tx, anon_register_rx) = mpsc::channel::<AnonRegisterCmd>(128);
    let join = tokio::spawn(async move {
        if let Err(e) = run_mdns_ping_swarm(
            ledger,
            mempool,
            rx,
            files_fetch_rx,
            tx_submit_rx,
            anon_register_rx,
            keypair,
            listen,
            hello_registry,
            catch_up_driver,
            block_sync_board,
            tmail_store,
            file_store,
            swarm_health,
        )
        .await
        {
            println!("[P2P] Swarm task exited: {e}");
            log::warn!("[p2p][mdns] swarm exited: {e}");
        }
    });
    Ok((tx, files_fetch_tx, tx_submit_tx, anon_register_tx, join))
}

/// Run the block-plane libp2p swarm (gossip + chain-sync RPC).
/// Listens on `listen` (typically `TET_P2P_LISTEN` from `main.rs`).
#[allow(clippy::too_many_arguments)]
async fn run_mdns_ping_swarm(
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    mut publish_rx: mpsc::Receiver<String>,
    mut files_fetch_rx: mpsc::Receiver<FilesFetchCmd>,
    mut tx_submit_rx: mpsc::Receiver<TxSubmitCmd>,
    mut anon_register_rx: mpsc::Receiver<AnonRegisterCmd>,
    keypair: identity::Keypair,
    listen: Multiaddr,
    hello_registry: SharedHelloRegistry,
    catch_up_driver: SharedCatchUpDriver,
    block_sync_board: SharedBlockSyncBoard,
    tmail_store: Arc<crate::tmail::store::TmailStore>,
    file_store: Arc<crate::files::storage::FileStore>,
    swarm_health: crate::swarm_health::SharedSwarmHealth,
) -> Result<(), AnyErr> {
    let peer_id = PeerId::from(keypair.public());
    log::info!("[P2P] My Peer ID: {peer_id}");

    let transport = tcp::tokio::Transport::new(tcp::Config::default().nodelay(true))
        .upgrade(upgrade::Version::V1)
        .authenticate(noise::Config::new(&keypair)?)
        .multiplex(yamux::Config::default())
        .timeout(Duration::from_secs(20))
        .boxed();

    let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), peer_id)?;
    let ping = ping::Behaviour::new(
        ping::Config::new()
            .with_interval(Duration::from_secs(10))
            .with_timeout(Duration::from_secs(20)),
    );

    let max_gossip_bytes = global_gossip_max_msg_bytes();
    // A malformed map is a startup error rather than a silently disabled check.
    let producer_peers = ProducerPeers::from_env().unwrap_or_else(|e| panic!("[p2p] FATAL: {e}"));
    if !producer_peers.0.is_empty() {
        println!("[P2P] block source check ON for {} producer(s)", producer_peers.0.len());
    }
    let (mesh_n, mesh_n_low, mesh_n_high) = gossip_mesh_params_from_env();
    let mesh_outbound_min = (mesh_n / 2).max(1).min(mesh_n_low);
    let gossipsub_config = gossipsub::ConfigBuilder::default()
        .validation_mode(gossipsub::ValidationMode::Strict)
        .validate_messages()
        .max_transmit_size(max_gossip_bytes)
        .mesh_outbound_min(mesh_outbound_min)
        .mesh_n(mesh_n)
        .mesh_n_low(mesh_n_low)
        .mesh_n_high(mesh_n_high)
        .heartbeat_interval(Duration::from_millis(800))
        // Was `max_messages_per_rpc(Some(32))`, removed in gossipsub 0.50 — see p2p_network.rs.
        .max_publish_messages(32)
        .build()
        .map_err(|e| -> AnyErr { format!("gossipsub config: {e}").into() })?;
    let mut gossipsub = gossipsub::Behaviour::new(
        gossipsub::MessageAuthenticity::Signed(keypair.clone()),
        gossipsub_config,
    )
    .map_err(|e| -> AnyErr { format!("gossipsub init: {e}").into() })?;
    let mut score_params = gossipsub::PeerScoreParams::default();
    let topic_scoring = gossipsub::TopicScoreParams {
        topic_weight: 1.0,
        invalid_message_deliveries_weight: -22.0,
        invalid_message_deliveries_decay: 0.88,
        ..Default::default()
    };
    for topic in [
        BLOCKS_TOPIC,
        TXS_TOPIC,
        AI_WORKLOAD_TOPIC,
        TMAIL_TOPIC,
        crate::files::FILES_ANNOUNCE_TOPIC,
    ] {
        score_params.topics.insert(
            gossipsub::IdentTopic::new(topic).hash(),
            topic_scoring.clone(),
        );
    }
    score_params.app_specific_weight = 12.0;
    score_params.behaviour_penalty_weight = -10.0;
    score_params.behaviour_penalty_threshold = 1.0;
    let score_thresholds = gossipsub::PeerScoreThresholds {
        gossip_threshold: -6.0,
        publish_threshold: -45.0,
        graylist_threshold: -62.0,
        ..Default::default()
    };
    score_params
        .validate()
        .map_err(|e| -> AnyErr { format!("gossipsub peer score params: {e}").into() })?;
    score_thresholds
        .validate()
        .map_err(|e| -> AnyErr { format!("gossipsub peer score thresholds: {e}").into() })?;
    gossipsub
        .with_peer_score(score_params, score_thresholds)
        .map_err(|e| -> AnyErr { format!("gossipsub peer score init failed: {e:?}").into() })?;

    let identify = identify::Behaviour::new(
        identify::Config::new("/tet/identify/1.0.0".to_string(), keypair.public())
            .with_agent_version(format!("tet-core/{}", env!("CARGO_PKG_VERSION"))),
    );

    let store = kad::store::MemoryStore::new(peer_id);
    let mut kademlia = kad::Behaviour::new(peer_id, store);
    kademlia.set_mode(Some(kad::Mode::Server));

    let behaviour = TetBehaviour {
        mdns,
        ping,
        gossipsub,
        identify,
        kademlia,
        block_sync: block_sync_behaviour(),
        chain_sync_hello: chain_sync_hello_behaviour(),
        chain_sync_range: chain_sync_range_behaviour(),
        files_fetch: files_fetch_behaviour(),
        tx_submit: tx_submit_behaviour(),
        anon_register: anon_register_behaviour(),
        anon_receipt: anon_receipt_behaviour(),
        anon_sync: anon_sync_behaviour(),
    };
    let idle_timeout = idle_timeout_from_env();
    let mut swarm = Swarm::new(
        transport,
        behaviour,
        peer_id,
        libp2p::swarm::Config::with_tokio_executor()
            .with_idle_connection_timeout(idle_timeout),
    );
    println!("[P2P-block] idle_connection_timeout set to {idle_timeout:?}");

    println!("[P2P] My Peer ID: {}", swarm.local_peer_id());
    log::info!("[P2P] My Peer ID: {}", swarm.local_peer_id());

    let blocks_topic = gossipsub::IdentTopic::new(BLOCKS_TOPIC);
    let txs_topic = gossipsub::IdentTopic::new(TXS_TOPIC);
    let ai_workload_topic = gossipsub::IdentTopic::new(AI_WORKLOAD_TOPIC);
    let tmail_topic = gossipsub::IdentTopic::new(TMAIL_TOPIC);
    let files_announce_topic = gossipsub::IdentTopic::new(crate::files::FILES_ANNOUNCE_TOPIC);
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&blocks_topic)
        .expect("Failed to subscribe to blocks topic");
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&txs_topic)
        .expect("Failed to subscribe to txs topic");
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&tmail_topic)
        .expect("Failed to subscribe to tmail topic");
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&files_announce_topic)
        .expect("Failed to subscribe to files announce topic");
    let wants_ai_workload = local_node_wants_ai_workload();
    let ai_workload_topic_hash = ai_workload_topic.hash();
    if wants_ai_workload {
        swarm
            .behaviour_mut()
            .gossipsub
            .subscribe(&ai_workload_topic)
            .expect("Failed to subscribe to ai-workload topic");
        println!("[P2P] Subscribed to AI workload topic as PoC");
    } else {
        println!("[P2P] PoR mode: not subscribing to AI workload topic");
    }
    println!("[P2P] Subscribed to sharded topics: {BLOCKS_TOPIC}, {TXS_TOPIC}, {TMAIL_TOPIC}");

    if let Ok(external) = std::env::var("TET_EXTERNAL_ADDR")
        && !external.trim().is_empty()
    {
        match external.trim().parse::<Multiaddr>() {
            Ok(addr) => {
                swarm.add_external_address(addr.clone());
                println!("[P2P] Advertising external address: {addr}");
            }
            Err(e) => println!("[P2P] Invalid TET_EXTERNAL_ADDR ignored: {external} ({e})"),
        }
    }

    // Who to send a direct `tx_submit` to. Bootnodes are the nodes a follower has been told to
    // trust enough to sync from, which makes them the right default target for its own txs.
    let mut bootnode_peer_ids: std::collections::HashSet<PeerId> = std::collections::HashSet::new();
    let mut tx_submit_limiter = TxSubmitRateLimiter::default();
    let tx_submit_rps = tx_submit_rps_from_env();
    let mut anon_sync_limiter = TxSubmitRateLimiter::default();
    let anon_sync_rps = anon_sync_rps_from_env();
    let anon_sync_budget = anon_sync_verify_budget();
    let mut anon_sync_spent: std::collections::HashMap<PeerId, Duration> =
        std::collections::HashMap::new();
    // Where an interrupted round stopped, so the next one resumes instead of re-verifying the
    // prefix it already admitted. Cleared on completion, so the round after a completed one starts
    // from the beginning and picks up registrations that sort before the cursor.
    let mut anon_sync_resume: std::collections::HashMap<PeerId, String> =
        std::collections::HashMap::new();
    let mut anon_sync_pages: std::collections::HashMap<PeerId, u32> =
        std::collections::HashMap::new();
    let mut anon_sync_ticker = tokio::time::interval(Duration::from_secs(
        std::env::var("TET_ANON_SYNC_INTERVAL_SEC")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(ANON_SYNC_INTERVAL_SEC),
    ));
    let mut anon_register_limiter = TxSubmitRateLimiter::default();
    let anon_register_rps = anon_register_rps_from_env();
    let mut anon_register_closed = false;

    let bootnodes = crate::vision::fluid_net::bootnode_addrs_from_env();
    if !bootnodes.is_empty() {
        println!(
            "[P2P] Found TET_BOOTNODES/BOOTNODES: {} entries",
            bootnodes.len()
        );
        for raw in bootnodes {
            match raw.parse::<Multiaddr>() {
                Ok(addr) => {
                    if let Some((dial_addr, pid)) = split_p2p_peer(addr.clone()) {
                        swarm
                            .behaviour_mut()
                            .kademlia
                            .add_address(&pid, dial_addr.clone());
                        if bootnode_explicit_peers_enabled() {
                            swarm.behaviour_mut().gossipsub.add_explicit_peer(&pid);
                        }
                        bootnode_peer_ids.insert(pid);
                        println!("[P2P] Bootnode added to Kademlia: peer={pid} addr={dial_addr}");
                    }
                    match swarm.dial(addr.clone()) {
                        Ok(()) => println!("[P2P] Dialing bootnode: {addr}"),
                        Err(e) => println!("[P2P] Bootnode dial failed: {addr} ({e})"),
                    }
                }
                Err(e) => println!("[P2P] Invalid bootnode ignored: {raw} ({e})"),
            }
        }
        if let Err(e) = swarm.behaviour_mut().kademlia.bootstrap() {
            println!("[P2P] ❌ Kademlia bootstrap failed: {:?}", e);
        } else {
            println!("[P2P] ✅ Kademlia bootstrap started");
        }
    } else {
        println!("[P2P] No TET_BOOTNODES provided. Running as an isolated node.");
    }

    swarm.listen_on(listen.clone())?;
    println!("[P2P-block] binding block swarm to {listen}");
    log::info!("[p2p][block] binding listen={listen}");

    let mut dialing: HashSet<PeerId> = HashSet::new();
    let mut peer_dial_book: HashMap<PeerId, Multiaddr> = HashMap::new();
    let mut bootnode_watch = BootnodeWatch::from_env();
    let mut orphan_buffer = orphan_buffer_from_env();
    let max_backfill_depth = max_backfill_depth_from_env();
    let pending_backfill_max = pending_backfill_max_from_env();
    let pending_backfill_ttl_ms = pending_backfill_ttl_ms_from_env();
    let mut pending_backfill: HashMap<request_response::OutboundRequestId, PendingBackfillEntry> =
        HashMap::new();
    let mut blacklisted_peers = BoundedPeerBlacklist::from_env();
    let mut pending_catch_up_range: HashMap<request_response::OutboundRequestId, PeerId> =
        HashMap::new();
    let mut pending_files_fetch: HashMap<
        request_response::OutboundRequestId,
        tokio::sync::oneshot::Sender<Result<crate::files::FileFetchResponse, String>>,
    > = HashMap::new();
    let chain_hello_interval_ms = chain_hello_interval_sec_from_env().saturating_mul(1000);
    let mut last_chain_hello_sent_at: HashMap<PeerId, u64> = HashMap::new();
    let kad_bootstrap_interval_ms = kad_bootstrap_interval_sec_from_env().saturating_mul(1000);
    let mut last_kad_bootstrap_at: u64 = now_ms();
    let mut catch_up_interval = tokio::time::interval(Duration::from_secs(1));
    catch_up_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // A closed command channel must disable its own `select!` arm and nothing else.
    //
    // Two failure modes this prevents, both of which have bitten. A `recv()` on a closed channel
    // returns `None` *immediately and forever*, so an arm without a guard either spins the loop
    // hot (burning a core and starving the other arms) or, as the publish arm used to, `break`s
    // out of the event loop entirely — taking block sync, chain-sync RPC and tx-submit down with
    // it because one unrelated sender was dropped. The swarm is shared infrastructure; losing one
    // producer is not a reason to stop serving the others.
    // Gossip self-heal. gossipsub exchanges subscriptions ONCE, when a connection is
    // established, and never re-sends them. A dial-dial collision (both sides dialling at the
    // same moment) can leave the subscription RPC on the connection that then closes, and the
    // surviving peer record is permanently missing topics — observed against the public seed on
    // 2026-09-22, where `/tet/v1/txs` was missing while blocks, tmail and files were present, so
    // `publish` returned `InsufficientPeers` for the life of the process. There is no retry
    // upstream and nothing observable from the application.
    //
    // So: periodically ask gossipsub what each bootnode is subscribed to. If a bootnode is not
    // showing one of our topics, log it and drop the connection. We do NOT unsubscribe+resubscribe
    // to force a fresh advertisement: `unsubscribe()` removes the topic from `self.mesh`, and
    // advertisement on connect iterates `self.mesh`, so that "repair" can itself cause the damage.
    //
    // This is a workaround for a libp2p-gossipsub behaviour, documented in
    // docs/upstream/libp2p-gossipsub-lost-subscription.md. Remove it if upstream adds a retry.
    let resubscribe_sec = gossip_resubscribe_interval_sec();
    /// Minimum gap between heals of the same peer, so a peer that is broken for some other
    /// reason cannot be put into a reconnect loop.
    const HEAL_COOLDOWN_MS: u64 = 120_000;
    let mut heal_cooldown: std::collections::HashMap<PeerId, u64> = std::collections::HashMap::new();
    let mut resubscribe_interval =
        tokio::time::interval(Duration::from_secs(resubscribe_sec.max(1)));
    resubscribe_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let mut publish_closed = false;
    let mut tx_submit_closed = false;
    let mut files_fetch_closed = false;
    loop {
        // Liveness beacon: every loop iteration stamps the health beacon so the systemd watchdog
        // (see `crate::swarm_health`) and `/health/swarm` can detect a stalled loop. The
        // `catch_up_interval` (1s) guarantees a tick even when the network is idle.
        swarm_health.tick(crate::swarm_health::now_ms());
        swarm_health.set_connected_peers(swarm.connected_peers().count());
        swarm_health.set_listeners(swarm.listeners().count());
        tokio::select! {
            _ = catch_up_interval.tick() => {
                bootnode_watch
                    .tick(
                        &mut swarm,
                        &listen,
                        ledger.as_ref(),
                        &hello_registry,
                        &catch_up_driver,
                        &block_sync_board,
                        &mut pending_catch_up_range,
                        &peer_dial_book,
                        &mut dialing,
                    )
                    .await;
                try_start_catch_up(
                    &block_sync_board,
                    &catch_up_driver,
                    &hello_registry,
                    ledger.as_ref(),
                    &mut swarm,
                    &mut pending_catch_up_range,
                )
                .await;
                if chain_hello_interval_ms > 0 {
                    let now = now_ms();
                    let local = *swarm.local_peer_id();
                    let due_peers: Vec<PeerId> = swarm
                        .connected_peers()
                        .cloned()
                        .filter(|p| *p != local)
                        .filter(|p| {
                            last_chain_hello_sent_at
                                .get(p)
                                .map(|t| now.saturating_sub(*t) >= chain_hello_interval_ms)
                                .unwrap_or(true)
                        })
                        .collect();
                    if !due_peers.is_empty() {
                        // Build the hello once (heavy O(N) state-root scan, offloaded) and reuse it
                        // for every due peer instead of re-scanning the ledger per peer.
                        match build_chain_hello_offloaded(&ledger).await {
                            Ok(our_hello) => {
                                for peer in due_peers {
                                    swarm
                                        .behaviour_mut()
                                        .chain_sync_hello
                                        .send_request(&peer, our_hello.clone());
                                    bootnode_watch.on_hello_sent(peer);
                                    last_chain_hello_sent_at.insert(peer, now);
                                    println!(
                                        "[P2P-block] 🔁 chain_hello periodic resend to {peer}"
                                    );
                                }
                            }
                            Err(e) => {
                                log::warn!("[p2p][block] periodic chain_hello build failed: {e}");
                            }
                        }
                    }
                }
                if kad_bootstrap_interval_ms > 0 {
                    let now = now_ms();
                    if now.saturating_sub(last_kad_bootstrap_at) >= kad_bootstrap_interval_ms {
                        last_kad_bootstrap_at = now;
                        match swarm.behaviour_mut().kademlia.bootstrap() {
                            Ok(_) => {
                                log::debug!("[p2p][kad] periodic bootstrap re-triggered");
                            }
                            Err(e) => {
                                // Empty routing table ("No known peers") is expected
                                // and harmless until a peer is (re)connected.
                                log::debug!("[p2p][kad] periodic bootstrap skipped: {e:?}");
                            }
                        }
                    }
                }
            }
            _ = resubscribe_interval.tick(), if resubscribe_sec > 0 => {
                // Only the topics EVERY node subscribes to unconditionally (p2p.rs subscribe
                // block). `ai-workload` is deliberately excluded: a PoR node legitimately does
                // not subscribe to it, and treating that as damage would heal in a loop forever.
                const CORE_TOPICS: [&str; 4] =
                    [BLOCKS_TOPIC, TXS_TOPIC, TMAIL_TOPIC, crate::files::FILES_ANNOUNCE_TOPIC];

                let mut damaged: Option<(PeerId, String)> = None;
                for (pid, their_topics) in swarm.behaviour().gossipsub.all_peers() {
                    if !bootnode_peer_ids.contains(pid) {
                        continue;
                    }
                    // A bootnode showing *some* core topics but not all is the signature: a peer
                    // that genuinely has not subscribed yet shows none.
                    let present = CORE_TOPICS
                        .iter()
                        .filter(|t| their_topics.iter().any(|h| h.as_str() == **t))
                        .count();
                    if present == 0 || present == CORE_TOPICS.len() {
                        continue;
                    }
                    if let Some(missing) = CORE_TOPICS
                        .iter()
                        .find(|t| !their_topics.iter().any(|h| h.as_str() == **t))
                    {
                        damaged = Some((*pid, (*missing).to_string()));
                        break;
                    }
                }

                if let Some((pid, missing)) = damaged {
                    let now = now_ms();
                    let cooled = heal_cooldown
                        .get(&pid)
                        .map(|last| now.saturating_sub(*last) >= HEAL_COOLDOWN_MS)
                        .unwrap_or(true);
                    if cooled {
                        heal_cooldown.insert(pid, now);
                        println!(
                            "[P2P][gossip-heal] bootnode {pid} record is missing {missing} \
                             (partial subscription set); dropping the connection"
                        );
                        log::warn!(
                            "[p2p][gossip-heal] reconnecting peer={pid} missing_topic={missing}"
                        );
                        // DELIBERATELY NOT re-sending our own subscriptions here.
                        //
                        // The obvious repair — unsubscribe() then subscribe(), since subscribe()
                        // alone is a no-op when already subscribed — is unsafe. `unsubscribe()`
                        // removes the topic from `self.mesh` (behaviour.rs:1140), and
                        // `on_connection_established` advertises by iterating `self.mesh`
                        // (behaviour.rs:2928). A peer connecting inside that window is never told
                        // about the removed topic, which is the same class of damage this code
                        // exists to detect. It would have been a self-inflicted repeat.
                        //
                        // Detection and logging only, until the cause is settled.
                        // And drop the connection, intending a fresh one to re-exchange
                        // subscriptions.
                        //
                        // MEASURED 2026-09-22: this does NOT repair our record. The reconnect
                        // lands ("New peer connected" ~2s later) but the peer sends no
                        // subscriptions with it, so our view stays partial and publishing keeps
                        // failing. gossipsub advertises subscriptions only on what it considers
                        // the first connection to a peer, and an immediate redial appears to
                        // arrive while the remote still has the old peer entry.
                        //
                        // Kept because the detection is correct and worth having in the log — it
                        // is the only visible signal of this failure — and because the repair is
                        // harmless. What actually keeps transactions moving is
                        // /tet/v1/tx-submit, which does not depend on gossip at all.
                        //
                        // Next thing to try: delay the redial (5-10s) so the remote fully drops
                        // its peer entry and treats the reconnect as first contact. Untested.
                        let _ = swarm.disconnect_peer_id(pid);
                    }
                }
            }
            maybe_tx = tx_submit_rx.recv(), if !tx_submit_closed => {
                if let Some(cmd) = maybe_tx {
                    // Target bootnodes when we have them; otherwise every connected peer. On the
                    // seed itself `bootnode_peer_ids` is empty and there is usually nothing to do,
                    // which is correct — it mines its own mempool.
                    let connected: Vec<PeerId> = swarm.connected_peers().copied().collect();
                    let targets: Vec<PeerId> = if bootnode_peer_ids.is_empty() {
                        connected
                    } else {
                        connected
                            .into_iter()
                            .filter(|p| bootnode_peer_ids.contains(p))
                            .collect()
                    };
                    if targets.is_empty() {
                        println!("[P2P][tx-submit] no connected target peer; gossip remains the only path");
                    }
                    for peer in targets {
                        let req = TxSubmitRequest { v: 1, env: cmd.env.clone() };
                        let _rid = swarm.behaviour_mut().tx_submit.send_request(&peer, req);
                    }
                } else {
                    println!("[P2P][tx-submit] command channel closed; direct submit disabled, swarm continues");
                    log::warn!("[p2p][tx-submit] command channel closed; direct submit disabled");
                    tx_submit_closed = true;
                }
            }
            _ = anon_sync_ticker.tick() => {
                // Anti-entropy, not just on join. A node can be connected and healthy while
                // silently receiving nothing on a topic (observed 2026-09-22), so roots are
                // re-compared periodically rather than trusted after one exchange.
                for peer in swarm.connected_peers().copied().collect::<Vec<_>>() {
                    let _ = swarm.behaviour_mut().anon_sync.send_request(
                        &peer,
                        AnonSyncRequest { v: 1, after_wallet: None, limit: 0 },
                    );
                }
            }
            maybe_reg = anon_register_rx.recv(), if !anon_register_closed => {
                if let Some(cmd) = maybe_reg {
                    // Same targeting as tx-submit: bootnodes when known, else every connected peer.
                    let connected: Vec<PeerId> = swarm.connected_peers().copied().collect();
                    let targets: Vec<PeerId> = if bootnode_peer_ids.is_empty() {
                        connected
                    } else {
                        connected.into_iter().filter(|p| bootnode_peer_ids.contains(p)).collect()
                    };
                    if targets.is_empty() {
                        println!("[P2P][anon-register] no connected target peer; gossip remains the only path");
                    }
                    for peer in targets {
                        let req = AnonRegisterRequest { v: 1, registration: cmd.registration.clone() };
                        let _rid = swarm.behaviour_mut().anon_register.send_request(&peer, req);
                    }
                } else {
                    println!("[P2P][anon-register] command channel closed; direct path disabled, swarm continues");
                    anon_register_closed = true;
                }
            }
            maybe_cmd = files_fetch_rx.recv(), if !files_fetch_closed => {
                if let Some(cmd) = maybe_cmd {
                    // Prefer the announced storage node when it is a known connected peer;
                    // otherwise fall back to the first connected peer (Phase 0 topology is tiny,
                    // and an honest peer answers `found=false` on a miss).
                    let parsed = cmd.storage_node.trim().parse::<PeerId>().ok();
                    let target = parsed
                        .filter(|p| swarm.is_connected(p))
                        .or_else(|| swarm.connected_peers().next().copied());
                    match target {
                        Some(peer) => {
                            let request_id = swarm.behaviour_mut().files_fetch.send_request(
                                &peer,
                                crate::files::FileFetchRequest { file_id: cmd.file_id },
                            );
                            println!(
                                "[P2P] 📦 FILES FETCH REQUEST sent file_id={} peer={peer} request_id={request_id:?}",
                                cmd.file_id
                            );
                            pending_files_fetch.insert(request_id, cmd.resp);
                        }
                        None => {
                            let _ = cmd.resp.send(Err("no connected peers to fetch file body from".into()));
                        }
                    }
                }
            }
            maybe_msg = publish_rx.recv(), if !publish_closed => {
                let now = now_ms();
                blacklisted_peers.prune(now);
                prune_pending_backfill(&mut pending_backfill, now, pending_backfill_max, pending_backfill_ttl_ms);
                if let Some(msg) = maybe_msg {
                    if msg.len() > max_gossip_bytes {
                        crate::metrics::inc_gossip_rejected();
                        println!(
                            "[P2P] ❌ GOSSIP PUBLISH REJECTED: message too large bytes={} cap={}",
                            msg.len(),
                            max_gossip_bytes
                        );
                        continue;
                    }
                    let topics = network_event_topics(&msg, &blocks_topic, &txs_topic, &ai_workload_topic, &tmail_topic, &files_announce_topic);
                    for topic in topics {
                        match swarm
                            .behaviour_mut()
                            .gossipsub
                            .publish(topic.clone(), msg.as_bytes())
                        {
                            Ok(_msg_id) => {
                                println!("[P2P] 📣 GOSSIP PUBLISHED topic={} msg={}", topic.hash(), msg);
                            }
                            Err(e) => {
                                println!("[P2P] ❌ GOSSIP PUBLISH ERROR topic={} err={:?}", topic.hash(), e);
                                // TRACK A instrumentation. `InsufficientPeers` has two causes in
                                // libp2p-gossipsub 0.48 and they need different fixes: the early
                                // return (behaviour.rs:635) when NO connected peer is recorded as
                                // subscribed to the topic, or an empty recipient set after mesh /
                                // fanout / explicit selection. Dump what gossipsub actually
                                // believes so the next reader does not have to guess.
                                let gs = &swarm.behaviour().gossipsub;
                                let want = topic.hash();
                                let peers: Vec<String> = gs
                                    .all_peers()
                                    .map(|(pid, topics)| {
                                        let subscribed = topics.iter().any(|t| **t == want);
                                        format!(
                                            "{pid} on_topic={subscribed} topics=[{}]",
                                            topics
                                                .iter()
                                                .map(|t| t.to_string())
                                                .collect::<Vec<_>>()
                                                .join(" ")
                                        )
                                    })
                                    .collect();
                                let mesh: Vec<String> =
                                    gs.mesh_peers(&want).map(|p| p.to_string()).collect();
                                println!(
                                    "[P2P][diag] topic={want} connected_peers={} mesh_peers={:?} peers=[{}]",
                                    peers.len(),
                                    mesh,
                                    peers.join(" | ")
                                );
                            }
                        }
                    }
                } else {
                    // Was `break`. Dropping the gossip sender — which a caller can do simply by
                    // clearing `RestState::gossip_tx` — used to stop the entire block-plane swarm.
                    println!("[P2P] publish channel closed; gossip publishing disabled, swarm continues");
                    log::warn!("[p2p] publish channel closed; gossip publishing disabled");
                    publish_closed = true;
                }
            }
            ev = swarm.select_next_some() => match ev {
            SwarmEvent::NewListenAddr { address, .. } => {
                let dial = address
                    .clone()
                    .with(Protocol::P2p(*swarm.local_peer_id()));
                println!("[P2P-block] listening on {dial}");
                log::info!("[p2p][block] listen_addr={dial}");
            }
            SwarmEvent::Behaviour(Event::Mdns(mdns::Event::Discovered(peers))) => {
                for (pid, addr) in peers {
                    if pid == *swarm.local_peer_id() {
                        continue;
                    }
                    if dialing.contains(&pid) {
                        continue;
                    }
                    dialing.insert(pid);
                    let dial_addr = remap_discovered_addr_for_listen(addr, &listen);
                    peer_dial_book.insert(pid, dial_addr.clone());
                    log::info!("[p2p][mdns] discovered peer_id={pid} addr={dial_addr}");
                    swarm
                        .behaviour_mut()
                        .kademlia
                        .add_address(&pid, dial_addr.clone());
                    swarm.behaviour_mut().gossipsub.add_explicit_peer(&pid);
                    let _ = swarm.dial(dial_addr);
                }
            }
            SwarmEvent::Behaviour(Event::Mdns(mdns::Event::Expired(peers))) => {
                for (pid, addr) in peers {
                    log::debug!("[p2p][mdns] expired peer_id={pid} addr={addr}");
                    swarm.behaviour_mut().gossipsub.remove_explicit_peer(&pid);
                    dialing.remove(&pid);
                }
            }
            SwarmEvent::Behaviour(Event::Identify(identify::Event::Received { peer_id, info, .. })) => {
                for a in info.listen_addrs {
                    swarm.behaviour_mut().kademlia.add_address(&peer_id, a.clone());
                }
                if bootnode_explicit_peers_enabled() {
                    swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                }
                println!("[P2P] 🪪 IDENTIFY RECEIVED from {}", peer_id);
            }
            SwarmEvent::Behaviour(Event::Kademlia(ev)) => {
                // Keep it noisy for debugging while stabilizing Phase 2 network discovery.
                log::debug!("[p2p][kad] event={ev:?}");
            }
            SwarmEvent::Behaviour(Event::AnonSync(ev)) => match ev {
                request_response::Event::Message {
                    peer,
                    message: request_response::Message::Request { request, channel, .. },
                    ..
                } => {
                    anon_sync_limiter.prune();
                    let root = tmail_store.anon_root();
                    let resp = if !anon_sync_limiter.allow(&peer, anon_sync_rps) {
                        AnonSyncResponse {
                            merkle_root_hex: hex::encode(root),
                            epoch: tmail_store.anon_current_epoch(),
                            total_members: tmail_store.anon_member_count(),
                            registrations: Vec::new(),
                            next_cursor: None,
                        }
                    } else {
                        // limit 0 is the probe: root and total only. Anti-entropy sends this first
                        // so the steady state is one small round trip, not a registry transfer.
                        let limit = request.limit.min(ANON_SYNC_PAGE);
                        let (registrations, next_cursor) = if limit == 0 {
                            (Vec::new(), None)
                        } else {
                            tmail_store
                                .anon_registrations_after(request.after_wallet.as_deref(), limit)
                        };
                        AnonSyncResponse {
                            merkle_root_hex: hex::encode(root),
                            epoch: tmail_store.anon_current_epoch(),
                            total_members: tmail_store.anon_member_count(),
                            registrations,
                            next_cursor,
                        }
                    };
                    let _ = swarm.behaviour_mut().anon_sync.send_response(channel, resp);
                }
                request_response::Event::Message {
                    peer,
                    message: request_response::Message::Response { response, .. },
                    ..
                } => {
                    let ours = hex::encode(tmail_store.anon_root());
                    if response.registrations.is_empty() && response.next_cursor.is_none() {
                        // Probe reply. Page only on a mismatch.
                        if response.merkle_root_hex == ours {
                            anon_sync_pages.remove(&peer);
                            continue;
                        }
                        println!(
                            "[P2P][anon-sync] root mismatch with {peer}: ours={} theirs={} (theirs has {} members) -- syncing",
                            &ours[..16], &response.merkle_root_hex[..16.min(response.merkle_root_hex.len())],
                            response.total_members
                        );
                        anon_sync_pages.insert(peer, 0);
                        anon_sync_spent.insert(peer, Duration::ZERO);
                        let after_wallet = anon_sync_resume.get(&peer).cloned();
                        if let Some(c) = &after_wallet {
                            println!("[P2P][anon-sync] resuming after {c}");
                        }
                        let _ = swarm.behaviour_mut().anon_sync.send_request(
                            &peer,
                            AnonSyncRequest { v: 1, after_wallet, limit: ANON_SYNC_PAGE },
                        );
                        continue;
                    }
                    // A page. Every record goes through the SAME admission path as gossip and
                    // REST: a peer cannot forge a registration, because each carries the wallet's
                    // own hybrid signature. What it CAN do is withhold (we stay partial and fail
                    // closed) or flood (bounded by the member cap, the page size and the RPS).
                    let mut added = 0usize;
                    let verify_started = std::time::Instant::now();
                    for reg in &response.registrations {
                        match admit_anon_registration(&tmail_store, reg) {
                            Ok(crate::tmail::store::AnonRegisterOutcome::Added) => added += 1,
                            Ok(_) => {}
                            Err(e) => {
                                crate::metrics::inc_gossip_rejected();
                                println!("[P2P][anon-sync] rejected a synced registration: {e}");
                            }
                        }
                    }
                    let spent = anon_sync_spent.entry(peer).or_insert(Duration::ZERO);
                    *spent += verify_started.elapsed();
                    let spent = *spent;
                    let page = anon_sync_pages.entry(peer).or_insert(0);
                    *page += 1;
                    println!(
                        "[P2P][anon-sync] page {} from {peer}: +{added} new, {} members now, {} ms \
                         of {} ms verify budget used",
                        *page,
                        tmail_store.anon_member_count(),
                        spent.as_millis(),
                        anon_sync_budget.as_millis()
                    );
                    if spent >= anon_sync_budget {
                        // Bound reached. Say so, and remember where to resume: a budget that
                        // silently truncated would look identical to a completed sync.
                        match &response.next_cursor {
                            Some(cursor) => {
                                println!(
                                    "[P2P][anon-sync] verify budget spent after {} pages with {peer}; \
                                     pausing at {cursor}, resuming next round",
                                    *page
                                );
                                anon_sync_resume.insert(peer, cursor.clone());
                            }
                            None => {
                                anon_sync_resume.remove(&peer);
                            }
                        }
                        anon_sync_pages.remove(&peer);
                        anon_sync_spent.remove(&peer);
                        continue;
                    }
                    if let Some(cursor) = response.next_cursor
                        && *page < ANON_SYNC_MAX_PAGES
                    {
                        let _ = swarm.behaviour_mut().anon_sync.send_request(
                            &peer,
                            AnonSyncRequest {
                                v: 1,
                                after_wallet: Some(cursor),
                                limit: ANON_SYNC_PAGE,
                            },
                        );
                    } else {
                        if *page >= ANON_SYNC_MAX_PAGES {
                            println!(
                                "[P2P][anon-sync] page cap {ANON_SYNC_MAX_PAGES} reached with {peer}"
                            );
                        }
                        anon_sync_pages.remove(&peer);
                        anon_sync_spent.remove(&peer);
                        // A completed round starts the next one from the beginning.
                        anon_sync_resume.remove(&peer);
                        println!(
                            "[P2P][anon-sync] sync with {peer} complete: {} members, root {}",
                            tmail_store.anon_member_count(),
                            &hex::encode(tmail_store.anon_root())[..16]
                        );
                    }
                }
                request_response::Event::OutboundFailure { peer, error, .. } => {
                    anon_sync_pages.remove(&peer);
                    anon_sync_spent.remove(&peer);
                    println!("[P2P][anon-sync] outbound failure peer={peer} err={error}");
                }
                _ => {}
            },
            SwarmEvent::Behaviour(Event::AnonReceipt(ev)) => match ev {
                request_response::Event::Message {
                    peer,
                    message: request_response::Message::Request { request, channel, .. },
                    ..
                } => {
                    // Serving is cheap and safe: the key IS the hash of the value, so a peer
                    // cannot use us to distribute anything but the receipt it asked for.
                    let resp = match tmail_store.get_anon_receipt(&request.receipt_sha256_hex) {
                        Some(bytes) => AnonReceiptResponse {
                            found: true,
                            receipt_b64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                        },
                        None => AnonReceiptResponse { found: false, receipt_b64: String::new() },
                    };
                    println!(
                        "[P2P][anon-receipt] serve hash={} found={} to {peer}",
                        &request.receipt_sha256_hex[..16.min(request.receipt_sha256_hex.len())],
                        resp.found
                    );
                    let _ = swarm.behaviour_mut().anon_receipt.send_response(channel, resp);
                }
                request_response::Event::Message {
                    peer,
                    message: request_response::Message::Response { response, .. },
                    ..
                } => {
                    if !response.found {
                        println!("[P2P][anon-receipt] peer={peer} does not have it");
                        continue;
                    }
                    let Ok(bytes) = base64::engine::general_purpose::STANDARD
                        .decode(response.receipt_b64.as_bytes())
                    else {
                        println!("[P2P][anon-receipt] peer={peer} sent undecodable base64");
                        continue;
                    };
                    // Which message was this for? Match by the announced hash -- the receipt is
                    // content-addressed, so this cannot be confused with another message's.
                    let mut handled = 0usize;
                    for (msg_id, env) in tmail_store.pending_anon_envelopes() {
                        let Some(anon) = env.anonymous.as_ref() else { continue };
                        let expected = anon.anchor_proof.receipt_sha256_hex.clone();
                        if tmail_store.put_anon_receipt(&expected, &bytes).unwrap_or(false) {
                            let verdict =
                                crate::tmail::anon::verify_anonymous_proof(&tmail_store, &env, &bytes);
                            let tag = match &verdict {
                                crate::tmail::store::AnonVerdict::Verified { .. } => "VERIFIED",
                                crate::tmail::store::AnonVerdict::Failed { reason, .. } => {
                                    println!("[P2P][anon-receipt] ❌ {msg_id}: {reason}");
                                    "FAILED"
                                }
                                crate::tmail::store::AnonVerdict::Pending => "PENDING",
                            };
                            println!("[P2P][anon-receipt] 🔎 {msg_id} -> {tag}");
                            let _ = tmail_store.set_anon_verdict(&msg_id, &verdict);
                            handled += 1;
                        }
                    }
                    if handled == 0 {
                        println!("[P2P][anon-receipt] receipt from {peer} matched no pending message");
                    }
                }
                request_response::Event::OutboundFailure { peer, error, .. } => {
                    println!("[P2P][anon-receipt] outbound failure peer={peer} err={error}");
                }
                _ => {}
            },
            SwarmEvent::Behaviour(Event::AnonRegister(ev)) => match ev {
                request_response::Event::Message {
                    peer,
                    message: request_response::Message::Request { request, channel, .. },
                    ..
                } => {
                    // Budget spent before verifying: the hybrid ML-DSA check is the expensive part.
                    anon_register_limiter.prune();
                    let resp = if !anon_register_limiter.allow(&peer, anon_register_rps) {
                        println!("[P2P][anon-register] ⛔ rate limited peer={peer}");
                        AnonRegisterResponse {
                            accepted: false,
                            outcome: "rate_limited".into(),
                            reason: Some(format!("over {anon_register_rps} reg/s")),
                        }
                    } else if request.v != 1 {
                        AnonRegisterResponse {
                            accepted: false,
                            outcome: "rejected".into(),
                            reason: Some("unsupported request version".into()),
                        }
                    } else {
                        // Exactly the gossip admission path. A direct registration buys no trust
                        // it would not get over gossip.
                        match admit_anon_registration(&tmail_store, &request.registration) {
                            Ok(outcome) => {
                                let tag = format!("{outcome:?}").to_lowercase();
                                println!("[P2P][anon-register] ✅ {tag} from {peer}");
                                AnonRegisterResponse { accepted: true, outcome: tag, reason: None }
                            }
                            Err(reason) => {
                                crate::metrics::inc_gossip_rejected();
                                println!("[P2P][anon-register] ❌ rejected from {peer}: {reason}");
                                AnonRegisterResponse {
                                    accepted: false,
                                    outcome: "rejected".into(),
                                    reason: Some(reason),
                                }
                            }
                        }
                    };
                    let _ = swarm.behaviour_mut().anon_register.send_response(channel, resp);
                }
                request_response::Event::Message {
                    message: request_response::Message::Response { response, .. },
                    peer,
                    ..
                } => {
                    println!(
                        "[P2P][anon-register] peer={peer} accepted={} outcome={}",
                        response.accepted, response.outcome
                    );
                }
                request_response::Event::OutboundFailure { peer, error, .. } => {
                    println!("[P2P][anon-register] outbound failure peer={peer} err={error}");
                }
                _ => {}
            },
            SwarmEvent::Behaviour(Event::TxSubmit(ev)) => match ev {
                request_response::Event::Message {
                    peer,
                    message:
                        request_response::Message::Request {
                            request, channel, ..
                        },
                    ..
                } => {
                    // Spend the rate-limit budget BEFORE verifying: the hybrid ML-DSA check is
                    // the expensive part, so a peer must not be able to make us do it at will.
                    tx_submit_limiter.prune();
                    let resp = if !tx_submit_limiter.allow(&peer, tx_submit_rps) {
                        println!("[P2P][tx-submit] ⛔ rate limited peer={peer}");
                        TxSubmitResponse {
                            accepted: false,
                            outcome: "rate_limited".into(),
                            tx_hash: None,
                            reason: Some(format!("over {tx_submit_rps} tx/s")),
                        }
                    } else if request.v != 1 {
                        TxSubmitResponse {
                            accepted: false,
                            outcome: "rejected".into(),
                            tx_hash: None,
                            reason: Some("unsupported request version".into()),
                        }
                    } else {
                        // Exactly the gossip admission path — same verify, same dedup, same
                        // caps. A direct submission buys no trust it would not get over gossip.
                        match handle_tx_broadcast(&ledger, &mempool, request.env).await {
                            TxGossipOutcome::Enqueued { tx_hash, mempool_len } => {
                                println!(
                                    "[P2P][tx-submit] ✅ accepted from {peer} tx_hash={tx_hash} mempool_len={mempool_len}"
                                );
                                TxSubmitResponse { accepted: true, outcome: "enqueued".into(), tx_hash: Some(tx_hash), reason: None }
                            }
                            TxGossipOutcome::AlreadyQueued { tx_hash } => TxSubmitResponse {
                                accepted: true,
                                outcome: "already_queued".into(),
                                tx_hash: Some(tx_hash),
                                reason: None,
                            },
                            TxGossipOutcome::AlreadyApplied { tx_hash } => TxSubmitResponse {
                                accepted: true,
                                outcome: "already_applied".into(),
                                tx_hash: Some(tx_hash),
                                reason: None,
                            },
                            TxGossipOutcome::Rejected { reason } => {
                                crate::metrics::inc_gossip_rejected();
                                println!("[P2P][tx-submit] ❌ rejected from {peer}: {reason}");
                                TxSubmitResponse { accepted: false, outcome: "rejected".into(), tx_hash: None, reason: Some(reason) }
                            }
                        }
                    };
                    let _ = swarm.behaviour_mut().tx_submit.send_response(channel, resp);
                }
                request_response::Event::Message {
                    peer,
                    message: request_response::Message::Response { response, .. },
                    ..
                } => {
                    println!(
                        "[P2P][tx-submit] ← {peer} accepted={} outcome={} reason={:?}",
                        response.accepted, response.outcome, response.reason
                    );
                }
                request_response::Event::OutboundFailure { peer, error, .. } => {
                    println!("[P2P][tx-submit] outbound failure peer={peer} err={error}");
                }
                request_response::Event::InboundFailure { peer, error, .. } => {
                    println!("[P2P][tx-submit] inbound failure peer={peer} err={error}");
                }
                _ => {}
            },
            SwarmEvent::Behaviour(Event::ChainSyncHello(ev)) => match ev {
                request_response::Event::Message {
                    peer,
                    message:
                        request_response::Message::Request {
                            request, channel, ..
                        },
                    ..
                } => {
                    ingest_remote_chain_hello(
                        &hello_registry,
                        ledger.as_ref(),
                        peer,
                        request,
                        Some(&mut bootnode_watch),
                    )
                    .await;
                    if bootnode_watch.is_bootnode(&peer) {
                        catch_up_driver
                            .lock()
                            .await
                            .unblacklist_peer(&peer.to_string());
                    }
                    try_start_catch_up(
                        &block_sync_board,
                        &catch_up_driver,
                        &hello_registry,
                        ledger.as_ref(),
                        &mut swarm,
                        &mut pending_catch_up_range,
                    )
                    .await;
                    let response = build_chain_hello_resilient(&ledger).await;
                    let _ = swarm
                        .behaviour_mut()
                        .chain_sync_hello
                        .send_response(channel, response);
                }
                request_response::Event::Message {
                    peer,
                    message: request_response::Message::Response { response, .. },
                    ..
                } => {
                    ingest_remote_chain_hello(
                        &hello_registry,
                        ledger.as_ref(),
                        peer,
                        response,
                        Some(&mut bootnode_watch),
                    )
                    .await;
                    if bootnode_watch.is_bootnode(&peer) {
                        catch_up_driver
                            .lock()
                            .await
                            .unblacklist_peer(&peer.to_string());
                    }
                    try_start_catch_up(
                        &block_sync_board,
                        &catch_up_driver,
                        &hello_registry,
                        ledger.as_ref(),
                        &mut swarm,
                        &mut pending_catch_up_range,
                    )
                    .await;
                }
                _ => {}
            },
            SwarmEvent::Behaviour(Event::ChainSyncRange(ev)) => match ev {
                request_response::Event::Message {
                    peer,
                    message:
                        request_response::Message::Request {
                            request, channel, ..
                        },
                    ..
                } => {
                    if let Some(response) =
                        build_chain_sync_range_response_offloaded(&ledger, &request).await
                    {
                        println!(
                            "[P2P-block] ↩️ CHAIN_SYNC RANGE peer={} req {}..{} → blocks={} actual_to={}",
                            peer,
                            request.from_height,
                            request.to_height,
                            response.blocks.len(),
                            response.to_height
                        );
                        let _ = swarm
                            .behaviour_mut()
                            .chain_sync_range
                            .send_response(channel, response);
                    }
                }
                request_response::Event::Message {
                    peer,
                    message:
                        request_response::Message::Response {
                            request_id,
                            response,
                        },
                    ..
                } => {
                    if pending_catch_up_range.remove(&request_id).is_some() {
                        on_catch_up_range_response(
                            peer,
                            response,
                            &block_sync_board,
                            &catch_up_driver,
                            &hello_registry,
                            ledger.clone(),
                            mempool.clone(),
                            &mut swarm,
                            &mut pending_catch_up_range,
                        )
                        .await;
                    }
                }
                request_response::Event::OutboundFailure {
                    peer,
                    request_id,
                    error,
                    ..
                } => {
                    if pending_catch_up_range.remove(&request_id).is_some() {
                        on_catch_up_range_failed(
                            peer,
                            format!("{error:?}"),
                            &block_sync_board,
                            &catch_up_driver,
                            &hello_registry,
                            ledger.as_ref(),
                            &mut swarm,
                            &mut pending_catch_up_range,
                        )
                        .await;
                    }
                }
                _ => {}
            },
            SwarmEvent::Behaviour(Event::BlockSync(ev)) => {
                match ev {
                    request_response::Event::Message {
                        peer,
                        message:
                            request_response::Message::Request {
                                request, channel, ..
                            },
                        ..
                    } => {
                        let block =
                            block_record_by_id_offloaded(&ledger, request.block_id.clone()).await;
                        let _ = swarm.behaviour_mut().block_sync.send_response(
                            channel,
                            BlockResponse {
                                block_id: request.block_id,
                                block,
                            },
                        );
                        println!("[P2P] ↩️ BLOCK RESPONSE SENT to {}", peer);
                    }
                    request_response::Event::Message {
                        peer,
                        message:
                            request_response::Message::Response {
                                request_id,
                                response,
                            },
                        ..
                    } => {
                        let Some(pending_req) = pending_backfill.remove(&request_id) else {
                            continue;
                        };
                        let requested_id = pending_req.block_id;
                        let depth = pending_req.depth;
                        if requested_id != response.block_id {
                            blacklisted_peers.insert(peer, now_ms());
                            println!(
                                "[P2P] ❌ BLOCK RESPONSE REJECTED peer={} requested={} got={}",
                                peer, requested_id, response.block_id
                            );
                            continue;
                        }
                        let Some(block) = response.block else {
                            blacklisted_peers.insert(peer, now_ms());
                            println!(
                                "[P2P] ❌ BLOCK RESPONSE EMPTY peer={} block={}",
                                peer, response.block_id
                            );
                            continue;
                        };
                        let gossip = crate::consensus::RemoteBlockGossip {
                            block_height: block.height,
                            block_id: block.block_id.clone(),
                            parent_block_id: block.parent_block_id.clone(),
                            producer_id: block.producer_id.clone(),
                            base_reward_micro: block.reward.base_reward_micro,
                            compute_reward_micro: block.reward.compute_reward_micro,
                            total_reward_micro: block.reward.total_reward_micro,
                            state_root: block.state_root.clone(),
                            txs: block.txs.clone(),
                        };
                        let stored = match crate::consensus::validate_and_record_backfill_candidate(
                            ledger.as_ref(),
                            gossip,
                        ) {
                            Ok(stored) => stored,
                            Err(e) => {
                                blacklisted_peers.insert(peer, now_ms());
                                println!(
                                    "[P2P] ❌ BACKFILLED BLOCK REJECTED peer={} err={}",
                                    peer,
                                    e.message()
                                );
                                continue;
                            }
                        };
                        if let Some(parent_id) = stored.parent_block_id.as_deref()
                            && ledger
                                .block_record_by_id(parent_id)
                                .map(|b| b.is_none())
                                .unwrap_or(true)
                        {
                            if depth >= max_backfill_depth {
                                blacklisted_peers.insert(peer, now_ms());
                                println!(
                                    "[P2P] ❌ BACKFILL DEPTH LIMIT peer={} block={} depth={} max={}",
                                    peer, stored.block_id, depth, max_backfill_depth
                                );
                                continue;
                            }
                            let rid = swarm
                                .behaviour_mut()
                                .block_sync
                                .send_request(&peer, BlockRequest { block_id: parent_id.to_string() });
                            prune_pending_backfill(&mut pending_backfill, now_ms(), pending_backfill_max, pending_backfill_ttl_ms);
                            pending_backfill.insert(
                                rid,
                                PendingBackfillEntry {
                                    block_id: parent_id.to_string(),
                                    depth: depth + 1,
                                    inserted_at_ms: now_ms(),
                                },
                            );
                            println!(
                                "[P2P] 🧩 BACKFILL RECURSE block={} missing_parent={} depth={}",
                                stored.block_id,
                                parent_id,
                                depth + 1
                            );
                            continue;
                        }

                        let mut candidates = orphan_buffer.children_of(&stored.block_id, now_ms());
                        candidates.push(stored.clone());
                        for candidate in candidates {
                            match crate::consensus::try_reorg_backfilled_branch(
                                ledger.as_ref(),
                                &candidate.block_id,
                            ) {
                                Ok(true) => {
                                    orphan_buffer.remove(&candidate.block_id);
                                    println!(
                                        "[P2P] ✅ BACKFILLED BRANCH REORG APPLIED tip={}",
                                        candidate.block_id
                                    );
                                }
                                Ok(false) => {
                                    println!(
                                        "[P2P] ⏭️ BACKFILLED BRANCH DID NOT WIN tip={}",
                                        candidate.block_id
                                    );
                                }
                                Err(e) => {
                                    blacklisted_peers.insert(peer, now_ms());
                                    println!(
                                        "[P2P] ❌ BACKFILLED REORG FAILED tip={} err={}",
                                        candidate.block_id, e
                                    );
                                }
                            }
                        }
                    }
                    request_response::Event::OutboundFailure {
                        peer,
                        request_id,
                        error,
                        ..
                    } => {
                        pending_backfill.remove(&request_id);
                        println!(
                            "[P2P] ❌ BLOCK REQUEST FAILED peer={} err={:?}",
                            peer, error
                        );
                    }
                    request_response::Event::InboundFailure { peer, error, .. } => {
                        println!(
                            "[P2P] ❌ BLOCK REQUEST INBOUND FAILURE peer={} err={:?}",
                            peer, error
                        );
                    }
                    request_response::Event::ResponseSent { peer, .. } => {
                        log::debug!("[p2p][block-sync] response_sent peer={peer}");
                    }
                }
            }
            SwarmEvent::ConnectionEstablished { peer_id, endpoint, .. } => {
                println!("[P2P] CONNECTION ESTABLISHED with {}", peer_id);
                let remote = remap_discovered_addr_for_listen(
                    endpoint.get_remote_address().clone(),
                    &listen,
                );
                log::info!("[p2p][mdns] connected peer_id={peer_id} endpoint={remote}");
                peer_dial_book.insert(peer_id, remote);
                // Probe the anonymity-registry root immediately, not only on the 5 min timer: a
                // node that just joined is precisely the one holding a partial registry, and
                // waiting a tick means its first anonymous message is rejected for no good reason.
                if peer_id != *swarm.local_peer_id() {
                    let _ = swarm.behaviour_mut().anon_sync.send_request(
                        &peer_id,
                        AnonSyncRequest { v: 1, after_wallet: None, limit: 0 },
                    );
                }
                if peer_id != *swarm.local_peer_id() {
                    // Bootnodes only. This used to run for EVERY connected peer, and an explicit
                    // peer is excluded from `get_random_peers`, which fills both mesh and fanout
                    // — so on a small network every peer was explicit, the mesh could never form
                    // for any topic (`Mesh low. Topic contains: 0 needs: 4` on every heartbeat),
                    // and gossip degraded to direct sends with no redundancy and no gossip
                    // propagation between peers that were not directly connected.
                    //
                    // Explicit is meant for a handful of trusted relays you always talk to
                    // directly. A bootnode qualifies; an arbitrary inbound peer does not.
                    //
                    // Verification note: with 3+ nodes the mesh should now actually form. That is
                    // untested — the public testnet is two nodes today, where mesh_n_low (4) is
                    // unreachable regardless. Re-check when a second seed exists.
                    if bootnode_explicit_peers_enabled() && bootnode_peer_ids.contains(&peer_id) {
                        swarm
                            .behaviour_mut()
                            .gossipsub
                            .add_explicit_peer(&peer_id);
                    }
                    match build_chain_hello_offloaded(&ledger).await {
                        Ok(our_hello) => {
                            swarm
                                .behaviour_mut()
                                .chain_sync_hello
                                .send_request(&peer_id, our_hello);
                            bootnode_watch.on_hello_sent(peer_id);
                            last_chain_hello_sent_at.insert(peer_id, now_ms());
                            println!("[P2P-block] 👋 chain_hello sent to {peer_id}");
                        }
                        Err(e) => {
                            log::warn!("[p2p][block] chain_hello send failed: {e}");
                        }
                    }
                }
            }
            SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
                log::warn!("[p2p][mdns] disconnected peer_id={peer_id} cause={cause:?}");
                dialing.remove(&peer_id);
                last_chain_hello_sent_at.remove(&peer_id);
                if bootnode_watch.is_bootnode(&peer_id) && !bootnode_watch.is_dead(&peer_id) {
                    bootnode_watch.mark_bootnode_dead(peer_id);
                    catch_up_driver
                        .lock()
                        .await
                        .blacklist_peer(peer_id.to_string());
                    bootnode_watch
                        .run_bootnode_recovery_fallback(
                            &mut swarm,
                            &listen,
                            ledger.as_ref(),
                            &hello_registry,
                            &catch_up_driver,
                            &block_sync_board,
                            &mut pending_catch_up_range,
                            &peer_dial_book,
                            &mut dialing,
                        )
                        .await;
                }
                {
                    let peer_s = peer_id.to_string();
                    let action = {
                        let mut reg = hello_registry.lock().await;
                        reg.remove_peer(&peer_s);
                        println!(
                            "[P2P-block] sync_hello removed peer={peer_id} map_size={}",
                            reg.peer_count()
                        );
                        let local_height = ledger.block_height().unwrap_or(0);
                        catch_up_driver.lock().await.handle(
                            CatchUpDriverEvent::PeerRemoved { peer_id: peer_s },
                            &reg,
                            local_height,
                        )
                    };
                    run_catch_up_action(
                        action,
                        &block_sync_board,
                        &mut swarm,
                        &hello_registry,
                        &catch_up_driver,
                        &mut pending_catch_up_range,
                    )
                    .await;
                }
            }
            SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
                println!("[P2P] DIAL ERROR to {:?}: {:?}", peer_id, error);
                log::warn!("[p2p][mdns] outgoing error peer_id={peer_id:?} err={error}");
                if let Some(pid) = peer_id {
                    dialing.remove(&pid);
                }
            }
            SwarmEvent::IncomingConnectionError { send_back_addr, error, .. } => {
                log::warn!(
                    "[p2p][mdns] incoming error from_addr={send_back_addr} err={error}"
                );
            }
            SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Message { message_id, message, .. })) => {
                let source_peer = message.source;
                if message.data.len() > max_gossip_bytes {
                    if let Some(source) = source_peer.as_ref() {
                        let _ = swarm.behaviour_mut().gossipsub.report_message_validation_result(
                            &message_id,
                            source,
                            gossipsub::MessageAcceptance::Reject,
                        );
                    }
                    println!(
                        "[P2P] ❌ GOSSIP REJECTED: oversize bytes={} cap={}",
                        message.data.len(),
                        max_gossip_bytes
                    );
                    continue;
                }
                let message_data = String::from_utf8_lossy(&message.data);
                if message.topic == ai_workload_topic_hash && !wants_ai_workload {
                    let parsed = serde_json::from_str::<NetworkEvent>(&message_data).is_ok();
                    if let Some(source) = source_peer.as_ref() {
                        let _ = swarm.behaviour_mut().gossipsub.report_message_validation_result(
                            &message_id,
                            source,
                            if parsed {
                                gossipsub::MessageAcceptance::Accept
                            } else {
                                gossipsub::MessageAcceptance::Reject
                            },
                        );
                    }
                    println!("[P2P] PoR bandwidth guard: validated AI workload gossip without applying");
                    continue;
                }
                match serde_json::from_str::<NetworkEvent>(&message_data) {
                    Ok(event) => {
                        if let Some(source) = source_peer.as_ref() {
                            let _ = swarm.behaviour_mut().gossipsub.report_message_validation_result(
                                &message_id,
                                source,
                                gossip_event_acceptance(&event, Some(source), &producer_peers),
                            );
                        }
                        match &event {
                            NetworkEvent::FaucetExecuted {
                                event_id,
                                to_wallet,
                                amount_micro,
                            } => {
                                println!(
                                    "[P2P] 🔄 STATE SYNC DETECTED: FaucetExecuted {{ event_id: {:?}, to_wallet: {:?}, amount_micro: {:?} }}",
                                    event_id, to_wallet, amount_micro
                                );
                            }
                            NetworkEvent::TxBroadcast { .. } => {
                                println!("[P2P] 📨 MEMPOOL TX GOSSIP RECEIVED");
                            }
                            NetworkEvent::TmailGossip { .. } => {
                                println!("[P2P] 📧 TMAIL GOSSIP RECEIVED");
                            }
                            NetworkEvent::FileAnnounce { .. } => {
                                println!("[P2P] 📎 FILE ANNOUNCE RECEIVED");
                            }
                            other => {
                                println!("[P2P] 🔄 STATE SYNC DETECTED: {:?}", other);
                            }
                        }
                        match event {
                            NetworkEvent::BlockMined {
                                block_height,
                                block_id,
                                parent_block_id,
                                producer_id,
                                base_reward_micro,
                                compute_reward_micro,
                                total_reward_micro,
                                state_root,
                                txs,
                            } => {
                                if let Err(why) = producer_peers.check_block_source(&producer_id, source_peer.as_ref()) {
                                    println!("[P2P] ❌ GOSSIP BLOCK REFUSED height={block_height}: {why}");
                                    continue;
                                }
                                let local_h = ledger.block_height().unwrap_or(0);
                                if let Some(source) = source_peer {
                                    let peer_s = source.to_string();
                                    {
                                        let mut reg = hello_registry.lock().await;
                                        reg.note_peer_block_height(
                                            &peer_s,
                                            block_height,
                                            local_h,
                                        );
                                    }
                                    if block_height > local_h {
                                        try_start_catch_up(
                                            &block_sync_board,
                                            &catch_up_driver,
                                            &hello_registry,
                                            ledger.as_ref(),
                                            &mut swarm,
                                            &mut pending_catch_up_range,
                                        )
                                        .await;
                                    }
                                }
                                let gossip = crate::consensus::RemoteBlockGossip {
                                    block_height,
                                    block_id: block_id.clone(),
                                    parent_block_id: parent_block_id.clone(),
                                    producer_id: producer_id.clone(),
                                    base_reward_micro,
                                    compute_reward_micro,
                                    total_reward_micro,
                                    state_root: state_root.clone(),
                                    txs: txs.clone(),
                                };
                                if let Some(parent_id) = parent_block_id.as_deref()
                                    && ledger
                                        .block_record_by_id(parent_id)
                                        .map(|b| b.is_none())
                                        .unwrap_or(true)
                                {
                                    match crate::consensus::validate_and_record_backfill_candidate(
                                        ledger.as_ref(),
                                        gossip,
                                    ) {
                                        Ok(candidate) => {
                                            let now = now_ms();
                                            orphan_buffer.insert(
                                                candidate.clone(),
                                                source_peer,
                                                0,
                                                now,
                                            );
                                            if let Some(peer) = source_peer
                                                && !blacklisted_peers.contains(&peer, now)
                                                && max_backfill_depth > 0
                                            {
                                                let req = BlockRequest {
                                                    block_id: parent_id.to_string(),
                                                };
                                                let rid = swarm
                                                    .behaviour_mut()
                                                    .block_sync
                                                    .send_request(&peer, req);
                                                prune_pending_backfill(&mut pending_backfill, now, pending_backfill_max, pending_backfill_ttl_ms);
                                                pending_backfill.insert(
                                                    rid,
                                                    PendingBackfillEntry {
                                                        block_id: parent_id.to_string(),
                                                        depth: 1,
                                                        inserted_at_ms: now,
                                                    },
                                                );
                                                println!(
                                                    "[P2P] 🕳️ ORPHAN BLOCK BUFFERED block={} missing_parent={} request_peer={}",
                                                    candidate.block_id, parent_id, peer
                                                );
                                            } else {
                                                println!(
                                                    "[P2P] 🕳️ ORPHAN BLOCK BUFFERED block={} missing_parent={} no_source_peer",
                                                    candidate.block_id, parent_id
                                                );
                                            }
                                        }
                                        Err(e) => {
                                            if let Some(peer) = source_peer {
                                                blacklisted_peers.insert(peer, now_ms());
                                            }
                                            println!(
                                                "[P2P] ❌ ORPHAN CANDIDATE REJECTED: {}",
                                                e.message()
                                            );
                                        }
                                    }
                                    continue;
                                }
                                match crate::consensus::apply_remote_block_from_gossip(
                                    ledger.clone(),
                                    mempool.clone(),
                                    gossip,
                                )
                                .await
                                {
                                    Ok(crate::consensus::RemoteBlockApplyOutcome::Applied {
                                        block_height,
                                        tx_count,
                                        evicted_count,
                                        state_root,
                                    }) => {
                                        println!(
                                            "[P2P] ✅ REMOTE BLOCK APPLIED height={} tx_count={} evicted_mempool={} state_root={}",
                                            block_height, tx_count, evicted_count, state_root
                                        );
                                    }
                                    Ok(crate::consensus::RemoteBlockApplyOutcome::ForkLost {
                                        reason,
                                    }) => {
                                        println!("[P2P] ⚠️ REMOTE FORK WINS BUT REORG UNSUPPORTED: {}", reason);
                                    }
                                    Ok(crate::consensus::RemoteBlockApplyOutcome::Skipped {
                                        reason,
                                    }) => {
                                        println!("[P2P] ⏭️ REMOTE BLOCK SKIPPED: {}", reason);
                                        let local_h = ledger.block_height().unwrap_or(0);
                                        let needs_catch_up = reason.contains("missing previous blocks")
                                            || block_height > local_h;
                                        if needs_catch_up {
                                            if let Some(source) = source_peer {
                                                let peer_s = source.to_string();
                                                let mut reg = hello_registry.lock().await;
                                                reg.note_peer_block_height(
                                                    &peer_s,
                                                    block_height,
                                                    local_h,
                                                );
                                                drop(reg);
                                            }
                                            try_start_catch_up(
                                                &block_sync_board,
                                                &catch_up_driver,
                                                &hello_registry,
                                                ledger.as_ref(),
                                                &mut swarm,
                                                &mut pending_catch_up_range,
                                            )
                                            .await;
                                        }
                                    }
                                    Err(e) => {
                                        println!(
                                            "[P2P] ❌ REMOTE BLOCK REJECTED: {}",
                                            e.message()
                                        );
                                    }
                                }
                            }
                            NetworkEvent::TxBroadcast { env } => {
                                match handle_tx_broadcast(&ledger, &mempool, env).await {
                                    TxGossipOutcome::Enqueued { tx_hash, mempool_len } => {
                                        println!(
                                            "[P2P] ✅ MEMPOOL TX ENQUEUED tx_hash={tx_hash} mempool_len={mempool_len}"
                                        );
                                    }
                                    TxGossipOutcome::AlreadyQueued { tx_hash } => {
                                        println!(
                                            "[P2P] ⏭️ MEMPOOL TX ALREADY QUEUED tx_hash={tx_hash}"
                                        );
                                    }
                                    TxGossipOutcome::AlreadyApplied { tx_hash } => {
                                        println!(
                                            "[P2P] ⏭️ MEMPOOL TX ALREADY MINED tx_hash={tx_hash}"
                                        );
                                    }
                                    TxGossipOutcome::Rejected { reason } => {
                                        crate::metrics::inc_gossip_rejected();
                                        println!("[P2P] ❌ MEMPOOL TX REJECTED: {reason}");
                                    }
                                }
                            }
                            ev @ (NetworkEvent::TmailGossip { .. }
                            | NetworkEvent::TmailBurnRevoke { .. }
                            | NetworkEvent::TmailAnonRegistration { .. }) => {
                                // Tmail plane (spec §A.1, §A.3.2). Both branches live in
                                // `handle_tmail_network_event` so the receive path is one
                                // testable function rather than logic buried in this loop;
                                // off-ledger, and never re-broadcast on receipt.
                                match handle_tmail_network_event(&tmail_store, &ev) {
                                    TmailGossipOutcome::Stored { msg_id } => {
                                        println!("[P2P] ✅ TMAIL ENVELOPE STORED msg_id={msg_id}");
                                        // Announce-then-PULL. An anonymous envelope carries only
                                        // the receipt's hash, so verification needs a fetch. Do it
                                        // on ARRIVAL: the verdict is stored with the message, so a
                                        // receiver offline for days still reads a checked result,
                                        // and the registry root window only has to cover
                                        // send -> verify rather than send -> inbox-open.
                                        if let Some(env) = tmail_store.get_by_msg_id(&msg_id)
                                            && let Some(anon) = env.anonymous.as_ref()
                                        {
                                            let hash = anon.anchor_proof.receipt_sha256_hex.clone();
                                            let _ = tmail_store.set_anon_verdict(
                                                &msg_id,
                                                &crate::tmail::store::AnonVerdict::Pending,
                                            );
                                            if tmail_store.get_anon_receipt(&hash).is_some() {
                                                // Already cached (another message used the same
                                                // proof, or we served it earlier): verify now.
                                                if let Some(bytes) = tmail_store.get_anon_receipt(&hash) {
                                                    let verdict = crate::tmail::anon::verify_anonymous_proof(
                                                        &tmail_store, &env, &bytes,
                                                    );
                                                    let _ = tmail_store.set_anon_verdict(&msg_id, &verdict);
                                                }
                                            } else {
                                                // Ask whoever we can. Content-addressed, so asking
                                                // the wrong peer is harmless.
                                                let targets: Vec<PeerId> = swarm
                                                    .connected_peers()
                                                    .copied()
                                                    .collect();
                                                if targets.is_empty() {
                                                    println!("[P2P][anon-receipt] no peer to pull {hash} from; stays pending");
                                                }
                                                for peer in targets {
                                                    let req = AnonReceiptRequest {
                                                        v: 1,
                                                        receipt_sha256_hex: hash.clone(),
                                                    };
                                                    let _ = swarm
                                                        .behaviour_mut()
                                                        .anon_receipt
                                                        .send_request(&peer, req);
                                                }
                                            }
                                        }
                                    }
                                    TmailGossipOutcome::Duplicate { msg_id } => {
                                        println!(
                                            "[P2P] ⏭️ TMAIL ENVELOPE ALREADY STORED OR BURNED msg_id={msg_id}"
                                        );
                                    }
                                    TmailGossipOutcome::Burned { msg_id } => {
                                        println!("[P2P] 🔥 TMAIL BURNED msg_id={msg_id}");
                                    }
                                    TmailGossipOutcome::AlreadyBurned { msg_id } => {
                                        println!("[P2P] ⏭️ TMAIL ALREADY BURNED msg_id={msg_id}");
                                    }
                                    TmailGossipOutcome::UnknownBurnTarget { msg_id } => {
                                        println!(
                                            "[P2P] ⏭️ TMAIL BURN REVOKE FOR UNKNOWN msg_id={msg_id}"
                                        );
                                    }
                                    TmailGossipOutcome::Registered { wallet_id, outcome } => {
                                        println!(
                                            "[P2P] 📇 ANON REGISTRATION {outcome} wallet={wallet_id}"
                                        );
                                    }
                                    TmailGossipOutcome::Rejected { reason } => {
                                        crate::metrics::inc_gossip_rejected();
                                        println!("[P2P] ❌ TMAIL EVENT REJECTED: {reason}");
                                    }
                                }
                            }
                            NetworkEvent::FileAnnounce { envelope } => {
                                // File Sharing announce from a peer: verify the hybrid signature, then
                                // buffer the envelope metadata in the node-local store so the offline
                                // receiver can list it. The encrypted body is pulled separately
                                // (REST). Off-ledger; never re-broadcast on receipt.
                                match crate::files::verify_file_envelope_v1(&envelope) {
                                    Ok(()) => match file_store.store_meta(&envelope) {
                                        Ok(true) => {
                                            println!(
                                                "[P2P] ✅ FILE ENVELOPE STORED file_id={} sender={} receiver={}",
                                                envelope.file_id,
                                                envelope.sender_wallet_id,
                                                envelope.receiver_wallet_id
                                            );
                                        }
                                        Ok(false) => {
                                            println!(
                                                "[P2P] ⏭️ FILE ENVELOPE ALREADY STORED file_id={}",
                                                envelope.file_id
                                            );
                                        }
                                        Err(e) => {
                                            println!("[P2P] ❌ FILE META STORE FAILED: {e}");
                                        }
                                    },
                                    Err(e) => {
                                        println!("[P2P] ❌ FILE ENVELOPE REJECTED: {e}");
                                    }
                                }
                            }
                            NetworkEvent::TransferExecuted { .. } | NetworkEvent::FaucetExecuted { .. } => {
                                // Rejected above, so the mesh stops forwarding it; never applied.
                                println!("[P2P] ❌ GOSSIP BALANCE EVENT REFUSED: balances change only through block apply");
                            }
                        }
                    }
                    Err(e) => {
                        if let Some(source) = source_peer.as_ref() {
                            let _ = swarm.behaviour_mut().gossipsub.report_message_validation_result(
                                &message_id,
                                source,
                                gossipsub::MessageAcceptance::Reject,
                            );
                        }
                        println!(
                            "[P2P] 📢 GOSSIP RECEIVED (unparsed): {} (err={})",
                            message_data, e
                        );
                    }
                }
            }
            SwarmEvent::Behaviour(Event::FilesFetch(ev)) => match ev {
                request_response::Event::Message {
                    message:
                        request_response::Message::Request {
                            request, channel, ..
                        },
                    peer,
                    ..
                } => {
                    // Serve the encrypted blob from the node-local store (blind relay; TTL
                    // respected by `get_blob`). `from_blob` re-hashes so the requester can verify
                    // integrity against the announced `file_sha256`.
                    let file_id = request.file_id;
                    let resp = match file_store.get_blob(&file_id.to_string()) {
                        Some(blob) => crate::files::FileFetchResponse::from_blob(file_id, &blob),
                        None => crate::files::FileFetchResponse::not_found(file_id),
                    };
                    let found = resp.found;
                    let _ = swarm.behaviour_mut().files_fetch.send_response(channel, resp);
                    println!(
                        "[P2P] 📦 FILES FETCH SERVED file_id={file_id} peer={peer} found={found}"
                    );
                }
                request_response::Event::Message {
                    message:
                        request_response::Message::Response {
                            request_id,
                            response,
                        },
                    ..
                } => {
                    if let Some(resp_tx) = pending_files_fetch.remove(&request_id) {
                        let _ = resp_tx.send(Ok(response));
                    }
                }
                request_response::Event::OutboundFailure {
                    request_id, error, ..
                } => {
                    if let Some(resp_tx) = pending_files_fetch.remove(&request_id) {
                        let _ = resp_tx.send(Err(format!("files fetch outbound failure: {error}")));
                    }
                }
                request_response::Event::InboundFailure { peer, error, .. } => {
                    println!("[P2P] ❌ FILES FETCH INBOUND FAILURE peer={peer} err={error}");
                }
                request_response::Event::ResponseSent { .. } => {}
            },
            SwarmEvent::Behaviour(Event::Ping(ev)) => {
                let ping::Event { peer, result, .. } = ev;
                match result {
                    Ok(rtt) => {
                        println!(
                            "[P2P] PING OK peer_id={} rtt_ms={}",
                            peer,
                            rtt.as_millis()
                        );
                        log::debug!(
                            "[p2p][mdns] ping_ok peer_id={peer} rtt_ms={}",
                            rtt.as_millis()
                        );
                    }
                    Err(e) => {
                        println!("[P2P] PING FAIL peer_id={} err={}", peer, e);
                        log::warn!("[p2p][mdns] ping_fail peer_id={peer} err={e}");
                    }
                }
            }
            _ => {}
        }}
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use libp2p::core::transport::MemoryTransport;
    use libp2p::swarm::SwarmEvent;
    use tokio::time::{Duration as TokioDuration, timeout};

    /// Same swarm, but with the gossip transmit cap overridable — a peer that ignores the
    /// network's limit is exactly the case being tested, and it cannot be built with the honest
    /// builder.
    pub(crate) fn build_memory_swarm_with_cap(max_transmit: usize) -> Swarm<TetBehaviour> {
        build_memory_swarm_inner(max_transmit)
    }

    pub(crate) fn build_memory_swarm() -> Swarm<TetBehaviour> {
        build_memory_swarm_inner(DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES)
    }

    fn build_memory_swarm_inner(max_transmit: usize) -> Swarm<TetBehaviour> {
        let keypair = identity::Keypair::generate_ed25519();
        let peer_id = PeerId::from(keypair.public());

        let transport = MemoryTransport::default()
            .upgrade(upgrade::Version::V1)
            .authenticate(noise::Config::new(&keypair).expect("noise config"))
            .multiplex(yamux::Config::default())
            .timeout(Duration::from_secs(20))
            .boxed();

        let mdns =
            mdns::tokio::Behaviour::new(mdns::Config::default(), peer_id).expect("mdns behaviour");
        let ping = ping::Behaviour::new(
            ping::Config::new()
                .with_interval(Duration::from_secs(10))
                .with_timeout(Duration::from_secs(20)),
        );
        let gossipsub_config = gossipsub::ConfigBuilder::default()
            .validation_mode(gossipsub::ValidationMode::Strict)
            .validate_messages()
            .max_transmit_size(max_transmit)
            // Tests should not depend on heartbeat/mesh timing.
            .flood_publish(true)
            .build()
            .expect("gossipsub config");
        let gossipsub = gossipsub::Behaviour::new(
            gossipsub::MessageAuthenticity::Signed(keypair.clone()),
            gossipsub_config,
        )
        .expect("gossipsub behaviour");

        let identify = identify::Behaviour::new(
            identify::Config::new("/tet/identify/1.0.0".to_string(), keypair.public())
                .with_agent_version(format!("tet-core/{}", env!("CARGO_PKG_VERSION"))),
        );

        let store = kad::store::MemoryStore::new(peer_id);
        let mut kademlia = kad::Behaviour::new(peer_id, store);
        kademlia.set_mode(Some(kad::Mode::Server));

        let behaviour = TetBehaviour {
            mdns,
            ping,
            gossipsub,
            identify,
            kademlia,
            block_sync: block_sync_behaviour(),
            chain_sync_hello: chain_sync_hello_behaviour(),
            chain_sync_range: chain_sync_range_behaviour(),
            files_fetch: files_fetch_behaviour(),
            tx_submit: tx_submit_behaviour(),
        anon_register: anon_register_behaviour(),
        anon_receipt: anon_receipt_behaviour(),
        anon_sync: anon_sync_behaviour(),
        };

        Swarm::new(
            transport,
            behaviour,
            peer_id,
            libp2p::swarm::Config::with_tokio_executor(),
        )
    }

    #[tokio::test]
    async fn tetbehaviour_gossipsub_message_propagates_between_two_swarms() {
        let mut a = build_memory_swarm();
        let mut b = build_memory_swarm();

        let ident_topic = gossipsub::IdentTopic::new(BLOCKS_TOPIC);
        let topic_hash = ident_topic.hash();
        a.behaviour_mut()
            .gossipsub
            .subscribe(&ident_topic)
            .expect("sub A");
        b.behaviour_mut()
            .gossipsub
            .subscribe(&ident_topic)
            .expect("sub B");

        // Listen on deterministic memory addrs and dial.
        let a_addr: Multiaddr = "/memory/10001".parse().unwrap();
        a.listen_on(a_addr.clone()).unwrap();
        b.listen_on("/memory/10002".parse().unwrap()).unwrap();
        b.dial(a_addr).unwrap();

        // Drive both swarms until connected and message received.
        let a_peer = *a.local_peer_id();
        let b_peer = *b.local_peer_id();
        let payload = br#"{"kind":"block_mined","block_height":1,"block_id":"t","txs":[]}"#;

        let fut = async {
            let mut a_connected = false;
            let mut b_connected = false;
            let mut a_saw_b_sub = false;
            let mut published = false;
            loop {
                tokio::select! {
                    ev = a.select_next_some() => {
                        match ev {
                            SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                                if peer_id == b_peer {
                                    a_connected = true;
                                    a.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                                }
                            }
                            SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Subscribed { peer_id, topic })) => {
                                if peer_id == b_peer && topic == topic_hash {
                                    a_saw_b_sub = true;
                                }
                            }
                            _ => {}
                        }
                    }
                    ev = b.select_next_some() => {
                        match ev {
                            SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                                if peer_id == a_peer {
                                    b_connected = true;
                                    b.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                                }
                            }
                            SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Message { message, .. })) => {
                                assert_eq!(message.data, payload);
                                return;
                            }
                            _ => {}
                        }
                    }
                }

                if a_connected && b_connected && a_saw_b_sub && !published {
                    // Publish only after B's subscription is observed to avoid `InsufficientPeers`.
                    a.behaviour_mut()
                        .gossipsub
                        .publish(ident_topic.clone(), payload)
                        .expect("publish");
                    published = true;
                }
            }
        };

        timeout(TokioDuration::from_secs(6), fut)
            .await
            .expect("timeout waiting for gossipsub message");
    }

    #[tokio::test]
    async fn memory_transport_block_request_response_round_trips() {
        let mut a = build_memory_swarm();
        let mut b = build_memory_swarm();

        let a_addr: Multiaddr = "/memory/10011".parse().unwrap();
        a.listen_on(a_addr.clone()).unwrap();
        b.listen_on("/memory/10012".parse().unwrap()).unwrap();
        b.dial(a_addr).unwrap();

        let a_peer = *a.local_peer_id();
        let b_peer = *b.local_peer_id();
        let wanted = "0xmissing-parent".to_string();

        let fut = async {
            let mut request_sent = false;
            loop {
                tokio::select! {
                    ev = a.select_next_some() => match ev {
                        SwarmEvent::ConnectionEstablished { peer_id, .. } if peer_id == b_peer && !request_sent => {
                            a.behaviour_mut().block_sync.send_request(
                                &b_peer,
                                BlockRequest {
                                    block_id: wanted.clone(),
                                },
                            );
                            request_sent = true;
                        }
                        SwarmEvent::Behaviour(Event::BlockSync(request_response::Event::Message {
                            message: request_response::Message::Response { response, .. },
                            ..
                        })) => {
                            assert_eq!(response.block_id, wanted);
                            assert!(response.block.is_none());
                            return;
                        }
                        _ => {}
                    },
                    ev = b.select_next_some() => match ev {
                        SwarmEvent::ConnectionEstablished { peer_id, .. } if peer_id == a_peer => {}
                        SwarmEvent::Behaviour(Event::BlockSync(request_response::Event::Message {
                            message: request_response::Message::Request { request, channel, .. },
                            ..
                        })) => {
                            assert_eq!(request.block_id, wanted);
                            b.behaviour_mut().block_sync.send_response(
                                channel,
                                BlockResponse {
                                    block_id: request.block_id,
                                    block: None,
                                },
                            ).expect("send response");
                        }
                        _ => {}
                    },
                }
            }
        };

        timeout(TokioDuration::from_secs(6), fut)
            .await
            .expect("timeout waiting for block sync response");
    }

    #[test]
    fn orphan_buffer_enforces_capacity_and_ttl() {
        let mut buffer = OrphanBuffer::new(2, 10);
        let mk = |id: &str, parent: &str| crate::ledger::BlockRecordV1 {
            v: 1,
            height: 1,
            block_id: id.to_string(),
            parent_block_id: Some(parent.to_string()),
            producer_id: "producer".to_string(),
            tx_hashes: Vec::new(),
            txs: Vec::new(),
            state_root: "root".to_string(),
            reward: crate::ledger::BlockRewardRecordV1 {
                base_reward_micro: 0,
                compute_reward_micro: 0,
                total_reward_micro: 0,
            },
            caac_weight: 1,
            cumulative_weight: 1,
            canonical: false,
            ts_ms: 1,
        };

        buffer.insert(mk("a", "p"), None, 0, 1);
        buffer.insert(mk("b", "p"), None, 0, 2);
        buffer.insert(mk("c", "p"), None, 0, 3);
        assert_eq!(buffer.len(), 2);
        assert!(buffer.remove("a").is_none());
        assert_eq!(buffer.children_of("p", 20).len(), 0);
    }

    /// **An oversized frame never reaches the application, it costs the sender its connection,
    /// and the node keeps serving everyone else.** (QA matrix gap #2.)
    ///
    /// Three swarms: a hostile peer configured with a transmit cap above the network's (the honest
    /// builder cannot produce the frame at all), the node under test, and an honest peer.
    ///
    /// Two things were measured here rather than assumed, and both were the opposite of what I
    /// expected when writing this test:
    ///
    /// 1. The frame never reaches TET code. libp2p enforces `max_transmit_size` on the way IN, so
    ///    the application-level length check in the swarm loop is a second line of defence, not the
    ///    first. It still matters for a transport that does not enforce a limit, and for any path
    ///    that raises the cap.
    /// 2. The oversized frame COSTS THE SENDER ITS CONNECTION. Measured directly: with the
    ///    oversized publish skipped, an honest frame from the same peer arrives in 0.04s; with it,
    ///    nothing from that peer arrives in 30s. That is a reasonable response to a protocol
    ///    violation — and it is worth knowing, because it means a hostile peer can cost itself the
    ///    link and then redial, which is connection churn rather than a silent drop.
    ///
    /// So what this asserts is the property that actually matters for a node on a public port:
    /// **one hostile peer cannot take the node off the air for anybody else.**
    #[tokio::test]
    async fn oversized_gossip_frame_costs_that_peer_only_and_the_node_keeps_serving_others() {
        let cap = DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES;
        let mut hostile = build_memory_swarm_with_cap(cap * 4);
        let mut node = build_memory_swarm();
        let mut honest = build_memory_swarm();

        let ident_topic = gossipsub::IdentTopic::new(BLOCKS_TOPIC);
        for sw in [&mut hostile, &mut node, &mut honest] {
            sw.behaviour_mut().gossipsub.subscribe(&ident_topic).expect("subscribe");
        }

        let addr: libp2p::Multiaddr = "/memory/2101".parse().unwrap();
        node.listen_on(addr.clone()).expect("listen");
        hostile.dial(addr.clone()).expect("dial from hostile");
        honest.dial(addr).expect("dial from honest");

        let oversize = vec![7u8; cap + 3 * 1024]; // 131 KiB against a 128 KiB cap
        const HONEST_PREFIX: &[u8] = b"{\"kind\":\"honest\"";
        assert!(oversize.len() > cap, "the frame must exceed the cap or this proves nothing");

        let mut hostile_subscribed = false;
        let mut sent_oversize = false;
        let mut honest_attempts = 0u32;
        let (mut oversize_seen, mut honest_delivered) = (false, false);

        let outcome = timeout(TokioDuration::from_secs(45), async {
            loop {
                tokio::select! {
                    ev = hostile.select_next_some() => {
                        if let SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Subscribed { .. })) = ev {
                            hostile_subscribed = true;
                        }
                        if hostile_subscribed && !sent_oversize {
                            hostile.behaviour_mut().gossipsub
                                .publish(ident_topic.clone(), oversize.clone())
                                .expect("the hostile peer publishes it happily");
                            sent_oversize = true;
                        }
                    }
                    ev = honest.select_next_some() => {
                        // Keep offering an honest frame; retried with a varying payload because
                        // gossipsub dedups by message id and the mesh grafts on a heartbeat.
                        if matches!(ev, SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Subscribed { .. })))
                            || honest_attempts > 0
                        {
                            if sent_oversize && honest_attempts < 200 {
                                honest_attempts += 1;
                                let mut payload = HONEST_PREFIX.to_vec();
                                payload.extend_from_slice(format!(",\"n\":{honest_attempts}}}").as_bytes());
                                let _ = honest.behaviour_mut().gossipsub.publish(ident_topic.clone(), payload);
                            } else if honest_attempts == 0 {
                                honest_attempts = 1;
                            }
                        }
                    }
                    ev = node.select_next_some() => {
                        if let SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Message { message, .. })) = ev {
                            if message.data.len() > cap {
                                oversize_seen = true;
                                break;
                            }
                            if message.data.starts_with(HONEST_PREFIX) {
                                honest_delivered = true;
                                break;
                            }
                        }
                    }
                }
            }
        }).await;

        assert!(outcome.is_ok(),
            "timed out: oversize_seen={oversize_seen} honest_delivered={honest_delivered} attempts={honest_attempts}");
        assert!(!oversize_seen, "a frame above the cap must never reach the application");
        assert!(
            honest_delivered,
            "one hostile peer must not take the node off the air: an honest peer's frame must \
             still be delivered after the oversized one"
        );
    }

    /// **A malformed frame of legal size is rejected, and the node keeps serving.**
    ///
    /// Size is not the only hostile input. This frame is small enough to pass every length check
    /// and is not valid JSON, so it exercises the decode path — the one in front of every handler
    /// the rest of the suite tests directly.
    #[tokio::test]
    async fn malformed_gossip_frame_is_rejected_and_the_node_keeps_serving() {
        let mut a = build_memory_swarm();
        let mut b = build_memory_swarm();

        let ident_topic = gossipsub::IdentTopic::new(BLOCKS_TOPIC);
        a.behaviour_mut().gossipsub.subscribe(&ident_topic).expect("sub A");
        b.behaviour_mut().gossipsub.subscribe(&ident_topic).expect("sub B");

        let addr: libp2p::Multiaddr = "/memory/2102".parse().unwrap();
        b.listen_on(addr.clone()).expect("listen B");
        a.dial(addr).expect("dial B");

        // Truncated: the opening brace of a NetworkEvent and nothing else.
        let truncated = b"{\"kind\":\"block_gossip\",\"blo".to_vec();
        let honest = b"{\"kind\":\"honest\"}".to_vec();
        assert!(serde_json::from_slice::<serde_json::Value>(&truncated).is_err(),
            "the frame must genuinely fail to decode");

        let mut subscribed = false;
        let (mut sent_bad, mut sent_honest) = (false, false);
        let (mut rejected_bad, mut honest_delivered) = (false, false);

        let outcome = timeout(TokioDuration::from_secs(30), async {
            loop {
                tokio::select! {
                    ev = a.select_next_some() => {
                        if let SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Subscribed { .. })) = ev {
                            subscribed = true;
                        }
                        if subscribed && !sent_bad {
                            a.behaviour_mut().gossipsub.publish(ident_topic.clone(), truncated.clone()).expect("publish malformed");
                            sent_bad = true;
                        }
                    }
                    ev = b.select_next_some() => {
                        if let SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Message { message_id, message, .. })) = ev {
                            if message.data == truncated {
                                assert!(serde_json::from_slice::<crate::models::NetworkEvent>(&message.data).is_err(),
                                    "decode must fail on the receiving side too");
                                if let Some(src) = message.source.as_ref() {
                                    let penalised = b.behaviour_mut().gossipsub.report_message_validation_result(
                                        &message_id, src, gossipsub::MessageAcceptance::Reject,
                                    );
                                    assert!(penalised, "peer penalty must apply");
                                }
                                rejected_bad = true;
                                if !sent_honest {
                                    a.behaviour_mut().gossipsub.publish(ident_topic.clone(), honest.clone()).expect("honest publish");
                                    sent_honest = true;
                                }
                            } else if message.data == honest {
                                honest_delivered = true;
                                break;
                            }
                        }
                    }
                }
            }
        }).await;

        assert!(outcome.is_ok(), "timed out: rejected_bad={rejected_bad} honest_delivered={honest_delivered}");
        assert!(rejected_bad, "a frame that cannot decode must be rejected, not passed to a handler");
        assert!(honest_delivered, "the node must keep serving after rejecting a malformed frame");
    }

/// Drive `hostile` then `honest` across three real swarms into the production handler.
///
/// Returns `(hostile_outcome, honest_outcome)`. The honest message is published only after the
/// hostile one has been handled, so "kept serving" is ordered rather than coincidental.
pub(crate) async fn hostile_then_honest_over_a_swarm(
    port: u16,
    store: &std::sync::Arc<crate::tmail::store::TmailStore>,
    hostile: crate::models::NetworkEvent,
    honest: crate::models::NetworkEvent,
) -> (TmailGossipOutcome, TmailGossipOutcome) {

    let mut hostile_sw = build_memory_swarm();
    let mut node = build_memory_swarm();
    let mut honest_sw = build_memory_swarm();

    let topic = gossipsub::IdentTopic::new(TMAIL_TOPIC);
    for sw in [&mut hostile_sw, &mut node, &mut honest_sw] {
        sw.behaviour_mut().gossipsub.subscribe(&topic).expect("subscribe");
    }
    let addr: libp2p::Multiaddr = format!("/memory/{port}").parse().unwrap();
    node.listen_on(addr.clone()).expect("listen");
    hostile_sw.dial(addr.clone()).expect("dial hostile");
    honest_sw.dial(addr).expect("dial honest");

    let hostile_bytes = serde_json::to_vec(&hostile).unwrap();
    let honest_bytes = serde_json::to_vec(&honest).unwrap();

    let (mut hostile_sent, mut honest_attempts) = (false, 0u32);
    let (mut hostile_out, mut honest_out) = (None, None);

    let run = tokio::time::timeout(std::time::Duration::from_secs(45), async {
        loop {
            tokio::select! {
                ev = hostile_sw.select_next_some() => {
                    if matches!(ev, SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Subscribed { .. }))) && !hostile_sent {
                        hostile_sw.behaviour_mut().gossipsub
                            .publish(topic.clone(), hostile_bytes.clone()).expect("hostile publish");
                        hostile_sent = true;
                    }
                }
                ev = honest_sw.select_next_some() => {
                    // Retried: gossipsub dedups by message id and the mesh grafts on a heartbeat,
                    // so a single publish can lose a race that has nothing to do with the subject.
                    if hostile_out.is_some() && honest_attempts < 200 {
                        honest_attempts += 1;
                        let _ = honest_sw.behaviour_mut().gossipsub.publish(topic.clone(), honest_bytes.clone());
                    }
                    let _ = ev;
                }
                ev = node.select_next_some() => {
                    if let SwarmEvent::Behaviour(Event::Gossipsub(gossipsub::Event::Message { message, .. })) = ev {
                        // The production decode + handler, on bytes that crossed a wire.
                        let Ok(decoded) = serde_json::from_slice::<crate::models::NetworkEvent>(&message.data) else { continue };
                        let outcome = handle_tmail_network_event(store, &decoded);
                        if message.data == hostile_bytes {
                            hostile_out = Some(outcome);
                        } else {
                            honest_out = Some(outcome);
                            break;
                        }
                    }
                }
            }
        }
    }).await;

    assert!(run.is_ok(), "timed out: hostile={hostile_out:?} honest={honest_out:?} attempts={honest_attempts}");
    (hostile_out.expect("hostile message never arrived"), honest_out.expect("honest message never arrived"))
}
}
