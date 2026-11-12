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
/// The dev treasury every local stack uses (docker-compose.yml, provision-seed.sh defaults).
pub const TREASURY_DEV_HEX: &str = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

/// The chain id a node uses when none is set. Clearly local: its genesis payload also carries a dev
/// marker, so no dev node computes the genesis hash of a public chain.
pub const DEV_CHAIN_ID: &str = "tet-dev-local";
/// The id the first public testnet ran under (with the dev founder and treasury), so its genesis
/// hash was the one every fresh dev node computed. Records signed for it still name it; a public
/// chain may not start under it again.
pub const LEGACY_PUBLIC_CHAIN_ID: &str = "tet-local-dev";

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
                DEV_CHAIN_ID.to_string()
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

/// The genesis payload for an explicit chain id. The dev chain id gets a `|dev=1` marker; every
/// other chain id (including the legacy `tet-local-dev`, which pinned records still name) keeps the
/// original format, so their hashes don't change.
pub fn genesis_payload_v1(chain_id: &str, founder_wallet_id: &str, treasury_wallet_id: &str) -> String {
    let founder = founder_wallet_id.trim().to_ascii_lowercase();
    let treasury = treasury_wallet_id.trim().to_ascii_lowercase();
    let payload = format!(
        "tet-genesis-v1|chain_id={}|founder={}|founder_micro={}|worker_pool={}|worker_pool_micro={}|treasury={}|treasury_micro={}|reserve={}|reserve_micro={}|max_supply_micro={}",
        chain_id,
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
    if chain_id == DEV_CHAIN_ID {
        format!("{payload}|dev=1")
    } else {
        payload
    }
}

pub fn genesis_hash_for(chain_id: &str, founder_wallet_id: &str, treasury_wallet_id: &str) -> String {
    let payload = genesis_payload_v1(chain_id, founder_wallet_id, treasury_wallet_id);
    format!("0x{}", hex::encode(Sha256::digest(payload.as_bytes())))
}

/// Deterministic genesis hash from explicit founder + treasury wallet ids.
pub fn deterministic_genesis_hash_from_parts(
    founder_wallet_id: &str,
    treasury_wallet_id: &str,
) -> String {
    genesis_hash_for(&chain_id_from_env(), founder_wallet_id, treasury_wallet_id)
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

/// A public chain's genesis, from the file named by `TET_GENESIS_FILE`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenesisFile {
    pub chain_id: String,
    pub founder_wallet_id: String,
    pub treasury_address: String,
    pub genesis_hash: String,
}

/// With `TET_ENV=testnet`, a node runs a public chain and must say exactly which: an explicit
/// `TET_CHAIN_ID` (not a dev id), and `TET_GENESIS_FILE` naming that chain, its founder and treasury
/// (not the dev ones) and its genesis hash, which must match the hash recomputed here. The founder,
/// treasury and `TET_GENESIS_HASH` in the environment, when set, must agree with the file.
/// Any other `TET_ENV` (or none) changes nothing: `Ok(None)`.
pub fn check_public_chain(env: &dyn Fn(&str) -> Option<String>) -> Result<Option<GenesisFile>, String> {
    let get = |k: &str| env(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    if get("TET_ENV").map(|v| v.to_ascii_lowercase()).as_deref() != Some("testnet") {
        return Ok(None);
    }
    let chain_id = get("TET_CHAIN_ID").ok_or("TET_ENV=testnet requires an explicit TET_CHAIN_ID")?;
    if chain_id == DEV_CHAIN_ID || chain_id == LEGACY_PUBLIC_CHAIN_ID {
        return Err(format!("TET_ENV=testnet refuses the dev chain id {chain_id:?}: name the public chain"));
    }
    let path = get("TET_GENESIS_FILE").ok_or("TET_ENV=testnet requires TET_GENESIS_FILE (the chain's genesis file)")?;
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("TET_GENESIS_FILE {path}: {e}"))?;
    let g: GenesisFile = serde_json::from_str(&raw).map_err(|e| format!("TET_GENESIS_FILE {path}: {e}"))?;
    if g.chain_id != chain_id {
        return Err(format!("TET_GENESIS_FILE is for chain {:?}, TET_CHAIN_ID is {chain_id:?}", g.chain_id));
    }
    let founder = g.founder_wallet_id.trim().to_ascii_lowercase();
    let treasury = normalize_treasury_address(&g.treasury_address)?;
    if founder.len() != 64 || !founder.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("TET_GENESIS_FILE founder_wallet_id must be 64 hex chars".into());
    }
    if founder == GENESIS_FOUNDER_DEV_PUBLIC_HEX {
        return Err("TET_ENV=testnet refuses the dev founder wallet".into());
    }
    if treasury == TREASURY_DEV_HEX {
        return Err("TET_ENV=testnet refuses the dev treasury".into());
    }
    let want = genesis_hash_for(&chain_id, &founder, &treasury);
    if g.genesis_hash.trim().to_ascii_lowercase() != want {
        return Err(format!("TET_GENESIS_FILE genesis_hash does not match its chain, founder and treasury (recomputed {want})"));
    }
    let agrees = |k: &str, v: &str| get(k).is_none_or(|e| e.to_ascii_lowercase() == v);
    if !agrees("TET_GENESIS_FOUNDER_WALLET_ID", &founder) || !agrees("TET_FOUNDER_WALLET", &founder) {
        return Err("the founder wallet in the environment differs from TET_GENESIS_FILE".into());
    }
    if !agrees("TET_TREASURY_ADDRESS", &treasury) {
        return Err("TET_TREASURY_ADDRESS differs from TET_GENESIS_FILE".into());
    }
    if !agrees("TET_GENESIS_HASH", &want) {
        return Err("TET_GENESIS_HASH differs from TET_GENESIS_FILE".into());
    }
    Ok(Some(g))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_and_parts_paths_agree() {
        // Serialize env access with every other test; without this the parallel test runner
        // can overwrite TET_TREASURY_ADDRESS between our set_var and the read below.
        let _g = crate::test_env::lock();
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

    /// The old public testnet's genesis: the legacy chain id with the dev founder and treasury.
    const OLD_PUBLIC_GENESIS: &str = "0x9d6ccb1354b31419ade378aef68de58e854938df795b69cf76777e3483efbb36";

    #[test]
    fn a_fresh_dev_node_is_clearly_local_and_not_the_old_public_chain() {
        let _g = crate::test_env::lock();
        unsafe {
            std::env::remove_var("TET_CHAIN_ID");
            std::env::remove_var("TET_MAINNET");
        }
        assert_eq!(chain_id_from_env(), DEV_CHAIN_ID);
        let payload = genesis_payload_v1(&chain_id_from_env(), GENESIS_FOUNDER_DEV_PUBLIC_HEX, TREASURY_DEV_HEX);
        assert!(payload.starts_with("tet-genesis-v1|chain_id=tet-dev-local|"), "{payload}");
        assert!(payload.ends_with("|dev=1"), "{payload}");
        let h = deterministic_genesis_hash_from_parts(GENESIS_FOUNDER_DEV_PUBLIC_HEX, TREASURY_DEV_HEX);
        assert_ne!(h, OLD_PUBLIC_GENESIS);
        // The dev golden vector in docs/RUNNING_A_NODE.md; app/lib/chain_binding.ts computes the same.
        assert_eq!(h, "0xeeafc25ed5fd12f5b504dea4b237ece707aa97656874bb79417b6b02b45e3ed5");
    }

    #[test]
    fn records_pinned_to_the_legacy_chain_keep_their_genesis_hash() {
        // Paper marks, the devlog pin and the interop vectors name tet-local-dev explicitly.
        assert_eq!(genesis_hash_for(LEGACY_PUBLIC_CHAIN_ID, GENESIS_FOUNDER_DEV_PUBLIC_HEX, TREASURY_DEV_HEX), OLD_PUBLIC_GENESIS);
        assert!(!genesis_payload_v1(LEGACY_PUBLIC_CHAIN_ID, GENESIS_FOUNDER_DEV_PUBLIC_HEX, TREASURY_DEV_HEX).contains("dev=1"));
    }

    const FOUNDER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const TREASURY: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    /// A genesis file in a temp dir, and an env with TET_ENV=testnet pointing at it.
    fn public_env(file: serde_json::Value, extra: &[(&str, &str)]) -> (tempfile::TempDir, std::collections::HashMap<String, String>) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("genesis.json");
        std::fs::write(&path, file.to_string()).unwrap();
        let mut env: std::collections::HashMap<String, String> = [
            ("TET_ENV", "testnet"),
            ("TET_CHAIN_ID", "tet-testnet-2"),
            ("TET_GENESIS_FILE", path.to_str().unwrap()),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        for (k, v) in extra {
            env.insert(k.to_string(), v.to_string());
        }
        (dir, env)
    }

    fn file(chain: &str, founder: &str, treasury: &str) -> serde_json::Value {
        serde_json::json!({"chain_id": chain, "founder_wallet_id": founder, "treasury_address": treasury,
                           "genesis_hash": genesis_hash_for(chain, founder, treasury)})
    }

    fn check(env: &std::collections::HashMap<String, String>) -> Result<Option<GenesisFile>, String> {
        check_public_chain(&|k| env.get(k).cloned())
    }

    #[test]
    fn without_tet_env_testnet_nothing_is_required() {
        assert_eq!(check(&std::collections::HashMap::new()), Ok(None));
        let env = [("TET_ENV".to_string(), "dev".to_string())].into_iter().collect();
        assert_eq!(check(&env), Ok(None));
    }

    #[test]
    fn a_public_chain_with_its_own_genesis_file_starts() {
        let (_d, env) = public_env(file("tet-testnet-2", FOUNDER, TREASURY), &[("TET_TREASURY_ADDRESS", TREASURY)]);
        let g = check(&env).unwrap().unwrap();
        assert_eq!(g.chain_id, "tet-testnet-2");
    }

    #[test]
    fn testnet_refuses_dev_defaults() {
        // the dev chain ids
        for id in [DEV_CHAIN_ID, LEGACY_PUBLIC_CHAIN_ID] {
            let (_d, mut env) = public_env(file(id, FOUNDER, TREASURY), &[]);
            env.insert("TET_CHAIN_ID".into(), id.into());
            assert!(check(&env).unwrap_err().contains("dev chain id"), "{id}");
        }
        // no chain id at all
        let (_d, mut env) = public_env(file("tet-testnet-2", FOUNDER, TREASURY), &[]);
        env.remove("TET_CHAIN_ID");
        assert!(check(&env).unwrap_err().contains("explicit TET_CHAIN_ID"));
        // the dev founder, the dev treasury
        let (_d, env) = public_env(file("tet-testnet-2", GENESIS_FOUNDER_DEV_PUBLIC_HEX, TREASURY), &[]);
        assert!(check(&env).unwrap_err().contains("dev founder"));
        let (_d, env) = public_env(file("tet-testnet-2", FOUNDER, TREASURY_DEV_HEX), &[]);
        assert!(check(&env).unwrap_err().contains("dev treasury"));
    }

    #[test]
    fn testnet_requires_a_genesis_file_that_matches() {
        let (_d, mut env) = public_env(file("tet-testnet-2", FOUNDER, TREASURY), &[]);
        env.remove("TET_GENESIS_FILE");
        assert!(check(&env).unwrap_err().contains("requires TET_GENESIS_FILE"));
        // a stated hash that isn't this chain's
        let mut f = file("tet-testnet-2", FOUNDER, TREASURY);
        f["genesis_hash"] = serde_json::json!(OLD_PUBLIC_GENESIS);
        let (_d, env) = public_env(f, &[]);
        assert!(check(&env).unwrap_err().contains("does not match"));
        // a file for another chain
        let (_d, env) = public_env(file("tet-testnet-3", FOUNDER, TREASURY), &[]);
        assert!(check(&env).unwrap_err().contains("is for chain"));
        // the environment disagreeing with the file
        let (_d, env) = public_env(file("tet-testnet-2", FOUNDER, TREASURY), &[("TET_TREASURY_ADDRESS", TREASURY_DEV_HEX)]);
        assert!(check(&env).unwrap_err().contains("TET_TREASURY_ADDRESS differs"));
        let (_d, env) = public_env(file("tet-testnet-2", FOUNDER, TREASURY), &[("TET_GENESIS_HASH", OLD_PUBLIC_GENESIS)]);
        assert!(check(&env).unwrap_err().contains("TET_GENESIS_HASH differs"));
    }
}
