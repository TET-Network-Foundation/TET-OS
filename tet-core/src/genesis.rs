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

/// Founder cliff length in ms. A genesis parameter since Phase 1: it is in the genesis hash, so a
/// node configured with a different value is on a different chain rather than silently holding a
/// different unlock time (spec §1, design 3).
pub fn founder_cliff_ms_from_env() -> u64 {
    std::env::var("TET_FOUNDER_CLIFF_MS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(365u64 * 86_400_000u64)
}

/// The chain's start instant in Unix ms. Required on mainnet; `0` on a dev chain that does not set
/// it. The founder unlock is `genesis_time_ms + founder_cliff_ms`, identical on every node, and
/// block 1 must carry a `ts_ms` above it.
pub fn genesis_time_ms_from_env() -> Result<u64, String> {
    match std::env::var("TET_GENESIS_TIME_MS") {
        Ok(v) if !v.trim().is_empty() => v
            .trim()
            .parse::<u64>()
            .map_err(|e| format!("TET_GENESIS_TIME_MS: {e}")),
        _ if mainnet_env_enabled() => Err("TET_GENESIS_TIME_MS is required on mainnet".into()),
        _ => Ok(0),
    }
}

/// One entry of the genesis validator set: who may produce, and the key their blocks must verify
/// under. Changing the set changes the genesis hash, i.e. it is a new chain. A rotation mechanism
/// is Phase 1.1 (`docs/QUEUE.md`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GenesisValidator {
    pub producer_id: String,
    #[serde(flatten)]
    pub key: crate::producer_key::ProducerPublicKey,
}

fn normalize_validators(raw: Vec<GenesisValidator>) -> Result<Vec<GenesisValidator>, String> {
    use base64::Engine as _;
    let mut out = Vec::with_capacity(raw.len());
    for v in raw {
        let producer_id = v.producer_id.trim().to_ascii_lowercase();
        if producer_id.is_empty() {
            return Err("genesis validator: producer_id must not be empty".into());
        }
        let ed = v.key.ed25519_pk_hex.trim().to_ascii_lowercase();
        if ed.len() != 64 || !ed.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("genesis validator {producer_id}: ed25519_pk_hex must be 64 hex chars"));
        }
        let ml = v.key.mldsa44_pk_b64.trim().to_string();
        let ml_len = base64::engine::general_purpose::STANDARD
            .decode(ml.as_bytes())
            .map_err(|e| format!("genesis validator {producer_id}: mldsa44_pk_b64: {e}"))?
            .len();
        if ml_len != dilithium::ML_DSA_44.public_key_bytes() {
            return Err(format!(
                "genesis validator {producer_id}: mldsa44_pk_b64 must decode to {} bytes (got {ml_len})",
                dilithium::ML_DSA_44.public_key_bytes()
            ));
        }
        out.push(GenesisValidator {
            producer_id,
            key: crate::producer_key::ProducerPublicKey {
                ed25519_pk_hex: ed,
                mldsa44_pk_b64: ml,
            },
        });
    }
    out.sort_by(|a, b| a.producer_id.cmp(&b.producer_id));
    if let Some(w) = out.windows(2).find(|w| w[0].producer_id == w[1].producer_id) {
        return Err(format!("genesis validator {} is listed twice", w[0].producer_id));
    }
    Ok(out)
}

/// Parse a validator-set JSON document (`[{producer_id, ed25519_pk_hex, mldsa44_pk_b64}, …]`) into
/// the canonical (normalized, sorted, duplicate-free) set.
pub fn parse_genesis_validators(json: &str) -> Result<Vec<GenesisValidator>, String> {
    let raw: Vec<GenesisValidator> =
        serde_json::from_str(json).map_err(|e| format!("genesis validators: {e}"))?;
    normalize_validators(raw)
}

/// The genesis validator set, from the JSON file named by `TET_GENESIS_VALIDATORS`. Required on
/// mainnet. A dev chain that does not set it has an **empty** set: it can mine its own blocks but
/// accepts none from a peer, which is what a single-node dev chain already did.
pub fn genesis_validators_from_env() -> Result<Vec<GenesisValidator>, String> {
    match std::env::var("TET_GENESIS_VALIDATORS") {
        Ok(path) if !path.trim().is_empty() => {
            let json = std::fs::read_to_string(path.trim())
                .map_err(|e| format!("TET_GENESIS_VALIDATORS={}: {e}", path.trim()))?;
            parse_genesis_validators(&json)
        }
        _ if mainnet_env_enabled() => Err("TET_GENESIS_VALIDATORS is required on mainnet".into()),
        _ => Ok(Vec::new()),
    }
}

