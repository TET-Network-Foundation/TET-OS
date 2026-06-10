use crate::ledger::Ledger;
use crate::p2p_dex::DexEngine;
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
    pub solana: Arc<crate::ledger::solana_client::NexusSolanaClient>,
    pub p2p_tx: Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>,
    pub p2p_client: Option<crate::p2p_network::P2pClient>,
    pub gossip_tx: Option<mpsc::Sender<String>>,
    /// Per-node block-plane sync board (`None` when P2P / block swarm is disabled).
    pub block_sync_board: Option<crate::sync::SharedBlockSyncBoard>,
    /// Liveness beacon for the block-plane swarm event loop (`None` when block swarm is disabled).
    pub swarm_health: Option<crate::swarm_health::SharedSwarmHealth>,
    /// In-memory pending transactions (Phase 2 mempool).
    pub mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    /// Tmail node-local TTL buffer + key directory (off-ledger; spec §A.1).
    pub tmail: Arc<crate::tmail::store::TmailStore>,
    /// File Sharing node-local blob/meta/inbox store (off-ledger; spec `PHASE_0_FILE_SHARING_SPEC.md`).
    pub files: Arc<crate::files::storage::FileStore>,
    /// Command channel into the block-plane swarm for `/tet/v1/files/fetch` body pulls
    /// (Step 4; `None` when the block swarm is disabled).
    pub files_fetch_tx: Option<mpsc::Sender<crate::p2p::FilesFetchCmd>>,
    pub http_ratelimit: Arc<Mutex<HttpRateLimit>>,
    pub workers: Arc<StdMutex<WorkerRegistry>>,
    pub e2ee_jobs: Arc<StdMutex<E2eeJobQueue>>,
    pub dex: Arc<StdMutex<DexEngine>>,
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
            } => (*amount_micro as u128).saturating_mul(*fee_bps as u128) / 10_000,
            crate::protocol::TxV1::EnterpriseInference { amount_micro, .. } => {
                *amount_micro as u128
            }
            crate::protocol::TxV1::FileFee { fee_micro, .. } => *fee_micro as u128,
            _ => 0,
        }
    }

    pub async fn enqueue_mempool_tx(
        &self,
        env: SignedTxEnvelopeV1,
    ) -> Result<bool, MempoolEnqueueError> {
        let max_txs = Self::mempool_max_txs();
        let max_bytes = Self::mempool_max_bytes();
        let incoming_bytes = Self::tx_estimated_bytes(&env);
        if incoming_bytes > max_bytes {
            return Err(MempoolEnqueueError::TxTooLarge {
                bytes: incoming_bytes,
                max_bytes,
            });
        }

        let incoming_fee = Self::tx_fee_score(&env);
        let mut mp = self.mempool.lock().await;
        let mut total_bytes = mp.iter().map(Self::tx_estimated_bytes).sum::<usize>();
        let mut evicted = false;

        while (mp.len() >= max_txs || total_bytes.saturating_add(incoming_bytes) > max_bytes)
            && !mp.is_empty()
        {
            let Some((idx, lowest_fee)) = mp
                .iter()
                .enumerate()
                .map(|(idx, existing)| (idx, Self::tx_fee_score(existing)))
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
            total_bytes = total_bytes.saturating_sub(Self::tx_estimated_bytes(&removed));
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

    /// Best-effort broadcast of a pending mempool tx to peers over the block-plane
    /// gossip (`txs` topic), so that any producer node can include it in a block.
    ///
    /// This never mutates a ledger; it only propagates the signed envelope. Peers
    /// re-verify the hybrid signature before enqueuing into their own mempool.
    pub async fn broadcast_mempool_tx(&self, env: &SignedTxEnvelopeV1) {
        let Some(tx) = self.gossip_tx.as_ref() else {
            return;
        };
        let event = crate::models::NetworkEvent::TxBroadcast { env: env.clone() };
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = tx.send(json).await;
        }
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
