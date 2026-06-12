//! On-chain worker registry (Phase 0.5 scaffold).
//!
//! Persists [`WorkerRegistryRecordV1`] rows in the ledger `workers_registry_v1` tree.
//! Heartbeat liveness remains in the in-memory [`crate::worker_network::WorkerRegistry`];
//! consensus registration is the durable "Become a worker" step that survives restarts.

use serde::{Deserialize, Serialize};

pub const WORKER_REGISTRY_RECORD_VERSION: u32 = 1;
pub const WORKER_STATUS_REGISTERED: &str = "registered";
pub const MAX_WORKER_CAPABILITIES: usize = 16;
pub const MAX_CAPABILITY_LEN: usize = 64;
pub const MAX_HARDWARE_PROFILE_LEN: usize = 128;
pub const MAX_HARDWARE_ID_LEN: usize = 128;

/// Persisted worker row written by `TxV1::WorkerRegister` block apply.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkerRegistryRecordV1 {
    pub v: u32,
    pub wallet_id: String,
    pub hardware_id_hex: String,
    pub hardware_profile: String,
    pub capabilities: Vec<String>,
    pub tflops_declared: f64,
    pub registered_at_height: u64,
    pub registered_at_ms: u128,
    pub status: String,
    /// Cumulative worker-attributed rewards (scaffold; incremented when settlement credits worker).
    pub total_rewards_micro: u64,
}

impl WorkerRegistryRecordV1 {
    pub fn new(
        wallet_id: String,
        hardware_id_hex: String,
        hardware_profile: String,
        capabilities: Vec<String>,
        tflops_declared: f64,
        registered_at_height: u64,
        registered_at_ms: u128,
    ) -> Self {
        Self {
            v: WORKER_REGISTRY_RECORD_VERSION,
            wallet_id,
            hardware_id_hex,
            hardware_profile,
            capabilities,
            tflops_declared: tflops_declared.max(0.0),
            registered_at_height,
            registered_at_ms,
            status: WORKER_STATUS_REGISTERED.to_string(),
            total_rewards_micro: 0,
        }
    }
}

/// Validate tx body fields before mempool enqueue / block apply.
pub fn validate_worker_register_fields(
    wallet_id: &str,
    hardware_id_hex: &str,
    hardware_profile: &str,
    capabilities: &[String],
    tflops_declared: f64,
) -> Result<(), String> {
    let w = wallet_id.trim().to_ascii_lowercase();
    if w.len() != 64 || !w.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("wallet_id must be 64 hex chars".into());
    }
    let hw = hardware_id_hex.trim();
    if hw.is_empty() || hw.len() > MAX_HARDWARE_ID_LEN {
        return Err("hardware_id_hex required (max 128 chars)".into());
    }
    let profile = hardware_profile.trim();
    if profile.is_empty() || profile.len() > MAX_HARDWARE_PROFILE_LEN {
        return Err("hardware_profile required (max 128 chars)".into());
    }
    if capabilities.len() > MAX_WORKER_CAPABILITIES {
        return Err(format!(
            "capabilities max {MAX_WORKER_CAPABILITIES} entries"
        ));
    }
    for cap in capabilities {
        let c = cap.trim();
        if c.is_empty() || c.len() > MAX_CAPABILITY_LEN {
            return Err("each capability must be 1..64 chars".into());
        }
    }
    if !tflops_declared.is_finite() || tflops_declared < 0.0 {
        return Err("tflops_declared must be a finite non-negative number".into());
    }
    Ok(())
}
