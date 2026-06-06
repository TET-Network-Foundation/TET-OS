//! Liveness beacon + systemd watchdog for the block-plane libp2p swarm event loop.
//!
//! Background (2026-06 incidents): the block-plane swarm loop ([`crate::p2p::run_mdns_ping_swarm`])
//! executed heavy *synchronous* ledger work (e.g. `compute_state_root`, a full O(N) balance scan)
//! inline on the async executor. As the chain grew this starved the libp2p swarm of polling time,
//! the accept queue overflowed, and the failure eventually cascaded into an OS-level TCP lockup that
//! required a hard reboot.
//!
//! This module provides two complementary safety nets:
//!  1. [`SwarmHealth`] — a lock-free beacon the swarm loop pings every iteration, exposing the last
//!     tick time + peer/listener counts to REST (`/health/swarm`) for external monitoring.
//!  2. [`spawn_watchdog`] — a task that translates that beacon into a systemd `sd_notify` heartbeat:
//!     it only pets the watchdog while the loop is demonstrably alive, so a stalled loop causes
//!     systemd to restart the unit *before* the box wedges.
//!
//! The heavy-work fix itself lives in `p2p.rs` (offloading the blocking ledger calls via
//! `tokio::task::spawn_blocking`); this module is the detection + auto-recovery layer.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;

/// Default stall threshold (ms). The loop ticks at least once per second (1s `catch_up_interval`),
/// so 90s is far above the healthy cadence and avoids false positives during brief GC/IO hiccups.
pub const DEFAULT_STALL_THRESHOLD_MS: u64 = 90_000;

/// Shared handle to the swarm liveness beacon.
pub type SharedSwarmHealth = Arc<SwarmHealth>;

/// Lock-free liveness beacon for the block-plane swarm event loop.
///
/// All fields are plain atomics updated with `Relaxed` ordering — this is a best-effort health
/// signal on a hot path, not a synchronization primitive.
#[derive(Debug, Default)]
pub struct SwarmHealth {
    /// Unix-ms timestamp of the most recent event-loop iteration (0 until the loop first ticks).
    last_tick_ms: AtomicU64,
    /// Monotonically increasing count of event-loop iterations.
    tick_count: AtomicU64,
    /// Connected peer count as last observed by the loop.
    connected_peers: AtomicUsize,
    /// Bound listener address count as last observed by the loop.
    listeners: AtomicUsize,
    /// Set to true once the loop has ticked at least once (used for sd_notify `READY=1`).
    started: AtomicBool,
}

impl SwarmHealth {
    /// Create a new shared beacon (not yet started).
    pub fn new() -> SharedSwarmHealth {
        Arc::new(Self::default())
    }

    /// Record one event-loop iteration. Hot path: relaxed atomics only.
    pub fn tick(&self, now_ms: u64) {
        self.last_tick_ms.store(now_ms, Ordering::Relaxed);
        self.tick_count.fetch_add(1, Ordering::Relaxed);
        self.started.store(true, Ordering::Relaxed);
    }

    pub fn set_connected_peers(&self, n: usize) {
        self.connected_peers.store(n, Ordering::Relaxed);
    }

    pub fn set_listeners(&self, n: usize) {
        self.listeners.store(n, Ordering::Relaxed);
    }

    pub fn last_tick_ms(&self) -> u64 {
        self.last_tick_ms.load(Ordering::Relaxed)
    }

    pub fn tick_count(&self) -> u64 {
        self.tick_count.load(Ordering::Relaxed)
    }

    pub fn connected_peers(&self) -> usize {
        self.connected_peers.load(Ordering::Relaxed)
    }

    pub fn listeners(&self) -> usize {
        self.listeners.load(Ordering::Relaxed)
    }

    pub fn started(&self) -> bool {
        self.started.load(Ordering::Relaxed)
    }

    /// Milliseconds since the last tick relative to `now_ms` (saturating). Returns `None` before the
    /// loop has started, so startup is never mistaken for a stall.
    pub fn since_last_tick_ms(&self, now_ms: u64) -> Option<u64> {
        if !self.started() {
            return None;
        }
        Some(now_ms.saturating_sub(self.last_tick_ms()))
    }

    /// Healthy when the loop has not started yet (still booting) or has ticked within
    /// `stall_threshold_ms`.
    pub fn is_healthy(&self, now_ms: u64, stall_threshold_ms: u64) -> bool {
        match self.since_last_tick_ms(now_ms) {
            None => true,
            Some(age) => age <= stall_threshold_ms,
        }
    }
}

