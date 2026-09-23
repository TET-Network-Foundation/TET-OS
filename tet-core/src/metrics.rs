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
