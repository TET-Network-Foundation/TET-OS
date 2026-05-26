//! Single source of truth for chain binding (`chain_id`, deterministic `genesis_hash`).

use sha2::{Digest as _, Sha256};

const STEVEMON: u64 = 1_000_000;
const MAX_SUPPLY_MICRO: u64 = 10_000_000_000u64 * STEVEMON;
const GENESIS_FOUNDER_SHARE_MICRO: u64 = 2_500_000_000u64 * STEVEMON;
const GENESIS_WORKER_POOL_SHARE_MICRO: u64 = 5_000_000_000u64 * STEVEMON;
const GENESIS_TREASURY_SHARE_MICRO: u64 = 2_500_000_000u64 * STEVEMON;
const GENESIS_PROTOCOL_RESERVE_SHARE_MICRO: u64 = 0;

/// Worker Pool wallet id embedded in genesis hash payload (locked system account).
const WALLET_WORKER_POOL: &str = "0000000000000000000000000000000000000000000000000000000000000001";
const WALLET_PROTOCOL_RESERVE: &str =
    "0000000000000000000000000000000000000000000000000000000000000003";

pub const GENESIS_FOUNDER_DEV_PUBLIC_HEX: &str =
    "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";

pub fn mainnet_env_enabled() -> bool {
    std::env::var("TET_MAINNET")
        .ok()
        .as_deref()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn chain_id_from_env() -> String {
    std::env::var("TET_CHAIN_ID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if mainnet_env_enabled() {
                "tet-mainnet-1".to_string()
            } else {
                "tet-local-dev".to_string()
            }
        })
}

pub fn expected_genesis_founder_wallet_from_env() -> String {
    std::env::var("TET_GENESIS_FOUNDER_WALLET_ID")
        .ok()
        .or_else(|| std::env::var("TET_FOUNDER_WALLET").ok())
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| GENESIS_FOUNDER_DEV_PUBLIC_HEX.to_string())
}

pub fn normalize_treasury_address(raw: &str) -> Result<String, String> {
    let w = raw.trim().to_ascii_lowercase();
    if w.is_empty() {
        return Err("TET_TREASURY_ADDRESS must not be empty".into());
    }
    if w.len() != 64 || !w.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("TET_TREASURY_ADDRESS must be 64 hex chars".into());
    }
    Ok(w)
}

pub fn treasury_address_from_env() -> Result<String, String> {
    let raw = std::env::var("TET_TREASURY_ADDRESS")
        .map_err(|_| "TET_TREASURY_ADDRESS is required".to_string())?;
    normalize_treasury_address(&raw)
}

/// Deterministic genesis hash from explicit founder + treasury wallet ids.
pub fn deterministic_genesis_hash_from_parts(
    founder_wallet_id: &str,
    treasury_wallet_id: &str,
) -> String {
    let founder = founder_wallet_id.trim().to_ascii_lowercase();
    let treasury = treasury_wallet_id.trim().to_ascii_lowercase();
    let payload = format!(
        "tet-genesis-v1|chain_id={}|founder={}|founder_micro={}|worker_pool={}|worker_pool_micro={}|treasury={}|treasury_micro={}|reserve={}|reserve_micro={}|max_supply_micro={}",
        chain_id_from_env(),
        founder,
        GENESIS_FOUNDER_SHARE_MICRO,
        WALLET_WORKER_POOL,
        GENESIS_WORKER_POOL_SHARE_MICRO,
        treasury,
        GENESIS_TREASURY_SHARE_MICRO,
        WALLET_PROTOCOL_RESERVE,
        GENESIS_PROTOCOL_RESERVE_SHARE_MICRO,
        MAX_SUPPLY_MICRO,
    );
    format!("0x{}", hex::encode(Sha256::digest(payload.as_bytes())))
}

/// Deterministic genesis hash using founder + treasury from the environment.
pub fn deterministic_genesis_hash() -> String {
    let founder = expected_genesis_founder_wallet_from_env();
    let treasury =
        treasury_address_from_env().expect("TET_TREASURY_ADDRESS is required for genesis hash");
    deterministic_genesis_hash_from_parts(&founder, &treasury)
}

pub fn expected_genesis_hash_from_env() -> String {
    if let Ok(h) = std::env::var("TET_GENESIS_HASH") {
        let h = h.trim().to_ascii_lowercase();
        if !h.is_empty() {
            return h;
        }
    }
    deterministic_genesis_hash()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_and_parts_paths_agree() {
        let founder = "cb1f321c00000000000000000000000000000000000000000000000000000000";
        let treasury = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
        unsafe {
            std::env::set_var("TET_GENESIS_FOUNDER_WALLET_ID", founder);
            std::env::set_var("TET_TREASURY_ADDRESS", treasury);
            std::env::remove_var("TET_GENESIS_HASH");
            std::env::set_var("TET_CHAIN_ID", "tet-local-dev");
        }

        let from_parts = deterministic_genesis_hash_from_parts(founder, treasury);
        let from_env = expected_genesis_hash_from_env();
        assert_eq!(from_parts, from_env);
        // worker_pool must be the locked system id (not legacy `system:worker_pool`).
        assert!(from_env.starts_with("0x"));
        assert_eq!(from_env.len(), 66);
    }
}