/// Current wall-clock time in Unix milliseconds.
pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Stall threshold from `TET_SWARM_STALL_MS` (default [`DEFAULT_STALL_THRESHOLD_MS`]).
pub fn stall_threshold_ms_from_env() -> u64 {
    std::env::var("TET_SWARM_STALL_MS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_STALL_THRESHOLD_MS)
}

/// Spawn the systemd watchdog task.
///
/// Sends `READY=1` once the swarm loop has started, then pets the watchdog (`WATCHDOG=1`) on a cadence
/// derived from systemd's `WatchdogSec` (half of `WATCHDOG_USEC`, per systemd guidance) — but only
/// while [`SwarmHealth::is_healthy`] holds. If the loop stalls past `stall_threshold_ms` the task
/// stops petting, so systemd restarts the unit before the host wedges.
///
/// No-op heartbeats when not running under systemd (`NOTIFY_SOCKET` unset): the staleness check still
/// runs and logs, which is harmless in local/dev runs.
pub fn spawn_watchdog(
    health: SharedSwarmHealth,
    stall_threshold_ms: u64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut wd_usec: u64 = 0;
        let under_watchdog = sd_notify::watchdog_enabled(false, &mut wd_usec);
        // Pet at half of WatchdogSec (systemd guidance), but cap at 20s so `READY=1` is sent promptly
        // after startup (well within the default TimeoutStartSec) and petting has generous margin.
        let ping_interval = if under_watchdog && wd_usec > 0 {
            Duration::from_micros(wd_usec / 2)
                .min(Duration::from_secs(20))
                .max(Duration::from_secs(1))
        } else {
            Duration::from_secs(20)
        };
        log::info!(
            "[swarm-health] watchdog started under_systemd_watchdog={under_watchdog} ping_interval={ping_interval:?} stall_threshold_ms={stall_threshold_ms}"
        );

        let mut ready_sent = false;
        let mut ticker = tokio::time::interval(ping_interval);
        loop {
            ticker.tick().await;
            if !health.started() {
                continue;
            }
            if !ready_sent {
                let _ = sd_notify::notify(false, &[sd_notify::NotifyState::Ready]);
                ready_sent = true;
                log::info!("[swarm-health] sd_notify READY=1 sent (loop is live)");
            }
            let now = now_ms();
            if health.is_healthy(now, stall_threshold_ms) {
                let _ = sd_notify::notify(false, &[sd_notify::NotifyState::Watchdog]);
            } else {
                let age = health.since_last_tick_ms(now).unwrap_or(0);
                log::error!(
                    "[swarm-health] block-plane event loop STALLED age_ms={age} > {stall_threshold_ms}ms; withholding systemd watchdog ping (unit will be restarted)"
                );
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_beacon_is_not_started_and_reports_no_age() {
        let h = SwarmHealth::default();
        assert!(!h.started());
        assert_eq!(h.tick_count(), 0);
        assert_eq!(h.since_last_tick_ms(1_000), None);
        // Not started => treated as healthy (still booting), never a false stall.
        assert!(h.is_healthy(10_000_000, 1_000));
    }

    #[test]
    fn tick_marks_started_and_advances_count() {
        let h = SwarmHealth::default();
        h.tick(5_000);
        assert!(h.started());
        assert_eq!(h.tick_count(), 1);
        assert_eq!(h.last_tick_ms(), 5_000);
        h.tick(6_000);
        assert_eq!(h.tick_count(), 2);
        assert_eq!(h.last_tick_ms(), 6_000);
    }

    #[test]
    fn since_last_tick_is_saturating() {
        let h = SwarmHealth::default();
        h.tick(10_000);
        assert_eq!(h.since_last_tick_ms(12_500), Some(2_500));
        // now < last_tick (clock skew) must not underflow.
        assert_eq!(h.since_last_tick_ms(9_000), Some(0));
    }

    #[test]
    fn healthy_within_threshold_stalled_beyond() {
        let h = SwarmHealth::default();
        h.tick(100_000);
        assert!(h.is_healthy(150_000, 90_000)); // 50s old, threshold 90s => healthy
        assert!(!h.is_healthy(200_000, 90_000)); // 100s old, threshold 90s => stalled
        // Exactly at the threshold is still healthy (inclusive).
        assert!(h.is_healthy(190_000, 90_000));
    }

    #[test]
    fn peer_and_listener_counts_roundtrip() {
        let h = SwarmHealth::default();
        h.set_connected_peers(3);
        h.set_listeners(2);
        assert_eq!(h.connected_peers(), 3);
        assert_eq!(h.listeners(), 2);
    }

    #[test]
    fn stall_threshold_env_default_and_override() {
        // Serialize with every other env-mutating test to avoid cross-test env races.
        let _g = crate::test_env::lock();
        // Default when unset/invalid.
        unsafe {
            std::env::remove_var("TET_SWARM_STALL_MS");
        }
        assert_eq!(stall_threshold_ms_from_env(), DEFAULT_STALL_THRESHOLD_MS);
        unsafe {
            std::env::set_var("TET_SWARM_STALL_MS", "45000");
        }
        assert_eq!(stall_threshold_ms_from_env(), 45_000);
        unsafe {
            std::env::remove_var("TET_SWARM_STALL_MS");
        }
    }
}
