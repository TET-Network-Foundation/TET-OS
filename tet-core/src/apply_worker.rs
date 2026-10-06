//! The block-plane loop only routes (docs/DESIGN_accept_loop.md, part B).
//!
//! Work that can take seconds runs here, off the swarm loop, and comes back to it as an event:
//!
//! - **The apply worker** is one task that applies blocks **in arrival order** (FIFO, so block
//!   application order is exactly what it was when the loop applied inline): gossip blocks,
//!   catch-up batches, and backfilled-branch reorgs.
//! - **The admission worker** admits transactions into the mempool, so the loop never waits on the
//!   mempool lock (the miner holds it while it builds a block).
//!
//! Both queues are **bounded**, and the loop only ever `try_send`s:
//!
//! - A full apply queue drops gossip blocks and backfill reorgs (counted; the blocks are re-fetchable,
//!   and catch-up fetches them). [`RESERVED_FOR_CATCH_UP`] slots are kept for catch-up, which has at
//!   most one batch in flight (the driver waits for its result before requesting another), so a
//!   catch-up batch always fits.
//! - A full admission queue drops gossiped transactions (counted) and answers a direct tx-submit
//!   with "busy".
//!
//! On the wire and in consensus nothing changes: the same blocks are applied by the same functions
//! in the same order; only the task doing it moved.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use libp2p::PeerId;
use tokio::sync::{mpsc, Mutex};

use crate::protocol::SignedTxEnvelopeV1;

/// Apply-queue slots. Override with `TET_APPLY_QUEUE_CAP` (minimum `RESERVED_FOR_CATCH_UP + 1`).
pub const APPLY_QUEUE_CAP_DEFAULT: usize = 64;
/// Slots only catch-up may use, so a flood of gossip blocks cannot starve the path that recovers
/// from it.
pub const RESERVED_FOR_CATCH_UP: usize = 2;
/// Admission-queue slots. Override with `TET_TX_ADMISSION_QUEUE_CAP`.
pub const ADMISSION_QUEUE_CAP_DEFAULT: usize = 256;

fn cap_from_env(key: &str, default: usize, min: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(default)
        .max(min)
}

/// A block-application job.
pub enum ApplyJob {
    /// A gossiped block whose parent this node has.
    Gossip {
        gossip: crate::consensus::RemoteBlockGossip,
        source: Option<PeerId>,
    },
    /// A catch-up range response, applied block by block until one fails.
    CatchUpBatch {
        peer: PeerId,
        blocks: Vec<crate::ledger::BlockRecordV1>,
    },
    /// Backfilled branch tips to try as a reorg (`consensus::try_reorg_backfilled_branch`).
    BackfillReorg { peer: PeerId, tips: Vec<String> },
}

/// What an [`ApplyJob`] came to, delivered back to the loop.
pub enum ApplyDone {
    Gossip {
        block_height: u64,
        source: Option<PeerId>,
        result: Result<crate::consensus::RemoteBlockApplyOutcome, String>,
    },
    CatchUpBatch {
        peer: PeerId,
        applied: usize,
        failed: bool,
    },
    BackfillReorg {
        peer: PeerId,
        results: Vec<(String, Result<bool, String>)>,
    },
}

/// The loop's handle on the apply worker.
#[derive(Clone)]
pub struct ApplyQueue {
    tx: mpsc::Sender<ApplyJob>,
    depth: Arc<AtomicUsize>,
    cap: usize,
}

impl ApplyQueue {
    /// Jobs queued or in progress.
    pub fn depth(&self) -> usize {
        self.depth.load(Ordering::Relaxed)
    }

    fn enqueue(&self, job: ApplyJob, limit: usize) -> bool {
        // Reserve the slot first, so two offers cannot both see the last free one.
        let prev = self.depth.fetch_add(1, Ordering::Relaxed);
        if prev >= limit || self.tx.try_send(job).is_err() {
            self.depth.fetch_sub(1, Ordering::Relaxed);
            return false;
        }
        crate::metrics::APPLY_QUEUE_DEPTH.store((prev + 1) as u64, Ordering::Relaxed);
        true
    }

    /// A gossip block or backfill reorg: queued only if a non-reserved slot is free; otherwise
    /// dropped and counted. Never waits.
    pub fn offer_droppable(&self, job: ApplyJob) -> bool {
        let ok = self.enqueue(job, self.cap - RESERVED_FOR_CATCH_UP);
        if !ok {
            crate::metrics::APPLY_DROPPED_TOTAL.fetch_add(1, Ordering::Relaxed);
        }
        ok
    }

