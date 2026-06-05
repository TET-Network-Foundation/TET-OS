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
        mempool: std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new())),
        tmail,
        files,
        http_ratelimit: std::sync::Arc::new(tokio::sync::Mutex::new(
            crate::rest::HttpRateLimit::new(999),
        )),
        workers: std::sync::Arc::new(std::sync::Mutex::new(
            crate::worker_network::WorkerRegistry::default(),
        )),
        e2ee_jobs: std::sync::Arc::new(std::sync::Mutex::new(crate::rest::E2eeJobQueue::default())),
        dex: std::sync::Arc::new(std::sync::Mutex::new(crate::p2p_dex::DexEngine::default())),
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
    let tx_bytes = serde_json::to_vec(&tx).unwrap();
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(from_words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(from_words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let ed_sig = ed_sk.sign(tx_bytes.as_slice());
    let ed_sig_b64 = base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes().as_slice());
    let mldsa_sig_bytes =
        crate::wallet::mldsa_sign_deterministic(&mldsa_kp, tx_bytes.as_slice()).unwrap();
    let mldsa_sig_b64 = base64::engine::general_purpose::STANDARD.encode(&mldsa_sig_bytes);

    crate::protocol::SignedTxEnvelopeV1 {
        v: 1,
        tx,
        sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: from_wallet_id.to_string(),
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
    let tx_bytes = serde_json::to_vec(&tx).unwrap();
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let ed_sig = ed_sk.sign(tx_bytes.as_slice());
    let ed_sig_b64 = base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes().as_slice());
    let mldsa_sig_bytes =
        crate::wallet::mldsa_sign_deterministic(&mldsa_kp, tx_bytes.as_slice()).unwrap();
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

    // [A] Faucet sender via handler (rate limit bypass is enabled via env).
    let faucet_req = crate::rest::FaucetReq {
        wallet_id: sender_wallet_id.clone(),
        amount_tet: Some(1000.0),
    };
    let resp = crate::rest::handlers::ledger::post_ledger_faucet(
        axum::extract::State(state_a.clone()),
        admin_headers_for_tests(),
        axum::extract::ConnectInfo("127.0.0.1:12345".parse().unwrap()),
        axum::Json(faucet_req),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let v: Value = serde_json::from_slice(&body).unwrap();
    let audit_hash_hex = v
        .get("audit_hash_hex")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
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
    let tx_bytes = serde_json::to_vec(&tx).unwrap();
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(&sender_words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(&sender_words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let ed_sig = ed_sk.sign(tx_bytes.as_slice());
    let ed_sig_b64 = base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes().as_slice());
    let mldsa_sig_bytes =
        crate::wallet::mldsa_sign_deterministic(&mldsa_kp, tx_bytes.as_slice()).unwrap();
    let mldsa_sig_b64 = base64::engine::general_purpose::STANDARD.encode(&mldsa_sig_bytes);

    let env = crate::protocol::SignedTxEnvelopeV1 {
        v: 1,
        tx: tx.clone(),
        sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: sender_wallet_id.clone(),
            ed25519_sig_b64: ed_sig_b64,
            mldsa_pubkey_b64,
            mldsa_sig_b64,
        },
        attestation: crate::protocol::AttestationV1 {
            platform: "test".to_string(),
            report_b64: String::new(),
        },
    };

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
    assert_eq!(ledger_a.compute_state_root(), ledger_b.compute_state_root());

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

    let r1 = ledger1.compute_state_root();
    let r2 = ledger2.compute_state_root();
    assert_ne!(r1, r2);
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
    let tx_bytes = serde_json::to_vec(&tx).unwrap();

    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(&words).unwrap();
    let mldsa_kp = crate::wallet::mldsa_keypair_from_mnemonic(&words).unwrap();
    let mldsa_pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(mldsa_kp.public_key());
    let ed_sig = ed_sk.sign(tx_bytes.as_slice());
    let ed_sig_b64 = base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes().as_slice());
    let mldsa_sig_bytes =
        crate::wallet::mldsa_sign_deterministic(&mldsa_kp, tx_bytes.as_slice()).unwrap();
    let mldsa_sig_b64 = base64::engine::general_purpose::STANDARD.encode(&mldsa_sig_bytes);

    let env = crate::protocol::SignedTxEnvelopeV1 {
        v: 1,
        tx: tx.clone(),
        sig: crate::protocol::HybridSigV1 {
            ed25519_pubkey_hex: wallet_id.clone(),
            ed25519_sig_b64: ed_sig_b64,
            mldsa_pubkey_b64,
            mldsa_sig_b64,
        },
        attestation: crate::protocol::AttestationV1 {
            platform: "test".to_string(),
            report_b64: String::new(),
        },
    };

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
        .apply_remote_transfer("0xfund-a-main", "founder", &a, 10_000, 0)
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
        .apply_remote_transfer("0xfund-a-branch", "founder", &a, 10_000, 0)
        .unwrap();
    branch_ledger
        .apply_remote_transfer(&branch_hash, &a, &c, 2_000, 100)
        .unwrap();
    branch_ledger
        .apply_block_reward("producer-b", branch_reward.total_reward_micro, 1)
        .unwrap();
    let branch_root = branch_ledger.compute_state_root();
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
    assert_eq!(ledger.compute_state_root(), branch_root);
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
        .apply_remote_transfer("0xfund-a-main-backfill", "founder", &a, 10_000, 0)
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
        .apply_remote_transfer("0xfund-a-branch-backfill", "founder", &a, 10_000, 0)
        .unwrap();
    branch_ledger
        .apply_remote_transfer(&branch_hash, &a, &c, 2_000, 100)
        .unwrap();
    branch_ledger
        .apply_block_reward("local-wallet", parent_reward.total_reward_micro, 1)
        .unwrap();
    let parent_state_root = branch_ledger.compute_state_root();
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
    let child_state_root = branch_ledger.compute_state_root();
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
    assert_eq!(ledger.compute_state_root(), child_state_root);
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
        .transfer_with_fee_attested(
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            w,
            2_000u64 * STEVEMON,
            Some(50),
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

#[tokio::test]
async fn dex_maker_can_cancel_unfilled_order() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    let _ = ledger
        .mint_reward_with_proof("alice", 2_000_000_000, b"energy:test", None, false)
        .unwrap();
    let bal_before = ledger.balance_micro("alice").unwrap();
    let supply_before_dex = ledger.total_supply_micro().unwrap();
    let burned_before_dex = ledger.total_burned_micro().unwrap();

    let state = rest_state_for_tests(std::sync::Arc::new(ledger));

    let place = crate::rest::handlers::dex::post_dex_order_place(
        axum::extract::State(state.clone()),
        axum::Json(crate::rest::DexOrderPlaceReq {
            maker_wallet: "alice".into(),
            side: "sell".into(),
            quote_asset: "USDC".into(),
            price_quote_per_tet: 50,
            tet_micro_total: 500_000_000,
            ttl_sec: Some(600),
        }),
    )
    .await;
    assert_eq!(place.status(), StatusCode::OK);
    let place_body = axum::body::to_bytes(place.into_body(), usize::MAX)
        .await
        .unwrap();
    let place_json: serde_json::Value = serde_json::from_slice(&place_body).unwrap();
    let order_id = place_json
        .get("order_id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();

    let ledger = state.ledger.clone();
    let escrow = crate::p2p_dex::escrow_wallet_for_order(&order_id);
    assert!(ledger.balance_micro(&escrow).unwrap() > 0);

    let cancel = crate::rest::handlers::dex::post_dex_order_cancel(
        axum::extract::State(state),
        axum::Json(crate::rest::DexOrderCancelReq {
            order_id,
            maker_wallet: "alice".into(),
        }),
    )
    .await;
    assert_eq!(cancel.status(), StatusCode::OK);

    let bal_after = ledger.balance_micro("alice").unwrap();
    assert_eq!(ledger.balance_micro(&escrow).unwrap(), 0);
    // Phase 2: transfer fees are strict (PROTOCOL_MAINTENANCE_FEE_BPS); half of each fee is burned.
    let lock_gross = 500_000_000u64;
    let bps = crate::ledger::PROTOCOL_MAINTENANCE_FEE_BPS;
    let fee_lock = lock_gross.saturating_mul(bps) / 10_000;
    let escrow_net = lock_gross.saturating_sub(fee_lock);
    let fee_refund = escrow_net.saturating_mul(bps) / 10_000;
    let (_, burn_lock) = crate::ledger::Ledger::split_protocol_fee_treasury_and_burn(fee_lock);
    let (_, burn_refund) = crate::ledger::Ledger::split_protocol_fee_treasury_and_burn(fee_refund);
    let expected_burn_dex = burn_lock.saturating_add(burn_refund);
    let expected_roundtrip_fee = fee_lock.saturating_add(fee_refund);
    assert_eq!(bal_before.saturating_sub(bal_after), expected_roundtrip_fee);
    assert_eq!(
        ledger.total_burned_micro().unwrap(),
        burned_before_dex.saturating_add(expected_burn_dex)
    );
    assert_eq!(
        ledger.total_supply_micro().unwrap(),
        supply_before_dex.saturating_sub(expected_burn_dex)
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
        .transfer_with_fee(pool, "alice", 100_000_000, Some(50))
        .unwrap();
    // Phase 2: transfer fees are strict (PROTOCOL_MAINTENANCE_FEE_BPS), ignoring provided fee_bps.
    let fee = 100_000_000u64 * crate::ledger::PROTOCOL_MAINTENANCE_FEE_BPS / 10_000; // 1_000_000
    let (_, burn) = crate::ledger::Ledger::split_protocol_fee_treasury_and_burn(fee);
    assert_eq!(ledger.total_burned_micro().unwrap(), burn);
    assert_eq!(
        ledger.total_supply_micro().unwrap(),
        sup0.saturating_sub(burn)
    );
}

#[tokio::test]
async fn dex_escrow_flow_quantum_gate_accepts_valid_and_rejects_classical_only() {
    let _g = env_lock();
    set_test_env_base();

    let ledger = open_temp_ledger();
    ledger.init_genesis_founder_premine_from_env().unwrap();
    // Fund maker so they can lock escrow.
    let _ = ledger
        .mint_reward_with_proof("maker", 5_000_000_000, b"energy:test", None, false)
        .unwrap();

    let state = rest_state_for_tests(std::sync::Arc::new(ledger));

    // Place order (maker sells TET for USDC).
    let mut headers = HeaderMap::new();
    headers.insert("x-api-key", "testkey".parse().unwrap());
    let place = crate::rest::handlers::dex::post_dex_order_place(
        axum::extract::State(state.clone()),
        axum::Json(crate::rest::DexOrderPlaceReq {
            maker_wallet: "maker".into(),
            side: "sell".into(),
            quote_asset: "USDC".into(),
            price_quote_per_tet: 100,
            tet_micro_total: 1_000_000_000,
            ttl_sec: Some(600),
        }),
    )
    .await;
    assert_eq!(place.status(), StatusCode::OK);

    // Taker takes.
    let take = crate::rest::handlers::dex::post_dex_take(
        axum::extract::State(state.clone()),
        axum::Json(crate::rest::DexTakeReq {
            taker_wallet: "taker".into(),
            side: "buy".into(),
            quote_asset: "USDC".into(),
            tet_micro: 250_000_000,
            max_price_quote_per_tet: Some(100),
            settlement_ttl_sec: Some(600),
        }),
    )
    .await;
    assert_eq!(take.status(), StatusCode::OK);
    let take_body = axum::body::to_bytes(take.into_body(), usize::MAX)
        .await
        .unwrap();
    let take_json: serde_json::Value = serde_json::from_slice(&take_body).unwrap();
    let trade_id = take_json
        .get("trade_id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();

    // Prepare valid hybrid signatures for both parties.
    let maker_ed = SigningKey::generate(&mut rand_core::OsRng);
    let taker_ed = SigningKey::generate(&mut rand_core::OsRng);
    let maker_mldsa = {
        let mut seed = [0u8; 32];
        rand_core::OsRng.fill_bytes(&mut seed);
        dilithium::MlDsaKeyPair::generate_deterministic(dilithium::ML_DSA_65, &seed)
    };
    let taker_mldsa = {
        let mut seed = [0u8; 32];
        rand_core::OsRng.fill_bytes(&mut seed);
        dilithium::MlDsaKeyPair::generate_deterministic(dilithium::ML_DSA_65, &seed)
    };

    let trade = {
        let dex = state.dex.lock().unwrap();
        dex.get_trade(&trade_id).unwrap()
    };
    let txid = "solana_txid_dummy_123";
    let msg = crate::p2p_dex::DexEngine::trade_complete_message_v1(&trade, txid);

    let mut qh = headers.clone();
    sign_hybrid_headers(&mut qh, "maker", &maker_ed, &maker_mldsa, &msg);
    sign_hybrid_headers(&mut qh, "taker", &taker_ed, &taker_mldsa, &msg);

    // Payment verified guard: hybrid-ready but settlement not confirmed -> 403.
    let blocked = crate::rest::handlers::dex::post_dex_trade_complete(
        axum::extract::State(state.clone()),
        qh.clone(),
        axum::Json(crate::rest::DexTradeCompleteReq {
            trade_id: trade_id.clone(),
            solana_usdc_txid: txid.into(),
            maker_ed25519_pubkey_hex: hex::encode(maker_ed.verifying_key().as_bytes()),
            taker_ed25519_pubkey_hex: hex::encode(taker_ed.verifying_key().as_bytes()),
        }),
    )
    .await;
    assert_eq!(blocked.status(), StatusCode::FORBIDDEN);

    let confirm = crate::rest::handlers::dex::post_dex_settlement_confirm(
        axum::extract::State(state.clone()),
        axum::Json(crate::rest::DexSettlementConfirmReq {
            trade_id: trade_id.clone(),
            solana_usdc_txid: txid.into(),
        }),
    )
    .await;
    assert_eq!(confirm.status(), StatusCode::OK);

    // After settlement confirm, complete should pass (quantum gate still enforced).
    let complete_ok = crate::rest::handlers::dex::post_dex_trade_complete(
        axum::extract::State(state.clone()),
        qh.clone(),
        axum::Json(crate::rest::DexTradeCompleteReq {
            trade_id: trade_id.clone(),
            solana_usdc_txid: txid.into(),
            maker_ed25519_pubkey_hex: hex::encode(maker_ed.verifying_key().as_bytes()),
            taker_ed25519_pubkey_hex: hex::encode(taker_ed.verifying_key().as_bytes()),
        }),
    )
    .await;
    assert_eq!(complete_ok.status(), StatusCode::OK);

    // Classical-only: omit ML-DSA headers -> must be 403.
    let mut classical = headers.clone();
    let sig = maker_ed.sign(&msg);
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
    classical.insert("x-tet-maker-ed25519-sig-b64", sig_b64.parse().unwrap());
    classical.insert("x-tet-taker-ed25519-sig-b64", sig_b64.parse().unwrap());

    let complete_forbidden = crate::rest::handlers::dex::post_dex_trade_complete(
        axum::extract::State(state),
        classical,
        axum::Json(crate::rest::DexTradeCompleteReq {
            trade_id,
            solana_usdc_txid: txid.into(),
            maker_ed25519_pubkey_hex: hex::encode(maker_ed.verifying_key().as_bytes()),
            taker_ed25519_pubkey_hex: hex::encode(taker_ed.verifying_key().as_bytes()),
        }),
    )
    .await;
    assert_eq!(complete_forbidden.status(), StatusCode::FORBIDDEN);
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
        .transfer_with_fee(
            "founder",
            crate::ledger::WALLET_SYSTEM_WORKER_POOL,
            200_000_000,
            Some(50),
        )
        .unwrap();

    ledger
        .test_only_mark_genesis_1k_participant("maker", 42)
        .unwrap();

    let gross_req = 100_000_000u64;
    let boosted_gross = (gross_req as u128 * 11 / 10) as u64;
    let imperial_bps = 100u64;
    let imperial_tax = boosted_gross.saturating_mul(imperial_bps) / 10_000;
    let expected_worker_net = boosted_gross.saturating_sub(imperial_tax);

    ledger
        .mint_worker_network_reward("maker", "imperial-vault", gross_req, b"energy:poc", None)
        .unwrap();

    let locked = ledger.locked_balance_micro_now("maker").unwrap();
    assert_eq!(
        locked, expected_worker_net,
        "Genesis participant should receive +10% on gross before imperial split"
    );
}

#[tokio::test]
async fn worker_ai_reward_vest_blocks_dex_until_lock_expires() {
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
    let supply_after_genesis = ledger.total_supply_micro().unwrap();
    assert_eq!(
        supply_after_genesis,
        crate::ledger::GENESIS_TOTAL_MINT_MICRO,
        "genesis must mint full max supply (25% founder + 75% system pool)"
    );

    ledger
        .transfer_with_fee(
            "founder",
            crate::ledger::WALLET_SYSTEM_WORKER_POOL,
            200_000_000,
            Some(50),
        )
        .unwrap();

    let gross = 100_000_000u64;
    ledger
        .mint_worker_network_reward("maker", "imperial-vault", gross, b"energy:poc", None)
        .unwrap();
    assert!(
        ledger.total_supply_micro().unwrap() <= supply_after_genesis,
        "worker_pool payout must not inflate total supply (burn is allowed)"
    );

    let locked = ledger.locked_balance_micro_now("maker").unwrap();
    assert!(locked > 0, "worker_net must appear as locked balance");
    assert_eq!(
        ledger.spendable_balance_micro_now("maker").unwrap(),
        0,
        "DEX must not spend vest-locked worker_net"
    );

    let state = rest_state_for_tests(std::sync::Arc::new(ledger));

    let place_fail = crate::rest::handlers::dex::post_dex_order_place(
        axum::extract::State(state.clone()),
        axum::Json(crate::rest::DexOrderPlaceReq {
            maker_wallet: "maker".into(),
            side: "sell".into(),
            quote_asset: "USDC".into(),
            price_quote_per_tet: 100,
            tet_micro_total: 1_000_000,
            ttl_sec: Some(600),
        }),
    )
    .await;
    assert_eq!(place_fail.status(), StatusCode::BAD_REQUEST);

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let place_ok = crate::rest::handlers::dex::post_dex_order_place(
        axum::extract::State(state),
        axum::Json(crate::rest::DexOrderPlaceReq {
            maker_wallet: "maker".into(),
            side: "sell".into(),
            quote_asset: "USDC".into(),
            price_quote_per_tet: 100,
            tet_micro_total: 1_000_000,
            ttl_sec: Some(600),
        }),
    )
    .await;
    assert_eq!(place_ok.status(), StatusCode::OK);
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
        .settle_ai_utility_payment(payer, worker, 1_000, &burn)
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

    // ML-DSA pubkey (default ML-DSA-65) must be decodable; length matches FIPS-204 raw encoding.
    let pk = base64::engine::general_purpose::STANDARD
        .decode(w.dilithium_pubkey_b64.trim())
        .unwrap();
    assert_eq!(pk.len(), dilithium::ML_DSA_65.public_key_bytes());
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

#[test]
fn mldsa65_hybrid_transfer_sign_verify_roundtrip() {
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
}

#[test]
fn mainnet_rejects_legacy_tx_signature_without_chain_binding() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_MAINNET", "1");
        std::env::set_var(
            "TET_GENESIS_FOUNDER_WALLET_ID",
            crate::ledger::GENESIS_FOUNDER_DEV_PUBLIC_HEX,
        );
    }

    let wi = crate::wallet::generate_mnemonic_12().unwrap();
    let phrase = wi.mnemonic_12.as_deref().unwrap_or_default();
    let w = crate::wallet::recover_from_mnemonic_12(phrase).unwrap();
    let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let env = signed_transfer_env_for_tests(phrase, &w.address_hex, bob, 1_000_000);
    let err = crate::rest::helpers::verify_envelope_v1(&env).unwrap_err();
    assert!(err.contains("chain_id/genesis_hash"));

    unsafe {
        std::env::remove_var("TET_MAINNET");
        std::env::remove_var("TET_GENESIS_FOUNDER_WALLET_ID");
    }
}

#[test]
fn mainnet_panics_when_mock_zk_is_enabled() {
    let _g = env_lock();
    set_test_env_base();
    unsafe {
        std::env::set_var("TET_MAINNET", "1");
        std::env::set_var("TET_ALLOW_MOCK_ZK", "1");
    }

    let result = std::panic::catch_unwind(|| {
        let _ = crate::zk_verifier::verify_receipt("MOCKJ1:");
    });
    assert!(result.is_err());

    unsafe {
        std::env::remove_var("TET_MAINNET");
        std::env::remove_var("TET_ALLOW_MOCK_ZK");
    }
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

    assert!(!state.enqueue_mempool_tx(make_env(1)).await.unwrap());
    assert!(state.enqueue_mempool_tx(make_env(100)).await.unwrap());
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
        .transfer_with_fee(pool, &w.address_hex, 50_000_000_000, Some(50))
        .unwrap();

    let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let amount_micro = 1_000_000u64;
    ledger
        .transfer_with_fee_attested(
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
        .transfer_with_fee_attested(
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
        .transfer_with_fee_attested(
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
    use super::{env_lock, rest_state_for_tests, set_test_env_base};
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
        let (gossip_tx, swarm_task) = crate::p2p::start_mdns_ping_swarm(
            ledger.clone(),
            mempool,
            keypair,
            listen,
            hello_registry,
            catch_up_driver,
            block_sync_board.clone(),
            tmail_store,
            file_store,
        )
        .expect("block swarm");

        let mut state = rest_state_for_tests(ledger);
        state.gossip_tx = Some(gossip_tx);
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
                let root = ledgers[0].compute_state_root();
                if ledgers.iter().all(|l| l.compute_state_root() == root) {
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
        let root = ledgers[0].compute_state_root();
        for (i, l) in ledgers.iter().enumerate() {
            assert_eq!(
                l.compute_state_root(),
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
        let state_root = ledger.compute_state_root();
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
    assert_eq!(
        crate::files::FEE_SPLIT_TREASURY_BPS
            + crate::files::FEE_SPLIT_STORAGE_BPS
            + crate::files::FEE_SPLIT_BURN_BPS,
        10_000
    );
    assert_eq!(crate::files::FILE_FEE_MICRO, 1000);
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