/// SHA-256 over the canonical validator set, as lowercase hex. Every field is length-prefixed
/// (u64 LE), so no `producer_id` can imitate a field boundary (CLAUDE.md, C5b).
pub fn validators_digest_hex(validators: &[GenesisValidator]) -> String {
    let mut h = Sha256::new();
    h.update(b"tet-validators-v1");
    for v in validators {
        for field in [
            v.producer_id.as_bytes(),
            v.key.ed25519_pk_hex.as_bytes(),
            v.key.mldsa44_pk_b64.as_bytes(),
        ] {
            h.update((field.len() as u64).to_le_bytes());
            h.update(field);
        }
    }
    hex::encode(h.finalize())
}

/// Everything the genesis hash commits to that is not a compile-time constant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenesisParams {
    pub chain_id: String,
    pub founder_wallet_id: String,
    pub treasury_wallet_id: String,
    pub genesis_time_ms: u64,
    pub founder_cliff_ms: u64,
    pub validators: Vec<GenesisValidator>,
}

impl GenesisParams {
    /// Founder + treasury given; chain id, genesis time, cliff and validator set from the
    /// environment.
    pub fn from_env_with(founder_wallet_id: &str, treasury_wallet_id: &str) -> Result<Self, String> {
        Ok(Self {
            chain_id: chain_id_from_env(),
            founder_wallet_id: founder_wallet_id.trim().to_ascii_lowercase(),
            treasury_wallet_id: treasury_wallet_id.trim().to_ascii_lowercase(),
            genesis_time_ms: genesis_time_ms_from_env()?,
            founder_cliff_ms: founder_cliff_ms_from_env(),
            validators: genesis_validators_from_env()?,
        })
    }

    pub fn from_env() -> Result<Self, String> {
        Self::from_env_with(
            &expected_genesis_founder_wallet_from_env(),
            &treasury_address_from_env()?,
        )
    }

    /// Founder unlock instant: `genesis_time_ms + founder_cliff_ms`, identical on every node.
    pub fn founder_unlock_at_ms(&self) -> u64 {
        self.genesis_time_ms.saturating_add(self.founder_cliff_ms)
    }

    /// The UTF-8 pre-image of the genesis hash. Byte-for-byte normative: the UI mirrors it in
    /// `tet-network/ui/app/lib/chain_binding.ts` (`buildGenesisPayloadV2`).
    pub fn payload(&self) -> String {
        format!(
            "tet-genesis-v2|chain_id={}|founder={}|founder_micro={}|worker_pool={}|worker_pool_micro={}|treasury={}|treasury_micro={}|reserve={}|reserve_micro={}|max_supply_micro={}|genesis_time_ms={}|founder_cliff_ms={}|validators={}",
            self.chain_id,
            self.founder_wallet_id,
            GENESIS_FOUNDER_SHARE_MICRO,
            WALLET_WORKER_POOL,
            GENESIS_WORKER_POOL_SHARE_MICRO,
            self.treasury_wallet_id,
            GENESIS_TREASURY_SHARE_MICRO,
            WALLET_PROTOCOL_RESERVE,
            GENESIS_PROTOCOL_RESERVE_SHARE_MICRO,
            MAX_SUPPLY_MICRO,
            self.genesis_time_ms,
            self.founder_cliff_ms,
            validators_digest_hex(&self.validators),
        )
    }

    pub fn hash(&self) -> String {
        format!("0x{}", hex::encode(Sha256::digest(self.payload().as_bytes())))
    }
}

