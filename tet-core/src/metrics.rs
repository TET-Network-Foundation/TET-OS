use std::sync::atomic::{AtomicU64, Ordering};

pub static GOSSIP_REJECTED_TOTAL: AtomicU64 = AtomicU64::new(0);
pub static ZK_PROVER_MILLIS_TOTAL: AtomicU64 = AtomicU64::new(0);
/// Tmail messages destroyed by an authorized burn revoke (spec §A.3.2).
pub static TMAIL_BURNED_TOTAL: AtomicU64 = AtomicU64::new(0);

pub fn inc_gossip_rejected() {
    GOSSIP_REJECTED_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_tmail_burned() {
    TMAIL_BURNED_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn tmail_burned_total() -> u64 {
    TMAIL_BURNED_TOTAL.load(Ordering::Relaxed)
}

pub fn add_zk_prover_millis(ms: u64) {
    ZK_PROVER_MILLIS_TOTAL.fetch_add(ms, Ordering::Relaxed);
}

pub fn gossip_rejected_total() -> u64 {
    GOSSIP_REJECTED_TOTAL.load(Ordering::Relaxed)
}

pub fn zk_prover_seconds_total() -> f64 {
    ZK_PROVER_MILLIS_TOTAL.load(Ordering::Relaxed) as f64 / 1000.0
}

// ---- The block-plane loop's backpressure (docs/DESIGN_accept_loop.md, part B) ----------------

/// Jobs waiting for, or in, the apply worker right now.
pub static APPLY_QUEUE_DEPTH: AtomicU64 = AtomicU64::new(0);
/// Gossip blocks (and backfill reorgs) the loop dropped because the apply queue was full. They are
/// re-fetchable: catch-up asks for the range again.
pub static APPLY_DROPPED_TOTAL: AtomicU64 = AtomicU64::new(0);
/// Gossiped transactions dropped because the admission queue was full.
pub static TX_ADMISSION_DROPPED_TOTAL: AtomicU64 = AtomicU64::new(0);
/// Disk lookups and hello builds the loop declined to start because too many were in flight.
pub static LOOP_LOOKUPS_REFUSED_TOTAL: AtomicU64 = AtomicU64::new(0);

pub fn apply_queue_depth() -> u64 {
    APPLY_QUEUE_DEPTH.load(Ordering::Relaxed)
}
pub fn apply_dropped_total() -> u64 {
    APPLY_DROPPED_TOTAL.load(Ordering::Relaxed)
}
pub fn tx_admission_dropped_total() -> u64 {
    TX_ADMISSION_DROPPED_TOTAL.load(Ordering::Relaxed)
}
pub fn loop_lookups_refused_total() -> u64 {
    LOOP_LOOKUPS_REFUSED_TOTAL.load(Ordering::Relaxed)
}
