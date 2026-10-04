use crate::ledger::Ledger;
use crate::worker_network::WorkerRegistry;
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;
use tokio::sync::broadcast;
use tokio::sync::mpsc;

use crate::protocol::SignedTxEnvelopeV1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct E2eeJobV1 {
    pub(crate) v: u32,
    pub(crate) job_id: String,
    pub(crate) worker_wallet: String,
    pub(crate) client_ephemeral_pub_b64: String,
    #[serde(default)]
    pub(crate) client_mlkem_pub_b64: String,
    pub(crate) nonce_b64: String,
    pub(crate) ciphertext_b64: String,
    #[serde(default)]
    pub(crate) mlkem_ciphertext_b64: String,
    pub(crate) created_at_ms: u128,
    pub(crate) completed: bool,
    pub(crate) result_nonce_b64: Option<String>,
    pub(crate) result_ciphertext_b64: Option<String>,
    pub(crate) result_mlkem_ciphertext_b64: Option<String>,
}

#[derive(Default)]
pub struct E2eeJobQueue {
    pub(crate) jobs: std::collections::HashMap<String, E2eeJobV1>,
    pub(crate) pending_by_worker:
        std::collections::HashMap<String, std::collections::VecDeque<String>>,
}

#[derive(Clone)]
pub struct RestState {
    pub ledger: Arc<Ledger>,
    /// This node's own wallet id (`TET_WALLET_ID`). Used to identify work this node
    /// performed itself — the local-inference fallback in `/ai/infer`. Replaced the
    /// Solana founder pubkey, which was read from a file absent in the image.
    pub wallet_id: String,
    pub p2p_tx: Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>,
    pub p2p_client: Option<crate::p2p_network::P2pClient>,
    pub gossip_tx: Option<mpsc::Sender<String>>,
    /// Per-node block-plane sync board (`None` when P2P / block swarm is disabled).
    pub block_sync_board: Option<crate::sync::SharedBlockSyncBoard>,
    /// Liveness beacon for the block-plane swarm event loop (`None` when block swarm is disabled).
    pub swarm_health: Option<crate::swarm_health::SharedSwarmHealth>,
    /// In-memory pending transactions (Phase 2 mempool).
    pub mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    /// Rebroadcast bookkeeping for txs **this node admitted over REST**: `tx_hash -> attempts`.
    ///
    /// Membership is the origin marker. `broadcast_mempool_tx` is called only from REST submit
    /// handlers, so a tx learned from a peer is never in this map and is therefore never
    /// re-published by us — that is what keeps a rebroadcast from becoming a gossip storm.
    pub pending_rebroadcast: Arc<Mutex<std::collections::HashMap<String, u32>>>,
    /// Tmail node-local TTL buffer + key directory (off-ledger; spec §A.1).
    pub tmail: Arc<crate::tmail::store::TmailStore>,
    /// File Sharing node-local blob/meta/inbox store (off-ledger; spec `PHASE_0_FILE_SHARING_SPEC.md`).
    pub files: Arc<crate::files::storage::FileStore>,
    /// Command channel into the block-plane swarm for `/tet/v1/files/fetch` body pulls
    /// (Step 4; `None` when the block swarm is disabled).
    pub files_fetch_tx: Option<mpsc::Sender<crate::p2p::FilesFetchCmd>>,
    /// Command channel for direct `/tet/v1/tx-submit` requests to bootnodes — the transaction
    /// equivalent of the pull-based block catch-up, and independent of gossip.
    /// Direct `/tet/v1/anon-register` channel. `None` disables the direct path only — gossip is
    /// unaffected, which is what makes the two paths independently testable.
    pub anon_register_tx: Option<tokio::sync::mpsc::Sender<crate::p2p::AnonRegisterCmd>>,
    pub tx_submit_tx: Option<mpsc::Sender<crate::p2p::TxSubmitCmd>>,
    pub http_ratelimit: Arc<Mutex<HttpRateLimit>>,
    pub workers: Arc<StdMutex<WorkerRegistry>>,
    pub e2ee_jobs: Arc<StdMutex<E2eeJobQueue>>,
    pub genesis_1k_lock: Arc<tokio::sync::Mutex<()>>,
    pub log_tx: broadcast::Sender<String>,
    pub log_sse_connections: Arc<AtomicUsize>,
}

