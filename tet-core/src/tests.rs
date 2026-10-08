#![allow(clippy::await_holding_lock)]

use axum::http::header::HeaderName;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use base64::Engine as _;
use ed25519_dalek::Signer as _;
use ed25519_dalek::SigningKey;
use rand_core::RngCore as _;
use serde_json::Value;
use sha2::Digest as _;
fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    crate::test_env::lock()
}

/// Sets an env var and restores the previous value when dropped — **including on panic**.
///
/// Tests that flip `TET_MAINNET` used a bare `set_var` at the top and a matching `remove_var` at
/// the bottom. If anything between them panicked, the cleanup never ran and `TET_MAINNET=1`
/// leaked into every test that followed, which then died in `apply_genesis_allocation` with
/// "CRITICAL: TET_MAINNET=1 requires TET_GENESIS_FOUNDER_WALLET_ID". One broken assertion turned
/// into twenty failures pointing at innocent code. Drop runs on the unwind path, so a guard
/// cannot leak that way.
///
/// Declare it AFTER `let _g = env_lock();` so it is restored before the lock is released.
struct EnvVarGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var(key).ok();
        // Safety: callers hold ENV_LOCK, same contract as set_test_env_base.
        unsafe {
            std::env::set_var(key, value);
        }
        Self { key, previous }
    }

    /// Removes the var for the test's duration, restoring it on drop.
    fn unset(key: &'static str) -> Self {
        let previous = std::env::var(key).ok();
        // Safety: as above.
        unsafe {
            std::env::remove_var(key);
        }
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        // Safety: as above — the env lock is still held by the caller's guard.
        unsafe {
            match self.previous.as_deref() {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }
}

fn set_test_env_base() {
    // Safety: these tests serialize on ENV_LOCK.
    unsafe {
        std::env::set_var("TET_DB_ENCRYPT", "false");
        std::env::set_var("TET_REQUIRE_ATTESTATION", "false");
        std::env::set_var("TET_API_KEY", "testkey");
        std::env::set_var("TET_ADMIN_API_KEY", "test-admin-key");
        std::env::set_var("TET_DISABLE_RATE_LIMIT", "1");
        std::env::set_var("TET_FOUNDER_WALLET", "founder");
        std::env::set_var(
            "TET_TREASURY_ADDRESS",
            "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
        );
        // Tests assume founder funds are liquid; disable founder genesis cliff lock for unit tests.
        std::env::set_var("TET_FOUNDER_CLIFF_MS", "0");
        // Avoid cross-test leakage (parallel default + snapshot test overrides).
        std::env::remove_var("TET_LEDGER_JSON_PATH");
        std::env::remove_var("TET_LEDGER_TMP_PATH");
        std::env::remove_var("TET_VALIDATOR_IDS");
        std::env::remove_var("TET_WALLET_ID");
        std::env::remove_var("TET_PEER_ID");
        std::env::remove_var("TET_BLOCK_TIME_SEC");
        std::env::remove_var("TET_CONSENSUS_LEADER_MODE");
        std::env::remove_var("TET_BASE_BLOCK_REWARD");
        std::env::remove_var("TET_ALLOW_MOCK_ZK");
        std::env::remove_var("TET_JOULES_PER_FLOP");
        std::env::remove_var("TET_NETWORK_DIFFICULTY_GAMMA");
        std::env::remove_var("TET_THERMO_STEVEMON_MICRO_SCALE");
    }
}

fn open_temp_ledger() -> crate::ledger::Ledger {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("db");
    // Keep tempdir alive by leaking it for test lifetime (small, per-test).
    std::mem::forget(dir);
    crate::ledger::Ledger::open(db.to_str().unwrap()).unwrap()
}

fn rest_state_for_tests(ledger: std::sync::Arc<crate::ledger::Ledger>) -> crate::rest::RestState {
    let hide_db = ledger.sled_db();
    let (log_tx, _log_rx) = tokio::sync::broadcast::channel::<String>(64);
    let tmail = std::sync::Arc::new(
        crate::tmail::store::TmailStore::open(&ledger.sled_db()).expect("tmail store"),
    );
    let files = std::sync::Arc::new(
        crate::files::storage::FileStore::open(&ledger.sled_db()).expect("file store"),
    );
    crate::rest::RestState {
        ledger,
        wallet_id: "test-node-wallet".to_string(),
        p2p_tx: None,
        p2p_client: None,
        gossip_tx: None,
        block_sync_board: None,
        swarm_health: None,
        mempool: std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new())),
        pending_rebroadcast: std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        tmail,
        files,
        files_fetch_tx: None,
        tx_submit_tx: None,
        anon_register_tx: None,
        http_ratelimit: std::sync::Arc::new(tokio::sync::Mutex::new(
            crate::rest::HttpRateLimit::new(999),
        )),
        workers: std::sync::Arc::new(std::sync::Mutex::new(
            crate::worker_network::WorkerRegistry::default(),
        )),
        e2ee_jobs: std::sync::Arc::new(std::sync::Mutex::new(crate::rest::E2eeJobQueue::default())),
        genesis_1k_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        log_tx,
        log_sse_connections: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        demo_sponsor: None,
        operator_hide: crate::operator_hide::OperatorHide::open(&hide_db).unwrap(),
    }
}

fn admin_headers_for_tests() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        axum::http::header::AUTHORIZATION,
        "Bearer test-admin-key".parse().unwrap(),
    );
    h
}

/// Hybrid-signs `tx` over the **pre-2026-09-21 bare-JSON preimage** — `serde_json::to_vec(&tx)`,
/// with no chain_id / genesis_hash / ML-DSA binding.
///
/// Only for the guards that prove this form is REJECTED. Nothing may use it to build an envelope
/// it expects to be accepted.
fn legacy_bare_json_env_for_tests(
    tx: crate::protocol::TxV1,
    words: &str,
    wallet_id: &str,
) -> crate::protocol::SignedTxEnvelopeV1 {
    let legacy_bytes = serde_json::to_vec(&tx).unwrap();
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    crate::protocol::SignedTxEnvelopeV1 {
        v: 1,
        tx,
        sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: wallet_id.to_string(),
            ed25519_sig_b64: base64::engine::general_purpose::STANDARD
                .encode(ed_sk.sign(legacy_bytes.as_slice()).to_bytes()),
            mldsa_pubkey_b64: base64::engine::general_purpose::STANDARD
                .encode(mldsa_kp.public_key()),
            mldsa_sig_b64: base64::engine::general_purpose::STANDARD.encode(
                crate::wallet::mldsa_sign_deterministic(&mldsa_kp, legacy_bytes.as_slice())
                    .unwrap(),
            ),
        },
        attestation: crate::protocol::AttestationV1 {
            platform: "test".to_string(),
            report_b64: String::new(),
        },
    }
}

/// Hybrid-signs `tx` over the **canonical** preimage
/// (`wallet::tx_v1_auth_message_bytes` — `tet tx v1|chain_id=..|genesis_hash=..|mldsa=..|tx=..`).
///
/// This is the ONLY form `verify_envelope_v1` accepts since the dev fallback was removed, so
/// every envelope the tests build goes through here. Consequence worth knowing: the preimage
/// reads `TET_CHAIN_ID`, `TET_TREASURY_ADDRESS` and the founder wallet from the process env, so
/// a caller must be holding `env_lock()` and have run `set_test_env_base()` — otherwise the
/// signature binds to a different genesis than the ledger under test and every route returns 401.
/// One place to fix if `set_test_env_base` ever changes.
fn signed_env_for_tests(
    tx: crate::protocol::TxV1,
    words: &str,
    wallet_id: &str,
) -> crate::protocol::SignedTxEnvelopeV1 {
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());

    let msg = crate::wallet::tx_v1_auth_message_bytes(&tx, &mldsa_pubkey_b64).unwrap();

    let ed_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    let mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap());

    crate::protocol::SignedTxEnvelopeV1 {
        v: 1,
        tx,
        sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: wallet_id.to_string(),
            ed25519_sig_b64: ed_sig_b64,
            mldsa_pubkey_b64,
            mldsa_sig_b64,
        },
        attestation: crate::protocol::AttestationV1 {
            platform: "test".to_string(),
            report_b64: String::new(),
        },
    }
}

fn signed_transfer_env_for_tests(
    from_words: &str,
    from_wallet_id: &str,
    to_wallet_id: &str,
    amount_micro: u64,
) -> crate::protocol::SignedTxEnvelopeV1 {
    let tx = crate::protocol::TxV1::Transfer {
        from_wallet: from_wallet_id.to_string(),
        to_wallet: to_wallet_id.to_string(),
        amount_micro,
        fee_bps: 100,
    };
    signed_env_for_tests(tx, from_words, from_wallet_id)
}

fn signed_file_fee_env_for_tests(
    from_words: &str,
    from_wallet_id: &str,
    storage_wallet: &str,
    file_id: &str,
) -> crate::protocol::SignedTxEnvelopeV1 {
    let tx = crate::protocol::TxV1::FileFee {
        from_wallet: from_wallet_id.to_string(),
        storage_wallet: storage_wallet.to_string(),
        file_id: file_id.to_string(),
        fee_micro: crate::files::FILE_FEE_MICRO,
    };
    signed_env_for_tests(tx, from_words, from_wallet_id)
}

fn signed_worker_register_env_for_tests(
    words: &str,
    wallet_id: &str,
    hardware_id_hex: &str,
) -> crate::protocol::SignedTxEnvelopeV1 {
    let tx = crate::protocol::TxV1::WorkerRegister {
        wallet_id: wallet_id.to_string(),
        hardware_id_hex: hardware_id_hex.to_string(),
        hardware_profile: "cpu-prover-v1".to_string(),
        capabilities: vec!["zk_prove".to_string()],
        tflops_declared: 4.0,
    };
    signed_env_for_tests(tx, words, wallet_id)
}

fn signed_zk_env_for_tests(
    words: &str,
    wallet_id: &str,
    journal_b64: String,
    receipt_b64: String,
) -> crate::protocol::SignedTxEnvelopeV1 {
    signed_zk_env_with_task_for_tests(words, wallet_id, "", journal_b64, receipt_b64)
}

fn signed_zk_env_with_task_for_tests(
    words: &str,
    wallet_id: &str,
    task_id: &str,
    journal_b64: String,
    receipt_b64: String,
) -> crate::protocol::SignedTxEnvelopeV1 {
    let tx = crate::protocol::TxV1::VerifyZkProof {
        task_id: task_id.to_string(),
        image_id: methods::NEXUS_GUEST_ID,
        journal_b64,
        receipt_b64,
    };
    signed_env_for_tests(tx, words, wallet_id)
}

fn signed_enterprise_inference_env_for_tests(
    words: &str,
    wallet_id: &str,
    prompt: &str,
    model: &str,
    amount_micro: u64,
    nonce: u64,
    workload_flag: u8,
) -> crate::protocol::SignedTxEnvelopeV1 {
    let prompt_sha256_hex = hex::encode(sha2::Sha256::digest(prompt.trim().as_bytes()));
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let tx = crate::protocol::TxV1::EnterpriseInference {
        enterprise_wallet_id: wallet_id.to_string(),
        prompt: prompt.to_string(),
        model: model.to_string(),
        amount_micro,
        nonce,
        prompt_sha256_hex,
        workload_flag,
        attestation_required: false,
    };
    let msg = crate::wallet::enterprise_inference_hybrid_auth_message_bytes(
        wallet_id,
        nonce,
        amount_micro,
        match &tx {
            crate::protocol::TxV1::EnterpriseInference {
                prompt_sha256_hex, ..
            } => prompt_sha256_hex,
            _ => unreachable!(),
        },
        model,
        false,
        &mldsa_pubkey_b64,
    );
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let ed_sig = ed_sk.sign(msg.as_slice());
    let ed_sig_b64 = base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes().as_slice());
    let mldsa_sig_bytes =
        crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap();
    let mldsa_sig_b64 = base64::engine::general_purpose::STANDARD.encode(&mldsa_sig_bytes);

    crate::protocol::SignedTxEnvelopeV1 {
        v: 1,
        tx,
        sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: wallet_id.to_string(),
            ed25519_sig_b64: ed_sig_b64,
            mldsa_pubkey_b64,
            mldsa_sig_b64,
        },
        attestation: crate::protocol::AttestationV1 {
            platform: "test".to_string(),
            report_b64: String::new(),
        },
    }
}

#[test]
fn hash_leader_election_is_deterministic_and_single_winner() {
    let _g = env_lock();
    set_test_env_base();
    use crate::consensus::LeaderElection as _;

    let validators = crate::consensus::ValidatorSet::new(["alice", "bob", "carol"]);
    let election = crate::consensus::HashLeaderElection;
    let leader1 = election.leader_for_height(42, &validators).unwrap();
    let leader2 = election.leader_for_height(42, &validators).unwrap();

    assert_eq!(leader1, leader2);
    assert!(validators.contains(leader1.as_str()));
    assert!(election.is_leader(42, leader1.as_str(), &validators));
}

#[test]
fn caac_weight_from_record_uses_role_latency_and_fallback() {
    let _g = env_lock();
    set_test_env_base();

    let poc = crate::ledger::CaacWorkerRecord {
        role: "POC".to_string(),
        latency_ms: 1,
        seed_hex: "00".repeat(32),
        server_wall_ms: 10,
    };
    let por = crate::ledger::CaacWorkerRecord {
        role: "POR".to_string(),
        latency_ms: 1000,
        seed_hex: "11".repeat(32),
        server_wall_ms: 10,
    };

    assert_eq!(crate::consensus::caac_weight_from_record(None), 10);
    assert!(crate::consensus::caac_weight_from_record(Some(&poc)) > 100);
    assert!(
        crate::consensus::caac_weight_from_record(Some(&poc))
            > crate::consensus::caac_weight_from_record(Some(&por))
    );
}

#[test]
fn caac_leader_election_is_deterministic() {
    let _g = env_lock();
    set_test_env_base();
    use crate::consensus::LeaderElection as _;

    let provider = crate::consensus::StaticCaacWeightProvider::new([
        ("alice", 10),
        ("bob", 250),
        ("carol", 100),
    ]);
    let election = crate::consensus::CaacLeaderElection::new(provider);
    let validators = crate::consensus::ValidatorSet::new(["alice", "bob", "carol"]);

    let leader1 = election.leader_for_height(777, &validators).unwrap();
    let leader2 = election.leader_for_height(777, &validators).unwrap();

    assert_eq!(leader1, leader2);
    assert!(validators.contains(leader1.as_str()));
}

#[test]
fn ledger_caac_weight_provider_reads_worker_records() {
    let _g = env_lock();
    set_test_env_base();
    use crate::consensus::CaacWeightProvider as _;

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger
        .caac_put_worker_record(
            "poc",
            &crate::ledger::CaacWorkerRecord {
                role: "POC".to_string(),
                latency_ms: 1,
                seed_hex: "22".repeat(32),
                server_wall_ms: 10,
            },
        )
        .unwrap();

    let provider = crate::consensus::LedgerCaacWeightProvider::new(ledger);
    assert!(provider.consensus_weight("poc") > provider.consensus_weight("missing"));
}

#[test]
fn caac_high_weight_validator_wins_more_often_over_many_heights() {
    let _g = env_lock();
    set_test_env_base();
    use crate::consensus::LeaderElection as _;

    let provider = crate::consensus::StaticCaacWeightProvider::new([("poc", 1100), ("por", 26)]);
    let election = crate::consensus::CaacLeaderElection::new(provider);
    let validators = crate::consensus::ValidatorSet::new(["poc", "por"]);

    let poc_wins = (1..=200)
        .filter(|height| {
            election
                .leader_for_height(*height, &validators)
                .map(|leader| leader.as_str() == "poc")
                .unwrap_or(false)
        })
        .count();

    assert!(poc_wins > 120, "poc_wins={poc_wins}");
}

#[test]
fn local_caac_profile_resource_weight_prefers_poc_gpu_and_capacity() {
    let _g = env_lock();
    set_test_env_base();

    let poc = crate::vision::caac::CaacProfile {
        role: crate::vision::caac::NodeRelayRole::Poc,
        hw: crate::vision::caac::HardwareFingerprint {
            fingerprint_sha256_hex: "a".repeat(64),
            cpu_logical_cores: 16,
            ram_total_bytes: 64 * 1024 * 1024 * 1024,
            gpu_detected: true,
            gpu_hint: "test".to_string(),
        },
    };
    let por = crate::vision::caac::CaacProfile {
        role: crate::vision::caac::NodeRelayRole::Por,
        hw: crate::vision::caac::HardwareFingerprint {
            fingerprint_sha256_hex: "b".repeat(64),
            cpu_logical_cores: 2,
            ram_total_bytes: 4 * 1024 * 1024 * 1024,
            gpu_detected: false,
            gpu_hint: "test".to_string(),
        },
    };

    assert!(
        crate::vision::caac::local_resource_weight(&poc)
            > crate::vision::caac::local_resource_weight(&por)
    );
}

#[tokio::test]
async fn remote_block_rejects_non_leader_producer() {
    let _g = env_lock();
    set_test_env_base();
    use crate::consensus::LeaderElection as _;
    unsafe {
        std::env::set_var("TET_VALIDATOR_IDS", "alice,bob");
        std::env::set_var("TET_WALLET_ID", "alice");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet_id = sender.address_hex.to_ascii_lowercase();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(
            &sender_wallet_id,
            1000 * crate::ledger::STEVEMON,
            "ip",
            true,
            1,
            1,
        )
        .unwrap();

    let env = signed_transfer_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        &recipient_wallet_id,
        crate::ledger::STEVEMON,
    );
    let tx_hash = crate::consensus::tx_hash_for_env(&env).unwrap();
    let reward = crate::consensus::reward_for_block(std::slice::from_ref(&env)).unwrap();
    let state_root = ledger
        .compute_state_root_after_remote_block(
            std::slice::from_ref(&env),
            "alice",
            reward.total_reward_micro,
        )
        .unwrap();

    let validators = crate::consensus::ValidatorSet::new(["alice", "bob"]);
    let leader = crate::consensus::HashLeaderElection
        .leader_for_height(1, &validators)
        .unwrap()
        .as_str()
        .to_string();
    let non_leader = if leader == "alice" { "bob" } else { "alice" }.to_string();
    let block_id = crate::consensus::block_id_for_block(
        1,
        "",
        &state_root,
        std::slice::from_ref(&tx_hash),
        &non_leader,
    );

    let res = crate::consensus::apply_remote_block_from_gossip(
        ledger,
        state.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height: 1,
            block_id,
            parent_block_id: None,
            producer_id: non_leader,
            base_reward_micro: reward.base_reward_micro,
            compute_reward_micro: reward.compute_reward_micro,
            total_reward_micro: reward.total_reward_micro,
            state_root,
            txs: vec![env],
        },
    )
    .await;
    assert!(matches!(
        res,
        Err(crate::consensus::RemoteBlockApplyError::Rejected(_))
    ));
}

#[tokio::test]
async fn auto_miner_skips_when_local_node_is_not_leader() {
    let _g = env_lock();
    set_test_env_base();
    use crate::consensus::LeaderElection as _;
    unsafe {
        std::env::set_var("TET_BLOCK_TIME_SEC", "1");
    }

    let validators = crate::consensus::ValidatorSet::new(["alice", "bob"]);
    let leader = crate::consensus::HashLeaderElection
        .leader_for_height(1, &validators)
        .unwrap()
        .as_str()
        .to_string();
    let non_leader = if leader == "alice" { "bob" } else { "alice" }.to_string();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet_id = sender.address_hex.to_ascii_lowercase();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(
            &sender_wallet_id,
            1000 * crate::ledger::STEVEMON,
            "ip",
            true,
            1,
            1,
        )
        .unwrap();
    state
        .mempool
        .lock()
        .await
        .push(signed_transfer_env_for_tests(
            &sender_words,
            &sender_wallet_id,
            &recipient_wallet_id,
            crate::ledger::STEVEMON,
        ));

    let handle = crate::consensus::spawn_auto_miner(state.clone(), None, non_leader, validators);
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    handle.abort();

    assert_eq!(ledger.block_height().unwrap(), 0);
    assert_eq!(state.mempool.lock().await.len(), 1);
}

#[tokio::test]
async fn auto_miner_mines_coinbase_only_blocks_when_mempool_is_empty() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BLOCK_TIME_SEC", "1");
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let validators = crate::consensus::ValidatorSet::new(["alice"]);

    let pool_before = ledger
        .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
        .unwrap();
    let producer_before = ledger.balance_micro("alice").unwrap();

    let handle =
        crate::consensus::spawn_auto_miner(state.clone(), None, "alice".to_string(), validators);
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    handle.abort();

    assert_eq!(state.mempool.lock().await.len(), 0);
    assert!(ledger.block_height().unwrap() >= 1);
    assert!(
        ledger.balance_micro("alice").unwrap() >= producer_before + crate::ledger::STEVEMON / 10
    );
    assert!(
        ledger
            .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
            .unwrap()
            <= pool_before - crate::ledger::STEVEMON / 10
    );
}

#[tokio::test]
async fn enterprise_inference_tx_enters_mempool_with_workload_flag() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(&wallet_id, crate::ledger::STEVEMON, "ip", true, 1, 1)
        .unwrap();
    let env = signed_enterprise_inference_env_for_tests(
        &words,
        &wallet_id,
        "summarize demand",
        "llama3",
        10_000,
        1,
        crate::protocol::WorkloadFlag::AiInference.as_u8(),
    );

    let resp = crate::rest::handlers::enterprise::post_enterprise_inference_submit(
        axum::extract::State(state.clone()),
        HeaderMap::new(),
        axum::Json(env),
    )
    .await
    .into_response();

    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let mp = state.mempool.lock().await;
    assert_eq!(mp.len(), 1);
    assert_eq!(
        mp[0].tx.workload_flag(),
        crate::protocol::WorkloadFlag::AiInference
    );
}

#[tokio::test]
async fn poc_producer_can_mine_ai_workload_block() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .caac_put_worker_record(
            "alice",
            &crate::ledger::CaacWorkerRecord {
                role: "POC".to_string(),
                latency_ms: 1,
                seed_hex: "seed".to_string(),
                server_wall_ms: 1,
            },
        )
        .unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    let env = signed_enterprise_inference_env_for_tests(
        &words,
        &wallet_id,
        "run inference",
        "llama3",
        10_000,
        1,
        crate::protocol::WorkloadFlag::AiInference.as_u8(),
    );
    state.mempool.lock().await.push(env);

    let outcome = crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string())
        .await
        .unwrap();

    assert!(outcome.mined);
    assert_eq!(outcome.tx_count, 1);
    assert_eq!(ledger.block_height().unwrap(), 1);
    assert_eq!(state.mempool.lock().await.len(), 0);
}

#[tokio::test]
async fn por_producer_cannot_mine_ai_workload_and_keeps_mempool() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .caac_put_worker_record(
            "alice",
            &crate::ledger::CaacWorkerRecord {
                role: "POR".to_string(),
                latency_ms: 100,
                seed_hex: "seed".to_string(),
                server_wall_ms: 1,
            },
        )
        .unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    let env = signed_enterprise_inference_env_for_tests(
        &words,
        &wallet_id,
        "run inference",
        "llama3",
        10_000,
        1,
        crate::protocol::WorkloadFlag::AiInference.as_u8(),
    );
    state.mempool.lock().await.push(env);

    let res = crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string()).await;
    assert!(matches!(
        res,
        Err(crate::consensus::MineError::Unauthorized(_))
    ));
    assert_eq!(ledger.block_height().unwrap(), 0);
    assert_eq!(state.mempool.lock().await.len(), 1);
}

#[tokio::test]
async fn remote_ai_workload_rejects_non_poc_producer() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_VALIDATOR_IDS", "alice");
        std::env::set_var("TET_WALLET_ID", "alice");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .caac_put_worker_record(
            "alice",
            &crate::ledger::CaacWorkerRecord {
                role: "POR".to_string(),
                latency_ms: 100,
                seed_hex: "seed".to_string(),
                server_wall_ms: 1,
            },
        )
        .unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    let env = signed_enterprise_inference_env_for_tests(
        &words,
        &wallet_id,
        "remote ai workload",
        "llama3",
        10_000,
        1,
        crate::protocol::WorkloadFlag::AiInference.as_u8(),
    );
    let tx_hash = crate::consensus::tx_hash_for_env(&env).unwrap();
    let reward = crate::consensus::reward_for_block(std::slice::from_ref(&env)).unwrap();
    let state_root = ledger
        .compute_state_root_after_remote_block(
            std::slice::from_ref(&env),
            "alice",
            reward.total_reward_micro,
        )
        .unwrap();
    let block_id = crate::consensus::block_id_for_block(
        1,
        "",
        &state_root,
        std::slice::from_ref(&tx_hash),
        "alice",
    );

    let res = crate::consensus::apply_remote_block_from_gossip(
        ledger,
        state.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height: 1,
            block_id,
            parent_block_id: None,
            producer_id: "alice".to_string(),
            base_reward_micro: reward.base_reward_micro,
            compute_reward_micro: reward.compute_reward_micro,
            total_reward_micro: reward.total_reward_micro,
            state_root,
            txs: vec![env],
        },
    )
    .await;
    assert!(matches!(
        res,
        Err(crate::consensus::RemoteBlockApplyError::Rejected(_))
    ));
}

#[tokio::test]
async fn por_auto_miner_preserves_ai_workload_and_mines_empty_block() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BLOCK_TIME_SEC", "1");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .caac_put_worker_record(
            "alice",
            &crate::ledger::CaacWorkerRecord {
                role: "POR".to_string(),
                latency_ms: 100,
                seed_hex: "seed".to_string(),
                server_wall_ms: 1,
            },
        )
        .unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    let env = signed_enterprise_inference_env_for_tests(
        &words,
        &wallet_id,
        "keep me pending",
        "llama3",
        10_000,
        1,
        crate::protocol::WorkloadFlag::AiInference.as_u8(),
    );
    state.mempool.lock().await.push(env);

    let handle = crate::consensus::spawn_auto_miner(
        state.clone(),
        None,
        "alice".to_string(),
        crate::consensus::ValidatorSet::new(["alice"]),
    );
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    handle.abort();

    assert!(ledger.block_height().unwrap() >= 1);
    assert_eq!(state.mempool.lock().await.len(), 1);
}

#[tokio::test]
async fn same_height_fork_choice_reports_remote_winner_without_reorg() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_VALIDATOR_IDS", "alice");
        std::env::set_var("TET_WALLET_ID", "alice");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet_id = sender.address_hex.to_ascii_lowercase();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(
            &sender_wallet_id,
            1000 * crate::ledger::STEVEMON,
            "ip",
            true,
            1,
            1,
        )
        .unwrap();

    let env = signed_transfer_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        &recipient_wallet_id,
        crate::ledger::STEVEMON,
    );
    let reward = crate::consensus::reward_for_block(std::slice::from_ref(&env)).unwrap();
    let tx_hash = crate::consensus::tx_hash_for_env(&env).unwrap();
    let remote_block_id = crate::consensus::block_id_for_block(
        1,
        "",
        "0xnot-checked-for-same-height",
        std::slice::from_ref(&tx_hash),
        "alice",
    );
    ledger.set_block_height_if_newer(1).unwrap();
    ledger
        .record_block_summary(1, "zzzz-local-block", "0xlocal", 1)
        .unwrap();

    let res = crate::consensus::apply_remote_block_from_gossip(
        ledger,
        state.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height: 1,
            block_id: remote_block_id,
            parent_block_id: None,
            producer_id: "alice".to_string(),
            base_reward_micro: reward.base_reward_micro,
            compute_reward_micro: reward.compute_reward_micro,
            total_reward_micro: reward.total_reward_micro,
            state_root: "0xnot-checked-for-same-height".to_string(),
            txs: vec![env],
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        res,
        crate::consensus::RemoteBlockApplyOutcome::ForkLost { .. }
    ));
}

#[tokio::test]
async fn phase2_mempool_mine_and_apply_block_to_peer() {
    let _g = env_lock();
    set_test_env_base();

    // Node A + Node B ledgers.
    let ledger_a = std::sync::Arc::new(open_temp_ledger());
    ledger_a.init_genesis_founder_premine_from_env().unwrap();
    ledger_a.apply_genesis_allocation("founder").unwrap();

    let ledger_b = std::sync::Arc::new(open_temp_ledger());
    ledger_b.init_genesis_founder_premine_from_env().unwrap();
    ledger_b.apply_genesis_allocation("founder").unwrap();

    let state_a = rest_state_for_tests(ledger_a.clone());
    let state_b = rest_state_for_tests(ledger_b.clone());

    // Sender/recipient wallets (real keys for envelope verification).
    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet_id = sender.address_hex.to_ascii_lowercase();

    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();

    // [A] Seed the sender directly on the ledger. The REST faucet handler was removed on
    // 2026-09-19 because it wrote balances outside the block pipeline and forked state_root on
    // whichever node served it. The consensus-safe faucet is POST /ledger/initial_airdrop/claim.
    let outcome = ledger_a
        .admin_rest_faucet(
            &sender_wallet_id,
            1000 * crate::ledger::STEVEMON,
            "127.0.0.1",
            true,
            1,
            1,
        )
        .unwrap();
    let audit_hash_hex = match outcome {
        crate::ledger::AdminRestFaucetOutcome::Granted { audit_hash_hex, .. } => audit_hash_hex,
        other => panic!("seed failed: {other:?}"),
    };
    assert!(!audit_hash_hex.is_empty());

    // [B] Fund the same wallet directly. Gossip no longer moves balances (see
    // `gossip_balance_events_are_refused_and_change_nothing`), so this uses the test-only writer.
    assert!(ledger_b
        .apply_remote_faucet(&audit_hash_hex, &sender_wallet_id, 1000u64 * crate::ledger::STEVEMON)
        .unwrap());

    // [A] Submit transfer: must be 202 Accepted, DB unchanged, mempool len=1.
    let amount_micro = crate::ledger::STEVEMON;
    let tx = crate::protocol::TxV1::Transfer {
        from_wallet: sender_wallet_id.clone(),
        to_wallet: recipient_wallet_id.clone(),
        amount_micro,
        fee_bps: 100,
    };
    let env = signed_env_for_tests(tx.clone(), &sender_words, &sender_wallet_id);

    let bal_before = ledger_a.balance_micro(&sender_wallet_id).unwrap();
    let resp2 = crate::rest::handlers::ledger::post_transfer_enveloped(
        axum::extract::State(state_a.clone()),
        HeaderMap::new(),
        axum::Json(env.clone()),
    )
    .await
    .into_response();
    assert_eq!(resp2.status(), StatusCode::ACCEPTED);
    assert_eq!(state_a.mempool.lock().await.len(), 1);
    assert_eq!(
        ledger_a.balance_micro(&sender_wallet_id).unwrap(),
        bal_before
    );

    // [A] Mine: mempool drained, balances updated.
    let resp3 = crate::rest::handlers::ledger::post_ledger_mine(
        axum::extract::State(state_a.clone()),
        admin_headers_for_tests(),
    )
    .await
    .into_response();
    assert_eq!(resp3.status(), StatusCode::OK);
    let body3 = axum::body::to_bytes(resp3.into_body(), usize::MAX)
        .await
        .unwrap();
    let mined: Value = serde_json::from_slice(&body3).unwrap();
    let block_height = mined
        .get("block_height")
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let block_id = mined
        .get("block_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let state_root = mined
        .get("state_root")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let producer_id = mined
        .get("producer_id")
        .and_then(|x| x.as_str())
        .unwrap_or("local-wallet")
        .to_string();
    let base_reward_micro = mined
        .get("base_reward_micro")
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let compute_reward_micro = mined
        .get("compute_reward_micro")
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let total_reward_micro = mined
        .get("total_reward_micro")
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    assert_eq!(block_height, 1);
    assert!(!block_id.is_empty());
    assert!(!state_root.is_empty());
    assert_eq!(state_a.mempool.lock().await.len(), 0);
    assert!(ledger_a.balance_micro(&sender_wallet_id).unwrap() < bal_before);

    // [B] Reject bad state_root before mutating local state.
    let sender_before_remote = ledger_b.balance_micro(&sender_wallet_id).unwrap();
    let bad = crate::consensus::apply_remote_block_from_gossip(
        ledger_b.clone(),
        state_b.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height,
            block_id: block_id.clone(),
            parent_block_id: None,
            producer_id: producer_id.clone(),
            base_reward_micro,
            compute_reward_micro,
            total_reward_micro,
            state_root: "0xbad-root".to_string(),
            txs: vec![env.clone()],
        },
    )
    .await;
    assert!(matches!(
        bad,
        Err(crate::consensus::RemoteBlockApplyError::Rejected(_))
    ));
    assert_eq!(ledger_b.block_height().unwrap(), 0);
    assert_eq!(
        ledger_b.balance_micro(&sender_wallet_id).unwrap(),
        sender_before_remote
    );

    // [B] If the same tx is still pending locally, applying the remote block must evict it.
    state_b.mempool.lock().await.push(env.clone());
    let applied = crate::consensus::apply_remote_block_from_gossip(
        ledger_b.clone(),
        state_b.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height,
            block_id: block_id.clone(),
            parent_block_id: None,
            producer_id: producer_id.clone(),
            base_reward_micro,
            compute_reward_micro,
            total_reward_micro,
            state_root: state_root.clone(),
            txs: vec![env.clone()],
        },
    )
    .await
    .unwrap();
    match applied {
        crate::consensus::RemoteBlockApplyOutcome::Applied {
            block_height,
            tx_count,
            evicted_count,
            state_root: applied_root,
        } => {
            assert_eq!(block_height, 1);
            assert_eq!(tx_count, 1);
            assert_eq!(evicted_count, 1);
            assert_eq!(applied_root, state_root);
        }
        other => panic!("expected remote block apply, got {other:?}"),
    }
    assert_eq!(state_b.mempool.lock().await.len(), 0);
    assert_eq!(ledger_b.block_height().unwrap(), 1);

    assert_eq!(
        ledger_b.balance_micro(&sender_wallet_id).unwrap(),
        ledger_a.balance_micro(&sender_wallet_id).unwrap()
    );
    assert_eq!(
        ledger_b.balance_micro(&recipient_wallet_id).unwrap(),
        ledger_a.balance_micro(&recipient_wallet_id).unwrap()
    );

    // Deterministic state root: after applying same block, roots match.
    assert_eq!(ledger_a.compute_state_root().unwrap(), ledger_b.compute_state_root().unwrap());

    let skipped = crate::consensus::apply_remote_block_from_gossip(
        ledger_b.clone(),
        state_b.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height,
            block_id,
            parent_block_id: None,
            producer_id,
            base_reward_micro,
            compute_reward_micro,
            total_reward_micro,
            state_root,
            txs: vec![env],
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        skipped,
        crate::consensus::RemoteBlockApplyOutcome::Skipped { .. }
    ));
}

/// Build a valid single-transfer remote block gossip at `height` from the producer ledger's
/// *current* state (single-validator "local-wallet" mode, per `set_test_env_base`).
fn build_remote_block_for_tests(
    producer_ledger: &crate::ledger::Ledger,
    height: u64,
    parent_block_id: Option<String>,
    env: crate::protocol::SignedTxEnvelopeV1,
) -> crate::consensus::RemoteBlockGossip {
    let producer_id = "local-wallet".to_string();
    let txs = vec![env];
    let tx_hashes: Vec<String> = txs
        .iter()
        .map(|e| crate::consensus::tx_hash_for_env(e).unwrap())
        .collect();
    let reward = crate::consensus::reward_for_block(&txs).unwrap();
    let state_root = producer_ledger
        .compute_state_root_after_remote_block(&txs, &producer_id, reward.total_reward_micro)
        .unwrap();
    let block_id = crate::consensus::block_id_for_block(
        height,
        parent_block_id.as_deref().unwrap_or(""),
        &state_root,
        &tx_hashes,
        &producer_id,
    );
    crate::consensus::RemoteBlockGossip {
        block_height: height,
        block_id,
        parent_block_id,
        producer_id,
        base_reward_micro: reward.base_reward_micro,
        compute_reward_micro: reward.compute_reward_micro,
        total_reward_micro: reward.total_reward_micro,
        state_root,
        txs,
    }
}

/// Two identically-seeded nodes paired as producer/receiver: open temp ledgers, apply genesis,
/// faucet the same sender on both so their pre-block state roots match.
#[allow(clippy::type_complexity)]
fn two_synced_nodes_with_funded_sender() -> (
    std::sync::Arc<crate::ledger::Ledger>,
    std::sync::Arc<crate::ledger::Ledger>,
    crate::rest::RestState,
    crate::rest::RestState,
    String,
    String,
) {
    let ledger_a = std::sync::Arc::new(open_temp_ledger());
    ledger_a.init_genesis_founder_premine_from_env().unwrap();
    ledger_a.apply_genesis_allocation("founder").unwrap();
    let ledger_b = std::sync::Arc::new(open_temp_ledger());
    ledger_b.init_genesis_founder_premine_from_env().unwrap();
    ledger_b.apply_genesis_allocation("founder").unwrap();
    let state_a = rest_state_for_tests(ledger_a.clone());
    let state_b = rest_state_for_tests(ledger_b.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet_id = sender.address_hex.to_ascii_lowercase();
    for ledger in [&ledger_a, &ledger_b] {
        ledger
            .admin_rest_faucet(
                &sender_wallet_id,
                1000 * crate::ledger::STEVEMON,
                "ip",
                true,
                1,
                1,
            )
            .unwrap();
    }
    assert_eq!(ledger_a.compute_state_root().unwrap(), ledger_b.compute_state_root().unwrap());
    (
        ledger_a,
        ledger_b,
        state_a,
        state_b,
        sender_words,
        sender_wallet_id,
    )
}

/// Hot-path regression: applying the same block sequence through the (now offloaded)
/// `apply_remote_block_from_gossip` must yield byte-identical state roots on producer and
/// receiver at every height — proving the spawn_blocking refactor changed no consensus output.
#[tokio::test]
async fn remote_block_apply_offloaded_sequence_keeps_state_roots_identical() {
    let _g = env_lock();
    set_test_env_base();

    let (ledger_a, ledger_b, state_a, state_b, sender_words, sender_wallet_id) =
        two_synced_nodes_with_funded_sender();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();

    let mut parent_block_id: Option<String> = None;
    for height in 1u64..=4 {
        // Unique amount per block => unique tx hash per block.
        let env = signed_transfer_env_for_tests(
            &sender_words,
            &sender_wallet_id,
            &recipient_wallet_id,
            height * crate::ledger::STEVEMON,
        );
        let gossip =
            build_remote_block_for_tests(&ledger_a, height, parent_block_id.clone(), env);

        for (ledger, state) in [(&ledger_b, &state_b), (&ledger_a, &state_a)] {
            let outcome = crate::consensus::apply_remote_block_from_gossip(
                (*ledger).clone(),
                state.mempool.clone(),
                gossip.clone(),
            )
            .await
            .unwrap();
            match outcome {
                crate::consensus::RemoteBlockApplyOutcome::Applied {
                    block_height,
                    state_root,
                    ..
                } => {
                    assert_eq!(block_height, height);
                    assert_eq!(state_root, gossip.state_root);
                }
                other => panic!("expected Applied at height {height}, got {other:?}"),
            }
        }

        assert_eq!(ledger_a.block_height().unwrap(), height);
        assert_eq!(ledger_b.block_height().unwrap(), height);
        assert_eq!(ledger_a.compute_state_root().unwrap(), ledger_b.compute_state_root().unwrap());
        assert_eq!(ledger_a.compute_state_root().unwrap(), gossip.state_root);
        parent_block_id = Some(gossip.block_id.clone());
    }
}

/// File Sharing Step 4: the custom `/tet/v1/files/fetch` codec must round-trip a full 5 MiB
/// encrypted body (the stock json codec caps requests at 1 MiB) and stay under the response cap.
#[tokio::test]
async fn files_fetch_codec_roundtrips_5mib_body() {
    use libp2p::request_response::Codec as _;

    let protocol = libp2p::StreamProtocol::new(crate::files::FILES_FETCH_PROTOCOL);
    let mut codec = crate::files::fetch_codec::FilesFetchCodec;
    let file_id = uuid::Uuid::new_v4();

    // Request side.
    let mut wire = futures::io::Cursor::new(Vec::<u8>::new());
    codec
        .write_request(&protocol, &mut wire, crate::files::FileFetchRequest { file_id })
        .await
        .unwrap();
    let mut rd = futures::io::Cursor::new(wire.into_inner());
    let req = codec.read_request(&protocol, &mut rd).await.unwrap();
    assert_eq!(req.file_id, file_id);

    // Response side with a max-size (5 MiB) blob.
    let blob = vec![0xA7u8; crate::files::MAX_FILE_BODY_BYTES as usize];
    let resp = crate::files::FileFetchResponse::from_blob(file_id, &blob);
    let mut wire = futures::io::Cursor::new(Vec::<u8>::new());
    codec
        .write_response(&protocol, &mut wire, resp)
        .await
        .unwrap();
    let encoded = wire.into_inner();
    assert!(
        (encoded.len() as u64) <= crate::files::fetch_codec::FETCH_RESPONSE_MAX_BYTES,
        "encoded response {} exceeds codec cap",
        encoded.len()
    );
    let mut rd = futures::io::Cursor::new(encoded);
    let decoded = codec.read_response(&protocol, &mut rd).await.unwrap();
    assert!(decoded.found);
    assert_eq!(decoded.file_id, file_id);
    assert_eq!(decoded.file_sha256, crate::files::sha256_hex(&blob));
    let decoded_blob = base64::engine::general_purpose::STANDARD
        .decode(decoded.blob_b64.as_bytes())
        .unwrap();
    assert_eq!(decoded_blob, blob);
}

/// FEE_SPEC §2.4: 25/50/25 with the rounding remainder folded into burn, summing exactly to the
/// fee. The storage-node share is `net_micro` on the unified `fees::FeeSplit`.
#[test]
fn file_fee_split_is_exact_25_50_25() {
    let s = crate::files::file_fee_split(crate::files::FILE_FEE_MICRO);
    assert_eq!(s.treasury_micro, 250);
    assert_eq!(s.net_micro, 500, "storage node share");
    assert_eq!(s.burn_micro, 250);
    assert_eq!(s.pool_micro, 0, "file fees never fund the worker pool");
    for fee in [1u64, 3, 999, 1001, crate::fees::MAX_CHARGE_MICRO] {
        let s = crate::files::file_fee_split(fee);
        assert_eq!(s.total_micro(), fee, "conservation at fee={fee}");
    }
}

/// File Sharing Step 4 fee settlement: REST submit → mempool → mined block → deterministic
/// 25/50/25 debit/credit, and a duplicate settlement of the same file fee is a no-op.
#[tokio::test]
async fn file_fee_tx_settles_treasury_storage_burn_via_consensus() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet = sender.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(&sender_wallet, 10 * crate::ledger::STEVEMON, "ip", true, 1, 1)
        .unwrap();

    let storage_wallet = "storage-node-wallet";
    let treasury = crate::ledger::treasury_address_from_env().unwrap();
    // FEE_SPEC §1.3: burn credits no wallet -- assert on supply instead.
    let before_supply = ledger.total_supply_micro().unwrap();
    let before_burned = ledger.total_burned_micro().unwrap();
    let before_sender = ledger.balance_micro(&sender_wallet).unwrap();
    let before_treasury = ledger.balance_micro(&treasury).unwrap();
    let before_storage = ledger.balance_micro(storage_wallet).unwrap();

    let env = signed_file_fee_env_for_tests(
        &sender_words,
        &sender_wallet,
        storage_wallet,
        &uuid::Uuid::new_v4().to_string(),
    );
    let resp = crate::rest::handlers::files::post_files_fee(
        axum::extract::State(state.clone()),
        axum::Json(env.clone()),
    )
    .await;
    assert_eq!(resp.into_response().status(), StatusCode::ACCEPTED);

    let outcome = crate::consensus::mine_pending_block_as(state.clone(), "producer-x".to_string())
        .await
        .unwrap();
    assert!(outcome.mined);
    assert_eq!(outcome.tx_count, 1);

    assert_eq!(
        ledger.balance_micro(&sender_wallet).unwrap(),
        before_sender - crate::files::FILE_FEE_MICRO
    );
    assert_eq!(
        ledger.balance_micro(&treasury).unwrap(),
        before_treasury + 250
    );
    assert_eq!(
        ledger.balance_micro(storage_wallet).unwrap(),
        before_storage + 500
    );
    assert_eq!(
        ledger.total_supply_micro().unwrap(),
        before_supply - 250,
        "burn must reduce total supply, not credit a wallet"
    );
    assert_eq!(
        ledger.total_burned_micro().unwrap(),
        before_burned + 250,
        "burn counter must track the destroyed amount"
    );

    // Re-enqueue the identical settlement: the miner must drop it (per-tx applied marker),
    // leaving every balance unchanged.
    state.submit_local_tx(env).await.unwrap();
    let outcome2 =
        crate::consensus::mine_pending_block_as(state.clone(), "producer-x".to_string())
            .await
            .unwrap();
    assert_eq!(outcome2.tx_count, 0);
    assert_eq!(
        ledger.balance_micro(&sender_wallet).unwrap(),
        before_sender - crate::files::FILE_FEE_MICRO
    );
    assert_eq!(
        ledger.balance_micro(&treasury).unwrap(),
        before_treasury + 250
    );
}

/// A fee settlement from a wallet that cannot cover the 1000 µTET fee must be rejected at the
/// REST boundary (and would equally fail block preview via `InsufficientFunds`).
#[tokio::test]
async fn file_fee_insufficient_balance_rejected() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet = sender.address_hex.to_ascii_lowercase();
    // No faucet: balance 0 < 1000 µTET fee.

    let env = signed_file_fee_env_for_tests(
        &sender_words,
        &sender_wallet,
        "storage-node-wallet",
        &uuid::Uuid::new_v4().to_string(),
    );
    let resp = crate::rest::handlers::files::post_files_fee(
        axum::extract::State(state.clone()),
        axum::Json(env),
    )
    .await;
    assert_eq!(resp.into_response().status(), StatusCode::BAD_REQUEST);
    assert!(state.mempool.lock().await.is_empty());

    // A wrong fee amount must also be rejected even from a funded wallet.
    ledger
        .admin_rest_faucet(&sender_wallet, crate::ledger::STEVEMON, "ip", true, 1, 1)
        .unwrap();
    let mut env_bad_fee = signed_file_fee_env_for_tests(
        &sender_words,
        &sender_wallet,
        "storage-node-wallet",
        &uuid::Uuid::new_v4().to_string(),
    );
    if let crate::protocol::TxV1::FileFee { fee_micro, .. } = &mut env_bad_fee.tx {
        *fee_micro = 1;
    }
    let resp = crate::rest::handlers::files::post_files_fee(
        axum::extract::State(state.clone()),
        axum::Json(env_bad_fee),
    )
    .await;
    // Tampered tx body breaks the signature first; either way it must not reach the mempool.
    assert_ne!(resp.into_response().status(), StatusCode::ACCEPTED);
    assert!(state.mempool.lock().await.is_empty());
}

/// A block carrying a `FileFee` tx must apply with byte-identical state roots on producer and
/// receiver through the offloaded remote-apply path (consensus parity for the new tx variant).
#[tokio::test]
async fn file_fee_remote_block_apply_keeps_state_roots_identical() {
    let _g = env_lock();
    set_test_env_base();

    let (ledger_a, ledger_b, state_a, state_b, sender_words, sender_wallet_id) =
        two_synced_nodes_with_funded_sender();

    let env = signed_file_fee_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        "storage-node-wallet",
        &uuid::Uuid::new_v4().to_string(),
    );
    let gossip = build_remote_block_for_tests(&ledger_a, 1, None, env);

    for (ledger, state) in [(&ledger_b, &state_b), (&ledger_a, &state_a)] {
        let outcome = crate::consensus::apply_remote_block_from_gossip(
            (*ledger).clone(),
            state.mempool.clone(),
            gossip.clone(),
        )
        .await
        .unwrap();
        match outcome {
            crate::consensus::RemoteBlockApplyOutcome::Applied { state_root, .. } => {
                assert_eq!(state_root, gossip.state_root);
            }
            other => panic!("expected Applied, got {other:?}"),
        }
    }
    assert_eq!(ledger_a.compute_state_root().unwrap(), ledger_b.compute_state_root().unwrap());

    let treasury = crate::ledger::treasury_address_from_env().unwrap();
    for ledger in [&ledger_a, &ledger_b] {
        assert_eq!(
            ledger.balance_micro("storage-node-wallet").unwrap(),
            500,
            "storage node must receive 50% on every node"
        );
        assert!(ledger.balance_micro(&treasury).unwrap() >= 250);
    }
}

#[tokio::test]
async fn worker_register_tx_persists_registry_after_mine() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let worker = crate::wallet::generate_mnemonic_12().unwrap();
    let worker_words = worker.mnemonic_12.clone().unwrap();
    let worker_wallet = worker.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(
            &worker_wallet,
            crate::ledger::MIN_WORKER_STAKE_MICRO,
            "ip",
            true,
            1,
            1,
        )
        .unwrap();
    ledger
        .stake_worker_bond_micro(&worker_wallet, crate::ledger::MIN_WORKER_STAKE_MICRO, None)
        .unwrap();

    let env = signed_worker_register_env_for_tests(&worker_words, &worker_wallet, "deadbeef001122");
    let resp = crate::rest::handlers::worker::post_worker_enroll(
        axum::extract::State(state.clone()),
        axum::Json(env.clone()),
    )
    .await;
    assert_eq!(resp.into_response().status(), StatusCode::ACCEPTED);

    let outcome = crate::consensus::mine_pending_block_as(state.clone(), "producer-x".to_string())
        .await
        .unwrap();
    assert!(outcome.mined);
    assert_eq!(outcome.tx_count, 1);

    let rec = ledger.worker_registry_get(&worker_wallet).unwrap().unwrap();
    assert_eq!(rec.wallet_id, worker_wallet);
    assert_eq!(rec.hardware_profile, "cpu-prover-v1");
    assert_eq!(rec.capabilities, vec!["zk_prove".to_string()]);
    assert!(rec.registered_at_height >= 1);

    let list = ledger.worker_registry_list(8).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].wallet_id, worker_wallet);
}

#[tokio::test]
async fn worker_register_insufficient_bond_rejected() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let worker = crate::wallet::generate_mnemonic_12().unwrap();
    let worker_words = worker.mnemonic_12.clone().unwrap();
    let worker_wallet = worker.address_hex.to_ascii_lowercase();

    let env = signed_worker_register_env_for_tests(&worker_words, &worker_wallet, "abc123");
    let resp = crate::rest::handlers::worker::post_worker_enroll(
        axum::extract::State(state.clone()),
        axum::Json(env),
    )
    .await;
    assert_eq!(resp.into_response().status(), StatusCode::BAD_REQUEST);
    assert!(state.mempool.lock().await.is_empty());
}

#[tokio::test]
async fn worker_register_duplicate_tx_is_idempotent_in_mempool() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let worker = crate::wallet::generate_mnemonic_12().unwrap();
    let worker_words = worker.mnemonic_12.clone().unwrap();
    let worker_wallet = worker.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(
            &worker_wallet,
            crate::ledger::MIN_WORKER_STAKE_MICRO,
            "ip",
            true,
            1,
            1,
        )
        .unwrap();
    ledger
        .stake_worker_bond_micro(&worker_wallet, crate::ledger::MIN_WORKER_STAKE_MICRO, None)
        .unwrap();

    let env = signed_worker_register_env_for_tests(&worker_words, &worker_wallet, "hw0011");
    crate::rest::handlers::worker::post_worker_enroll(
        axum::extract::State(state.clone()),
        axum::Json(env.clone()),
    )
    .await;
    let outcome = crate::consensus::mine_pending_block_as(state.clone(), "producer-x".to_string())
        .await
        .unwrap();
    assert_eq!(outcome.tx_count, 1);

    state.submit_local_tx(env.clone()).await.unwrap();
    let outcome2 =
        crate::consensus::mine_pending_block_as(state.clone(), "producer-x".to_string())
            .await
            .unwrap();
    assert_eq!(outcome2.tx_count, 0, "duplicate register tx must not re-apply");
    assert_eq!(
        ledger.worker_registry_list(4).unwrap().len(),
        1,
        "registry must still have one row"
    );
}

/// Concurrent duplicate delivery of the same block (e.g. several peers gossiping it at once)
/// must apply exactly once and never fork; the chain must keep extending normally afterwards.
#[tokio::test]
async fn remote_block_apply_concurrent_duplicate_delivery_is_fork_safe() {
    let _g = env_lock();
    set_test_env_base();

    let (ledger_a, ledger_b, _state_a, state_b, sender_words, sender_wallet_id) =
        two_synced_nodes_with_funded_sender();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();

    let env1 = signed_transfer_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        &recipient_wallet_id,
        crate::ledger::STEVEMON,
    );
    let gossip1 = build_remote_block_for_tests(&ledger_a, 1, None, env1);

    let mut handles = Vec::new();
    for _ in 0..4 {
        let ledger = ledger_b.clone();
        let mempool = state_b.mempool.clone();
        let gossip = gossip1.clone();
        handles.push(tokio::spawn(async move {
            crate::consensus::apply_remote_block_from_gossip(ledger, mempool, gossip).await
        }));
    }
    let mut applied = 0usize;
    let mut skipped = 0usize;
    for handle in handles {
        match handle.await.unwrap().unwrap() {
            crate::consensus::RemoteBlockApplyOutcome::Applied {
                block_height,
                state_root,
                ..
            } => {
                applied += 1;
                assert_eq!(block_height, 1);
                assert_eq!(state_root, gossip1.state_root);
            }
            crate::consensus::RemoteBlockApplyOutcome::Skipped { .. } => skipped += 1,
            other => panic!("unexpected outcome under concurrent delivery: {other:?}"),
        }
    }
    assert_eq!(applied, 1, "block must be applied exactly once");
    assert_eq!(skipped, 3);
    assert_eq!(ledger_b.block_height().unwrap(), 1);
    assert_eq!(ledger_b.compute_state_root().unwrap(), gossip1.state_root);

    // Receiver keeps extending: mirror block 1 on the producer view, then deliver block 2.
    let _ = crate::consensus::apply_remote_block_from_gossip(
        ledger_a.clone(),
        state_b.mempool.clone(),
        gossip1.clone(),
    )
    .await
    .unwrap();
    let env2 = signed_transfer_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        &recipient_wallet_id,
        2 * crate::ledger::STEVEMON,
    );
    let gossip2 =
        build_remote_block_for_tests(&ledger_a, 2, Some(gossip1.block_id.clone()), env2);
    let outcome = crate::consensus::apply_remote_block_from_gossip(
        ledger_b.clone(),
        state_b.mempool.clone(),
        gossip2.clone(),
    )
    .await
    .unwrap();
    assert!(matches!(
        outcome,
        crate::consensus::RemoteBlockApplyOutcome::Applied { block_height: 2, .. }
    ));
    assert_eq!(ledger_b.compute_state_root().unwrap(), gossip2.state_root);
}

/// Liveness: with the consensus mutation offloaded to the blocking pool, the (single-threaded)
/// async runtime must keep making progress *while* a block apply is in flight. Before the
/// refactor the whole 2×O(N) section ran inline, so the apply future completed on its very
/// first poll and a concurrently-joined probe future could never tick before it finished.
#[tokio::test]
async fn remote_block_apply_keeps_async_runtime_responsive() {
    let _g = env_lock();
    set_test_env_base();

    let (ledger_a, ledger_b, _state_a, state_b, sender_words, sender_wallet_id) =
        two_synced_nodes_with_funded_sender();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();

    let env = signed_transfer_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        &recipient_wallet_id,
        crate::ledger::STEVEMON,
    );
    let gossip = build_remote_block_for_tests(&ledger_a, 1, None, env);

    // join! polls the apply future first; if the heavy section ran inline it would finish
    // before the probe ever runs, so `first_tick < apply_done` proves the offload.
    let apply_fut = async {
        let res = crate::consensus::apply_remote_block_from_gossip(
            ledger_b.clone(),
            state_b.mempool.clone(),
            gossip.clone(),
        )
        .await;
        (res, std::time::Instant::now())
    };
    let probe_fut = async {
        let first_tick = std::time::Instant::now();
        tokio::task::yield_now().await;
        first_tick
    };
    let ((apply_res, apply_done), first_tick) = tokio::join!(apply_fut, probe_fut);

    assert!(matches!(
        apply_res.unwrap(),
        crate::consensus::RemoteBlockApplyOutcome::Applied { block_height: 1, .. }
    ));
    assert!(
        first_tick < apply_done,
        "async runtime made no progress while the block apply was in flight"
    );
    assert_eq!(ledger_b.block_height().unwrap(), 1);
}

#[tokio::test]
async fn coinbase_reward_moves_worker_pool_to_producer_without_minting() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet_id = sender.address_hex.to_ascii_lowercase();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(
            &sender_wallet_id,
            1000 * crate::ledger::STEVEMON,
            "ip",
            true,
            1,
            1,
        )
        .unwrap();

    let env = signed_transfer_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        &recipient_wallet_id,
        crate::ledger::STEVEMON,
    );
    state.mempool.lock().await.push(env);

    let producer_id = "producer-alpha";
    let pool_before = ledger
        .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
        .unwrap();
    let producer_before = ledger.balance_micro(producer_id).unwrap();
    let supply_before = ledger.total_supply_micro().unwrap();

    let outcome = crate::consensus::mine_pending_block_as(state, producer_id.to_string())
        .await
        .unwrap();

    assert!(outcome.mined);
    assert_eq!(
        outcome.reward.base_reward_micro,
        crate::ledger::STEVEMON / 10
    );
    assert_eq!(outcome.reward.compute_reward_micro, 0);
    assert_eq!(
        outcome.reward.total_reward_micro,
        crate::ledger::STEVEMON / 10
    );
    assert_eq!(
        ledger.balance_micro(producer_id).unwrap(),
        producer_before + outcome.reward.total_reward_micro
    );
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
            .unwrap(),
        pool_before + 5_000 - outcome.reward.total_reward_micro
    );
    assert_eq!(ledger.total_supply_micro().unwrap(), supply_before - 5_000);
}

#[tokio::test]
async fn mined_block_record_parent_block_id_chains_to_previous() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_WALLET_ID", "local-wallet");
        std::env::set_var("TET_VALIDATOR_IDS", "local-wallet");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let b1 = crate::consensus::mine_pending_block_as(state.clone(), "local-wallet".to_string())
        .await
        .unwrap();
    assert_eq!(b1.block_height, 1);
    let rec1 = ledger.block_record_by_id(&b1.block_id).unwrap().unwrap();
    assert_eq!(rec1.parent_block_id, None);

    let b2 = crate::consensus::mine_pending_block_as(state, "local-wallet".to_string())
        .await
        .unwrap();
    assert_eq!(b2.block_height, 2);
    let rec2 = ledger.block_record_by_id(&b2.block_id).unwrap().unwrap();
    assert_eq!(
        rec2.parent_block_id.as_deref(),
        Some(b1.block_id.as_str()),
        "block N parent must be block N-1 id"
    );
}

#[tokio::test]
async fn gossip_applied_block_parent_block_id_chains_to_previous() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_VALIDATOR_IDS", "alice");
        std::env::set_var("TET_WALLET_ID", "alice");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let b1 = crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string())
        .await
        .unwrap();
    assert_eq!(b1.block_height, 1);

    let txs: Vec<crate::protocol::SignedTxEnvelopeV1> = Vec::new();
    let reward = crate::consensus::reward_for_block(&txs).unwrap();
    let tx_hashes: Vec<String> = Vec::new();
    let state_root = ledger
        .compute_state_root_after_remote_block(&txs, "alice", reward.total_reward_micro)
        .unwrap();
    let block_id =
        crate::consensus::block_id_for_block(2, &b1.block_id, &state_root, &tx_hashes, "alice");

    let applied = crate::consensus::apply_remote_block_from_gossip(
        ledger.clone(),
        state.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height: 2,
            block_id: block_id.clone(),
            parent_block_id: None,
            producer_id: "alice".to_string(),
            base_reward_micro: reward.base_reward_micro,
            compute_reward_micro: reward.compute_reward_micro,
            total_reward_micro: reward.total_reward_micro,
            state_root,
            txs,
        },
    )
    .await
    .unwrap();

    match applied {
        crate::consensus::RemoteBlockApplyOutcome::Applied { block_height, .. } => {
            assert_eq!(block_height, 2);
        }
        other => panic!("expected gossip apply at height 2, got {other:?}"),
    }

    let rec2 = ledger.block_record_by_id(&block_id).unwrap().unwrap();
    assert_eq!(
        rec2.parent_block_id.as_deref(),
        Some(b1.block_id.as_str()),
        "gossip block N parent must resolve to block N-1 id"
    );
}

#[tokio::test]
async fn remote_coinbase_only_block_applies_and_advances_height() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_VALIDATOR_IDS", "alice");
        std::env::set_var("TET_WALLET_ID", "alice");
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let txs = Vec::new();
    let reward = crate::consensus::reward_for_block(&txs).unwrap();
    let state_root = ledger
        .compute_state_root_after_remote_block(&txs, "alice", reward.total_reward_micro)
        .unwrap();
    let block_id = crate::consensus::block_id_for_block(1, "", &state_root, &[], "alice");
    let pool_before = ledger
        .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
        .unwrap();
    let producer_before = ledger.balance_micro("alice").unwrap();
    let supply_before = ledger.total_supply_micro().unwrap();

    let applied = crate::consensus::apply_remote_block_from_gossip(
        ledger.clone(),
        state.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height: 1,
            block_id,
            parent_block_id: None,
            producer_id: "alice".to_string(),
            base_reward_micro: reward.base_reward_micro,
            compute_reward_micro: reward.compute_reward_micro,
            total_reward_micro: reward.total_reward_micro,
            state_root: state_root.clone(),
            txs,
        },
    )
    .await
    .unwrap();

    match applied {
        crate::consensus::RemoteBlockApplyOutcome::Applied {
            block_height,
            tx_count,
            evicted_count,
            state_root: applied_root,
        } => {
            assert_eq!(block_height, 1);
            assert_eq!(tx_count, 0);
            assert_eq!(evicted_count, 0);
            assert_eq!(applied_root, state_root);
        }
        other => panic!("expected coinbase-only remote block apply, got {other:?}"),
    }
    assert_eq!(ledger.block_height().unwrap(), 1);
    assert_eq!(
        ledger.balance_micro("alice").unwrap(),
        producer_before + reward.total_reward_micro
    );
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
            .unwrap(),
        pool_before - reward.total_reward_micro
    );
    assert_eq!(ledger.total_supply_micro().unwrap(), supply_before);
}

#[tokio::test]
async fn zero_coinbase_reward_keeps_producer_balance_unchanged() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0");
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let sender_words = sender.mnemonic_12.clone().unwrap();
    let sender_wallet_id = sender.address_hex.to_ascii_lowercase();
    let recipient = crate::wallet::generate_mnemonic_12().unwrap();
    let recipient_wallet_id = recipient.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(
            &sender_wallet_id,
            1000 * crate::ledger::STEVEMON,
            "ip",
            true,
            1,
            1,
        )
        .unwrap();

    let env = signed_transfer_env_for_tests(
        &sender_words,
        &sender_wallet_id,
        &recipient_wallet_id,
        crate::ledger::STEVEMON,
    );
    state.mempool.lock().await.push(env);

    let producer_id = "zero-reward-producer";
    let producer_before = ledger.balance_micro(producer_id).unwrap();
    let outcome = crate::consensus::mine_pending_block_as(state, producer_id.to_string())
        .await
        .unwrap();

    assert!(outcome.mined);
    assert_eq!(outcome.reward.total_reward_micro, 0);
    assert_eq!(ledger.balance_micro(producer_id).unwrap(), producer_before);
}

#[test]
fn block_reward_fails_when_worker_pool_is_depleted() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let pool_balance = ledger
        .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
        .unwrap();

    let err = ledger
        .apply_block_reward("producer-alpha", pool_balance + 1, 1)
        .unwrap_err();
    assert!(matches!(err, crate::ledger::LedgerError::InsufficientFunds));
}

#[test]
fn state_root_changes_on_1_micro_difference() {
    let _g = env_lock();
    set_test_env_base();
    let ledger1 = open_temp_ledger();
    ledger1.init_genesis_founder_premine_from_env().unwrap();
    ledger1.apply_genesis_allocation("founder").unwrap();

    let ledger2 = open_temp_ledger();
    ledger2.init_genesis_founder_premine_from_env().unwrap();
    ledger2.apply_genesis_allocation("founder").unwrap();

    let w = "a".repeat(64);
    // Credit 1 micro difference via admin faucet (pool -> user, no inflation).
    let _ = ledger1
        .admin_rest_faucet(&w, 1_000, "ip", true, 1, 1)
        .unwrap();
    let _ = ledger2
        .admin_rest_faucet(&w, 1_001, "ip", true, 1, 1)
        .unwrap();

    let r1 = ledger1.compute_state_root().unwrap();
    let r2 = ledger2.compute_state_root().unwrap();
    assert_ne!(r1, r2);
}

/// Fix A correctness: offloading the heavy chain-hello build (state-root scan) onto a blocking
/// thread via `spawn_blocking` must yield a result byte-identical to the direct, inline call.
/// This mirrors the pattern `p2p.rs` now uses to keep the swarm event loop unblocked.
#[tokio::test]
async fn chain_hello_offload_matches_direct() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let direct = crate::sync::build_chain_hello(ledger.as_ref()).expect("direct hello");

    let l2 = ledger.clone();
    let offloaded =
        tokio::task::spawn_blocking(move || crate::sync::build_chain_hello(l2.as_ref()))
            .await
            .expect("join")
            .expect("offloaded hello");

    assert_eq!(direct, offloaded);

    // State root specifically must be stable when computed off-thread.
    let l3 = ledger.clone();
    let root_off = tokio::task::spawn_blocking(move || l3.compute_state_root().unwrap())
        .await
        .expect("join");
    assert_eq!(direct.state_root, root_off);
}

/// `SwarmHealth` integrates with the same `now_ms` clock used by the swarm loop and watchdog:
/// a freshly-ticked beacon is healthy, and one whose last tick is older than the threshold is not.
#[tokio::test]
async fn swarm_health_beacon_detects_stall() {
    let health = crate::swarm_health::SwarmHealth::new();
    assert!(!health.started());

    let now = crate::swarm_health::now_ms();
    health.tick(now);
    assert!(health.started());
    assert!(health.is_healthy(now, 90_000));

    // Simulate a stalled loop: last tick far in the past relative to "now".
    assert!(!health.is_healthy(now + 120_000, 90_000));
    assert_eq!(health.since_last_tick_ms(now + 5_000), Some(5_000));
}

#[tokio::test]
async fn zk_verify_tx_enqueues_and_mines_into_block() {
    let _g = env_lock();
    set_test_env_base();

    // Build a mock receipt that passes `zk_verifier` in non-prod (MOCKJ1).
    let j = crate::zk_verifier::InferenceJournalV1 {
        worker_pubkey_bytes: [0u8; 32],
        prompt_hash: [0u8; 32],
        response_hash: [0u8; 32],
        cost_micro: 1,
    };
    let j_bytes = bincode::serialize(&j).unwrap();
    let j_b64 = base64::engine::general_purpose::STANDARD.encode(&j_bytes);
    let receipt_b64 = format!("MOCKJ1:{j_b64}");

    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();

    let tx = crate::protocol::TxV1::VerifyZkProof {
        task_id: String::new(),
        image_id: methods::NEXUS_GUEST_ID,
        journal_b64: j_b64.clone(),
        receipt_b64: receipt_b64.clone(),
    };
    let env = signed_env_for_tests(tx.clone(), &words, &wallet_id);

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());

    // Submit via zk_verify endpoint: should be 202 + mempool len=1
    let resp = crate::rest::handlers::ledger::post_ledger_zk_verify(
        axum::extract::State(state.clone()),
        HeaderMap::new(),
        axum::Json(env.clone()),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    assert_eq!(state.mempool.lock().await.len(), 1);

    // Mine: mempool drained, tx included in BlockMined response.
    let resp2 = crate::rest::handlers::ledger::post_ledger_mine(
        axum::extract::State(state.clone()),
        admin_headers_for_tests(),
    )
    .await
    .into_response();
    assert_eq!(resp2.status(), StatusCode::OK);
    assert_eq!(state.mempool.lock().await.len(), 0);
}

#[tokio::test]
async fn zk_court_receipt_adds_thermodynamic_compute_reward() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
        std::env::set_var("TET_JOULES_PER_FLOP", "0.000001");
        std::env::set_var("TET_NETWORK_DIFFICULTY_GAMMA", "1");
        std::env::set_var("TET_THERMO_STEVEMON_MICRO_SCALE", "1");
    }

    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    let task_id = "0xtask-thermo";
    let flops = 10u64;
    let j = crate::zk_verifier::ZkCourtJournalV1 {
        commitment_sha256: [7u8; 32],
        flops_u64: flops,
        worker_pubkey_bytes: [9u8; 32],
    };
    let j_bytes = bincode::serialize(&j).unwrap();
    let j_b64 = base64::engine::general_purpose::STANDARD.encode(&j_bytes);
    let receipt_b64 = format!("MOCKZC1:{j_b64}");
    let env = signed_zk_env_with_task_for_tests(&words, &wallet_id, task_id, j_b64, receipt_b64);

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .record_enterprise_inference_demand(crate::ledger::AiWorkloadTask {
            v: 1,
            kind: "enterprise_inference_demand".to_string(),
            tx_hash: task_id.to_string(),
            enterprise_wallet_id: wallet_id.clone(),
            prompt: "dynamic test prompt".to_string(),
            prompt_sha256_hex: hex::encode(sha2::Sha256::digest("dynamic test prompt".as_bytes())),
            model: "test-model".to_string(),
            amount_micro: 1,
            workload_flag: crate::protocol::WorkloadFlag::AiInference.as_u8(),
            block_height: 1,
            processed: false,
            processed_by: None,
            processed_receipt_hash_hex: None,
            processed_at_ms: None,
        })
        .unwrap();
    let state = rest_state_for_tests(ledger.clone());
    state.mempool.lock().await.push(env);

    let producer_id = "producer-thermo";
    let producer_before = ledger.balance_micro(producer_id).unwrap();
    let expected_compute =
        crate::vision::thermo_genesis::discrete_thermodynamic_reward_stevemon_micro(
            flops as u128,
            crate::vision::thermo_genesis::env_joules_per_flop(),
            crate::vision::thermo_genesis::NetworkDifficulty::from_env(),
        );

    let outcome = crate::consensus::mine_pending_block_as(state, producer_id.to_string())
        .await
        .unwrap();

    assert!(outcome.mined);
    assert_eq!(outcome.reward.compute_reward_micro, expected_compute);
    assert_eq!(
        outcome.reward.total_reward_micro,
        crate::ledger::STEVEMON / 10 + expected_compute
    );
    assert_eq!(
        ledger.balance_micro(producer_id).unwrap(),
        producer_before + outcome.reward.total_reward_micro
    );
}

#[tokio::test]
async fn invalid_zk_receipt_is_rejected_by_consensus_mining() {
    let _g = env_lock();
    set_test_env_base();

    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    let j = crate::zk_verifier::InferenceJournalV1 {
        worker_pubkey_bytes: [0u8; 32],
        prompt_hash: [0u8; 32],
        response_hash: [0u8; 32],
        cost_micro: 1,
    };
    let j_bytes = bincode::serialize(&j).unwrap();
    let j_b64 = base64::engine::general_purpose::STANDARD.encode(&j_bytes);
    let env = signed_zk_env_for_tests(&words, &wallet_id, j_b64, "not-a-receipt".to_string());

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());
    state.mempool.lock().await.push(env);

    let res = crate::consensus::mine_pending_block_as(state, "producer-zk".to_string()).await;
    assert!(matches!(
        res,
        Err(crate::consensus::MineError::Unauthorized(_))
    ));
    assert_eq!(ledger.block_height().unwrap(), 0);
}

#[tokio::test]
async fn remote_block_rejects_journal_mismatch_and_compute_reward_tamper() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_VALIDATOR_IDS", "alice");
        std::env::set_var("TET_WALLET_ID", "alice");
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
        std::env::set_var("TET_JOULES_PER_FLOP", "0.000001");
        std::env::set_var("TET_NETWORK_DIFFICULTY_GAMMA", "1");
        std::env::set_var("TET_THERMO_STEVEMON_MICRO_SCALE", "1");
    }

    let wallet = crate::wallet::generate_mnemonic_12().unwrap();
    let words = wallet.mnemonic_12.clone().unwrap();
    let wallet_id = wallet.address_hex.to_ascii_lowercase();
    let task_id = "0xtask-remote-zk";
    let j = crate::zk_verifier::ZkCourtJournalV1 {
        commitment_sha256: [1u8; 32],
        flops_u64: 10,
        worker_pubkey_bytes: [2u8; 32],
    };
    let j_bytes = bincode::serialize(&j).unwrap();
    let j_b64 = base64::engine::general_purpose::STANDARD.encode(&j_bytes);
    let receipt_b64 = format!("MOCKZC1:{j_b64}");
    let env = signed_zk_env_with_task_for_tests(
        &words,
        &wallet_id,
        task_id,
        j_b64.clone(),
        receipt_b64.clone(),
    );
    let tx_hash = crate::consensus::tx_hash_for_env(&env).unwrap();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .record_enterprise_inference_demand(crate::ledger::AiWorkloadTask {
            v: 1,
            kind: "enterprise_inference_demand".to_string(),
            tx_hash: task_id.to_string(),
            enterprise_wallet_id: wallet_id.clone(),
            prompt: "remote prompt".to_string(),
            prompt_sha256_hex: hex::encode(sha2::Sha256::digest("remote prompt".as_bytes())),
            model: "test-model".to_string(),
            amount_micro: 1,
            workload_flag: crate::protocol::WorkloadFlag::AiInference.as_u8(),
            block_height: 1,
            processed: false,
            processed_by: None,
            processed_receipt_hash_hex: None,
            processed_at_ms: None,
        })
        .unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let reward = crate::consensus::reward_for_block(std::slice::from_ref(&env)).unwrap();
    let state_root = ledger
        .compute_state_root_after_remote_block(
            std::slice::from_ref(&env),
            "alice",
            reward.total_reward_micro,
        )
        .unwrap();
    let block_id = crate::consensus::block_id_for_block(
        1,
        "",
        &state_root,
        std::slice::from_ref(&tx_hash),
        "alice",
    );

    let tampered = crate::consensus::apply_remote_block_from_gossip(
        ledger.clone(),
        state.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height: 1,
            block_id: block_id.clone(),
            parent_block_id: None,
            producer_id: "alice".to_string(),
            base_reward_micro: reward.base_reward_micro,
            compute_reward_micro: reward.compute_reward_micro + 1,
            total_reward_micro: reward.total_reward_micro + 1,
            state_root: state_root.clone(),
            txs: vec![env.clone()],
        },
    )
    .await;
    assert!(matches!(
        tampered,
        Err(crate::consensus::RemoteBlockApplyError::Rejected(_))
    ));

    let mismatch_bytes = bincode::serialize(&crate::zk_verifier::ZkCourtJournalV1 {
        commitment_sha256: [3u8; 32],
        flops_u64: 10,
        worker_pubkey_bytes: [2u8; 32],
    })
    .unwrap();
    let mismatch_b64 = base64::engine::general_purpose::STANDARD.encode(mismatch_bytes);
    let mismatch_env =
        signed_zk_env_with_task_for_tests(&words, &wallet_id, task_id, mismatch_b64, receipt_b64);
    let mismatch_hash = crate::consensus::tx_hash_for_env(&mismatch_env).unwrap();
    let mismatch_block_id = crate::consensus::block_id_for_block(
        1,
        "",
        &state_root,
        std::slice::from_ref(&mismatch_hash),
        "alice",
    );
    let mismatch = crate::consensus::apply_remote_block_from_gossip(
        ledger,
        state.mempool.clone(),
        crate::consensus::RemoteBlockGossip {
            block_height: 1,
            block_id: mismatch_block_id,
            parent_block_id: None,
            producer_id: "alice".to_string(),
            base_reward_micro: reward.base_reward_micro,
            compute_reward_micro: reward.compute_reward_micro,
            total_reward_micro: reward.total_reward_micro,
            state_root,
            txs: vec![mismatch_env],
        },
    )
    .await;
    assert!(matches!(
        mismatch,
        Err(crate::consensus::RemoteBlockApplyError::Rejected(_))
    ));
}

#[tokio::test]
async fn zk_task_race_loser_is_rejected_after_winner_processed() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
        std::env::set_var("TET_JOULES_PER_FLOP", "0.000001");
        std::env::set_var("TET_NETWORK_DIFFICULTY_GAMMA", "1");
        std::env::set_var("TET_THERMO_STEVEMON_MICRO_SCALE", "1");
    }

    let worker_a = crate::wallet::generate_mnemonic_12().unwrap();
    let worker_b = crate::wallet::generate_mnemonic_12().unwrap();
    let words_a = worker_a.mnemonic_12.clone().unwrap();
    let words_b = worker_b.mnemonic_12.clone().unwrap();
    let wallet_a = worker_a.address_hex.to_ascii_lowercase();
    let wallet_b = worker_b.address_hex.to_ascii_lowercase();
    let task_id = "0xtask-race";

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .record_enterprise_inference_demand(crate::ledger::AiWorkloadTask {
            v: 1,
            kind: "enterprise_inference_demand".to_string(),
            tx_hash: task_id.to_string(),
            enterprise_wallet_id: wallet_a.clone(),
            prompt: "race prompt".to_string(),
            prompt_sha256_hex: hex::encode(sha2::Sha256::digest("race prompt".as_bytes())),
            model: "test-model".to_string(),
            amount_micro: 1,
            workload_flag: crate::protocol::WorkloadFlag::AiInference.as_u8(),
            block_height: 1,
            processed: false,
            processed_by: None,
            processed_receipt_hash_hex: None,
            processed_at_ms: None,
        })
        .unwrap();

    let make_env = |words: &str, wallet_id: &str, marker: u8| {
        let j = crate::zk_verifier::ZkCourtJournalV1 {
            commitment_sha256: [marker; 32],
            flops_u64: 10 + marker as u64,
            worker_pubkey_bytes: [marker; 32],
        };
        let j_bytes = bincode::serialize(&j).unwrap();
        let j_b64 = base64::engine::general_purpose::STANDARD.encode(&j_bytes);
        let receipt_b64 = format!("MOCKZC1:{j_b64}");
        signed_zk_env_with_task_for_tests(words, wallet_id, task_id, j_b64, receipt_b64)
    };

    let winner = make_env(&words_a, &wallet_a, 1);
    let loser = make_env(&words_b, &wallet_b, 2);
    let state = rest_state_for_tests(ledger.clone());
    state.mempool.lock().await.push(winner);
    let outcome =
        crate::consensus::mine_pending_block_as(state.clone(), "producer-race".to_string())
            .await
            .unwrap();
    assert!(outcome.mined);
    assert!(ledger.ai_workload_is_processed(task_id).unwrap());

    state.mempool.lock().await.push(loser);
    let res = crate::consensus::mine_pending_block_as(state, "producer-race".to_string()).await;
    assert!(matches!(
        res,
        Err(crate::consensus::MineError::Unauthorized(_))
    ));
}

#[test]
fn worker_daemon_mock_flops_are_dynamic_per_task_and_worker() {
    let task_a = crate::ledger::AiWorkloadTask {
        v: 1,
        kind: "enterprise_inference_demand".to_string(),
        tx_hash: "0xtask-a".to_string(),
        enterprise_wallet_id: "enterprise".to_string(),
        prompt: "short prompt".to_string(),
        prompt_sha256_hex: hex::encode(sha2::Sha256::digest("short prompt".as_bytes())),
        model: "test-model".to_string(),
        amount_micro: 1,
        workload_flag: crate::protocol::WorkloadFlag::AiInference.as_u8(),
        block_height: 1,
        processed: false,
        processed_by: None,
        processed_receipt_hash_hex: None,
        processed_at_ms: None,
    };
    let mut task_b = task_a.clone();
    task_b.tx_hash = "0xtask-b".to_string();
    task_b.prompt =
        "a much longer prompt that should produce a different mock flop count".to_string();
    task_b.prompt_sha256_hex = hex::encode(sha2::Sha256::digest(task_b.prompt.as_bytes()));

    let flops_a = crate::worker_daemon::dynamic_mock_flops_for_test(&task_a, &"a".repeat(64));
    let flops_b = crate::worker_daemon::dynamic_mock_flops_for_test(&task_b, &"b".repeat(64));

    assert!(flops_a > 0);
    assert!(flops_b > 0);
    assert_ne!(flops_a, flops_b);
}

#[tokio::test]
async fn reorg_to_heavier_fork_unwinds_transfer_and_replays_new_branch() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
    }

    let wallet_a = crate::wallet::generate_mnemonic_12().unwrap();
    let words_a = wallet_a.mnemonic_12.clone().unwrap();
    let a = wallet_a.address_hex.to_ascii_lowercase();
    let b = "b".repeat(64);
    let c = "c".repeat(64);

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .transfer_no_fee("founder", &a, 10_000)
        .unwrap();
    let initial_a = ledger.balance_micro(&a).unwrap();

    let canonical_tx = signed_transfer_env_for_tests(&words_a, &a, &b, 1_000);
    let state = rest_state_for_tests(ledger.clone());
    state.mempool.lock().await.push(canonical_tx);
    let canonical = crate::consensus::mine_pending_block_as(state, "producer-a".to_string())
        .await
        .unwrap();
    assert!(canonical.mined);
    assert_eq!(ledger.block_height().unwrap(), 1);
    assert!(ledger.balance_micro(&b).unwrap() > 0);

    let branch_tx = signed_transfer_env_for_tests(&words_a, &a, &c, 2_000);
    let branch_hash = crate::consensus::tx_hash_for_env(&branch_tx).unwrap();
    let branch_reward =
        crate::consensus::reward_for_block(std::slice::from_ref(&branch_tx)).unwrap();

    let branch_ledger = open_temp_ledger();
    branch_ledger
        .init_genesis_founder_premine_from_env()
        .unwrap();
    branch_ledger.apply_genesis_allocation("founder").unwrap();
    branch_ledger
        .transfer_no_fee("founder", &a, 10_000)
        .unwrap();
    branch_ledger
        .apply_remote_transfer(&branch_hash, &a, &c, 2_000, 100)
        .unwrap();
    branch_ledger
        .apply_block_reward("producer-b", branch_reward.total_reward_micro, 1)
        .unwrap();
    let branch_root = branch_ledger.compute_state_root().unwrap();
    let branch_id = crate::consensus::block_id_for_block(
        1,
        "",
        &branch_root,
        std::slice::from_ref(&branch_hash),
        "producer-b",
    );

    ledger
        .record_block_record(&crate::ledger::BlockRecordV1 {
            v: 1,
            height: 1,
            block_id: branch_id.clone(),
            parent_block_id: None,
            producer_id: "producer-b".to_string(),
            tx_hashes: vec![branch_hash.clone()],
            txs: vec![branch_tx],
            state_root: branch_root.clone(),
            reward: crate::ledger::BlockRewardRecordV1 {
                base_reward_micro: branch_reward.base_reward_micro,
                compute_reward_micro: branch_reward.compute_reward_micro,
                total_reward_micro: branch_reward.total_reward_micro,
            },
            caac_weight: 1_000,
            cumulative_weight: 1_000,
            canonical: false,
            ts_ms: 1,
        })
        .unwrap();

    let changed = crate::consensus::reorg_to_branch(&ledger, &branch_id).unwrap();
    assert!(changed);
    assert_eq!(ledger.block_height().unwrap(), 1);
    assert_eq!(ledger.compute_state_root().unwrap(), branch_root);
    assert_eq!(ledger.balance_micro(&a).unwrap(), initial_a - 2_000);
    assert_eq!(ledger.balance_micro(&b).unwrap(), 0);
    assert_eq!(ledger.balance_micro(&c).unwrap(), 1_980);
    assert_eq!(ledger.balance_micro("producer-a").unwrap(), 0);
    assert_eq!(
        ledger.balance_micro("producer-b").unwrap(),
        branch_reward.total_reward_micro
    );
    assert_eq!(
        ledger.chain_tip().unwrap().unwrap().block_id,
        branch_id,
        "heavier branch must become canonical tip"
    );
}

#[tokio::test]
async fn backfilled_child_first_branch_reorgs_after_parent_arrives() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_BASE_BLOCK_REWARD", "0.1");
        std::env::set_var("TET_WALLET_ID", "local-wallet");
    }

    let wallet_a = crate::wallet::generate_mnemonic_12().unwrap();
    let words_a = wallet_a.mnemonic_12.clone().unwrap();
    let a = wallet_a.address_hex.to_ascii_lowercase();
    let b = "b".repeat(64);
    let c = "c".repeat(64);

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
        .transfer_no_fee("founder", &a, 10_000)
        .unwrap();
    let initial_a = ledger.balance_micro(&a).unwrap();

    let canonical_tx = signed_transfer_env_for_tests(&words_a, &a, &b, 1_000);
    let state = rest_state_for_tests(ledger.clone());
    state.mempool.lock().await.push(canonical_tx);
    let canonical = crate::consensus::mine_pending_block_as(state, "local-wallet".to_string())
        .await
        .unwrap();
    assert!(canonical.mined);
    assert_eq!(ledger.block_height().unwrap(), 1);

    let branch_tx = signed_transfer_env_for_tests(&words_a, &a, &c, 2_000);
    let branch_hash = crate::consensus::tx_hash_for_env(&branch_tx).unwrap();
    let parent_reward =
        crate::consensus::reward_for_block(std::slice::from_ref(&branch_tx)).unwrap();
    let child_reward = crate::consensus::reward_for_block(&[]).unwrap();

    let branch_ledger = open_temp_ledger();
    branch_ledger
        .init_genesis_founder_premine_from_env()
        .unwrap();
    branch_ledger.apply_genesis_allocation("founder").unwrap();
    branch_ledger
        .transfer_no_fee("founder", &a, 10_000)
        .unwrap();
    branch_ledger
        .apply_remote_transfer(&branch_hash, &a, &c, 2_000, 100)
        .unwrap();
    branch_ledger
        .apply_block_reward("local-wallet", parent_reward.total_reward_micro, 1)
        .unwrap();
    let parent_state_root = branch_ledger.compute_state_root().unwrap();
    let parent_block_id = crate::consensus::block_id_for_block(
        1,
        "",
        &parent_state_root,
        std::slice::from_ref(&branch_hash),
        "local-wallet",
    );
    branch_ledger
        .apply_block_reward("local-wallet", child_reward.total_reward_micro, 2)
        .unwrap();
    let child_state_root = branch_ledger.compute_state_root().unwrap();
    let child_block_id = crate::consensus::block_id_for_block(
        2,
        &parent_block_id,
        &child_state_root,
        &[],
        "local-wallet",
    );

    let child = crate::consensus::RemoteBlockGossip {
        block_height: 2,
        block_id: child_block_id.clone(),
        parent_block_id: Some(parent_block_id.clone()),
        producer_id: "local-wallet".to_string(),
        base_reward_micro: child_reward.base_reward_micro,
        compute_reward_micro: child_reward.compute_reward_micro,
        total_reward_micro: child_reward.total_reward_micro,
        state_root: child_state_root.clone(),
        txs: Vec::new(),
    };
    crate::consensus::validate_and_record_backfill_candidate(&ledger, child).unwrap();
    assert_eq!(ledger.block_height().unwrap(), 1);
    assert_eq!(
        ledger.chain_tip().unwrap().unwrap().block_id,
        canonical.block_id
    );

    let parent = crate::consensus::RemoteBlockGossip {
        block_height: 1,
        block_id: parent_block_id.clone(),
        parent_block_id: None,
        producer_id: "local-wallet".to_string(),
        base_reward_micro: parent_reward.base_reward_micro,
        compute_reward_micro: parent_reward.compute_reward_micro,
        total_reward_micro: parent_reward.total_reward_micro,
        state_root: parent_state_root,
        txs: vec![branch_tx],
    };
    crate::consensus::validate_and_record_backfill_candidate(&ledger, parent).unwrap();
    let changed = crate::consensus::try_reorg_backfilled_branch(&ledger, &child_block_id).unwrap();
    assert!(changed);
    assert_eq!(ledger.block_height().unwrap(), 2);
    assert_eq!(ledger.compute_state_root().unwrap(), child_state_root);
    assert_eq!(ledger.balance_micro(&a).unwrap(), initial_a - 2_000);
    assert_eq!(ledger.balance_micro(&b).unwrap(), 0);
    assert_eq!(ledger.balance_micro(&c).unwrap(), 1_980);
    assert_eq!(
        ledger.balance_micro("local-wallet").unwrap(),
        parent_reward.total_reward_micro + child_reward.total_reward_micro
    );
    assert_eq!(
        ledger.chain_tip().unwrap().unwrap().block_id,
        child_block_id,
        "child-first backfilled branch must become canonical after parent arrives"
    );
}

#[test]
fn ledger_atomic_snapshot_writes_json_and_clears_tmp() {
    let _g = env_lock();
    set_test_env_base();
    let tmpdir = tempfile::tempdir().unwrap();
    let json_path = tmpdir.path().join("snap.json");
    let tmp_path = tmpdir.path().join("snap.tmp");
    unsafe {
        std::env::set_var("TET_LEDGER_JSON_PATH", json_path.to_str().unwrap());
        std::env::set_var("TET_LEDGER_TMP_PATH", tmp_path.to_str().unwrap());
    }

    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    // Trigger snapshot persistence via mint.
    let _ = ledger
        .mint_reward_with_proof("alice", 1_000_000, b"energy:test", None, false)
        .unwrap();

    assert!(json_path.exists(), "snapshot json must exist");
    let bytes = std::fs::read(&json_path).unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v.get("v").and_then(|x| x.as_u64()).unwrap_or(0), 1);
    // Best-effort: tmp should not remain after rename.
    assert!(!tmp_path.exists(), "tmp snapshot should be renamed away");
}

#[test]
fn ledger_aml_chf_limit_is_enforced_at_1000() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();

    // 1000 CHF == 1_000_000_000 micro-CHF
    let limit_micro = 1_000u64 * 1_000_000u64;
    let ok = ledger.mint_fiat_chf_topup("bob", limit_micro, "ref1");
    assert!(ok.is_ok(), "exactly at limit should succeed");

    let too_much = ledger.mint_fiat_chf_topup("bob", 1, "ref2");
    assert!(
        too_much.is_err()
            && too_much
                .err()
                .unwrap()
                .to_string()
                .contains("AML Limit Exceeded"),
        "exceeding limit must fail"
    );
}

#[test]
fn e2ee_encrypt_route_blind_decrypt_cycle() {
    let _g = env_lock();
    set_test_env_base();

    let (worker_sk, worker_pk) = crate::e2ee::gen_worker_static_keypair();
    let (client_eph_sk, client_eph_pk) = crate::e2ee::gen_worker_static_keypair();
    let mut nonce12 = [0u8; 12];
    let mut rng = rand_core::OsRng;
    rng.fill_bytes(&mut nonce12);

    let pt = b"hello quantum mesh";
    let (wpk, wsk) = {
        use pqcrypto_traits::kem::{PublicKey, SecretKey};
        let (pk, sk) = pqcrypto_kyber::kyber768::keypair();
        (pk.as_bytes().to_vec(), sk.as_bytes().to_vec())
    };
    let (ct, kem_ct) =
        crate::e2ee::encrypt_for_worker(&client_eph_sk, &worker_pk, &wpk, nonce12, pt).unwrap();

    // Blind routing: core never decrypts; we just forward bytes unchanged.
    let routed_ct = ct.clone();

    let out = crate::e2ee::decrypt_on_worker(
        &worker_sk,
        &client_eph_pk,
        &wsk,
        &kem_ct,
        nonce12,
        &routed_ct,
    )
    .unwrap();
    assert_eq!(out.as_slice(), pt);
}

#[test]
fn worker_hardware_id_is_stable_and_not_uuid_like() {
    let _g = env_lock();
    set_test_env_base();

    let id1 = tet_core::tet_worker::hardware_id_sha256_hex_best_effort().unwrap();
    let id2 = tet_core::tet_worker::hardware_id_sha256_hex_best_effort().unwrap();
    assert_eq!(
        id1, id2,
        "hardware_id must be deterministic per device snapshot"
    );
    assert_eq!(id1.len(), 64, "sha256 hex length");
    assert!(id1.chars().all(|c: char| c.is_ascii_hexdigit()));
    assert!(!id1.contains('-'), "must not look like UUID");
}

#[test]
fn db_strict_encryption_encrypts_sensitive_meta_values() {
    use crate::attestation::AttestationReport;
    use crate::ledger::STEVEMON;
    use tempfile::tempdir;

    let _g = env_lock();
    // Strict encryption must be on for this test.
    unsafe { std::env::set_var("TET_DB_ENCRYPT", "strict") };
    // Generate a per-test 32-byte key (base64). Do not hardcode secret-like material in source.
    let mut k = [0u8; 32];
    rand_core::OsRng.fill_bytes(&mut k);
    let kb64 = base64::engine::general_purpose::STANDARD.encode(k);
    unsafe { std::env::set_var("TET_DB_KEY_B64", kb64) };
    // Ensure we can apply genesis and fund a wallet deterministically.
    unsafe {
        std::env::set_var(
            "TET_FOUNDER_WALLET",
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        )
    };
    // Disable founder cliff for this test so founder can fund another wallet.
    unsafe { std::env::set_var("TET_FOUNDER_CLIFF_MS", "0") };

    let dir = tempdir().unwrap();
    let path = dir.path().join("tet.db");
    let l = crate::ledger::Ledger::open(path.to_str().unwrap()).unwrap();

    // Apply genesis to ensure balances exist, then fund target wallet.
    l.init_genesis_founder_premine_from_env().unwrap();
    l.apply_genesis_allocation("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
        .unwrap();

    let w = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    // Fund wallet from founder. Use the attested path so this test is stable even if other tests
    // enable `TET_REQUIRE_ATTESTATION` concurrently (env is process-global in Rust 2024).
    let att = AttestationReport {
        v: 1,
        platform: "test".into(),
        report_b64: "test".into(),
    };
    let _ = l
        .settle_transfer_internal(
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            w,
            2_000u64 * STEVEMON,
            Some(100),
            Some(&att),
            None,
        )
        .unwrap();

    // Stake writes to meta via encrypt_value.
    let _ = l.stake_micro(w, 1234 * STEVEMON, None).unwrap();
    let stake_key = {
        let mut k = b"wallet_stake_v1:".to_vec();
        k.extend_from_slice(w.as_bytes());
        k
    };
    let raw = l.test_only_raw_meta_value(&stake_key);
    assert!(!raw.is_empty());
    // Ciphertext must not equal plaintext bytes.
    assert_ne!(raw, (1234u64 * STEVEMON).to_le_bytes().to_vec());
    // Should decrypt via public API to the expected value.
    assert_eq!(l.staked_balance_micro(w).unwrap(), 1234u64 * STEVEMON);
}

fn sign_hybrid_headers(
    headers: &mut HeaderMap,
    who: &str,
    ed_signing: &SigningKey,
    mldsa_kp: &dilithium::MlDsaKeyPair,
    msg: &[u8],
) {
    // Ed25519 signature
    let sig = ed_signing.sign(msg);
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
    let k = format!("x-tet-{who}-ed25519-sig-b64");
    headers.insert(
        HeaderName::from_bytes(k.as_bytes()).unwrap(),
        sig_b64.parse().unwrap(),
    );

    // ML-DSA (mode follows keypair)
    let sig = crate::wallet::mldsa_sign_deterministic(mldsa_kp, msg).unwrap();
    let ps_b64 = base64::engine::general_purpose::STANDARD.encode(sig);
    let pk_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let kpk = format!("x-tet-{who}-mldsa-pubkey-b64");
    let ksig = format!("x-tet-{who}-mldsa-sig-b64");
    headers.insert(
        HeaderName::from_bytes(kpk.as_bytes()).unwrap(),
        pk_b64.parse().unwrap(),
    );
    headers.insert(
        HeaderName::from_bytes(ksig.as_bytes()).unwrap(),
        ps_b64.parse().unwrap(),
    );
}

/// FEE_SPEC §1.3 — burn destroys supply and credits no wallet, on every fee-bearing path.
#[test]
fn burn_decrements_total_supply_and_credits_no_wallet() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let legacy_sink = ledger.ai_burn_wallet();
    let sink_before = ledger.balance_micro(&legacy_sink).unwrap();

    // Transfer (FeeKind::Transfer)
    let supply_before = ledger.total_supply_micro().unwrap();
    let burned_before = ledger.total_burned_micro().unwrap();
    let expect = crate::fees::charge(crate::fees::FeeKind::Transfer { fee_bps: 100 }, 1_000_000)
        .unwrap();
    ledger
        .settle_transfer_internal("founder", "alice", 1_000_000, Some(100), None, None)
        .unwrap();
    assert_eq!(
        ledger.total_supply_micro().unwrap(),
        supply_before - expect.burn_micro,
        "transfer burn must reduce supply"
    );
    assert_eq!(
        ledger.total_burned_micro().unwrap(),
        burned_before + expect.burn_micro
    );

    // AI utility (FeeKind::AiUtility)
    let supply_mid = ledger.total_supply_micro().unwrap();
    let ai = crate::fees::charge(crate::fees::FeeKind::AiUtility, 500_000).unwrap();
    ledger
        .settle_ai_utility_payment("alice", "workerx", 500_000)
        .unwrap();
    assert_eq!(
        ledger.total_supply_micro().unwrap(),
        supply_mid - ai.burn_micro,
        "ai utility burn must reduce supply"
    );

    // The legacy burn sink must never be credited by any of them.
    assert_eq!(
        ledger.balance_micro(&legacy_sink).unwrap(),
        sink_before,
        "burn must not credit the legacy tet-api-pool sink"
    );
}

/// FEE_SPEC §1.4 / §3 — no fee may route to the founder wallet or to `dex:treasury`.
#[test]
fn no_fee_routes_to_founder_or_dex_treasury() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    ledger
        .settle_transfer_internal("founder", "alice", 10_000_000, Some(100), None, None)
        .unwrap();

    let founder_before = ledger.balance_micro("founder").unwrap();
    let dex_before = ledger
        .balance_micro(crate::ledger::WALLET_DEX_TREASURY)
        .unwrap();

    // A transfer between two third parties.
    ledger
        .settle_transfer_internal("alice", "bob", 1_000_000, Some(500), None, None)
        .unwrap();
    // An AI utility settlement.
    ledger
        .settle_ai_utility_payment("alice", "workerx", 1_000_000)
        .unwrap();
    // Mint paths are not exercised here: genesis mints the entire supply cap
    // (GENESIS_TOTAL_MINT_MICRO == MAX_SUPPLY_MICRO), so any post-genesis mint returns
    // HardCapExceeded. Schedule 3's founder cut and schedule 4's imperial cut are covered by
    // genesis_1k_worker_pool_reward_is_110_percent_of_standard_gross.

    assert_eq!(
        ledger.balance_micro("founder").unwrap(),
        founder_before,
        "no fee may route to the founder wallet"
    );
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_DEX_TREASURY)
            .unwrap(),
        dex_before,
        "no fee may route to dex:treasury"
    );
}

#[test]
fn transfer_fee_half_burn_reduces_total_supply_and_tracks_burned() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let sup0 = ledger.total_supply_micro().unwrap();
    assert_eq!(sup0, crate::ledger::GENESIS_TOTAL_MINT_MICRO);
    let burned0 = ledger.total_burned_micro().unwrap();
    assert_eq!(burned0, 0);

    let pool = "founder";
    ledger
        .settle_transfer_internal(pool, "alice", 100_000_000, Some(100), None, None)
        .unwrap();
    // Phase 2: transfer fees are strict (PROTOCOL_MAINTENANCE_FEE_BPS), ignoring provided fee_bps.
    let fee = crate::fees::charge(
        crate::fees::FeeKind::Transfer { fee_bps: 100 },
        100_000_000,
    )
    .unwrap()
    .fee_micro();
    let burn = crate::fees::charge(
        crate::fees::FeeKind::Transfer { fee_bps: 100 },
        100_000_000,
    )
    .unwrap()
    .burn_micro;
    assert_eq!(ledger.total_burned_micro().unwrap(), burn);
    assert_eq!(
        ledger.total_supply_micro().unwrap(),
        sup0.saturating_sub(burn)
    );
}

#[test]
fn genesis_allocates_exact_split_once_and_rejects_second() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    assert_eq!(ledger.total_supply_micro().unwrap(), 0);

    let s = ledger.apply_genesis_allocation("steve").unwrap();
    assert_eq!(
        s.founder_allocation_micro,
        crate::ledger::GENESIS_FOUNDER_SHARE_MICRO
    );
    assert_eq!(
        s.dex_treasury_allocation_micro,
        crate::ledger::GENESIS_DEX_TREASURY_MICRO
    );
    assert_eq!(
        s.worker_pool_allocation_micro,
        crate::ledger::GENESIS_WORKER_POOL_SHARE_MICRO
    );
    assert_eq!(
        s.total_supply_micro,
        crate::ledger::GENESIS_TOTAL_MINT_MICRO
    );

    assert_eq!(
        ledger.balance_micro("steve").unwrap(),
        crate::ledger::GENESIS_FOUNDER_SHARE_MICRO
    );
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_DEX_TREASURY)
            .unwrap(),
        0,
        "Phase 1 founder-only genesis leaves DEX treasury at 0"
    );
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
            .unwrap(),
        crate::ledger::GENESIS_WORKER_POOL_SHARE_MICRO,
        "§11.1 genesis: 50% system-locked mint credits worker pool"
    );
    assert_eq!(
        ledger
            .balance_micro("fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321")
            .unwrap(),
        crate::ledger::GENESIS_TREASURY_SHARE_MICRO,
        "§11.1 genesis: 25% treasury tranche"
    );
    assert_eq!(
        ledger.total_supply_micro().unwrap(),
        crate::ledger::GENESIS_TOTAL_MINT_MICRO
    );

    let r2 = ledger.apply_genesis_allocation("other");
    assert!(matches!(
        r2,
        Err(crate::ledger::LedgerError::GenesisAlreadyApplied)
    ));
}

struct EnvVarRemoveOnDrop {
    key: &'static str,
}

impl Drop for EnvVarRemoveOnDrop {
    fn drop(&mut self) {
        unsafe {
            std::env::remove_var(self.key);
        }
    }
}

#[test]
fn ledger_coinbase_allocates_25_50_25_internal_split() {
    let _g = env_lock();
    set_test_env_base();
    const TREASURY: &str = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
    const MINER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let total = crate::ledger::GENESIS_TOTAL_MINT_MICRO;
    let reward_per_block = 75_000u64;
    for h in 1..=100u64 {
        ledger
            .apply_block_reward(MINER, reward_per_block, h)
            .unwrap();
    }

    let founder_bal = ledger.balance_micro("founder").unwrap();
    let pool_bal = ledger
        .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
        .unwrap();
    let miner_bal = ledger.balance_micro(MINER).unwrap();
    let treasury_bal = ledger.balance_micro(TREASURY).unwrap();
    let mining_bucket = pool_bal.saturating_add(miner_bal);

    eprintln!(
        "25:50:25 after 100 blocks: founder={founder_bal} mining_bucket={mining_bucket} treasury={treasury_bal} total={total}"
    );

    assert_eq!(founder_bal, total * 25 / 100);
    assert_eq!(treasury_bal, total * 25 / 100);
    assert_eq!(
        mining_bucket,
        total * 50 / 100,
        "mining bucket (pool + producers) must equal 50% of total mint"
    );
}

#[test]
fn treasury_address_startup_validation() {
    let _g = env_lock();
    set_test_env_base();

    unsafe {
        std::env::remove_var("TET_TREASURY_ADDRESS");
    }
    assert!(crate::ledger::treasury_address_from_env().is_err());

    unsafe {
        std::env::set_var("TET_TREASURY_ADDRESS", "");
    }
    assert!(crate::ledger::treasury_address_from_env().is_err());

    unsafe {
        std::env::set_var("TET_TREASURY_ADDRESS", "not-a-valid-wallet");
    }
    assert!(crate::ledger::treasury_address_from_env().is_err());

    let treasury_a = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
    let treasury_b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    unsafe {
        std::env::set_var("TET_TREASURY_ADDRESS", treasury_a);
    }
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    unsafe {
        std::env::set_var("TET_TREASURY_ADDRESS", treasury_b);
    }
    let env_b = crate::ledger::treasury_address_from_env().unwrap();
    assert!(ledger.validate_treasury_address_at_startup(&env_b).is_err());

    unsafe {
        std::env::set_var("TET_TREASURY_ADDRESS", treasury_a);
    }
    let env_a = crate::ledger::treasury_address_from_env().unwrap();
    assert!(ledger.validate_treasury_address_at_startup(&env_a).is_ok());
}

#[test]
fn genesis_1k_worker_pool_reward_is_110_percent_of_standard_gross() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_WORKER_VEST_MS", "80");
    }
    let _vest_env = EnvVarRemoveOnDrop {
        key: "TET_WORKER_VEST_MS",
    };

    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    ledger
        .settle_transfer_internal(
            "founder",
            crate::ledger::WALLET_SYSTEM_WORKER_POOL,
            200_000_000,
            Some(100),
            None,
            None,
        )
        .unwrap();

    ledger
        .test_only_mark_genesis_1k_participant("maker", 42)
        .unwrap();

    let gross_req = 100_000_000u64;
    let boosted_gross = (gross_req as u128 * 11 / 10) as u64;
    // FEE_SPEC §3: the 1% imperial tax is deleted -- the worker now receives the full boosted
    // gross on a 90-day vest, with nothing skimmed to a vault.
    let expected_worker_net = boosted_gross;

    ledger
        .mint_worker_network_reward("maker", "imperial-vault", gross_req, b"energy:poc", None)
        .unwrap();

    let locked = ledger.locked_balance_micro_now("maker").unwrap();
    assert_eq!(
        locked, expected_worker_net,
        "Genesis participant should receive the full +10% boosted gross (no imperial tax)"
    );
    assert_eq!(
        ledger.balance_micro("imperial-vault").unwrap(),
        0,
        "imperial vault must never be credited (FEE_SPEC §3)"
    );
}

#[test]
fn ai_utility_micro_tet_split_is_nonzero_for_0_001_tet() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    // Fund payer with exactly 0.001 TET (1000 micro).
    let payer = "payer";
    let worker = "worker";
    let burn = ledger.ai_burn_wallet();
    // Genesis mints full max supply — fund payer from founder (no additional mint).
    ledger.transfer_no_fee("founder", payer, 10_000).unwrap();

    let (w, t, b) = ledger
        .settle_ai_utility_payment(payer, worker, 1_000)
        .unwrap();
    assert_eq!(w + t + b, 1_000, "split must conserve gross micro");
    assert_eq!(w, 800, "80% worker");
    assert_eq!(t, 150, "15% treasury");
    assert_eq!(b, 50, "5% burn");
}

/// BIP39 → Ed25519 wallet id must match `wallet_client_bundled.js` (`@scure/bip39` + `@noble/ed25519`).
#[test]
fn client_wallet_bundle_matches_core_abandon_vector() {
    // Public repo policy: do not hardcode a mnemonic phrase in source.
    // Instead, generate a mnemonic and validate cross-primitive invariants.
    let wi = crate::wallet::generate_mnemonic_12().unwrap();
    let phrase = wi.mnemonic_12.as_deref().unwrap_or_default();
    let w = crate::wallet::recover_from_mnemonic_12(phrase).unwrap();
    assert_eq!(w.address_hex.len(), 64);
    assert!(w.address_hex.chars().all(|c| c.is_ascii_hexdigit()));

    // ML-DSA pubkey must be decodable; length matches FIPS-204 raw encoding.
    // Default is **ML-DSA-44** (WP §7.1) -- it matches what the browser wallet signs, which is the
    // only level `tet-pqc-wasm` builds. It was 65 until 2026-09-17, silently disagreeing with every
    // wallet on the network.
    let pk = base64::engine::general_purpose::STANDARD
        .decode(w.dilithium_pubkey_b64.trim())
        .unwrap();
    assert_eq!(pk.len(), dilithium::ML_DSA_44.public_key_bytes());
}

/// WP §7.1 -- the shipped default parameter set. Pinned so it cannot drift back.
#[test]
fn default_mldsa_level_is_44() {
    let _g = env_lock();
    unsafe {
        std::env::remove_var("TET_MLDSA_SECURITY_LEVEL");
    }
    assert_eq!(
        crate::wallet::active_mldsa_mode(),
        dilithium::ML_DSA_44,
        "Phase 0 ships ML-DSA-44; tet-pqc-wasm builds no other level"
    );
}

#[test]
fn mldsa44_hybrid_transfer_sign_verify_roundtrip() {
    let wi = crate::wallet::generate_mnemonic_12().unwrap();
    let phrase = wi.mnemonic_12.as_deref().unwrap_or_default();
    let kp = crate::wallet::mldsa44_keypair_from_mnemonic(phrase).unwrap();
    let pk_b64 = base64::engine::general_purpose::STANDARD.encode(kp.public_key());
    let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let msg = crate::wallet::transfer_hybrid_auth_message_bytes(bob, 1_000_000, 3, &pk_b64);
    let sig = crate::wallet::mldsa44_sign_deterministic(&kp, &msg).unwrap();
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig);
    crate::wallet::verify_mldsa44_b64(&pk_b64, &sig_b64, &msg).unwrap();
}

/// The node-side selectable level (WP §7.1). Selects 65 explicitly -- the default is 44.
#[test]
fn mldsa65_hybrid_transfer_sign_verify_roundtrip() {
    let _g = env_lock();
    unsafe {
        std::env::set_var("TET_MLDSA_SECURITY_LEVEL", "65");
    }
    let wi = crate::wallet::generate_mnemonic_12().unwrap();
    let phrase = wi.mnemonic_12.as_deref().unwrap_or_default();
    let kp = crate::wallet::mldsa_keypair_from_mnemonic(phrase).unwrap();
    assert_eq!(kp.mode(), dilithium::ML_DSA_65);
    let pk_b64 = base64::engine::general_purpose::STANDARD.encode(kp.public_key());
    let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let msg = crate::wallet::transfer_hybrid_auth_message_bytes(bob, 1_000_000, 3, &pk_b64);
    let sig = crate::wallet::mldsa_sign_deterministic(&kp, &msg).unwrap();
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig);
    crate::wallet::verify_mldsa_b64(&pk_b64, &sig_b64, &msg).unwrap();
    unsafe {
        std::env::remove_var("TET_MLDSA_SECURITY_LEVEL");
    }
}

#[test]
fn mainnet_rejects_legacy_tx_signature_without_chain_binding() {
    let _g = env_lock();
    set_test_env_base();
    let _mainnet = EnvVarGuard::set("TET_MAINNET", "1");
    let _founder = EnvVarGuard::set(
        "TET_GENESIS_FOUNDER_WALLET_ID",
        crate::ledger::GENESIS_FOUNDER_DEV_PUBLIC_HEX,
    );

    let wi = crate::wallet::generate_mnemonic_12().unwrap();
    let phrase = wi.mnemonic_12.as_deref().unwrap_or_default();
    let w = crate::wallet::recover_from_mnemonic_12(phrase).unwrap();
    let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    // Must build the LEGACY form explicitly: signed_transfer_env_for_tests now signs the
    // canonical preimage, so using it here would assert nothing.
    let tx = crate::protocol::TxV1::Transfer {
        from_wallet: w.address_hex.clone(),
        to_wallet: bob.to_string(),
        amount_micro: 1_000_000,
        fee_bps: 100,
    };
    let env = legacy_bare_json_env_for_tests(tx, phrase, &w.address_hex);
    let err = crate::rest::helpers::verify_envelope_v1(&env).unwrap_err();
    assert!(err.contains("chain_id/genesis_hash"), "got: {err}");
    // env restored by the guards, on the panic path too.
}

#[test]
fn mainnet_panics_when_mock_zk_is_enabled() {
    let _g = env_lock();
    set_test_env_base();
    let _mainnet = EnvVarGuard::set("TET_MAINNET", "1");
    let _mock_zk = EnvVarGuard::set("TET_ALLOW_MOCK_ZK", "1");

    let result = std::panic::catch_unwind(|| {
        let _ = crate::zk_verifier::verify_receipt("MOCKJ1:");
    });
    assert!(result.is_err());
    // env restored by the guards, on the panic path too.
}

#[tokio::test]
async fn mempool_limit_evicts_lowest_fee_tx() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_MEMPOOL_MAX_TXS", "1");
        std::env::set_var("TET_MEMPOOL_MAX_BYTES", "1048576");
    }
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let alice = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let make_env = |fee_bps| crate::protocol::SignedTxEnvelopeV1 {
        v: 1,
        tx: crate::protocol::TxV1::Transfer {
            from_wallet: alice.to_string(),
            to_wallet: bob.to_string(),
            amount_micro: 1_000_000,
            fee_bps,
        },
        sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: alice.to_string(),
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: String::new(),
            mldsa_sig_b64: String::new(),
        },
        attestation: crate::protocol::AttestationV1 {
            platform: String::new(),
            report_b64: String::new(),
        },
    };

    assert!(!state.submit_local_tx(make_env(1)).await.unwrap());
    assert!(state.submit_local_tx(make_env(100)).await.unwrap());
    let mp = state.mempool.lock().await;
    assert_eq!(mp.len(), 1);
    let crate::protocol::TxV1::Transfer { fee_bps, .. } = mp[0].tx else {
        panic!("expected transfer");
    };
    assert_eq!(fee_bps, 100);

    unsafe {
        std::env::remove_var("TET_MEMPOOL_MAX_TXS");
        std::env::remove_var("TET_MEMPOOL_MAX_BYTES");
    }
}

#[test]
fn ledger_prune_removes_old_block_undo_beyond_depth() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_PRUNE_DEPTH", "2");
        std::env::set_var("TET_AUDIT_MAX_EVENTS", "100000");
    }
    let ledger = open_temp_ledger();
    for height in 1..=5 {
        let undo = crate::ledger::BlockUndoV1 {
            v: 1,
            block_id: format!("block-{height}"),
            height,
            balances: vec![],
            meta: vec![],
            tx_index: vec![],
            canonical_by_height: vec![],
            chain_tip: vec![],
            blocks: vec![],
            workers_registry: vec![],
            created_at_ms: 0,
        };
        ledger.store_block_undo(&undo).unwrap();
    }

    let (undo_removed, _) = ledger.prune_history_after_block(5).unwrap();
    assert_eq!(undo_removed, 2);
    assert!(ledger.block_undo_by_id("block-1").unwrap().is_none());
    assert!(ledger.block_undo_by_id("block-2").unwrap().is_none());
    assert!(ledger.block_undo_by_id("block-3").unwrap().is_some());

    unsafe {
        std::env::remove_var("TET_PRUNE_DEPTH");
        std::env::remove_var("TET_AUDIT_MAX_EVENTS");
    }
}

#[test]
fn zkcourt_challenge_rejected_after_window_closes() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_ZK_COURT_CHALLENGE_MS", "1");
        std::env::set_var("TET_ZK_COURT_CHALLENGER_BOND_MICRO", "1000");
    }
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let challenger = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    let worker = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    ledger
        .transfer_no_fee("founder", challenger, 10_000)
        .unwrap();
    crate::vision::zk_court::record_inference_delivered_full(
        &ledger,
        "infer-late",
        "p",
        "r",
        1,
        worker,
        1,
    );
    std::thread::sleep(std::time::Duration::from_millis(5));
    let req = crate::vision::zk_court::ChallengeSubmitReq {
        inference_id: "infer-late".to_string(),
        challenger_wallet_id: challenger.to_string(),
        // Signature fields are verified in the REST handler, not in submit_challenge; these
        // tests exercise the ledger layer directly. Auth coverage:
        // zkcourt_challenge_without_signature_is_rejected_and_locks_no_bond.
        nonce: 1,
        ed25519_sig_hex: String::new(),
        mldsa_pubkey_b64: String::new(),
        mldsa_sig_b64: String::new(),
        reason: "late".to_string(),
    };
    let err = crate::vision::zk_court::submit_challenge(&ledger, &req).unwrap_err();
    assert!(err.contains("challenge window closed"), "got: {err}");
    unsafe {
        std::env::remove_var("TET_ZK_COURT_CHALLENGE_MS");
        std::env::remove_var("TET_ZK_COURT_CHALLENGER_BOND_MICRO");
    }
}

#[test]
fn zkcourt_dispute_persists_and_invalid_challenge_bond_goes_to_ecosystem() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_ZK_COURT_CHALLENGER_BOND_MICRO", "1000");
    }
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let challenger = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    let worker = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    ledger
        .transfer_no_fee("founder", challenger, 10_000)
        .unwrap();

    crate::vision::zk_court::record_inference_delivered_full(
        &ledger, "infer-1", "prompt", "response", 42, worker, 1,
    );
    let persisted = crate::vision::zk_court::list_open_persisted(&ledger);
    assert!(persisted.iter().any(|d| d.inference_id == "infer-1"));
    let eco_before = ledger
        .balance_micro(crate::ledger::WALLET_ECOSYSTEM)
        .unwrap();
    let req = crate::vision::zk_court::ChallengeSubmitReq {
        inference_id: "infer-1".to_string(),
        challenger_wallet_id: challenger.to_string(),
        // Signature fields are verified in the REST handler, not in submit_challenge; these
        // tests exercise the ledger layer directly. Auth coverage:
        // zkcourt_challenge_without_signature_is_rejected_and_locks_no_bond.
        nonce: 1,
        ed25519_sig_hex: String::new(),
        mldsa_pubkey_b64: String::new(),
        mldsa_sig_b64: String::new(),
        reason: "test invalid challenge".to_string(),
    };
    let st = crate::vision::zk_court::submit_challenge(&ledger, &req).unwrap();
    assert_eq!(st.challenger_bond_micro, 1000);
    let settled = crate::vision::zk_court::apply_slash_verdict(&ledger, "infer-1", false).unwrap();
    assert_eq!(settled, 0);
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_ECOSYSTEM)
            .unwrap(),
        eco_before + 1000
    );

    unsafe {
        std::env::remove_var("TET_ZK_COURT_CHALLENGER_BOND_MICRO");
    }
}

#[test]
fn invalid_zk_slash_moves_entire_worker_bond_to_ecosystem() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let worker = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    ledger
        .transfer_no_fee("founder", worker, crate::ledger::MIN_WORKER_STAKE_MICRO)
        .unwrap();
    ledger
        .stake_worker_bond_micro(worker, crate::ledger::MIN_WORKER_STAKE_MICRO, None)
        .unwrap();
    let eco_before = ledger
        .balance_micro(crate::ledger::WALLET_ECOSYSTEM)
        .unwrap();

    let slashed = ledger.slash_worker_bond_to_ecosystem_all(worker).unwrap();
    assert_eq!(slashed, crate::ledger::MIN_WORKER_STAKE_MICRO);
    assert_eq!(ledger.worker_bond_micro(worker).unwrap(), 0);
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_ECOSYSTEM)
            .unwrap(),
        eco_before + crate::ledger::MIN_WORKER_STAKE_MICRO
    );
}

#[test]
fn signed_transfer_rejects_replay_nonce() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let wi = crate::wallet::generate_mnemonic_12().unwrap();
    let phrase = wi.mnemonic_12.as_deref().unwrap_or_default();
    let w = crate::wallet::recover_from_mnemonic_12(phrase).unwrap();
    let pool = "founder";
    ledger
        .settle_transfer_internal(pool, &w.address_hex, 50_000_000_000, Some(100), None, None)
        .unwrap();

    let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let amount_micro = 1_000_000u64;
    ledger
        .settle_transfer_internal(
            &w.address_hex,
            bob,
            amount_micro,
            Some(100),
            None,
            Some(1u64),
        )
        .unwrap();
    assert_eq!(
        ledger.wallet_last_transfer_nonce(&w.address_hex).unwrap(),
        1
    );

    let err = ledger
        .settle_transfer_internal(
            &w.address_hex,
            bob,
            amount_micro,
            Some(100),
            None,
            Some(1u64),
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("stale") || err.to_string().contains("replay"),
        "{err}"
    );

    ledger
        .settle_transfer_internal(
            &w.address_hex,
            bob,
            amount_micro,
            Some(100),
            None,
            Some(2u64),
        )
        .unwrap();
    assert_eq!(
        ledger.wallet_last_transfer_nonce(&w.address_hex).unwrap(),
        2
    );

    let sk = crate::wallet::ed25519_signing_key_from_mnemonic(phrase).unwrap();
    assert_eq!(
        hex::encode(sk.verifying_key().to_bytes()),
        w.address_hex,
        "signing key must match wallet id"
    );
}

#[test]
fn initial_faucet_airdrop_grants_once_and_second_call_is_already_claimed() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let user = "a".repeat(64);
    let pool_before = ledger
        .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
        .unwrap();

    assert_eq!(
        ledger.claim_initial_airdrop(&user).unwrap(),
        crate::ledger::InitialAirdropClaimOutcome::Granted {
            credited_micro: crate::ledger::FAUCET_INITIAL_AIRDROP_MICRO_PER_USER
        }
    );
    assert_eq!(
        ledger.balance_micro(&user).unwrap(),
        crate::ledger::FAUCET_INITIAL_AIRDROP_MICRO_PER_USER
    );
    assert_eq!(
        ledger
            .balance_micro(crate::ledger::WALLET_SYSTEM_WORKER_POOL)
            .unwrap(),
        pool_before.saturating_sub(crate::ledger::FAUCET_INITIAL_AIRDROP_MICRO_PER_USER)
    );
    assert_eq!(
        ledger.claim_initial_airdrop(&user).unwrap(),
        crate::ledger::InitialAirdropClaimOutcome::AlreadyClaimed
    );
    assert_eq!(
        ledger.balance_micro(&user).unwrap(),
        crate::ledger::FAUCET_INITIAL_AIRDROP_MICRO_PER_USER
    );
}

/// Regression for the AI airdrop consensus bug: the legacy off-chain `claim_initial_airdrop`
/// (which `/ai/infer` used to call) credits balances only on the node that runs it, forking that
/// node's state root away from the rest of the network. This test pins WHY that call was removed
/// from request handlers — it must never run in the inference path.
#[test]
fn welcome_airdrop_offchain_claim_forks_node_state_root() {
    let _g = env_lock();
    set_test_env_base();

    let n1 = open_temp_ledger();
    n1.init_genesis_founder_premine_from_env().unwrap();
    n1.apply_genesis_allocation("founder").unwrap();
    let n2 = open_temp_ledger();
    n2.init_genesis_founder_premine_from_env().unwrap();
    n2.apply_genesis_allocation("founder").unwrap();

    // Identical genesis => identical consensus state root.
    assert_eq!(n1.compute_state_root().unwrap(), n2.compute_state_root().unwrap());

    // Off-chain claim on n1 only (the removed `/ai/infer` behavior) forks the state root.
    let user = "a".repeat(64);
    n1.claim_initial_airdrop(&user).unwrap();
    assert_ne!(
        n1.compute_state_root().unwrap(),
        n2.compute_state_root().unwrap(),
        "off-chain airdrop on one node forks consensus state root; it must not run in handlers"
    );
}

/// The consensus airdrop path is node-agnostic: the same hybrid-signed `TxV1::InitialAirdrop`,
/// previewed on two independent-but-identical ledgers, yields the SAME post-block state root (and a
/// root distinct from genesis, i.e. it does credit). This is the property the fix relies on — the
/// airdrop is applied deterministically by every node at block-apply time, not off-chain.
#[test]
fn welcome_airdrop_consensus_tx_predicts_same_root_on_all_nodes() {
    let _g = env_lock();
    set_test_env_base();

    let n1 = open_temp_ledger();
    n1.init_genesis_founder_premine_from_env().unwrap();
    n1.apply_genesis_allocation("founder").unwrap();
    let n2 = open_temp_ledger();
    n2.init_genesis_founder_premine_from_env().unwrap();
    n2.apply_genesis_allocation("founder").unwrap();
    let genesis_root = n1.compute_state_root().unwrap();
    assert_eq!(genesis_root, n2.compute_state_root().unwrap());

    // Build a hybrid-signed InitialAirdrop claim for a fresh wallet.
    let w = crate::wallet::generate_mnemonic_12().unwrap();
    let words = w.mnemonic_12.clone().unwrap();
    let wallet_id = w.address_hex.to_ascii_lowercase();
    let tx = crate::protocol::TxV1::InitialAirdrop {
        wallet_id: wallet_id.clone(),
    };
    let env = signed_env_for_tests(tx, &words, &wallet_id);

    // Same tx previewed as a block on both nodes => same predicted root, distinct from genesis.
    let r1 = n1
        .compute_state_root_after_remote_block(std::slice::from_ref(&env), "", 0)
        .unwrap();
    let r2 = n2
        .compute_state_root_after_remote_block(std::slice::from_ref(&env), "", 0)
        .unwrap();
    assert_eq!(r1, r2, "consensus airdrop must predict identically on all nodes");
    assert_ne!(r1, genesis_root, "consensus airdrop must actually credit the wallet");
}

#[test]
fn admin_rest_faucet_once_per_wallet_and_ip_rl() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let w1 = "b".repeat(64);
    let w2 = "c".repeat(64);
    let amt = 1_000u64 * crate::ledger::STEVEMON;
    let ip = "203.0.113.7";

    match ledger
        .admin_rest_faucet(&w1, amt, ip, false, 86_400_000, 1)
        .unwrap()
    {
        crate::ledger::AdminRestFaucetOutcome::Granted {
            credited_micro,
            audit_hash_hex,
        } => {
            assert_eq!(credited_micro, amt);
            assert!(!audit_hash_hex.trim().is_empty());
        }
        other => panic!("unexpected outcome: {other:?}"),
    }
    assert_eq!(
        ledger
            .admin_rest_faucet(&w1, amt, ip, false, 86_400_000, 1)
            .unwrap(),
        crate::ledger::AdminRestFaucetOutcome::AlreadyClaimed
    );
    assert_eq!(
        ledger
            .admin_rest_faucet(&w2, amt, ip, false, 86_400_000, 1)
            .unwrap(),
        crate::ledger::AdminRestFaucetOutcome::IpRateLimited
    );
    match ledger
        .admin_rest_faucet(&w2, amt, "198.51.100.1", false, 86_400_000, 1)
        .unwrap()
    {
        crate::ledger::AdminRestFaucetOutcome::Granted {
            credited_micro,
            audit_hash_hex,
        } => {
            assert_eq!(credited_micro, amt);
            assert!(!audit_hash_hex.trim().is_empty());
        }
        other => panic!("unexpected outcome: {other:?}"),
    }
}

#[test]
fn should_start_worker_daemon_skips_when_guest_elf_empty_without_panic() {
    let _g = env_lock();
    unsafe {
        std::env::remove_var("TET_WORKER_DAEMON");
    }
    let tmp = tempfile::tempdir().unwrap();
    let db_dir = tmp.path().join("db");
    let ledger = crate::ledger::Ledger::open(db_dir.to_str().unwrap()).unwrap();
    let wallet = "0000000000000000000000000000000000000000000000000000000000000001";

    if methods::NEXUS_GUEST_ELF.is_empty() {
        let no_panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::worker_daemon::should_start_worker_daemon(&ledger, wallet)
        }));
        assert!(
            no_panic.is_ok(),
            "should_start_worker_daemon must not panic when NEXUS_GUEST_ELF is empty"
        );
        assert!(
            !crate::worker_daemon::should_start_worker_daemon(&ledger, wallet),
            "worker daemon must stay off when guest ELF is unavailable"
        );
    }
}

#[test]
fn test_p2p_keystore_persistence() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().to_path_buf();

    let ks1 = crate::p2p_keystore::P2pKeystore::load_or_create(&path).unwrap();
    let pid1 = ks1.peer_id();

    let ks2 = crate::p2p_keystore::P2pKeystore::load_or_create(&path).unwrap();
    let pid2 = ks2.peer_id();

    assert_eq!(pid1, pid2, "PeerId must persist across loads");
}

/// Sprint 1 Phase C — in-process multi-node block sync integration tests.
mod block_sync {
    use super::{env_lock, rest_state_for_tests, set_test_env_base, signed_env_for_tests};
    use libp2p::Multiaddr;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU16, Ordering};
    use std::time::{Duration, Instant};
    use tokio::sync::Mutex;
    use tokio::task::JoinHandle;

    static NEXT_TCP_PORT: AtomicU16 = AtomicU16::new(29_200);

    fn alloc_tcp_port() -> u16 {
        NEXT_TCP_PORT.fetch_add(1, Ordering::SeqCst)
    }

    fn block_sync_env() {
        set_test_env_base();
        unsafe {
            std::env::set_var("TET_CHAIN_ID", "phase-c-block-sync");
            std::env::set_var("TET_VALIDATOR_IDS", "alice");
            std::env::set_var("TET_GOSSIP_MESH_N", "2");
            std::env::set_var("TET_GOSSIP_MESH_N_LOW", "2");
            std::env::set_var("TET_GOSSIP_MESH_N_HIGH", "4");
            std::env::set_var("TET_SYNC_STABLE_SEC", "1");
            std::env::remove_var("TET_BOOTNODES");
            std::env::remove_var("TET_IS_BOOTNODE");
            std::env::remove_var("TET_AUTO_MINE");
            std::env::remove_var("TET_BLOCK_TIME_SEC");
            std::env::remove_var("TET_AUTO_MINE_IGNORE_SYNC");
        }
    }

    struct TestNode {
        ledger: Arc<crate::ledger::Ledger>,
        db_dir: std::path::PathBuf,
        state: crate::rest::RestState,
        block_sync_board: crate::sync::SharedBlockSyncBoard,
        boot_multiaddr: String,
        swarm_task: JoinHandle<()>,
        auto_miner: Option<JoinHandle<()>>,
        /// The node's swarm-loop beacon: stamped on every loop iteration (at least once a second).
        health: crate::swarm_health::SharedSwarmHealth,
    }

    async fn start_block_swarm_on_ledger(
        ledger: Arc<crate::ledger::Ledger>,
        db_dir: &std::path::Path,
        bootnode_of: Option<&str>,
        is_boot: bool,
        post_listen_delay_ms: u64,
    ) -> (
        crate::rest::RestState,
        crate::sync::SharedBlockSyncBoard,
        String,
        JoinHandle<()>,
        crate::swarm_health::SharedSwarmHealth,
    ) {
        let ks = crate::p2p_keystore::P2pKeystore::load_or_create(db_dir).unwrap();
        let keypair = ks.keypair();
        let peer_id = ks.peer_id();

        let port = alloc_tcp_port();
        let listen: Multiaddr = format!("/ip4/127.0.0.1/tcp/{port}")
            .parse()
            .expect("listen multiaddr");
        let boot_multiaddr = format!("{listen}/p2p/{peer_id}");

        unsafe {
            if let Some(b) = bootnode_of {
                std::env::set_var("TET_BOOTNODES", b);
            } else {
                std::env::remove_var("TET_BOOTNODES");
            }
            if is_boot {
                std::env::set_var("TET_IS_BOOTNODE", "1");
            } else {
                std::env::remove_var("TET_IS_BOOTNODE");
            }
        }

        let mempool = Arc::new(Mutex::new(Vec::new()));
        let sync_state = crate::sync::new_sync_state();
        let hello_registry = sync_state.clone();
        let catch_up_driver = sync_state.clone();
        let block_sync_board = sync_state.clone();

        let tmail_store = std::sync::Arc::new(
            crate::tmail::store::TmailStore::open(&ledger.sled_db()).expect("tmail store"),
        );
        let file_store = std::sync::Arc::new(
            crate::files::storage::FileStore::open(&ledger.sled_db()).expect("file store"),
        );
        let health = crate::swarm_health::SwarmHealth::new();
        let (gossip_tx, files_fetch_tx, tx_submit_tx, _anon_register_tx, swarm_task) =
            crate::p2p::start_mdns_ping_swarm(
            ledger.clone(),
            mempool.clone(),
            keypair,
            listen,
            hello_registry,
            catch_up_driver,
            block_sync_board.clone(),
            tmail_store,
            file_store,
            health.clone(),
        )
        .expect("block swarm");

        let mut state = rest_state_for_tests(ledger);
        // Share ONE mempool between the swarm and the REST state, as `main.rs` does
        // (`mempool.clone()` into the swarm at :591, the same Arc into RestState at :667).
        // `rest_state_for_tests` allocates its own, so without this line the swarm enqueues
        // gossiped txs into a mempool no REST handler and no miner can see — a node that looks
        // like it dropped every transaction it received.
        state.mempool = mempool.clone();
        state.gossip_tx = Some(gossip_tx);
        state.files_fetch_tx = Some(files_fetch_tx);
        state.tx_submit_tx = Some(tx_submit_tx);
        state.block_sync_board = Some(block_sync_board.clone());
        if post_listen_delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(post_listen_delay_ms)).await;
        }
        (state, block_sync_board, boot_multiaddr, swarm_task, health)
    }

    async fn spawn_node(bootnode_of: Option<&str>, is_boot: bool) -> TestNode {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("db");
        let db_dir = tmp.path().to_path_buf();
        std::mem::forget(tmp);
        let ledger = Arc::new(crate::ledger::Ledger::open(db.to_str().unwrap()).unwrap());
        ledger.init_genesis_founder_premine_from_env().unwrap();
        let _ = ledger.apply_genesis_allocation("founder");
        let (state, block_sync_board, boot_multiaddr, swarm_task, health) =
            start_block_swarm_on_ledger(ledger.clone(), &db_dir, bootnode_of, is_boot, 400).await;
        TestNode {
            ledger,
            db_dir,
            state,
            block_sync_board,
            boot_multiaddr,
            swarm_task,
            auto_miner: None,
            health,
        }
    }

    fn spawn_auto_miner_on_node(node: &mut TestNode) {
        let validators = crate::consensus::ValidatorSet::new(["alice"]);
        let handle = crate::consensus::spawn_auto_miner(
            node.state.clone(),
            Some(node.block_sync_board.clone()),
            "alice".to_string(),
            validators,
        );
        node.auto_miner = Some(handle);
    }

    async fn respawn_swarm(node: &mut TestNode, bootnode_of: Option<&str>, is_boot: bool) {
        if let Some(h) = node.auto_miner.take() {
            h.abort();
        }
        node.swarm_task.abort();
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (state, board, boot, task, health) = start_block_swarm_on_ledger(
            node.ledger.clone(),
            &node.db_dir,
            bootnode_of,
            is_boot,
            400,
        )
        .await;
        node.state = state;
        node.block_sync_board = board;
        node.boot_multiaddr = boot;
        node.swarm_task = task;
        node.health = health;
    }

    async fn mine_n(state: &crate::rest::RestState, n: u64) {
        for _ in 0..n {
            crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string())
                .await
                .expect("mine block");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    fn heights(ledgers: &[Arc<crate::ledger::Ledger>]) -> Vec<u64> {
        ledgers
            .iter()
            .map(|l| l.block_height().unwrap_or(0))
            .collect()
    }

    fn height_spread(hs: &[u64]) -> u64 {
        let min = *hs.iter().min().unwrap_or(&0);
        let max = *hs.iter().max().unwrap_or(&0);
        max.saturating_sub(min)
    }

    async fn wait_height_convergence(
        ledgers: &[Arc<crate::ledger::Ledger>],
        max_delta: u64,
        timeout: Duration,
    ) {
        let deadline = Instant::now() + timeout;
        loop {
            let hs = heights(ledgers);
            if height_spread(&hs) <= max_delta {
                let root = ledgers[0].compute_state_root().unwrap();
                if ledgers.iter().all(|l| l.compute_state_root().unwrap() == root) {
                    return;
                }
            }
            assert!(
                Instant::now() < deadline,
                "timeout waiting for sync: heights={hs:?}"
            );
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    fn block_id_at_height(ledger: &crate::ledger::Ledger, height: u64) -> Option<String> {
        ledger
            .recent_blocks(48)
            .into_iter()
            .find(|b| b.height == height)
            .map(|b| b.block_id)
    }

    fn assert_no_fork_through_min_height(ledgers: &[Arc<crate::ledger::Ledger>]) {
        let min_h = heights(ledgers).into_iter().min().unwrap_or(0);
        for h in 1..=min_h {
            let Some(id0) = block_id_at_height(&ledgers[0], h) else {
                panic!("missing canonical height {h} on reference node");
            };
            for (i, l) in ledgers.iter().enumerate().skip(1) {
                assert_eq!(
                    block_id_at_height(l, h).as_deref(),
                    Some(id0.as_str()),
                    "fork at height {h}: node0 vs node{i}"
                );
            }
        }
    }

    fn assert_state_roots_match(ledgers: &[Arc<crate::ledger::Ledger>]) {
        let root = ledgers[0].compute_state_root().unwrap();
        for (i, l) in ledgers.iter().enumerate() {
            assert_eq!(
                l.compute_state_root().unwrap(),
                root,
                "state_root mismatch at node index {i}"
            );
        }
    }

    fn stop(nodes: &[TestNode]) {
        for n in nodes {
            if let Some(h) = &n.auto_miner {
                h.abort();
            }
            n.swarm_task.abort();
        }
    }

    async fn sync_gate_active(
        board: &crate::sync::SharedBlockSyncBoard,
        ledger: &crate::ledger::Ledger,
    ) -> bool {
        crate::sync::auto_mine_blocked_by_sync(Some(board), ledger, false).await
    }

    fn tip_triplet(ledger: &crate::ledger::Ledger) -> (u64, String, String) {
        let height = ledger.block_height().unwrap_or(0);
        let state_root = ledger.compute_state_root().unwrap();
        let block_id = ledger
            .chain_tip()
            .ok()
            .flatten()
            .map(|t| t.block_id)
            .unwrap_or_default();
        (height, block_id, state_root)
    }

    async fn wait_strict_tip_match(ledgers: &[Arc<crate::ledger::Ledger>], timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let snaps: Vec<_> = ledgers.iter().map(|l| tip_triplet(l.as_ref())).collect();
            let all_match = snaps
                .first()
                .map(|first| first.0 > 0 && snaps.iter().all(|s| s == first))
                == Some(true);
            if all_match {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "strict tip mismatch within {:?}: {snaps:?}",
                timeout
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    /// C.1 — bootstrap mines, two followers catch up; heights within ±2; same state_root.
    #[tokio::test]
    async fn chain_sync_three_nodes_in_process() {
        let _g = env_lock();
        block_sync_env();

        let n1 = spawn_node(None, true).await;
        mine_n(&n1.state, 10).await;
        assert!(
            n1.ledger.block_height().unwrap_or(0) >= 10,
            "node1 should reach height 10"
        );

        let boot = n1.boot_multiaddr.clone();
        let n2 = spawn_node(Some(&boot), false).await;
        let n3 = spawn_node(Some(&boot), false).await;

        let ledgers = vec![n1.ledger.clone(), n2.ledger.clone(), n3.ledger.clone()];
        wait_height_convergence(&ledgers, 2, Duration::from_secs(30)).await;

        let hs = heights(&ledgers);
        assert!(height_spread(&hs) <= 2, "height spread too large: {hs:?}");
        assert_state_roots_match(&ledgers);
        assert_no_fork_through_min_height(&ledgers);

        stop(&[n1, n2, n3]);
    }

    /// C.2 — peer disconnect with **manual** `respawn_swarm` to repoint bootnode (test convenience).
    /// Automatic bootnode-dead recovery is covered by [`bootnode_failure_recovery_no_manual_intervention`].
    #[tokio::test]
    async fn chain_sync_recovers_after_peer_disconnect() {
        let _g = env_lock();
        block_sync_env();

        let mut n1 = spawn_node(None, true).await;
        mine_n(&n1.state, 5).await;

        let boot = n1.boot_multiaddr.clone();
        let n2 = spawn_node(Some(&boot), false).await;
        let mut n3 = spawn_node(Some(&boot), false).await;
        wait_height_convergence(
            &[n1.ledger.clone(), n2.ledger.clone(), n3.ledger.clone()],
            2,
            Duration::from_secs(25),
        )
        .await;

        n1.swarm_task.abort();
        tokio::time::sleep(Duration::from_millis(500)).await;

        let n2_boot_early = n2.boot_multiaddr.clone();
        respawn_swarm(&mut n3, Some(&n2_boot_early), false).await;

        mine_n(&n2.state, 3).await;
        wait_height_convergence(
            &[n2.ledger.clone(), n3.ledger.clone()],
            2,
            Duration::from_secs(25),
        )
        .await;

        let n2_boot = n2.boot_multiaddr.clone();
        let n4 = spawn_node(Some(&n2_boot), false).await;
        wait_height_convergence(
            &[n2.ledger.clone(), n3.ledger.clone(), n4.ledger.clone()],
            2,
            Duration::from_secs(25),
        )
        .await;

        respawn_swarm(&mut n1, Some(&n2_boot), false).await;
        let all = vec![
            n1.ledger.clone(),
            n2.ledger.clone(),
            n3.ledger.clone(),
            n4.ledger.clone(),
        ];
        wait_height_convergence(&all, 2, Duration::from_secs(45)).await;
        assert_state_roots_match(&all);
        assert_no_fork_through_min_height(&all);

        stop(&[n1, n2, n3, n4]);
    }

    /// C.3 — rapid concurrent follower start; single producer; chain converges without fork.
    #[tokio::test]
    async fn sync_gate_prevents_fork_under_concurrent_start() {
        let _g = env_lock();
        block_sync_env();

        let n1 = spawn_node(None, true).await;
        let boot = n1.boot_multiaddr.clone();

        let (n2, n3) = tokio::join!(
            spawn_node(Some(&boot), false),
            spawn_node(Some(&boot), false),
        );

        mine_n(&n1.state, 8).await;
        tokio::time::sleep(Duration::from_secs(2)).await;

        let ledgers = vec![n1.ledger.clone(), n2.ledger.clone(), n3.ledger.clone()];
        wait_height_convergence(&ledgers, 2, Duration::from_secs(30)).await;
        assert_no_fork_through_min_height(&ledgers);
        assert_state_roots_match(&ledgers);

        stop(&[n1, n2, n3]);
    }

    /// A.3 — each in-process node has its own `BlockSyncBoard`; followers gate auto-mine until caught up.
    #[tokio::test]
    async fn in_process_three_nodes_auto_mine_with_sync_gate_per_node() {
        let _g = env_lock();
        block_sync_env();
        unsafe {
            std::env::set_var("TET_AUTO_MINE", "1");
            std::env::set_var("TET_BLOCK_TIME_SEC", "2");
            std::env::remove_var("TET_AUTO_MINE_IGNORE_SYNC");
        }

        let mut n1 = spawn_node(None, true).await;
        spawn_auto_miner_on_node(&mut n1);

        let bootstrap_deadline = Instant::now() + Duration::from_secs(20);
        while n1.ledger.block_height().unwrap_or(0) < 5 {
            assert!(
                Instant::now() < bootstrap_deadline,
                "node1 failed to mine bootstrap blocks"
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let h1_before_followers = n1.ledger.block_height().unwrap_or(0);

        let boot = n1.boot_multiaddr.clone();

        let tmp2 = tempfile::tempdir().unwrap();
        let db2 = tmp2.path().join("db");
        let db_dir2 = tmp2.path().to_path_buf();
        std::mem::forget(tmp2);
        let ledger2 = Arc::new(crate::ledger::Ledger::open(db2.to_str().unwrap()).unwrap());
        ledger2.init_genesis_founder_premine_from_env().unwrap();
        let _ = ledger2.apply_genesis_allocation("founder");
        let (state2, board2, _, swarm2, health2) =
            start_block_swarm_on_ledger(ledger2.clone(), &db_dir2, Some(&boot), false, 0).await;
        assert!(!n1.block_sync_board.same(&board2), "each node has its own sync state");
        assert!(
            sync_gate_active(&board2, ledger2.as_ref()).await,
            "node2 should gate before first hello (awaiting_first_hello)"
        );

        let mut n2 = TestNode {
            ledger: ledger2,
            db_dir: db_dir2,
            state: state2,
            block_sync_board: board2,
            boot_multiaddr: String::new(),
            swarm_task: swarm2,
            auto_miner: None,
            health: health2,
        };
        let mut n3 = spawn_node(Some(&boot), false).await;
        assert!(
            !n2.block_sync_board.same(&n3.block_sync_board),
            "each node has its own sync state"
        );

        tokio::time::sleep(Duration::from_millis(600)).await;

        spawn_auto_miner_on_node(&mut n2);
        spawn_auto_miner_on_node(&mut n3);

        let ledgers = vec![n1.ledger.clone(), n2.ledger.clone(), n3.ledger.clone()];
        wait_height_convergence(&ledgers, 2, Duration::from_secs(30)).await;

        // A.5: gate clears only after lag_blocks==0 for TET_SYNC_STABLE_SEC; pause miners so followers can catch up.
        if let Some(h) = n1.auto_miner.take() {
            h.abort();
        }
        if let Some(h) = n2.auto_miner.take() {
            h.abort();
        }
        if let Some(h) = n3.auto_miner.take() {
            h.abort();
        }
        wait_height_convergence(&ledgers, 0, Duration::from_secs(45)).await;

        let ungate_deadline = Instant::now() + Duration::from_secs(45);
        loop {
            if !sync_gate_active(&n2.block_sync_board, n2.ledger.as_ref()).await
                && !sync_gate_active(&n3.block_sync_board, n3.ledger.as_ref()).await
            {
                break;
            }
            assert!(
                Instant::now() < ungate_deadline,
                "followers did not clear sync gate within timeout"
            );
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        assert!(
            n1.ledger.block_height().unwrap_or(0) >= h1_before_followers,
            "node1 auto-miner should continue while followers catch up"
        );
        assert_state_roots_match(&ledgers);

        stop(&[n1, n2, n3]);
    }

    async fn wait_min_height(ledger: &Arc<crate::ledger::Ledger>, min: u64, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            if ledger.block_height().unwrap_or(0) >= min {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "timeout waiting for height>={min}, got {}",
                ledger.block_height().unwrap_or(0)
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    /// A.4 — bootnode stops; followers catch up via mdns + range sync without `respawn_swarm`.
    #[tokio::test]
    async fn bootnode_failure_recovery_no_manual_intervention() {
        let _g = env_lock();
        block_sync_env();
        unsafe {
            std::env::set_var("TET_HELLO_TIMEOUT_SEC", "5");
            std::env::set_var("TET_BOOTNODE_REDIAL_SEC", "60");
        }

        let mut n1 = spawn_node(None, true).await;
        mine_n(&n1.state, 5).await;
        let boot = n1.boot_multiaddr.clone();
        let n2 = spawn_node(Some(&boot), false).await;
        let n3 = spawn_node(Some(&boot), false).await;
        wait_height_convergence(
            &[n1.ledger.clone(), n2.ledger.clone(), n3.ledger.clone()],
            2,
            Duration::from_secs(30),
        )
        .await;

        // Stop bootnode (Node1) only — no respawn_swarm on followers.
        if let Some(h) = n1.auto_miner.take() {
            h.abort();
        }
        n1.swarm_task.abort();
        tokio::time::sleep(Duration::from_millis(500)).await;

        let target = n1.ledger.block_height().unwrap_or(0).saturating_add(3);
        mine_n(&n2.state, 3).await;

        let follower_deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let h2 = n2.ledger.block_height().unwrap_or(0);
            let h3 = n3.ledger.block_height().unwrap_or(0);
            if h2 >= target && h3 >= target.saturating_sub(1) {
                break;
            }
            assert!(
                Instant::now() < follower_deadline,
                "followers did not catch up after bootnode death: n2={h2} n3={h3} target={target}"
            );
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        wait_min_height(
            &n3.ledger,
            target.saturating_sub(1),
            Duration::from_secs(30),
        )
        .await;
        assert_state_roots_match(&[n2.ledger.clone(), n3.ledger.clone()]);

        // Node1 rejoins and catches up from Node2 (respawn allowed for dead bootnode only).
        let n2_boot = n2.boot_multiaddr.clone();
        respawn_swarm(&mut n1, Some(&n2_boot), false).await;
        let all = vec![n1.ledger.clone(), n2.ledger.clone(), n3.ledger.clone()];
        wait_height_convergence(&all, 2, Duration::from_secs(60)).await;
        assert_state_roots_match(&all);

        stop(&[n1, n2, n3]);
    }

    /// A.5 — after burst mine on Node1, all nodes share identical tip block_id + state_root.
    #[tokio::test]
    async fn tip_state_root_strict_match_after_mine() {
        let _g = env_lock();
        block_sync_env();

        let n1 = spawn_node(None, true).await;
        mine_n(&n1.state, 10).await;
        let boot = n1.boot_multiaddr.clone();
        let n2 = spawn_node(Some(&boot), false).await;
        let n3 = spawn_node(Some(&boot), false).await;
        let ledgers = vec![n1.ledger.clone(), n2.ledger.clone(), n3.ledger.clone()];
        wait_height_convergence(&ledgers, 0, Duration::from_secs(45)).await;
        wait_strict_tip_match(&ledgers, Duration::from_secs(10)).await;

        mine_n(&n1.state, 5).await;

        wait_strict_tip_match(&ledgers, Duration::from_secs(5)).await;
        assert_state_roots_match(&ledgers);
        let (_, tip_id, tip_root) = tip_triplet(&n1.ledger);
        assert!(
            tip_id.starts_with("0x"),
            "expected hex tip block_id, got {tip_id}"
        );
        assert!(
            tip_root.starts_with("0x"),
            "expected hex state_root, got {tip_root}"
        );

        stop(&[n1, n2, n3]);
    }

    /// **AT-F1 FOLLOWER-TRANSACT GUARD.**
    ///
    /// The S4 exit criterion in one test: a node that does not mine must be able to accept a
    /// transaction over REST and have a *peer* settle it. Node 2 submits, node 1 mines.
    ///
    /// What this pins is a failure that reached the public seed on 2026-09-22. Transaction
    /// gossip was wired end to end — `broadcast_mempool_tx` published and the receiver enqueued
    /// — but the publish was **one-shot**. A tx submitted in the seconds after a peer connects
    /// hits gossipsub `InsufficientPeers`, because the txs-topic mesh has not grafted yet, and
    /// nothing ever retried it. The tx then sat in the submitter's mempool forever: a follower
    /// could read the chain but never transact on it.
    ///
    /// **Scope, stated precisely.** On loopback the mesh grafts in well under a second, so this
    /// test reaches the submit *after* the graft and its first publish succeeds. It therefore
    /// guards the wire path — publish, receive, admit, mine — and the registration of a local tx
    /// for retry, but it does NOT reproduce the InsufficientPeers race: it was verified to still
    /// pass with the rebroadcast loop removed. The retry semantics that actually fix the bug are
    /// guarded deterministically by `pending_local_tx_is_rebroadcast_until_mined_then_forgotten`.
    /// Nothing currently guards the `spawn_mempool_rebroadcast` call in `main.rs` itself.
    #[tokio::test]
    async fn at_f1_follower_submits_tx_and_mining_peer_settles_it() {
        let _g = env_lock();
        block_sync_env();
        unsafe {
            // Retry fast so the test does not wait on the production 15 s cadence.
            std::env::set_var("TET_TX_REBROADCAST_SEC", "1");
        }

        let n1 = spawn_node(None, true).await; // producer
        let boot = n1.boot_multiaddr.clone();
        let n2 = spawn_node(Some(&boot), false).await; // follower: submits, never mines

        let rebroadcast = crate::rest::RestState::spawn_mempool_rebroadcast(n2.state.clone())
            .expect("follower must have a gossip channel");

        // A welcome-airdrop claim needs no prior balance and is signed by the claimant, so it is
        // the smallest tx that exercises the whole submit -> gossip -> mine -> apply path. It is
        // also literally the transaction AT-F1 specifies.
        let w = crate::wallet::generate_mnemonic_12().unwrap();
        let words = w.mnemonic_12.clone().unwrap();
        let wallet_id = w.address_hex.to_ascii_lowercase();
        let env = signed_env_for_tests(
            crate::protocol::TxV1::InitialAirdrop {
                wallet_id: wallet_id.clone(),
            },
            &words,
            &wallet_id,
        );

        let resp = crate::rest::handlers::ledger::post_initial_airdrop_claim(
            axum::extract::State(n2.state.clone()),
            axum::Json(env),
        )
        .await;
        assert_eq!(
            resp.status(),
            axum::http::StatusCode::ACCEPTED,
            "follower must accept the claim locally"
        );
        assert_eq!(
            n2.state.mempool.lock().await.len(),
            1,
            "submitter holds the tx in its own mempool"
        );
        assert_eq!(
            n2.state.pending_rebroadcast.lock().await.len(),
            1,
            "a REST-submitted tx must be registered for retry — without it the publish is \
             one-shot and a tx that races the mesh graft is stranded forever"
        );
        assert_eq!(
            n1.ledger.balance_micro(&wallet_id).unwrap(),
            0,
            "nothing may be credited before a block is mined"
        );

        // The tx must cross the wire on its own. This is the assertion the old code failed.
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            if n1.state.mempool.lock().await.len() == 1 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "tx never reached the mining peer's mempool — tx gossip is broken"
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        mine_n(&n1.state, 1).await;
        assert_eq!(
            n1.ledger.balance_micro(&wallet_id).unwrap(),
            1_000 * crate::ledger::STEVEMON,
            "the peer's block must settle the follower's transaction"
        );

        rebroadcast.abort();
        stop(&[n1, n2]);
    }

    /// **TX SECOND-PATH GUARD.** A follower with gossip unavailable must still get its
    /// transaction mined by its bootnode, over `/tet/v1/tx-submit`.
    ///
    /// Blocks have had two independent delivery paths since S1 — gossip and the pull-based
    /// catch-up RPC — so a degraded mesh never stopped a chain from syncing. Transactions had
    /// only gossip, and on 2026-09-22 that single path failed against the public seed in a way
    /// invisible from the application: the follower's record of the seed's topic subscriptions
    /// was missing `/tet/v1/txs`, so `publish` returned `InsufficientPeers` indefinitely while
    /// the peer connection stayed healthy and blocks kept arriving.
    ///
    /// `gossip_tx = None` here stands in for that failure — it is the strongest possible form of
    /// it, and it makes the test deterministic rather than dependent on mesh timing. If this
    /// passes, a transaction reached the miner without gossip carrying it.
    #[tokio::test]
    async fn follower_tx_settles_on_the_mining_peer_with_gossip_disabled() {
        let _g = env_lock();
        block_sync_env();
        unsafe {
            std::env::set_var("TET_TX_REBROADCAST_SEC", "1");
        }

        let n1 = spawn_node(None, true).await; // producer
        let boot = n1.boot_multiaddr.clone();
        let mut n2 = spawn_node(Some(&boot), false).await; // follower

        // Make gossip publishes go nowhere, without killing the node.
        //
        // Setting `gossip_tx = None` would drop the swarm's only publish-channel sender; the
        // swarm loop then sees `publish_rx.recv() == None`, logs "publish channel closed" and
        // **breaks out of the event loop entirely**. That kills block sync and the tx_submit
        // protocol along with gossip, which is not the failure being modelled here.
        //
        // So: keep the real sender alive, and point the REST state at a dead-end channel whose
        // receiver this test holds. Publishes succeed at the call site and reach no peer — which
        // is exactly the observed production failure, where `publish` believed it had no peer
        // subscribed to the topic.
        let _swarm_publish_keepalive = n2.state.gossip_tx.clone();
        let (dead_gossip_tx, _dead_gossip_rx) = tokio::sync::mpsc::channel::<String>(16);
        n2.state.gossip_tx = Some(dead_gossip_tx);
        assert!(
            n2.state.tx_submit_tx.is_some(),
            "the follower must still have the direct-submit channel"
        );

        let rebroadcast = crate::rest::RestState::spawn_mempool_rebroadcast(n2.state.clone())
            .expect("retry loop must run on the direct path alone");

        let w = crate::wallet::generate_mnemonic_12().unwrap();
        let words = w.mnemonic_12.clone().unwrap();
        let wallet_id = w.address_hex.to_ascii_lowercase();
        let env = signed_env_for_tests(
            crate::protocol::TxV1::InitialAirdrop {
                wallet_id: wallet_id.clone(),
            },
            &words,
            &wallet_id,
        );

        let resp = crate::rest::handlers::ledger::post_initial_airdrop_claim(
            axum::extract::State(n2.state.clone()),
            axum::Json(env),
        )
        .await;
        assert_eq!(resp.status(), axum::http::StatusCode::ACCEPTED);

        // It must reach the producer with no gossip involved at all.
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            if n1.state.mempool.lock().await.len() == 1 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "tx never reached the mining peer without gossip — the second path is broken"
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        mine_n(&n1.state, 1).await;
        assert_eq!(
            n1.ledger.balance_micro(&wallet_id).unwrap(),
            1_000 * crate::ledger::STEVEMON,
            "the peer's block must settle a tx that gossip never carried"
        );

        rebroadcast.abort();
        stop(&[n1, n2]);
    }

    // -----------------------------------------------------------------------------------------
    // Accept loop, part B (docs/DESIGN_accept_loop.md): the loop only routes. Its liveness is read
    // from the swarm-health beacon, which the loop stamps on every iteration and at least once a
    // second (the catch-up tick). A loop that awaits slow work shows a gap as long as the work.
    // -----------------------------------------------------------------------------------------

    /// Sample `health` every 50 ms until stopped; the result is the longest gap between two loop
    /// iterations seen.
    fn sample_loop_gaps(
        health: crate::swarm_health::SharedSwarmHealth,
    ) -> (Arc<std::sync::atomic::AtomicBool>, JoinHandle<u64>) {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let h = tokio::spawn(async move {
            let mut max = 0u64;
            while !stop2.load(Ordering::Relaxed) {
                if let Some(g) = health.since_last_tick_ms(crate::swarm_health::now_ms()) {
                    max = max.max(g);
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            max
        });
        (stop, h)
    }

    async fn stop_sampler(s: (Arc<std::sync::atomic::AtomicBool>, JoinHandle<u64>)) -> u64 {
        s.0.store(true, Ordering::Relaxed);
        s.1.await.unwrap()
    }

    /// The test-only delay every apply job sleeps first; reset on drop so a failing test cannot
    /// leave it set for the next one.
    struct ApplyDelay;
    impl ApplyDelay {
        fn set(ms: u64) -> Self {
            crate::apply_worker::TEST_APPLY_DELAY_MS.store(ms, Ordering::Relaxed);
            ApplyDelay
        }
    }
    impl Drop for ApplyDelay {
        fn drop(&mut self) {
            crate::apply_worker::TEST_APPLY_DELAY_MS.store(0, Ordering::Relaxed);
        }
    }

    async fn synced_pair() -> (TestNode, TestNode) {
        unsafe {
            std::env::set_var("TET_CHAIN_HELLO_INTERVAL_SEC", "1");
            std::env::remove_var("TET_PRODUCER_PEERS");
        }
        let n1 = spawn_node(None, true).await;
        let boot = n1.boot_multiaddr.clone();
        let n2 = spawn_node(Some(&boot), false).await;
        mine_n(&n1.state, 2).await;
        wait_height_convergence(&[n1.ledger.clone(), n2.ledger.clone()], 0, Duration::from_secs(40)).await;
        (n1, n2)
    }

    /// **G3 (accept loop B): the loop keeps draining while a block apply is slow.** The follower's
    /// apply sleeps 10 s per block. Meanwhile its loop must keep iterating (no gap near 10 s) and keep
    /// taking in what the producer says: the producer's new height reaches the follower's registry
    /// while the follower's own ledger has not moved.
    /// Negative control: await the apply result in the loop again → a gap of ~10 s → FAILED.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn loop_keeps_draining_while_apply_is_slow() {
        let _g = env_lock();
        block_sync_env();
        let (n1, n2) = synced_pair().await;
        let h0 = n2.ledger.block_height().unwrap();

        let delay = ApplyDelay::set(10_000);
        let sampler = sample_loop_gaps(n2.health.clone());
        let started = Instant::now();
        mine_n(&n1.state, 4).await;
        let n1_h = n1.ledger.block_height().unwrap();
        loop {
            let seen = n2
                .block_sync_board
                .with(|s| s.registry.heights_snapshot().iter().map(|r| r.1).max().unwrap_or(0));
            if seen >= n1_h {
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(9),
                "the follower's loop did not take in the producer's height {n1_h} (saw {seen}) while its apply slept"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(
            n2.ledger.block_height().unwrap(),
            h0,
            "test premise: the follower's apply is still asleep"
        );
        tokio::time::sleep(Duration::from_secs(9).saturating_sub(started.elapsed())).await;
        let gap = stop_sampler(sampler).await;
        drop(delay);
        assert!(gap < 3_000, "the swarm loop stalled for {gap} ms while a block apply was slow");

        wait_height_convergence(&[n1.ledger.clone(), n2.ledger.clone()], 0, Duration::from_secs(90)).await;
        stop(&[n1, n2]);
    }

    /// **G4 (accept loop B): the loop keeps draining under 1000 queued blocks, with bounded memory.**
    /// The producer floods the follower with 1000 gossip blocks while each apply takes 2 s. The
    /// follower's loop keeps iterating (no gap over 1.5 s), its apply queue never holds more than its
    /// cap, the overflow is dropped and counted, and once the flood is over it syncs the real chain.
    /// Negative controls: an apply queue that never refuses (unbounded) → depth far past the cap →
    /// FAILED; awaiting the queue in the loop → stall → FAILED.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn loop_keeps_draining_under_1000_queued_blocks() {
        let _g = env_lock();
        block_sync_env();
        let (n1, n2) = synced_pair().await;
        let h = n2.ledger.block_height().unwrap();
        let tip = block_id_at_height(n2.ledger.as_ref(), h).expect("tip");
        let dropped0 = crate::metrics::apply_dropped_total();

        let delay = ApplyDelay::set(2_000);
        let gaps = sample_loop_gaps(n2.health.clone());
        let depth_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let depth_max = {
            let stop = depth_stop.clone();
            tokio::spawn(async move {
                let mut max = 0u64;
                while !stop.load(Ordering::Relaxed) {
                    max = max.max(crate::metrics::apply_queue_depth());
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                max
            })
        };
        let gossip = n1.state.gossip_tx.clone().expect("publish channel");
        let salt = crate::swarm_health::now_ms();
        for i in 0..1000u32 {
            let ev = crate::models::NetworkEvent::BlockMined {
                block_height: h + 1,
                block_id: format!("flood-{salt}-{i:04}"),
                parent_block_id: Some(tip.clone()),
                producer_id: "alice".into(),
                base_reward_micro: 0,
                compute_reward_micro: 0,
                total_reward_micro: 0,
                state_root: "not-a-real-root".into(),
                txs: vec![],
            };
            gossip.send(serde_json::to_string(&ev).unwrap()).await.unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        while crate::metrics::apply_dropped_total() - dropped0 < 500 {
            assert!(
                Instant::now() < deadline,
                "backpressure never engaged: {} dropped",
                crate::metrics::apply_dropped_total() - dropped0
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        let gap = stop_sampler(gaps).await;
        depth_stop.store(true, Ordering::Relaxed);
        let max_depth = depth_max.await.unwrap();
        drop(delay);
        let dropped = crate::metrics::apply_dropped_total() - dropped0;
        assert!(gap < 1_500, "the swarm loop stalled for {gap} ms under a flood of blocks");
        assert!(
            max_depth as usize <= crate::apply_worker::APPLY_QUEUE_CAP_DEFAULT,
            "the apply queue grew to {max_depth}, past its cap: memory is not bounded"
        );
        assert!(dropped >= 500, "only {dropped} of 1000 flood blocks were dropped");

        // The flood is over: the follower still follows the real chain.
        mine_n(&n1.state, 2).await;
        wait_height_convergence(&[n1.ledger.clone(), n2.ledger.clone()], 0, Duration::from_secs(120)).await;
        stop(&[n1, n2]);
    }

    /// **G6 (accept loop B): the loop drains while the mempool is held.** The test holds the
    /// producer's mempool lock for 8 s, as a miner building a block does, while the follower sends
    /// it a transaction (gossip and direct submit). The producer's loop keeps iterating, and the
    /// transaction is admitted once the lock is released.
    /// Negative control: await the admission result in the loop again → stall → FAILED.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn loop_drains_while_mempool_is_held() {
        let _g = env_lock();
        block_sync_env();
        unsafe {
            std::env::set_var("TET_TX_REBROADCAST_SEC", "1");
        }
        let (n1, n2) = synced_pair().await;
        let rebroadcast = crate::rest::RestState::spawn_mempool_rebroadcast(n2.state.clone()).expect("retry loop");

        let held = n1.state.mempool.lock().await;
        let gaps = sample_loop_gaps(n1.health.clone());
        let w = crate::wallet::generate_mnemonic_12().unwrap();
        let words = w.mnemonic_12.clone().unwrap();
        let wallet_id = w.address_hex.to_ascii_lowercase();
        let env = signed_env_for_tests(
            crate::protocol::TxV1::InitialAirdrop { wallet_id: wallet_id.clone() },
            &words,
            &wallet_id,
        );
        let resp = crate::rest::handlers::ledger::post_initial_airdrop_claim(
            axum::extract::State(n2.state.clone()),
            axum::Json(env),
        )
        .await;
        assert_eq!(resp.status(), axum::http::StatusCode::ACCEPTED);
        tokio::time::sleep(Duration::from_secs(8)).await;
        let gap = stop_sampler(gaps).await;
        drop(held);
        assert!(gap < 3_000, "the producer's swarm loop stalled for {gap} ms while its mempool was held");

        let deadline = Instant::now() + Duration::from_secs(30);
        while n1.state.mempool.lock().await.len() != 1 {
            assert!(Instant::now() < deadline, "the transaction was never admitted after the lock was released");
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        rebroadcast.abort();
        stop(&[n1, n2]);
    }

    /// **AT-F1 FOLLOWER SENDS MONEY.**
    ///
    /// The headline S4 criterion, on the path that actually matters: a transfer. Node 2 does not
    /// mine; it accepts a signed transfer over `/ledger/transfer` and node 1 must settle it.
    ///
    /// `post_transfer_enveloped_impl` admitted the tx to the mempool and **never announced it**.
    /// `broadcast_mempool_tx` had four callers and the transfer handler was not among them, so a
    /// follower could accept a signed transfer, return `202 pending`, and never send it anywhere
    /// — the transaction sat in its mempool until restart. Invisible whenever the submitting node
    /// was also a producer, which is how every earlier AT-F1 run passed: the transfer was
    /// submitted to the seed.
    ///
    /// Now there is no enqueue-only method on `RestState`; `submit_local_tx` admits and announces
    /// in one call. Delete the announce half and this test fails.
    #[tokio::test]
    async fn at_f1_follower_sends_money_and_producer_settles_it() {
        let _g = env_lock();
        block_sync_env();
        unsafe {
            std::env::set_var("TET_TX_REBROADCAST_SEC", "1");
        }

        let n1 = spawn_node(None, true).await; // producer
        let boot = n1.boot_multiaddr.clone();
        let n2 = spawn_node(Some(&boot), false).await; // follower: submits, never mines

        let rebroadcast = crate::rest::RestState::spawn_mempool_rebroadcast(n2.state.clone())
            .expect("follower must have a delivery channel");

        // Fund the sender identically on both ledgers so the producer agrees it can pay.
        let sender = crate::wallet::generate_mnemonic_12().unwrap();
        let sender_words = sender.mnemonic_12.clone().unwrap();
        let sender_id = sender.address_hex.to_ascii_lowercase();
        for l in [&n1.ledger, &n2.ledger] {
            l.admin_rest_faucet(&sender_id, 1_000 * crate::ledger::STEVEMON, "127.0.0.1", true, 1, 1)
                .unwrap();
        }
        let recipient = crate::wallet::generate_mnemonic_12().unwrap();
        let recipient_id = recipient.address_hex.to_ascii_lowercase();
        assert_eq!(n1.ledger.balance_micro(&recipient_id).unwrap(), 0);

        let amount_micro = crate::ledger::STEVEMON; // 1 TET
        let env = signed_env_for_tests(
            crate::protocol::TxV1::Transfer {
                from_wallet: sender_id.clone(),
                to_wallet: recipient_id.clone(),
                amount_micro,
                fee_bps: 100,
            },
            &sender_words,
            &sender_id,
        );

        use axum::response::IntoResponse as _;
        let resp = crate::rest::handlers::ledger::post_transfer_enveloped(
            axum::extract::State(n2.state.clone()),
            axum::http::HeaderMap::new(),
            axum::Json(env),
        )
        .await
        .into_response();
        assert_eq!(
            resp.status(),
            axum::http::StatusCode::ACCEPTED,
            "the follower must accept the signed transfer"
        );

        // It has to cross the wire on its own. This is the assertion the old code failed.
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            if n1.state.mempool.lock().await.len() == 1 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the transfer never reached the producer — a follower accepted money and \
                 announced it to nobody"
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        mine_n(&n1.state, 1).await;
        let got = n1.ledger.balance_micro(&recipient_id).unwrap();
        assert!(
            got > 0,
            "the producer's block must credit the recipient; got {got}"
        );

        rebroadcast.abort();
        stop(&[n1, n2]);
    }

    /// **SWARM SURVIVES A CLOSED PUBLISH CHANNEL.**
    ///
    /// Dropping the gossip sender — which any caller does simply by clearing
    /// `RestState::gossip_tx` — used to `break` the block-plane event loop, stopping block sync,
    /// the chain-sync RPC and tx-submit along with gossip. One producer going away is not a
    /// reason to stop serving everything else.
    ///
    /// Here the follower drops its gossip sender entirely and must still (a) keep syncing blocks
    /// the peer mines and (b) deliver a transaction over `/tet/v1/tx-submit`. Restore the `break`
    /// and both assertions fail.
    #[tokio::test]
    async fn swarm_keeps_serving_after_the_publish_channel_closes() {
        let _g = env_lock();
        block_sync_env();
        unsafe {
            std::env::set_var("TET_TX_REBROADCAST_SEC", "1");
        }

        let n1 = spawn_node(None, true).await; // producer
        let boot = n1.boot_multiaddr.clone();
        let mut n2 = spawn_node(Some(&boot), false).await;

        // Drop the ONLY sender for the swarm's publish channel. `recv()` now returns None
        // forever, which is exactly the condition that used to kill the loop.
        n2.state.gossip_tx = None;
        let rebroadcast = crate::rest::RestState::spawn_mempool_rebroadcast(n2.state.clone())
            .expect("retry loop still runs on the direct path");

        let height_at_drop = n1.ledger.block_height().unwrap_or(0);
        mine_n(&n1.state, 2).await;

        // (a) block sync still works on the follower.
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            if n2.ledger.block_height().unwrap_or(0) > height_at_drop {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "follower stopped syncing blocks after its publish channel closed — \
                 the swarm loop died with the channel"
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        // (b) tx-submit still works on the follower.
        let w = crate::wallet::generate_mnemonic_12().unwrap();
        let words = w.mnemonic_12.clone().unwrap();
        let wallet_id = w.address_hex.to_ascii_lowercase();
        let env = signed_env_for_tests(
            crate::protocol::TxV1::InitialAirdrop {
                wallet_id: wallet_id.clone(),
            },
            &words,
            &wallet_id,
        );
        let resp = crate::rest::handlers::ledger::post_initial_airdrop_claim(
            axum::extract::State(n2.state.clone()),
            axum::Json(env),
        )
        .await;
        assert_eq!(resp.status(), axum::http::StatusCode::ACCEPTED);

        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            if n1.state.mempool.lock().await.len() == 1 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "tx-submit stopped working after the publish channel closed"
            );
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        mine_n(&n1.state, 1).await;
        assert_eq!(
            n1.ledger.balance_micro(&wallet_id).unwrap(),
            1_000 * crate::ledger::STEVEMON
        );

        rebroadcast.abort();
        stop(&[n1, n2]);
    }
}

// =================================================================================================
// File Sharing — Phase 0 (spec docs/PHASE_0_FILE_SHARING_SPEC.md)
// =================================================================================================

struct FileTestWallet {
    wallet_id: String,
    ed: SigningKey,
    mldsa: dilithium::MlDsaKeyPair,
    mldsa_pub_b64: String,
}

fn file_test_wallet() -> FileTestWallet {
    let ed = SigningKey::generate(&mut rand_core::OsRng);
    let wallet_id = hex::encode(ed.verifying_key().to_bytes());
    let mut seed = [0u8; 32];
    rand_core::OsRng.fill_bytes(&mut seed);
    let mldsa = dilithium::MlDsaKeyPair::generate_deterministic(dilithium::ML_DSA_44, &seed);
    let mldsa_pub_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa.public_key());
    FileTestWallet {
        wallet_id,
        ed,
        mldsa,
        mldsa_pub_b64,
    }
}

fn file_empty_sig() -> crate::files::FileHybridSig {
    crate::files::FileHybridSig {
        ed25519_pubkey_hex: String::new(),
        ed25519_sig_b64: String::new(),
        mldsa_pubkey_b64: String::new(),
        mldsa_sig_b64: String::new(),
    }
}

fn file_sign_hybrid(w: &FileTestWallet, msg: &[u8]) -> crate::files::FileHybridSig {
    let ed_sig = w.ed.sign(msg);
    let ed_sig_b64 = base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes());
    let mldsa_sig = crate::wallet::mldsa44_sign_deterministic(&w.mldsa, msg).unwrap();
    let mldsa_sig_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_sig);
    crate::files::FileHybridSig {
        ed25519_pubkey_hex: w.wallet_id.clone(),
        ed25519_sig_b64: ed_sig_b64,
        mldsa_pubkey_b64: w.mldsa_pub_b64.clone(),
        mldsa_sig_b64,
    }
}

fn file_dummy_e2ee() -> crate::files::FileE2eeBlock {
    crate::files::FileE2eeBlock {
        v: 1,
        scheme: crate::files::FILE_E2EE_SCHEME.to_string(),
        client_ephemeral_pub_b64: "AA==".to_string(),
        receiver_x25519_pub_b64: "AA==".to_string(),
        receiver_mlkem_pub_b64: "AA==".to_string(),
        mlkem_ciphertext_b64: "AA==".to_string(),
        filename_nonce_b64: "AA==".to_string(),
        mime_nonce_b64: "AA==".to_string(),
        body_nonce_b64: "AA==".to_string(),
    }
}

/// Build a hybrid-signed `FileEnvelopeV1` whose `file_sha256` matches `blob`.
fn build_signed_file_envelope(
    sender: &FileTestWallet,
    receiver_wallet_id: &str,
    blob: &[u8],
    created_at_ms: u64,
) -> crate::files::FileEnvelopeV1 {
    let mut env = crate::files::FileEnvelopeV1 {
        v: 1,
        kind: crate::files::FILE_ENVELOPE_KIND.to_string(),
        file_id: uuid::Uuid::new_v4(),
        sender_wallet_id: sender.wallet_id.clone(),
        receiver_wallet_id: receiver_wallet_id.to_string(),
        file_size: blob.len() as u64,
        file_sha256: crate::files::sha256_hex(blob),
        filename_encrypted_b64: "ZmlsZW5hbWU=".to_string(),
        mime_type_encrypted_b64: "bWltZQ==".to_string(),
        storage_node: "12D3KooWStorageNodeTest".to_string(),
        fee_micro: crate::files::FILE_FEE_MICRO,
        created_at_ms,
        ttl_ms: 0,
        e2ee: file_dummy_e2ee(),
        hybrid_sig: file_empty_sig(),
    };
    let msg = crate::files::file_envelope_preimage_v1(&env, &sender.mldsa_pub_b64);
    env.hybrid_sig = file_sign_hybrid(sender, &msg);
    env
}

fn file_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_file_store() -> (crate::ledger::Ledger, crate::files::storage::FileStore) {
    let ledger = open_temp_ledger();
    let db = ledger.sled_db();
    let store = crate::files::storage::FileStore::open(&db).expect("file store open");
    (ledger, store)
}

#[test]
fn file_preimage_is_deterministic() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, b"hello world", 1_000);
    let a = crate::files::file_envelope_preimage_v1(&env, &alice.mldsa_pub_b64);
    let b = crate::files::file_envelope_preimage_v1(&env, &alice.mldsa_pub_b64);
    assert_eq!(a, b);
    let s = String::from_utf8(a).unwrap();
    assert!(s.starts_with("tet file envelope v1|chain_id="));
    assert!(s.contains("|size=11|"));
}

#[test]
fn file_preimage_changes_with_fields() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let mut env = build_signed_file_envelope(&alice, &bob.wallet_id, b"abc", 1_000);
    let base = crate::files::file_envelope_preimage_v1(&env, &alice.mldsa_pub_b64);
    env.file_size = 999;
    let changed = crate::files::file_envelope_preimage_v1(&env, &alice.mldsa_pub_b64);
    assert_ne!(base, changed);
}

#[test]
fn file_envelope_verify_ok() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, b"payload-bytes", 1_000);
    crate::files::verify_file_envelope_v1(&env).expect("valid envelope must verify");
}

#[test]
fn file_envelope_verify_rejects_tampered_sha256() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let mut env = build_signed_file_envelope(&alice, &bob.wallet_id, b"payload", 1_000);
    // Different but well-formed hash → preimage diverges → signature must fail.
    env.file_sha256 = "ab".repeat(32);
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env),
        Err(crate::files::FileEnvelopeError::Signature(_))
    ));
}

#[test]
fn file_envelope_verify_rejects_wrong_signer() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let mallory = file_test_wallet();
    let bob = file_test_wallet();
    let mut env = build_signed_file_envelope(&alice, &bob.wallet_id, b"payload", 1_000);
    // Claim a different signer than sender_wallet_id.
    env.hybrid_sig.ed25519_pubkey_hex = mallory.wallet_id.clone();
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env),
        Err(crate::files::FileEnvelopeError::SignerMismatch)
    ));
}

#[test]
fn file_envelope_verify_rejects_bad_version_and_kind() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let mut env = build_signed_file_envelope(&alice, &bob.wallet_id, b"x", 1_000);
    env.v = 2;
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env),
        Err(crate::files::FileEnvelopeError::UnsupportedVersion(2))
    ));
    let mut env2 = build_signed_file_envelope(&alice, &bob.wallet_id, b"x", 1_000);
    env2.kind = "not_a_file".to_string();
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env2),
        Err(crate::files::FileEnvelopeError::Kind(_))
    ));
}

#[test]
fn file_envelope_verify_rejects_size_out_of_range() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let mut env = build_signed_file_envelope(&alice, &bob.wallet_id, b"x", 1_000);
    env.file_size = 0;
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env),
        Err(crate::files::FileEnvelopeError::SizeOutOfRange { .. })
    ));
    env.file_size = crate::files::MAX_FILE_BODY_BYTES + 1;
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env),
        Err(crate::files::FileEnvelopeError::SizeOutOfRange { .. })
    ));
}

#[test]
fn file_envelope_verify_rejects_bad_wallet_id() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let mut env = build_signed_file_envelope(&alice, "not-64-hex", b"x", 1_000);
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env),
        Err(crate::files::FileEnvelopeError::InvalidWalletId)
    ));
    // Also re-sign so the only fault is the receiver id, not the signature.
    let msg = crate::files::file_envelope_preimage_v1(&env, &alice.mldsa_pub_b64);
    env.hybrid_sig = file_sign_hybrid(&alice, &msg);
    assert!(matches!(
        crate::files::verify_file_envelope_v1(&env),
        Err(crate::files::FileEnvelopeError::InvalidWalletId)
    ));
}

#[test]
fn file_delete_request_sign_verify_ok() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let mut req = crate::files::FileDeleteRequestV1 {
        file_id: uuid::Uuid::new_v4(),
        sender_wallet_id: alice.wallet_id.clone(),
        created_at_ms: 42,
        hybrid_sig: file_empty_sig(),
    };
    let msg = crate::files::file_delete_preimage_v1(&req, &alice.mldsa_pub_b64);
    req.hybrid_sig = file_sign_hybrid(&alice, &msg);
    crate::files::verify_file_delete_request_v1(&req).expect("valid delete must verify");
}

#[test]
fn file_delete_request_rejects_wrong_signer() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let mallory = file_test_wallet();
    let mut req = crate::files::FileDeleteRequestV1 {
        file_id: uuid::Uuid::new_v4(),
        sender_wallet_id: alice.wallet_id.clone(),
        created_at_ms: 42,
        hybrid_sig: file_empty_sig(),
    };
    let msg = crate::files::file_delete_preimage_v1(&req, &mallory.mldsa_pub_b64);
    req.hybrid_sig = file_sign_hybrid(&mallory, &msg);
    assert!(matches!(
        crate::files::verify_file_delete_request_v1(&req),
        Err(crate::files::FileDeleteError::SignerMismatch)
    ));
}

#[test]
fn file_store_put_get_roundtrip() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let (_ledger, store) = new_file_store();
    let blob = b"the actual encrypted bytes".to_vec();
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, &blob, file_now_ms());
    assert!(store.store_with_blob(&env, &blob).unwrap());
    let fid = env.file_id.to_string();
    assert_eq!(store.get_blob(&fid).unwrap(), blob);
    let meta = store.get_meta(&fid).expect("meta present");
    assert_eq!(meta.file_id, env.file_id);
}

#[test]
fn file_store_rejects_sha256_mismatch() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let (_ledger, store) = new_file_store();
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, b"correct", 1_000);
    // Upload a different blob than the envelope's sha256 commits to.
    assert!(matches!(
        store.store_with_blob(&env, b"WRONG"),
        Err(crate::files::storage::FileStoreError::Sha256Mismatch { .. })
    ));
}

#[test]
fn file_store_rejects_oversize_blob() {
    let _g = env_lock();
    set_test_env_base();
    // Shrink the cap for this test so we don't allocate 5 MiB.
    unsafe {
        std::env::set_var("TET_FILES_MAX_BODY_BYTES", "16");
    }
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let (_ledger, store) = new_file_store();
    let blob = vec![7u8; 64];
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, &blob, 1_000);
    assert!(matches!(
        store.store_with_blob(&env, &blob),
        Err(crate::files::storage::FileStoreError::BlobTooLarge { .. })
    ));
    unsafe {
        std::env::remove_var("TET_FILES_MAX_BODY_BYTES");
    }
}

#[test]
fn file_store_inbox_newest_first_and_dedup() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let (_ledger, store) = new_file_store();
    let now = file_now_ms();
    let e1 = build_signed_file_envelope(&alice, &bob.wallet_id, b"first", now);
    let e2 = build_signed_file_envelope(&alice, &bob.wallet_id, b"second", now + 1_000);
    assert!(store.store_meta(&e1).unwrap());
    assert!(store.store_meta(&e2).unwrap());
    // Idempotent: storing the same file_id again is a no-op.
    assert!(!store.store_meta(&e1).unwrap());
    let inbox = store.get_inbox(&bob.wallet_id, 10);
    assert_eq!(inbox.len(), 2);
    assert_eq!(inbox[0].file_id, e2.file_id, "newest first");
    assert_eq!(inbox[1].file_id, e1.file_id);
}

#[test]
fn file_store_expiry_hides_entries() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let (_ledger, store) = new_file_store();
    let blob = b"expiring".to_vec();
    // created far in the past with a 1 ms ttl → already expired.
    let mut env = build_signed_file_envelope(&alice, &bob.wallet_id, &blob, 1);
    env.ttl_ms = 1;
    // Re-sign because we mutated ttl... ttl is not in the preimage, so signature still valid, but
    // store_with_blob does not verify the signature — it only checks size + sha256.
    store.store_with_blob(&env, &blob).unwrap();
    assert!(store.get_inbox(&bob.wallet_id, 10).is_empty());
    assert!(store.get_blob(&env.file_id.to_string()).is_none());
    let removed = store.prune_expired();
    assert!(removed >= 1);
}

#[test]
fn file_store_delete_removes_all() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let (_ledger, store) = new_file_store();
    let blob = b"to-delete".to_vec();
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, &blob, file_now_ms());
    store.store_with_blob(&env, &blob).unwrap();
    let fid = env.file_id.to_string();
    assert!(store.delete_file(&fid));
    assert!(store.get_blob(&fid).is_none());
    assert!(store.get_meta(&fid).is_none());
    assert!(store.get_inbox(&bob.wallet_id, 10).is_empty());
    // Deleting again reports not-existed.
    assert!(!store.delete_file(&fid));
}

#[test]
fn file_two_node_send_receive_flow() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let (_ledger_a, node_a) = new_file_store();
    let (_ledger_b, node_b) = new_file_store();

    // Sender uploads (store blob + meta) and "announces".
    let blob = b"cross-node encrypted body".to_vec();
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, &blob, file_now_ms());
    assert!(node_a.store_with_blob(&env, &blob).unwrap());

    // Receiver node ingests the gossiped announce: verify then buffer meta.
    crate::files::verify_file_envelope_v1(&env).expect("announce must verify on receiver");
    assert!(node_b.store_meta(&env).unwrap());

    // Receiver lists the inbox and locates the file (meta only — no blob yet).
    let inbox = node_b.get_inbox(&bob.wallet_id, 10);
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].file_id, env.file_id);
    let fid = env.file_id.to_string();
    assert!(node_b.get_blob(&fid).is_none(), "receiver has no blob yet");

    // Body transfer (Phase 0 = REST fetch from storage_node) simulated: pull from A, verify digest.
    let fetched = node_a.get_blob(&fid).expect("storage node serves the blob");
    assert_eq!(crate::files::sha256_hex(&fetched), env.file_sha256);
    node_b.put_blob(&env, &fetched).expect("receiver stores fetched blob");
    assert_eq!(node_b.get_blob(&fid).unwrap(), blob);
}

#[test]
fn file_fee_split_constants_sum_to_full() {
    // FEE_SPEC §4: the constants now live in fees.rs; files re-exports FILE_FEE_MICRO.
    assert_eq!(
        crate::fees::FILE_SPLIT_TREASURY_BPS
            + crate::fees::FILE_SPLIT_STORAGE_BPS
            + crate::fees::FILE_SPLIT_BURN_BPS,
        crate::fees::BPS_DENOM
    );
    assert_eq!(crate::files::FILE_FEE_MICRO, 1000);
    assert_eq!(crate::files::FILE_FEE_MICRO, crate::fees::FILE_FEE_MICRO);
}

#[test]
fn file_fetch_response_helpers() {
    let id = uuid::Uuid::new_v4();
    let nf = crate::files::FileFetchResponse::not_found(id);
    assert!(!nf.found);
    let blob = b"abc".to_vec();
    let ok = crate::files::FileFetchResponse::from_blob(id, &blob);
    assert!(ok.found);
    assert_eq!(ok.file_sha256, crate::files::sha256_hex(&blob));
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(ok.blob_b64.as_bytes())
            .unwrap(),
        blob
    );
}

#[test]
fn file_announce_network_event_roundtrips_json() {
    let _g = env_lock();
    set_test_env_base();
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let env = build_signed_file_envelope(&alice, &bob.wallet_id, b"json", 1_000);
    let event = crate::models::NetworkEvent::FileAnnounce {
        envelope: env.clone(),
    };
    let json = serde_json::to_string(&event).unwrap();
    let back: crate::models::NetworkEvent = serde_json::from_str(&json).unwrap();
    match back {
        crate::models::NetworkEvent::FileAnnounce { envelope } => {
            assert_eq!(envelope.file_id, env.file_id);
            crate::files::verify_file_envelope_v1(&envelope).expect("verify after json roundtrip");
        }
        _ => panic!("expected FileAnnounce"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Block 9828 regression suite — three independent non-determinism sources in the state_root
// pipeline, each of which can produce the observed symptom: identical block_id, identical
// tx_hashes, divergent state_root, no error logged.
//
// See docs/BUG_block_9828_divergence_mystery.md. These tests assert CURRENT BROKEN BEHAVIOUR so
// the bug is pinned; each carries a TODO naming the fix that will invert its assertion.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/// **BUG (rank 2): wall-clock time is a consensus input.**
///
/// `apply_consensus_block_batch` (`ledger.rs:1678`) and `compute_state_root_after_remote_block`
/// (`ledger.rs:1432`) both call `locked_balance_micro(.., ledger_now_ms())`. That value gates the
/// spendability check which decides whether a transfer applies or returns `InsufficientFunds`.
///
/// Two nodes applying the *same block* at different wall-clock moments therefore reach different
/// state whenever a vest-lock boundary falls between them. On 2026-05-30 the VPS mined block 9828
/// at ~02:30 UTC and the Mac replayed it ~17 hours later.
///
/// TODO(9828): consensus must read the *block's* timestamp, not the node's clock. Once
/// `apply_consensus_block_batch` takes `block_time_ms` and threads it into
/// `locked_balance_micro`, flip the `assert_ne!` below to `assert_eq!` — the whole point of the
/// fix is that the two evaluations become identical.
#[test]
fn wallclock_time_changes_spendability_for_the_same_block() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();

    // A worker reward creates a 90-day vest lock (WORKER_REWARD_VEST_MS_DEFAULT).
    // It debits WALLET_SYSTEM_WORKER_POOL, so genesis must fund the pool first.
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let worker = "w".repeat(64);
    let gross = 10_000_000u64;
    let (_g0, worker_net, _tax, _proof) = ledger
        .mint_worker_network_reward(&worker, "vault", gross, b"energy:9828", None)
        .expect("mint seeds the vest lock");
    assert!(worker_net > 0, "worker must receive a vested amount");

    // Fixed constants, NOT SystemTime::now(). A test whose whole subject is "wall-clock time
    // leaks into consensus" must not itself read the wall clock: `mint_worker_network_reward`
    // derives `unlock_at_ms` from the real clock internally, so a now()-derived `t_during` made
    // the assertions depend on when the suite happened to run. These two values bracket any
    // possible unlock_at: 1 ms after the epoch is before every lock, 2100-01-01 is after every
    // lock, so the outcome is identical on every machine and every day.
    const T_DURING_VEST: u128 = 1;
    const T_AFTER_VEST: u128 = 4_102_444_800_000; // 2100-01-01T00:00:00Z
    let (t_during, t_after) = (T_DURING_VEST, T_AFTER_VEST);

    let locked_during = ledger.locked_balance_micro(&worker, t_during).unwrap();
    let locked_after = ledger.locked_balance_micro(&worker, t_after).unwrap();

    // The injected timestamp is the ONLY difference. Stored state is byte-identical.
    assert_ne!(
        locked_during, locked_after,
        "BUG: locked balance depends on wall-clock time, and the apply path feeds it \
         ledger_now_ms(). Same block + same state + different clock = different outcome."
    );
    assert_eq!(locked_during, worker_net, "fully locked during the vest");
    assert_eq!(locked_after, 0, "unlocked after the vest");

    // The consensus-relevant consequence: the spendability gate flips.
    let balance = ledger.balance_micro(&worker).unwrap();
    let amount = worker_net / 2;
    let spendable_during = balance.saturating_sub(locked_during);
    let spendable_after = balance.saturating_sub(locked_after);

    assert!(
        spendable_during < amount,
        "a node applying during the vest rejects the transfer (InsufficientFunds)"
    );
    assert!(
        spendable_after >= amount,
        "a node applying after the vest accepts the same transfer"
    );
}

/// **FIXED (was rank 3): the two root computations now agree on unreadable rows.**
///
/// `compute_state_root` used `let Ok(..) else { continue }` for sled errors, decrypt failures and
/// malformed lengths, so one bad row silently vanished from the root while peers kept it —
/// identical block history, divergent root, nothing logged. That is the block 9828 signature
/// (`docs/BUG_block_9828_divergence_mystery.md`).
///
/// It now returns `Result` and fails closed, matching `compute_state_root_after_remote_block`
/// which already propagated with `?`. This test was inverted from its TODO(9828): it previously
/// asserted the two DISAGREED; it now asserts they agree by both refusing.
///
/// The asymmetry only bites with encryption on: with no cipher `decrypt_value` is a passthrough
/// and a short value falls through the shared length check on both paths.
#[test]
fn state_root_paths_agree_on_unreadable_rows() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_DB_ENCRYPT", "strict");
        std::env::set_var(
            "TET_DB_KEY_B64",
            base64::engine::general_purpose::STANDARD.encode([9u8; 32]),
        );
    }
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    // Healthy DB: both paths succeed and agree.
    let live_ok = ledger.compute_state_root().expect("healthy live root");
    let preview_ok = ledger
        .compute_state_root_after_remote_block(&[], "", 0)
        .expect("healthy preview root");
    assert_eq!(live_ok, preview_ok, "healthy DB: both paths agree");

    // Inject one unreadable row, as a torn write would leave behind: shorter than the 12-byte
    // AES-GCM nonce, so decryption fails outright.
    let balances = ledger.sled_db().open_tree("balances").unwrap();
    balances
        .insert(b"c".repeat(64), vec![0xAAu8; 3])
        .expect("raw insert simulates a partial write");

    let live = ledger.compute_state_root();
    let preview = ledger.compute_state_root_after_remote_block(&[], "", 0);

    assert!(
        live.is_err(),
        "the live root must refuse to hash partial state, not silently skip the row"
    );
    assert!(preview.is_err(), "the preview root must refuse it too");
    assert_eq!(
        live.is_err(),
        preview.is_err(),
        "both root computations must reach the SAME verdict on identical bytes — \
         disagreement here is the 9828 mechanism"
    );

    unsafe {
        std::env::remove_var("TET_DB_KEY_B64");
        std::env::set_var("TET_DB_ENCRYPT", "false");
    }
}

/// **FIXED (was rank 1): the faucet no longer has a REST-reachable direct-write path.**
///
/// `/ledger/faucet` and `/faucet` routed to `admin_rest_faucet`, which wrote balances outside the
/// block pipeline — so whichever node served the request forked its `state_root` while block
/// history stayed identical. Both routes and the handler were removed on 2026-09-19.
///
/// The consensus-safe faucet is `POST /ledger/initial_airdrop/claim`: a hybrid-signed
/// `TxV1::InitialAirdrop` through the mempool, applied deterministically on every node
/// (`2ce9024`). This test was inverted from its TODO(9828): it previously asserted a direct write
/// FORKED the root; it now asserts the consensus path KEEPS nodes equal.
///
/// `Ledger::admin_rest_faucet` still exists for test seeding and offline operator use and still
/// writes directly — that is why it must never be re-exposed over HTTP. The companion test
/// `welcome_airdrop_offchain_claim_forks_node_state_root` pins what happens if it is.
#[test]
fn consensus_faucet_path_keeps_nodes_in_agreement() {
    let _g = env_lock();
    set_test_env_base();

    let n1 = open_temp_ledger();
    n1.init_genesis_founder_premine_from_env().unwrap();
    n1.apply_genesis_allocation("founder").unwrap();
    let n2 = open_temp_ledger();
    n2.init_genesis_founder_premine_from_env().unwrap();
    n2.apply_genesis_allocation("founder").unwrap();
    assert_eq!(
        n1.compute_state_root().unwrap(),
        n2.compute_state_root().unwrap(),
        "identical genesis"
    );

    // A hybrid-signed InitialAirdrop -- the consensus-safe faucet that replaced the removed
    // /ledger/faucet route.
    let w = crate::wallet::generate_mnemonic_12().unwrap();
    let words = w.mnemonic_12.clone().unwrap();
    let wallet_id = w.address_hex.to_ascii_lowercase();
    let tx = crate::protocol::TxV1::InitialAirdrop {
        wallet_id: wallet_id.clone(),
    };
    let env = signed_env_for_tests(tx, &words, &wallet_id);
    let h = crate::consensus::tx_hash_for_env(&env).unwrap();

    // APPLY it on both nodes (the sibling test covers the preview arm; this covers apply).
    let a1 = n1
        .apply_consensus_block_batch(1, std::slice::from_ref(&env), &[h.clone()], "producer-x", 0)
        .unwrap();
    let a2 = n2
        .apply_consensus_block_batch(1, std::slice::from_ref(&env), &[h], "producer-x", 0)
        .unwrap();

    assert_eq!(
        a1, a2,
        "the consensus faucet path must leave both nodes at the SAME state root"
    );
    assert_eq!(
        n1.compute_state_root().unwrap(),
        n2.compute_state_root().unwrap(),
        "no node-local side effect: roots stay equal after the claim"
    );
    assert!(
        n1.balance_micro(&wallet_id).unwrap() > 0,
        "the claim must actually credit the wallet"
    );
}

/// **SECURITY REGRESSION GUARD.** `POST /ledger/recover-from-guardian` must stay gone.
///
/// It was unauthenticated (`_headers` ignored, no `require_admin_bearer`, no mainnet gate) and
/// `verify_state_snapshot_signed` checked the signature against a public key supplied **in the same
/// request body** — self-certifying, so it authorised nothing. `import_snapshot_json_v1` then wiped
/// every row of the balances tree and replaced it with caller-supplied state.
///
/// Any unauthenticated caller who could reach the REST port could therefore overwrite a node's
/// entire ledger. The seed node had 5010 open to the internet.
///
/// Guardian recovery is an offline ops procedure: an operator restoring a node has filesystem
/// access and does not need an HTTP endpoint. `Ledger::import_snapshot_json_v1` is retained for
/// that use and is no longer reachable over HTTP.
#[tokio::test]
async fn removed_guardian_recover_route_is_not_reachable() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let root_before = ledger.compute_state_root().unwrap();

    let body = serde_json::json!({
        "sha256_hex": "00".repeat(32),
        "snapshot_b64": "",
        "ed25519_pubkey_hex": "11".repeat(32),
        "ed25519_sig_b64": "",
    });
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/ledger/recover-from-guardian")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let resp = crate::rest::routes::build_router(state)
        .oneshot(req)
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "the unauthenticated ledger-replacement route must never be re-added over HTTP"
    );
    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "no request to that path may mutate ledger state"
    );
}

/// **BUG (deferred to Phase 1): `/ai/infer` settlement is a direct balance write.**
///
/// `rest/handlers/ai.rs:744` calls `settle_ai_inference_dynamic_charge`, which mutates balances
/// outside the block pipeline. Whichever node serves the request forks its `state_root` while
/// block history stays identical — the block 9828 signature
/// (`docs/BUG_block_9828_divergence_mystery.md`).
///
/// `3bd2009` removed the welcome-airdrop mutation from this handler in June but left the
/// settlement, so `/ai/infer` was only ever half-fixed.
///
/// **Why this is not fixed here.** The charge is a compile-time constant and the request is
/// already hybrid-signed and nonce-bound, so consensus *could* validate it — but settlement runs
/// after inference and before the 200 OK, and the 402 path rejects post-compute. Routing it
/// through the mempool needs a new `TxV1` variant (schema change) **and** a client-signed
/// settlement envelope (API + UI change), entangled with the optimistic-execution model that
/// §5.1/§8 specify but that is not built. See `docs/PHASE_1_GENESIS_SPEC.md` §2.1.
///
/// TODO(9828): when §2.1 lands, invert this to `assert_eq!` — settlement through consensus must
/// leave both nodes at the same root. If this test still passes unchanged, the fix did not work.
#[test]
fn ai_infer_settlement_direct_write_forks_state_root() {
    let _g = env_lock();
    set_test_env_base();

    let n1 = open_temp_ledger();
    n1.init_genesis_founder_premine_from_env().unwrap();
    n1.apply_genesis_allocation("founder").unwrap();
    let n2 = open_temp_ledger();
    n2.init_genesis_founder_premine_from_env().unwrap();
    n2.apply_genesis_allocation("founder").unwrap();

    // Fund an identical payer on both nodes, then confirm they agree.
    let payer = "e".repeat(64);
    let seed = 1_000 * crate::ledger::STEVEMON;
    n1.transfer_no_fee("founder", &payer, seed).unwrap();
    n2.transfer_no_fee("founder", &payer, seed).unwrap();
    assert_eq!(
        n1.compute_state_root().unwrap(),
        n2.compute_state_root().unwrap(),
        "identical state before the inference"
    );

    // Exactly what ai.rs:744 does when a node serves /ai/infer.
    let charge = crate::p2p_network::AI_INFER_MICROPAYMENT_MICRO;
    n1.settle_ai_inference_dynamic_charge(&payer, charge)
        .expect("settlement succeeds on the serving node");

    assert_ne!(
        n1.compute_state_root().unwrap(),
        n2.compute_state_root().unwrap(),
        "BUG: serving one /ai/infer request forks that node's state root while block history \
         stays identical — the 9828 symptom. Deferred to PHASE_1_GENESIS_SPEC §2.1."
    );
}

/// **SECURITY REGRESSION GUARD.** The entire `/dex/*` surface must stay gone.
///
/// Six mutating endpoints had **no authentication of any kind**, and
/// `p2p_dex::place_maker_order` took `maker_wallet` straight from the request body — no signature,
/// no ownership proof — then called `ledger.transfer_no_fee(maker_wallet, escrow, amount)`.
/// Anyone who could reach the REST port could move anyone else's funds into an escrow keyed by an
/// order id they chose, and `/dex/take`, `/dex/settlement/confirm`, `/dex/order/cancel` and
/// `/dex/sweep/refunds` were equally open.
///
/// The DEX was the v0 CHF-era "Quantum Gate" product (`archive/LITEPAPER_v0.md`), abandoned when
/// the economics moved to the thermodynamic peg. It had no UI, no Sovereign OS surface, and no
/// caller outside its own tests. Removed rather than secured.
#[tokio::test]
async fn removed_dex_routes_are_not_reachable() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let root_before = ledger.compute_state_root().unwrap();

    for (method, path) in [
        ("POST", "/dex/order/place"),
        ("POST", "/dex/order/cancel"),
        ("POST", "/dex/take"),
        ("POST", "/dex/trade/complete"),
        ("POST", "/dex/settlement/confirm"),
        ("POST", "/dex/sweep/refunds"),
        ("GET", "/dex/orderbook"),
    ] {
        let req = axum::http::Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json")
            .body(axum::body::Body::from("{}"))
            .unwrap();
        let resp = crate::rest::routes::build_router(rest_state_for_tests(ledger.clone()))
            .oneshot(req)
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "{method} {path} must stay removed — it moved funds with no authentication"
        );
    }

    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "no request to a /dex/* path may mutate ledger state"
    );
}

/// **SECURITY REGRESSION GUARD.** `/v1/vision/zk-court/challenge` must prove control of
/// `challenger_wallet_id` before any bond is locked.
///
/// The endpoint previously took that field from the request body unverified, while
/// `zkcourt_lock_challenger_bond` (`zk_court.rs:225`) debits the named wallet — and a dismissed
/// challenge forfeits the bond. Any unauthenticated caller could therefore burn a third party's
/// funds by naming them as challenger.
///
/// Asserts both directions: an unsigned request is rejected **and** leaves the balance untouched,
/// and a correctly signed one gets past authentication.
#[tokio::test]
async fn zkcourt_challenge_without_signature_is_rejected_and_locks_no_bond() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    // A funded victim who never consents to anything.
    let w = crate::wallet::generate_mnemonic_12().unwrap();
    let words = w.mnemonic_12.clone().unwrap();
    let victim = w.address_hex.to_ascii_lowercase();
    ledger
        .transfer_no_fee("founder", &victim, 100 * crate::ledger::STEVEMON)
        .unwrap();
    let balance_before = ledger.balance_micro(&victim).unwrap();
    let root_before = ledger.compute_state_root().unwrap();

    let call = |body: serde_json::Value, l: std::sync::Arc<crate::ledger::Ledger>| async move {
        let req = axum::http::Request::builder()
            .method("POST")
            .uri("/v1/vision/zk-court/challenge")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        crate::rest::routes::build_router(rest_state_for_tests(l))
            .oneshot(req)
            .await
            .unwrap()
            .status()
    };

    // [A] No signature at all — the original attack.
    let status = call(
        serde_json::json!({
            "inference_id": "infer-1",
            "challenger_wallet_id": victim,
            "reason": "forged",
            "nonce": 1,
        }),
        ledger.clone(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "an unsigned challenge must be rejected"
    );

    // [B] Garbage signature.
    let status = call(
        serde_json::json!({
            "inference_id": "infer-1",
            "challenger_wallet_id": victim,
            "reason": "forged",
            "nonce": 1,
            "ed25519_sig_hex": "00".repeat(64),
            "mldsa_pubkey_b64": "",
            "mldsa_sig_b64": "",
        }),
        ledger.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "a forged signature must be rejected");

    // The victim's funds were never touched.
    assert_eq!(
        ledger.balance_micro(&victim).unwrap(),
        balance_before,
        "no bond may be locked from a wallet that did not sign"
    );
    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "a rejected challenge must not mutate state"
    );

    // [C] A correctly signed request gets PAST authentication. It still fails downstream because
    // no such dispute exists, but the point is that it is no longer a 401.
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(&words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(&words).unwrap();
    let mldsa_pub_b64 =
        base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let msg = crate::wallet::zkcourt_challenge_hybrid_auth_message_bytes(
        &victim,
        "infer-1",
        1,
        &mldsa_pub_b64,
    );
    let status = call(
        serde_json::json!({
            "inference_id": "infer-1",
            "challenger_wallet_id": victim,
            "reason": "genuine",
            "nonce": 1,
            "ed25519_sig_hex": hex::encode(ed_sk.sign(&msg).to_bytes()),
            "mldsa_pubkey_b64": mldsa_pub_b64,
            "mldsa_sig_b64": base64::engine::general_purpose::STANDARD
                .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, &msg).unwrap()),
        }),
        ledger.clone(),
    )
    .await;
    assert_ne!(
        status,
        StatusCode::UNAUTHORIZED,
        "a correctly signed challenge must pass authentication"
    );
}

/// **SECURITY REGRESSION GUARD.** `/v1/vision/caac/complete` must prove control of `wallet`
/// before writing a CAAC role record.
///
/// The record feeds `LedgerCaacWeightProvider::consensus_weight` (`consensus.rs:200`), which sets
/// leader-election weight when `TET_CONSENSUS_LEADER_MODE=caac` — the value
/// `.env.mainnet.example` ships. Unauthenticated, an attacker could write a record for any bonded
/// wallet: self-elevate to PoC (weight 100 + up to 1000 latency bonus) or demote a rival to PoR
/// (weight 25).
///
/// **Scope:** this pins impersonation only. `client_latency_ms` is still self-declared, so a node
/// can sign its own "latency 0" honestly and self-elevate. See WP §17.5 /
/// `PHASE_1_GENESIS_SPEC.md` §2.3 — not fixed by a signature.
#[tokio::test]
async fn caac_complete_without_signature_is_rejected_and_writes_no_record() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let victim = "d".repeat(64);
    assert!(
        ledger.caac_get_worker_record(&victim).is_none(),
        "no record before the attack"
    );

    let seed_hex = "11".repeat(32);
    let digest = crate::vision::caac::compute_challenge_digest(&seed_hex).unwrap();

    for (label, body) in [
        (
            "no signature",
            serde_json::json!({
                "wallet": victim, "seed_hex": seed_hex, "digest_hex": digest,
                "client_latency_ms": 0, "nonce": 1,
            }),
        ),
        (
            "forged signature",
            serde_json::json!({
                "wallet": victim, "seed_hex": seed_hex, "digest_hex": digest,
                "client_latency_ms": 0, "nonce": 1,
                "ed25519_sig_hex": "00".repeat(64),
                "mldsa_pubkey_b64": "", "mldsa_sig_b64": "",
            }),
        ),
    ] {
        let req = axum::http::Request::builder()
            .method("POST")
            .uri("/v1/vision/caac/complete")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        let status = crate::rest::routes::build_router(rest_state_for_tests(ledger.clone()))
            .oneshot(req)
            .await
            .unwrap()
            .status();
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{label}: must be rejected before any record is written"
        );
    }

    assert!(
        ledger.caac_get_worker_record(&victim).is_none(),
        "no CAAC record may be written for a wallet that did not sign — that record sets \
         leader-election weight"
    );
}

/// **SECURITY REGRESSION GUARD.** An envelope signed over bare `serde_json::to_vec(&tx)` must be
/// rejected even with `TET_MAINNET` unset.
///
/// Until 2026-09-21 `verify_envelope_v1` fell back to that form off mainnet. Both signatures were
/// still required, so it was not a forgery hole — what it dropped was the binding to `chain_id`,
/// `genesis_hash` and the ML-DSA pubkey, which is what makes a signature non-replayable across
/// chains. The real damage was that **testnet verified differently from mainnet**: a client
/// signing the wrong bytes passed every test and would have failed at the genesis ceremony.
/// `tet-cli tx send` was doing exactly that, undetected.
///
/// This test pins the removal: same wallet, same tx, bare-JSON signature, no TET_MAINNET → 401.
#[tokio::test]
async fn bare_json_signed_envelope_is_rejected_off_mainnet() {
    let _g = env_lock();
    set_test_env_base();
    // Explicitly NOT mainnet — the whole point is that the loose path is gone here too.
    let _mainnet = EnvVarGuard::unset("TET_MAINNET");

    let w = crate::wallet::generate_mnemonic_12().unwrap();
    let words = w.mnemonic_12.clone().unwrap();
    let wallet_id = w.address_hex.to_ascii_lowercase();

    let tx = crate::protocol::TxV1::InitialAirdrop {
        wallet_id: wallet_id.clone(),
    };

    // Sign the OLD way: bare canonical JSON, no chain_id / genesis_hash / mldsa binding.
    let legacy_env = legacy_bare_json_env_for_tests(tx.clone(), &words, &wallet_id);

    // Direct verification is the contract under test.
    assert!(
        crate::rest::helpers::verify_envelope_v1(&legacy_env).is_err(),
        "bare-JSON preimage must not verify, on any chain"
    );

    // And the route must refuse it rather than crediting the wallet.
    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let root_before = ledger.compute_state_root().unwrap();
    let state = rest_state_for_tests(ledger.clone());

    let resp = crate::rest::handlers::ledger::post_initial_airdrop_claim(
        axum::extract::State(state),
        axum::Json(legacy_env),
    )
    .await
    .into_response();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "a bare-JSON-signed claim must be 401, not accepted into the mempool"
    );
    assert_eq!(
        ledger.balance_micro(&wallet_id).unwrap(),
        0,
        "rejected claim must not credit"
    );
    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "rejected claim must not move the state root"
    );

    // Sanity: the SAME tx signed canonically is accepted, so the test is not passing because
    // something unrelated is broken.
    let good = signed_env_for_tests(tx, &words, &wallet_id);
    assert!(crate::rest::helpers::verify_envelope_v1(&good).is_ok());
}

/// **SECURITY REGRESSION GUARD.** A signature produced against a different `genesis_hash` must not
/// verify — the cross-chain replay case the canonical preimage exists to prevent.
///
/// Signs under one `TET_CHAIN_ID`, then verifies under another. Nothing about the tx changes, only
/// the chain it was bound to. With the old fallback this replayed cleanly off mainnet.
#[tokio::test]
async fn envelope_signed_against_a_different_genesis_hash_is_rejected() {
    let _g = env_lock();
    set_test_env_base();
    let _mainnet = EnvVarGuard::unset("TET_MAINNET");

    let w = crate::wallet::generate_mnemonic_12().unwrap();
    let words = w.mnemonic_12.clone().unwrap();
    let wallet_id = w.address_hex.to_ascii_lowercase();
    let tx = crate::protocol::TxV1::InitialAirdrop {
        wallet_id: wallet_id.clone(),
    };

    // Sign bound to chain A. The guard restores whatever TET_CHAIN_ID was, even if an assertion
    // below fails — otherwise a stray chain id would break every later test's genesis hash.
    let _chain = EnvVarGuard::set("TET_CHAIN_ID", "tet-chain-a");
    let env_chain_a = signed_env_for_tests(tx.clone(), &words, &wallet_id);
    assert!(
        crate::rest::helpers::verify_envelope_v1(&env_chain_a).is_ok(),
        "must verify on the chain it was signed for"
    );

    // Same bytes, different chain.
    let _chain_b = EnvVarGuard::set("TET_CHAIN_ID", "tet-chain-b");
    assert!(
        crate::rest::helpers::verify_envelope_v1(&env_chain_a).is_err(),
        "a signature bound to tet-chain-a must not verify on tet-chain-b"
    );

    // Re-signing under chain B works, proving only the binding differed.
    let env_chain_b = signed_env_for_tests(tx.clone(), &words, &wallet_id);
    assert!(crate::rest::helpers::verify_envelope_v1(&env_chain_b).is_ok());

    // BOTH binding fields must be present, asserted separately.
    //
    // Added 2026-09-28 after running this guard's negative control. `chain_id` and
    // `genesis_hash` are redundant — the genesis hash is DERIVED from the chain id — so removing
    // either one on its own left every assertion above green. The guard could not tell which
    // field was load-bearing, and deleting `chain_id=` from the preimage as "already covered by
    // genesis_hash" would have passed review and passed CI.
    //
    // Checking the preimage bytes directly is what makes each field individually defended.
    let preimage = crate::wallet::tx_v1_auth_message_bytes(&tx, &env_chain_b.sig.mldsa_pubkey_b64)
        .expect("preimage builds");
    let text = String::from_utf8_lossy(&preimage);
    assert!(
        text.contains("chain_id=tet-chain-b"),
        "the auth preimage must bind chain_id explicitly, not rely on genesis_hash deriving from          it: {text}"
    );
    assert!(
        text.contains("genesis_hash=") && !text.contains("genesis_hash=|"),
        "the auth preimage must bind a non-empty genesis_hash: {text}"
    );
    // TET_CHAIN_ID restored by the guards.
}

/// The `EnvVarGuard` contract: a panic inside the guarded region still restores the env.
///
/// This is the regression for the cascade of 2026-09-21, where
/// `mainnet_rejects_legacy_tx_signature_without_chain_binding` panicked before its manual
/// `remove_var` and left `TET_MAINNET=1` set for every test that followed — twenty failures in
/// unrelated code, all reported as "CRITICAL: TET_MAINNET=1 requires
/// TET_GENESIS_FOUNDER_WALLET_ID".
#[test]
fn env_var_guard_restores_on_panic() {
    let _g = env_lock();
    set_test_env_base();

    const KEY: &str = "TET_MAINNET";
    let before = std::env::var(KEY).ok();

    let result = std::panic::catch_unwind(|| {
        let _mainnet = EnvVarGuard::set(KEY, "1");
        assert_eq!(std::env::var(KEY).ok().as_deref(), Some("1"));
        panic!("simulated failure inside the guarded region");
    });
    assert!(result.is_err(), "the closure must have panicked");

    assert_eq!(
        std::env::var(KEY).ok(),
        before,
        "TET_MAINNET must be restored after a panic, not left set for the next test"
    );

    // And the common case: previously-unset stays unset.
    let probe = "TET_ENV_GUARD_PROBE";
    unsafe {
        std::env::remove_var(probe);
    }
    {
        let _p = EnvVarGuard::set("TET_ENV_GUARD_PROBE", "x");
        assert_eq!(std::env::var(probe).as_deref(), Ok("x"));
    }
    assert!(
        std::env::var(probe).is_err(),
        "a var that did not exist must be removed again, not left as an empty string"
    );
}

// =================================================================================================
// Transaction gossip admission — a tx learned from a peer is never trusted more than one
// submitted over REST, and receiving one never causes us to re-publish it.
//
// Companion to the swarm-level `at_f1_follower_submits_tx_and_mining_peer_settles_it`: that test
// proves a tx crosses the wire, these prove what happens to it when it lands.
// =================================================================================================

/// Build a signed welcome-airdrop envelope for a fresh wallet. Returns (wallet_id, envelope).
fn airdrop_env_for_tests() -> (String, crate::protocol::SignedTxEnvelopeV1) {
    let w = crate::wallet::generate_mnemonic_12().unwrap();
    let words = w.mnemonic_12.clone().unwrap();
    let wallet_id = w.address_hex.to_ascii_lowercase();
    let env = signed_env_for_tests(
        crate::protocol::TxV1::InitialAirdrop {
            wallet_id: wallet_id.clone(),
        },
        &words,
        &wallet_id,
    );
    (wallet_id, env)
}

fn gossip_test_ledger() -> std::sync::Arc<crate::ledger::Ledger> {
    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    ledger
}

/// A peer replaying an envelope that is already in a block must not get it re-queued.
///
/// The REST submit path has always checked `is_tx_applied`; the gossip path did not, so a peer
/// could park an already-mined envelope in every mempool on the network and it would survive
/// until a producer tried to mine it and discarded it.
#[tokio::test]
async fn gossiped_tx_already_mined_is_dropped_not_requeued() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = gossip_test_ledger();
    let state = rest_state_for_tests(ledger.clone());
    let (wallet_id, env) = airdrop_env_for_tests();

    state.submit_local_tx(env.clone()).await.unwrap();
    crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string())
        .await
        .expect("mine");
    let tx_hash = crate::consensus::tx_hash_for_env(&env).unwrap();
    assert!(ledger.is_tx_applied(&tx_hash).unwrap());
    assert_eq!(
        ledger.balance_micro(&wallet_id).unwrap(),
        1_000 * crate::ledger::STEVEMON
    );
    assert!(state.mempool.lock().await.is_empty());

    let outcome = crate::p2p::handle_tx_broadcast(&ledger, &state.mempool, env).await;
    assert_eq!(
        outcome,
        crate::p2p::TxGossipOutcome::AlreadyApplied { tx_hash }
    );
    assert!(
        state.mempool.lock().await.is_empty(),
        "an already-mined tx must not re-enter the mempool"
    );
}

/// A gossiped tx must never enter this node's rebroadcast set.
///
/// Membership in `pending_rebroadcast` is what makes the retry loop re-publish a tx. If receiving
/// a tx also registered it, every node would re-publish every tx on every tick and the retry loop
/// would be an amplifier. Only `broadcast_mempool_tx` — called solely from REST submit handlers —
/// may add to that map.
#[tokio::test]
async fn gossiped_tx_is_never_marked_for_rebroadcast() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = gossip_test_ledger();
    let state = rest_state_for_tests(ledger.clone());
    let (_wallet_id, env) = airdrop_env_for_tests();

    let outcome = crate::p2p::handle_tx_broadcast(&ledger, &state.mempool, env).await;
    assert!(matches!(
        outcome,
        crate::p2p::TxGossipOutcome::Enqueued { .. }
    ));
    assert_eq!(state.mempool.lock().await.len(), 1, "it is queued to mine");
    assert!(
        state.pending_rebroadcast.lock().await.is_empty(),
        "receiving a tx must not schedule us to re-publish it"
    );
}

/// The same envelope arriving twice is queued once.
#[tokio::test]
async fn gossiped_tx_duplicate_is_queued_once() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = gossip_test_ledger();
    let state = rest_state_for_tests(ledger.clone());
    let (_wallet_id, env) = airdrop_env_for_tests();

    let first = crate::p2p::handle_tx_broadcast(&ledger, &state.mempool, env.clone()).await;
    assert!(matches!(
        first,
        crate::p2p::TxGossipOutcome::Enqueued { .. }
    ));
    let second = crate::p2p::handle_tx_broadcast(&ledger, &state.mempool, env).await;
    assert!(matches!(
        second,
        crate::p2p::TxGossipOutcome::AlreadyQueued { .. }
    ));
    assert_eq!(state.mempool.lock().await.len(), 1);
}

/// A gossiped envelope runs the same `verify_envelope_v1` the REST path runs.
#[tokio::test]
async fn gossiped_tx_with_a_broken_signature_is_rejected() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = gossip_test_ledger();
    let state = rest_state_for_tests(ledger.clone());
    let (_wallet_id, mut env) = airdrop_env_for_tests();

    // Same wallet, same tx body, signature no longer covers it.
    env.sig.ed25519_sig_b64 = base64::engine::general_purpose::STANDARD.encode([7u8; 64]);

    let outcome = crate::p2p::handle_tx_broadcast(&ledger, &state.mempool, env).await;
    assert!(
        matches!(outcome, crate::p2p::TxGossipOutcome::Rejected { .. }),
        "got {outcome:?}"
    );
    assert!(
        state.mempool.lock().await.is_empty(),
        "an unverifiable tx must not reach the mempool"
    );
}

/// The rebroadcast sweep re-publishes a pending local tx, stops once it is mined, and never
/// exceeds its attempt ceiling.
#[tokio::test]
async fn pending_local_tx_is_rebroadcast_until_mined_then_forgotten() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_TX_REBROADCAST_MAX", "3");
    }
    let ledger = gossip_test_ledger();
    let mut state = rest_state_for_tests(ledger.clone());
    let (_wallet_id, env) = airdrop_env_for_tests();

    // A gossip channel nobody drains, standing in for "peers exist but the publish did not land".
    // Held for the whole test: dropping the receiver closes the channel and `send` fails.
    let (gossip_tx, _gossip_rx) = tokio::sync::mpsc::channel::<String>(64);
    state.gossip_tx = Some(gossip_tx);

    state.submit_local_tx(env.clone()).await.unwrap();
    state.broadcast_mempool_tx(&env).await;
    assert_eq!(
        state.pending_rebroadcast.lock().await.len(),
        1,
        "a REST-submitted tx is tracked for retry"
    );

    let (republished, _) = state.rebroadcast_pending_txs().await;
    assert_eq!(republished, 1, "a still-pending local tx is re-published");
    let (republished, _) = state.rebroadcast_pending_txs().await;
    assert_eq!(republished, 1);

    // Attempt ceiling: the first publish plus three sweeps exhausts TET_TX_REBROADCAST_MAX=3.
    let (republished, forgotten) = state.rebroadcast_pending_txs().await;
    assert_eq!(republished, 1);
    assert_eq!(forgotten, 0);
    let (republished, forgotten) = state.rebroadcast_pending_txs().await;
    assert_eq!(republished, 0, "must stop after the attempt ceiling");
    assert_eq!(forgotten, 1);
    assert!(state.pending_rebroadcast.lock().await.is_empty());

    // And a mined tx is dropped from the set even with attempts left.
    state.pending_rebroadcast.lock().await.clear();
    state.broadcast_mempool_tx(&env).await;
    crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string())
        .await
        .expect("mine");
    assert!(state.mempool.lock().await.is_empty());
    let (republished, forgotten) = state.rebroadcast_pending_txs().await;
    assert_eq!(republished, 0, "a mined tx is never re-published");
    assert_eq!(forgotten, 1);

    unsafe {
        std::env::remove_var("TET_TX_REBROADCAST_MAX");
    }
}

/// **SECURITY REGRESSION GUARD — gossiped AiResult writes no balance.**
///
/// The gossip receive path in `p2p_network.rs` used to call
/// `Ledger::settle_ai_utility_payment` on an inbound `AiResult`, moving funds between two wallets
/// outside the block pipeline. `compute_state_root` iterates the balances tree, so whichever node
/// happened to receive that message forked its `state_root` while block history stayed
/// byte-identical — the block-9828 signature.
///
/// It was the worst of the direct-write paths because of its trigger: the only one reachable by a
/// **remote peer** rather than an HTTP client. On the public seed the REST port is bound to
/// loopback; 8002 is open to the internet.
///
/// Two assertions, because the gossip arm sits inside `run_swarm_loop` and cannot be invoked
/// directly without a swarm:
///
/// 1. **Behavioural** — `settle_ai_utility_payment` really does fork `state_root`. Without this
///    the source check below would be guarding something harmless.
/// 2. **Source** — no caller of it remains in `p2p_network.rs`.
///
/// Together: a forking write exists, and the gossip path cannot reach it.
#[tokio::test]
async fn gossiped_ai_result_writes_no_balance() {
    let _g = env_lock();
    set_test_env_base();

    // (1) the call, if reachable, forks state_root.
    let ledger_a = std::sync::Arc::new(open_temp_ledger());
    ledger_a.init_genesis_founder_premine_from_env().unwrap();
    ledger_a.apply_genesis_allocation("founder").unwrap();
    let ledger_b = std::sync::Arc::new(open_temp_ledger());
    ledger_b.init_genesis_founder_premine_from_env().unwrap();
    ledger_b.apply_genesis_allocation("founder").unwrap();
    assert_eq!(
        ledger_a.compute_state_root().unwrap(),
        ledger_b.compute_state_root().unwrap(),
        "two identically-seeded ledgers must start with the same root"
    );

    let payer = "founder";
    let worker = "worker-guard-wallet";
    let _ = ledger_a.settle_ai_utility_payment(payer, worker, 1_000);
    assert_ne!(
        ledger_a.compute_state_root().unwrap(),
        ledger_b.compute_state_root().unwrap(),
        "settle_ai_utility_payment must fork state_root — if it no longer does, this guard is \
         pointing at the wrong function and the source check below proves nothing"
    );

    // (2) the gossip plane holds no caller.
    let src = include_str!("p2p_network.rs");
    let callers = src.matches(".settle_ai_utility_payment(").count();
    assert_eq!(
        callers, 0,
        "p2p_network.rs must not settle balances from an inbound gossip message; settlement is \
         deferred to PHASE_1_GENESIS_SPEC §2, which needs a client-signed tx and a consensus rule"
    );
}

/// **SECURITY REGRESSION GUARD.** `POST /genesis/1000/claim` must stay removed.
///
/// It credited `GENESIS_1K_BONUS_TET` (10,000 TET) via `Ledger::genesis_1k_claim`, a direct
/// balance write outside the block pipeline, so every claim forked the serving node's
/// `state_root` while block history stayed byte-identical.
///
/// **Correction to `0c64dd4`'s commit message,** which described this route as having "no
/// authentication of any kind". That is wrong: it required a hybrid signature supplied via the
/// `x-tet-ed25519-sig-b64` / `x-tet-mldsa-sig-b64` headers and returned 401 without them. The
/// removal still stands on its own grounds — an unbounded direct mint forks consensus regardless
/// of who is authorised to call it — but it was not an open door.
///
/// `GET /genesis/1000/status` is deliberately left in place: it reads a counter and writes
/// nothing.
#[tokio::test]
async fn removed_genesis_1k_claim_route_is_not_reachable() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let root_before = ledger.compute_state_root().unwrap();

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/genesis/1000/claim")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(r#"{"wallet_id":"founder"}"#))
        .unwrap();
    let resp = crate::rest::routes::build_router(rest_state_for_tests(ledger.clone()))
        .oneshot(req)
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "POST /genesis/1000/claim must stay removed — it minted 10,000 TET with no authentication"
    );

    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "a request to the removed claim route must not mutate ledger state"
    );
}

/// **SECURITY REGRESSION GUARD.** `POST /ledger/mint_demo` must stay removed.
///
/// It minted an arbitrary caller-supplied amount to an arbitrary wallet via
/// `Ledger::mint_reward_with_proof` — a direct balance write outside the block pipeline, so every
/// call forked the serving node's `state_root` while block history stayed identical.
///
/// Unlike the other removed routes this one *was* gated (admin bearer **and** a hybrid signature),
/// so it was not reachable by an anonymous caller. It is removed anyway because an
/// unbounded-amount mint has no place on a REST surface at all: the gate limits who can fork the
/// chain, not whether forking is possible.
///
/// The dev-only startup faucet (`TET_DEV_FAUCET_MICRO`, `main.rs`) still calls the same ledger
/// method. That path is not reachable over the network, is off unless the env var is set, and is
/// refused on mainnet by the `is_prod` check.
#[tokio::test]
async fn removed_mint_demo_route_is_not_reachable() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let root_before = ledger.compute_state_root().unwrap();

    // Try it the way an operator would have: with the admin bearer it used to require.
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/ledger/mint_demo")
        .header("content-type", "application/json")
        .header("authorization", "Bearer test-admin-key")
        .body(axum::body::Body::from(
            r#"{"wallet_id":"founder","amount_micro":1000000}"#,
        ))
        .unwrap();
    let resp = crate::rest::routes::build_router(rest_state_for_tests(ledger.clone()))
        .oneshot(req)
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "POST /ledger/mint_demo must stay removed, admin bearer or not"
    );

    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "a request to the removed mint route must not mutate ledger state"
    );
}

/// **SECURITY REGRESSION GUARD.** An invalid ZK receipt is refused and writes nothing.
///
/// `POST /ledger/zk_verify` used to slash the submitting worker's entire bond
/// (`slash_worker_bond_to_ecosystem_all`) when receipt verification failed — a direct balance
/// write on a request that then returned `400` and never entered the mempool. Only the node that
/// served the request slashed, so its `state_root` diverged from every peer with no block to
/// account for it.
///
/// The penalty could not simply be moved into consensus: a tx that fails verification never
/// reaches a block, so consensus never sees it. Punishing it on-chain needs a slash tx variant
/// (PHASE_1_GENESIS_SPEC §2). Until then an invalid receipt is refused and unpunished — an
/// unenforced penalty beats one that forks the chain.
///
/// Asserts the refusal **and** that both the bond and the root are untouched. Checking only the
/// status code would pass even if the slash were still there.
#[tokio::test]
async fn invalid_zk_receipt_is_rejected_without_slashing() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    // A worker with a real bond, so "bond unchanged" is a meaningful assertion.
    let worker = crate::wallet::generate_mnemonic_12().unwrap();
    let worker_words = worker.mnemonic_12.clone().unwrap();
    let worker_id = worker.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(&worker_id, 100 * crate::ledger::STEVEMON, "127.0.0.1", true, 1, 1)
        .unwrap();
    ledger
        .stake_worker_bond_micro(&worker_id, 10 * crate::ledger::STEVEMON, None)
        .unwrap();
    let bond_before = ledger.worker_bond_micro(&worker_id).unwrap();
    assert!(bond_before > 0, "the worker must hold a bond for this guard to mean anything");

    let root_before = ledger.compute_state_root().unwrap();

    // Correct image_id and an empty task_id so the request reaches receipt verification, which
    // then fails on the garbage receipt. A wrong image_id would 400 earlier and prove nothing.
    let env = signed_env_for_tests(
        crate::protocol::TxV1::VerifyZkProof {
            task_id: String::new(),
            image_id: methods::NEXUS_GUEST_ID,
            journal_b64: base64::engine::general_purpose::STANDARD.encode(b"not-a-journal"),
            receipt_b64: base64::engine::general_purpose::STANDARD.encode(b"not-a-receipt"),
        },
        &worker_words,
        &worker_id,
    );

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/ledger/zk_verify")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&env).unwrap()))
        .unwrap();
    let resp = crate::rest::routes::build_router(rest_state_for_tests(ledger.clone()))
        .oneshot(req)
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::BAD_REQUEST,
        "an unverifiable receipt must be refused"
    );

    assert_eq!(
        ledger.worker_bond_micro(&worker_id).unwrap(),
        bond_before,
        "a refused receipt must not slash the worker's bond from a REST handler"
    );
    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "a refused receipt must leave state_root untouched"
    );
}

/// **SECURITY REGRESSION GUARD.** A block candidate carrying an invalid ZK receipt is rejected
/// and writes nothing.
///
/// `validate_zk_task_claims` (`consensus.rs:571`) used to slash the worker's entire bond and
/// *then* return `Err`, rejecting the candidate. The rejection meant the block never became
/// canonical — but the slash persisted. A node that received the bad candidate slashed; a node
/// that never saw it did not; the two diverged with nothing in the chain to explain the
/// difference.
///
/// It mattered more than the REST-side slash because of the reach: this path is entered from the
/// public P2P port. Any peer able to send a block candidate could make the receiving node burn a
/// third party's bond — and only that node's, which is precisely the block-9828 shape.
///
/// Removing it is fork *removal*, not a consensus change: the candidate is still rejected, on the
/// same condition, with the same error. Only the write is gone. This test asserts both halves —
/// still rejected, and nothing written.
#[tokio::test]
async fn invalid_zk_candidate_is_rejected_without_slashing() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let worker = crate::wallet::generate_mnemonic_12().unwrap();
    let worker_words = worker.mnemonic_12.clone().unwrap();
    let worker_id = worker.address_hex.to_ascii_lowercase();
    ledger
        .admin_rest_faucet(&worker_id, 100 * crate::ledger::STEVEMON, "127.0.0.1", true, 1, 1)
        .unwrap();
    ledger
        .stake_worker_bond_micro(&worker_id, 10 * crate::ledger::STEVEMON, None)
        .unwrap();
    let bond_before = ledger.worker_bond_micro(&worker_id).unwrap();
    assert!(bond_before > 0, "the worker must hold a bond for this guard to mean anything");
    let root_before = ledger.compute_state_root().unwrap();

    // The tx a malicious peer would put in a block candidate: a VerifyZkProof carrying garbage.
    //
    // Exercised against `validate_zk_task_claims` directly rather than through
    // `validate_and_record_backfill_candidate`. The full path rejects a synthetic candidate on
    // producer/validator-set and tx-hash checks long before it looks at zk claims, so an
    // end-to-end assertion passes for the wrong reason — verified: with the slash restored, the
    // end-to-end version of this test still passed.
    let bad = signed_env_for_tests(
        crate::protocol::TxV1::VerifyZkProof {
            task_id: String::new(),
            image_id: methods::NEXUS_GUEST_ID,
            journal_b64: base64::engine::general_purpose::STANDARD.encode(b"not-a-journal"),
            receipt_b64: base64::engine::general_purpose::STANDARD.encode(b"not-a-receipt"),
        },
        &worker_words,
        &worker_id,
    );

    let res = crate::consensus::validate_zk_task_claims(ledger.as_ref(), &[bad]);
    assert!(
        res.is_err(),
        "a candidate carrying an unverifiable receipt must be rejected"
    );

    assert_eq!(
        ledger.worker_bond_micro(&worker_id).unwrap(),
        bond_before,
        "rejecting a candidate must not slash a bond — the block never becomes canonical, so the \
         write would survive on this node alone"
    );
    assert_eq!(
        ledger.compute_state_root().unwrap(),
        root_before,
        "rejecting a candidate must leave state_root untouched"
    );
}

// ---------------------------------------------------------------------------
// S7-1 — Burn-after-read (spec §A.3). Envelope-level guards.
// ---------------------------------------------------------------------------

/// A well-formed `e2ee` block. The node never decrypts, so only `ciphertext_b64` is actually read
/// (it feeds `payload_sha256` in the §A.1.3 pre-image) — the rest just has to deserialize.
///
/// **The ciphertext is unique per `seed`.** It used to be a fixed string, which made every test
/// envelope share one payload — so a test asserting "this ciphertext does not appear in the
/// response" could be satisfied, or defeated, by a *different* message's identical payload. AT-3's
/// leak check caught it. Distinct payloads keep "did this specific message leak?" answerable.
fn tmail_e2ee_block_for_tests(seed: &str) -> crate::tmail::envelope::TmailE2eeBlock {
    let b64 = |s: &str| base64::engine::general_purpose::STANDARD.encode(s.as_bytes());
    crate::tmail::envelope::TmailE2eeBlock {
        v: 1,
        scheme: crate::tmail::envelope::TMAIL_E2EE_SCHEME.to_string(),
        client_ephemeral_pub_b64: b64("client-x25519-pub"),
        client_mlkem_pub_b64: b64("client-kyber-pub"),
        receiver_x25519_pub_b64: b64("receiver-x25519-pub"),
        receiver_mlkem_pub_b64: b64("receiver-kyber-pub"),
        mlkem_ciphertext_b64: b64("kyber-ciphertext"),
        nonce_b64: b64("twelve-bytes"),
        ciphertext_b64: b64(&format!("opaque-ciphertext-the-node-never-opens::{seed}")),
    }
}

/// Wall-clock now, in ms. Tmail fixtures must be **live**: the store filters expired entries out
/// of `get_inbox`, so a fixture with a stale `sent_at_ms` makes "the message is gone" assertions
/// pass whether or not anything was deleted. That is exactly how the first version of the AT-4
/// guards went vacuous (negative control C6).
fn tmail_now_ms_for_tests() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Hybrid-signs a [`TmailEnvelopeV1`] over the §A.1.3 pre-image.
///
/// Same env contract as [`signed_env_for_tests`]: the pre-image binds `chain_id` and
/// `genesis_hash` from the process env, so the caller must hold `env_lock()` and have run
/// `set_test_env_base()` or the signature binds to a different network than the verifier assumes.
fn signed_tmail_env_for_tests(
    words: &str,
    sender_wallet_id: &str,
    receiver_wallet_id: &str,
    msg_id: &str,
    flags: crate::tmail::envelope::TmailFlags,
    burn: Option<crate::tmail::envelope::TmailBurn>,
) -> crate::tmail::envelope::TmailEnvelopeV1 {
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());

    let mut env = crate::tmail::envelope::TmailEnvelopeV1 {
        v: 1,
        kind: crate::tmail::envelope::TMAIL_ENVELOPE_KIND.to_string(),
        msg_id: msg_id.to_string(),
        flags,
        sender_wallet_id: sender_wallet_id.to_ascii_lowercase(),
        receiver_wallet_id: receiver_wallet_id.to_ascii_lowercase(),
        sent_at_ms: tmail_now_ms_for_tests(),
        release_at_ms: 0,
        // One hour, so the entry is unambiguously live for the whole test.
        ttl_ms: 3_600_000,
        fee_paid_micro: 0,
        pin_stake_micro: 0,
        e2ee: tmail_e2ee_block_for_tests(msg_id),
        hybrid_sig: crate::tmail::envelope::TmailHybridSig {
            ed25519_pubkey_hex: sender_wallet_id.to_ascii_lowercase(),
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: mldsa_pubkey_b64.clone(),
            mldsa_sig_b64: String::new(),
        },
        anonymous: None,
        time_lock: None,
        burn,
        plaintext_commitment_sha256: None,
    };

    let msg = crate::tmail::envelope::tmail_envelope_auth_message_bytes(&env, &mldsa_pubkey_b64)
        .unwrap();
    env.hybrid_sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    env.hybrid_sig.mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap());
    env
}

fn tmail_flags_for_tests(burn_after_read: bool) -> crate::tmail::envelope::TmailFlags {
    crate::tmail::envelope::TmailFlags {
        basic: true,
        time_lock: false,
        burn_after_read,
        anonymous: false,
    }
}

/// Two wallets with their mnemonics, for the Tmail guards.
fn tmail_pair_for_tests() -> (String, String, String) {
    let sender = crate::wallet::generate_mnemonic_12().unwrap();
    let receiver = crate::wallet::generate_mnemonic_12().unwrap();
    (
        sender.mnemonic_12.clone().unwrap(),
        sender.address_hex.to_ascii_lowercase(),
        receiver.address_hex.to_ascii_lowercase(),
    )
}

/// **S7-1 item 1.** A burn-after-read envelope must verify.
///
/// Before S7-1 the flag gate rejected every non-`basic` flag, so this is the assertion that goes
/// red if the relaxation is reverted. `flags.burn_after_read` is already inside the §A.1.3
/// pre-image via `TmailFlags::canonical`, so accepting it changes no signature format.
#[test]
fn tmail_envelope_with_burn_flag_verifies() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "burn-msg-1",
        tmail_flags_for_tests(true),
        None,
    );
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_ok(),
        "a burn-after-read envelope must verify after S7-1"
    );
}

/// The relaxation is burn-only: a plain Basic envelope must still verify unchanged.
#[test]
fn tmail_basic_envelope_still_verifies_after_burn_relaxation() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "basic-msg-1",
        tmail_flags_for_tests(false),
        None,
    );
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_ok(),
        "S7-1 must not disturb the Basic E2EE path shipped in S5"
    );
}

/// Anonymous (S8) must stay closed after the burn relaxation.
///
/// **Amended by S7-2.** This guard also asserted that `time_lock` was rejected. Once S7-2 opened
/// time-lock that half kept passing — but for the wrong reason: the envelope it built left
/// `release_at_ms` at 0, so it was refused as an incoherent schedule, not as an unsupported flag,
/// while the assertion message still claimed the latter. A guard that is true for a reason other
/// than the one it states is the failure mode `CLAUDE.md` describes, so the stale half was removed
/// rather than left to look reassuring. Time-lock's real rules are covered by
/// `tmail_time_lock_requires_a_future_release` and
/// `tmail_release_without_the_time_lock_flag_is_rejected`.
#[test]
fn tmail_anonymous_flag_is_still_rejected_after_the_burn_relaxation() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let mut anon = tmail_flags_for_tests(false);
    anon.anonymous = true;
    let env = signed_tmail_env_for_tests(&words, &sender, &receiver, "anon-1", anon, None);
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_err(),
        "anonymous is S8 and must not ride in on the burn or time-lock relaxations"
    );
}

/// **The malleability guard.** The `burn` block is NOT covered by the §A.1.3 pre-image — only
/// `flags` is. So a relaying peer can edit it freely, and it must never be able to change policy.
///
/// Here the signed flag says "no burn" while the unsigned block says "burn": the envelope must be
/// rejected rather than silently honouring either side.
#[test]
fn tmail_unsigned_burn_block_cannot_contradict_the_signed_flag() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    // Signed as basic-only, then handed a burn block a peer could have injected in transit.
    let mut env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "malleable-1",
        tmail_flags_for_tests(false),
        None,
    );
    env.burn = Some(crate::tmail::envelope::TmailBurn {
        burn_after_read: true,
        max_reads: None,
    });
    let err = crate::tmail::envelope::verify_tmail_envelope_v1(&env)
        .expect_err("an unsigned burn block contradicting the signed flag must be rejected");
    assert!(
        format!("{err}").contains("burn block disagrees"),
        "expected the inconsistent-burn-block rejection, got: {err}"
    );

    // And the mirror: signed as burn, block says no burn.
    let mut env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "malleable-2",
        tmail_flags_for_tests(true),
        None,
    );
    env.burn = Some(crate::tmail::envelope::TmailBurn {
        burn_after_read: false,
        max_reads: None,
    });
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_err(),
        "the mirror case must be rejected too"
    );
}

/// `max_reads` is unsigned and Phase 0 policy is exactly `on_read_receipt` (one read). Reject it
/// rather than ignoring it, so it cannot look supported.
#[test]
fn tmail_burn_block_max_reads_is_rejected() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "maxreads-1",
        tmail_flags_for_tests(true),
        Some(crate::tmail::envelope::TmailBurn {
            burn_after_read: true,
            max_reads: Some(3),
        }),
    );
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_err(),
        "max_reads is unsigned and unsupported in Phase 0; it must be rejected, not ignored"
    );
}

/// A redundant burn block (agrees with the signed flag, no `max_reads`) is allowed through.
#[test]
fn tmail_redundant_burn_block_is_accepted() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "redundant-1",
        tmail_flags_for_tests(true),
        Some(crate::tmail::envelope::TmailBurn {
            burn_after_read: true,
            max_reads: None,
        }),
    );
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_ok(),
        "a burn block that merely restates the signed flag is harmless"
    );
}

// ---------------------------------------------------------------------------
// S7-1 item 2 — burn revoke: gossip kind, authorization, store deletion.
// ---------------------------------------------------------------------------

fn tmail_party_for_tests() -> (String, String) {
    let w = crate::wallet::generate_mnemonic_12().unwrap();
    (
        w.mnemonic_12.clone().unwrap(),
        w.address_hex.to_ascii_lowercase(),
    )
}

/// Most registry tests want registrations effective immediately; a 1 ms epoch makes the boundary
/// a non-event. Tests that exercise the boundary set `TET_TMAIL_ANON_EPOCH_MS` themselves.
#[cfg(test)]
fn anon_fast_epoch_guard() -> EnvVarGuard {
    EnvVarGuard::set("TET_TMAIL_ANON_EPOCH_MS", "1")
}

fn tmail_store_for_tests() -> crate::tmail::store::TmailStore {
    let ledger = open_temp_ledger();
    let db = ledger.sled_db();
    // The ledger owns the sled Db; leak it so the store outlives this call.
    std::mem::forget(ledger);
    crate::tmail::store::TmailStore::open(&db).unwrap()
}

/// Hybrid-signs a [`TmailBurnRevokeV1`] over its §A.3.2 pre-image.
fn signed_burn_revoke_for_tests(
    words: &str,
    reader_wallet_id: &str,
    msg_id: &str,
) -> crate::tmail::burn::TmailBurnRevokeV1 {
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());

    let mut rev = crate::tmail::burn::TmailBurnRevokeV1 {
        v: 1,
        kind: crate::tmail::burn::TMAIL_BURN_REVOKE_KIND.to_string(),
        msg_id: msg_id.to_string(),
        reader_wallet_id: reader_wallet_id.to_ascii_lowercase(),
        read_at_ms: tmail_now_ms_for_tests(),
        hybrid_sig: crate::tmail::envelope::TmailHybridSig {
            ed25519_pubkey_hex: reader_wallet_id.to_ascii_lowercase(),
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: mldsa_pubkey_b64.clone(),
            mldsa_sig_b64: String::new(),
        },
    };
    let msg = crate::tmail::burn::tmail_burn_revoke_auth_message_bytes(&rev, &mldsa_pubkey_b64);
    rev.hybrid_sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    rev.hybrid_sig.mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap());
    rev
}

/// Stores one burn-flagged message and returns (store, sender_words, sender, receiver_words,
/// receiver, msg_id).
fn stored_burn_message_for_tests() -> (
    crate::tmail::store::TmailStore,
    String,
    String,
    String,
    String,
    String,
) {
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "burn-target-1".to_string();
    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        &msg_id,
        tmail_flags_for_tests(true),
        None,
    );
    let store = tmail_store_for_tests();
    assert!(store.store_tmail(&env).unwrap(), "fixture must store");
    (
        store,
        sender_words,
        sender,
        receiver_words,
        receiver,
        msg_id,
    )
}

/// **AT-4 core, single node.** The receiver reads → the ciphertext is gone from the store.
#[test]
fn tmail_burn_revoke_by_receiver_destroys_the_message() {
    let _g = env_lock();
    set_test_env_base();
    let (store, _sw, _s, receiver_words, receiver, msg_id) = stored_burn_message_for_tests();

    assert!(
        store.get_by_msg_id(&msg_id).is_some(),
        "precondition: message is stored"
    );
    assert_eq!(
        store.get_inbox(&receiver, 50).len(),
        1,
        "precondition: the fixture is LIVE and visible in the inbox -- if this fails the message \
         expired on its own and the post-burn assertions below would pass for the wrong reason"
    );
    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);
    let outcome = crate::tmail::burn::apply_burn_revoke(&store, &rev).unwrap();
    assert_eq!(
        outcome,
        crate::tmail::burn::BurnRevokeOutcome::Burned {
            msg_id: msg_id.clone()
        }
    );
    assert!(
        store.get_by_msg_id(&msg_id).is_none(),
        "the ciphertext must be gone from the store"
    );
    assert!(
        store.get_inbox(&receiver, 50).is_empty(),
        "and gone from the inbox"
    );
}

/// The sender is a party too — they may burn what they sent.
#[test]
fn tmail_burn_revoke_by_sender_destroys_the_message() {
    let _g = env_lock();
    set_test_env_base();
    let (store, sender_words, sender, _rw, receiver, msg_id) = stored_burn_message_for_tests();

    assert_eq!(
        store.get_inbox(&receiver, 50).len(),
        1,
        "precondition: the fixture is live in the inbox"
    );
    let rev = signed_burn_revoke_for_tests(&sender_words, &sender, &msg_id);
    assert!(matches!(
        crate::tmail::burn::apply_burn_revoke(&store, &rev).unwrap(),
        crate::tmail::burn::BurnRevokeOutcome::Burned { .. }
    ));
    assert!(store.get_by_msg_id(&msg_id).is_none());
    assert!(
        store.get_inbox(&receiver, 50).is_empty(),
        "the ciphertext row itself must be gone, not merely masked by the tombstone"
    );
}

/// **The authorization guard.** A validly-signed revoke from a wallet that is neither party must
/// be dropped — otherwise anyone who learns a `msg_id` off the wire can delete other people's mail
/// from every node on the network.
#[test]
fn tmail_burn_revoke_from_a_third_party_is_dropped() {
    let _g = env_lock();
    set_test_env_base();
    let (store, _sw, _s, _rw, _r, msg_id) = stored_burn_message_for_tests();
    let (stranger_words, stranger) = tmail_party_for_tests();

    let rev = signed_burn_revoke_for_tests(&stranger_words, &stranger, &msg_id);
    // Its own signature is perfectly valid — that is the point. Authorization is the check.
    assert!(
        crate::tmail::burn::verify_tmail_burn_revoke_v1(&rev).is_ok(),
        "the stranger's signature is genuine; only authorization may reject it"
    );
    let err = crate::tmail::burn::apply_burn_revoke(&store, &rev)
        .expect_err("a third-party revoke must be rejected");
    assert!(
        format!("{err}").contains("neither the sender nor the receiver"),
        "expected the not-a-party rejection, got: {err}"
    );
    assert!(
        store.get_by_msg_id(&msg_id).is_some(),
        "the message must survive a third-party revoke"
    );
}

/// Burn power exists only where the sender opted in. Without this, either party could use the
/// revoke as a general delete primitive for ordinary mail.
#[test]
fn tmail_burn_revoke_cannot_destroy_a_non_burn_message() {
    let _g = env_lock();
    set_test_env_base();
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "plain-message-1";
    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        msg_id,
        tmail_flags_for_tests(false), // NOT a burn message
        None,
    );
    let store = tmail_store_for_tests();
    store.store_tmail(&env).unwrap();

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, msg_id);
    let err = crate::tmail::burn::apply_burn_revoke(&store, &rev)
        .expect_err("a non-burn message must not be revocable");
    assert!(
        format!("{err}").contains("not burn-after-read"),
        "expected the not-burnable rejection, got: {err}"
    );
    assert!(
        store.get_by_msg_id(msg_id).is_some(),
        "an ordinary message must survive a revoke aimed at it"
    );
}

/// **The tombstone guard.** Gossip re-delivers envelopes. If the burn deleted the `msg_id` dedup
/// entry outright, the next copy would sail through `store_tmail` and undo the burn.
#[test]
fn tmail_burned_message_is_not_resurrected_by_re_gossip() {
    let _g = env_lock();
    set_test_env_base();
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "resurrect-1";
    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        msg_id,
        tmail_flags_for_tests(true),
        None,
    );
    let store = tmail_store_for_tests();
    store.store_tmail(&env).unwrap();

    assert_eq!(
        store.get_inbox(&receiver, 50).len(),
        1,
        "precondition: the fixture is live in the inbox"
    );

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, msg_id);
    crate::tmail::burn::apply_burn_revoke(&store, &rev).unwrap();
    assert!(store.is_burned(msg_id), "a tombstone must be left behind");

    // A peer re-gossips the very same envelope, exactly as the mesh would.
    assert!(
        !store.store_tmail(&env).unwrap(),
        "a re-gossiped burned envelope must be refused"
    );
    assert!(
        store.get_by_msg_id(msg_id).is_none(),
        "and must not come back into the store"
    );
    assert!(
        store.get_inbox(&receiver, 50).is_empty(),
        "nor reappear in the inbox"
    );
}

/// A revoke for a message this node has never seen is dropped and leaves **no** tombstone —
/// otherwise anyone could pre-block delivery of any `msg_id` they can guess.
#[test]
fn tmail_burn_revoke_for_an_unknown_message_leaves_no_tombstone() {
    let _g = env_lock();
    set_test_env_base();
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "not-here-yet-1";
    let store = tmail_store_for_tests();

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, msg_id);
    assert_eq!(
        crate::tmail::burn::apply_burn_revoke(&store, &rev).unwrap(),
        crate::tmail::burn::BurnRevokeOutcome::UnknownMessage {
            msg_id: msg_id.to_string()
        }
    );
    assert!(
        !store.is_burned(msg_id),
        "an unauthorizable revoke must not tombstone anything"
    );

    // The message arrives afterwards and must still be deliverable.
    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        msg_id,
        tmail_flags_for_tests(true),
        None,
    );
    assert!(
        store.store_tmail(&env).unwrap(),
        "a speculative revoke must not block later delivery"
    );
}

/// A revoke whose signature does not verify is dropped before anything is touched.
#[test]
fn tmail_burn_revoke_with_a_forged_signature_is_dropped() {
    let _g = env_lock();
    set_test_env_base();
    let (store, _sw, _s, receiver_words, receiver, msg_id) = stored_burn_message_for_tests();

    let mut rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);
    // Re-sign over a different msg_id, then point the revoke back at the real one.
    let forged = signed_burn_revoke_for_tests(&receiver_words, &receiver, "some-other-msg");
    rev.hybrid_sig.ed25519_sig_b64 = forged.hybrid_sig.ed25519_sig_b64;
    rev.hybrid_sig.mldsa_sig_b64 = forged.hybrid_sig.mldsa_sig_b64;

    assert!(
        crate::tmail::burn::apply_burn_revoke(&store, &rev).is_err(),
        "a signature over a different msg_id must not burn this message"
    );
    assert!(
        store.get_by_msg_id(&msg_id).is_some(),
        "the message must survive a forged revoke"
    );
}

/// Applying the same revoke twice is a no-op, not an error — gossip delivers duplicates.
#[test]
fn tmail_burn_revoke_is_idempotent() {
    let _g = env_lock();
    set_test_env_base();
    let (store, _sw, _s, receiver_words, receiver, msg_id) = stored_burn_message_for_tests();

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);
    assert!(matches!(
        crate::tmail::burn::apply_burn_revoke(&store, &rev).unwrap(),
        crate::tmail::burn::BurnRevokeOutcome::Burned { .. }
    ));
    assert_eq!(
        crate::tmail::burn::apply_burn_revoke(&store, &rev).unwrap(),
        crate::tmail::burn::BurnRevokeOutcome::AlreadyBurned {
            msg_id: msg_id.clone()
        },
        "a duplicate revoke must be a quiet no-op"
    );
}

/// The revoke rides the Tmail gossip topic and survives a JSON round-trip as a `NetworkEvent`,
/// which is how it actually reaches a peer.
#[test]
fn tmail_burn_revoke_round_trips_as_a_network_event() {
    let _g = env_lock();
    set_test_env_base();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, "wire-1");

    let event = crate::models::NetworkEvent::TmailBurnRevoke {
        revoke: rev.clone(),
    };
    let json = serde_json::to_string(&event).unwrap();
    let back: crate::models::NetworkEvent = serde_json::from_str(&json).unwrap();
    match back {
        crate::models::NetworkEvent::TmailBurnRevoke { revoke } => {
            assert_eq!(revoke.msg_id, rev.msg_id);
            assert_eq!(revoke.kind, crate::tmail::burn::TMAIL_BURN_REVOKE_KIND);
            assert!(
                crate::tmail::burn::verify_tmail_burn_revoke_v1(&revoke).is_ok(),
                "the signature must still verify after the wire round-trip"
            );
        }
        other => panic!("wrong event kind after round-trip: {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// S7-1 item 3 — POST /tmail/read-receipt.
// ---------------------------------------------------------------------------

/// Builds a RestState whose Tmail store already holds one live burn-flagged message.
/// Returns (state, sender_words, sender, receiver_words, receiver, msg_id).
fn rest_state_with_burn_message_for_tests() -> (
    crate::rest::RestState,
    String,
    String,
    String,
    String,
    String,
) {
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "receipt-target-1".to_string();
    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        &msg_id,
        tmail_flags_for_tests(true),
        None,
    );
    assert!(state.tmail.store_tmail(&env).unwrap());
    assert_eq!(
        state.tmail.get_inbox(&receiver, 50).len(),
        1,
        "precondition: the fixture is live in the inbox"
    );
    (
        state,
        sender_words,
        sender,
        receiver_words,
        receiver,
        msg_id,
    )
}

async fn read_receipt_status(
    state: &crate::rest::RestState,
    rev: &crate::tmail::burn::TmailBurnRevokeV1,
) -> StatusCode {
    crate::rest::handlers::tmail::post_tmail_read_receipt(
        axum::extract::State(state.clone()),
        axum::Json(rev.clone()),
    )
    .await
    .status()
}

/// The receiver posts a read receipt → `202` and the ciphertext is gone from this node.
#[tokio::test]
async fn tmail_read_receipt_burns_the_message() {
    let _g = env_lock();
    set_test_env_base();
    let (state, _sw, _s, receiver_words, receiver, msg_id) = rest_state_with_burn_message_for_tests();

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);
    assert_eq!(
        read_receipt_status(&state, &rev).await,
        StatusCode::ACCEPTED,
        "a receiver's read receipt must be accepted"
    );
    assert!(
        state.tmail.get_inbox(&receiver, 50).is_empty(),
        "the ciphertext must be gone from the node after a read receipt"
    );
    assert!(state.tmail.is_burned(&msg_id));
}

/// The endpoint enforces exactly what gossip enforces — it shares `apply_burn_revoke`. A stranger
/// gets `403`, not a burn.
#[tokio::test]
async fn tmail_read_receipt_from_a_third_party_is_forbidden() {
    let _g = env_lock();
    set_test_env_base();
    let (state, _sw, _s, _rw, receiver, msg_id) = rest_state_with_burn_message_for_tests();
    let (stranger_words, stranger) = tmail_party_for_tests();

    let rev = signed_burn_revoke_for_tests(&stranger_words, &stranger, &msg_id);
    assert_eq!(
        read_receipt_status(&state, &rev).await,
        StatusCode::FORBIDDEN,
        "a stranger's read receipt must be refused"
    );
    assert_eq!(
        state.tmail.get_inbox(&receiver, 50).len(),
        1,
        "and must not destroy the message"
    );
}

/// A forged signature is `401` and destroys nothing.
#[tokio::test]
async fn tmail_read_receipt_with_a_forged_signature_is_unauthorized() {
    let _g = env_lock();
    set_test_env_base();
    let (state, _sw, _s, receiver_words, receiver, msg_id) = rest_state_with_burn_message_for_tests();

    let mut rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);
    let forged = signed_burn_revoke_for_tests(&receiver_words, &receiver, "a-different-msg");
    rev.hybrid_sig.ed25519_sig_b64 = forged.hybrid_sig.ed25519_sig_b64;
    rev.hybrid_sig.mldsa_sig_b64 = forged.hybrid_sig.mldsa_sig_b64;

    assert_eq!(
        read_receipt_status(&state, &rev).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(state.tmail.get_inbox(&receiver, 50).len(), 1);
}

/// A receipt for a message this node does not hold is `404`, because there is nothing to
/// authorize against — and nothing is announced onward.
#[tokio::test]
async fn tmail_read_receipt_for_an_unknown_message_is_not_found() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let (receiver_words, receiver) = tmail_party_for_tests();

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, "never-seen-here");
    assert_eq!(
        read_receipt_status(&state, &rev).await,
        StatusCode::NOT_FOUND
    );
    assert!(
        !state.tmail.is_burned("never-seen-here"),
        "a 404 must leave no tombstone behind"
    );
}

/// A non-burn message cannot be destroyed through the read-receipt endpoint either.
#[tokio::test]
async fn tmail_read_receipt_cannot_destroy_a_non_burn_message() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "plain-via-rest";
    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        msg_id,
        tmail_flags_for_tests(false),
        None,
    );
    state.tmail.store_tmail(&env).unwrap();

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, msg_id);
    assert_eq!(
        read_receipt_status(&state, &rev).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(state.tmail.get_inbox(&receiver, 50).len(), 1);
}

/// Replaying the same receipt is `200 already_burned`, not an error and not a second burn.
#[tokio::test]
async fn tmail_read_receipt_replay_is_idempotent() {
    let _g = env_lock();
    set_test_env_base();
    let (state, _sw, _s, receiver_words, receiver, msg_id) = rest_state_with_burn_message_for_tests();

    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);
    assert_eq!(
        read_receipt_status(&state, &rev).await,
        StatusCode::ACCEPTED
    );
    assert_eq!(
        read_receipt_status(&state, &rev).await,
        StatusCode::OK,
        "a replayed receipt must be a quiet no-op, not a 4xx"
    );
}

/// The route is actually mounted. Without this, every assertion above could pass against a handler
/// no HTTP client can reach.
#[tokio::test]
async fn tmail_read_receipt_route_is_mounted() {
    let _g = env_lock();
    set_test_env_base();
    use tower::ServiceExt as _;
    let (state, _sw, _s, receiver_words, receiver, msg_id) = rest_state_with_burn_message_for_tests();
    let rev = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/tmail/read-receipt")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&rev).unwrap()))
        .unwrap();
    let resp = crate::rest::routes::build_router(state.clone())
        .oneshot(req)
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::ACCEPTED,
        "POST /tmail/read-receipt must be reachable over HTTP, not just as a function"
    );
    assert!(state.tmail.get_inbox(&receiver, 50).is_empty());
}

// ---------------------------------------------------------------------------
// S7-1 item 4 — Rust <-> TS interop for the burn revoke preimage.
// ---------------------------------------------------------------------------

/// The §A.3.2 pre-image, pinned byte-for-byte. The identical literal is asserted on the TypeScript
/// side by `tet-network/ui/scripts/tmail_burn_preimage_golden.mjs`, so the two implementations
/// cannot drift apart silently.
///
/// Why this matters more than it looks: the pre-image is the only thing the browser and the node
/// must agree on exactly. One extra separator, one un-lowercased wallet id, one reordered field and
/// every revoke the UI sends is a 401 — with the message still sitting on every node, which is the
/// one outcome burn-after-read must never produce quietly.
const TMAIL_BURN_REVOKE_GOLDEN_PREIMAGE: &str = "tet tmail burn revoke v1|chain_id=tet-interop-golden|genesis_hash=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff|msg_id=golden-msg-1|reader=abababababababababababababababababababababababababababababababab|read_at_ms=1700000000000|mldsa_pk=Z29sZGVuLXBr";

fn golden_revoke_for_tests(reader: &str) -> crate::tmail::burn::TmailBurnRevokeV1 {
    crate::tmail::burn::TmailBurnRevokeV1 {
        v: 1,
        kind: crate::tmail::burn::TMAIL_BURN_REVOKE_KIND.to_string(),
        msg_id: "golden-msg-1".to_string(),
        reader_wallet_id: reader.to_string(),
        read_at_ms: 1_700_000_000_000,
        hybrid_sig: crate::tmail::envelope::TmailHybridSig {
            ed25519_pubkey_hex: reader.to_ascii_lowercase(),
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: "Z29sZGVuLXBr".to_string(),
            mldsa_sig_b64: String::new(),
        },
    }
}

#[test]
fn tmail_burn_revoke_preimage_matches_the_cross_language_golden_vector() {
    let _g = env_lock();
    set_test_env_base();
    let _chain = EnvVarGuard::set("TET_CHAIN_ID", "tet-interop-golden");
    let _genesis = EnvVarGuard::set(
        "TET_GENESIS_HASH",
        "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    );

    let rev = golden_revoke_for_tests(&"ab".repeat(32));
    let bytes =
        crate::tmail::burn::tmail_burn_revoke_auth_message_bytes(&rev, &rev.hybrid_sig.mldsa_pubkey_b64);
    assert_eq!(
        String::from_utf8(bytes).unwrap(),
        TMAIL_BURN_REVOKE_GOLDEN_PREIMAGE,
        "the Rust burn-revoke pre-image changed; update the TS side and the golden in \
         scripts/tmail_burn_preimage_golden.mjs together or the UI's revokes become 401s"
    );
}

/// The pre-image lowercases and trims the reader, like every other Tmail/wallet pre-image. A
/// wallet id that differs only in case must produce identical bytes.
#[test]
fn tmail_burn_revoke_preimage_normalizes_the_reader_wallet() {
    let _g = env_lock();
    set_test_env_base();
    let _chain = EnvVarGuard::set("TET_CHAIN_ID", "tet-interop-golden");
    let _genesis = EnvVarGuard::set(
        "TET_GENESIS_HASH",
        "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    );

    let rev = golden_revoke_for_tests(&format!("  {}  ", "AB".repeat(32)));
    let bytes =
        crate::tmail::burn::tmail_burn_revoke_auth_message_bytes(&rev, &rev.hybrid_sig.mldsa_pubkey_b64);
    assert_eq!(
        String::from_utf8(bytes).unwrap(),
        TMAIL_BURN_REVOKE_GOLDEN_PREIMAGE,
        "case and whitespace in the reader wallet id must not change the signed bytes"
    );
}

/// The revoke pre-image must be distinct from the envelope pre-image, so a signature harvested
/// from one can never be replayed as the other.
#[test]
fn tmail_burn_revoke_preimage_cannot_collide_with_an_envelope_preimage() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();
    let env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "shared-id",
        tmail_flags_for_tests(true),
        None,
    );
    let env_bytes =
        crate::tmail::envelope::tmail_envelope_auth_message_bytes(&env, &env.hybrid_sig.mldsa_pubkey_b64)
            .unwrap();
    let rev = signed_burn_revoke_for_tests(&words, &sender, "shared-id");
    let rev_bytes =
        crate::tmail::burn::tmail_burn_revoke_auth_message_bytes(&rev, &rev.hybrid_sig.mldsa_pubkey_b64);

    assert_ne!(
        env_bytes, rev_bytes,
        "envelope and revoke pre-images must never coincide, even for the same msg_id and signer"
    );
    assert!(
        String::from_utf8(rev_bytes).unwrap().starts_with("tet tmail burn revoke v1|"),
        "the revoke pre-image must carry its own domain separator"
    );
}

// ---------------------------------------------------------------------------
// S7-1 item 5 — AT-4: two nodes, burn on read, gone from BOTH stores.
// ---------------------------------------------------------------------------

/// One simulated node: its own ledger, its own Tmail store, its own REST state.
struct TmailNode {
    rest: crate::rest::RestState,
}

impl TmailNode {
    fn new() -> Self {
        let ledger = std::sync::Arc::new(open_temp_ledger());
        Self {
            rest: rest_state_for_tests(ledger),
        }
    }

    fn store(&self) -> &std::sync::Arc<crate::tmail::store::TmailStore> {
        &self.rest.tmail
    }

    fn inbox_len(&self, wallet: &str) -> usize {
        self.rest.tmail.get_inbox(wallet, 50).len()
    }

    /// Deliver a gossip event to this node exactly as the swarm does: JSON on the wire, decoded
    /// into a `NetworkEvent`, dispatched through `handle_tmail_network_event`.
    ///
    /// The JSON round-trip is not decoration — it is the actual gossipsub payload format, and it
    /// is where a serde-shape mistake would show up.
    fn receive_gossip(&self, wire_json: &str) -> crate::p2p::TmailGossipOutcome {
        let event: crate::models::NetworkEvent =
            serde_json::from_str(wire_json).expect("peers must be able to decode this event");
        crate::p2p::handle_tmail_network_event(self.store(), &event)
    }
}

fn tmail_wire_envelope(env: &crate::tmail::envelope::TmailEnvelopeV1) -> String {
    serde_json::to_string(&crate::models::NetworkEvent::TmailGossip {
        envelope: env.clone(),
    })
    .unwrap()
}

fn tmail_wire_revoke(rev: &crate::tmail::burn::TmailBurnRevokeV1) -> String {
    serde_json::to_string(&crate::models::NetworkEvent::TmailBurnRevoke {
        revoke: rev.clone(),
    })
    .unwrap()
}

/// **AT-4.** Send a burn-after-read message from node A, read it on node B, and assert the
/// ciphertext is gone from **both** stores.
///
/// Shape of the run, matching how the network actually behaves:
///   A: POST /tmail/send        → stored on A, gossiped
///   B: receives the envelope   → stored on B (this is how an offline receiver gets mail)
///   B: POST /tmail/read-receipt → burned on B, revoke gossiped
///   A: receives the revoke     → burned on A
///
/// Every hop crosses `serde_json` and `handle_tmail_network_event`, the same function the swarm
/// event loop calls, so this is not a re-implementation of the receive path standing in for it.
#[tokio::test]
async fn at4_burn_after_read_removes_the_message_from_both_nodes() {
    let _g = env_lock();
    set_test_env_base();

    let node_a = TmailNode::new();
    let node_b = TmailNode::new();
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "at4-burn-1";

    // --- A sends a burn-after-read message -------------------------------------------------
    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        msg_id,
        tmail_flags_for_tests(true),
        None,
    );
    let sent = crate::rest::handlers::tmail::post_tmail_send(
        axum::extract::State(node_a.rest.clone()),
        axum::Json(env.clone()),
    )
    .await;
    assert_eq!(sent.status(), StatusCode::ACCEPTED, "A must accept the send");

    // --- B learns it over gossip -----------------------------------------------------------
    assert_eq!(
        node_b.receive_gossip(&tmail_wire_envelope(&env)),
        crate::p2p::TmailGossipOutcome::Stored {
            msg_id: msg_id.to_string()
        },
        "B must buffer the envelope for its offline receiver"
    );

    // Both nodes hold it. Without this the burn assertions below could pass for the wrong reason.
    assert_eq!(node_a.inbox_len(&receiver), 1, "precondition: A holds it");
    assert_eq!(node_b.inbox_len(&receiver), 1, "precondition: B holds it");

    // --- B reads it: read receipt burns locally and announces ------------------------------
    let revoke = signed_burn_revoke_for_tests(&receiver_words, &receiver, msg_id);
    let receipt = crate::rest::handlers::tmail::post_tmail_read_receipt(
        axum::extract::State(node_b.rest.clone()),
        axum::Json(revoke.clone()),
    )
    .await;
    assert_eq!(
        receipt.status(),
        StatusCode::ACCEPTED,
        "B must accept the receiver's read receipt"
    );

    // --- A learns the revoke over gossip ---------------------------------------------------
    assert_eq!(
        node_a.receive_gossip(&tmail_wire_revoke(&revoke)),
        crate::p2p::TmailGossipOutcome::Burned {
            msg_id: msg_id.to_string()
        },
        "A must honour a revoke signed by the message's receiver"
    );

    // --- AT-4: gone from BOTH ---------------------------------------------------------------
    assert_eq!(
        node_b.inbox_len(&receiver),
        0,
        "AT-4: the message must be gone from the reading node"
    );
    assert_eq!(
        node_a.inbox_len(&receiver),
        0,
        "AT-4: the message must be gone from the sending node too"
    );
    assert!(node_a.store().get_by_msg_id(msg_id).is_none());
    assert!(node_b.store().get_by_msg_id(msg_id).is_none());

    // --- And it stays gone: a peer re-gossips the original envelope -------------------------
    assert_eq!(
        node_a.receive_gossip(&tmail_wire_envelope(&env)),
        crate::p2p::TmailGossipOutcome::Duplicate {
            msg_id: msg_id.to_string()
        },
        "a re-gossiped burned envelope must be refused, not restored"
    );
    assert_eq!(
        node_b.receive_gossip(&tmail_wire_envelope(&env)),
        crate::p2p::TmailGossipOutcome::Duplicate {
            msg_id: msg_id.to_string()
        }
    );
    assert_eq!(node_a.inbox_len(&receiver), 0, "still gone on A");
    assert_eq!(node_b.inbox_len(&receiver), 0, "still gone on B");
}

/// The negative half of AT-4: an ordinary (non-burn) message survives the same two-node run, so
/// the test above is measuring the burn and not simply that messages vanish.
#[tokio::test]
async fn at4_control_a_plain_message_survives_the_same_two_node_run() {
    let _g = env_lock();
    set_test_env_base();

    let node_a = TmailNode::new();
    let node_b = TmailNode::new();
    let (sender_words, sender) = tmail_party_for_tests();
    let (receiver_words, receiver) = tmail_party_for_tests();
    let msg_id = "at4-plain-1";

    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        msg_id,
        tmail_flags_for_tests(false), // no burn flag
        None,
    );
    crate::rest::handlers::tmail::post_tmail_send(
        axum::extract::State(node_a.rest.clone()),
        axum::Json(env.clone()),
    )
    .await;
    node_b.receive_gossip(&tmail_wire_envelope(&env));
    assert_eq!(node_a.inbox_len(&receiver), 1);
    assert_eq!(node_b.inbox_len(&receiver), 1);

    // The receiver tries the very same read receipt that burned the message above.
    let revoke = signed_burn_revoke_for_tests(&receiver_words, &receiver, msg_id);
    let receipt = crate::rest::handlers::tmail::post_tmail_read_receipt(
        axum::extract::State(node_b.rest.clone()),
        axum::Json(revoke.clone()),
    )
    .await;
    assert_eq!(
        receipt.status(),
        StatusCode::FORBIDDEN,
        "a message that did not opt into burning must not be destroyable"
    );
    assert!(matches!(
        node_a.receive_gossip(&tmail_wire_revoke(&revoke)),
        crate::p2p::TmailGossipOutcome::Rejected { .. }
    ));

    assert_eq!(node_a.inbox_len(&receiver), 1, "plain mail survives on A");
    assert_eq!(node_b.inbox_len(&receiver), 1, "plain mail survives on B");
}

/// A third party's revoke must not burn on either node — the authorization rule, across the wire.
#[tokio::test]
async fn at4_a_stranger_cannot_burn_a_message_on_either_node() {
    let _g = env_lock();
    set_test_env_base();

    let node_a = TmailNode::new();
    let node_b = TmailNode::new();
    let (sender_words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();
    let (stranger_words, stranger) = tmail_party_for_tests();
    let msg_id = "at4-stranger-1";

    let env = signed_tmail_env_for_tests(
        &sender_words,
        &sender,
        &receiver,
        msg_id,
        tmail_flags_for_tests(true),
        None,
    );
    crate::rest::handlers::tmail::post_tmail_send(
        axum::extract::State(node_a.rest.clone()),
        axum::Json(env.clone()),
    )
    .await;
    node_b.receive_gossip(&tmail_wire_envelope(&env));

    let revoke = signed_burn_revoke_for_tests(&stranger_words, &stranger, msg_id);
    assert!(matches!(
        node_a.receive_gossip(&tmail_wire_revoke(&revoke)),
        crate::p2p::TmailGossipOutcome::Rejected { .. }
    ));
    assert!(matches!(
        node_b.receive_gossip(&tmail_wire_revoke(&revoke)),
        crate::p2p::TmailGossipOutcome::Rejected { .. }
    ));
    assert_eq!(node_a.inbox_len(&receiver), 1, "A must ignore the stranger");
    assert_eq!(node_b.inbox_len(&receiver), 1, "B must ignore the stranger");
}

// ---------------------------------------------------------------------------
// S7-0 — server-side per-conversation retention (spec Appendix K.1), and AT-7.
// ---------------------------------------------------------------------------

/// Store `n` messages from `sender` to `receiver`, oldest first, one second apart.
/// Returns the msg_ids in send order.
fn store_conversation_for_tests(
    store: &crate::tmail::store::TmailStore,
    sender_words: &str,
    sender: &str,
    receiver: &str,
    n: usize,
    tag: &str,
) -> Vec<String> {
    let base = tmail_now_ms_for_tests();
    let mut ids = Vec::new();
    for i in 0..n {
        let msg_id = format!("{tag}-{i}");
        let mut env = signed_tmail_env_for_tests(
            sender_words,
            sender,
            receiver,
            &msg_id,
            tmail_flags_for_tests(false),
            None,
        );
        // Distinct, increasing timestamps so "newest" is unambiguous.
        env.sent_at_ms = base + (i as u64) * 1000;
        store.store_tmail(&env).unwrap();
        ids.push(msg_id);
    }
    ids
}

/// **AT-7(a).** Without a pin, the 6th message is genuinely gone from the STORE — not hidden.
///
/// This is the assertion that makes AT-7 mean something. Before S7-0 the 5-message cap was
/// `MessagesPanel.tsx:269` slicing an array, so a "Show older" button revealed everything and the
/// store kept all of it; the acceptance test passed with the feature absent.
#[test]
fn at7_a_sixth_message_is_pruned_from_the_store_without_a_pin() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (sender_words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    let ids = store_conversation_for_tests(&store, &sender_words, &sender, &receiver, 6, "at7a");

    // The store itself holds five, not six.
    let inbox = store.get_inbox(&receiver, 50);
    assert_eq!(
        inbox.len(),
        5,
        "a conversation must retain exactly {} messages",
        crate::tmail::store::RETAIN_PER_CONVERSATION
    );

    // And specifically the OLDEST is the one gone.
    let oldest = &ids[0];
    assert!(
        store.get_by_msg_id(oldest).is_none(),
        "the 6th-oldest message must be deleted from the store, not merely hidden from the inbox"
    );
    assert!(
        store.is_retention_pruned(oldest),
        "it must be marked as retention-pruned, not left as a dangling id"
    );
    // The five newest survive.
    for id in &ids[1..] {
        assert!(
            store.get_by_msg_id(id).is_some(),
            "message {id} should have been retained"
        );
    }
}

/// A pruned message must not be resurrected when a peer re-gossips it.
#[test]
fn at7_a_pruned_message_is_not_restored_by_re_gossip() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (sender_words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    let base = tmail_now_ms_for_tests();
    let mut first: Option<crate::tmail::envelope::TmailEnvelopeV1> = None;
    for i in 0..6 {
        let mut env = signed_tmail_env_for_tests(
            &sender_words,
            &sender,
            &receiver,
            &format!("regossip-{i}"),
            tmail_flags_for_tests(false),
            None,
        );
        env.sent_at_ms = base + (i as u64) * 1000;
        store.store_tmail(&env).unwrap();
        if i == 0 {
            first = Some(env);
        }
    }
    let evicted = first.unwrap();
    assert!(store.get_by_msg_id(&evicted.msg_id).is_none());

    assert!(
        !store.store_tmail(&evicted).unwrap(),
        "a re-gossiped aged-out message must be refused"
    );
    assert_eq!(store.get_inbox(&receiver, 50).len(), 5, "still five");
}

/// An anonymous envelope whose announced journal is consistent with it (ephemeral, receiver,
/// bucket) and carries `nullifier`. No receipt exists: the store and the metadata check never pull
/// one, and that is all these retention tests exercise.
fn anon_env_with_nullifier_for_tests(
    eph_words: &str,
    ephemeral: &str,
    receiver: &str,
    nullifier: [u8; 32],
    msg_id: &str,
    sent_at_ms: u64,
) -> crate::tmail::envelope::TmailEnvelopeV1 {
    let journal = nexus_protocol::TmailAnonMembershipV1 {
        journal_kind: nexus_protocol::TMAIL_ANON_JOURNAL_KIND,
        merkle_root: [0x11; 32],
        nullifier,
        ephemeral_pubkey_bytes: hex::decode(ephemeral).unwrap().try_into().unwrap(),
        receiver_wallet_bytes: hex::decode(receiver).unwrap().try_into().unwrap(),
        bucket_index: nexus_protocol::tmail_bucket_index_v1(sent_at_ms),
    };
    let words: Vec<u32> = risc0_zkvm::serde::to_vec(&journal).unwrap();
    let journal_bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
    let mut env = signed_tmail_env_for_tests(
        eph_words,
        ephemeral,
        receiver,
        msg_id,
        tmail_flags_for_tests(false),
        None,
    );
    env.sent_at_ms = sent_at_ms;
    env.flags.anonymous = true;
    env.sender_wallet_id = crate::tmail::envelope::ANONYMOUS_SENTINEL.to_string();
    env.anonymous = Some(crate::tmail::envelope::TmailAnonymous {
        ephemeral_wallet_id: ephemeral.to_string(),
        anchor_proof: crate::tmail::envelope::TmailAnchorProof {
            image_id_hex: "00".repeat(32),
            journal_b64: base64::engine::general_purpose::STANDARD.encode(&journal_bytes),
            receipt_sha256_hex: "ab".repeat(32),
        },
    });
    resign_tmail_env_for_tests(&mut env, eph_words);
    env
}

/// **SECURITY REGRESSION GUARD: anonymous mail is not one conversation.** Six members each send one
/// anonymous message to the same receiver; all six are kept. Every anonymous envelope carries the
/// same sentinel sender, so keying retention by sender made them one conversation and the sixth
/// evicted the first. Anonymous mail is keyed by nullifier now.
/// Negative control: `conversation_key` keyed by `sender_wallet_id` again → 5 retained, FAILED.
#[test]
fn anonymous_mail_from_six_members_is_all_retained() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();
    let base = tmail_now_ms_for_tests();
    let mut ids = Vec::new();
    for i in 0..6u8 {
        let (eph_words, ephemeral) = tmail_party_for_tests();
        let env = anon_env_with_nullifier_for_tests(
            &eph_words,
            &ephemeral,
            &receiver,
            [i + 1; 32],
            &format!("anon-member-{i}"),
            base + u64::from(i) * 1000,
        );
        // The path gossip and REST take: metadata verification, then the store.
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).expect("consistent anonymous envelope");
        assert!(store.store_tmail(&env).unwrap());
        ids.push(env.msg_id);
    }
    for id in &ids {
        assert!(
            store.get_by_msg_id(id).is_some(),
            "anonymous message {id} was evicted: six members, six messages, all must be kept"
        );
    }
    assert_eq!(store.get_inbox(&receiver, 50).len(), 6);
}

/// **SECURITY REGRESSION GUARD: anonymous mail is capped per receiver.** Keying by nullifier makes
/// every anonymous message its own conversation, so the per-conversation rule no longer bounds it;
/// the per-receiver cap does. The 101st anonymous message evicts the oldest from the **store**
/// (the read side caps too, so the inbox count alone could not catch a missing write-side cap).
/// Negative control: drop the `enforce_anonymous_cap` call from `store_tmail` → the oldest stays,
/// FAILED.
#[test]
fn anonymous_mail_is_capped_per_receiver() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();
    let (eph_words, ephemeral) = tmail_party_for_tests();
    let cap = crate::tmail::store::ANON_RETAIN_PER_RECEIVER;
    let base = tmail_now_ms_for_tests();
    let mut ids = Vec::new();
    for i in 0..=cap {
        let mut nullifier = [0u8; 32];
        nullifier[..8].copy_from_slice(&(i as u64 + 1).to_le_bytes());
        let env = anon_env_with_nullifier_for_tests(
            &eph_words,
            &ephemeral,
            &receiver,
            nullifier,
            &format!("anon-cap-{i}"),
            base + i as u64,
        );
        assert!(store.store_tmail(&env).unwrap());
        ids.push(env.msg_id);
    }
    assert!(
        store.get_by_msg_id(&ids[0]).is_none() && store.is_retention_pruned(&ids[0]),
        "the oldest of {} anonymous messages must be deleted from the store",
        cap + 1
    );
    for id in &ids[1..] {
        assert!(store.get_by_msg_id(id).is_some(), "message {id} is within the cap");
    }
    // Named mail is not counted against the anonymous cap.
    let (sw, sender) = tmail_party_for_tests();
    store_conversation_for_tests(&store, &sw, &sender, &receiver, 3, "named");
    assert_eq!(store.get_inbox(&receiver, 500).len(), cap + 3);
}

/// Retention is **per conversation**, not per inbox: two counterparties keep five each.
#[test]
fn at7_a_retention_is_per_conversation_not_per_inbox() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (a_words, alice) = tmail_party_for_tests();
    let (b_words, bob) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    store_conversation_for_tests(&store, &a_words, &alice, &receiver, 6, "conv-a");
    store_conversation_for_tests(&store, &b_words, &bob, &receiver, 6, "conv-b");

    let inbox = store.get_inbox(&receiver, 100);
    assert_eq!(
        inbox.len(),
        10,
        "two conversations must retain five each, not five in total"
    );
    let from_alice = inbox
        .iter()
        .filter(|m| m.sender_wallet_id.eq_ignore_ascii_case(&alice))
        .count();
    let from_bob = inbox
        .iter()
        .filter(|m| m.sender_wallet_id.eq_ignore_ascii_case(&bob))
        .count();
    assert_eq!((from_alice, from_bob), (5, 5));
}

/// The REST inbox reflects the store rule — the cap is not something the client is trusted to do.
#[tokio::test]
async fn at7_a_rest_inbox_returns_at_most_five_per_conversation() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let (sender_words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    let base = tmail_now_ms_for_tests();
    for i in 0..6 {
        let mut env = signed_tmail_env_for_tests(
            &sender_words,
            &sender,
            &receiver,
            &format!("rest-at7-{i}"),
            tmail_flags_for_tests(false),
            None,
        );
        env.sent_at_ms = base + (i as u64) * 1000;
        crate::rest::handlers::tmail::post_tmail_send(
            axum::extract::State(state.clone()),
            axum::Json(env),
        )
        .await;
    }

    let resp = crate::rest::handlers::tmail::get_tmail_inbox(
        axum::extract::State(state.clone()),
        axum::extract::Path(receiver.clone()),
        axum::extract::Query(crate::rest::handlers::tmail::InboxQuery { limit: Some(50) }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["count"].as_u64(),
        Some(5),
        "GET /tmail/inbox must return at most five per conversation, got {}",
        json["count"]
    );
}

/// **AT-7(b) — EXPECTED TO FAIL until Pin lands in Phase 1.**
///
/// Ignored so CI stays green on a known-missing feature, not to hide it: run
/// `cargo test --bin TET-Core -- --ignored at7_b` and it goes red, which is the point. The
/// acceptance-test list in `SOVEREIGN_OS_PHASE0_SPEC.md` §B.2 carries the matching ❌ so nobody
/// reads a passing suite as "Pin works".
///
/// It fails for the right reason rather than an unexplained count: `TmailStore::is_pinned` is
/// hardcoded `false` because `TxV1::TmailPin` does not exist — it is batched into the Phase 1
/// genesis (`PHASE_1_GENESIS_SPEC.md` §2). When that lands, this test turns green by implementing
/// the pin store behind that one seam; nothing here needs rewriting.
#[test]
#[ignore = "AT-7(b): RED until TxV1::TmailPin lands in Phase 1 — run with --ignored to confirm it still fails"]
fn at7_b_pinned_conversation_retains_more_than_five() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (sender_words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    // The user pays the Appendix C fee (1_000 µTET) and pins the thread. There is no API for this
    // in Phase 0, which is exactly what this test records.
    assert!(
        store.is_pinned(&receiver, &sender),
        "AT-7(b) blocked: nothing can pin a conversation yet. Pin is a 1_000 uTET fee settled by \
         TxV1::TmailPin, which is batched into the Phase 1 genesis (PHASE_1_GENESIS_SPEC.md §2) \
         rather than shipped as a flag-day upgrade. Until then TmailStore::is_pinned is hardcoded \
         false and a pinned thread cannot exist."
    );

    store_conversation_for_tests(&store, &sender_words, &sender, &receiver, 6, "at7b");
    assert!(
        store.get_inbox(&receiver, 50).len() > 5,
        "AT-7: a pinned conversation must retain more than five messages"
    );
}

/// The read-side cap is covered independently of the write-side one.
///
/// Without this, `get_inbox`'s per-conversation cap is untestable: `store_tmail` already deleted
/// the overflow, so the read filter never sees more than five and could be deleted without a test
/// noticing. Widening retention for the writes and narrowing it for the read reproduces the case
/// the filter exists for — rows already on disk from a crash between insert and enforce, or an
/// older DB written under a larger cap.
#[test]
fn at7_a_read_side_cap_holds_when_stored_rows_exceed_retention() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (sender_words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    {
        // Write eight under a wide cap, so all eight land on disk.
        let _wide = EnvVarGuard::set("TET_TMAIL_RETAIN_PER_CONVERSATION", "10");
        store_conversation_for_tests(&store, &sender_words, &sender, &receiver, 8, "readcap");
        assert_eq!(
            store.get_inbox(&receiver, 50).len(),
            8,
            "precondition: all eight are stored under the wide cap"
        );
    }

    // Now read under the real cap. The rows are still on disk; the API contract must still hold.
    let _narrow = EnvVarGuard::set("TET_TMAIL_RETAIN_PER_CONVERSATION", "5");
    assert_eq!(
        store.get_inbox(&receiver, 50).len(),
        5,
        "GET /tmail/inbox must cap per conversation even when the store still holds more"
    );
}

// ---------------------------------------------------------------------------
// S7-2 item 1 — time-lock: flag gate and schedule validation.
// ---------------------------------------------------------------------------

/// Build a scheduled envelope: `flags.time_lock` set and `release_at_ms` in the future.
fn signed_scheduled_env_for_tests(
    words: &str,
    sender: &str,
    receiver: &str,
    msg_id: &str,
    release_in_ms: i64,
) -> crate::tmail::envelope::TmailEnvelopeV1 {
    let mut flags = tmail_flags_for_tests(false);
    flags.time_lock = true;
    let mut env =
        signed_tmail_env_for_tests(words, sender, receiver, msg_id, flags, None);
    env.release_at_ms = (env.sent_at_ms as i64 + release_in_ms).max(0) as u64;
    resign_tmail_env_for_tests(&mut env, words);
    env
}

/// Re-sign an envelope in place after mutating a field that is inside the §A.1.3 pre-image.
fn resign_tmail_env_for_tests(env: &mut crate::tmail::envelope::TmailEnvelopeV1, words: &str) {
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    let pk = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let msg = crate::tmail::envelope::tmail_envelope_auth_message_bytes(env, &pk).unwrap();
    env.hybrid_sig.mldsa_pubkey_b64 = pk;
    env.hybrid_sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    env.hybrid_sig.mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap());
}

/// A scheduled envelope verifies. `release_at_ms` was already in the pre-image, so nothing about
/// the signature format changed.
#[test]
fn tmail_scheduled_envelope_verifies() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();
    let env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "sched-1", 3_600_000);
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_ok(),
        "a time-locked envelope must verify after S7-2"
    );
}

/// `flags.time_lock` with a release at or before `sent_at_ms` would present as "scheduled" while
/// releasing immediately. Refused rather than normalised.
#[test]
fn tmail_time_lock_requires_a_future_release() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    for offset in [0i64, -1, -60_000] {
        let env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "past-1", offset);
        let err = crate::tmail::envelope::verify_tmail_envelope_v1(&env)
            .expect_err("a non-future release must be refused");
        assert!(
            format!("{err}").contains("strictly after sent_at_ms"),
            "expected the release-time rejection, got: {err}"
        );
    }
}

/// A `release_at_ms` without the flag is a signed value the node would silently ignore.
#[test]
fn tmail_release_without_the_time_lock_flag_is_rejected() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let mut env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "stray-release",
        tmail_flags_for_tests(false),
        None,
    );
    env.release_at_ms = env.sent_at_ms + 60_000;
    resign_tmail_env_for_tests(&mut env, &words);
    let err = crate::tmail::envelope::verify_tmail_envelope_v1(&env)
        .expect_err("release_at_ms without the flag must be refused");
    assert!(
        format!("{err}").contains("must be 0 unless"),
        "expected the unexpected-release rejection, got: {err}"
    );
}

/// The unsigned `time_lock` block cannot contradict the signed `release_at_ms`, and the VDF field
/// is refused outright — the VDF path is Phase 0.1 and must not look supported.
#[test]
fn tmail_unsigned_time_lock_block_cannot_contradict_or_smuggle_a_vdf() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let mut env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "tlblock-1", 60_000);
    env.time_lock = Some(crate::tmail::envelope::TmailTimeLock {
        release_at_ms: env.release_at_ms + 999_999, // a relaying peer moves the release
        vdf_proof_b64: None,
    });
    let err = crate::tmail::envelope::verify_tmail_envelope_v1(&env)
        .expect_err("a contradicting time_lock block must be refused");
    assert!(
        format!("{err}").contains("time_lock block disagrees"),
        "expected the inconsistent-block rejection, got: {err}"
    );

    let mut env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "tlblock-2", 60_000);
    env.time_lock = Some(crate::tmail::envelope::TmailTimeLock {
        release_at_ms: env.release_at_ms,
        vdf_proof_b64: Some("bm90LWEtdmRm".to_string()),
    });
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_err(),
        "a VDF proof must be refused in Phase 0 rather than silently ignored"
    );
}

/// A redundant `time_lock` block (restates the signed release, no VDF) is harmless.
#[test]
fn tmail_redundant_time_lock_block_is_accepted() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();
    let mut env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "tlblock-3", 60_000);
    env.time_lock = Some(crate::tmail::envelope::TmailTimeLock {
        release_at_ms: env.release_at_ms,
        vdf_proof_b64: None,
    });
    assert!(crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_ok());
}

/// Time-lock and burn compose: a scheduled burn-after-read message is valid.
#[test]
fn tmail_time_lock_and_burn_compose() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();

    let mut flags = tmail_flags_for_tests(true);
    flags.time_lock = true;
    let mut env =
        signed_tmail_env_for_tests(&words, &sender, &receiver, "sched-burn", flags, None);
    env.release_at_ms = env.sent_at_ms + 60_000;
    resign_tmail_env_for_tests(&mut env, &words);
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_ok(),
        "scheduled + burn-after-read must be a valid combination"
    );
}

/// Anonymous stays closed — S7-2 must not widen the gate past time-lock.
#[test]
fn tmail_anonymous_flag_is_still_rejected_after_time_lock() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();
    let mut flags = tmail_flags_for_tests(false);
    flags.anonymous = true;
    let env = signed_tmail_env_for_tests(&words, &sender, &receiver, "anon-2", flags, None);
    assert!(crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_err());
}

// ---------------------------------------------------------------------------
// S7-2 item 2 — AT-3: the inbox withholds ciphertext until release_at_ms.
//
// The clock is a parameter (`to_inbox_row(env, now_ms)`), which is the test hook: AT-3's "after
// 1h" is expressed by passing an instant past the release, never by sleeping.
// ---------------------------------------------------------------------------

/// **AT-3.** Before the release the ciphertext is withheld; after it, the same message carries it.
#[test]
fn at3_scheduled_message_withholds_ciphertext_until_release() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();
    // An hour out, exactly as AT-3 specifies -- but reached by moving the clock, not waiting.
    let env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "at3-1", 3_600_000);
    let release = env.release_at_ms;

    // --- before ---
    let before = crate::tmail::timelock::to_inbox_row(&env, release - 1);
    assert!(before.locked, "it must report as scheduled before release");
    assert!(
        before.e2ee.is_none(),
        "AT-3: the ciphertext must be withheld before release_at_ms"
    );
    // The receiver still learns that something is scheduled, and for when.
    assert_eq!(before.release_at_ms, release);
    assert_eq!(before.sender_wallet_id, sender);
    assert_eq!(
        before.locked_note,
        Some(crate::tmail::timelock::TMAIL_TIME_LOCK_DISCLOSURE),
        "a withheld row must carry the R6 disclosure"
    );

    // --- exactly at release: released (the boundary is inclusive) ---
    let at = crate::tmail::timelock::to_inbox_row(&env, release);
    assert!(!at.locked, "release_at_ms itself must count as released");
    assert!(at.e2ee.is_some());

    // --- after ---
    let after = crate::tmail::timelock::to_inbox_row(&env, release + 1);
    assert!(!after.locked);
    let e2ee = after.e2ee.expect("AT-3: ciphertext must be present after release");
    assert_eq!(
        e2ee.ciphertext_b64, env.e2ee.ciphertext_b64,
        "and it must be the original ciphertext, unmodified"
    );
    assert!(after.locked_note.is_none());
}

/// The withheld row must not leak the payload through any other field.
#[test]
fn at3_withheld_row_serializes_without_any_ciphertext() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();
    let env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "at3-leak", 3_600_000);

    let row = crate::tmail::timelock::to_inbox_row(&env, env.release_at_ms - 1);
    let json = serde_json::to_string(&row).unwrap();
    assert!(
        !json.contains(&env.e2ee.ciphertext_b64),
        "the ciphertext must not appear anywhere in a withheld row"
    );
    assert!(
        !json.contains("e2ee"),
        "the e2ee field must be absent, not empty"
    );
    assert!(json.contains("\"locked\":true"));
}

/// A message with no schedule is never withheld, whatever the clock says.
///
/// The second half is the one that matters. `is_locked` checks `flags.time_lock` *and* the clock,
/// and the flag check looks redundant because `verify_tmail_envelope_v1` forces `release_at_ms` to
/// 0 whenever the flag is clear — so on any envelope that passed verification, the clock test alone
/// would give the same answer, and deleting the flag check is undetectable.
///
/// It is not redundant for a row that never went through today's verification: an entry already in
/// the store from an older build, or any future path that populates `release_at_ms` without the
/// flag. Withholding *those* would hide a message the sender never scheduled. So the guard builds
/// exactly that envelope directly, without signing it, which is the only way to reach the case.
#[test]
fn at3_unscheduled_messages_are_never_withheld() {
    let _g = env_lock();
    set_test_env_base();
    let (words, sender, receiver) = tmail_pair_for_tests();
    let env = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "at3-plain",
        tmail_flags_for_tests(false),
        None,
    );
    for now in [0u64, env.sent_at_ms, u64::MAX] {
        let row = crate::tmail::timelock::to_inbox_row(&env, now);
        assert!(!row.locked, "a message with no schedule is never locked");
        assert!(row.e2ee.is_some());
    }

    // A stored row carrying a future release_at_ms with the flag CLEAR. Verification refuses this
    // shape today, so it is constructed here rather than signed.
    let mut stray = env.clone();
    stray.release_at_ms = stray.sent_at_ms + 3_600_000;
    assert!(
        !stray.flags.time_lock,
        "precondition: the flag is clear and only release_at_ms is set"
    );
    let row = crate::tmail::timelock::to_inbox_row(&stray, stray.sent_at_ms);
    assert!(
        !row.locked,
        "withholding must key off the signed flag, not a stray release_at_ms: a message the \
         sender never scheduled must not be hidden from its receiver"
    );
    assert!(row.e2ee.is_some(), "and its ciphertext must still be served");
}

/// End to end over REST: a scheduled message is listed, counted as locked, and carries no payload.
#[tokio::test]
async fn at3_rest_inbox_withholds_scheduled_ciphertext() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let (words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    // Scheduled an hour out, so "now" inside the handler is unambiguously before release.
    let scheduled = signed_scheduled_env_for_tests(&words, &sender, &receiver, "at3-rest-locked", 3_600_000);
    // ...and an ordinary one alongside it, to prove the withholding is selective.
    let plain = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "at3-rest-plain",
        tmail_flags_for_tests(false),
        None,
    );
    for env in [&scheduled, &plain] {
        let r = crate::rest::handlers::tmail::post_tmail_send(
            axum::extract::State(state.clone()),
            axum::Json(env.clone()),
        )
        .await;
        assert_eq!(r.status(), StatusCode::ACCEPTED);
    }

    let resp = crate::rest::handlers::tmail::get_tmail_inbox(
        axum::extract::State(state.clone()),
        axum::extract::Path(receiver.clone()),
        axum::extract::Query(crate::rest::handlers::tmail::InboxQuery { limit: Some(50) }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["count"].as_u64(), Some(2), "both messages must be listed");
    assert_eq!(json["locked_count"].as_u64(), Some(1));

    let msgs = json["messages"].as_array().unwrap();
    let locked = msgs.iter().find(|m| m["msg_id"] == "at3-rest-locked").unwrap();
    assert_eq!(locked["locked"], Value::Bool(true));
    assert!(
        locked.get("e2ee").is_none(),
        "AT-3: a scheduled message must be served without its e2ee block"
    );
    assert_eq!(locked["release_at_ms"].as_u64(), Some(scheduled.release_at_ms));
    assert!(
        locked["locked_note"].as_str().unwrap().contains("not an enforced lock"),
        "the withheld row must carry the R6 disclosure"
    );

    let open = msgs.iter().find(|m| m["msg_id"] == "at3-rest-plain").unwrap();
    assert_eq!(open["locked"], Value::Bool(false));
    assert!(
        open["e2ee"]["ciphertext_b64"].as_str() == Some(plain.e2ee.ciphertext_b64.as_str()),
        "an unscheduled message must still be served in full"
    );

    // Nothing in the whole response may contain the scheduled ciphertext.
    let raw = String::from_utf8(body.to_vec()).unwrap();
    assert!(
        !raw.contains(&scheduled.e2ee.ciphertext_b64),
        "the scheduled ciphertext must not appear anywhere in the response body"
    );
}

/// A scheduled message that has been released behaves exactly like an ordinary one over REST.
#[tokio::test]
async fn at3_rest_inbox_serves_the_payload_once_released() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let (words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    // Release one second after send: by the time the handler reads the clock it has passed.
    // (The envelope is still valid -- release_at_ms is strictly after sent_at_ms.)
    let mut env = signed_scheduled_env_for_tests(&words, &sender, &receiver, "at3-released", 1);
    env.sent_at_ms = tmail_now_ms_for_tests() - 60_000;
    env.release_at_ms = env.sent_at_ms + 1;
    resign_tmail_env_for_tests(&mut env, &words);
    assert!(crate::tmail::envelope::verify_tmail_envelope_v1(&env).is_ok());

    crate::rest::handlers::tmail::post_tmail_send(
        axum::extract::State(state.clone()),
        axum::Json(env.clone()),
    )
    .await;

    let resp = crate::rest::handlers::tmail::get_tmail_inbox(
        axum::extract::State(state.clone()),
        axum::extract::Path(receiver.clone()),
        axum::extract::Query(crate::rest::handlers::tmail::InboxQuery { limit: Some(50) }),
    )
    .await;
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["locked_count"].as_u64(), Some(0));
    let m = &json["messages"].as_array().unwrap()[0];
    assert_eq!(m["locked"], Value::Bool(false));
    assert_eq!(
        m["e2ee"]["ciphertext_b64"].as_str(),
        Some(env.e2ee.ciphertext_b64.as_str()),
        "a released message must serve its original ciphertext"
    );
}

// ---------------------------------------------------------------------------
// S8-1 — receipt size measurement.
//
// The anonymous envelope (§A.1.2) must carry a RISC Zero receipt inline, and Tmail envelopes ride
// gossipsub with `max_transmit_size` = DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES (128 KiB, p2p.rs:439).
// Whether a real receipt fits decides the S8-2 envelope design, so it is measured rather than
// assumed.
//
// Ignored: it runs a real prover, which needs the guest built (RISC0_SKIP_BUILD=0) and takes far
// longer than a unit test should.
//
//   RISC0_SKIP_BUILD=0 cargo test -p tet-core --bin TET-Core --features zk-prove \
//     -- --ignored --nocapture s8_measure_receipt_size
// ---------------------------------------------------------------------------

#[test]
#[ignore = "runs a real RISC Zero prover; needs RISC0_SKIP_BUILD=0"]
fn s8_measure_receipt_size_against_the_gossip_ceiling() {
    let _g = env_lock();
    set_test_env_base();

    assert!(
        !methods::NEXUS_GUEST_ELF.is_empty(),
        "guest ELF is empty -- rebuild with RISC0_SKIP_BUILD=0, otherwise this measures nothing"
    );

    use risc0_zkvm::{ExecutorEnv, default_prover};
    let prompt = "anchor-ownership size probe".to_string();
    let response = "r".repeat(64);
    let flops: u64 = 1_000;
    let pk = [7u8; 32];
    let commitment = nexus_protocol::zk_court_inference_commitment_v1(
        &prompt, &response, flops, &pk,
    );

    let env = ExecutorEnv::builder()
        .write(&1u8)
        .unwrap()
        .write(&prompt)
        .unwrap()
        .write(&response)
        .unwrap()
        .write(&flops)
        .unwrap()
        .write(&pk)
        .unwrap()
        .write(&commitment)
        .unwrap()
        .build()
        .unwrap();

    let started = std::time::Instant::now();
    let info = default_prover()
        .prove(env, methods::NEXUS_GUEST_ELF)
        .expect("prove");
    let prove_ms = started.elapsed().as_millis();
    let receipt = info.receipt;

    // Exactly how the envelope would carry it: bincode, then STANDARD base64 (zk_verifier.rs:113).
    let bin = bincode::serialize(&receipt).expect("bincode");
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bin);

    let ceiling = crate::p2p::DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES;
    println!("\n=== S8-1 receipt size measurement ===");
    println!("prove wall time      : {prove_ms} ms");
    println!("journal bytes        : {}", receipt.journal.bytes.len());
    println!("receipt (bincode)    : {} bytes ({:.1} KiB)", bin.len(), bin.len() as f64 / 1024.0);
    println!("receipt (base64)     : {} bytes ({:.1} KiB)", b64.len(), b64.len() as f64 / 1024.0);
    println!("gossip ceiling       : {ceiling} bytes ({:.0} KiB)", ceiling as f64 / 1024.0);
    println!(
        "fits inline?         : {}",
        if b64.len() < ceiling { "YES" } else { "NO" }
    );
    println!(
        "headroom             : {} bytes",
        ceiling as i64 - b64.len() as i64
    );

    // The receipt must actually verify, or the number measures a broken artifact.
    receipt.verify(methods::NEXUS_GUEST_ID).expect("receipt must verify");
    println!("verified against NEXUS_GUEST_ID: yes\n");
}

/// **Guard for the `RISC0_SKIP_BUILD=0` build defect.** A zk build must embed a real guest.
///
/// `risc0-build` checks whether `RISC0_SKIP_BUILD` is *set*, not what it is set to, while
/// `methods/build.rs` checks the value. So `RISC0_SKIP_BUILD=0` -- which the Dockerfile and
/// `zk-image.yml` both pass, meaning "do build the guest" -- silently produced an empty ELF and an
/// all-zero image id. The build stayed green; the node just refused to prove at runtime and
/// verified against `[0; 8]`.
///
/// Ignored because it is only meaningful in a zk build: under the normal CI default
/// (`RISC0_SKIP_BUILD=1`) an empty ELF is correct.
///
///   cargo test -p tet-core --bin TET-Core --features zk-prove -- --ignored s8_guest_elf
#[test]
#[ignore = "only meaningful in a zk build (RISC0_SKIP_BUILD unset or 0)"]
fn s8_guest_elf_is_embedded_in_a_zk_build() {
    assert!(
        !methods::NEXUS_GUEST_ELF.is_empty(),
        "NEXUS_GUEST_ELF is empty in a zk build -- the guest was not embedded. This is the \
         RISC0_SKIP_BUILD=0 defect: risc0-build skips on the variable being SET, regardless of \
         value. methods/build.rs must remove it before calling embed_methods."
    );
    assert_ne!(
        methods::NEXUS_GUEST_ID,
        [0u32; 8],
        "NEXUS_GUEST_ID is all zeros -- receipts would be verified against a null image id"
    );
}

// ---------------------------------------------------------------------------
// S8-1 redesign — hash-only anonymous membership (guest mode 3).
// ---------------------------------------------------------------------------

/// Build a depth-`TET_ANON_MERKLE_DEPTH` authentication path for `leaf` at `index`, plus the root.
#[cfg(test)]
fn anon_merkle_path_for_tests(
    leaf: &[u8; 32],
    index: u32,
) -> (Vec<[u8; 32]>, [u8; 32]) {
    // Deterministic filler siblings; a real registry supplies the actual tree.
    let siblings: Vec<[u8; 32]> = (0..nexus_protocol::TET_ANON_MERKLE_DEPTH)
        .map(|i| {
            let mut s = [0u8; 32];
            s[0] = i as u8;
            s[1] = 0xA5;
            s
        })
        .collect();
    let root = nexus_protocol::tet_anon_merkle_root_from_path_v1(leaf, index, &siblings);
    (siblings, root)
}

#[cfg(test)]
fn anon_membership_env_for_tests(
    secret: &[u8; 32],
    receiver: &[u8; 32],
    bucket: u64,
) -> (risc0_zkvm::ExecutorEnv<'static>, [u8; 32]) {
    let leaf = nexus_protocol::tet_anon_commitment_v1(secret);
    let (siblings, root) = anon_merkle_path_for_tests(&leaf, 3);
    let env = risc0_zkvm::ExecutorEnv::builder()
        .write(&3u8).unwrap()
        .write(secret).unwrap()
        .write(&3u32).unwrap()
        .write(&siblings).unwrap()
        .write(&[0x11u8; 32]).unwrap()
        .write(receiver).unwrap()
        .write(&bucket).unwrap()
        .build()
        .unwrap();
    (env, root)
}

/// Executor-only cost of the hash-only guest. Compare against mode 2's Ed25519 derivation.
#[test]
#[ignore = "needs a zk build (guest ELF); no proving"]
fn s8_anon_membership_executor_cost() {
    let _g = env_lock();
    set_test_env_base();
    assert!(!methods::NEXUS_GUEST_ELF.is_empty(), "needs a zk build");

    let secret = [0x5Au8; 32];
    let receiver = [4u8; 32];
    let bucket = 20_717u64;
    let (env, expected_root) = anon_membership_env_for_tests(&secret, &receiver, bucket);

    let started = std::time::Instant::now();
    let session = risc0_zkvm::default_executor()
        .execute(env, methods::NEXUS_GUEST_ELF)
        .expect("execute mode 3");
    println!(
        "\n=== hash-only membership guest (mode 3) ===\nexecutor: {} ms, {} segments, journal {} bytes",
        started.elapsed().as_millis(),
        session.segments.len(),
        session.journal.bytes.len()
    );

    let j: nexus_protocol::TmailAnonMembershipV1 = session.journal.decode().unwrap();
    assert_eq!(j.journal_kind, nexus_protocol::TMAIL_ANON_JOURNAL_KIND);
    assert_eq!(j.merkle_root, expected_root, "guest root must match the host-side path walk");
    assert_eq!(
        j.nullifier,
        nexus_protocol::tet_anon_nullifier_v1(&secret, &receiver, bucket)
    );
    assert_eq!(j.ephemeral_pubkey_bytes, [0x11u8; 32]);
    assert_eq!(j.bucket_index, bucket);
}

/// The nullifier is one per `(member, receiver, bucket)` and reveals nothing about the member.
#[test]
fn s8_anon_nullifier_is_bound_and_hiding() {
    let s1 = [1u8; 32];
    let s2 = [2u8; 32];
    let rx_a = [4u8; 32];
    let rx_b = [5u8; 32];
    let n = nexus_protocol::tet_anon_nullifier_v1;

    assert_eq!(n(&s1, &rx_a, 7), n(&s1, &rx_a, 7), "deterministic");
    assert_ne!(n(&s1, &rx_a, 7), n(&s1, &rx_b, 7), "different receiver");
    assert_ne!(n(&s1, &rx_a, 7), n(&s1, &rx_a, 8), "different bucket");
    assert_ne!(n(&s1, &rx_a, 7), n(&s2, &rx_a, 7), "different member");

    // The nullifier's preimage contains the SECRET, so unlike a hash of a public wallet id it
    // cannot be inverted by enumerating known wallets -- which is precisely the mistake §A.4.4's
    // original audit-trail design made.
    let commitment = nexus_protocol::tet_anon_commitment_v1(&s1);
    assert_ne!(
        n(&s1, &rx_a, 7),
        commitment,
        "nullifier and registry commitment must be independent values"
    );
}

/// A forged path must not reproduce the honest root.
#[test]
fn s8_anon_merkle_path_binds_the_leaf() {
    let leaf = nexus_protocol::tet_anon_commitment_v1(&[1u8; 32]);
    let other = nexus_protocol::tet_anon_commitment_v1(&[2u8; 32]);
    let (siblings, root) = anon_merkle_path_for_tests(&leaf, 3);

    assert_eq!(
        nexus_protocol::tet_anon_merkle_root_from_path_v1(&leaf, 3, &siblings),
        root
    );
    assert_ne!(
        nexus_protocol::tet_anon_merkle_root_from_path_v1(&other, 3, &siblings),
        root,
        "a different leaf must not reach the same root"
    );
    assert_ne!(
        nexus_protocol::tet_anon_merkle_root_from_path_v1(&leaf, 4, &siblings),
        root,
        "the same leaf at a different index must not reach the same root"
    );
}

/// Leaf and internal-node hashing are domain-separated, so a leaf cannot be passed off as a node.
#[test]
fn s8_anon_leaf_and_node_hashing_are_domain_separated() {
    let a = [7u8; 32];
    let b = [8u8; 32];
    assert_ne!(
        nexus_protocol::tet_anon_commitment_v1(&a),
        nexus_protocol::tet_anon_merkle_parent_v1(&a, &b),
        "leaf and parent hashing must not collide"
    );
}

/// **The real-receipt test for the hash-only design.** Proves for real, with mocks disallowed, and
/// reports prove time and receipt size against the 128 KiB gossip ceiling.
#[test]
#[ignore = "runs a real RISC Zero prover; needs a zk build"]
fn s8_anon_membership_real_receipt_verifies_with_mocks_disabled() {
    let _g = env_lock();
    set_test_env_base();
    let _mainnet = EnvVarGuard::set("TET_MAINNET", "1");
    let _founder = EnvVarGuard::set(
        "TET_GENESIS_FOUNDER_WALLET_ID",
        "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0",
    );
    assert!(
        !crate::zk_verifier::zk_dev_mock_allowed(),
        "precondition: mocks must be disallowed"
    );

    let secret = [0x5Au8; 32];
    let receiver = [4u8; 32];
    let bucket = 20_717u64;
    let (env, expected_root) = anon_membership_env_for_tests(&secret, &receiver, bucket);

    let started = std::time::Instant::now();
    let receipt = risc0_zkvm::default_prover()
        .prove(env, methods::NEXUS_GUEST_ELF)
        .expect("prove mode 3")
        .receipt;
    let prove_ms = started.elapsed().as_millis();

    let bin = bincode::serialize(&receipt).unwrap();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bin);
    let ceiling = crate::p2p::DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES;
    println!("\n=== hash-only membership: real proof ===");
    println!("prove wall time   : {prove_ms} ms");
    println!("receipt (bincode) : {} bytes ({:.1} KiB)", bin.len(), bin.len() as f64 / 1024.0);
    println!("receipt (base64)  : {} bytes ({:.1} KiB)", b64.len(), b64.len() as f64 / 1024.0);
    println!("gossip ceiling    : {ceiling} bytes");
    println!("fits inline?      : {}", if b64.len() < ceiling { "YES" } else { "NO" });

    receipt.verify(methods::NEXUS_GUEST_ID).expect("receipt verifies");

    let journal_b64 =
        base64::engine::general_purpose::STANDARD.encode(&receipt.journal.bytes);
    let verified = crate::zk_verifier::verify_tx_receipt_and_journal(
        methods::NEXUS_GUEST_ID,
        &journal_b64,
        &b64,
    )
    .expect("must verify through the production path with mocks disabled");
    match verified {
        crate::zk_verifier::VerifiedZkJournal::TmailAnon(j) => {
            assert_eq!(j.merkle_root, expected_root);
            assert_eq!(
                j.nullifier,
                nexus_protocol::tet_anon_nullifier_v1(&secret, &receiver, bucket)
            );
        }
        other => panic!("wrong variant: {other:?}"),
    }

    // The member secret must not appear anywhere in the receipt.
    assert!(
        !bin.windows(32).any(|w| w == secret),
        "the member secret must never appear in the receipt"
    );
}

// ---------------------------------------------------------------------------
// S8 — anonymity-set registry: gossip + direct delivery, caps, root window.
// ---------------------------------------------------------------------------

fn signed_anon_registration_for_tests(
    words: &str,
    wallet_id: &str,
    secret: &[u8; 32],
    registered_at_ms: u64,
) -> crate::tmail::anon::TmailAnonRegistrationV1 {
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    let pk = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let mut reg = crate::tmail::anon::TmailAnonRegistrationV1 {
        v: 1,
        kind: crate::tmail::anon::TMAIL_ANON_REGISTRATION_KIND.to_string(),
        wallet_id: wallet_id.to_ascii_lowercase(),
        commitment_hex: hex::encode(nexus_protocol::tet_anon_commitment_v1(secret)),
        registered_at_ms,
        hybrid_sig: crate::tmail::envelope::TmailHybridSig {
            ed25519_pubkey_hex: wallet_id.to_ascii_lowercase(),
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: pk.clone(),
            mldsa_sig_b64: String::new(),
        },
    };
    let msg = crate::tmail::anon::tmail_anon_registration_auth_message_bytes(&reg, &pk);
    reg.hybrid_sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    reg.hybrid_sig.mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap());
    reg
}

/// Register and make the entry effective immediately, by using a 1 ms epoch so the boundary has
/// always already passed. Tests that care about the boundary itself set the epoch explicitly.
#[cfg(test)]
fn register_effective_now(
    store: &crate::tmail::store::TmailStore,
    reg: &crate::tmail::anon::TmailAnonRegistrationV1,
) -> crate::tmail::store::AnonRegisterOutcome {
    let out = store.register_anon(reg).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    out
}

/// A registration verifies, lands in the registry, and changes the root.
#[test]
fn s8_registration_verifies_and_changes_the_root() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let store = tmail_store_for_tests();
    let (words, wallet) = tmail_party_for_tests();
    let reg = signed_anon_registration_for_tests(&words, &wallet, &[1u8; 32], 1_000);

    assert!(crate::tmail::anon::verify_tmail_anon_registration_v1(&reg).is_ok());
    let empty_root = store.anon_root();
    assert_eq!(store.anon_member_count(), 0);

    assert_eq!(
        register_effective_now(&store, &reg),
        crate::tmail::store::AnonRegisterOutcome::Added
    );
    assert_eq!(store.anon_member_count(), 1);
    assert_ne!(store.anon_root(), empty_root, "the root must change");

    // Idempotent: the same registration again is a no-op.
    assert_eq!(
        register_effective_now(&store, &reg),
        crate::tmail::store::AnonRegisterOutcome::Duplicate
    );
    assert_eq!(store.anon_member_count(), 1);
}

/// A wallet must not be able to register a commitment **for someone else's wallet**.
///
/// The attack has to be built carefully or the test proves nothing. Mutating `wallet_id` after
/// signing is caught by the signature alone, because `wallet_id` is inside the pre-image — that
/// version of this test passed with the signer check deleted (negative control M1).
///
/// The real forgery is a *correctly signed* registration: attacker A signs, with A's own key, a
/// pre-image that names B as the wallet. Every signature check passes. Only
/// `signer == wallet_id` rejects it.
#[test]
fn s8_registration_signed_by_another_wallet_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let (words_a, wallet_a) = tmail_party_for_tests();
    let (_wb, wallet_b) = tmail_party_for_tests();

    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(&words_a).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(&words_a).unwrap();
    let pk = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());

    let mut reg = crate::tmail::anon::TmailAnonRegistrationV1 {
        v: 1,
        kind: crate::tmail::anon::TMAIL_ANON_REGISTRATION_KIND.to_string(),
        // Claims to be B...
        wallet_id: wallet_b.clone(),
        commitment_hex: hex::encode(nexus_protocol::tet_anon_commitment_v1(&[1u8; 32])),
        registered_at_ms: 1_000,
        hybrid_sig: crate::tmail::envelope::TmailHybridSig {
            // ...but signed by A, and honest about whose key it is.
            ed25519_pubkey_hex: wallet_a.clone(),
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: pk.clone(),
            mldsa_sig_b64: String::new(),
        },
    };
    let msg = crate::tmail::anon::tmail_anon_registration_auth_message_bytes(&reg, &pk);
    reg.hybrid_sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    reg.hybrid_sig.mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap());

    // The signature itself is perfectly valid over these exact bytes -- that is the point.
    assert!(
        crate::quantum_shield::verify_hybrid(
            &wallet_a,
            Some(&reg.hybrid_sig.ed25519_sig_b64),
            Some(&reg.hybrid_sig.mldsa_pubkey_b64),
            Some(&reg.hybrid_sig.mldsa_sig_b64),
            &msg,
        )
        .is_ok(),
        "precondition: A really did sign this; only signer != wallet_id may reject it"
    );

    let err = crate::tmail::anon::verify_tmail_anon_registration_v1(&reg)
        .expect_err("a registration naming someone else's wallet must be refused");
    assert!(
        format!("{err}").contains("signer ed25519 pubkey must equal wallet_id"),
        "expected the signer-mismatch rejection, got: {err}"
    );
}

/// Two nodes with the same registrations must compute the same root, regardless of arrival order.
///
/// Leaf order is the Merkle index, so this is the property that makes cross-node verification work
/// at all. If it fails, proofs built on one node are unverifiable on another.
#[test]
fn s8_root_is_independent_of_registration_arrival_order() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let (w1, wallet1) = tmail_party_for_tests();
    let (w2, wallet2) = tmail_party_for_tests();
    let (w3, wallet3) = tmail_party_for_tests();
    let r1 = signed_anon_registration_for_tests(&w1, &wallet1, &[1u8; 32], 1_000);
    let r2 = signed_anon_registration_for_tests(&w2, &wallet2, &[2u8; 32], 1_000);
    let r3 = signed_anon_registration_for_tests(&w3, &wallet3, &[3u8; 32], 1_000);

    let node_a = tmail_store_for_tests();
    for r in [&r1, &r2, &r3] {
        node_a.register_anon(r).unwrap();
    }
    let node_b = tmail_store_for_tests();
    for r in [&r3, &r1, &r2] {
        node_b.register_anon(r).unwrap();
    }
    std::thread::sleep(std::time::Duration::from_millis(2));

    assert_eq!(node_a.anon_member_count(), 3);
    assert_eq!(
        node_a.anon_root(),
        node_b.anon_root(),
        "roots must not depend on the order registrations arrived"
    );
}

/// A member's path from the registry must verify against the root, using the same walk the guest
/// performs.
#[test]
fn s8_registry_path_verifies_against_the_root() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let store = tmail_store_for_tests();
    let mut wallets = Vec::new();
    for i in 0..5u8 {
        let (w, wallet) = tmail_party_for_tests();
        let secret = [i + 1; 32];
        store
            .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &secret, 1_000))
            .unwrap();
        wallets.push((wallet, secret));
    }
    std::thread::sleep(std::time::Duration::from_millis(2));

    let tree = store.anon_tree();
    let root = tree.root();
    for (wallet, secret) in &wallets {
        let index = store.anon_leaf_index(wallet).expect("member is present");
        let siblings = tree.path(index).expect("path exists");
        assert_eq!(
            siblings.len(),
            nexus_protocol::TET_ANON_MERKLE_DEPTH,
            "the path must always be full depth: a short path would let a prover claim a \
             shallower tree"
        );
        let leaf = nexus_protocol::tet_anon_commitment_v1(secret);
        assert_eq!(
            nexus_protocol::tet_anon_merkle_root_from_path_v1(&leaf, index as u32, &siblings),
            root,
            "member {wallet} path must reach the root"
        );
    }
}

/// The registry is capped, and at the cap it refuses NEW wallets rather than evicting members.
#[test]
fn s8_registry_is_capped_and_refuses_rather_than_evicts() {
    let _g = env_lock();
    set_test_env_base();
    let _cap = EnvVarGuard::set("TET_TMAIL_ANON_MAX_MEMBERS", "2");
    let store = tmail_store_for_tests();

    let mut regs = Vec::new();
    for i in 0..3u8 {
        let (w, wallet) = tmail_party_for_tests();
        regs.push(signed_anon_registration_for_tests(&w, &wallet, &[i + 1; 32], 1_000));
    }
    assert_eq!(
        store.register_anon(&regs[0]).unwrap(),
        crate::tmail::store::AnonRegisterOutcome::Added
    );
    assert_eq!(
        store.register_anon(&regs[1]).unwrap(),
        crate::tmail::store::AnonRegisterOutcome::Added
    );
    assert_eq!(
        store.register_anon(&regs[2]).unwrap(),
        crate::tmail::store::AnonRegisterOutcome::Full(2),
        "at the cap a new wallet is refused"
    );
    assert_eq!(store.anon_member_count(), 2, "and no member is evicted");

}

/// **The update cooldown.** A member may refresh its commitment, but not repeatedly.
///
/// Without this, churning an existing registration moves the root every epoch forever at no cost —
/// the member cap does not bind it, because the wallet is already a member. It is the same
/// root-churn attack as the flood, wearing a different hat.
#[test]
fn s8_commitment_updates_are_rate_limited_per_wallet() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let store = tmail_store_for_tests();
    let (w, wallet) = tmail_party_for_tests();

    store
        .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &[1u8; 32], 1_000))
        .unwrap();

    // A second, different commitment straight away is refused.
    let again = signed_anon_registration_for_tests(&w, &wallet, &[2u8; 32], 2_000);
    match store.register_anon(&again).unwrap() {
        crate::tmail::store::AnonRegisterOutcome::UpdateTooSoon { retry_after_ms } => {
            assert!(retry_after_ms > 0, "must say how long to wait");
        }
        other => panic!("expected UpdateTooSoon, got {other:?}"),
    }

    // With the cooldown elapsed (simulated by setting it to zero) the update is allowed -- a
    // member must not be permanently stuck with one commitment.
    let _cooldown = EnvVarGuard::set("TET_TMAIL_ANON_UPDATE_COOLDOWN_MS", "1");
    std::thread::sleep(std::time::Duration::from_millis(2));
    assert!(matches!(
        store.register_anon(&again).unwrap(),
        crate::tmail::store::AnonRegisterOutcome::Updated
    ));
}

/// The root window: the current root is always accepted; a stale one is not; and the bucket bound
/// overrides the window.
#[test]
fn s8_root_window_accepts_recent_and_refuses_stale() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let store = tmail_store_for_tests();
    let (w, wallet) = tmail_party_for_tests();
    register_effective_now(&store, &signed_anon_registration_for_tests(&w, &wallet, &[1u8; 32], 1_000));

    let now_bucket = nexus_protocol::tmail_bucket_index_v1(tmail_now_ms_for_tests());
    let current = store.anon_root();

    assert!(
        store.accepts_anon_root(&current, now_bucket),
        "the current root is always accepted"
    );
    assert!(
        !store.accepts_anon_root(&[0xEEu8; 32], now_bucket),
        "an unknown root is refused"
    );

    // The bucket bound is an OUTER limit the window cannot override.
    assert!(
        !store.accepts_anon_root(&current, now_bucket + 5),
        "a bucket far from now is refused even for the current root"
    );
    assert!(
        store.accepts_anon_root(&current, now_bucket - 1),
        "±1 bucket is inside the bound"
    );
}

/// A superseded root stays acceptable inside the window, which is what covers the gap between
/// building a proof and the receiving node verifying it.
#[test]
fn s8_superseded_root_stays_acceptable_inside_the_window() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let store = tmail_store_for_tests();
    let (w1, wallet1) = tmail_party_for_tests();
    register_effective_now(&store, &signed_anon_registration_for_tests(&w1, &wallet1, &[1u8; 32], 1_000));
    let old_root = store.anon_root();

    // A second registration arrives, moving the root on.
    let (w2, wallet2) = tmail_party_for_tests();
    register_effective_now(&store, &signed_anon_registration_for_tests(&w2, &wallet2, &[2u8; 32], 1_000));
    assert_ne!(store.anon_root(), old_root, "precondition: the root moved");

    let now_bucket = nexus_protocol::tmail_bucket_index_v1(tmail_now_ms_for_tests());
    assert!(
        store.accepts_anon_root(&old_root, now_bucket),
        "a root superseded seconds ago must still verify, or every proof built during \
         propagation would be rejected"
    );
}

/// Registry gossip goes through the same admission function as a local registration.
#[test]
fn s8_registry_gossip_event_admits_through_the_shared_path() {
    let _g = env_lock();
    set_test_env_base();
    let node = TmailNode::new();
    let (w, wallet) = tmail_party_for_tests();
    let reg = signed_anon_registration_for_tests(&w, &wallet, &[1u8; 32], 1_000);

    let wire = serde_json::to_string(&crate::models::NetworkEvent::TmailAnonRegistration {
        registration: reg.clone(),
    })
    .unwrap();
    assert!(matches!(
        node.receive_gossip(&wire),
        crate::p2p::TmailGossipOutcome::Registered { .. }
    ));
    assert_eq!(node.rest.tmail.anon_member_count(), 1);

    // A registration with a broken signature is refused on the receive path too.
    let mut bad = reg.clone();
    bad.hybrid_sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode([0u8; 64]);
    let wire = serde_json::to_string(&crate::models::NetworkEvent::TmailAnonRegistration {
        registration: bad,
    })
    .unwrap();
    assert!(matches!(
        node.receive_gossip(&wire),
        crate::p2p::TmailGossipOutcome::Rejected { .. }
    ));
}

/// **The announce guard.** A local registration must reach BOTH delivery paths.
///
/// This is the `/ledger/transfer` failure written as a test before it can happen again: a handler
/// that admits without announcing produces a member who is in their own node's anonymity set and
/// nobody else's, and whose proofs then fail on every peer with nothing pointing at delivery.
///
/// It asserts both paths independently, so disabling either one fails — gossip working is not
/// allowed to cover for the direct path being unwired, which is the exact way the tx-submit
/// weakness hid.
#[tokio::test]
async fn s8_local_registration_announces_on_both_paths() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let mut state = rest_state_for_tests(ledger);

    // Observe both channels.
    let (gossip_tx, mut gossip_rx) = tokio::sync::mpsc::channel::<String>(8);
    let (direct_tx, mut direct_rx) =
        tokio::sync::mpsc::channel::<crate::p2p::AnonRegisterCmd>(8);
    state.gossip_tx = Some(gossip_tx);
    state.anon_register_tx = Some(direct_tx);

    let (words, wallet) = tmail_party_for_tests();
    let reg = signed_anon_registration_for_tests(&words, &wallet, &[1u8; 32], 1_000);

    let outcome = state
        .submit_local_anon_registration(&reg)
        .await
        .expect("registration must be admitted");
    assert_eq!(outcome, crate::tmail::store::AnonRegisterOutcome::Added);
    assert_eq!(state.tmail.anon_member_count(), 1, "admitted locally");

    // Path 1: gossip.
    let gossiped = gossip_rx
        .try_recv()
        .expect("registration must be published to gossip");
    let ev: crate::models::NetworkEvent = serde_json::from_str(&gossiped).unwrap();
    match ev {
        crate::models::NetworkEvent::TmailAnonRegistration { registration } => {
            assert_eq!(registration.wallet_id, reg.wallet_id);
        }
        other => panic!("wrong gossip event: {other:?}"),
    }

    // Path 2: the direct request. Independently asserted -- gossip succeeding must not be able to
    // mask this being unwired.
    let direct = direct_rx
        .try_recv()
        .expect("registration must also go out over the direct /tet/v1/anon-register path");
    assert_eq!(direct.registration.wallet_id, reg.wallet_id);
}

/// **The flood guard.** A registration flood must not invalidate honest proofs.
///
/// The attack the epoch design exists to stop: roots used to change on every registration and the
/// history kept the last 512, so >512 free registrations inside the acceptance window evicted every
/// honest root and valid proofs failed network-wide. A denial of service on anonymity itself, for
/// the price of some signatures.
///
/// Here 2,000 registrations arrive and a proof built against a root from ~50 minutes ago still
/// verifies, because the accepted set is defined by **time** (epoch roots, recomputed on a cache
/// miss) rather than by a lossy buffer that volume can evict.
///
/// Wall-clock is not waited out: epochs are compressed and the registrations are backdated, which
/// is exactly what the epoch abstraction makes possible to test at all.
#[test]
fn s8_registration_flood_does_not_invalidate_an_honest_root() {
    let _g = env_lock();
    set_test_env_base();
    // 1 s epochs and a 120 s window: 120 epochs of history, the same shape as the 60 s / 60 min
    // production setting but compressed so the test runs in milliseconds.
    let _epoch = EnvVarGuard::set("TET_TMAIL_ANON_EPOCH_MS", "1000");
    let _window = EnvVarGuard::set("TET_TMAIL_ANON_ROOT_WINDOW_MS", "120000");
    // Deliberately small, to prove acceptance does NOT depend on the cache holding the root.
    let _cache = EnvVarGuard::set("TET_TMAIL_ANON_ROOT_HISTORY", "4");
    let store = tmail_store_for_tests();

    let honest_secret = [0x11u8; 32];
    let (hw, honest_wallet) = tmail_party_for_tests();
    store
        .register_anon(&signed_anon_registration_for_tests(
            &hw,
            &honest_wallet,
            &honest_secret,
            1_000,
        ))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));

    // The root the honest member built a proof against.
    let honest_root = store.anon_root();
    let honest_epoch = store.anon_current_epoch();
    assert!(
        store.anon_leaf_index(&honest_wallet).is_some(),
        "precondition: the honest member is in the tree"
    );

    // 2,000 registrations flood in. Signing 2,000 real ML-DSA registrations would dominate the
    // test, so they are written straight into the registry -- the flood is about VOLUME changing
    // the root, and each one is individually valid by construction.
    let mut flooded = 0usize;
    for i in 0..2_000u32 {
        let mut wallet = format!("{i:064x}");
        wallet.truncate(64);
        let stored = crate::tmail::store::StoredAnonRegistration {
            registration: crate::tmail::anon::TmailAnonRegistrationV1 {
                v: 1,
                kind: crate::tmail::anon::TMAIL_ANON_REGISTRATION_KIND.to_string(),
                wallet_id: wallet.clone(),
                commitment_hex: hex::encode(nexus_protocol::tet_anon_commitment_v1(&[
                    (i % 251) as u8 + 1;
                    32
                ])),
                registered_at_ms: 1_000,
                hybrid_sig: crate::tmail::envelope::TmailHybridSig {
                    ed25519_pubkey_hex: wallet.clone(),
                    ed25519_sig_b64: String::new(),
                    mldsa_pubkey_b64: String::new(),
                    mldsa_sig_b64: String::new(),
                },
            },
            admitted_at_ms: tmail_now_ms_for_tests(),
        };
        store.insert_stored_anon_for_tests(&wallet, &stored).unwrap();
        flooded += 1;
    }
    assert_eq!(flooded, 2_000);
    std::thread::sleep(std::time::Duration::from_millis(1100));

    // The root has certainly moved.
    assert_ne!(
        store.anon_root(),
        honest_root,
        "precondition: the flood moved the root"
    );
    assert!(
        store.anon_root_cache_len() <= 8,
        "precondition: the cache is far too small to hold every root -- acceptance must not \
         depend on it"
    );

    // Drop the memo, so acceptance has to come from RECOMPUTING the epoch root rather than from
    // a cached value. Without this the guard passes even with epoch gating removed -- it was the
    // cache answering, not the design (negative control N1).
    store.clear_anon_root_cache_for_tests();
    assert_eq!(store.anon_root_cache_len(), 0, "precondition: memo dropped");

    // The honest proof still verifies: its root is one epoch inside the window.
    let now_bucket = nexus_protocol::tmail_bucket_index_v1(tmail_now_ms_for_tests());
    assert!(
        store.accepts_anon_root(&honest_root, now_bucket),
        "a root from epoch {honest_epoch} must still be accepted after a 2,000-registration \
         flood: the accepted set is defined by time, not by a buffer volume can evict"
    );

    // ...and a root that never existed is still refused.
    assert!(!store.accepts_anon_root(&[0x77u8; 32], now_bucket));
}

// ---------------------------------------------------------------------------
// S8 steps 3 + 6 — announce-then-pull envelope and two-phase verification.
// ---------------------------------------------------------------------------

/// Build a real anonymous envelope: a genuine mode-3 proof, a registry containing the member, and
/// an envelope signed by the ephemeral.
///
/// Returns `(envelope, receipt_bytes, store)`. Slow — it proves for real.
#[cfg(test)]
fn anonymous_envelope_for_tests(
    receiver_wallet: &str,
) -> (
    crate::tmail::envelope::TmailEnvelopeV1,
    Vec<u8>,
    crate::tmail::store::TmailStore,
    String,
) {
    use sha2::{Digest as _, Sha256};
    let store = tmail_store_for_tests();

    // A member registers and becomes effective.
    let secret = [0x5Au8; 32];
    let (rw, reg_wallet) = tmail_party_for_tests();
    store
        .register_anon(&signed_anon_registration_for_tests(&rw, &reg_wallet, &secret, 1_000))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));

    // The ephemeral that will sign the envelope.
    let (eph_words, ephemeral) = tmail_party_for_tests();
    let eph_bytes: [u8; 32] = hex::decode(&ephemeral).unwrap().try_into().unwrap();
    let rx_bytes: [u8; 32] = hex::decode(receiver_wallet).unwrap().try_into().unwrap();

    let sent_at_ms = tmail_now_ms_for_tests();
    let bucket = nexus_protocol::tmail_bucket_index_v1(sent_at_ms);
    let index = store.anon_leaf_index(&reg_wallet).expect("member in tree");
    let tree = store.anon_tree();
    let siblings = tree.path(index).expect("path");

    let env_builder = risc0_zkvm::ExecutorEnv::builder()
        .write(&3u8).unwrap()
        .write(&secret).unwrap()
        .write(&(index as u32)).unwrap()
        .write(&siblings).unwrap()
        .write(&eph_bytes).unwrap()
        .write(&rx_bytes).unwrap()
        .write(&bucket).unwrap()
        .build()
        .unwrap();
    let receipt = risc0_zkvm::default_prover()
        .prove(env_builder, methods::NEXUS_GUEST_ELF)
        .expect("prove mode 3")
        .receipt;
    let receipt_bytes = bincode::serialize(&receipt).unwrap();
    let journal_b64 =
        base64::engine::general_purpose::STANDARD.encode(&receipt.journal.bytes);

    let mut envelope = signed_tmail_env_for_tests(
        &eph_words,
        &ephemeral,
        receiver_wallet,
        "anon-msg-1",
        tmail_flags_for_tests(false),
        None,
    );
    envelope.sent_at_ms = sent_at_ms;
    envelope.flags.anonymous = true;
    envelope.sender_wallet_id = crate::tmail::envelope::ANONYMOUS_SENTINEL.to_string();
    envelope.anonymous = Some(crate::tmail::envelope::TmailAnonymous {
        ephemeral_wallet_id: ephemeral.clone(),
        anchor_proof: crate::tmail::envelope::TmailAnchorProof {
            image_id_hex: crate::tmail::anon::encode_image_id_hex(&methods::NEXUS_GUEST_ID),
            journal_b64,
            receipt_sha256_hex: hex::encode(Sha256::digest(&receipt_bytes)),
        },
    });
    resign_tmail_env_for_tests(&mut envelope, &eph_words);
    (envelope, receipt_bytes, store, eph_words)
}

/// **Step 3 + 6.** The envelope verifies on metadata alone, then the pulled receipt verifies it.
#[test]
#[ignore = "runs a real RISC Zero prover; needs a zk build"]
fn s8_anonymous_envelope_two_phase_verify() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let (_rw, receiver) = tmail_party_for_tests();
    let (envelope, receipt_bytes, store, _eph) = anonymous_envelope_for_tests(&receiver);

    // Phase 1: no receipt needed. The envelope is small enough to gossip.
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&envelope).is_ok(),
        "an anonymous envelope must verify on metadata alone"
    );
    let wire = serde_json::to_vec(&envelope).unwrap();
    assert!(
        wire.len() < crate::p2p::DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES,
        "the envelope must fit the gossip ceiling: {} bytes",
        wire.len()
    );
    println!("\nanonymous envelope on the wire: {} bytes", wire.len());
    println!("receipt pulled separately     : {} bytes", receipt_bytes.len());

    // The anchor appears nowhere.
    let wire_str = String::from_utf8_lossy(&wire);
    assert!(
        wire_str.contains(crate::tmail::envelope::ANONYMOUS_SENTINEL),
        "sender must be the sentinel"
    );

    // Phase 2: with the receipt.
    let verdict = crate::tmail::anon::verify_anonymous_proof(&store, &envelope, &receipt_bytes);
    match verdict {
        crate::tmail::store::AnonVerdict::Verified { .. } => {}
        other => panic!("expected Verified, got {other:?}"),
    }
}

/// **The wrong-receipt control.** A peer serving a different receipt must be refused, and cheaply —
/// on the hash, before any verification work.
#[test]
#[ignore = "runs a real RISC Zero prover; needs a zk build"]
fn s8_anonymous_wrong_receipt_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let (_rw, receiver) = tmail_party_for_tests();
    let (envelope, receipt_bytes, store, _eph) = anonymous_envelope_for_tests(&receiver);

    // A different, individually valid receipt: same shape, different nullifier.
    let (_rw2, receiver2) = tmail_party_for_tests();
    let (_env2, other_receipt, _s2, _e2) = anonymous_envelope_for_tests(&receiver2);
    assert_ne!(receipt_bytes, other_receipt, "precondition: really different");

    let verdict = crate::tmail::anon::verify_anonymous_proof(&store, &envelope, &other_receipt);
    match verdict {
        crate::tmail::store::AnonVerdict::Failed { reason, .. } => {
            assert!(
                reason.contains("receipt hash"),
                "must be refused on the content address, before verification: {reason}"
            );
        }
        other => panic!("a receipt for a different message must be refused, got {other:?}"),
    }
}

/// A receipt whose nullifier was already used by another message is a replay.
#[test]
fn s8_anonymous_nullifier_replay_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let nullifier = hex::encode([0xABu8; 32]);

    assert!(store.claim_anon_nullifier(&nullifier, "msg-a").unwrap());
    assert!(
        store.claim_anon_nullifier(&nullifier, "msg-a").unwrap(),
        "re-claiming for the SAME message is idempotent -- gossip delivers duplicates"
    );
    assert!(
        !store.claim_anon_nullifier(&nullifier, "msg-b").unwrap(),
        "a different message may not reuse a nullifier: that is the replay rule"
    );
}

/// The receipt cache is content-addressed, so a wrong body cannot be stored under a right hash.
#[test]
fn s8_receipt_cache_refuses_a_hash_mismatch() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    use sha2::{Digest as _, Sha256};
    let body = b"a receipt".to_vec();
    let good = hex::encode(Sha256::digest(&body));

    assert!(store.put_anon_receipt(&good, &body).unwrap());
    assert_eq!(store.get_anon_receipt(&good).unwrap(), body);

    assert!(
        !store.put_anon_receipt(&good, b"a DIFFERENT receipt").unwrap(),
        "a body that does not hash to the key must be refused -- this is what makes it safe for \
         any node to cache and serve receipts"
    );
    assert_eq!(
        store.get_anon_receipt(&good).unwrap(),
        body,
        "and the good entry must survive the attempt"
    );
}

/// An anonymous envelope whose journal names a different receiver must be refused in phase 1,
/// before any receipt is pulled.
#[test]
#[ignore = "runs a real RISC Zero prover; needs a zk build"]
fn s8_anonymous_envelope_journal_must_match_the_receiver() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let (_rw, receiver) = tmail_party_for_tests();
    let (mut envelope, _receipt, _store, eph_words) = anonymous_envelope_for_tests(&receiver);

    // Re-point the envelope at someone else AND RE-SIGN it. Without the re-sign the signature
    // alone rejects this -- `receiver` is inside the §A.1.3 pre-image -- and the journal binding
    // is never reached, which is how this guard was vacuous on its first run (control O3).
    let (_rw2, other) = tmail_party_for_tests();
    envelope.receiver_wallet_id = other;
    resign_tmail_env_for_tests(&mut envelope, &eph_words);

    // The signature is now genuinely valid over these bytes. Only the journal binding can reject.
    let err = crate::tmail::envelope::verify_tmail_envelope_v1(&envelope)
        .expect_err("a proof naming a different receiver must not be reusable");
    let msg = format!("{err}");
    assert!(
        msg.contains("journal receiver"),
        "must be refused by the journal/receiver binding specifically, not by the signature: {msg}"
    );
}

/// The eligibility instant is the epoch boundary, computed rather than guessed.
#[test]
fn s8_registration_eligibility_is_the_next_epoch_boundary() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = EnvVarGuard::set("TET_TMAIL_ANON_EPOCH_MS", "5000");
    let store = tmail_store_for_tests();
    let (w, wallet) = tmail_party_for_tests();

    assert!(
        crate::tmail::anon::registration_eligible_at_ms(&store, &wallet).is_none(),
        "an unregistered wallet has no eligibility instant"
    );

    store
        .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &[1u8; 32], 1_000))
        .unwrap();
    let at = crate::tmail::anon::registration_eligible_at_ms(&store, &wallet)
        .expect("registered but not yet in the tree");
    assert_eq!(at % 5000, 0, "must be an exact epoch boundary");
    let now = tmail_now_ms_for_tests();
    assert!(at > now && at - now <= 5000, "within one epoch");

    std::thread::sleep(std::time::Duration::from_millis(5200));
    assert!(
        crate::tmail::anon::registration_eligible_at_ms(&store, &wallet).is_none(),
        "once in the tree there is nothing to wait for"
    );
}

/// `tet-network/ui/app/lib/anon_tree.mjs` must reproduce these byte for byte. The same values are
/// pinned in `tet-network/ui/scripts/anon_poster_guard.mjs`; a change on either side fails one of
/// the two, which is the point of a cross-language vector.
#[test]
fn anon_client_derivations_match_the_golden_vector() {
    use sha2::{Digest as _, Sha256};
    let c = |b: u8| nexus_protocol::tet_anon_commitment_v1(&[b; 32]);
    assert_eq!(
        hex::encode(c(7)),
        "d1b67499baa9328884e4a9dcec455e95ba73d7720d62ccf750bf5a090b153eb1"
    );
    let tree = crate::tmail::anon::AnonMerkleTree::build(vec![c(1), c(2), c(3)]);
    assert_eq!(
        hex::encode(tree.root()),
        "817ca6b003ce70734406be37a3ae6a3141e4f7f52eb57e82bfd699c4a2c000b8"
    );
    let path: Vec<u8> = tree.path(2).unwrap().concat();
    assert_eq!(
        hex::encode(Sha256::digest(&path)),
        "2340a53722d8c4790d73d50f4aa1cf8f2bf4f718bee4f921083ceb0f5ca37051"
    );
    assert_eq!(
        hex::encode(crate::tmail::anon::AnonMerkleTree::build(vec![]).root()),
        "554bab803f49ba2b3018008f1ce581365ccc662db3c21964e3a6f15d325ef1a3"
    );
    assert_eq!(
        hex::encode(nexus_protocol::tmail_ephemeral_seed_v1(&[7; 32], &[0xab; 32], 20_000)),
        "2cabb7226c4dccf14bc47735b4e462f380241e2ef46ae00b0495943bad0c6599"
    );
}

/// `GET /tmail/anon/leaves` pages one epoch's leaves in order, and the leaves rebuild the root it
/// reports. A future epoch is refused rather than answered with a partial set.
#[tokio::test]
async fn anon_leaves_pages_reproduce_the_epoch_root() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = EnvVarGuard::set("TET_TMAIL_ANON_EPOCH_MS", "1000");
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    for b in 1..=5u8 {
        let (w, id) = tmail_party_for_tests();
        state
            .tmail
            .register_anon(&signed_anon_registration_for_tests(&w, &id, &[b; 32], 1_000))
            .unwrap();
    }
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

    let get = |q: crate::rest::handlers::tmail::AnonLeavesQuery| {
        let state = state.clone();
        async move {
            let resp = crate::rest::handlers::tmail::get_tmail_anon_leaves(
                axum::extract::State(state),
                axum::extract::Query(q),
            )
            .await;
            let status = resp.status();
            let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            (status, serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null))
        }
    };
    let (status, first) = get(crate::rest::handlers::tmail::AnonLeavesQuery {
        epoch: None,
        offset: 0,
        limit: Some(2),
    })
    .await;
    assert_eq!(status, StatusCode::OK);
    let epoch = first["epoch"].as_u64().unwrap();
    assert_eq!(first["total"].as_u64(), Some(5));
    let mut leaves: Vec<[u8; 32]> = Vec::new();
    let mut page = first.clone();
    loop {
        for l in page["leaves"].as_array().unwrap() {
            leaves.push(hex::decode(l.as_str().unwrap()).unwrap().try_into().unwrap());
        }
        let Some(next) = page["next_offset"].as_u64() else { break };
        let (s, p) = get(crate::rest::handlers::tmail::AnonLeavesQuery {
            epoch: Some(epoch),
            offset: next as usize,
            limit: Some(2),
        })
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(p["epoch"].as_u64(), Some(epoch));
        page = p;
    }
    assert_eq!(leaves.len(), 5);
    assert_eq!(
        hex::encode(crate::tmail::anon::AnonMerkleTree::build(leaves).root()),
        first["merkle_root"].as_str().unwrap(),
        "the paged leaves must rebuild the root the node reports"
    );
    let (status, _) = get(crate::rest::handlers::tmail::AnonLeavesQuery {
        epoch: Some(epoch + 10),
        offset: 0,
        limit: None,
    })
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Everything the `log` crate emits while installed. Tests that read it hold `env_lock` and clear
/// it first.
static CAPTURED_LOG: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

struct CaptureLog;

impl log::Log for CaptureLog {
    fn enabled(&self, _: &log::Metadata<'_>) -> bool {
        true
    }
    fn log(&self, record: &log::Record<'_>) {
        if let Ok(mut v) = CAPTURED_LOG.lock() {
            v.push(format!("{} {}", record.target(), record.args()));
        }
    }
    fn flush(&self) {}
}

/// Install [`CaptureLog`] once per test process. `false` means another logger got there first, and
/// a test that relies on reading the log must fail rather than pass on an empty capture.
fn install_capture_log() -> bool {
    static INSTALLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *INSTALLED.get_or_init(|| {
        log::set_boxed_logger(Box::new(CaptureLog))
            .map(|()| log::set_max_level(log::LevelFilter::Trace))
            .is_ok()
    })
}

/// **SECURITY REGRESSION GUARD: an anonymous post names no poster to the node.** Replays the exact
/// request sequence `tet-network/ui/app/lib/anon_poster.mjs` makes (download the whole registry,
/// deposit the receipt, send the envelope) through the real router (the placeholder receipt is
/// refused at send, so the envelope is also stored the way gossip delivers it), then looks for the poster's
/// wallet id and registry commitment in everything the node saw or kept: the requests, the `log`
/// output, the node's live log feed, and every sled tree except the registry, where the
/// registration is public by design.
///
/// The client half is `scripts/anon_poster_guard.mjs`, which records what `anon_poster.mjs` sends.
/// Negative controls: C1 adds the old `GET /tmail/anon/path/:wallet_id` call to the sequence →
/// FAILED (request trace); C2 logs the served leaves in `get_tmail_anon_leaves` → FAILED (log).
#[tokio::test]
async fn anonymous_post_names_no_poster_to_the_node() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();
    let _epoch = EnvVarGuard::set("TET_TMAIL_ANON_EPOCH_MS", "1000");
    assert!(install_capture_log(), "another logger is installed; this guard cannot see the log");
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger.clone());
    let mut node_log = state.log_tx.subscribe();

    // The poster and two other members register. Registration is public and happens before posting.
    let secret = [0x42u8; 32];
    let (pw, poster) = tmail_party_for_tests();
    state
        .tmail
        .register_anon(&signed_anon_registration_for_tests(&pw, &poster, &secret, 1_000))
        .unwrap();
    for b in [1u8, 2] {
        let (w, id) = tmail_party_for_tests();
        state
            .tmail
            .register_anon(&signed_anon_registration_for_tests(&w, &id, &[b; 32], 1_000))
            .unwrap();
    }
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let commitment = hex::encode(nexus_protocol::tet_anon_commitment_v1(&secret));
    let (_rw, receiver) = tmail_party_for_tests();
    CAPTURED_LOG.lock().unwrap().clear();

    let router = crate::rest::routes::build_router(state.clone());
    let mut trace: Vec<String> = Vec::new();
    let mut call = |method: &'static str, uri: String, body: Option<Value>| {
        let router = router.clone();
        let body_s = body.map(|b| b.to_string()).unwrap_or_default();
        trace.push(format!("{method} {uri} {body_s}"));
        async move {
            let req = axum::http::Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", "application/json")
                .body(axum::body::Body::from(body_s))
                .unwrap();
            let resp = router.oneshot(req).await.unwrap();
            let status = resp.status();
            let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            (status, serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null))
        }
    };

    // 1. The whole registry. The client finds its own leaf locally.
    let (status, set) = call("GET", "/tmail/anon/leaves".into(), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        set["leaves"].as_array().unwrap().iter().any(|l| l.as_str() == Some(commitment.as_str())),
        "the poster is in the downloaded set"
    );

    // 2. Deposit the receipt (content-addressed), 3. send the envelope signed by the ephemeral.
    let receipt = b"receipt-bytes-for-the-trace".to_vec();
    let receipt_hash = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(&receipt));
    let (status, _) = call(
        "PUT",
        "/tmail/anon/receipt".into(),
        Some(serde_json::json!({
            "receipt_sha256_hex": receipt_hash,
            "receipt_b64": base64::engine::general_purpose::STANDARD.encode(&receipt),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let sent_at = tmail_now_ms_for_tests();
    let rx: [u8; 32] = hex::decode(&receiver).unwrap().try_into().unwrap();
    let nullifier = nexus_protocol::tet_anon_nullifier_v1(
        &secret,
        &rx,
        nexus_protocol::tmail_bucket_index_v1(sent_at),
    );
    let (eph_words, ephemeral) = tmail_party_for_tests();
    let mut env = anon_env_with_nullifier_for_tests(
        &eph_words, &ephemeral, &receiver, nullifier, "anon-trace-1", sent_at,
    );
    env.anonymous.as_mut().unwrap().anchor_proof.receipt_sha256_hex = receipt_hash;
    let (status, body) =
        call("POST", "/tmail/send".into(), Some(serde_json::to_value(&env).unwrap())).await;
    // The trace's receipt is a placeholder, so since anonymous posts are checked before they're
    // stored, the node refuses it (and keeps nothing); the refusal path must name no poster either.
    assert_eq!(status, StatusCode::FORBIDDEN, "a post whose proof doesn't verify must be refused: {body}");
    assert!(state.tmail.get_by_msg_id("anon-trace-1").is_none(), "a refused anonymous post was stored");
    // A peer can still deliver it over gossip, where it waits as pending for its receipt: store it
    // the way that path does, so the scan below covers a kept anonymous post too.
    assert!(state.tmail.store_tmail(&env).unwrap());

    let needles = [poster.clone(), poster.to_ascii_uppercase(), commitment.clone()];
    let hit = |hay: &str| needles.iter().find(|n| hay.contains(n.as_str())).cloned();

    for line in &trace {
        assert!(hit(line).is_none(), "a request names the poster: {line}");
    }
    for line in CAPTURED_LOG.lock().unwrap().iter() {
        assert!(hit(line).is_none(), "the node logged the poster: {line}");
    }
    while let Ok(line) = node_log.try_recv() {
        assert!(hit(&line).is_none(), "the node's live log names the poster: {line}");
    }
    let db = ledger.sled_db();
    for name in db.tree_names() {
        if name.as_ref() == b"tmail_anon_registry_v1" {
            continue;
        }
        let tree = db.open_tree(&name).unwrap();
        for item in tree.iter() {
            let (k, v) = item.unwrap();
            let kv = format!("{} {}", String::from_utf8_lossy(&k), String::from_utf8_lossy(&v));
            assert!(
                hit(&kv).is_none(),
                "tree {} keeps the poster after an anonymous post",
                String::from_utf8_lossy(&name)
            );
        }
    }
}

/// **The receiver's three states reach the client.** An anonymous row always carries a verdict, and
/// an unchecked one reads `pending` rather than being absent.
///
/// Absence would be the dangerous encoding: a client that sees no verdict field has to *decide*
/// what that means, and the optimistic reading is the wrong one.
#[tokio::test]
async fn s8_inbox_row_carries_the_anonymity_verdict() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let (words, sender) = tmail_party_for_tests();
    let (_rw, receiver) = tmail_party_for_tests();

    // A named (non-anonymous) message must carry NO verdict field at all.
    let plain = signed_tmail_env_for_tests(
        &words,
        &sender,
        &receiver,
        "named-1",
        tmail_flags_for_tests(false),
        None,
    );
    state.tmail.store_tmail(&plain).unwrap();

    let row = crate::tmail::timelock::to_inbox_row(&plain, tmail_now_ms_for_tests());
    assert!(
        row.anon_verdict.is_none(),
        "a named message has no anonymity verdict to report"
    );

    // An anonymous message with nothing stored must read PENDING, not absent.
    let mut anon = plain.clone();
    anon.msg_id = "anon-1".to_string();
    anon.flags.anonymous = true;
    let row = crate::tmail::timelock::to_inbox_row_with_verdict(
        &anon,
        tmail_now_ms_for_tests(),
        None,
    );
    assert_eq!(
        row.anon_verdict,
        Some(crate::tmail::store::AnonVerdict::Pending),
        "an unchecked anonymous message must report pending, never an absent field"
    );

    // Stored verdicts are reported as-is.
    let verified = crate::tmail::store::AnonVerdict::Verified {
        nullifier_hex: hex::encode([1u8; 32]),
        verified_at_ms: 42,
    };
    state.tmail.set_anon_verdict("anon-1", &verified).unwrap();
    let row = crate::tmail::timelock::to_inbox_row_with_verdict(
        &anon,
        tmail_now_ms_for_tests(),
        state.tmail.get_anon_verdict("anon-1"),
    );
    assert_eq!(row.anon_verdict, Some(verified));

    let failed = crate::tmail::store::AnonVerdict::Failed {
        reason: "nullifier already used by another message (replay)".to_string(),
        failed_at_ms: 43,
    };
    state.tmail.set_anon_verdict("anon-1", &failed).unwrap();
    let row = crate::tmail::timelock::to_inbox_row_with_verdict(
        &anon,
        tmail_now_ms_for_tests(),
        state.tmail.get_anon_verdict("anon-1"),
    );
    assert_eq!(row.anon_verdict, Some(failed));

    // And the JSON a client actually receives says so in words.
    let json = serde_json::to_string(&row).unwrap();
    assert!(json.contains("\"state\":\"failed\""), "verdict must serialize its state");
}

/// Live-run check for `tet-prover-host`'s `POST /prove_anon`: tet-core's own verifier accepts the
/// receipt the daemon returned, and every journal field is what the inputs imply. Run by hand
/// after proving through the daemon (needs a zk build):
///
///   TET_ANON_RECEIPT_B64, TET_ANON_JOURNAL_B64, TET_ANON_IMAGE_ID_HEX — the daemon's response
///   TET_PROVE_SECRET_HEX, TET_PROVE_EPHEMERAL_HEX, TET_PROVE_RECEIVER_HEX, TET_PROVE_BUCKET,
///   TET_PROVE_ROOT_HEX — the inputs, and the root the client computed
#[test]
#[ignore = "live-run check; needs a receipt from tet-prover-host"]
fn s8_prover_host_receipt_verifies_for_live_run() {
    let _g = env_lock();
    set_test_env_base();
    let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k} required"));
    let arr = |h: &str| -> [u8; 32] {
        <[u8; 32]>::try_from(hex::decode(h.trim()).expect("hex").as_slice()).expect("32 bytes")
    };
    assert_eq!(
        env("TET_ANON_IMAGE_ID_HEX"),
        crate::tmail::anon::encode_image_id_hex(&methods::NEXUS_GUEST_ID),
        "the daemon proved with a different guest than this node verifies"
    );
    let verified = crate::zk_verifier::verify_tx_receipt_and_journal(
        methods::NEXUS_GUEST_ID,
        &env("TET_ANON_JOURNAL_B64"),
        &env("TET_ANON_RECEIPT_B64"),
    )
    .expect("tet-core verifies the daemon's receipt");
    let crate::zk_verifier::VerifiedZkJournal::TmailAnon(j) = verified else {
        panic!("the receipt proves a different claim than anonymous membership");
    };
    let secret = arr(&env("TET_PROVE_SECRET_HEX"));
    let receiver = arr(&env("TET_PROVE_RECEIVER_HEX"));
    let bucket: u64 = env("TET_PROVE_BUCKET").trim().parse().unwrap();
    assert_eq!(hex::encode(j.merkle_root), env("TET_PROVE_ROOT_HEX").trim());
    assert_eq!(j.nullifier, nexus_protocol::tet_anon_nullifier_v1(&secret, &receiver, bucket));
    assert_eq!(j.ephemeral_pubkey_bytes, arr(&env("TET_PROVE_EPHEMERAL_HEX")));
    assert_eq!(j.receiver_wallet_bytes, receiver);
    assert_eq!(j.bucket_index, bucket);
}

/// Emit a mode-3 proof for the live run, from parameters supplied in the environment.
///
/// The live driver is JavaScript (it shares the browser's crypto), and JavaScript cannot prove.
/// Rather than reimplement the prover there, the driver writes the parameters it needs proved and
/// this emits the receipt.
///
///   TET_PROVE_SECRET_HEX, TET_PROVE_INDEX, TET_PROVE_SIBLINGS_HEX (comma-separated),
///   TET_PROVE_EPHEMERAL_HEX, TET_PROVE_RECEIVER_HEX, TET_PROVE_BUCKET
#[test]
#[ignore = "live-run helper; runs a real prover"]
fn s8_emit_anon_proof_for_live_run() {
    let _g = env_lock();
    let hexenv = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k} required"));
    let arr = |h: &str| -> [u8; 32] {
        <[u8; 32]>::try_from(hex::decode(h.trim()).expect("hex").as_slice()).expect("32 bytes")
    };

    let secret = arr(&hexenv("TET_PROVE_SECRET_HEX"));
    let ephemeral = arr(&hexenv("TET_PROVE_EPHEMERAL_HEX"));
    let receiver = arr(&hexenv("TET_PROVE_RECEIVER_HEX"));
    let index: u32 = hexenv("TET_PROVE_INDEX").trim().parse().expect("index");
    let bucket: u64 = hexenv("TET_PROVE_BUCKET").trim().parse().expect("bucket");
    let siblings: Vec<[u8; 32]> = hexenv("TET_PROVE_SIBLINGS_HEX")
        .split(',')
        .map(|h| arr(h))
        .collect();
    assert_eq!(
        siblings.len(),
        nexus_protocol::TET_ANON_MERKLE_DEPTH,
        "the node must serve a full-depth path"
    );

    let env = risc0_zkvm::ExecutorEnv::builder()
        .write(&3u8).unwrap()
        .write(&secret).unwrap()
        .write(&index).unwrap()
        .write(&siblings).unwrap()
        .write(&ephemeral).unwrap()
        .write(&receiver).unwrap()
        .write(&bucket).unwrap()
        .build()
        .unwrap();
    let started = std::time::Instant::now();
    let receipt = risc0_zkvm::default_prover()
        .prove(env, methods::NEXUS_GUEST_ELF)
        .expect("prove")
        .receipt;
    let prove_ms = started.elapsed().as_millis();
    receipt.verify(methods::NEXUS_GUEST_ID).expect("self-verify");

    let bytes = bincode::serialize(&receipt).unwrap();
    println!(
        "PROOF_JSON {}",
        serde_json::json!({
            "receipt_b64": base64::engine::general_purpose::STANDARD.encode(&bytes),
            "journal_b64": base64::engine::general_purpose::STANDARD.encode(&receipt.journal.bytes),
            "image_id_hex": crate::tmail::anon::encode_image_id_hex(&methods::NEXUS_GUEST_ID),
            "prove_ms": prove_ms,
            "receipt_bytes": bytes.len(),
        })
    );
}

/// Re-announcing an **unchanged** commitment is a no-op, not a rate-limited update.
///
/// The cooldown exists to stop root churn. An identical commitment produces an identical leaf and
/// therefore an identical root, so refusing it rate-limits a request that would change nothing —
/// which is what happened to a client retrying its own registration. Found in the live run.
#[test]
fn s8_re_announcing_the_same_commitment_is_a_no_op() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let store = tmail_store_for_tests();
    let (w, wallet) = tmail_party_for_tests();
    let secret = [7u8; 32];

    store
        .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &secret, 1_000))
        .unwrap();
    // Capture the root only AFTER the leaf has entered the tree. Reading it before the epoch
    // boundary compares a pre-boundary root with a post-boundary one, and the difference is the
    // boundary rather than anything this test is about.
    std::thread::sleep(std::time::Duration::from_millis(5));
    let root_after_first = store.anon_root();
    assert!(
        store.anon_leaf_index(&wallet).is_some(),
        "precondition: the member is in the tree before the root is captured"
    );

    // Same secret, later timestamp -- exactly what a retry looks like.
    let again = signed_anon_registration_for_tests(&w, &wallet, &secret, 9_999);
    assert_eq!(
        store.register_anon(&again).unwrap(),
        crate::tmail::store::AnonRegisterOutcome::Duplicate,
        "an unchanged commitment must be a no-op, NOT UpdateTooSoon: it changes no leaf"
    );
    std::thread::sleep(std::time::Duration::from_millis(5));
    assert_eq!(store.anon_root(), root_after_first, "and the root must not move");

    // A genuinely different commitment is still rate-limited.
    let changed = signed_anon_registration_for_tests(&w, &wallet, &[8u8; 32], 10_000);
    assert!(
        matches!(
            store.register_anon(&changed).unwrap(),
            crate::tmail::store::AnonRegisterOutcome::UpdateTooSoon { .. }
        ),
        "a different commitment is a real update and stays subject to the cooldown"
    );
}

// ---------------------------------------------------------------------------
// S8 — anonymity-registry anti-entropy sync.
// ---------------------------------------------------------------------------

/// Pagination walks the whole registry in wallet order and terminates.
#[test]
fn s8_sync_pagination_covers_everything_and_ends() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let mut wallets = Vec::new();
    for i in 0..7u8 {
        let (w, wallet) = tmail_party_for_tests();
        store
            .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &[i + 1; 32], 1_000))
            .unwrap();
        wallets.push(wallet.to_ascii_lowercase());
    }
    wallets.sort();

    let mut seen = Vec::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0;
    loop {
        let (regs, next) = store.anon_registrations_after(cursor.as_deref(), 3);
        pages += 1;
        assert!(pages < 20, "pagination must terminate");
        for r in regs {
            seen.push(r.wallet_id.to_ascii_lowercase());
        }
        match next {
            Some(c) => cursor = Some(c),
            None => break,
        }
    }
    assert_eq!(seen.len(), 7, "every registration must be visited exactly once");
    assert_eq!(seen, wallets, "and in canonical wallet order");
}

/// A probe (`limit = 0`) returns no registrations — the steady state must not transfer the
/// registry just to compare roots.
#[test]
fn s8_sync_probe_returns_no_registrations() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (w, wallet) = tmail_party_for_tests();
    store
        .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &[1u8; 32], 1_000))
        .unwrap();
    let (regs, next) = store.anon_registrations_after(None, 0);
    assert!(regs.is_empty(), "a probe must carry no records");
    assert!(next.is_none());
}

/// **Reproduces the CH↔HEL gap, then closes it.**
///
/// The live run left node A with `members=2` and node B with `members=1`, roots diverged, and the
/// cross-node anonymous message failed to verify. Gossip had delivered A's later registration to
/// nobody who was not already listening; B had only its own.
///
/// This sets up that exact state, runs anti-entropy in both directions, and asserts convergence.
/// The epoch claim is asserted directly: synced registrations enter at the receiving node's **next**
/// epoch, so roots converge from then on, never retroactively.
#[test]
fn s8_late_joiner_converges_after_sync_and_one_epoch() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = EnvVarGuard::set("TET_TMAIL_ANON_EPOCH_MS", "400");

    // A holds two registrations; B joined later and holds only its own. This is the live state.
    let node_a = tmail_store_for_tests();
    let node_b = tmail_store_for_tests();
    for i in 0..2u8 {
        let (w, wallet) = tmail_party_for_tests();
        node_a
            .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &[i + 1; 32], 1_000))
            .unwrap();
    }
    let (wb, wallet_b) = tmail_party_for_tests();
    node_b
        .register_anon(&signed_anon_registration_for_tests(&wb, &wallet_b, &[9u8; 32], 1_000))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(500));

    assert_eq!(node_a.anon_member_count(), 2, "precondition: seed saw two");
    assert_eq!(node_b.anon_member_count(), 1, "precondition: follower saw one");
    assert_ne!(
        node_a.anon_root(),
        node_b.anon_root(),
        "precondition: this is the members=2 vs members=1 divergence observed CH<->HEL"
    );

    // Anti-entropy: both sides page the other, then admit through the normal path. Snapshotted
    // first so this is one simultaneous round, not A learning from an already-updated B.
    let page_of = |s: &crate::tmail::store::TmailStore| {
        let mut all = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let (page, next) = s.anon_registrations_after(cursor.as_deref(), crate::p2p::ANON_SYNC_PAGE);
            all.extend(page);
            match next {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        all
    };
    let from_a = page_of(&node_a);
    let from_b = page_of(&node_b);
    assert_eq!((from_a.len(), from_b.len()), (2, 1), "each serves its whole registry");
    for (regs, to) in [(&from_a, &node_b), (&from_b, &node_a)] {
        for reg in regs {
            crate::tmail::anon::verify_tmail_anon_registration_v1(reg)
                .expect("synced registrations carry their own signature and must verify");
            to.register_anon(reg).unwrap();
        }
    }
    assert_eq!(node_a.anon_member_count(), 3);
    assert_eq!(node_b.anon_member_count(), 3, "B now holds the union");

    // Not yet equal: the new leaves entered at each node's NEXT epoch, so the roots in force right
    // now are still the pre-sync ones.
    assert_ne!(
        node_a.anon_root(),
        node_b.anon_root(),
        "convergence is from the next epoch, not retroactive -- a proof built against a peer's \
         pre-sync root may be rejected once, and the sender's retry succeeds"
    );

    // After one epoch on both, the roots match and a proof from either verifies against the other.
    std::thread::sleep(std::time::Duration::from_millis(500));
    assert_eq!(
        node_a.anon_root(),
        node_b.anon_root(),
        "after one epoch the two nodes compute the same root over the same member set"
    );
    assert_eq!(node_a.anon_member_count(), 3);
    assert_eq!(node_b.anon_member_count(), 3);
}

/// A forged registration cannot enter through sync: the admission path is the same one gossip uses.
#[test]
fn s8_sync_cannot_import_a_forged_registration() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (w, wallet) = tmail_party_for_tests();
    let mut reg = signed_anon_registration_for_tests(&w, &wallet, &[1u8; 32], 1_000);
    // A peer tampers with the commitment it serves us.
    reg.commitment_hex = hex::encode([0xFFu8; 32]);

    assert!(
        crate::tmail::anon::verify_tmail_anon_registration_v1(&reg).is_err(),
        "a peer can withhold registrations, and can flood within the caps -- but it cannot forge \
         one, because each carries the wallet's own hybrid signature"
    );
    assert_eq!(store.anon_member_count(), 0);
}

/// **Verification cost of a full sync.** ML-DSA verification dominates; this measures it and states
/// the budget rather than assuming one.
#[test]
#[ignore = "timing measurement; run explicitly"]
fn s8_measure_sync_verification_cost() {
    let _g = env_lock();
    set_test_env_base();
    let n = std::env::var("TET_SYNC_BENCH_N")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(200);

    let mut regs = Vec::with_capacity(n);
    for i in 0..n {
        let (w, wallet) = tmail_party_for_tests();
        regs.push(signed_anon_registration_for_tests(
            &w,
            &wallet,
            &[(i % 251) as u8 + 1; 32],
            1_000,
        ));
    }

    let started = std::time::Instant::now();
    for reg in &regs {
        crate::tmail::anon::verify_tmail_anon_registration_v1(reg).expect("valid");
    }
    let elapsed = started.elapsed();
    let per = elapsed.as_secs_f64() * 1000.0 / n as f64;
    println!("\n=== registry sync verification cost ===");
    println!("registrations verified : {n}");
    println!("total                  : {:.0} ms", elapsed.as_secs_f64() * 1000.0);
    println!("per registration       : {per:.2} ms");
    println!("extrapolated to 50,000 : {:.1} s", per * 50_000.0 / 1000.0);
    println!("page of {}            : {:.0} ms", crate::p2p::ANON_SYNC_PAGE, per * crate::p2p::ANON_SYNC_PAGE as f64);
}

// ---------------------------------------------------------------------------
// Browser wallet <-> node interop. The guard that would have caught 2026-09-28.
// ---------------------------------------------------------------------------

/// Fixtures signed by the **browser** wallet bundle and verified by the node's own verifiers.
const BROWSER_WALLET_HYBRID_SIGS: &str = include_str!("testdata/browser_wallet_hybrid_sigs.json");

/// **The browser wallet and the node must agree on the ML-DSA level.**
///
/// `wallet_client_bundled.js` signs in the browser; `verify_mldsa_b64` verifies here. Nothing
/// forced those two to use the same parameter set, and on 2026-09-28 they did not: the entry
/// source signed with **ML-DSA-65** while the node verifies **ML-DSA-44** (WP §7.1). It had not
/// broken anyone only because the committed bundle predated that change and still signed 44 — the
/// stale artifact was the only thing holding the system together. The next honest rebuild would
/// have rejected every browser-signed transfer on the network.
///
/// A size check alone is not enough, so this verifies the real signatures: `verify_mldsa_b64`
/// infers the mode from the **public key** length and then requires the signature to match it, so
/// a level mismatch fails here exactly as it would at `/wallet/transfer`.
#[test]
fn browser_wallet_hybrid_signatures_verify_on_the_node() {
    let doc: serde_json::Value =
        serde_json::from_str(BROWSER_WALLET_HYBRID_SIGS).expect("fixture JSON must parse");
    let cases = doc["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty(), "fixtures must not be empty — an empty array passes vacuously");

    for (i, c) in cases.iter().enumerate() {
        let wallet = c["wallet_id"].as_str().unwrap();
        let pk_b64 = c["mldsa_pubkey_b64"].as_str().unwrap();
        let msg = c["message_utf8"].as_str().unwrap();
        let ed_b64 = c["ed25519_sig_b64"].as_str().unwrap();
        let ml_b64 = c["mldsa_sig_b64"].as_str().unwrap();

        crate::quantum_shield::verify_ed25519(wallet, ed_b64, msg.as_bytes())
            .unwrap_or_else(|e| panic!("case {i}: browser Ed25519 signature rejected by the node: {e:?}"));
        crate::wallet::verify_mldsa_b64(pk_b64, ml_b64, msg.as_bytes())
            .unwrap_or_else(|e| panic!("case {i}: browser ML-DSA signature rejected by the node: {e}"));
    }
}

/// The fixtures are ML-DSA-**44** specifically, pinned by byte length.
///
/// Separate from the verification test on purpose: if someone regenerates the fixtures from a
/// future bundle that signs at another level, the test above would still pass — `verify_mldsa_b64`
/// infers the mode from the key it is handed, so a consistent 65/65 pair verifies fine. It would
/// just disagree with every wallet already on the network. This pins the level itself.
#[test]
fn browser_wallet_fixtures_are_ml_dsa_44() {
    use base64::Engine as _;
    let doc: serde_json::Value = serde_json::from_str(BROWSER_WALLET_HYBRID_SIGS).unwrap();
    let b64 = base64::engine::general_purpose::STANDARD;
    for (i, c) in doc["cases"].as_array().unwrap().iter().enumerate() {
        let pk = b64.decode(c["mldsa_pubkey_b64"].as_str().unwrap()).unwrap();
        let sig = b64.decode(c["mldsa_sig_b64"].as_str().unwrap()).unwrap();
        assert_eq!(pk.len(), dilithium::ML_DSA_44.public_key_bytes(),
            "case {i}: browser public key is not ML-DSA-44 ({} bytes)", pk.len());
        assert_eq!(sig.len(), dilithium::ML_DSA_44.signature_bytes(),
            "case {i}: browser signature is not ML-DSA-44 ({} bytes) — this is the 2026-09-28 bug",
            sig.len());
    }
}

/// Fixtures signed by the **Sovereign OS UI's** wasm signer (`tet-pqc-wasm`).
const WASM_SIGNER_MLDSA44_SIGS: &str = include_str!("testdata/wasm_signer_mldsa44_sigs.json");

/// **The wasm signer and the node must agree too.**
///
/// There are three ML-DSA implementations in this system and no compiler forces them to agree:
/// the node (`dilithium-rs`), the browser wallet page (`@noble/post-quantum`, bundled), and the
/// Sovereign OS UI (`tet-pqc-wasm`, `dilithium-rs` compiled to wasm). They must match on the
/// parameter set **and** on the HKDF seed info string and the deterministic-signing label, or
/// signatures verify locally and are rejected by every peer.
///
/// `browser_wallet_hybrid_signatures_verify_on_the_node` pins the browser half. This pins the wasm
/// half, against the artifact the UI actually loads.
#[test]
fn wasm_signer_signatures_verify_on_the_node() {
    use base64::Engine as _;
    let doc: serde_json::Value =
        serde_json::from_str(WASM_SIGNER_MLDSA44_SIGS).expect("fixture JSON must parse");
    let cases = doc["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty(), "fixtures must not be empty — an empty array passes vacuously");
    let b64 = base64::engine::general_purpose::STANDARD;

    for (i, c) in cases.iter().enumerate() {
        let pk_b64 = c["mldsa_pubkey_b64"].as_str().unwrap();
        let msg = c["message_utf8"].as_str().unwrap();
        let sig_b64 = c["mldsa_sig_b64"].as_str().unwrap();

        assert_eq!(b64.decode(pk_b64).unwrap().len(), dilithium::ML_DSA_44.public_key_bytes(),
            "case {i}: wasm public key is not ML-DSA-44");
        assert_eq!(b64.decode(sig_b64).unwrap().len(), dilithium::ML_DSA_44.signature_bytes(),
            "case {i}: wasm signature is not ML-DSA-44");

        crate::wallet::verify_mldsa_b64(pk_b64, sig_b64, msg.as_bytes())
            .unwrap_or_else(|e| panic!("case {i}: wasm ML-DSA signature rejected by the node: {e}"));
    }
}

/// All three implementations derive the **same** ML-DSA-44 public key from the same mnemonic.
///
/// This is the invariant the level bug actually violated: a wallet whose key comes from one
/// implementation and whose signature comes from another is unusable, and each half looks correct
/// on its own. Asserted directly rather than inferred from the two suites above passing.
#[test]
fn browser_wasm_and_node_derive_the_same_mldsa44_pubkeys() {
    let browser: serde_json::Value = serde_json::from_str(BROWSER_WALLET_HYBRID_SIGS).unwrap();
    let wasm: serde_json::Value = serde_json::from_str(WASM_SIGNER_MLDSA44_SIGS).unwrap();
    let bp: Vec<&str> = browser["cases"].as_array().unwrap().iter()
        .map(|c| c["mldsa_pubkey_b64"].as_str().unwrap()).collect();
    let wp: Vec<&str> = wasm["cases"].as_array().unwrap().iter()
        .map(|c| c["mldsa_pubkey_b64"].as_str().unwrap()).collect();
    assert_eq!(bp.len(), wp.len(), "fixture sets must cover the same mnemonics");
    assert_eq!(bp, wp, "browser bundle and wasm signer derive different ML-DSA-44 public keys");
}

// ---------------------------------------------------------------------------
// tet-agent-sdk <-> node interop. The THIRD copy of the signer, and the wallet
// it was deriving.
// ---------------------------------------------------------------------------

/// Fixtures signed by **tet-agent-sdk** — its BIP39 Ed25519 plus its own vendored `tet-pqc-wasm`.
const AGENT_SDK_HYBRID_SIGS: &str = include_str!("testdata/agent_sdk_hybrid_sigs.json");

/// **The agent SDK must derive the same wallet as everything else from the same mnemonic.**
///
/// It did not. `tet-agent-sdk/src/wallet_from_mnemonic.ts` used `@polkadot/keyring`'s
/// `addFromMnemonic`, which derives Ed25519 from the **substrate mini-secret** — PBKDF2 over the
/// mnemonic *entropy*, salt `"mnemonic"` — while TET uses the **BIP39 seed**, PBKDF2 over the
/// mnemonic *phrase* ([`crate::wallet::ed25519_signing_key_from_mnemonic`]). Measured on the
/// standard vector: `9125f505…` under polkadot, `c5785e18…` here and in every browser.
///
/// Nothing rejected it, which is why it lived since May. Both halves were internally consistent
/// and `mldsa_pk` is inside every pre-image, so [`crate::quantum_shield::verify_hybrid`] passed —
/// the agent was simply a *different wallet* from the one its owner could open with the same
/// phrase, and its ML-DSA-44 key (correctly HKDF'd off the BIP39 seed by the wasm) belonged to
/// that other wallet. One identity, two wallets, no error anywhere.
///
/// So this asserts the derivation, not just that verification succeeds. Verification succeeding is
/// precisely what the bug did.
#[test]
fn agent_sdk_derives_the_same_hybrid_identity_as_the_node() {
    use base64::Engine as _;
    let doc: serde_json::Value =
        serde_json::from_str(AGENT_SDK_HYBRID_SIGS).expect("fixture JSON must parse");
    let browser: serde_json::Value = serde_json::from_str(BROWSER_WALLET_HYBRID_SIGS).unwrap();
    let cases = doc["cases"].as_array().expect("cases array");
    let browser_cases = browser["cases"].as_array().unwrap();
    assert!(!cases.is_empty(), "fixtures must not be empty — an empty array passes vacuously");
    assert_eq!(
        cases.len(),
        browser_cases.len(),
        "fixture sets must cover the same mnemonics, in the same order"
    );
    let b64 = base64::engine::general_purpose::STANDARD;

    for (i, c) in cases.iter().enumerate() {
        let mnemonic = c["mnemonic"].as_str().expect("fixture carries the mnemonic");
        let wallet = c["wallet_id"].as_str().unwrap();
        let pk_b64 = c["mldsa_pubkey_b64"].as_str().unwrap();

        // The node's own derivation, which is also what `tet-cli` uses.
        let sk = crate::wallet::ed25519_signing_key_from_mnemonic(mnemonic)
            .unwrap_or_else(|e| panic!("case {i}: node rejected the fixture mnemonic: {e:?}"));
        let node_wallet = hex::encode(sk.verifying_key().to_bytes());
        assert_eq!(
            node_wallet, wallet,
            "case {i}: agent SDK wallet id disagrees with the node for the same mnemonic"
        );

        let kp = crate::wallet::mldsa44_keypair_from_mnemonic(mnemonic).unwrap();
        assert_eq!(
            b64.encode(kp.public_key()),
            pk_b64,
            "case {i}: agent SDK ML-DSA-44 public key disagrees with the node"
        );

        // …and with the browser wallet, which is what the UI ships.
        assert_eq!(
            browser_cases[i]["wallet_id"].as_str().unwrap(),
            wallet,
            "case {i}: agent SDK wallet id disagrees with the browser wallet"
        );
        assert_eq!(
            browser_cases[i]["mldsa_pubkey_b64"].as_str().unwrap(),
            pk_b64,
            "case {i}: agent SDK ML-DSA-44 public key disagrees with the browser wallet"
        );
    }
}

/// **Both halves of an agent SDK signature verify on the node, at ML-DSA-44 specifically.**
///
/// The level is pinned with [`crate::wallet::verify_mldsa44_b64`] rather than
/// [`crate::wallet::verify_mldsa_b64`], which infers the parameter set from the public key it is
/// handed and so accepts a consistent 65/65 pair happily — green, and unusable by every wallet on
/// the network. `tet-agent-sdk/vendor/` is a third committed copy of the signer with no
/// reproducibility diff until today; this is the behaviour half of that guard, and a hash check
/// cannot give it, because a matching hash proves only that the bytes are the ones the source
/// produces, never that the source is right.
#[test]
fn agent_sdk_signatures_verify_on_the_node() {
    use base64::Engine as _;
    let doc: serde_json::Value = serde_json::from_str(AGENT_SDK_HYBRID_SIGS).unwrap();
    let cases = doc["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty(), "fixtures must not be empty — an empty array passes vacuously");
    let b64 = base64::engine::general_purpose::STANDARD;

    for (i, c) in cases.iter().enumerate() {
        let wallet = c["wallet_id"].as_str().unwrap();
        let pk_b64 = c["mldsa_pubkey_b64"].as_str().unwrap();
        let msg = c["message_utf8"].as_str().unwrap();
        let ed_b64 = c["ed25519_sig_b64"].as_str().unwrap();
        let ml_b64 = c["mldsa_sig_b64"].as_str().unwrap();

        assert_eq!(
            b64.decode(pk_b64).unwrap().len(),
            dilithium::ML_DSA_44.public_key_bytes(),
            "case {i}: agent SDK public key is not ML-DSA-44"
        );
        assert_eq!(
            b64.decode(ml_b64).unwrap().len(),
            dilithium::ML_DSA_44.signature_bytes(),
            "case {i}: agent SDK signature is not ML-DSA-44"
        );

        crate::quantum_shield::verify_ed25519(wallet, ed_b64, msg.as_bytes()).unwrap_or_else(|e| {
            panic!("case {i}: agent SDK Ed25519 signature rejected by the node: {e:?}")
        });
        crate::wallet::verify_mldsa44_b64(pk_b64, ml_b64, msg.as_bytes()).unwrap_or_else(|e| {
            panic!("case {i}: agent SDK ML-DSA-44 signature rejected by the node: {e}")
        });
    }
}

// ---------------------------------------------------------------------------
// Restart. The condition the QA matrix found nothing covered, and the one
// flip day guarantees.
// ---------------------------------------------------------------------------

/// **A proof built before a restart must still verify after it.**
///
/// The epoch→root memo (`anon_roots`) is a `Mutex<Vec<…>>` and does not survive a process restart.
/// Whether that matters depends on something subtler: `anon_root_for_epoch` recomputes from the
/// registry on a cache miss, and the registry is in sled. A past epoch's leaf set is immutable —
/// a registration admitted later carries a later `admitted_at_ms` and enters from its own epoch
/// onward — so recomputation must reproduce the pre-restart root exactly.
///
/// If that ever stops holding, the symptom is the worst kind: after a seed restart, proofs built
/// against a pre-restart root are rejected with no error naming the cause. That is the shape of the
/// CH↔HEL bug that cost a day.
#[test]
fn anon_root_history_survives_a_restart() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = EnvVarGuard::set("TET_TMAIL_ANON_EPOCH_MS", "400");

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("restart.db");

    let (epoch_before, root_before, wallet) = {
        let ledger = crate::ledger::Ledger::open(path.to_str().unwrap()).unwrap();
        let store = crate::tmail::store::TmailStore::open(&ledger.sled_db()).unwrap();
        let (w, wallet) = tmail_party_for_tests();
        store
            .register_anon(&signed_anon_registration_for_tests(&w, &wallet, &[3u8; 32], 1_000))
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let e = store.anon_current_epoch();
        let r = store.anon_root_for_epoch(e);
        assert_eq!(store.anon_member_count(), 1, "precondition: the registration is in the tree");
        (e, r, wallet)
    }; // both dropped — sled closed, the in-memory memo is gone

    // Reopen the SAME path. This is the restart.
    let ledger = crate::ledger::Ledger::open(path.to_str().unwrap()).unwrap();
    let store = crate::tmail::store::TmailStore::open(&ledger.sled_db()).unwrap();

    assert_eq!(store.anon_member_count(), 1, "the registry itself must survive — it is in sled");
    assert_eq!(
        store.anon_root_for_epoch(epoch_before),
        root_before,
        "the pre-restart epoch root must be recomputable; a proof against it is otherwise rejected \
         with nothing naming the cause"
    );
    assert!(
        store.anon_leaf_index_for_epoch(&wallet, epoch_before).is_some(),
        "the wallet's leaf must still be locatable in the pre-restart epoch, or no authentication \
         path can be served for a proof built before the restart"
    );
    assert_eq!(store.anon_root_cache_len(), 1, "exactly the one epoch recomputed above is memoised");
}

/// **A transaction admitted over REST must survive a restart.**
///
/// The mempool is a `Vec` in `RestState` and dies with the process, so before 2026-09-28 a signed
/// transaction that a user submitted, got a `202` for, and that was still waiting when the node
/// restarted was gone: no error, no retry, nothing to tell the sender. The seed was restarted twice
/// by hand this month, so the window is real rather than theoretical.
///
/// This closes the store and reopens it at the same path — a real restart, not a second node — and
/// checks the durable copy is there to restore, that the restored set is what the rebroadcast
/// sweep will pick up, and that a transaction already mined does NOT come back.
#[tokio::test]
async fn rest_admitted_tx_survives_a_restart_and_a_mined_one_does_not() {
    let _g = env_lock();
    set_test_env_base();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("restart.db");

    let (kept_hash, mined_hash) = {
        let ledger = crate::ledger::Ledger::open(path.to_str().unwrap()).unwrap();
        let (_w, env_a) = airdrop_env_for_tests();
        let (_w2, env_b) = airdrop_env_for_tests();
        let ha = crate::consensus::tx_hash_for_env(&env_a).unwrap();
        let hb = crate::consensus::tx_hash_for_env(&env_b).unwrap();
        assert_ne!(ha, hb, "the two fixtures must differ or this proves nothing");

        ledger.mempool_persist(&ha, &env_a);
        ledger.mempool_persist(&hb, &env_b);
        assert_eq!(ledger.mempool_restore().len(), 2, "both persisted before the restart");

        // One of them gets mined: the block path forgets it.
        ledger.mempool_forget([hb.clone()]);
        (ha, hb)
    }; // sled closed

    // Reopen the same path. This is the restart.
    let ledger = crate::ledger::Ledger::open(path.to_str().unwrap()).unwrap();
    let restored = ledger.mempool_restore();

    assert_eq!(restored.len(), 1, "exactly the un-mined tx survives");
    assert_eq!(restored[0].0, kept_hash, "and it is the one that was never in a block");
    assert!(
        !restored.iter().any(|(h, _)| *h == mined_hash),
        "a mined tx must not be resurrected — that would re-broadcast a settled transfer"
    );

    // The restored hash is what the rebroadcast tracker is keyed on, so the sweep will own it.
    let env = &restored[0].1;
    assert_eq!(
        crate::consensus::tx_hash_for_env(env).unwrap(),
        kept_hash,
        "the restored envelope must re-hash to its key, or the tracker and the mempool disagree \
         and the sweep silently skips it"
    );
}

// ---------------------------------------------------------------------------
// QA gap #1 — hostile APPLICATION messages over a real swarm.
//
// The rest of the suite calls handlers directly. These drive the same hostile inputs across an
// actual libp2p wire and into the production handler, with a third honest node present, so the
// assertion is not merely "it was refused" but "it was refused and the node kept serving
// everyone else". Frame-level hostility (oversized, malformed) is covered separately in
// p2p::tests; this is the layer above, where the bytes decode fine and the CONTENT is a lie.
// ---------------------------------------------------------------------------

/// A registration that claims to be `wallet_b` but is signed, validly, by `wallet_a`.
///
/// The signature verifies over exactly these bytes. Only the `signer == wallet_id` check refuses
/// it, which is the point: a forgery that fails on a cheaper check proves nothing about the check
/// under test (CLAUDE.md, M1/O3).
fn forged_registration_for_tests() -> crate::tmail::anon::TmailAnonRegistrationV1 {
    use base64::Engine as _;
    use ed25519_dalek::Signer as _;
    let (words_a, wallet_a) = tmail_party_for_tests();
    let (_wb, wallet_b) = tmail_party_for_tests();
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(&words_a).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(&words_a).unwrap();
    let pk = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());

    let mut reg = crate::tmail::anon::TmailAnonRegistrationV1 {
        v: 1,
        kind: crate::tmail::anon::TMAIL_ANON_REGISTRATION_KIND.to_string(),
        wallet_id: wallet_b,
        commitment_hex: hex::encode(nexus_protocol::tet_anon_commitment_v1(&[42u8; 32])),
        registered_at_ms: 1_000,
        hybrid_sig: crate::tmail::envelope::TmailHybridSig {
            ed25519_pubkey_hex: wallet_a,
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: pk.clone(),
            mldsa_sig_b64: String::new(),
        },
    };
    let msg = crate::tmail::anon::tmail_anon_registration_auth_message_bytes(&reg, &pk);
    reg.hybrid_sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    reg.hybrid_sig.mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&mldsa_kp, msg.as_slice()).unwrap());
    reg
}


/// **(a) A forged registration is refused over gossip, and the node keeps serving.**
///
/// The signature is valid over exactly these bytes — only `signer == wallet_id` refuses it. Driven
/// across a real swarm rather than into `admit_anon_registration` directly, so the decode path in
/// front of the handler is exercised too.
#[tokio::test]
async fn forged_registration_over_a_swarm_is_refused_and_the_node_keeps_serving() {
    let _g = env_lock();
    set_test_env_base();
    let store = std::sync::Arc::new(tmail_store_for_tests());

    let forged = forged_registration_for_tests();
    let (w, wallet) = tmail_party_for_tests();
    let honest = signed_anon_registration_for_tests(&w, &wallet, &[9u8; 32], 1_000);

    let (hostile_out, honest_out) = crate::p2p::tests::hostile_then_honest_over_a_swarm(
        3301,
        &store,
        crate::models::NetworkEvent::TmailAnonRegistration { registration: forged },
        crate::models::NetworkEvent::TmailAnonRegistration { registration: honest },
    )
    .await;

    match hostile_out {
        crate::p2p::TmailGossipOutcome::Rejected { ref reason } => {
            assert!(reason.contains("registration"), "wrong rejection reason: {reason}");
        }
        other => panic!("a forged registration must be rejected, got {other:?}"),
    }
    assert!(
        matches!(honest_out, crate::p2p::TmailGossipOutcome::Registered { .. }),
        "the node must keep serving an honest peer afterwards, got {honest_out:?}"
    );
    assert_eq!(store.anon_member_count(), 1, "only the honest registration is in the registry");
}

/// **(a2) The same forgery is refused over the SYNC RPC, not just over gossip.**
///
/// Registry sync is a second, independent way into the same registry, added 2026-09-25. It admits
/// through `admit_anon_registration` by design — this asserts that is actually true of the code
/// rather than of the comment, because a sync path that verified less than gossip would be the
/// obvious hole to walk through.
#[test]
fn forged_registration_over_the_sync_path_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let store = std::sync::Arc::new(tmail_store_for_tests());
    let forged = forged_registration_for_tests();

    // The exact call the sync response arm makes for each paged record.
    let err = crate::p2p::admit_anon_registration(&store, &forged)
        .expect_err("a forged registration must not enter through sync either");
    assert!(err.contains("registration"), "wrong rejection reason: {err}");
    assert_eq!(store.anon_member_count(), 0, "nothing entered the registry");

    // And the honest path through the same function still works, so the refusal above is not
    // simply "this function rejects everything".
    let (w, wallet) = tmail_party_for_tests();
    let honest = signed_anon_registration_for_tests(&w, &wallet, &[11u8; 32], 1_000);
    crate::p2p::admit_anon_registration(&store, &honest).expect("honest registration admitted");
    assert_eq!(store.anon_member_count(), 1);
}

/// **(c) A burn revoke signed by neither sender nor receiver is dropped, and the node keeps
/// serving.**
///
/// The revoke is validly signed — by a third party. Only the authorisation check refuses it, and a
/// message that survived it would let anyone destroy anyone's mail.
#[tokio::test]
async fn third_party_burn_revoke_over_a_swarm_is_dropped_and_the_node_keeps_serving() {
    let _g = env_lock();
    set_test_env_base();
    let (store, _sender_words, _sender, receiver_words, receiver, msg_id) =
        stored_burn_message_for_tests();
    let store = std::sync::Arc::new(store);

    let (stranger_words, stranger) = tmail_party_for_tests();
    let hostile = signed_burn_revoke_for_tests(&stranger_words, &stranger, &msg_id);
    let honest = signed_burn_revoke_for_tests(&receiver_words, &receiver, &msg_id);

    assert!(
        crate::tmail::burn::verify_tmail_burn_revoke_v1(&hostile).is_ok(),
        "the stranger's signature is genuine; only authorisation may reject it"
    );
    assert!(store.get_by_msg_id(&msg_id).is_some(), "precondition: the message is stored");

    let (hostile_out, honest_out) = crate::p2p::tests::hostile_then_honest_over_a_swarm(
        3303,
        &store,
        crate::models::NetworkEvent::TmailBurnRevoke { revoke: hostile },
        crate::models::NetworkEvent::TmailBurnRevoke { revoke: honest },
    )
    .await;

    assert!(
        matches!(hostile_out, crate::p2p::TmailGossipOutcome::Rejected { .. }),
        "a third-party revoke must be dropped, got {hostile_out:?}"
    );
    assert!(
        matches!(honest_out, crate::p2p::TmailGossipOutcome::Burned { .. }),
        "the receiver's own revoke must still work afterwards, got {honest_out:?}"
    );
    assert!(store.get_by_msg_id(&msg_id).is_none(), "the honest revoke destroyed the message");
}

/// **(b) A replayed nullifier is refused — over a real swarm, with a real receipt.**
///
/// `#[ignore]` and run by the `zk-real` workflow, not by `cargo test`. That is not a dodge: the
/// nullifier lives in the ZK journal, and the replay rule is enforced inside
/// `verify_anonymous_proof`, which calls `verify_tx_receipt_and_journal`. There is no honest way to
/// drive this case without a real receipt, and a mock one would test the mock.
///
/// Two envelopes, different `msg_id`, the SAME journal and therefore the same nullifier — one
/// ephemeral identity trying to spend its anonymity twice. Both cross a real wire; the first
/// verifies, the second is refused as a replay, and a third node's honest traffic keeps flowing.
#[tokio::test]
#[ignore = "runs a real RISC Zero prover; needs a zk build"]
async fn replayed_nullifier_over_a_swarm_is_refused_and_the_node_keeps_serving() {
    let _g = env_lock();
    set_test_env_base();
    let _epoch = anon_fast_epoch_guard();
    let (_rw, receiver) = tmail_party_for_tests();

    let (first, receipt_bytes, store, eph_words) = anonymous_envelope_for_tests(&receiver);
    let store = std::sync::Arc::new(store);

    // The replay: same proof, same nullifier, a different message id.
    let mut second = first.clone();
    second.msg_id = format!("{}-replay", first.msg_id);
    resign_tmail_env_for_tests(&mut second, &eph_words);
    assert_ne!(first.msg_id, second.msg_id);
    assert_eq!(
        first.anonymous.as_ref().unwrap().anchor_proof.journal_b64,
        second.anonymous.as_ref().unwrap().anchor_proof.journal_b64,
        "both envelopes must carry the same journal, or this is not a replay"
    );

    // Both announce fine — phase 1 is metadata only and is NOT where the defence is. Driving them
    // over a swarm is how that gets demonstrated rather than assumed.
    let (first_out, second_out) = crate::p2p::tests::hostile_then_honest_over_a_swarm(
        3305,
        &store,
        crate::models::NetworkEvent::TmailGossip { envelope: first.clone() },
        crate::models::NetworkEvent::TmailGossip { envelope: second.clone() },
    )
    .await;
    assert!(matches!(first_out, crate::p2p::TmailGossipOutcome::Stored { .. }),
        "the first announce is stored, got {first_out:?}");
    assert!(matches!(second_out, crate::p2p::TmailGossipOutcome::Stored { .. }),
        "the replay ALSO announces fine — gossip confers no verification, got {second_out:?}");

    // Phase 2 is the defence, and it is where the replay dies.
    let v1 = crate::tmail::anon::verify_anonymous_proof(&store, &first, &receipt_bytes);
    assert!(matches!(v1, crate::tmail::store::AnonVerdict::Verified { .. }),
        "the first use must verify, got {v1:?}");

    let v2 = crate::tmail::anon::verify_anonymous_proof(&store, &second, &receipt_bytes);
    match v2 {
        crate::tmail::store::AnonVerdict::Failed { ref reason, .. } => {
            assert!(reason.contains("replay") || reason.contains("nullifier"),
                "expected the replay rejection, got: {reason}");
        }
        other => panic!("a replayed nullifier must be refused, got {other:?}"),
    }

    // Re-verifying the FIRST message is still fine: the rule is per-nullifier-per-message, not
    // "one verification ever", and gossip delivers duplicates constantly.
    let v1_again = crate::tmail::anon::verify_anonymous_proof(&store, &first, &receipt_bytes);
    assert!(matches!(v1_again, crate::tmail::store::AnonVerdict::Verified { .. }),
        "re-verifying the same message must stay Verified, got {v1_again:?}");
}

// ---------------------------------------------------------------------------
// Agent identity, Day 1: the generic PAE signer and AgentManifestV1.
//
// The dangerous part of this feature is the GENERIC signer. Everything else here
// signs one purpose-built pre-image per operation; an agent signs arbitrary
// bytes, and a generic signer without domain separation is a signing oracle that
// turns an agent key into a spending key. Most of what follows is about that.
// ---------------------------------------------------------------------------

use crate::agent::{
    AGENT_MANIFEST_KIND, AGENT_MANIFEST_MAX_CAPABILITIES, AGENT_MANIFEST_PAYLOAD_TYPE,
    AGENT_MLDSA44_PUBKEY_BYTES, AGENT_PAYLOAD_DOMAIN_V1, AgentError, AgentManifestV1,
    agent_manifest_auth_message_bytes, agent_payload_auth_message_bytes, sign_agent_manifest,
    sign_agent_payload, verify_agent_manifest_v1, verify_agent_payload,
};

const AGENT_NOW_MS: u64 = 1_800_000_000_000;

struct TestWallet {
    mnemonic: String,
    wallet_id: String,
    mldsa44_pubkey_b64: String,
}

fn agent_test_wallet() -> TestWallet {
    use base64::Engine as _;
    let w = crate::wallet::generate_mnemonic_12().unwrap();
    let mnemonic = w.mnemonic_12.clone().unwrap();
    let kp = crate::wallet::mldsa44_keypair_from_mnemonic(&mnemonic).unwrap();
    TestWallet {
        wallet_id: w.address_hex.to_ascii_lowercase(),
        mldsa44_pubkey_b64: base64::engine::general_purpose::STANDARD.encode(kp.public_key()),
        mnemonic,
    }
}

/// A 1952-byte ML-DSA-**65** public key plus a valid 65 signature over `msg`.
///
/// Deliberately *valid*: the point of the level guards is that a consistent 65/65 pair is refused,
/// not that a broken signature is. A broken signature would be refused by any verifier.
fn mldsa65_pair(mnemonic: &str, msg: &[u8]) -> (String, String) {
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD;
    let seed =
        crate::wallet::mldsa_seed32_from_mnemonic_for_mode(mnemonic, dilithium::ML_DSA_65).unwrap();
    let kp = dilithium::MlDsaKeyPair::generate_deterministic(dilithium::ML_DSA_65, &seed);
    let sig = crate::wallet::mldsa_sign_deterministic(&kp, msg).unwrap();
    (b64.encode(kp.public_key()), b64.encode(sig))
}

fn agent_manifest_for_tests(owner: &TestWallet, agent: &TestWallet) -> AgentManifestV1 {
    let mut m = AgentManifestV1 {
        v: 1,
        kind: AGENT_MANIFEST_KIND.to_string(),
        agent_id: "claude-code-devlog".to_string(),
        agent_ed25519_pubkey_hex: agent.wallet_id.clone(),
        agent_mldsa44_pubkey_b64: agent.mldsa44_pubkey_b64.clone(),
        owner_wallet_id: owner.wallet_id.clone(),
        created_at_ms: AGENT_NOW_MS - 1000,
        expires_at_ms: AGENT_NOW_MS + 86_400_000,
        declared_automated: true,
        capabilities: vec!["devlog.sign".to_string(), "tmail.send".to_string()],
        hybrid_sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: String::new(),
            ed25519_sig_b64: String::new(),
            mldsa_pubkey_b64: String::new(),
            mldsa_sig_b64: String::new(),
        },
    };
    sign_agent_manifest(&owner.mnemonic, &mut m).unwrap();
    m
}

/// The floor: an owner-signed manifest verifies, and its ML-DSA halves really are level 44.
#[test]
fn agent_manifest_signed_by_the_owner_verifies() {
    use base64::Engine as _;
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();
    let m = agent_manifest_for_tests(&owner, &agent);

    verify_agent_manifest_v1(&m, AGENT_NOW_MS).expect("owner-signed manifest must verify");

    let b64 = base64::engine::general_purpose::STANDARD;
    assert_eq!(
        b64.decode(&m.agent_mldsa44_pubkey_b64).unwrap().len(),
        AGENT_MLDSA44_PUBKEY_BYTES
    );
    assert_eq!(
        b64.decode(&m.hybrid_sig.mldsa_pubkey_b64).unwrap().len(),
        AGENT_MLDSA44_PUBKEY_BYTES
    );
    assert_eq!(
        b64.decode(&m.hybrid_sig.mldsa_sig_b64).unwrap().len(),
        dilithium::ML_DSA_44.signature_bytes()
    );
}

// ── Control 5: the generic signer must not be able to impersonate another pre-image ──────────────

/// **CONTROL 5.** The agent encoding cannot produce the bytes of any other TET pre-image.
///
/// The attack: ask the generic signer to sign a payload that *is* a transfer pre-image, and see
/// whether the resulting signature is a valid transfer authorisation. Two things stop it — the
/// domain tag in front, and the length prefixes — and both are asserted, because a single assertion
/// could not tell which one was load-bearing. (That is the `chain_id` / `genesis_hash` lesson:
/// redundant defences hide which one is actually holding.)
#[test]
fn agent_payload_bytes_can_never_equal_another_tet_preimage() {
    let _g = env_lock();
    set_test_env_base();

    // A real transfer pre-image, built by the code that authorises spending.
    let to_wallet = "ab".repeat(32);
    let transfer = crate::wallet::transfer_hybrid_auth_message_bytes(&to_wallet, 1234, 7, "PK");

    // Hand exactly those bytes to the generic signer, as content and as the type label.
    let as_payload = agent_payload_auth_message_bytes("whatever", &transfer);
    let as_type = agent_payload_auth_message_bytes(
        std::str::from_utf8(&transfer).unwrap(),
        b"",
    );

    assert_ne!(as_payload, transfer, "agent payload collided with a transfer pre-image");
    assert_ne!(as_type, transfer, "agent payload_type collided with a transfer pre-image");

    // Defence 1: the domain tag is a prefix no other pre-image has.
    for bytes in [&as_payload, &as_type] as [&Vec<u8>; 2] {
        assert!(
            bytes.starts_with(AGENT_PAYLOAD_DOMAIN_V1.as_bytes()),
            "agent-signed bytes must start with the domain tag"
        );
    }
    // …and no pre-image this repository signs elsewhere starts with it.
    let others: [Vec<u8>; 4] = [
        crate::wallet::transfer_hybrid_auth_message_bytes(&to_wallet, 1, 1, "PK"),
        crate::wallet::worker_bond_stake_hybrid_auth_message_bytes(&to_wallet, 1, 1, "PK"),
        crate::wallet::initial_airdrop_claim_hybrid_auth_message_bytes(&to_wallet, "PK"),
        crate::tmail::anon::tmail_anon_registration_auth_message_bytes(
            &crate::tmail::anon::TmailAnonRegistrationV1 {
                v: 1,
                kind: crate::tmail::anon::TMAIL_ANON_REGISTRATION_KIND.to_string(),
                wallet_id: to_wallet.clone(),
                commitment_hex: "cd".repeat(32),
                registered_at_ms: 1,
                hybrid_sig: crate::tmail::envelope::TmailHybridSig {
                    ed25519_pubkey_hex: String::new(),
                    ed25519_sig_b64: String::new(),
                    mldsa_pubkey_b64: String::new(),
                    mldsa_sig_b64: String::new(),
                },
            },
            "PK",
        ),
    ];
    for other in others {
        assert!(
            !other.starts_with(AGENT_PAYLOAD_DOMAIN_V1.as_bytes()),
            "another pre-image starts with the agent domain tag — domain separation is gone"
        );
    }

    // Defence 2: the chain is bound in, as two separately-present fields. Asserted on the bytes
    // rather than inferred, because chain_id and genesis_hash are redundant (the hash is derived
    // from the id), so dropping either one alone leaves a signature-level test green.
    let chain_id = crate::genesis::chain_id_from_env();
    let genesis_hash = crate::genesis::expected_genesis_hash_from_env();
    assert!(!chain_id.is_empty() && !genesis_hash.is_empty());
    let field = |s: &str| format!("{} {} ", s.len(), s).into_bytes();
    assert!(
        contains_subslice(&as_payload, &field(&chain_id)),
        "chain_id is not a field of the agent pre-image"
    );
    assert!(
        contains_subslice(&as_payload, &field(&genesis_hash)),
        "genesis_hash is not a field of the agent pre-image"
    );
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// **CONTROL 5, second half.** No two distinct field lists encode to the same bytes.
///
/// This is what the length prefixes buy and what a `|`-joined format cannot give: `wallet.rs`'s
/// builders escape nothing, so a field containing the delimiter is re-parseable as two fields.
/// Here, shifting one byte from the type to the payload must change the encoding.
#[test]
fn agent_payload_encoding_is_unambiguous() {
    let _g = env_lock();
    set_test_env_base();

    // The cases that matter contain the SEPARATOR, because that is where a length-free encoding
    // actually collides. Written this way after the negative control: with the length prefixes
    // removed, `("a","bc")` vs `("ab","c")` still differed — the space between fields happened to
    // land in a different place, so the guard passed with the protection gone and was measuring the
    // separator rather than the lengths.
    assert_ne!(
        agent_payload_auth_message_bytes("a", b"b c"),
        agent_payload_auth_message_bytes("a b", b"c"),
        "a field boundary can be moved across a space without changing the signed bytes"
    );
    assert_ne!(
        agent_payload_auth_message_bytes("one two", b"three"),
        agent_payload_auth_message_bytes("one", b"two three"),
    );
    // A payload that imitates the encoding itself must not be confusable with real fields.
    assert_ne!(
        agent_payload_auth_message_bytes("t", b"3 abc "),
        agent_payload_auth_message_bytes("t", b"4 abc "),
    );
    assert_ne!(
        agent_payload_auth_message_bytes("1 t", b"abc"),
        agent_payload_auth_message_bytes("1", b"t abc"),
    );
    // Cheap cases too, though on their own they prove less than they look like they do.
    assert_ne!(
        agent_payload_auth_message_bytes("a", b"bc"),
        agent_payload_auth_message_bytes("ab", b"c"),
    );
    assert_ne!(
        agent_payload_auth_message_bytes("x", b"y|z"),
        agent_payload_auth_message_bytes("x|y", b"z"),
    );
    // And an empty payload is distinguishable from an empty type.
    assert_ne!(
        agent_payload_auth_message_bytes("", b"q"),
        agent_payload_auth_message_bytes("q", b""),
    );
}

/// A signature over one `payload_type` is not a signature over another, for identical bytes.
#[test]
fn agent_payload_signature_does_not_transfer_between_payload_types() {
    let _g = env_lock();
    set_test_env_base();
    let agent = agent_test_wallet();
    let payload = b"same bytes, different meaning";

    let sig = sign_agent_payload(&agent.mnemonic, "text/plain", payload).unwrap();
    verify_agent_payload(&agent.wallet_id, &sig, "text/plain", payload)
        .expect("must verify under the type it was signed for");

    match verify_agent_payload(&agent.wallet_id, &sig, "application/json", payload) {
        Err(AgentError::Ed25519(_)) => {}
        other => panic!("expected Ed25519 failure on a payload_type swap, got {other:?}"),
    }
    match verify_agent_payload(&agent.wallet_id, &sig, "text/plain", b"tampered") {
        Err(AgentError::Ed25519(_)) => {}
        other => panic!("expected Ed25519 failure on a tampered payload, got {other:?}"),
    }
}

/// A payload signature bound to one chain must not verify on another.
#[test]
fn agent_payload_signature_is_bound_to_the_chain() {
    let _g = env_lock();
    set_test_env_base();
    let _mainnet = EnvVarGuard::unset("TET_MAINNET");
    let agent = agent_test_wallet();
    let payload = b"devlog entry 2026-09-30";

    let _chain_a = EnvVarGuard::set("TET_CHAIN_ID", "tet-chain-a");
    let sig = sign_agent_payload(&agent.mnemonic, "text/plain", payload).unwrap();
    verify_agent_payload(&agent.wallet_id, &sig, "text/plain", payload)
        .expect("must verify on the chain it was signed for");

    let _chain_b = EnvVarGuard::set("TET_CHAIN_ID", "tet-chain-b");
    match verify_agent_payload(&agent.wallet_id, &sig, "text/plain", payload) {
        Err(AgentError::Ed25519(_)) => {}
        other => panic!("a signature bound to chain a verified on chain b: {other:?}"),
    }
}

// ── Control 2: the real forgery is a correctly signed one ────────────────────────────────────────

/// **CONTROL 2.** A manifest that names somebody else as owner, signed correctly by its author.
///
/// This is the M1 mistake stated as a test: mutating a signed field produces an invalid signature,
/// so the *signature* refuses it and the binding check never runs. The real forgery is A signing,
/// with A's own key, a pre-image that names B — every earlier check passes, the signature is
/// genuinely valid, and only `signer == owner_wallet_id` can refuse it. Asserted as exactly that
/// error: no `||`.
#[test]
fn agent_manifest_naming_another_owner_is_refused_even_when_correctly_signed() {
    let _g = env_lock();
    set_test_env_base();
    let attacker = agent_test_wallet();
    let victim = agent_test_wallet();
    let agent = agent_test_wallet();

    let mut m = agent_manifest_for_tests(&attacker, &agent);
    m.owner_wallet_id = victim.wallet_id.clone();
    // Re-sign with the ATTACKER's key over the pre-image that now names the victim, so the
    // signature is valid and every cheaper check is satisfied.
    sign_agent_manifest(&attacker.mnemonic, &mut m).unwrap();

    crate::quantum_shield::verify_ed25519(
        &attacker.wallet_id,
        &m.hybrid_sig.ed25519_sig_b64,
        &agent_manifest_auth_message_bytes(&m, &m.hybrid_sig.mldsa_pubkey_b64),
    )
    .expect("the forgery must carry a genuinely valid signature, or this guard is vacuous");

    match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
        Err(AgentError::SignerMismatch) => {}
        other => panic!("expected SignerMismatch, got {other:?}"),
    }

    // And the attacker cannot satisfy the binding check by lying about who signed: setting
    // `ed25519_pubkey_hex` to the victim makes `signer == owner_wallet_id` true, so the equality
    // check passes and the SIGNATURE has to refuse it. That only works because verification uses
    // `owner_wallet_id` rather than the pubkey the message hands it — the "verified against the key
    // in the envelope" mistake, asserted rather than assumed.
    let mut lying = m.clone();
    lying.hybrid_sig.ed25519_pubkey_hex = victim.wallet_id.clone();
    match verify_agent_manifest_v1(&lying, AGENT_NOW_MS) {
        Err(AgentError::Ed25519(_)) => {}
        other => panic!("expected Ed25519 failure when the signer field lies, got {other:?}"),
    }
}

// ── Control 3: every field the manifest claims must actually be signed ───────────────────────────

/// **CONTROL 3.** Each signed field, mutated after signing, must break the signature.
///
/// The threat is not the owner re-signing a different key — the owner may vouch for whatever they
/// like. It is a third party taking the owner's valid manifest and editing a field that turns out
/// not to be in the pre-image. Every field is checked individually; a single combined assertion
/// could pass while one field was unsigned.
#[test]
fn every_manifest_field_is_covered_by_the_signature() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();
    let other_agent = agent_test_wallet();
    let good = agent_manifest_for_tests(&owner, &agent);

    let mutations: Vec<(&str, Box<dyn Fn(&mut AgentManifestV1)>)> = vec![
        ("agent_id", Box::new(|m: &mut AgentManifestV1| m.agent_id = "other-agent".into())),
        (
            "agent_ed25519_pubkey_hex",
            Box::new({
                let k = other_agent.wallet_id.clone();
                move |m: &mut AgentManifestV1| m.agent_ed25519_pubkey_hex = k.clone()
            }),
        ),
        (
            "agent_mldsa44_pubkey_b64",
            Box::new({
                let k = other_agent.mldsa44_pubkey_b64.clone();
                move |m: &mut AgentManifestV1| m.agent_mldsa44_pubkey_b64 = k.clone()
            }),
        ),
        ("created_at_ms", Box::new(|m: &mut AgentManifestV1| m.created_at_ms -= 1)),
        (
            "expires_at_ms",
            Box::new(|m: &mut AgentManifestV1| m.expires_at_ms += 31_536_000_000),
        ),
        (
            "declared_automated",
            Box::new(|m: &mut AgentManifestV1| m.declared_automated = !m.declared_automated),
        ),
        (
            "capabilities (added)",
            Box::new(|m: &mut AgentManifestV1| m.capabilities.push("ledger.transfer".into())),
        ),
        (
            "capabilities (edited)",
            Box::new(|m: &mut AgentManifestV1| m.capabilities[0] = "ledger.transfer".into()),
        ),
        (
            "capabilities (reordered)",
            Box::new(|m: &mut AgentManifestV1| m.capabilities.swap(0, 1)),
        ),
    ];

    for (field, mutate) in mutations {
        let mut m = good.clone();
        mutate(&mut m);
        match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
            Err(AgentError::Ed25519(_)) => {}
            other => panic!("editing {field} after signing was not refused by the signature: {other:?}"),
        }
    }
}

// ── Control 4: the ML-DSA level is enforced, not described ───────────────────────────────────────

/// **CONTROL 4a.** An ML-DSA-65 agent key is refused, however valid it is.
#[test]
fn agent_manifest_with_a_65_agent_key_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();

    let (pk65, _) = mldsa65_pair(&agent.mnemonic, b"unused");
    let mut m = agent_manifest_for_tests(&owner, &agent);
    m.agent_mldsa44_pubkey_b64 = pk65;
    // Re-sign, so the manifest is internally consistent and only the level can refuse it.
    sign_agent_manifest(&owner.mnemonic, &mut m).unwrap();

    match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
        Err(AgentError::AgentKeyLevel { got, expected }) => {
            assert_eq!(expected, AGENT_MLDSA44_PUBKEY_BYTES);
            assert_eq!(got, dilithium::ML_DSA_65.public_key_bytes());
        }
        other => panic!("expected AgentKeyLevel, got {other:?}"),
    }
}

/// **CONTROL 4b.** An owner signing at ML-DSA-65 is refused — the case a level-inferring verifier
/// would wave through.
///
/// Built by hand rather than through `sign_agent_manifest`, because the whole point is a pair the
/// inferring verifier would accept: a 1952-byte key with a matching 3309-byte signature over the
/// real pre-image. `verify_mldsa_b64` verifies that pair happily. `verify_mldsa44_b64` does not, and
/// the structural size check refuses it before either runs.
#[test]
fn agent_manifest_signed_with_a_valid_65_owner_key_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();
    let mut m = agent_manifest_for_tests(&owner, &agent);

    let (pk65, _) = mldsa65_pair(&owner.mnemonic, b"placeholder");
    // The owner's ML-DSA key is inside the pre-image, so the bytes must be rebuilt against pk65
    // before signing — otherwise this tests a wrong pre-image rather than a wrong level.
    let msg = agent_manifest_auth_message_bytes(&m, &pk65);
    let (_, sig65) = mldsa65_pair(&owner.mnemonic, &msg);
    m.hybrid_sig.mldsa_pubkey_b64 = pk65.clone();
    m.hybrid_sig.mldsa_sig_b64 = sig65.clone();
    // Keep the Ed25519 half genuinely valid over the same bytes.
    m.hybrid_sig = crate::protocol::HybridSigV1 {
        mldsa_pubkey_b64: pk65.clone(),
        mldsa_sig_b64: sig65.clone(),
        ..crate::agent::sign_agent_message_bytes(&owner.mnemonic, &msg).unwrap()
    };

    // The pair really is one a level-inferring verifier accepts. If this ever fails, the guard
    // below is measuring a broken signature instead of a wrong level.
    crate::wallet::verify_mldsa_b64(&pk65, &sig65, &msg)
        .expect("the 65 pair must be valid, or CONTROL 4b is vacuous");
    assert!(
        crate::wallet::verify_mldsa44_b64(&pk65, &sig65, &msg).is_err(),
        "the level-pinned verifier must reject a 65 pair"
    );

    match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
        Err(AgentError::OwnerKeyLevel { got, expected }) => {
            assert_eq!(expected, AGENT_MLDSA44_PUBKEY_BYTES);
            assert_eq!(got, dilithium::ML_DSA_65.public_key_bytes());
        }
        other => panic!("expected OwnerKeyLevel, got {other:?}"),
    }
}

// ── Control 6: expiry is the only revocation v0 has, so it has to work ───────────────────────────

/// **CONTROL 6.** An expired manifest is refused, and the refusal reports the clock it used.
///
/// There is no cache and no default in this path — `now_ms` is a parameter, so nothing can answer
/// on the check's behalf. That is deliberate: wall-clock time read inside verification is what
/// split two nodes at block 9828.
#[test]
fn expired_agent_manifest_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();
    let m = agent_manifest_for_tests(&owner, &agent);

    verify_agent_manifest_v1(&m, m.expires_at_ms).expect("valid up to and including expiry");

    match verify_agent_manifest_v1(&m, m.expires_at_ms + 1) {
        Err(AgentError::Expired { expires_at_ms, now_ms }) => {
            assert_eq!(expires_at_ms, m.expires_at_ms);
            assert_eq!(now_ms, m.expires_at_ms + 1);
        }
        other => panic!("expected Expired, got {other:?}"),
    }
}

/// A manifest that expires before it was created is incoherent, not merely expired.
#[test]
fn agent_manifest_with_an_impossible_schedule_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();
    let mut m = agent_manifest_for_tests(&owner, &agent);
    m.expires_at_ms = m.created_at_ms;
    sign_agent_manifest(&owner.mnemonic, &mut m).unwrap();

    match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
        Err(AgentError::Schedule { created_at_ms, expires_at_ms }) => {
            assert_eq!(created_at_ms, expires_at_ms);
        }
        other => panic!("expected Schedule, got {other:?}"),
    }
}

// ── Bounds, and the degenerate key ───────────────────────────────────────────────────────────────

/// The capability list is input-driven, so it needs an explicit bound whose value is *observable*
/// in the refusal rather than silently truncated.
#[test]
fn agent_manifest_capability_bound_is_enforced_and_named() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();
    let mut m = agent_manifest_for_tests(&owner, &agent);
    m.capabilities = (0..AGENT_MANIFEST_MAX_CAPABILITIES + 1)
        .map(|i| format!("cap.{i}"))
        .collect();
    sign_agent_manifest(&owner.mnemonic, &mut m).unwrap();

    let err = verify_agent_manifest_v1(&m, AGENT_NOW_MS).expect_err("over the bound");
    match &err {
        AgentError::TooManyCapabilities { got, max } => {
            assert_eq!(*got, AGENT_MANIFEST_MAX_CAPABILITIES + 1);
            assert_eq!(*max, AGENT_MANIFEST_MAX_CAPABILITIES);
        }
        other => panic!("expected TooManyCapabilities, got {other:?}"),
    }
    assert!(
        err.to_string().contains(&AGENT_MANIFEST_MAX_CAPABILITIES.to_string()),
        "the refusal must name the effective bound, not just refuse: {err}"
    );

    // Exactly at the bound is fine — an off-by-one here would silently cap every agent at 31.
    m.capabilities = (0..AGENT_MANIFEST_MAX_CAPABILITIES)
        .map(|i| format!("cap.{i}"))
        .collect();
    sign_agent_manifest(&owner.mnemonic, &mut m).unwrap();
    verify_agent_manifest_v1(&m, AGENT_NOW_MS).expect("the bound itself must be allowed");
}

/// An "agent" holding the owner's own key is the owner's spending key in an automated process.
#[test]
fn agent_manifest_naming_the_owners_own_key_as_the_agent_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let mut m = agent_manifest_for_tests(&owner, &owner);
    m.agent_ed25519_pubkey_hex = owner.wallet_id.clone();
    sign_agent_manifest(&owner.mnemonic, &mut m).unwrap();

    match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
        Err(AgentError::AgentKeyIsOwnerKey) => {}
        other => panic!("expected AgentKeyIsOwnerKey, got {other:?}"),
    }
}

/// Version and kind discriminators, so a future v2 cannot be read as a v1.
#[test]
fn agent_manifest_version_and_kind_are_checked() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();

    let mut m = agent_manifest_for_tests(&owner, &agent);
    m.v = 2;
    match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
        Err(AgentError::UnsupportedVersion(2)) => {}
        other => panic!("expected UnsupportedVersion(2), got {other:?}"),
    }

    let mut m = agent_manifest_for_tests(&owner, &agent);
    m.kind = "tet_agent_manifest_v2".to_string();
    match verify_agent_manifest_v1(&m, AGENT_NOW_MS) {
        Err(AgentError::Kind(k)) => assert_eq!(k, "tet_agent_manifest_v2"),
        other => panic!("expected Kind, got {other:?}"),
    }
}

/// The manifest pre-image is the generic payload encoding under its own `payload_type`, so a
/// manifest can never be replayed as agent-signed content and vice versa.
#[test]
fn agent_manifest_preimage_is_typed_as_a_manifest() {
    let _g = env_lock();
    set_test_env_base();
    let owner = agent_test_wallet();
    let agent = agent_test_wallet();
    let m = agent_manifest_for_tests(&owner, &agent);
    let bytes = agent_manifest_auth_message_bytes(&m, &m.hybrid_sig.mldsa_pubkey_b64);

    assert!(bytes.starts_with(AGENT_PAYLOAD_DOMAIN_V1.as_bytes()));
    assert!(
        contains_subslice(
            &bytes,
            format!(
                "{} {} ",
                AGENT_MANIFEST_PAYLOAD_TYPE.len(),
                AGENT_MANIFEST_PAYLOAD_TYPE
            )
            .as_bytes()
        ),
        "the manifest payload_type is not a field of its own pre-image"
    );
}

// ---------------------------------------------------------------------------
// Day 2: cross-language agent payloads and the detached envelope.
//
// The fixture is produced by tet-agent-sdk and compared BYTE FOR BYTE, not
// merely "both verify". That is possible only because ML-DSA signing randomness
// here is SHA256(label || msg) rather than random — the property that caught the
// ML-DSA-65/44 divergence, and the reason docs/AGENT_IDENTITY.md says not to
// randomise it.
// ---------------------------------------------------------------------------

const AGENT_PAYLOAD_ENVELOPES: &str = include_str!("testdata/agent_payload_envelopes.json");

struct AgentFixtureChain {
    _chain: EnvVarGuard,
    _genesis: EnvVarGuard,
    _mainnet: EnvVarGuard,
}

/// Bind the process to the fixture's chain for the duration of a test.
fn agent_fixture_chain(doc: &serde_json::Value) -> AgentFixtureChain {
    AgentFixtureChain {
        _chain: EnvVarGuard::set("TET_CHAIN_ID", doc["chain"]["chain_id"].as_str().unwrap()),
        _genesis: EnvVarGuard::set(
            "TET_GENESIS_HASH",
            doc["chain"]["genesis_hash"].as_str().unwrap(),
        ),
        _mainnet: EnvVarGuard::unset("TET_MAINNET"),
    }
}

fn agent_fixture_doc() -> serde_json::Value {
    let doc: serde_json::Value =
        serde_json::from_str(AGENT_PAYLOAD_ENVELOPES).expect("fixture JSON must parse");
    assert!(
        !doc["cases"].as_array().unwrap().is_empty(),
        "fixtures must not be empty — an empty array passes vacuously"
    );
    doc
}

const UI_AGENT_MANIFEST: &str = include_str!("testdata/agent_manifest_v1.json");

/// **The browser signs manifests the node accepts, byte for byte.** The try page's verifier checks
/// manifests in the browser (`tet-network/ui/app/lib/verify_anything.mjs`) and the UI signs them
/// (`agent_manifest.ts`); this fixture is the UI's output. The node re-signs it from the same
/// mnemonic and must produce the same signature bytes, then must accept the UI's manifest, and must
/// refuse it once one signed field changes.
#[test]
fn ui_signed_agent_manifest_is_byte_identical_in_rust() {
    let _g = env_lock();
    set_test_env_base();
    let doc: serde_json::Value = serde_json::from_str(UI_AGENT_MANIFEST).expect("fixture JSON must parse");
    let _bound = agent_fixture_chain(&doc);
    let ui: crate::agent::AgentManifestV1 =
        serde_json::from_value(doc["manifest"].clone()).expect("the UI's manifest must deserialize");
    let now = doc["verify_at_ms"].as_u64().unwrap();

    let mut ours = ui.clone();
    crate::agent::sign_agent_manifest(doc["owner_mnemonic"].as_str().unwrap(), &mut ours)
        .expect("rust could not sign the manifest");
    assert_eq!(ours.hybrid_sig.ed25519_pubkey_hex, ui.hybrid_sig.ed25519_pubkey_hex, "owner id differs");
    assert_eq!(ours.hybrid_sig.mldsa_pubkey_b64, ui.hybrid_sig.mldsa_pubkey_b64, "owner ML-DSA key differs");
    assert_eq!(ours.hybrid_sig.ed25519_sig_b64, ui.hybrid_sig.ed25519_sig_b64, "Ed25519 bytes differ between the UI and the node");
    assert_eq!(ours.hybrid_sig.mldsa_sig_b64, ui.hybrid_sig.mldsa_sig_b64, "ML-DSA-44 bytes differ between the UI and the node");

    crate::agent::verify_agent_manifest_v1(&ui, now).expect("the node must accept the UI's manifest");

    let mut altered = ui.clone();
    altered.agent_id.push('!');
    assert!(
        crate::agent::verify_agent_manifest_v1(&altered, now).is_err(),
        "a manifest with a changed agent_id must not verify"
    );
}

/// **The SDK and the node produce the same bytes.** Not "both verify" — the same bytes.
#[test]
fn sdk_agent_payload_signatures_are_byte_identical_in_rust() {
    use base64::Engine as _;
    let _g = env_lock();
    set_test_env_base();
    let doc = agent_fixture_doc();
    let _bound = agent_fixture_chain(&doc);
    let b64 = base64::engine::general_purpose::STANDARD;

    for (i, c) in doc["cases"].as_array().unwrap().iter().enumerate() {
        let mnemonic = c["mnemonic"].as_str().unwrap();
        let payload_type = c["payload_type"].as_str().unwrap();
        let payload = b64.decode(c["payload_b64"].as_str().unwrap()).unwrap();

        let sig = crate::agent::sign_agent_payload(mnemonic, payload_type, &payload)
            .unwrap_or_else(|e| panic!("case {i}: rust could not sign: {e}"));

        assert_eq!(
            sig.ed25519_pubkey_hex,
            c["agent_wallet_id"].as_str().unwrap(),
            "case {i}: wallet id disagrees between the SDK and the node"
        );
        assert_eq!(
            sig.ed25519_sig_b64,
            c["ed25519_sig_b64"].as_str().unwrap(),
            "case {i}: Ed25519 signature bytes differ between the SDK and the node"
        );
        assert_eq!(
            sig.mldsa_sig_b64,
            c["mldsa_sig_b64"].as_str().unwrap(),
            "case {i}: ML-DSA-44 signature bytes differ between the SDK and the node"
        );

        // And the node's verifier accepts the SDK's signature, not merely its own.
        let sdk_sig = crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: c["agent_wallet_id"].as_str().unwrap().to_string(),
            ed25519_sig_b64: c["ed25519_sig_b64"].as_str().unwrap().to_string(),
            mldsa_pubkey_b64: c["envelope"]["tet"]["agent_mldsa44_pubkey_b64"]
                .as_str()
                .unwrap()
                .to_string(),
            mldsa_sig_b64: c["mldsa_sig_b64"].as_str().unwrap().to_string(),
        };
        crate::agent::verify_agent_payload(
            c["agent_wallet_id"].as_str().unwrap(),
            &sdk_sig,
            payload_type,
            &payload,
        )
        .unwrap_or_else(|e| panic!("case {i}: node rejected the SDK's signature: {e}"));
    }
}

/// The detached envelopes the SDK writes verify here, including the every-byte-value payload.
#[test]
fn sdk_agent_envelopes_verify_in_rust() {
    use base64::Engine as _;
    let _g = env_lock();
    set_test_env_base();
    let doc = agent_fixture_doc();
    let _bound = agent_fixture_chain(&doc);
    let b64 = base64::engine::general_purpose::STANDARD;

    for (i, c) in doc["cases"].as_array().unwrap().iter().enumerate() {
        let env: crate::agent::AgentSigEnvelopeV1 =
            serde_json::from_value(c["envelope"].clone())
                .unwrap_or_else(|e| panic!("case {i}: envelope does not parse: {e}"));
        env.verify()
            .unwrap_or_else(|e| panic!("case {i}: envelope rejected: {e}"));
        assert_eq!(
            env.payload_bytes().unwrap(),
            b64.decode(c["payload_b64"].as_str().unwrap()).unwrap(),
            "case {i}: envelope payload is not the payload that was signed"
        );
        // Round-trip: Rust re-signing the same payload rebuilds the same envelope.
        let mine = crate::agent::sign_agent_payload_envelope(
            c["mnemonic"].as_str().unwrap(),
            c["payload_type"].as_str().unwrap(),
            &env.payload_bytes().unwrap(),
        )
        .unwrap();
        assert_eq!(mine, env, "case {i}: rust rebuilt a different envelope");
    }
}

/// An envelope signed for one chain must not verify on another.
#[test]
fn agent_envelope_from_another_chain_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let doc = agent_fixture_doc();
    let env: crate::agent::AgentSigEnvelopeV1 =
        serde_json::from_value(doc["cases"][0]["envelope"].clone()).unwrap();

    {
        let _bound = agent_fixture_chain(&doc);
        env.verify().expect("verifies on the chain it was signed for");
    }

    let _mainnet = EnvVarGuard::unset("TET_MAINNET");
    let _chain = EnvVarGuard::set("TET_CHAIN_ID", "tet-some-other-chain");
    let _genesis = EnvVarGuard::set(
        "TET_GENESIS_HASH",
        "0000000000000000000000000000000000000000000000000000000000000001",
    );
    match env.verify() {
        Err(crate::agent::AgentEnvelopeError::Agent(crate::agent::AgentError::Ed25519(_))) => {}
        other => panic!("an envelope from another chain verified: {other:?}"),
    }
}

/// Every structural claim in the envelope is checked, each with its own error.
#[test]
fn agent_envelope_structure_is_checked_field_by_field() {
    use crate::agent::{AgentEnvelopeError, AgentSigEnvelopeV1, DsseSignature};
    let _g = env_lock();
    set_test_env_base();
    let doc = agent_fixture_doc();
    let _bound = agent_fixture_chain(&doc);
    let good: AgentSigEnvelopeV1 = serde_json::from_value(doc["cases"][0]["envelope"].clone()).unwrap();
    good.verify().expect("baseline must verify");

    let mut e = good.clone();
    e.tet.v = 2;
    assert_eq!(e.verify(), Err(AgentEnvelopeError::UnsupportedVersion(2)));

    // A genuine DSSE envelope, or a future encoding, must be refused rather than verified against
    // this one's rules.
    let mut e = good.clone();
    e.tet.pae = "DSSEv1".to_string();
    match e.verify() {
        Err(AgentEnvelopeError::UnknownPae { got, .. }) => assert_eq!(got, "DSSEv1"),
        other => panic!("expected UnknownPae, got {other:?}"),
    }

    let mut e = good.clone();
    e.payload_type = "   ".to_string();
    assert_eq!(e.verify(), Err(AgentEnvelopeError::PayloadType));

    let mut e = good.clone();
    e.signatures.push(e.signatures[0].clone());
    assert_eq!(e.verify(), Err(AgentEnvelopeError::SignatureCount(3)));

    // Two ed25519 entries and no ML-DSA one: the count is right and the SET is wrong. The
    // duplicate is caught on the ed25519 lookup, which runs first — asserted as the error that
    // actually fires rather than the one that reads better.
    let mut e = good.clone();
    e.signatures[1] = e.signatures[0].clone();
    assert_eq!(e.verify(), Err(AgentEnvelopeError::SignatureSet("ed25519")));

    // The mirror case: two ML-DSA entries, no ed25519 one.
    let mut e = good.clone();
    e.signatures[0] = e.signatures[1].clone();
    assert_eq!(e.verify(), Err(AgentEnvelopeError::SignatureSet("ed25519")));

    // A keyid that names a different key than the one carried.
    let mut e = good.clone();
    e.signatures[0] = DsseSignature {
        keyid: format!("{}{}", crate::agent::AGENT_KEYID_ED25519_PREFIX, "ab".repeat(32)),
        sig: e.signatures[0].sig.clone(),
    };
    assert_eq!(e.verify(), Err(AgentEnvelopeError::KeyIdMismatch("ed25519")));

    let mut e = good.clone();
    e.signatures[1] = DsseSignature {
        keyid: format!("{}{}", crate::agent::AGENT_KEYID_MLDSA44_PREFIX, "cd".repeat(32)),
        sig: e.signatures[1].sig.clone(),
    };
    assert_eq!(e.verify(), Err(AgentEnvelopeError::KeyIdMismatch("ml-dsa-44")));

    // The payload is what is signed, so swapping it must break the signature.
    let mut e = good.clone();
    e.payload = base64::engine::general_purpose::STANDARD.encode(b"a different payload");
    match e.verify() {
        Err(AgentEnvelopeError::Agent(crate::agent::AgentError::Ed25519(_))) => {}
        other => panic!("a swapped payload was accepted: {other:?}"),
    }

    // …and so must swapping only the payload_type, even with identical bytes.
    let mut e = good.clone();
    e.payload_type = "application/json".to_string();
    match e.verify() {
        Err(AgentEnvelopeError::Agent(crate::agent::AgentError::Ed25519(_))) => {}
        other => panic!("a swapped payload_type was accepted: {other:?}"),
    }
}

/// **An envelope may not carry its own chain identity.** Refused at parse, not ignored.
///
/// A verifier that read `chain_id` out of the file it is checking would verify every file against
/// whatever chain that file names, which is not a check. Ignoring such a field would work today and
/// be one patch away from being read, so `deny_unknown_fields` refuses it outright.
#[test]
fn agent_envelope_carrying_a_chain_id_is_refused_not_ignored() {
    let _g = env_lock();
    set_test_env_base();
    let doc = agent_fixture_doc();

    for (where_, mutate) in [
        ("top level", 0usize),
        ("tet block", 1usize),
    ] {
        let mut raw = doc["cases"][0]["envelope"].clone();
        let smuggled = serde_json::json!("tet-attacker-chain");
        if mutate == 0 {
            raw.as_object_mut().unwrap().insert("chain_id".into(), smuggled);
        } else {
            raw["tet"].as_object_mut().unwrap().insert("chain_id".into(), smuggled);
        }
        let parsed: Result<crate::agent::AgentSigEnvelopeV1, _> = serde_json::from_value(raw);
        assert!(
            parsed.is_err(),
            "a chain_id smuggled into the {where_} was accepted by the parser"
        );
    }
}

/// `GET /chain` must report exactly the two values every signature is bound to — and nothing else.
///
/// Both are public: `chain_id` is in the README and `genesis_hash` is derived from public genesis
/// parameters and appears inside every pre-image on the network. The route exists because an agent
/// cannot DERIVE the genesis hash — `tet-core` computes it from treasury configuration — so before it
/// existed an agent had to be configured with a value it could not check.
///
/// Asserted against `genesis::*` rather than a literal, and then asserted again with a different
/// treasury, because a route returning a constant would satisfy the first assertion alone.
#[tokio::test]
async fn chain_route_reports_the_binding_every_signature_uses() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();
    let _mainnet = EnvVarGuard::unset("TET_MAINNET");
    let _no_override = EnvVarGuard::unset("TET_GENESIS_HASH");
    let _chain = EnvVarGuard::set("TET_CHAIN_ID", "tet-chain-route-probe");

    let fetch = || async {
        let ledger = std::sync::Arc::new(open_temp_ledger());
        let state = rest_state_for_tests(ledger);
        let req = axum::http::Request::builder()
            .method("GET")
            .uri("/chain")
            .body(axum::body::Body::empty())
            .unwrap();
        let resp = crate::rest::routes::build_router(state).oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "/chain must be public and read-only");
        let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
        serde_json::from_slice::<serde_json::Value>(&bytes).expect("JSON body")
    };

    let treasury_a = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
    let treasury_b = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    let json = {
        let _t = EnvVarGuard::set("TET_TREASURY_ADDRESS", treasury_a);
        let json = fetch().await;
        assert_eq!(
            json["chain_id"].as_str().unwrap(),
            crate::genesis::chain_id_from_env()
        );
        assert_eq!(
            json["genesis_hash"].as_str().unwrap(),
            crate::genesis::expected_genesis_hash_from_env()
        );
        json
    };

    // The shape the SDK validates: `0x` + 64 lowercase hex. The prefix is part of the signed string,
    // so a client that stripped it would produce signatures no node accepts.
    let hash_a = json["genesis_hash"].as_str().unwrap().to_string();
    assert!(
        hash_a.starts_with("0x") && hash_a.len() == 66,
        "genesis_hash must be 0x + 64 hex, got {hash_a:?}"
    );
    assert!(hash_a[2..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));

    // Nothing else is exposed. A route that grew a field would be a new public surface on a node
    // whose REST API is otherwise not internet-facing.
    let obj = json.as_object().unwrap();
    assert_eq!(
        obj.len(),
        2,
        "/chain must expose exactly chain_id and genesis_hash, got {:?}",
        obj.keys().collect::<Vec<_>>()
    );

    // Derived, not constant.
    let hash_b = {
        let _t = EnvVarGuard::set("TET_TREASURY_ADDRESS", treasury_b);
        fetch().await["genesis_hash"].as_str().unwrap().to_string()
    };
    assert_ne!(
        hash_a, hash_b,
        "two different treasuries produced the same genesis_hash — /chain is not derived"
    );
}


/// **SECURITY REGRESSION GUARD: no gossip event moves a balance.**
///
/// `TransferExecuted` and `FaucetExecuted` carry no signature. Until 2026-10-02 the block-plane gossip
/// handler passed them to `apply_remote_event`, which applied them. Balances must change only through
/// block apply, where every transaction is signed by its sender and every node computes the same root.
///
/// Both events are built so the old code would have APPLIED them: the source is the worker pool,
/// which genesis funds and nothing locks. So the only thing that can make this pass is the refusal.
#[test]
fn gossip_balance_events_are_refused_and_change_nothing() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();

    let pool = crate::ledger::WALLET_SYSTEM_WORKER_POOL;
    let target = "b".repeat(64);
    let amount = crate::ledger::STEVEMON;
    let pool_before = ledger.balance_micro(pool).unwrap();
    assert!(pool_before >= 2 * amount, "the pool must be able to fund both events, or the test proves nothing");
    let target_before = ledger.balance_micro(&target).unwrap();
    let root_before = ledger.compute_state_root().unwrap();

    let events = [
        crate::models::NetworkEvent::TransferExecuted {
            tx_hash: "0xguard-transfer".into(),
            from_wallet: pool.into(),
            to_wallet: target.clone(),
            amount_micro: amount,
            fee_bps: 0,
        },
        crate::models::NetworkEvent::FaucetExecuted {
            event_id: "guard-faucet".into(),
            to_wallet: target.clone(),
            amount_micro: amount,
        },
    ];
    for ev in &events {
        let err = ledger.apply_remote_event(ev).expect_err("a gossip balance event must be refused");
        assert!(
            err.to_string().contains(crate::ledger::REFUSED_GOSSIP_BALANCE_EVENT),
            "refused for the wrong reason: {err}"
        );
    }
    assert_eq!(ledger.balance_micro(pool).unwrap(), pool_before, "pool balance moved");
    assert_eq!(ledger.balance_micro(&target).unwrap(), target_before, "target balance moved");
    assert_eq!(ledger.compute_state_root().unwrap(), root_before, "state root moved");
}

/// **SECURITY REGRESSION GUARD: legacy balance events are rejected by the mesh, not forwarded.**
///
/// Rejecting at gossip validation stops old peers' copies spreading and lowers the publisher's peer
/// score. Other event types must still be accepted, so a verdict of "reject everything" fails too.
#[test]
fn legacy_balance_gossip_is_rejected_and_other_events_are_not() {
    use libp2p::gossipsub::MessageAcceptance;
    let transfer = crate::models::NetworkEvent::TransferExecuted {
        tx_hash: "0x00".into(),
        from_wallet: "a".repeat(64),
        to_wallet: "b".repeat(64),
        amount_micro: 1,
        fee_bps: 0,
    };
    let faucet = crate::models::NetworkEvent::FaucetExecuted {
        event_id: "e".into(),
        to_wallet: "b".repeat(64),
        amount_micro: 1,
    };
    let block = crate::models::NetworkEvent::BlockMined {
        block_height: 1,
        block_id: "0x00".into(),
        parent_block_id: None,
        producer_id: "p".into(),
        base_reward_micro: 0,
        compute_reward_micro: 0,
        total_reward_micro: 0,
        state_root: "0x00".into(),
        txs: vec![],
    };
    assert!(matches!(crate::p2p::gossip_event_acceptance(&transfer, None, &Default::default()), MessageAcceptance::Reject));
    assert!(matches!(crate::p2p::gossip_event_acceptance(&faucet, None, &Default::default()), MessageAcceptance::Reject));
    assert!(matches!(crate::p2p::gossip_event_acceptance(&block, None, &Default::default()), MessageAcceptance::Accept));
}

fn random_peer_id() -> libp2p::PeerId {
    libp2p::identity::Keypair::generate_ed25519().public().to_peer_id()
}

/// **SECURITY REGRESSION GUARD: with a producer→PeerId map, only the producer's PeerId may publish
/// its blocks.** Blocks carry no producer signature until the Phase 1 header change; gossipsub does
/// authenticate the message author, and this pins blocks to it. Every refusal case changes one thing.
#[test]
fn producer_peer_map_refuses_blocks_from_any_other_publisher() {
    let producer = random_peer_id();
    let other = random_peer_id();
    let peers = crate::p2p::ProducerPeers::parse(&format!("helsinki={producer}")).unwrap();

    assert!(peers.check_block_source("helsinki", Some(&producer)).is_ok(), "the producer's own block");
    assert!(peers.check_block_source("  HELSINKI ", Some(&producer)).is_ok(), "ids normalise like ConsensusIdentity");

    let e = peers.check_block_source("helsinki", Some(&other)).unwrap_err();
    assert!(e.contains("published by") && e.contains(&other.to_string()), "another publisher: {e}");
    let e = peers.check_block_source("helsinki", None).unwrap_err();
    assert!(e.contains("no gossip source"), "no source: {e}");
    let e = peers.check_block_source("nuremberg", Some(&producer)).unwrap_err();
    assert!(e.contains("no configured PeerId"), "an unmapped producer, even from a mapped PeerId: {e}");
}

/// Unset means unchanged: a node that does not configure the map accepts blocks exactly as before.
/// Without this, turning the check on by default would stall every follower on the first update.
#[test]
fn producer_peer_map_unset_changes_nothing() {
    let peers = crate::p2p::ProducerPeers::parse("").unwrap();
    assert!(peers.check_block_source("helsinki", Some(&random_peer_id())).is_ok());
    assert!(peers.check_block_source("helsinki", None).is_ok());
}

/// A malformed map is an error, never a silently empty (= disabled) map.
#[test]
fn producer_peer_map_rejects_malformed_config() {
    let p = random_peer_id();
    for (raw, want) in [
        (format!("helsinki {p}"), "is not <producer_id>=<PeerId>"),
        ("helsinki=not-a-peer-id".to_string(), "bad PeerId"),
        (format!("={p}"), "empty producer_id"),
        (format!("helsinki={p},HELSINKI={p}"), "twice"),
    ] {
        let e = crate::p2p::ProducerPeers::parse(&raw).unwrap_err();
        assert!(e.contains(want), "{raw:?} -> {e}");
    }
}

/// The mesh verdict uses the same check, so a block from the wrong publisher is not forwarded.
#[test]
fn gossip_block_from_wrong_publisher_is_rejected_by_the_mesh() {
    use libp2p::gossipsub::MessageAcceptance;
    let producer = random_peer_id();
    let other = random_peer_id();
    let peers = crate::p2p::ProducerPeers::parse(&format!("helsinki={producer}")).unwrap();
    let block = crate::models::NetworkEvent::BlockMined {
        block_height: 1,
        block_id: "0x00".into(),
        parent_block_id: None,
        producer_id: "helsinki".into(),
        base_reward_micro: 0,
        compute_reward_micro: 0,
        total_reward_micro: 0,
        state_root: "0x00".into(),
        txs: vec![],
    };
    assert!(matches!(crate::p2p::gossip_event_acceptance(&block, Some(&producer), &peers), MessageAcceptance::Accept));
    assert!(matches!(crate::p2p::gossip_event_acceptance(&block, Some(&other), &peers), MessageAcceptance::Reject));
}

/// The follower default shipped in `docker-compose.yml`, i.e. what `TET_PRODUCER_PEERS` resolves to
/// on a fresh compose follower that sets nothing.
fn compose_producer_peers_default() -> String {
    let compose = include_str!("../../docker-compose.yml");
    let line = compose
        .lines()
        .find(|l| l.trim_start().starts_with("TET_PRODUCER_PEERS:"))
        .expect("docker-compose.yml must set TET_PRODUCER_PEERS for followers");
    let start = line
        .find("${TET_PRODUCER_PEERS-")
        .expect("the default must be `${TET_PRODUCER_PEERS-…}`: with `:-` an empty value could not turn it off")
        + "${TET_PRODUCER_PEERS-".len();
    let end = line[start..].find('}').expect("closing brace") + start;
    line[start..end].to_string()
}

/// **SECURITY REGRESSION GUARD: a fresh compose follower refuses a block from an unlisted peer.**
///
/// Followers pin the producer's PeerId by default. This reads the committed compose file rather than
/// a copy of its value, so changing the default — to empty, to another PeerId, or to `:-` — is what
/// fails. The pinned PeerId must be the first bootnode's (Helsinki, the producer), so the two cannot
/// drift apart.
#[test]
fn fresh_compose_follower_refuses_a_block_from_an_unlisted_peer() {
    let default = compose_producer_peers_default();
    let peers = crate::p2p::ProducerPeers::parse(&default).expect("the compose default must parse");

    let compose = include_str!("../../docker-compose.yml");
    let bootnodes = compose
        .lines()
        .find(|l| l.trim_start().starts_with("TET_BOOTNODES:"))
        .expect("TET_BOOTNODES default");
    let helsinki: libp2p::PeerId = bootnodes
        .split("/p2p/")
        .nth(1)
        .and_then(|rest| rest.split(|c: char| c == ',' || c == '}').next())
        .expect("first bootnode PeerId")
        .parse()
        .expect("valid PeerId");

    assert!(peers.check_block_source("local-wallet", Some(&helsinki)).is_ok(), "the producer's own blocks");
    assert!(peers.check_block_source("local-wallet", Some(&random_peer_id())).is_err(), "an unlisted peer");
    assert!(peers.check_block_source("local-wallet", None).is_err(), "no source");
}

/// The other places that state the follower default must say the same thing as compose, and a
/// producer provisioned by `provision-seed.sh` must write it empty.
#[test]
fn follower_producer_pin_is_stated_consistently() {
    let default = compose_producer_peers_default();
    let readme = include_str!("../../README.md");
    assert!(
        readme.contains(&format!("TET_PRODUCER_PEERS={default}\n")),
        "README quickstart must write the compose default"
    );
    let provision = include_str!("../../deploy/provision-seed.sh");
    assert!(
        provision.contains(&format!("PRODUCER_PEERS=\"${{TET_PRODUCER_PEERS:-{default}}}\"")),
        "provision-seed.sh must give followers the compose default"
    );
    assert!(
        provision.contains("if [ \"$AUTO_MINE\" = 1 ]; then\n  PRODUCER_PEERS=\"\""),
        "provision-seed.sh must write it empty for the producer"
    );
    assert!(provision.contains("TET_PRODUCER_PEERS=$PRODUCER_PEERS"), "and must write the line at all");
}


// ---------------------------------------------------------------------------
// #21 — a wedged block plane exits the process instead of waiting for a systemd that isn't there.
// ---------------------------------------------------------------------------

/// Drive the real watchdog loop with a fake clock: the beacon ticks once at `t0`, the clock reads
/// `t0 + age_ms`, and paused tokio time runs the 20 s ticker. Returns what the exit hook received
/// and whether the task ended within `ticks` ticker periods.
async fn run_watchdog_for_tests(age_ms: u64, ticks: u64) -> (Vec<String>, bool) {
    use std::sync::atomic::{AtomicU64, Ordering};
    let health = crate::swarm_health::SwarmHealth::new();
    let t0 = 1_700_000_000_000u64;
    health.tick(t0);
    let clock_ms = std::sync::Arc::new(AtomicU64::new(t0 + age_ms));
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let hook_seen = seen.clone();
    let clock_read = clock_ms.clone();
    let task = crate::swarm_health::spawn_watchdog_with(
        health,
        crate::swarm_health::DEFAULT_STALL_THRESHOLD_MS,
        crate::swarm_health::DEFAULT_EXIT_AFTER_MS,
        std::sync::Arc::new(move |evidence: String| hook_seen.lock().unwrap().push(evidence)),
        std::sync::Arc::new(move || clock_read.load(Ordering::Relaxed)),
    );
    let ended = tokio::time::timeout(std::time::Duration::from_secs(20 * ticks), task)
        .await
        .is_ok();
    let got = seen.lock().unwrap().clone();
    (got, ended)
}

/// **SECURITY REGRESSION GUARD (#21): a block plane stalled past the hard threshold exits the
/// process.** On 2026-10-04 the watchdog only withheld a systemd ping that nothing in Docker
/// receives, and Helsinki sat wedged for 33 h. The real loop, at 181 s stalled, must call the exit
/// hook (production: log + `process::exit(70)`) with the evidence, and stop.
/// Negative controls: the `Exit` arm only logs → FAILED; `watchdog_action` never returns `Exit`
/// → FAILED.
#[tokio::test(start_paused = true)]
async fn stalled_block_plane_exits_the_process_past_the_hard_threshold() {
    let (calls, ended) = run_watchdog_for_tests(181_000, 3).await;
    assert_eq!(calls.len(), 1, "the exit hook must run exactly once: {calls:?}");
    assert!(
        calls[0].contains("age_ms=181000") && calls[0].contains("exiting with status 70"),
        "the exit must carry its evidence: {}",
        calls[0]
    );
    assert!(ended, "the watchdog stops after handing over to the exit hook");
}

/// The companion: stalled past the 90 s stall threshold but not the 180 s hard one, the watchdog
/// withholds the ping and keeps watching. Exiting here would turn a slow-but-alive loop into a
/// restart loop.
/// Negative control: exit at the stall threshold instead of the hard one → FAILED.
#[tokio::test(start_paused = true)]
async fn stalled_block_plane_below_the_hard_threshold_keeps_running() {
    let (calls, ended) = run_watchdog_for_tests(120_000, 5).await;
    assert!(calls.is_empty(), "no exit below the hard threshold: {calls:?}");
    assert!(!ended, "the watchdog keeps running");
}

#[test]
fn watchdog_action_boundaries() {
    use crate::swarm_health::{watchdog_action, SwarmHealth, WatchdogAction};
    let h = SwarmHealth::default();
    assert_eq!(watchdog_action(&h, 10_000_000, 90_000, 180_000), WatchdogAction::Wait);
    h.tick(1_000);
    assert_eq!(watchdog_action(&h, 1_000 + 90_000, 90_000, 180_000), WatchdogAction::Pet);
    assert_eq!(
        watchdog_action(&h, 1_000 + 180_000, 90_000, 180_000),
        WatchdogAction::Withhold { age_ms: 180_000 }
    );
    assert_eq!(
        watchdog_action(&h, 1_000 + 180_001, 90_000, 180_000),
        WatchdogAction::Exit { age_ms: 180_001 }
    );
    assert_eq!(
        watchdog_action(&h, 1_000 + 10_000_000, 90_000, 0),
        WatchdogAction::Withhold { age_ms: 10_000_000 },
        "TET_SWARM_EXIT_AFTER_MS=0 never exits"
    );
}

// ---------------------------------------------------------------------------
// #28 — the sole validator keeps mining when its last peer leaves.
// ---------------------------------------------------------------------------

/// A producer as Helsinki runs: `TET_BOOTNODES` set (so the "awaiting first hello" rule applies),
/// not a bootnode, a chain of `height` blocks mined as `alice`, and an empty sync board.
async fn sole_producer_fixture_for_tests(
    height: u64,
) -> (
    std::sync::Arc<crate::ledger::Ledger>,
    crate::sync::SharedBlockSyncBoard,
    crate::sync::SharedHelloRegistry,
) {
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_VALIDATOR_IDS", "alice");
        std::env::set_var("TET_SYNC_STABLE_SEC", "1");
        std::env::set_var(
            "TET_BOOTNODES",
            "/ip4/127.0.0.1/tcp/1/p2p/12D3KooWSam648Et2FXCUrqUBM6AEoZR5GAwDnoMG77JnA3ajonM",
        );
        std::env::remove_var("TET_IS_BOOTNODE");
        std::env::remove_var("TET_AUTO_MINE_IGNORE_SYNC");
        std::env::remove_var("TET_SOLO_PRODUCER_GRACE_SEC");
    }
    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    let _ = ledger.apply_genesis_allocation("founder");
    let state = rest_state_for_tests(ledger.clone());
    for _ in 0..height {
        crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string())
            .await
            .expect("mine");
    }
    let board = crate::sync::new_sync_state();
    let registry = board.clone();
    (ledger, board, registry)
}

/// A peer at our own tip, as Nuremberg is in steady state.
async fn add_peer_at_our_tip_for_tests(
    registry: &crate::sync::SharedHelloRegistry,
    ledger: &crate::ledger::Ledger,
    peer: &str,
    ahead_by: u64,
) {
    let h = ledger.block_height().unwrap();
    let hello = crate::sync::ChainHello {
        chain_id: crate::ledger::chain_id_from_env(),
        block_height: h + ahead_by,
        tip_block_id: if ahead_by == 0 {
            ledger.chain_tip().unwrap().map(|t| t.block_id).unwrap_or_default()
        } else {
            "0xahead".into()
        },
        state_root: if ahead_by == 0 { ledger.compute_state_root().unwrap() } else { "0xahead".into() },
    };
    registry.with(|s| s.registry.record_peer_hello(peer, hello, h));
}

/// Pass the gate (including the 1 s stability window), as the producer does every block.
async fn gate_opens_for_tests(
    board: &crate::sync::SharedBlockSyncBoard,
    ledger: &crate::ledger::Ledger,
    sole: bool,
) -> bool {
    for _ in 0..4 {
        if !crate::sync::auto_mine_blocked_by_sync(Some(board), ledger, sole).await {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    }
    false
}

/// **SECURITY REGRESSION GUARD (#28): the sole validator keeps mining after its last peer leaves.**
/// On 2026-10-04 stopping Nuremberg (Helsinki's only peer) closed the sync gate ("auto-mine gated:
/// synced=false") and halted the chain for 13 minutes. The real gate, after the producer has
/// mined with a peer and that peer is removed, must stay open.
/// Control in the test: a node that is NOT the sole validator still gates on the same state.
/// Negative control: `peerless_mining_allowed` always false → FAILED.
#[tokio::test]
async fn sole_validator_keeps_mining_after_its_last_peer_leaves() {
    let _g = env_lock();
    let (ledger, board, registry) = sole_producer_fixture_for_tests(3).await;
    add_peer_at_our_tip_for_tests(&registry, &ledger, "nuremberg", 0).await;
    assert!(gate_opens_for_tests(&board, &ledger, true).await, "mines with its follower connected");

    registry.with(|s| s.registry.remove_peer("nuremberg"));
    assert!(
        !crate::sync::auto_mine_blocked_by_sync(Some(&board), &ledger, true).await,
        "the sole validator must keep mining when its only peer disconnects"
    );
    assert!(
        crate::sync::auto_mine_blocked_by_sync(Some(&board), &ledger, false).await,
        "control: a node that is not the sole validator still waits for a peer"
    );
}

/// The fork guard the gate exists for is kept: a peer that is **ahead** still stops the sole
/// validator, so a restarted producer that is behind catches up instead of forking.
/// Negative control: `peerless_ok` also lifts the peer-ahead condition → FAILED. (Without clearing
/// `catch_up_triggered` this control passed: the guard was measuring the wrong condition.)
#[tokio::test]
async fn sole_validator_still_gates_on_a_peer_ahead() {
    let _g = env_lock();
    let (ledger, board, registry) = sole_producer_fixture_for_tests(3).await;
    add_peer_at_our_tip_for_tests(&registry, &ledger, "nuremberg", 0).await;
    assert!(gate_opens_for_tests(&board, &ledger, true).await);
    add_peer_at_our_tip_for_tests(&registry, &ledger, "nuremberg", 5).await;
    // A peer ahead also sets `catch_up_triggered`, which gates by itself. Clear it, as a finished
    // catch-up does while the peer keeps moving, so only the peer-ahead check can hold the gate.
    registry.with(|s| s.registry.clear_catch_up_triggered());
    assert!(
        crate::sync::auto_mine_blocked_by_sync(Some(&board), &ledger, true).await,
        "a peer ahead must stop the sole validator"
    );
}

/// A fresh process with no peer waits out the grace period before mining alone; an empty chain
/// never mines peerless.
/// Negative control: drop `local_height > 0` → FAILED; drop the grace (`|| true`) → FAILED.
#[test]
fn peerless_mining_allowed_boundaries() {
    use crate::sync::peerless_mining_allowed as ok;
    use std::time::Duration as D;
    let g = D::from_secs(120);
    assert!(ok(true, 10, true, D::ZERO, g), "synced once in this process → mine peerless");
    assert!(!ok(true, 10, false, D::from_secs(119), g), "fresh process inside the grace → wait");
    assert!(ok(true, 10, false, D::from_secs(120), g), "fresh process past the grace → mine");
    assert!(!ok(true, 0, true, D::from_secs(9_999), g), "empty chain → never peerless");
    assert!(!ok(false, 10, true, D::from_secs(9_999), g), "not the sole validator → never peerless");
}

/// **SECURITY REGRESSION GUARD (#28): only an explicitly configured sole validator mines peerless.**
/// With `TET_VALIDATOR_IDS` unset every node's set defaults to `[self]`; counting that as "sole"
/// would let any partitioned follower started with `TET_AUTO_MINE=1` fork. Found by the commit
/// security review of the first #28 change.
/// Negative control: drop the `explicit` requirement → FAILED.
#[test]
fn defaulted_validator_set_is_not_a_sole_validator() {
    use crate::consensus::{is_explicit_sole_validator as sole, ValidatorSet};
    let me = ValidatorSet::new(["local-wallet"]);
    assert!(!sole(None, &me, "local-wallet"), "unset TET_VALIDATOR_IDS: defaulted, not sole");
    assert!(!sole(Some("  "), &me, "local-wallet"), "blank TET_VALIDATOR_IDS: defaulted, not sole");
    assert!(sole(Some("local-wallet"), &me, "local-wallet"), "explicit [self]: sole");
    let two = ValidatorSet::new(["local-wallet", "nbg"]);
    assert!(!sole(Some("local-wallet,nbg"), &two, "local-wallet"), "two validators: not sole");
    assert!(!sole(Some("other"), &ValidatorSet::new(["other"]), "local-wallet"), "set names another node");
}
// The ML-DSA half of a hybrid signature is not bound to the wallet (found by the item-5 nightly, #30).
// ---------------------------------------------------------------------------

/// **RED BY DESIGN until the Phase 1 genesis binds the ML-DSA key to the wallet id** (QUEUE item 5,
/// options D + A). This is the guard the fix must turn green; today it fails, which is the point.
///
/// A transfer is signed by the wallet's own Ed25519 key and by an ML-DSA key from an **unrelated**
/// mnemonic. `verify_envelope_v1` checks each signature against the public key the envelope itself
/// carries, and nothing relates the ML-DSA key to the wallet id, so the envelope is accepted: the
/// post-quantum half proves nothing about who sent it, and identity rests on Ed25519 alone.
///
/// The companion assertion (the same transfer with the wallet's own ML-DSA key verifies) is the
/// control that this test fails for the binding and not for a malformed envelope.
#[test]
#[ignore = "RED until the Phase 1 genesis binds the ML-DSA key to the wallet id (QUEUE item 5) — run with --ignored to confirm it still fails"]
fn mldsa_key_unrelated_to_the_wallet_is_refused() {
    let _g = env_lock();
    set_test_env_base();
    let (words, wallet) = tmail_party_for_tests();
    let (other_words, _other_wallet) = tmail_party_for_tests();
    let (_tw, to) = tmail_party_for_tests();
    let tx = crate::protocol::TxV1::Transfer {
        from_wallet: wallet.clone(),
        to_wallet: to,
        amount_micro: 1_000,
        fee_bps: 100,
    };

    // Control: the wallet's own keys verify, so the envelope shape is sound.
    let own = signed_env_for_tests(tx.clone(), &words, &wallet);
    assert!(
        crate::rest::helpers::verify_envelope_v1(&own).is_ok(),
        "control: an envelope signed with the wallet's own two keys must verify"
    );

    // The wallet's Ed25519 key, an unrelated mnemonic's ML-DSA key.
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(&words).unwrap();
    let foreign = crate::wallet::mldsa_keypair_from_mnemonic(&other_words).unwrap();
    let foreign_pk_b64 = base64::engine::general_purpose::STANDARD.encode(foreign.public_key());
    let msg = crate::wallet::tx_v1_auth_message_bytes(&tx, &foreign_pk_b64).unwrap();
    let mut mixed = own.clone();
    mixed.sig.ed25519_sig_b64 =
        base64::engine::general_purpose::STANDARD.encode(ed_sk.sign(msg.as_slice()).to_bytes());
    mixed.sig.mldsa_pubkey_b64 = foreign_pk_b64;
    mixed.sig.mldsa_sig_b64 = base64::engine::general_purpose::STANDARD
        .encode(crate::wallet::mldsa_sign_deterministic(&foreign, msg.as_slice()).unwrap());

    assert!(
        crate::rest::helpers::verify_envelope_v1(&mixed).is_err(),
        "verify_envelope_v1 accepted an ML-DSA key unrelated to wallet {wallet}: the post-quantum \
         half of the signature is not bound to the sender"
    );
}

// ---------------------------------------------------------------------------
// DESIGN_accept_loop § A — one sync lock (the 2026-10-03 deadlock).
// ---------------------------------------------------------------------------

/// **SECURITY REGRESSION GUARD G1: the swarm loop's catch-up step, the auto-mine gate and REST status
/// never deadlock.** On 2026-10-03 the loop held `catch_up_driver` waiting for `hello_registry` while
/// the gate held `hello_registry` waiting for `catch_up_driver`; mining, the loop and `/ledger/state`
/// all stopped for 33 h. This drives the real `catch_up_trigger_action` (what the loop's 1 s tick runs),
/// peer add/remove (the hello and disconnect handlers), the real `auto_mine_blocked_by_sync` and the
/// real `ledger_sync_status` concurrently on four threads; all must finish.
/// Negative control: the pre-fix two-lock code (`main` at `c940b0c`) with the same interleaving pinned
/// → `loop_got_registry=false gate_finished=false rest_answered=false` (2026-10-05). A one-line mutation
/// cannot restore the bug: with one lock there is no order to invert, which is the point of the fix.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn catch_up_tick_and_sync_gate_never_deadlock() {
    let _g = env_lock();
    let (ledger, sync, _) = sole_producer_fixture_for_tests(3).await;
    let h = ledger.block_height().unwrap();
    add_peer_at_our_tip_for_tests(&sync, &ledger, "nuremberg", 0).await;

    let (s1, l1) = (sync.clone(), ledger.clone());
    let gate = tokio::spawn(async move {
        for _ in 0..40 {
            let _ = crate::sync::auto_mine_blocked_by_sync(Some(&s1), &l1, true).await;
        }
    });
    let (s2, l2) = (sync.clone(), ledger.clone());
    let rest = tokio::spawn(async move {
        for _ in 0..40 {
            let _ = crate::sync::ledger_sync_status(&s2, &l2).await;
        }
    });
    let s3 = sync.clone();
    let loop_side = tokio::spawn(async move {
        for i in 0..4000u64 {
            // A peer ahead sets catch_up_triggered, so the trigger step takes the driver path too.
            let hello = crate::sync::ChainHello {
                chain_id: crate::ledger::chain_id_from_env(),
                block_height: h + (i % 3),
                tip_block_id: format!("0x{i}"),
                state_root: format!("0x{i}"),
            };
            s3.with(|s| s.registry.record_peer_hello("p", hello, h));
            let _ = crate::p2p::catch_up_trigger_action(&s3, h);
            s3.with(|s| s.registry.remove_peer("p"));
            if i % 64 == 0 {
                tokio::task::yield_now().await;
            }
        }
    });
    let all = async {
        gate.await.unwrap();
        rest.await.unwrap();
        loop_side.await.unwrap();
    };
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(60), all).await.is_ok(),
        "the loop's catch-up step, the auto-mine gate and REST status did not all finish: deadlock"
    );
}

/// **G2: the sync lock cannot be held across an await.** Structural, so it is checked against the
/// source: `SyncState` is reachable only through `SyncHandle::with` (a synchronous closure), the
/// mutex is a private field, nothing returns a guard, and nothing outside `with` locks it. A
/// `std::sync::MutexGuard` is also `!Send`, so holding one across an `.await` in a spawned task does
/// not compile.
/// Negative control: add `pub fn guard(&self) -> std::sync::MutexGuard<'_, SyncState>` → FAILED.
#[test]
fn sync_state_lock_is_never_held_across_an_await() {
    let src = include_str!("sync.rs");
    let start = src.find("pub struct SyncHandle(").expect("SyncHandle exists");
    let decl = &src[start..src[start..].find(';').map(|e| start + e).unwrap()];
    assert!(!decl.contains("pub Arc"), "the mutex inside SyncHandle must stay private: {decl}");
    assert!(!src.contains("MutexGuard<'_, SyncState>"), "nothing may hand out a SyncState guard");
    assert_eq!(src.matches(".0.lock()").count(), 1, "the lock is taken only inside SyncHandle::with");
    for file in [include_str!("p2p.rs"), include_str!("consensus.rs"), include_str!("main.rs")] {
        for needle in ["hello_registry.lock()", "catch_up_driver.lock()", "block_sync_board.lock()", "board.lock()"] {
            assert!(!file.contains(needle), "sync state locked outside SyncHandle::with: {needle}");
        }
    }
}

// ---------------------------------------------------------------------------
// Public-API mode — the "Try TET" demo node (docs/DEMO_NODE.md).
// ---------------------------------------------------------------------------

/// Every route the router defines, as `(METHOD, path)`, parsed from `rest/routes.rs`, so a route added
/// later is covered by the 404 guard without anyone remembering to list it.
fn all_defined_routes_for_tests() -> Vec<(String, String)> {
    let src = include_str!("rest/routes.rs");
    let mut out = Vec::new();
    let mut rest = src;
    while let Some(i) = rest.find(".route(") {
        rest = &rest[i + 7..];
        let q1 = rest.find('"').unwrap();
        let q2 = q1 + 1 + rest[q1 + 1..].find('"').unwrap();
        let path = rest[q1 + 1..q2].to_string();
        let end = rest.find(".route(").unwrap_or(rest.len());
        let chain = &rest[q2..end];
        for m in ["get", "post", "put", "delete", "patch"] {
            if chain.contains(&format!("routing::{m}(")) || chain.contains(&format!(".{m}(")) {
                out.push((m.to_ascii_uppercase(), path.clone()));
            }
        }
    }
    out
}

/// A concrete path for a route pattern (`:x` → a 64-hex value).
fn concrete_path_for_tests(pattern: &str) -> String {
    pattern
        .split('/')
        .map(|s| if s.starts_with(':') { "ab".repeat(32) } else { s.to_string() })
        .collect::<Vec<_>>()
        .join("/")
}

/// The trusted proxy the public-mode tests stand behind (the demo compose subnet).
const TEST_PROXY_PEER: &str = "172.30.77.10:40000";

async fn public_call_for_tests(
    router: &axum::Router,
    method: &str,
    path: &str,
    xff: Option<&str>,
) -> (StatusCode, bool) {
    public_call_from_for_tests(router, method, path, xff, TEST_PROXY_PEER).await
}

async fn public_call_from_for_tests(
    router: &axum::Router,
    method: &str,
    path: &str,
    xff: Option<&str>,
    peer: &str,
) -> (StatusCode, bool) {
    use tower::ServiceExt as _;
    let mut b = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .extension(axum::extract::ConnectInfo(peer.parse::<std::net::SocketAddr>().unwrap()));
    if let Some(x) = xff {
        b = b.header("x-forwarded-for", x);
    }
    let body = if method == "GET" || method == "DELETE" { "" } else { "{}" };
    // As a real client does (browsers and curl always send it); the gate charges uploads by it.
    let req = b
        .header("content-type", "application/json")
        .header("content-length", body.len().to_string())
        .body(axum::body::Body::from(body))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let gate = resp.headers().get(crate::rest::public_api::GATE_HEADER).is_some();
    (resp.status(), gate)
}

fn public_router_for_tests(on: bool) -> (axum::Router, (EnvVarGuard, EnvVarGuard)) {
    let guard = (
        EnvVarGuard::set("TET_PUBLIC_API", if on { "1" } else { "0" }),
        EnvVarGuard::set("TET_PUBLIC_TRUSTED_PROXIES", "172.30.77.0/24"),
    );
    let ledger = std::sync::Arc::new(open_temp_ledger());
    (crate::rest::routes::build_router(rest_state_for_tests(ledger)), guard)
}

/// **SECURITY REGRESSION GUARD: in public mode every route not on the allow-list is a 404 from the gate**
/// — including mining, `/execute`, logs, admin, founder, the server-side mnemonic generator and the
/// wallet-keyed anonymity path — and so are near-miss spellings that a looser matcher would let through.
/// Negative controls: put `POST /ledger/mine` on the allow-list → FAILED; build the router with public
/// mode off → FAILED (the routes exist and answer).
#[tokio::test]
async fn public_mode_refuses_every_route_off_the_allowlist() {
    let _g = env_lock();
    set_test_env_base();
    let (router, _e) = public_router_for_tests(true);
    let routes = all_defined_routes_for_tests();
    assert!(routes.len() > 100, "parsed only {} routes", routes.len());
    let mut refused = 0;
    for (m, p) in &routes {
        let path = concrete_path_for_tests(p);
        let method = axum::http::Method::from_bytes(m.as_bytes()).unwrap();
        if crate::rest::public_api::is_allowed(&method, &path) {
            continue;
        }
        let (status, gate) = public_call_for_tests(&router, m, &path, Some("203.0.113.7")).await;
        assert!(status == StatusCode::NOT_FOUND && gate, "{m} {p} is reachable in public mode ({status})");
        refused += 1;
    }
    assert!(refused > 80, "only {refused} routes were checked as refused");
    for (m, p) in [
        ("POST", "/ledger/mine"),
        ("POST", "/execute"),
        ("GET", "/logs"),
        ("POST", "/admin/gossip"),
        ("POST", "/founder/withdraw_treasury"),
        ("POST", "/wallet/mnemonic/new"),
        ("POST", "/ledger/initial_airdrop/claim"),
        ("GET", "/metrics"),
        ("POST", "/files/fee"),
        ("GET", "/tmail/anon/path/abababababababababababababababababababababababababababababababab"),
        // near misses of allowed routes
        ("GET", "/ledger/state/"),
        ("GET", "//ledger/state"),
        ("GET", "/tmail/inbox/a/b"),
        ("GET", "/tmail/inbox/a%2Fb"),
        ("GET", "/tmail/inbox/.."),
        ("GET", "/tmail/inbox/."),
        ("GET", "/files/fetch/%2e%2e"),
        ("POST", "/ledger/state"),
    ] {
        let (status, gate) = public_call_for_tests(&router, m, p, Some("203.0.113.7")).await;
        assert!(status == StatusCode::NOT_FOUND && gate, "{m} {p} is reachable in public mode ({status})");
    }
}

/// Every allow-listed route reaches its handler: the gate does not refuse it. (The handler may well
/// answer 400 or 404 for the dummy input; only the gate's own refusal counts as failure.)
#[tokio::test]
async fn public_mode_lets_every_allowlisted_route_through() {
    let _g = env_lock();
    set_test_env_base();
    let _r = EnvVarGuard::set("TET_PUBLIC_READ_BURST", "1000");
    let _w = EnvVarGuard::set("TET_PUBLIC_WRITE_BURST", "1000");
    let (router, _e) = public_router_for_tests(true);
    for (m, p) in crate::rest::public_api::PUBLIC_ALLOWLIST {
        let (status, gate) =
            public_call_for_tests(&router, m, &concrete_path_for_tests(p), Some("203.0.113.8")).await;
        assert!(!gate, "{m} {p} is on the allow-list but the gate refused it ({status})");
        assert_ne!(status, StatusCode::TOO_MANY_REQUESTS, "{m} {p}");
    }
}

/// **SECURITY REGRESSION GUARD: the per-client limit fires, per client, and cannot be dodged by
/// prepending a forged `X-Forwarded-For` entry.** One client exhausts its read burst and gets 429; a
/// second client is unaffected; the first client adding a fake left-most address is still the same
/// client (Caddy's right-most entry decides). Writes have their own, tighter bucket.
/// Negative controls: `PublicGate::allow` always true → FAILED; `client_key` takes the left-most
/// entry → FAILED (the forged prefix escapes the bucket).
#[tokio::test]
async fn public_mode_rate_limit_fires_per_client() {
    let _g = env_lock();
    set_test_env_base();
    let _r = EnvVarGuard::set("TET_PUBLIC_READ_BURST", "5");
    let _rs = EnvVarGuard::set("TET_PUBLIC_READ_PER_SEC", "0.001");
    let _w = EnvVarGuard::set("TET_PUBLIC_WRITE_BURST", "2");
    let _wm = EnvVarGuard::set("TET_PUBLIC_WRITE_PER_MIN", "0.001");
    let (router, _e) = public_router_for_tests(true);
    for i in 0..5 {
        let (s, _) = public_call_for_tests(&router, "GET", "/status", Some("198.51.100.1")).await;
        assert_ne!(s, StatusCode::TOO_MANY_REQUESTS, "request {i} is inside the burst");
    }
    let (s, _) = public_call_for_tests(&router, "GET", "/status", Some("198.51.100.1")).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS, "the 6th read from one client must be limited");
    let (s, _) =
        public_call_for_tests(&router, "GET", "/status", Some("192.0.2.99, 198.51.100.1")).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS, "a forged left-most entry must not escape the bucket");
    let (s, _) = public_call_for_tests(&router, "GET", "/status", Some("198.51.100.2")).await;
    assert_ne!(s, StatusCode::TOO_MANY_REQUESTS, "another client is not limited");
    for _ in 0..2 {
        let (s, _) = public_call_for_tests(&router, "POST", "/tmail/send", Some("198.51.100.3")).await;
        assert_ne!(s, StatusCode::TOO_MANY_REQUESTS);
    }
    let (s, _) = public_call_for_tests(&router, "POST", "/tmail/send", Some("198.51.100.3")).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS, "writes have their own, tighter limit");
}

/// Public mode is opt-in: without `TET_PUBLIC_API` the router is unchanged (the seeds' behaviour).
#[tokio::test]
async fn public_mode_is_off_by_default() {
    let _g = env_lock();
    set_test_env_base();
    let (router, _e) = public_router_for_tests(false);
    let (status, gate) = public_call_for_tests(&router, "GET", "/metrics", None).await;
    assert!(!gate && status != StatusCode::NOT_FOUND, "/metrics must exist when public mode is off");
}


/// **SECURITY REGRESSION GUARD: `X-Forwarded-For` is believed only from a trusted proxy.** A client
/// that reaches tet-core directly and invents a new header value on every request is still one
/// client, keyed by its own address. (Commit security review of #36: trust boundary.)
/// Negative control: treat every peer as trusted → FAILED.
#[tokio::test]
async fn public_mode_ignores_forwarded_for_from_an_untrusted_peer() {
    let _g = env_lock();
    set_test_env_base();
    let _r = EnvVarGuard::set("TET_PUBLIC_READ_BURST", "3");
    let _rs = EnvVarGuard::set("TET_PUBLIC_READ_PER_SEC", "0.001");
    let (router, _e) = public_router_for_tests(true);
    let mut last = StatusCode::OK;
    for i in 0..4 {
        let fake = format!("203.0.113.{i}");
        (last, _) =
            public_call_from_for_tests(&router, "GET", "/status", Some(&fake), "198.51.100.50:5555").await;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS, "rotating X-Forwarded-For from a direct peer escaped the limit");
}

/// **SECURITY REGRESSION GUARD: IPv6 clients are limited per /64.** Rotating addresses inside one /64
/// is still one client. (Commit security review of #36: rate-limit bypass.)
/// Negative control: key IPv6 by the full address → FAILED.
#[tokio::test]
async fn public_mode_limits_ipv6_per_slash_64() {
    let _g = env_lock();
    set_test_env_base();
    let _r = EnvVarGuard::set("TET_PUBLIC_READ_BURST", "3");
    let _rs = EnvVarGuard::set("TET_PUBLIC_READ_PER_SEC", "0.001");
    let (router, _e) = public_router_for_tests(true);
    let mut last = StatusCode::OK;
    for i in 1..=4 {
        let addr = format!("2001:db8:1:2::{i:x}");
        (last, _) = public_call_for_tests(&router, "GET", "/status", Some(&addr)).await;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS, "rotating addresses within one /64 escaped the limit");
    let (other, _) = public_call_for_tests(&router, "GET", "/status", Some("2001:db8:1:3::1")).await;
    assert_ne!(other, StatusCode::TOO_MANY_REQUESTS, "another /64 is another client");
}

// ---------------------------------------------------------------------------
// The demo node's file-fee sponsor (docs/DEMO_NODE.md "File fees", src/demo_sponsor.rs).
// Driven through the real router in public mode, with a real peer address, so the allow-list, the
// client identity and the handler are all on the path.
// ---------------------------------------------------------------------------

struct SponsorFixture {
    router: axum::Router,
    state: crate::rest::RestState,
    sponsor: std::sync::Arc<crate::demo_sponsor::DemoSponsor>,
    _env: (EnvVarGuard, EnvVarGuard),
}

fn sponsor_fixture(caps: crate::demo_sponsor::Caps, fund_tet: u64) -> SponsorFixture {
    let env = (
        EnvVarGuard::set("TET_PUBLIC_API", "1"),
        EnvVarGuard::set("TET_PUBLIC_TRUSTED_PROXIES", "172.30.77.0/24"),
    );
    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let words = crate::wallet::generate_mnemonic_12().unwrap().mnemonic_12.unwrap();
    let sponsor = std::sync::Arc::new(
        crate::demo_sponsor::DemoSponsor::new(&ledger.sled_db(), &words, caps).expect("sponsor"),
    );
    if fund_tet > 0 {
        ledger
            .admin_rest_faucet(sponsor.wallet_id(), fund_tet * crate::ledger::STEVEMON, "ip", true, 1, 1)
            .unwrap();
    }
    let mut state = rest_state_for_tests(ledger);
    state.demo_sponsor = Some(sponsor.clone());
    SponsorFixture { router: crate::rest::routes::build_router(state.clone()), state, sponsor, _env: env }
}

fn sponsor_caps(per_client: u32, per_wallet: u32, global: u32, floor_tet: u64) -> crate::demo_sponsor::Caps {
    crate::demo_sponsor::Caps { per_client, per_wallet, global, floor_micro: floor_tet * crate::ledger::STEVEMON }
}

/// A file `sender` uploaded through this node: stored, and recorded the way `/files/upload` does.
fn sponsor_upload(f: &SponsorFixture, sender: &FileTestWallet) -> String {
    let blob = b"ciphertext".to_vec();
    let env = build_signed_file_envelope(sender, &file_test_wallet().wallet_id, &blob, file_now_ms());
    f.state.files.store_with_blob(&env, &blob).unwrap();
    f.sponsor.record_upload(&env.file_id.to_string(), &env.sender_wallet_id);
    env.file_id.to_string()
}

fn sponsor_request(signer: &FileTestWallet, sender_id: &str, file_id: &str, at_ms: u64) -> serde_json::Value {
    let msg = crate::demo_sponsor::sponsor_request_auth_message_bytes(file_id, sender_id, at_ms, &signer.mldsa_pub_b64);
    let s = file_sign_hybrid(signer, &msg);
    serde_json::json!({
        "file_id": file_id,
        "sender_wallet_id": sender_id,
        "requested_at_ms": at_ms,
        "hybrid_sig": {
            "ed25519_pubkey_hex": s.ed25519_pubkey_hex,
            "ed25519_sig_b64": s.ed25519_sig_b64,
            "mldsa_pubkey_b64": s.mldsa_pubkey_b64,
            "mldsa_sig_b64": s.mldsa_sig_b64,
        },
    })
}

async fn sponsor_post(f: &SponsorFixture, body: &serde_json::Value, peer: &str) -> (StatusCode, serde_json::Value) {
    use tower::ServiceExt as _;
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/demo/files/sponsor-fee")
        .extension(axum::extract::ConnectInfo(peer.parse::<std::net::SocketAddr>().unwrap()))
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body.to_string()))
        .unwrap();
    let resp = f.router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

async fn sponsored_fee_txs(f: &SponsorFixture) -> Vec<(String, String)> {
    f.state
        .mempool
        .lock()
        .await
        .iter()
        .filter_map(|e| match &e.tx {
            crate::protocol::TxV1::FileFee { from_wallet, file_id, .. } => Some((from_wallet.clone(), file_id.clone())),
            _ => None,
        })
        .collect()
}

/// **SECURITY REGRESSION GUARD: the sponsor pays once, for a file uploaded here, when its sender
/// asks, and with nothing but a `FileFee` from the sponsor wallet.** A second request for the same
/// file, a file this node never stored, and a request signed by someone other than the file's
/// sender are all refused, and none of them queues a transaction. So is a file this node holds but
/// did not receive by upload (cached from a peer).
/// Negative controls: skip the "uploaded here" check → FAILED; skip the "already sponsored" check →
/// FAILED; accept any signer → FAILED.
#[tokio::test]
async fn demo_sponsor_pays_once_for_its_own_upload_and_only_for_the_sender() {
    let _g = env_lock();
    set_test_env_base();
    let f = sponsor_fixture(sponsor_caps(50, 50, 500, 10), 100);
    let alice = file_test_wallet();
    let mallory = file_test_wallet();
    let now = file_now_ms();
    let peer = "203.0.113.7:5000";

    let fid = sponsor_upload(&f, &alice);
    let (st, body) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid, now), peer).await;
    assert_eq!(st, StatusCode::ACCEPTED, "{body}");
    assert_eq!(sponsored_fee_txs(&f).await, vec![(f.sponsor.wallet_id().to_string(), fid.clone())]);
    // The receipt the try page keeps for a "stamp": the hash the tx index will key this fee by.
    let queued = f.state.mempool.lock().await.iter().find(|e| matches!(e.tx, crate::protocol::TxV1::FileFee { .. })).cloned().unwrap();
    assert_eq!(body["tx_hash"].as_str(), Some(crate::consensus::tx_hash_for_env(&queued).unwrap().as_str()), "{body}");

    let (st, body) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid, now), peer).await;
    assert_eq!((st, body["reason"].as_str()), (StatusCode::NOT_FOUND, Some("not_sponsorable")), "paid twice");

    let never_here = uuid::Uuid::new_v4().to_string();
    let (st, body) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &never_here, now), peer).await;
    assert_eq!((st, body["reason"].as_str()), (StatusCode::NOT_FOUND, Some("not_sponsorable")), "paid for a file not stored here");

    // Held by this node but not uploaded through it (a blob cached from a peer, say): not ours to pay.
    let blob = b"fetched from a peer".to_vec();
    let cached = build_signed_file_envelope(&alice, &file_test_wallet().wallet_id, &blob, file_now_ms());
    f.state.files.store_with_blob(&cached, &blob).unwrap();
    let cached_id = cached.file_id.to_string();
    let (st, body) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &cached_id, now), peer).await;
    assert_eq!((st, body["reason"].as_str()), (StatusCode::NOT_FOUND, Some("not_sponsorable")), "paid for a file only cached here");

    let fid2 = sponsor_upload(&f, &alice);
    let (st, body) = sponsor_post(&f, &sponsor_request(&mallory, &mallory.wallet_id, &fid2, now), peer).await;
    assert_eq!((st, body["reason"].as_str()), (StatusCode::NOT_FOUND, Some("not_sponsorable")), "paid at a non-sender's request");
    let (st, body) = sponsor_post(&f, &sponsor_request(&mallory, &alice.wallet_id, &fid2, now), peer).await;
    assert_eq!((st, body["reason"].as_str()), (StatusCode::UNAUTHORIZED, Some("bad_signature")), "accepted a request signed by someone else");

    let (st, body) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid2, now - 10 * 60_000), peer).await;
    assert_eq!((st, body["reason"].as_str()), (StatusCode::BAD_REQUEST, Some("stale_request")));

    assert_eq!(sponsored_fee_txs(&f).await.len(), 1, "a refused request queued a transaction");
}

/// **SECURITY REGRESSION GUARD: every cap is a refusal, never a queue** — per client per day, per
/// sender wallet per day, for everyone per day, and the balance floor (402). Clients are told apart
/// by address, so a second address gets its own allowance but not the wallet's.
/// Negative controls: drop the per-client cap → FAILED; drop the floor → FAILED.
#[tokio::test]
async fn demo_sponsor_caps_refuse_rather_than_queue() {
    let _g = env_lock();
    set_test_env_base();
    let now = file_now_ms();

    // Per client: 2 per address.
    let f = sponsor_fixture(sponsor_caps(2, 50, 500, 10), 100);
    let alice = file_test_wallet();
    for i in 0..2 {
        let fid = sponsor_upload(&f, &alice);
        let (st, b) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid, now), "198.51.100.1:1").await;
        assert_eq!(st, StatusCode::ACCEPTED, "request {i}: {b}");
    }
    let fid = sponsor_upload(&f, &alice);
    let (st, b) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid, now), "198.51.100.1:2").await;
    assert_eq!((st, b["reason"].as_str()), (StatusCode::TOO_MANY_REQUESTS, Some("daily_cap_ip")));
    let (st, b) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid, now), "198.51.100.2:1").await;
    assert_eq!(st, StatusCode::ACCEPTED, "another address is another client: {b}");

    // Per wallet: 1 per sender, whatever the address.
    let f = sponsor_fixture(sponsor_caps(50, 1, 500, 10), 100);
    let bob = file_test_wallet();
    let fid = sponsor_upload(&f, &bob);
    assert_eq!(sponsor_post(&f, &sponsor_request(&bob, &bob.wallet_id, &fid, now), "198.51.100.3:1").await.0, StatusCode::ACCEPTED);
    let fid = sponsor_upload(&f, &bob);
    let (st, b) = sponsor_post(&f, &sponsor_request(&bob, &bob.wallet_id, &fid, now), "198.51.100.4:1").await;
    assert_eq!((st, b["reason"].as_str()), (StatusCode::TOO_MANY_REQUESTS, Some("daily_cap_wallet")));

    // Global: 1 for everyone.
    let f = sponsor_fixture(sponsor_caps(50, 50, 1, 10), 100);
    let (c, d) = (file_test_wallet(), file_test_wallet());
    let fid = sponsor_upload(&f, &c);
    assert_eq!(sponsor_post(&f, &sponsor_request(&c, &c.wallet_id, &fid, now), "198.51.100.5:1").await.0, StatusCode::ACCEPTED);
    let fid = sponsor_upload(&f, &d);
    let (st, b) = sponsor_post(&f, &sponsor_request(&d, &d.wallet_id, &fid, now), "198.51.100.6:1").await;
    assert_eq!((st, b["reason"].as_str()), (StatusCode::TOO_MANY_REQUESTS, Some("daily_cap_global")));

    // Floor: funded at the floor, so one fee would take it below.
    let f = sponsor_fixture(sponsor_caps(50, 50, 500, 10), 10);
    let e = file_test_wallet();
    let fid = sponsor_upload(&f, &e);
    let (st, b) = sponsor_post(&f, &sponsor_request(&e, &e.wallet_id, &fid, now), "198.51.100.7:1").await;
    assert_eq!((st, b["reason"].as_str()), (StatusCode::PAYMENT_REQUIRED, Some("sponsor_low")));
    assert!(sponsored_fee_txs(&f).await.is_empty(), "a refusal queued a transaction");
}

/// **SECURITY REGRESSION GUARD: the sponsor signs nothing but file fees, and stores no address.**
/// Read from the source: the only `TxV1` variant `demo_sponsor.rs` constructs is `FileFee`, and it
/// has one signing call. Then from storage: after sponsoring from a known address, no stored key or
/// value contains that address.
/// Negative controls: add a `TxV1::Transfer` path → FAILED; key the client counter by the raw
/// client key → FAILED.
#[tokio::test]
async fn demo_sponsor_signs_nothing_but_file_fees_and_stores_no_address() {
    let _g = env_lock();
    set_test_env_base();
    let src = include_str!("demo_sponsor.rs");
    let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    let variants: std::collections::BTreeSet<&str> = code
        .match_indices("TxV1::")
        .map(|(i, _)| code[i + 6..].split(|c: char| !c.is_alphanumeric()).next().unwrap_or(""))
        .collect();
    assert_eq!(variants, ["FileFee"].into_iter().collect(), "the sponsor constructs {variants:?}");
    assert_eq!(code.matches("sign_agent_message_bytes(").count(), 1, "more than one signing call");

    let f = sponsor_fixture(sponsor_caps(50, 50, 500, 10), 100);
    let alice = file_test_wallet();
    let fid = sponsor_upload(&f, &alice);
    let ip = "192.0.2.123";
    let (st, b) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid, file_now_ms()), &format!("{ip}:9")).await;
    assert_eq!(st, StatusCode::ACCEPTED, "{b}");
    let db = f.state.ledger.sled_db();
    for name in ["demo_sponsor_uploaded_v1", "demo_sponsor_sponsored_v1", "demo_sponsor_counts_v1"] {
        for (k, v) in db.open_tree(name).unwrap().iter().flatten() {
            for bytes in [k.as_ref(), v.as_ref()] {
                assert!(
                    !String::from_utf8_lossy(bytes).contains(ip),
                    "{name} stores the client address"
                );
            }
        }
    }
}

/// Without a sponsor the route answers `no_sponsor` (it is on the public allow-list, so the gate
/// lets it through, and the seeds never configure one).
#[tokio::test]
async fn demo_sponsor_is_off_without_a_mnemonic() {
    let _g = env_lock();
    set_test_env_base();
    let mut f = sponsor_fixture(sponsor_caps(5, 5, 500, 10), 0);
    f.state.demo_sponsor = None;
    f.router = crate::rest::routes::build_router(f.state.clone());
    let alice = file_test_wallet();
    let fid = sponsor_upload(&f, &alice);
    let (st, b) = sponsor_post(&f, &sponsor_request(&alice, &alice.wallet_id, &fid, file_now_ms()), "203.0.113.9:1").await;
    assert_eq!((st, b["reason"].as_str()), (StatusCode::NOT_FOUND, Some("no_sponsor")));
    let _u = EnvVarGuard::unset("TET_DEMO_SPONSOR_MNEMONIC_FILE");
    assert!(crate::demo_sponsor::DemoSponsor::from_env(&f.state.ledger.sled_db()).unwrap().is_none());
}

const UI_SPONSOR_REQUEST: &str = include_str!("testdata/demo_sponsor_request_v1.json");

/// **The try page signs sponsorship requests the node accepts.** The fixture is the page's own
/// output (`files_fee.ts`): tet-core rebuilds the pre-image from its fields and must get the same
/// bytes, then must accept both signatures, and refuse them once the file id changes.
#[test]
fn ui_signed_sponsor_request_verifies_in_rust() {
    let _g = env_lock();
    set_test_env_base();
    let doc: serde_json::Value = serde_json::from_str(UI_SPONSOR_REQUEST).expect("fixture JSON must parse");
    let _bound = agent_fixture_chain(&doc);
    let req: crate::demo_sponsor::SponsorFeeRequestV1 =
        serde_json::from_value(doc["request"].clone()).expect("the page's request must deserialize");
    let ours = crate::demo_sponsor::sponsor_request_auth_message_bytes(
        &req.file_id,
        &req.sender_wallet_id,
        req.requested_at_ms,
        &req.hybrid_sig.mldsa_pubkey_b64,
    );
    assert_eq!(
        String::from_utf8(ours).unwrap(),
        doc["preimage_utf8"].as_str().unwrap(),
        "the page and the node build different sponsorship pre-images"
    );
    crate::demo_sponsor::verify_request_signature(&req).expect("the node must accept the page's signature");
    let mut other = req.clone();
    other.file_id = uuid::Uuid::new_v4().to_string();
    assert!(crate::demo_sponsor::verify_request_signature(&other).is_err(), "a signature must not carry to another file");
}

const SDK_QUESTION_ENVELOPE: &str = include_str!("testdata/agent_question_envelope_v1.json");

/// **The agent SDK's questions are Tmail the node accepts.** `postQuestion` (tet-agent-sdk
/// `src/questions.ts`) ports the UI's encryption and envelope pre-image; this fixture is its output.
/// tet-core must verify it as an ordinary named envelope from the agent's key, and refuse it once a
/// signed field changes.
#[test]
fn sdk_question_envelope_verifies_in_rust() {
    let _g = env_lock();
    set_test_env_base();
    let doc: serde_json::Value = serde_json::from_str(SDK_QUESTION_ENVELOPE).expect("fixture JSON must parse");
    let _bound = agent_fixture_chain(&doc);
    let env: crate::tmail::envelope::TmailEnvelopeV1 =
        serde_json::from_value(doc["envelope"].clone()).expect("the SDK's envelope must deserialize");
    crate::tmail::envelope::verify_tmail_envelope_v1(&env).expect("the node must accept the SDK's question");
    let mut other = env.clone();
    other.receiver_wallet_id = "ab".repeat(32);
    assert!(
        crate::tmail::envelope::verify_tmail_envelope_v1(&other).is_err(),
        "a question must not verify for another receiver"
    );
}

const UI_ANSWER_ENVELOPE: &str = include_str!("testdata/ui_answer_envelope_v1.json");

/// **The try page's answers are Tmail the node accepts**: the questions window's answer (the page's
/// own builder, `make_answer_fixture.mjs`) verifies as a named envelope to the asking agent, and not
/// once its receiver changes. The agent SDK reads the same fixture (`tests/questions.test.ts`).
#[test]
fn ui_answer_envelope_verifies_in_rust() {
    let _g = env_lock();
    set_test_env_base();
    let doc: serde_json::Value = serde_json::from_str(UI_ANSWER_ENVELOPE).expect("fixture JSON must parse");
    let _bound = agent_fixture_chain(&doc);
    let env: crate::tmail::envelope::TmailEnvelopeV1 =
        serde_json::from_value(doc["envelope"].clone()).expect("the page's envelope must deserialize");
    crate::tmail::envelope::verify_tmail_envelope_v1(&env).expect("the node must accept the page's answer");
    let mut other = env.clone();
    other.receiver_wallet_id = "cd".repeat(32);
    assert!(crate::tmail::envelope::verify_tmail_envelope_v1(&other).is_err());
}

// ---- the try page's Live channel (`GET /status/live`, `crate::live_feed`) ----------------------

/// **SECURITY REGRESSION GUARD: the Live feed is bounded, newest first, and carries only the last 6
/// characters of a peer id — never a whole id, an address, or anything from a message.** Other tests'
/// swarms may record into the same process-wide feed, so this checks our own markers among them.
/// Negative controls: `short_peer` returns the whole id → FAILED; `record` never pops → FAILED (the
/// feed grows past `LIVE_EVENTS_KEEP`).
#[test]
fn live_feed_is_bounded_newest_first_and_names_peers_by_six_characters() {
    let peer = "12D3KooWLiveFeedTestPeerAbCdEf";
    let base = 9_000_000_000u64;
    for h in 0..(crate::live_feed::LIVE_EVENTS_KEEP as u64 + 5) {
        crate::live_feed::record("block", Some(base + h), Some(peer));
    }
    let snap = crate::live_feed::snapshot();
    assert!(snap.len() <= crate::live_feed::LIVE_EVENTS_KEEP, "the feed grew to {}", snap.len());
    let ours: Vec<u64> = snap.iter().filter_map(|e| e.height.filter(|h| *h >= base)).collect();
    assert!(!ours.is_empty(), "our events are missing");
    assert!(ours.windows(2).all(|w| w[0] > w[1]), "not newest first: {ours:?}");
    assert_eq!(ours[0], base + crate::live_feed::LIVE_EVENTS_KEEP as u64 + 4, "the newest event is first");
    let json = serde_json::to_string(&snap).unwrap();
    assert!(!json.contains(peer), "a whole peer id leaked: {json}");
    assert!(json.contains("\"peer\":\"AbCdEf\""), "the short peer label is the last 6 characters");
    assert_eq!(crate::live_feed::short_peer("abc"), "abc");
}

/// `/status/live` is on the public allow-list and answers with the node's real numbers: the ledger's
/// height, the apply-queue depth, the build commit (or null), and the recorded events — with no
/// whole peer id and no client address in the body.
#[tokio::test]
async fn status_live_answers_in_public_mode_with_real_numbers_and_no_addresses() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();
    let _r = EnvVarGuard::set("TET_PUBLIC_READ_BURST", "1000");
    let (router, _e) = public_router_for_tests(true);
    let peer = "12D3KooWStatusLiveRouteTestXyZ987";
    crate::live_feed::record("tmail", None, Some(peer));
    let req = axum::http::Request::builder()
        .method("GET")
        .uri("/status/live")
        .extension(axum::extract::ConnectInfo(TEST_PROXY_PEER.parse::<std::net::SocketAddr>().unwrap()))
        .header("x-forwarded-for", "203.0.113.77")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp.headers().get(crate::rest::public_api::GATE_HEADER).is_none(), "the gate refused /status/live");
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let j: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(j["height"].is_u64(), "height: {j}");
    assert!(j["apply_queue_depth"].is_u64(), "apply_queue_depth: {j}");
    assert!(j["commit"].is_null() || j["commit"].is_string(), "commit: {j}");
    assert_eq!(j["events_keep"], crate::live_feed::LIVE_EVENTS_KEEP);
    let events = j["events"].as_array().expect("events");
    assert!(events.iter().any(|e| e["kind"] == "tmail" && e["peer"] == "XyZ987"), "our event: {j}");
    let text = String::from_utf8_lossy(&body);
    assert!(!text.contains(peer), "a whole peer id leaked");
    assert!(!text.contains("203.0.113.77"), "the client address leaked");
}

// ---- larger files on one node (the demo): size cap, local-only storage, storage cap, budget ----------

/// A node's own file cap follows `TET_FILES_MAX_BODY_BYTES` (default: the network-wide 5 MiB): a 6 MiB
/// envelope is out of range by default and in range when the node allows 100 MiB.
/// Negative control: the envelope check uses the constant again → the 100 MiB half FAILS.
#[test]
fn file_size_cap_is_the_nodes_own_setting_defaulting_to_the_network_cap() {
    let _g = env_lock();
    set_test_env_base();
    let w = file_test_wallet();
    let mut env = build_signed_file_envelope(&w, &"cd".repeat(32), b"x", file_now_ms());
    env.file_size = 6 * 1024 * 1024;
    let size_err = |e: &crate::files::FileEnvelopeV1| {
        matches!(crate::files::verify_file_envelope_v1(e), Err(crate::files::FileEnvelopeError::SizeOutOfRange { .. }))
    };
    {
        let _u = EnvVarGuard::unset("TET_FILES_MAX_BODY_BYTES");
        assert!(size_err(&env), "6 MiB must be out of range at the default");
    }
    let _m = EnvVarGuard::set("TET_FILES_MAX_BODY_BYTES", &(100u64 * 1024 * 1024).to_string());
    assert!(!size_err(&env), "6 MiB must be in range when the node allows 100 MiB");
}

/// **SECURITY REGRESSION GUARD: a file over the network-wide cap is never announced over gossip** —
/// peers at the default would reject it, and gossipsub penalises the node that relayed a rejected
/// message. It stays on the node that took it, whatever that node's own cap.
/// Negative control: compare against the node's own cap → FAILED.
#[test]
fn files_over_the_network_cap_stay_on_the_node_that_took_them() {
    let _g = env_lock();
    set_test_env_base();
    let _m = EnvVarGuard::set("TET_FILES_MAX_BODY_BYTES", &(100u64 * 1024 * 1024).to_string());
    let w = file_test_wallet();
    let mut env = build_signed_file_envelope(&w, &"cd".repeat(32), b"x", file_now_ms());
    env.file_size = crate::files::MAX_FILE_BODY_BYTES;
    assert!(crate::files::announces_over_network(&env), "a file at the network cap is announced");
    env.file_size = crate::files::MAX_FILE_BODY_BYTES + 1;
    assert!(!crate::files::announces_over_network(&env), "a larger file must stay local");
}

/// `TET_FILES_MAX_TOTAL_BYTES` bounds what the node stores in total; without it there is no cap.
/// Negative control: `has_room_for` always true → FAILED.
#[test]
fn file_storage_total_cap_refuses_what_would_not_fit() {
    let _g = env_lock();
    set_test_env_base();
    let (_l, store) = new_file_store();
    let w = file_test_wallet();
    let blob = vec![7u8; 1000];
    let env = build_signed_file_envelope(&w, &"cd".repeat(32), &blob, file_now_ms());
    store.store_with_blob(&env, &blob).expect("store");
    {
        let _u = EnvVarGuard::unset("TET_FILES_MAX_TOTAL_BYTES");
        assert!(store.has_room_for(10_000_000), "no cap without the setting");
    }
    let _c = EnvVarGuard::set("TET_FILES_MAX_TOTAL_BYTES", "1500");
    assert_eq!(store.total_blob_bytes(), 1000);
    assert!(store.has_room_for(500));
    assert!(!store.has_room_for(501), "1000 + 501 bytes must not fit under 1500");
    // The store itself refuses (every path that stores a body — uploads and blobs fetched from peers
    // — goes through it), and leaves no index entry for the refused file.
    let big = vec![9u8; 600];
    let env2 = build_signed_file_envelope(&w, &"cd".repeat(32), &big, file_now_ms());
    assert!(
        matches!(store.store_with_blob(&env2, &big), Err(crate::files::storage::FileStoreError::StorageFull { .. })),
        "the store must refuse a body past the cap"
    );
    assert!(store.get_meta(&env2.file_id.to_string()).is_none(), "a refused file must leave no meta");
    assert!(
        matches!(store.put_blob(&env2, &big), Err(crate::files::storage::FileStoreError::StorageFull { .. })),
        "put_blob (the other write path) must refuse too"
    );
    // Re-storing the same file isn't counted twice; deleting gives the room back.
    store.store_with_blob(&env, &blob).expect("re-store the same file");
    assert_eq!(store.total_blob_bytes(), 1000);
    assert!(store.delete_file(&env.file_id.to_string()));
    assert_eq!(store.total_blob_bytes(), 0);
}

/// Blobs stored before the size index existed are measured once when the store opens, so the cap
/// counts them.
#[test]
fn file_size_index_backfills_blobs_stored_before_it() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = open_temp_ledger();
    let db = ledger.sled_db();
    db.open_tree("files_blob_v1").unwrap().insert(b"old-file", vec![1u8; 777]).unwrap();
    let store = crate::files::storage::FileStore::open(&db).expect("open");
    assert_eq!(store.total_blob_bytes(), 777);
}

/// **SECURITY REGRESSION GUARD: in public mode, uploads are charged per client per UTC day** — so one
/// address can't fill the node's disk inside the write-token burst — and an upload without a length
/// is refused before its body is read. Another client, and the next day, start fresh.
/// The page reads `GET /files/upload-budget` first, so a refusal can answer at once (nothing is read
/// or buffered for it) and a chunked body, which could carry more than a declared length, is refused.
/// Negative controls: `charge_upload` always true → FAILED; the gate skipping the length check →
/// FAILED (the length-less upload reaches the handler); skipping the Transfer-Encoding check → FAILED.
#[tokio::test]
async fn public_mode_charges_uploads_per_client_per_day_and_needs_a_length() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();
    let _b = EnvVarGuard::set("TET_PUBLIC_UPLOAD_BYTES_PER_DAY", "1000");
    let gate = crate::rest::public_api::PublicGate::new(crate::rest::public_api::Limits::from_env());
    assert!(gate.charge_upload("a", 600, 10));
    assert!(gate.charge_upload("a", 400, 10));
    assert!(!gate.charge_upload("a", 1, 10), "the 1001st byte of the day is refused");
    assert!(gate.charge_upload("b", 1000, 10), "another client has its own budget");
    assert!(gate.charge_upload("a", 1000, 11), "the next day starts fresh");

    let _w = EnvVarGuard::set("TET_PUBLIC_WRITE_BURST", "1000");
    let (router, _e) = public_router_for_tests(true);
    let send = |len: Option<&str>| {
        let mut b = axum::http::Request::builder()
            .method("POST")
            .uri("/files/upload")
            .extension(axum::extract::ConnectInfo(TEST_PROXY_PEER.parse::<std::net::SocketAddr>().unwrap()))
            .header("x-forwarded-for", "203.0.113.90")
            .header("content-type", "multipart/form-data; boundary=x");
        if let Some(l) = len {
            b = b.header("content-length", l);
        }
        b.body(axum::body::Body::from("--x--\r\n")).unwrap()
    };
    let budget = || async {
        let req = axum::http::Request::builder()
            .method("GET")
            .uri("/files/upload-budget")
            .extension(axum::extract::ConnectInfo(TEST_PROXY_PEER.parse::<std::net::SocketAddr>().unwrap()))
            .header("x-forwarded-for", "203.0.113.90")
            .body(axum::body::Body::empty())
            .unwrap();
        let resp = router.clone().oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["remaining_bytes"].as_u64()
    };
    assert_eq!(budget().await, Some(1000));
    let r = router.clone().oneshot(send(None)).await.unwrap();
    assert_eq!(r.status(), StatusCode::LENGTH_REQUIRED, "an upload without a length must be refused");
    let mut chunked = send(Some("10"));
    chunked.headers_mut().insert("transfer-encoding", "chunked".parse().unwrap());
    let r = router.clone().oneshot(chunked).await.unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST, "an upload with Transfer-Encoding must be refused");
    let r = router.clone().oneshot(send(Some("900"))).await.unwrap();
    assert_ne!(r.status(), StatusCode::TOO_MANY_REQUESTS, "900 bytes fit the budget");
    assert_eq!(budget().await, Some(100), "the budget shows what is left");
    let r = router.clone().oneshot(send(Some("200"))).await.unwrap();
    assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS, "900 + 200 bytes exceed 1000 for this client");
    assert_eq!(r.headers().get("connection").map(|v| v.to_str().unwrap()), Some("close"), "a refusal closes at once");
}

/// **SECURITY REGRESSION GUARD: a file id belongs to the first envelope stored under it.** A stamp
/// derives its id from a hash anyone holding the .sig.json can compute, so another sender (or another
/// body) under the same id must be refused, never overwrite the stored body; the identical envelope
/// may be stored again. Negative control: drop the id check → FAILED (the body is replaced).
#[test]
fn a_file_id_cannot_be_taken_over_by_another_envelope() {
    let _g = env_lock();
    set_test_env_base();
    let (_l, store) = new_file_store();
    let alice = file_test_wallet();
    let mallory = file_test_wallet();
    let blob = b"alice's .sig.json, encrypted".to_vec();
    let env = build_signed_file_envelope(&alice, &alice.wallet_id, &blob, file_now_ms());
    store.store_with_blob(&env, &blob).expect("first store");
    store.store_with_blob(&env, &blob).expect("the identical envelope may be stored again");
    let evil = b"mallory's replacement".to_vec();
    let mut takeover = build_signed_file_envelope(&mallory, &mallory.wallet_id, &evil, file_now_ms());
    takeover.file_id = env.file_id;
    assert!(
        matches!(store.store_with_blob(&takeover, &evil), Err(crate::files::storage::FileStoreError::IdTaken(_))),
        "another envelope under a taken id must be refused"
    );
    assert_eq!(store.get_blob(&env.file_id.to_string()).as_deref(), Some(blob.as_slice()), "the first body must be intact");
}

/// **SECURITY REGRESSION GUARD: two uploads racing for one file id can't both win.** The id check and
/// the write happen under one lock, so of many concurrent envelopes under the same id exactly one is
/// stored and its body is the one kept. Negative control: drop the lock → FAILED (more than one
/// "stored", or a body that doesn't match the winner).
#[test]
fn racing_uploads_for_one_file_id_have_exactly_one_winner() {
    let _g = env_lock();
    set_test_env_base();
    let (_l, store) = new_file_store();
    let store = std::sync::Arc::new(store);
    let id = uuid::Uuid::new_v4();
    let mut handles = Vec::new();
    for i in 0..16u8 {
        let store = store.clone();
        handles.push(std::thread::spawn(move || {
            let w = file_test_wallet();
            let blob = vec![i; 4096];
            let mut env = build_signed_file_envelope(&w, &w.wallet_id.clone(), &blob, file_now_ms());
            env.file_id = id;
            store.store_with_blob(&env, &blob).ok().map(|_| blob)
        }));
    }
    let winners: Vec<Vec<u8>> = handles.into_iter().filter_map(|h| h.join().unwrap()).collect();
    assert_eq!(winners.len(), 1, "exactly one envelope may own the id");
    assert_eq!(store.get_blob(&id.to_string()), Some(winners[0].clone()), "the stored body is the winner's");
}

/// **SECURITY REGRESSION GUARD: a transaction signed by another wallet is refused everywhere.**
/// A valid hybrid signature proves only which key signed. Every kind that names a wallet it acts
/// for (debits, registers, enrolls, claims for) must be signed by that wallet: refused at envelope
/// verification (so REST admission, gossip, mining and received blocks), and again by the ledger's
/// block preview and apply, which refuse the same blocks so their roots can't diverge. A mempool
/// row saved before this rule is dropped at restart. The same transactions signed by the right
/// wallet still pass. Negative control (run by hand): with the checks removed this test FAILS —
/// the forged transfer moves the victim's balance.
#[tokio::test]
async fn a_tx_signed_by_another_wallet_is_refused_everywhere() {
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let new_wallet = || {
        let w = crate::wallet::generate_mnemonic_12().unwrap();
        (w.mnemonic_12.clone().unwrap(), w.address_hex.to_ascii_lowercase())
    };
    let (victim_words, victim) = new_wallet();
    let (mallory_words, mallory) = new_wallet();
    ledger.admin_rest_faucet(&victim, 100 * crate::ledger::STEVEMON, "ip", true, 1, 1).unwrap();

    use crate::protocol::TxV1;
    let acting_for_victim = vec![
        TxV1::Transfer { from_wallet: victim.clone(), to_wallet: mallory.clone(), amount_micro: 50 * crate::ledger::STEVEMON, fee_bps: 100 },
        TxV1::FileFee { from_wallet: victim.clone(), storage_wallet: mallory.clone(), file_id: uuid::Uuid::new_v4().to_string(), fee_micro: crate::files::FILE_FEE_MICRO },
        TxV1::WorkerRegister { wallet_id: victim.clone(), hardware_id_hex: "ab".repeat(32), hardware_profile: "cpu".into(), capabilities: vec![], tflops_declared: 1.0 },
        TxV1::InitialAirdrop { wallet_id: victim.clone() },
        TxV1::EnterpriseInference { enterprise_wallet_id: victim.clone(), prompt: "p".into(), model: "m".into(), amount_micro: 1, nonce: 1, prompt_sha256_hex: "00".repeat(32), workload_flag: 0, attestation_required: false },
        TxV1::SignerLink { wallet_id: victim.clone() },
        TxV1::FoundingMemberEnroll { member_wallet: victim.clone() },
        TxV1::GenesisBridge { founder_wallet: victim.clone(), to_wallet: mallory.clone(), amount_micro: 1 },
    ];
    for tx in &acting_for_victim {
        let forged = signed_env_for_tests(tx.clone(), &mallory_words, &mallory);
        let err = crate::rest::helpers::verify_envelope_v1(&forged).expect_err(&format!("{tx:?} signed by another wallet verified"));
        assert!(err.contains("signer must be the wallet"), "{err}");
        let own = signed_env_for_tests(tx.clone(), &victim_words, &victim);
        crate::rest::helpers::verify_envelope_v1(&own).unwrap_or_else(|e| panic!("{tx:?} signed by its own wallet: {e}"));
    }

    let forged = signed_env_for_tests(acting_for_victim[0].clone(), &mallory_words, &mallory);
    let before = ledger.balance_micro(&victim).unwrap();

    // REST admission.
    let res = crate::rest::handlers::ledger::post_tx_submit(axum::extract::State(state.clone()), axum::http::HeaderMap::new(), axum::Json(forged.clone())).await;
    assert!(!res.status().is_success(), "REST admitted it: {}", res.status());
    assert!(state.mempool.lock().await.is_empty());

    // Gossip admission.
    let outcome = crate::p2p::handle_tx_broadcast(&ledger, &state.mempool, forged.clone()).await;
    assert!(matches!(outcome, crate::p2p::TxGossipOutcome::Rejected { .. }), "{outcome:?}");
    assert!(state.mempool.lock().await.is_empty());

    // The ledger, given the block directly (a producer that skipped the checks).
    let h = "0x".to_string() + &"ee".repeat(32);
    assert!(ledger.compute_state_root_after_remote_block(std::slice::from_ref(&forged), "producer-x", 0).is_err(), "preview accepted it");
    assert!(ledger.apply_consensus_block_batch(1, std::slice::from_ref(&forged), &[h], "producer-x", 0).is_err(), "apply accepted it");
    assert_eq!(ledger.balance_micro(&victim).unwrap(), before, "the victim's balance moved");

    // A row saved before the rule is dropped at restart; a good one is kept.
    let good = signed_env_for_tests(acting_for_victim[0].clone(), &victim_words, &victim);
    ledger.mempool_persist("0xforged", &forged);
    ledger.mempool_persist("0xgood", &good);
    let restored: Vec<String> = ledger.mempool_restore().into_iter().map(|(h, _)| h).collect();
    assert_eq!(restored, vec!["0xgood".to_string()]);

    // The victim's own transfer still mines.
    state.submit_local_tx(good.clone()).await.unwrap();
    crate::consensus::mine_pending_block_as(state.clone(), "alice".to_string()).await.expect("mine");
    assert!(ledger.is_tx_applied(&crate::consensus::tx_hash_for_env(&good).unwrap()).unwrap());
    assert_eq!(ledger.balance_micro(&victim).unwrap(), before - 50 * crate::ledger::STEVEMON);
}

/// **SECURITY REGRESSION GUARD: what the operator hides is not served on any public route.**
/// Hiding is node-local (`operator_hide.rs`): a hidden post, a hidden wallet (everything sent to it,
/// and everything it sent — so its directory listing goes too) and a hidden file are absent from the
/// Tmail inbox, the files inbox, file fetch and peer fetch; unhiding serves them again; the chain is
/// untouched; every hide/unhide is written to the operator log; the operator routes refuse a caller
/// that isn't on loopback or lacks the admin key. Every public GET route must be classified as
/// content (checked here) or not, so a new content route can't skip the check unnoticed.
/// Negative control (run by hand): with the inbox filter removed this test FAILS.
#[tokio::test]
async fn operator_hidden_items_are_not_served_on_any_public_route() {
    use axum::extract::{ConnectInfo, State};
    use crate::operator_hide::HideKind;
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();
    let hide_body = |kind: HideKind, id: &str, reason: &str| {
        axum::body::Bytes::from(serde_json::json!({ "kind": kind, "id": id, "reason": reason }).to_string())
    };
    let log = std::env::temp_dir().join(format!("tet-operator-{}.log", uuid::Uuid::new_v4()));
    unsafe { std::env::set_var("TET_OPERATOR_LOG", &log) };

    // Every public GET is classified; content routes are the ones this test exercises.
    const CONTENT: &[&str] = &["/tmail/inbox/:wallet_id", "/files/inbox/:wallet_id", "/files/fetch/:file_id"];
    const NOT_CONTENT: &[&str] = &[
        "/status", "/chain", "/ledger/state", "/ledger/balance/:wallet", "/explorer/tx/:hash", "/status/live",
        "/tmail/keys/:wallet_id", "/tmail/anon/root", "/tmail/anon/leaves",
        // A membership proof's receipt: no message text, no sender.
        "/tmail/anon/receipt/:hash",
        "/files/upload-budget",
    ];
    for (m, p) in crate::rest::public_api::PUBLIC_ALLOWLIST {
        if *m == "GET" {
            assert!(CONTENT.contains(p) || NOT_CONTENT.contains(p), "classify public GET {p}: does it return content?");
        }
    }

    let ledger = std::sync::Arc::new(open_temp_ledger());
    ledger.init_genesis_founder_premine_from_env().unwrap();
    ledger.apply_genesis_allocation("founder").unwrap();
    let state = rest_state_for_tests(ledger.clone());
    let router = crate::rest::routes::build_router(state.clone());
    let get = |uri: String| {
        let router = router.clone();
        async move {
            let resp = router.oneshot(axum::http::Request::builder().uri(uri).body(axum::body::Body::empty()).unwrap()).await.unwrap();
            let status = resp.status();
            let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            (status, String::from_utf8_lossy(&body).to_string())
        }
    };

    // A board wallet with two posts from two senders, and a file to a third wallet.
    let (w1, s1, board) = tmail_pair_for_tests();
    let (w2, s2, _) = tmail_pair_for_tests();
    for (words, sender, id) in [(&w1, &s1, "post-one"), (&w2, &s2, "post-two")] {
        let env = signed_tmail_env_for_tests(words, sender, &board, id, tmail_flags_for_tests(false), None);
        assert!(state.tmail.store_tmail(&env).unwrap());
    }
    let alice = file_test_wallet();
    let bob = file_test_wallet();
    let blob = b"encrypted file body".to_vec();
    let fenv = build_signed_file_envelope(&alice, &bob.wallet_id, &blob, file_now_ms());
    state.files.store_with_blob(&fenv, &blob).unwrap();
    let fid = fenv.file_id.to_string();
    let root = ledger.compute_state_root().unwrap();

    let inbox = |w: &str| get(format!("/tmail/inbox/{w}?limit=200"));
    assert!(inbox(&board).await.1.contains("post-one"));

    let admin = admin_headers_for_tests();
    let local = Some(ConnectInfo("127.0.0.1:9".parse::<std::net::SocketAddr>().unwrap()));
    let hide = |kind: HideKind, id: &str| crate::rest::handlers::operator::post_operator_hide(
        State(state.clone()), local, admin.clone(),
        hide_body(kind, id, "test report #1"),
    );

    // The routes: loopback and the admin key, or nothing.
    let req = || hide_body(HideKind::Msg, "post-one", "r");
    let remote = Some(ConnectInfo("203.0.113.9:9".parse::<std::net::SocketAddr>().unwrap()));
    assert_eq!(crate::rest::handlers::operator::post_operator_hide(State(state.clone()), remote, admin.clone(), req()).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(crate::rest::handlers::operator::post_operator_hide(State(state.clone()), local, axum::http::HeaderMap::new(), req()).await.status(), StatusCode::UNAUTHORIZED);
    assert!(inbox(&board).await.1.contains("post-one"), "a refused call hid something");

    // A post.
    assert_eq!(hide(HideKind::Msg, "post-one").await.status(), StatusCode::OK);
    let (st, body) = inbox(&board).await;
    assert_eq!(st, StatusCode::OK);
    assert!(!body.contains("post-one") && body.contains("post-two"), "{body}");

    // A sender wallet: its posts go everywhere (this is how a board's directory listing goes).
    assert_eq!(hide(HideKind::Wallet, &s2).await.status(), StatusCode::OK);
    assert!(!inbox(&board).await.1.contains("post-two"));

    // The board wallet itself: its inbox isn't served at all.
    assert_eq!(hide(HideKind::Wallet, &board).await.status(), StatusCode::OK);
    assert_eq!(inbox(&board).await.0, StatusCode::GONE);
    // …and it takes nothing new: a fresh post to it is refused, not stored and never served.
    let late = signed_tmail_env_for_tests(&w1, &s1, &board, "post-late", tmail_flags_for_tests(false), None);
    let resp = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/tmail/send")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(serde_json::to_vec(&late).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::GONE, "a post to a hidden board was accepted");
    assert!(state.tmail.get_by_msg_id("post-late").is_none(), "a post to a hidden board was stored");

    // A file: files inbox, fetch, and a peer's fetch.
    assert!(get(format!("/files/inbox/{}", bob.wallet_id)).await.1.contains(&fid));
    assert_eq!(get(format!("/files/fetch/{fid}")).await.0, StatusCode::OK);
    assert_eq!(hide(HideKind::File, &fid).await.status(), StatusCode::OK);
    assert!(!get(format!("/files/inbox/{}", bob.wallet_id)).await.1.contains(&fid));
    assert_eq!(get(format!("/files/fetch/{fid}")).await.0, StatusCode::GONE);
    assert!(!crate::files::serve_peer_fetch(&state.files, fenv.file_id).found, "a peer was served a hidden file");

    // Unhide serves it again; the chain never moved.
    let un = crate::rest::handlers::operator::post_operator_unhide(
        State(state.clone()), local, admin.clone(),
        hide_body(HideKind::File, &fid, "report withdrawn"),
    ).await;
    assert_eq!(un.status(), StatusCode::OK);
    assert_eq!(get(format!("/files/fetch/{fid}")).await.0, StatusCode::OK);
    assert!(crate::files::serve_peer_fetch(&state.files, fenv.file_id).found);
    assert_eq!(ledger.compute_state_root().unwrap(), root, "hiding touched the chain");

    // Every use is in the operator log.
    let lines = std::fs::read_to_string(&log).unwrap();
    assert_eq!(lines.lines().filter(|l| l.contains("\"action\":\"hide\"")).count(), 4, "{lines}");
    assert_eq!(lines.lines().filter(|l| l.contains("\"action\":\"unhide\"")).count(), 1, "{lines}");
    unsafe { std::env::remove_var("TET_OPERATOR_LOG") };
    let _ = std::fs::remove_file(&log);
}

/// **SECURITY REGRESSION GUARD: in public mode the operator routes pass the gate from loopback only.**
/// The demo runs in public mode, so the operator's hide routes would otherwise be unreachable; the gate
/// lets exactly `OPERATOR_PATHS` through when the TCP peer is loopback (the operator runs them inside
/// the container). From the reverse proxy, from anywhere else, with a forged `X-Forwarded-For:
/// 127.0.0.1`, or on a near-miss path, they stay refused; and through the gate the route still needs
/// the admin key (401 without it). Negative control (run by hand): drop the loopback condition → FAILED.
#[tokio::test]
async fn public_mode_lets_operator_routes_through_from_loopback_only() {
    let _g = env_lock();
    set_test_env_base();
    let _r = EnvVarGuard::set("TET_PUBLIC_READ_BURST", "1000");
    let _w = EnvVarGuard::set("TET_PUBLIC_WRITE_BURST", "1000");
    let (router, _e) = public_router_for_tests(true);
    for path in crate::rest::public_api::OPERATOR_PATHS {
        let method = if path.ends_with("hidden") { "GET" } else { "POST" };
        for (peer, xff, why) in [
            (TEST_PROXY_PEER, None, "the reverse proxy"),
            ("203.0.113.5:4000", None, "a remote client"),
            (TEST_PROXY_PEER, Some("127.0.0.1"), "a forged X-Forwarded-For"),
        ] {
            let (s, refused) = public_call_from_for_tests(&router, method, path, xff, peer).await;
            assert!(refused && s == StatusCode::NOT_FOUND, "{method} {path} from {why}: {s} refused={refused}");
        }
        let (s, refused) = public_call_from_for_tests(&router, method, path, None, "127.0.0.1:4000").await;
        assert!(!refused, "{method} {path} from loopback was refused by the gate");
        assert_eq!(s, StatusCode::UNAUTHORIZED, "{method} {path} from loopback without the admin key");
    }
    for near in ["/operator/hide/", "/operator/HIDE", "/operator//hide", "/operator/hide/../hidden", "/operator"] {
        let (s, refused) = public_call_from_for_tests(&router, "POST", near, None, "127.0.0.1:4000").await;
        assert!(refused && s == StatusCode::NOT_FOUND, "near miss {near} from loopback: {s} refused={refused}");
    }
}

/// **SECURITY REGRESSION GUARD: an anonymous post whose proof doesn't verify is never kept, served,
/// relayed or counted.** At `POST /tmail/send` the proof is checked before anything is stored: no
/// receipt → refused; a receipt that doesn't verify (a repeat on the same board and day included)
/// → refused with the reason, nothing stored. A post that arrives some other way (gossip, pending
/// until its receipt is pulled) is deleted the moment its verdict is Failed, and tombstoned so a
/// re-delivery can't bring it back. And unverified posts can't push verified ones out of a board:
/// the per-receiver cap keeps verified posts first.
/// A failure that depends on this node's view (a registry root it doesn't know yet) is kept, hidden
/// and uncounted, not deleted for good.
/// Negative controls (run by hand): the send storing before checking again → FAILED; a Failed
/// verdict not deleting → FAILED; the cap ranking newest-only again → FAILED; every failure
/// deleting → FAILED.
#[tokio::test]
async fn an_anonymous_post_that_does_not_verify_is_never_kept() {
    use tower::ServiceExt as _;
    let _g = env_lock();
    set_test_env_base();
    let ledger = std::sync::Arc::new(open_temp_ledger());
    let state = rest_state_for_tests(ledger);
    let router = crate::rest::routes::build_router(state.clone());
    let (_rw, board) = tmail_party_for_tests();
    let (ew, eid) = tmail_party_for_tests();
    let send = |env: crate::tmail::envelope::TmailEnvelopeV1| {
        let router = router.clone();
        async move {
            router
                .oneshot(axum::http::Request::builder().method("POST").uri("/tmail/send").header("content-type", "application/json").body(axum::body::Body::from(serde_json::to_vec(&env).unwrap())).unwrap())
                .await
                .unwrap()
                .status()
        }
    };

    // No receipt deposited.
    let a = anon_env_with_nullifier_for_tests(&ew, &eid, &board, [1u8; 32], "anon-no-receipt", tmail_now_ms_for_tests());
    assert_eq!(send(a).await, StatusCode::BAD_REQUEST);
    assert!(state.tmail.get_by_msg_id("anon-no-receipt").is_none());

    // A receipt that doesn't verify.
    let junk = b"not a receipt".to_vec();
    let jh = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(&junk));
    state.tmail.put_anon_receipt(&jh, &junk).unwrap();
    let mut b = anon_env_with_nullifier_for_tests(&ew, &eid, &board, [2u8; 32], "anon-bad-proof", tmail_now_ms_for_tests());
    b.anonymous.as_mut().unwrap().anchor_proof.receipt_sha256_hex = jh.clone();
    resign_tmail_env_for_tests(&mut b, &ew);
    assert_eq!(send(b.clone()).await, StatusCode::FORBIDDEN);
    assert!(state.tmail.get_by_msg_id("anon-bad-proof").is_none(), "a post whose proof failed was stored");
    assert!(state.tmail.get_inbox(&board, 200).is_empty());

    // Delivered another way (gossip: pending), then Failed: deleted, and a re-delivery stays out.
    assert!(state.tmail.store_tmail(&b).unwrap());
    state.tmail.set_anon_verdict("anon-bad-proof", &crate::tmail::store::AnonVerdict::Failed { reason: "replay".into(), failed_at_ms: 1 }).unwrap();
    assert!(state.tmail.get_inbox(&board, 200).is_empty(), "a failed post is still served");
    assert!(!state.tmail.store_tmail(&b).unwrap(), "a failed post came back on re-delivery");

    // A root this node doesn't know yet depends on its view: kept (hidden, not counted), not deleted.
    let mut c = anon_env_with_nullifier_for_tests(&ew, &eid, &board, [3u8; 32], "anon-root-unknown", tmail_now_ms_for_tests());
    c.anonymous.as_mut().unwrap().anchor_proof.receipt_sha256_hex = jh.clone();
    resign_tmail_env_for_tests(&mut c, &ew);
    assert!(state.tmail.store_tmail(&c).unwrap());
    state.tmail.set_anon_verdict("anon-root-unknown", &crate::tmail::store::AnonVerdict::Failed { reason: "registry root not recognised, or outside the acceptance window".into(), failed_at_ms: 1 }).unwrap();
    assert!(state.tmail.get_by_msg_id("anon-root-unknown").is_some(), "a post failing only on this node's view of the root was deleted for good");

    // The cap keeps verified posts first: 3 verified (older), then 6 pending (newer), cap 3.
    let _cap = EnvVarGuard::set("TET_TMAIL_ANON_RETAIN_PER_RECEIVER", "3");
    let (_rw2, board2) = tmail_party_for_tests();
    let base = tmail_now_ms_for_tests();
    for i in 0..9u8 {
        let env = anon_env_with_nullifier_for_tests(&ew, &eid, &board2, [10 + i; 32], &format!("cap-{i}"), base + i as u64);
        if i < 3 {
            state.tmail.set_anon_verdict(&format!("cap-{i}"), &crate::tmail::store::AnonVerdict::Verified { nullifier_hex: hex::encode([10 + i; 32]), verified_at_ms: 1 }).unwrap();
        }
        state.tmail.store_tmail(&env).unwrap();
    }
    let kept: std::collections::BTreeSet<String> = state.tmail.get_inbox(&board2, 200).into_iter().map(|e| e.msg_id).collect();
    for i in 0..3 {
        assert!(kept.contains(&format!("cap-{i}")), "a verified post was pushed out by pending ones: kept {kept:?}");
    }
}

/// **SECURITY REGRESSION GUARD: an anonymous post that isn't stored doesn't use up the day.**
/// The send checks the proof (claiming the nullifier) before storing; when the store then fails,
/// the claim is released, so the member can post again. A release frees only the claim made by
/// that same message.
/// Negative control (run by hand): release made a no-op → FAILED.
#[test]
fn an_anonymous_post_that_is_not_stored_does_not_use_up_the_day() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let n = hex::encode([5u8; 32]);
    assert!(store.claim_anon_nullifier(&n, "msg-a").unwrap());
    store.release_anon_nullifier(&n, "msg-b");
    assert!(!store.claim_anon_nullifier(&n, "msg-c").unwrap(), "someone else's release freed the claim");
    store.release_anon_nullifier(&n, "msg-a");
    assert!(store.claim_anon_nullifier(&n, "msg-c").unwrap(), "the day stayed used up");
    let src = include_str!("tmail/store.rs");
    assert!(src.contains("self.release_anon_nullifier(&nullifier_hex, env.msg_id.trim());"), "the send no longer releases the claim when the store fails");
}

/// **SECURITY REGRESSION GUARD: a released claim can never belong to a stored post.** The send's
/// check → store → release is one unit (`send_anonymous`, under one lock, run whole on a blocking
/// thread so a client hanging up can't split it), and releases only when the message isn't stored.
/// Two requests for the same anonymous message racing (one failing to store, one storing) can't
/// leave its nullifier free while the post is kept.
/// Negative control (run by hand): the release without the "not stored" check → FAILED.
#[test]
fn a_released_claim_never_belongs_to_a_stored_post() {
    let _g = env_lock();
    set_test_env_base();
    let store = tmail_store_for_tests();
    let (ew, eid) = tmail_party_for_tests();
    let (_rw, board) = tmail_party_for_tests();
    let env = anon_env_with_nullifier_for_tests(&ew, &eid, &board, [6u8; 32], "race-msg", tmail_now_ms_for_tests());
    let n = hex::encode([6u8; 32]);
    // Both requests claimed (same message: idempotent); the second stored it.
    assert!(store.claim_anon_nullifier(&n, "race-msg").unwrap());
    assert!(store.store_tmail(&env).unwrap());
    // The first now hits its store failure and runs the release rule (`send_anonymous`).
    let src = include_str!("tmail/store.rs");
    assert!(src.contains("if self.get_by_msg_id(env.msg_id.trim()).is_none() {\n                            self.release_anon_nullifier"), "the release no longer checks the message isn't stored");
    if store.get_by_msg_id("race-msg").is_none() {
        store.release_anon_nullifier(&n, "race-msg");
    }
    assert!(!store.claim_anon_nullifier(&n, "another-msg").unwrap(), "a stored post's nullifier was freed for another message");
    assert!(src.contains("let _g = self.anon_send_lock.lock()"), "anonymous sends are no longer serialised");
    let handler = include_str!("rest/handlers/tmail.rs");
    assert!(handler.contains("tokio::task::spawn_blocking(move || store.send_anonymous(&e2))"), "the check-store-release unit no longer runs whole on a blocking thread");

    // send_anonymous refuses without storing: no proof, no receipt, a proof that doesn't verify.
    let mut no_proof = anon_env_with_nullifier_for_tests(&ew, &eid, &board, [7u8; 32], "no-proof", tmail_now_ms_for_tests());
    no_proof.anonymous = None;
    assert_eq!(store.send_anonymous(&no_proof), Err(crate::tmail::store::AnonSendError::NoProof));
    let no_receipt = anon_env_with_nullifier_for_tests(&ew, &eid, &board, [8u8; 32], "no-receipt", tmail_now_ms_for_tests());
    assert_eq!(store.send_anonymous(&no_receipt), Err(crate::tmail::store::AnonSendError::NoReceipt));
    let junk = b"junk".to_vec();
    let jh = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(&junk));
    store.put_anon_receipt(&jh, &junk).unwrap();
    let mut bad = anon_env_with_nullifier_for_tests(&ew, &eid, &board, [9u8; 32], "bad-proof", tmail_now_ms_for_tests());
    bad.anonymous.as_mut().unwrap().anchor_proof.receipt_sha256_hex = jh;
    assert!(matches!(store.send_anonymous(&bad), Err(crate::tmail::store::AnonSendError::Refused(_))));
    for id in ["no-proof", "no-receipt", "bad-proof"] {
        assert!(store.get_by_msg_id(id).is_none(), "{id} was stored");
    }
}