/// Deterministic genesis hash from explicit founder + treasury wallet ids; the other genesis
/// parameters come from the environment. Panics on an invalid genesis configuration (a malformed
/// `TET_GENESIS_VALIDATORS` file, or mainnet without one): there is no hash to fall back to, and a
/// node must not sign or verify anything against a chain it cannot name.
pub fn deterministic_genesis_hash_from_parts(
    founder_wallet_id: &str,
    treasury_wallet_id: &str,
) -> String {
    GenesisParams::from_env_with(founder_wallet_id, treasury_wallet_id)
        .unwrap_or_else(|e| panic!("invalid genesis configuration: {e}"))
        .hash()
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

    fn dev_params() -> GenesisParams {
        GenesisParams {
            chain_id: "tet-local-dev".into(),
            founder_wallet_id: GENESIS_FOUNDER_DEV_PUBLIC_HEX.into(),
            treasury_wallet_id: "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321".into(),
            genesis_time_ms: 0,
            founder_cliff_ms: 365 * 86_400_000,
            validators: vec![],
        }
    }

    /// Golden vector for the v2 payload with dev defaults, computed independently (Python
    /// `hashlib`) and repeated in `tet-network/ui/scripts/verify-genesis-hash.mjs`. If this changes,
    /// the UI mirror in `chain_binding.ts` must change with it.
    #[test]
    fn genesis_hash_v2_dev_golden_vector() {
        let p = dev_params();
        assert_eq!(
            validators_digest_hex(&p.validators),
            "48026ca38ababf8c4f25aa286b5fafa47914cabd5026b7ea9c4fba9ee3b9dd38"
        );
        assert_eq!(p.hash(), "0xf73ff1043163a2d5237d38dc708807a440705e4e29f7d603cc5217921b764de7");
    }

    /// Every genesis parameter moves the hash, so changing any of them is a different chain.
    #[test]
    fn every_genesis_parameter_is_in_the_hash() {
        let base = dev_params().hash();
        let v = GenesisValidator {
            producer_id: "alice".into(),
            key: crate::producer_key::ProducerKeypair::from_seeds(&[1; 32], &[2; 32]).public_key(),
        };
        for (name, p) in [
            ("genesis_time_ms", GenesisParams { genesis_time_ms: 1, ..dev_params() }),
            ("founder_cliff_ms", GenesisParams { founder_cliff_ms: 0, ..dev_params() }),
            ("validators", GenesisParams { validators: vec![v], ..dev_params() }),
        ] {
            assert_ne!(p.hash(), base, "{name} must be in the genesis hash");
        }
    }

    /// C5b: the digest's fields are length-prefixed, so a `producer_id` that contains what an
    /// unprefixed encoding would use as a boundary cannot shift bytes between fields. The inputs
    /// here carry the separator: concatenated without prefixes, both sets are the same bytes.
    #[test]
    fn validators_digest_has_no_field_boundary_collision() {
        let pk = |ed: &str| crate::producer_key::ProducerPublicKey {
            ed25519_pk_hex: ed.into(),
            mldsa44_pk_b64: "M".into(),
        };
        let a = vec![GenesisValidator { producer_id: "ab".into(), key: pk("cd") }];
        let b = vec![GenesisValidator { producer_id: "a".into(), key: pk("bcd") }];
        assert_eq!(
            format!("{}{}{}", a[0].producer_id, a[0].key.ed25519_pk_hex, a[0].key.mldsa44_pk_b64),
            format!("{}{}{}", b[0].producer_id, b[0].key.ed25519_pk_hex, b[0].key.mldsa44_pk_b64),
            "precondition: without length prefixes these collide"
        );
        assert_ne!(validators_digest_hex(&a), validators_digest_hex(&b));
    }

    #[test]
    fn genesis_validator_set_is_validated_and_canonical() {
        let k = |n: u8| crate::producer_key::ProducerKeypair::from_seeds(&[n; 32], &[n; 32]).public_key();
        let entry = |id: &str, n: u8| serde_json::json!({
            "producer_id": id, "ed25519_pk_hex": k(n).ed25519_pk_hex, "mldsa44_pk_b64": k(n).mldsa44_pk_b64,
        });
        let set = parse_genesis_validators(&serde_json::json!([entry(" Bob ", 2), entry("alice", 1)]).to_string()).unwrap();
        assert_eq!(set.iter().map(|v| v.producer_id.as_str()).collect::<Vec<_>>(), ["alice", "bob"]);

        let dup = serde_json::json!([entry("alice", 1), entry("ALICE", 2)]).to_string();
        assert!(parse_genesis_validators(&dup).unwrap_err().contains("listed twice"));

        // An ML-DSA-65 key is refused: the producer key is level 44 (item 5's floor).
        let ml65 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            vec![0u8; dilithium::ML_DSA_65.public_key_bytes()],
        );
        let bad = serde_json::json!([{ "producer_id": "alice", "ed25519_pk_hex": k(1).ed25519_pk_hex, "mldsa44_pk_b64": ml65 }]).to_string();
        assert!(parse_genesis_validators(&bad).unwrap_err().contains("must decode to 1312 bytes"));
    }
}