    /// A catch-up batch: may use the reserved slots. Never waits.
    pub fn offer_catch_up(&self, job: ApplyJob) -> bool {
        self.enqueue(job, self.cap)
    }
}

#[cfg(test)]
pub(crate) static TEST_APPLY_DELAY_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

async fn run_apply_job(
    ledger: &Arc<crate::ledger::Ledger>,
    mempool: &Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
    job: ApplyJob,
) -> ApplyDone {
    #[cfg(test)]
    {
        let ms = TEST_APPLY_DELAY_MS.load(Ordering::Relaxed);
        if ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
        }
    }
    match job {
        ApplyJob::Gossip { gossip, source } => {
            let block_height = gossip.block_height;
            let result = crate::consensus::apply_remote_block_from_gossip(ledger.clone(), mempool.clone(), gossip)
                .await
                .map_err(|e| e.message().to_string());
            ApplyDone::Gossip { block_height, source, result }
        }
        ApplyJob::CatchUpBatch { peer, blocks } => {
            let (applied, failed) = crate::p2p::apply_catch_up_blocks(ledger.clone(), mempool.clone(), blocks).await;
            ApplyDone::CatchUpBatch { peer, applied, failed }
        }
        ApplyJob::BackfillReorg { peer, tips } => {
            let ledger = ledger.clone();
            let results = tokio::task::spawn_blocking(move || {
                tips.into_iter()
                    .map(|tip| {
                        let r = crate::consensus::try_reorg_backfilled_branch(ledger.as_ref(), &tip);
                        (tip, r)
                    })
                    .collect::<Vec<_>>()
            })
            .await
            .unwrap_or_default();
            ApplyDone::BackfillReorg { peer, results }
        }
    }
}

/// Start the apply worker. Results come back on the returned receiver, which the loop drains.
pub fn spawn_apply_worker(
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
) -> (ApplyQueue, mpsc::Receiver<ApplyDone>) {
    let cap = cap_from_env("TET_APPLY_QUEUE_CAP", APPLY_QUEUE_CAP_DEFAULT, RESERVED_FOR_CATCH_UP + 1);
    let (tx, mut rx) = mpsc::channel::<ApplyJob>(cap);
    let (done_tx, done_rx) = mpsc::channel::<ApplyDone>(cap);
    let depth = Arc::new(AtomicUsize::new(0));
    let worker_depth = depth.clone();
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            let done = run_apply_job(&ledger, &mempool, job).await;
            let left = worker_depth.fetch_sub(1, Ordering::Relaxed).saturating_sub(1);
            crate::metrics::APPLY_QUEUE_DEPTH.store(left as u64, Ordering::Relaxed);
            // The loop drains this channel on every iteration; waiting here waits on the loop
            // briefly, never the other way round.
            if done_tx.send(done).await.is_err() {
                break;
            }
        }
    });
    (ApplyQueue { tx, depth, cap }, done_rx)
}

/// A transaction to admit. `token` is set for a direct tx-submit, whose answer the loop holds.
pub struct AdmitJob {
    pub token: Option<u64>,
    pub env: SignedTxEnvelopeV1,
}

pub struct AdmitDone {
    pub token: Option<u64>,
    pub outcome: crate::p2p::TxGossipOutcome,
}

#[derive(Clone)]
pub struct AdmissionQueue {
    tx: mpsc::Sender<AdmitJob>,
}

impl AdmissionQueue {
    /// Queue a transaction for admission; `false` (and counted) when the queue is full. Never waits.
    pub fn offer(&self, job: AdmitJob) -> bool {
        let ok = self.tx.try_send(job).is_ok();
        if !ok {
            crate::metrics::TX_ADMISSION_DROPPED_TOTAL.fetch_add(1, Ordering::Relaxed);
        }
        ok
    }
}

/// Start the admission worker: the mempool's only user on the loop's behalf.
pub fn spawn_admission_worker(
    ledger: Arc<crate::ledger::Ledger>,
    mempool: Arc<Mutex<Vec<SignedTxEnvelopeV1>>>,
) -> (AdmissionQueue, mpsc::Receiver<AdmitDone>) {
    let cap = cap_from_env("TET_TX_ADMISSION_QUEUE_CAP", ADMISSION_QUEUE_CAP_DEFAULT, 1);
    let (tx, mut rx) = mpsc::channel::<AdmitJob>(cap);
    let (done_tx, done_rx) = mpsc::channel::<AdmitDone>(cap);
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            let outcome = crate::p2p::handle_tx_broadcast(&ledger, &mempool, job.env).await;
            if done_tx.send(AdmitDone { token: job.token, outcome }).await.is_err() {
                break;
            }
        }
    });
    (AdmissionQueue { tx }, done_rx)
}