#[derive(Debug, Clone)]
pub enum MempoolEnqueueError {
    TxTooLarge { bytes: usize, max_bytes: usize },
    Full { txs: usize, bytes: usize },
}

impl std::fmt::Display for MempoolEnqueueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TxTooLarge { bytes, max_bytes } => {
                write!(
                    f,
                    "transaction is too large for mempool: {bytes} > {max_bytes} bytes"
                )
            }
            Self::Full { txs, bytes } => write!(
                f,
                "mempool is full and incoming tx fee is not high enough to evict: txs={txs} bytes={bytes}"
            ),
        }
    }
}

impl RestState {
    pub fn mempool_max_txs() -> usize {
        std::env::var("TET_MEMPOOL_MAX_TXS")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(10_000)
    }

    pub fn mempool_max_bytes() -> usize {
        std::env::var("TET_MEMPOOL_MAX_BYTES")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(64 * 1024 * 1024)
    }

    pub fn tx_estimated_bytes(env: &SignedTxEnvelopeV1) -> usize {
        serde_json::to_vec(env)
            .map(|v| v.len())
            .unwrap_or(usize::MAX)
    }

    pub fn tx_fee_score(env: &SignedTxEnvelopeV1) -> u128 {
        match &env.tx {
            crate::protocol::TxV1::Transfer {
                amount_micro,
                fee_bps,
                ..
            } => crate::fees::charge(
                crate::fees::FeeKind::Transfer { fee_bps: *fee_bps },
                *amount_micro,
            )
            // An out-of-range fee_bps scores 0; the tx is rejected at apply anyway (FEE_SPEC §2.1).
            .map(|s| s.fee_micro() as u128)
            .unwrap_or(0),
            crate::protocol::TxV1::EnterpriseInference { amount_micro, .. } => {
                *amount_micro as u128
            }
            crate::protocol::TxV1::FileFee { fee_micro, .. } => *fee_micro as u128,
            crate::protocol::TxV1::WorkerRegister { .. } => 1,
            _ => 0,
        }
    }

    /// **The only way a locally-originated tx enters the mempool.** Admits it *and* registers it
    /// for delivery — gossip publish, direct `tx-submit` to bootnodes, and the retry sweep.
    ///
    /// There is deliberately no enqueue-only method on `RestState`. A handler that admits a tx
    /// without announcing it produces a transaction that sits in this node's mempool forever
    /// unless this node happens to be a producer — which is invisible in testing on a mining
    /// node and total on a follower. `/ledger/transfer` did exactly that until 2026-09-23: a
    /// follower could accept a signed transfer, return `202`, and never send it anywhere.
    ///
    /// Receive paths must NOT use this. A tx learned from a peer goes through
    /// [`enqueue_without_broadcast`] so we never re-publish what we were just told.
    pub async fn submit_local_tx(
        &self,
        env: SignedTxEnvelopeV1,
    ) -> Result<bool, MempoolEnqueueError> {
        let evicted = enqueue_without_broadcast(&self.mempool, env.clone()).await?;
        self.broadcast_mempool_tx(&env).await;
        Ok(evicted)
    }
}

