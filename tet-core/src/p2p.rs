//! Local P2P "nervous system" (mDNS discovery, liveness, gossipsub, and block-sync RPC).
//!
//! Scope: establish that multiple nodes can discover peers, exchange signed transaction/block
//! messages, and maintain lightweight sync/backfill channels around the ledger.

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

pub const BLOCKS_TOPIC: &str = "/tet/v1/blocks";
pub const TXS_TOPIC: &str = "/tet/v1/txs";
pub const AI_WORKLOAD_TOPIC: &str = "/tet/v1/ai-workload";
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
            swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer);
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

fn network_event_topics(
    msg: &str,
    blocks_topic: &gossipsub::IdentTopic,
    txs_topic: &gossipsub::IdentTopic,
    ai_topic: &gossipsub::IdentTopic,
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
        Ok(NetworkEvent::TransferExecuted { .. })
        | Ok(NetworkEvent::FaucetExecuted { .. })
        | Ok(NetworkEvent::TxBroadcast { .. }) => {
            vec![txs_topic.clone()]
        }
        Err(_) => vec![txs_topic.clone()],
    }
}

/// Start a libp2p swarm task and return a Sender you can use to publish gossip messages.
pub fn start_mdns_ping_swarm(
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    keypair: identity::Keypair,
    listen: Multiaddr,
    hello_registry: SharedHelloRegistry,
    catch_up_driver: SharedCatchUpDriver,
    block_sync_board: SharedBlockSyncBoard,
) -> Result<(mpsc::Sender<String>, tokio::task::JoinHandle<()>), AnyErr> {
    let (tx, rx) = mpsc::channel::<String>(256);
    let join = tokio::spawn(async move {
        if let Err(e) = run_mdns_ping_swarm(
            ledger,
            mempool,
            rx,
            keypair,
            listen,
            hello_registry,
            catch_up_driver,
            block_sync_board,
        )
        .await
        {
            println!("[P2P] Swarm task exited: {e}");
            log::warn!("[p2p][mdns] swarm exited: {e}");
        }
    });
    Ok((tx, join))
}

/// Run the block-plane libp2p swarm (gossip + chain-sync RPC).
/// Listens on `listen` (typically `TET_P2P_LISTEN` from `main.rs`).
async fn run_mdns_ping_swarm(
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    mut publish_rx: mpsc::Receiver<String>,
    keypair: identity::Keypair,
    listen: Multiaddr,
    hello_registry: SharedHelloRegistry,
    catch_up_driver: SharedCatchUpDriver,
    block_sync_board: SharedBlockSyncBoard,
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
        .max_messages_per_rpc(Some(32))
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
    for topic in [BLOCKS_TOPIC, TXS_TOPIC, AI_WORKLOAD_TOPIC] {
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
    println!("[P2P] Subscribed to sharded topics: {BLOCKS_TOPIC}, {TXS_TOPIC}");

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
                        swarm.behaviour_mut().gossipsub.add_explicit_peer(&pid);
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
    let chain_hello_interval_ms = chain_hello_interval_sec_from_env().saturating_mul(1000);
    let mut last_chain_hello_sent_at: HashMap<PeerId, u64> = HashMap::new();
    let kad_bootstrap_interval_ms = kad_bootstrap_interval_sec_from_env().saturating_mul(1000);
    let mut last_kad_bootstrap_at: u64 = now_ms();
    let mut catch_up_interval = tokio::time::interval(Duration::from_secs(1));
    catch_up_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
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
                    for peer in due_peers {
                        match build_chain_hello(ledger.as_ref()) {
                            Ok(our_hello) => {
                                swarm
                                    .behaviour_mut()
                                    .chain_sync_hello
                                    .send_request(&peer, our_hello);
                                bootnode_watch.on_hello_sent(peer);
                                last_chain_hello_sent_at.insert(peer, now);
                                println!("[P2P-block] 🔁 chain_hello periodic resend to {peer}");
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
            maybe_msg = publish_rx.recv() => {
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
                    let topics = network_event_topics(&msg, &blocks_topic, &txs_topic, &ai_workload_topic);
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
                            }
                        }
                    }
                } else {
                    println!("[P2P] publish channel closed; stopping swarm.");
                    break;
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
                swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                println!("[P2P] 🪪 IDENTIFY RECEIVED from {}", peer_id);
            }
            SwarmEvent::Behaviour(Event::Kademlia(ev)) => {
                // Keep it noisy for debugging while stabilizing Phase 2 network discovery.
                log::debug!("[p2p][kad] event={ev:?}");
            }
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
                    let response = match build_chain_hello(ledger.as_ref()) {
                        Ok(h) => h,
                        Err(e) => {
                            log::warn!("[p2p][chain-sync] hello build failed: {e}");
                            ChainHello {
                                chain_id: crate::ledger::chain_id_from_env(),
                                block_height: ledger.block_height().unwrap_or(0),
                                tip_block_id: String::new(),
                                state_root: ledger.compute_state_root(),
                            }
                        }
                    };
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
                    let response =
                        build_chain_sync_range_response(ledger.as_ref(), &request);
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
                        let block = ledger
                            .block_record_by_id(&request.block_id)
                            .ok()
                            .flatten();
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
                if peer_id != *swarm.local_peer_id() {
                    swarm
                        .behaviour_mut()
                        .gossipsub
                        .add_explicit_peer(&peer_id);
                    match build_chain_hello(ledger.as_ref()) {
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
                                gossipsub::MessageAcceptance::Accept,
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
                                // Pending mempool tx from a peer: verify the hybrid signature
                                // and enqueue locally so a producer can mine it. Never mutate
                                // the ledger here.
                                match crate::consensus::tx_hash_for_env(&env) {
                                    Ok(tx_hash) => {
                                        let mut mp = mempool.lock().await;
                                        let dup = mp.iter().any(|e| {
                                            crate::consensus::tx_hash_for_env(e)
                                                .map(|h| h == tx_hash)
                                                .unwrap_or(false)
                                        });
                                        if dup {
                                            println!(
                                                "[P2P] ⏭️ MEMPOOL TX ALREADY QUEUED tx_hash={tx_hash}"
                                            );
                                        } else {
                                            mp.push(env);
                                            println!(
                                                "[P2P] ✅ MEMPOOL TX ENQUEUED tx_hash={tx_hash} mempool_len={}",
                                                mp.len()
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        println!("[P2P] ❌ MEMPOOL TX REJECTED (bad signature): {e}");
                                    }
                                }
                            }
                            other => match ledger.apply_remote_event(&other) {
                                Ok(true) => {
                                    println!("[P2P] ✅ REMOTE EVENT APPLIED to local ledger");
                                }
                                Ok(false) => {
                                    println!("[P2P] ⏭️ REMOTE EVENT ALREADY APPLIED (idempotent)");
                                }
                                Err(e) => {
                                    println!("[P2P] ❌ REMOTE EVENT APPLY FAILED: {}", e);
                                }
                            },
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
mod tests {
    use super::*;
    use libp2p::core::transport::MemoryTransport;
    use libp2p::swarm::SwarmEvent;
    use tokio::time::{Duration as TokioDuration, timeout};

    fn build_memory_swarm() -> Swarm<TetBehaviour> {
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
            .max_transmit_size(DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES)
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
}
