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
    let (log_tx, _log_rx) = tokio::sync::broadcast::channel::<String>(64);
    let tmail = std::sync::Arc::new(
        crate::tmail::store::TmailStore::open(&ledger.sled_db()).expect("tmail store"),
    );
    let files = std::sync::Arc::new(
        crate::files::storage::FileStore::open(&ledger.sled_db()).expect("file store"),
    );
    crate::rest::RestState {
        ledger,
        solana: std::sync::Arc::new(crate::ledger::solana_client::NexusSolanaClient::devnet()),
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

    // [B] Apply faucet event (simulate gossip delivery).
    let faucet_ev = crate::models::NetworkEvent::FaucetExecuted {
        event_id: audit_hash_hex,
        to_wallet: sender_wallet_id.clone(),
        amount_micro: 1000u64 * crate::ledger::STEVEMON,
    };
    assert!(ledger_b.apply_remote_event(&faucet_ev).unwrap());

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
        let hello_registry = crate::sync::new_hello_registry();
        let catch_up_driver = crate::sync::new_catch_up_driver();
        let block_sync_board =
            crate::sync::new_block_sync_board(hello_registry.clone(), catch_up_driver.clone());

        let tmail_store = std::sync::Arc::new(
            crate::tmail::store::TmailStore::open(&ledger.sled_db()).expect("tmail store"),
        );
        let file_store = std::sync::Arc::new(
            crate::files::storage::FileStore::open(&ledger.sled_db()).expect("file store"),
        );
        let (gossip_tx, files_fetch_tx, tx_submit_tx, swarm_task) = crate::p2p::start_mdns_ping_swarm(
            ledger.clone(),
            mempool.clone(),
            keypair,
            listen,
            hello_registry,
            catch_up_driver,
            block_sync_board.clone(),
            tmail_store,
            file_store,
            crate::swarm_health::SwarmHealth::new(),
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
        (state, block_sync_board, boot_multiaddr, swarm_task)
    }

    async fn spawn_node(bootnode_of: Option<&str>, is_boot: bool) -> TestNode {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("db");
        let db_dir = tmp.path().to_path_buf();
        std::mem::forget(tmp);
        let ledger = Arc::new(crate::ledger::Ledger::open(db.to_str().unwrap()).unwrap());
        ledger.init_genesis_founder_premine_from_env().unwrap();
        let _ = ledger.apply_genesis_allocation("founder");
        let (state, block_sync_board, boot_multiaddr, swarm_task) =
            start_block_swarm_on_ledger(ledger.clone(), &db_dir, bootnode_of, is_boot, 400).await;
        TestNode {
            ledger,
            db_dir,
            state,
            block_sync_board,
            boot_multiaddr,
            swarm_task,
            auto_miner: None,
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
        let (state, board, boot, task) = start_block_swarm_on_ledger(
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
        crate::sync::auto_mine_blocked_by_sync(Some(board), ledger).await
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
        let (state2, board2, _, swarm2) =
            start_block_swarm_on_ledger(ledger2.clone(), &db_dir2, Some(&boot), false, 0).await;
        assert_ne!(Arc::as_ptr(&n1.block_sync_board), Arc::as_ptr(&board2));
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
        };
        let mut n3 = spawn_node(Some(&boot), false).await;
        assert_ne!(
            Arc::as_ptr(&n2.block_sync_board),
            Arc::as_ptr(&n3.block_sync_board),
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
    let env_chain_b = signed_env_for_tests(tx, &words, &wallet_id);
    assert!(crate::rest::helpers::verify_envelope_v1(&env_chain_b).is_ok());
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
fn tmail_e2ee_block_for_tests() -> crate::tmail::envelope::TmailE2eeBlock {
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
        ciphertext_b64: b64("opaque-ciphertext-the-node-never-opens"),
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
        e2ee: tmail_e2ee_block_for_tests(),
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