/// Mempool admission **without announcing the tx**: size caps, byte caps, lowest-fee eviction.
///
/// For **receive paths only** — `p2p::handle_tx_broadcast` and the `tx-submit` RPC. A tx we were
/// just told about must not be re-published by us; that is what keeps the retry sweep from
/// becoming a gossip storm.
///
/// Locally-originated txs must go through [`RestState::submit_local_tx`] instead, which admits
/// *and* announces. The naming is deliberately blunt: a REST handler reaching past `RestState`
/// into `state.mempool` to call this is visible in review as doing something it should not.
///
/// Free function rather than a method because the block-plane swarm task holds only the mempool
/// `Arc`, not a `RestState`.
pub async fn enqueue_without_broadcast(
    mempool: &Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    env: SignedTxEnvelopeV1,
) -> Result<bool, MempoolEnqueueError> {
    use RestState as S;
    {
        let max_txs = S::mempool_max_txs();
        let max_bytes = S::mempool_max_bytes();
        let incoming_bytes = S::tx_estimated_bytes(&env);
        if incoming_bytes > max_bytes {
            return Err(MempoolEnqueueError::TxTooLarge {
                bytes: incoming_bytes,
                max_bytes,
            });
        }

        let incoming_fee = S::tx_fee_score(&env);
        let mut mp = mempool.lock().await;
        let mut total_bytes = mp.iter().map(S::tx_estimated_bytes).sum::<usize>();
        let mut evicted = false;

        while (mp.len() >= max_txs || total_bytes.saturating_add(incoming_bytes) > max_bytes)
            && !mp.is_empty()
        {
            let Some((idx, lowest_fee)) = mp
                .iter()
                .enumerate()
                .map(|(idx, existing)| (idx, S::tx_fee_score(existing)))
                .min_by_key(|(_, fee)| *fee)
            else {
                break;
            };
            if incoming_fee <= lowest_fee {
                return Err(MempoolEnqueueError::Full {
                    txs: mp.len(),
                    bytes: total_bytes,
                });
            }
            let removed = mp.remove(idx);
            total_bytes = total_bytes.saturating_sub(S::tx_estimated_bytes(&removed));
            evicted = true;
        }

        if mp.len() >= max_txs || total_bytes.saturating_add(incoming_bytes) > max_bytes {
            return Err(MempoolEnqueueError::Full {
                txs: mp.len(),
                bytes: total_bytes,
            });
        }
        mp.push(env);
        Ok(evicted)
    }
}

impl RestState {

    /// Best-effort broadcast of a pending mempool tx to peers over the block-plane
    /// gossip (`txs` topic), so that any producer node can include it in a block.
    ///
    /// This never mutates a ledger; it only propagates the signed envelope. Peers
    /// re-verify the hybrid signature before enqueuing into their own mempool.
    pub async fn broadcast_mempool_tx(&self, env: &SignedTxEnvelopeV1) {
        // Two independent paths, deliberately not nested: gossip for fan-out, and a direct
        // request to our bootnodes. Either can be unavailable without disabling the other —
        // which matters, because the failure this exists for is gossip being silently
        // unusable while the connection to the peer is perfectly healthy.
        if self.gossip_tx.is_some() || self.tx_submit_tx.is_some() {
            // Record as locally-originated BEFORE publishing, not after: the first publish
            // frequently fails. A tx submitted in the seconds after a peer connects hits
            // gossipsub `InsufficientPeers` because the txs-topic mesh has not grafted yet.
            // Registering first means the retry loop owns it regardless of what happens next.
            if let Ok(tx_hash) = crate::consensus::tx_hash_for_env(env) {
                // Durable before in-memory: a crash between the two should leave a transaction
                // that gets restored, not one that was acknowledged and forgotten.
                self.ledger.mempool_persist(&tx_hash, env);
                self.pending_rebroadcast.lock().await.insert(tx_hash, 0);
            }
        }
        self.gossip_mempool_tx(env).await;
        self.direct_submit_to_peers(env).await;
    }

    /// Publish a pending tx on the block-plane `txs` gossip topic. No-op without a gossip channel.
    pub async fn gossip_mempool_tx(&self, env: &SignedTxEnvelopeV1) {
        let Some(tx) = self.gossip_tx.as_ref() else {
            return;
        };
        let event = crate::models::NetworkEvent::TxBroadcast { env: env.clone() };
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = tx.send(json).await;
        }
    }

    /// Ask bootnodes to take this tx directly, over `/tet/v1/tx-submit`.
    ///
    /// Runs *in addition to* gossip, never instead of it. Gossip is the efficient fan-out; this
    /// is the path that still works when gossip does not — and on 2026-09-22 gossip did not, for
    /// a reason invisible from here: a follower held an incomplete record of the seed's topic
    /// subscriptions, so `publish` returned `InsufficientPeers` indefinitely while the peer
    /// connection itself stayed healthy and blocks kept arriving. Blocks have had two paths
    /// since S1 (gossip + pull catch-up); this gives transactions the same.
    pub async fn direct_submit_to_peers(&self, env: &SignedTxEnvelopeV1) {
        let Some(tx) = self.tx_submit_tx.as_ref() else {
            return;
        };
        let _ = tx.send(crate::p2p::TxSubmitCmd { env: env.clone() }).await;
    }

    /// One rebroadcast sweep. Returns `(republished, forgotten)`.
    ///
    /// Re-publishes every still-pending, locally-originated mempool tx, up to
    /// `TET_TX_REBROADCAST_MAX` attempts each. Bounded three ways so it cannot amplify:
    /// only locally-submitted txs are tracked, each has a hard attempt ceiling, and anything no
    /// longer in the mempool (mined, evicted) is dropped from the map.
    pub async fn rebroadcast_pending_txs(&self) -> (usize, usize) {
        if self.gossip_tx.is_none() && self.tx_submit_tx.is_none() {
            return (0, 0);
        }
        let max_attempts = Self::tx_rebroadcast_max_attempts();

        // Snapshot under the mempool lock, then release it: publishing holds an await point and
        // the auto-miner needs this lock every block.
        let pending: Vec<(String, SignedTxEnvelopeV1)> = {
            let mp = self.mempool.lock().await;
            mp.iter()
                .filter_map(|e| {
                    crate::consensus::tx_hash_for_env(e)
                        .ok()
                        .map(|h| (h, e.clone()))
                })
                .collect()
        };
        let still_pending: std::collections::HashSet<&String> =
            pending.iter().map(|(h, _)| h).collect();

        let mut to_send: Vec<SignedTxEnvelopeV1> = Vec::new();
        let forgotten;
        {
            let mut tracker = self.pending_rebroadcast.lock().await;
            let before = tracker.len();
            tracker.retain(|h, attempts| still_pending.contains(h) && *attempts < max_attempts);
            forgotten = before.saturating_sub(tracker.len());
            for (hash, env) in &pending {
                if let Some(attempts) = tracker.get_mut(hash) {
                    *attempts += 1;
                    to_send.push(env.clone());
                }
            }
        }

        let mut republished = 0usize;
        for env in to_send {
            let event = crate::models::NetworkEvent::TxBroadcast {
                env: env.clone(),
            };
            let mut sent = false;
            if let Some(gossip) = self.gossip_tx.as_ref()
                && let Ok(json) = serde_json::to_string(&event)
                && gossip.send(json).await.is_ok()
            {
                sent = true;
            }
            // Retry the direct path too. A tx stuck because gossip is unusable is exactly the
            // case this sweep exists for, so retrying only the broken path would be pointless.
            if self.tx_submit_tx.is_some() {
                self.direct_submit_to_peers(&env).await;
                sent = true;
            }
            if sent {
                republished += 1;
            }
        }
        (republished, forgotten)
    }

    pub fn tx_rebroadcast_interval_sec() -> u64 {
        std::env::var("TET_TX_REBROADCAST_SEC")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(15)
    }

    pub fn tx_rebroadcast_max_attempts() -> u32 {
        std::env::var("TET_TX_REBROADCAST_MAX")
            .ok()
            .and_then(|v| v.trim().parse::<u32>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(20)
    }

    /// Background loop driving [`rebroadcast_pending_txs`]. No-op when neither the gossip nor the
    /// direct-submit channel exists.
    pub fn spawn_mempool_rebroadcast(state: RestState) -> Option<tokio::task::JoinHandle<()>> {
        if state.gossip_tx.is_none() && state.tx_submit_tx.is_none() {
            return None;
        }
        let period = std::time::Duration::from_secs(Self::tx_rebroadcast_interval_sec());
        Some(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(period);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                let (republished, forgotten) = state.rebroadcast_pending_txs().await;
                if republished > 0 || forgotten > 0 {
                    log::info!(
                        "[mempool][rebroadcast] republished={republished} forgotten={forgotten}"
                    );
                }
            }
        }))
    }

    /// Broadcast a Tmail Basic E2EE envelope to peers over the `/tet/v1/tmail` gossip plane.
    ///
    /// Same wiring as [`broadcast_mempool_tx`]: serialize a [`crate::models::NetworkEvent`] and push
    /// it onto the gossip channel. Tmail is off-ledger — this never touches the mempool or ledger.
    pub async fn broadcast_tmail(&self, env: &crate::tmail::envelope::TmailEnvelopeV1) {
        let Some(tx) = self.gossip_tx.as_ref() else {
            return;
        };
        let event = crate::models::NetworkEvent::TmailGossip {
            envelope: env.clone(),
        };
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = tx.send(json).await;
        }
    }

    /// Broadcast a burn-after-read revoke to peers over the `/tet/v1/tmail` gossip plane
    /// (spec §A.3.2 Layer 1). Same wiring as [`broadcast_tmail`]; off-ledger.
    ///
    /// Only ever called for a revoke this node has already authorized against its own store, so a
    /// node never amplifies a revoke it could not verify the right to make.
    pub async fn broadcast_tmail_burn_revoke(&self, rev: &crate::tmail::burn::TmailBurnRevokeV1) {
        let Some(tx) = self.gossip_tx.as_ref() else {
            return;
        };
        let event = crate::models::NetworkEvent::TmailBurnRevoke {
            revoke: rev.clone(),
        };
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = tx.send(json).await;
        }
    }

    /// **The only way a locally-originated anonymity-set registration enters this node.**
    ///
    /// Admits it *and* announces it — gossip for fan-out and a direct request to bootnodes. There
    /// is deliberately no admit-only method for local registrations, for the same reason
    /// `submit_local_tx` has none: a handler that stores without announcing produces a member who
    /// is in their own node's anonymity set and nobody else's, whose proofs then fail on every
    /// peer with nothing pointing at delivery. `/ledger/transfer` did exactly that until
    /// 2026-09-23, and this is that lesson applied in advance.
    ///
    /// Receive paths must NOT use this — they go through `p2p::admit_anon_registration`, which
    /// admits without re-publishing.
    pub async fn submit_local_anon_registration(
        &self,
        reg: &crate::tmail::anon::TmailAnonRegistrationV1,
    ) -> Result<crate::tmail::store::AnonRegisterOutcome, String> {
        let outcome = crate::p2p::admit_anon_registration(&self.tmail, reg)?;
        self.announce_anon_registration(reg).await;
        Ok(outcome)
    }

    /// Both delivery paths, deliberately not nested: either can be unavailable without disabling
    /// the other.
    async fn announce_anon_registration(
        &self,
        reg: &crate::tmail::anon::TmailAnonRegistrationV1,
    ) {
        if let Some(tx) = self.gossip_tx.as_ref() {
            let event = crate::models::NetworkEvent::TmailAnonRegistration {
                registration: reg.clone(),
            };
            if let Ok(json) = serde_json::to_string(&event) {
                let _ = tx.send(json).await;
            }
        }
        if let Some(tx) = self.anon_register_tx.as_ref() {
            let _ = tx
                .send(crate::p2p::AnonRegisterCmd {
                    registration: reg.clone(),
                })
                .await;
        }
    }

    /// Broadcast a File Sharing announce envelope to peers over the `/tet/v1/files/announce` gossip
    /// plane. Same wiring as [`broadcast_tmail`]; off-ledger, body not carried.
    pub async fn broadcast_file_announce(&self, env: &crate::files::FileEnvelopeV1) {
        let Some(tx) = self.gossip_tx.as_ref() else {
            return;
        };
        let event = crate::models::NetworkEvent::FileAnnounce {
            envelope: env.clone(),
        };
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = tx.send(json).await;
        }
    }
}

#[derive(Debug)]
pub struct HttpRateLimit {
    window_start: std::time::Instant,
    count: u64,
    max_per_sec: u64,
}

impl HttpRateLimit {
    pub fn new(max_per_sec: u64) -> Self {
        Self {
            window_start: std::time::Instant::now(),
            count: 0,
            max_per_sec: max_per_sec.max(1),
        }
    }

    pub(crate) fn tick_allow(&mut self) -> bool {
        let now = std::time::Instant::now();
        if now.duration_since(self.window_start) >= std::time::Duration::from_secs(1) {
            self.window_start = now;
            self.count = 0;
        }
        self.count = self.count.saturating_add(1);
        self.count <= self.max_per_sec
    }
}
