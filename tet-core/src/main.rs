#![allow(dead_code)]

mod agent;
mod ai_filter;
mod ai_proxy;
mod attestation;
mod chaos;
mod conductor;
mod consensus;
mod e2ee;
mod executor;
mod files;
mod fees;
mod fips204_vectors;
mod genesis;
mod invariant_tests;
mod ledger;
mod marketplace;
mod metrics;
mod models;
mod network;
mod oracle;
mod p2p;
mod p2p_keystore;
mod p2p_network;
mod producer_key;
mod protocol;
mod quantum_shield;
mod render_farm;
mod replication;
mod rest;
mod swarm_health;
mod sync;
mod tee_compute;
mod tmail;
mod updater;
mod vision;
mod wallet;
mod workers;
mod worker_ai;
mod worker_config;
mod worker_daemon;
mod worker_engine;
mod worker_network;
mod zk_verifier;

#[cfg(test)]
mod test_env;
#[cfg(test)]
mod tests;

use crate::ledger::{GENESIS_FOUNDER_DEV_PUBLIC_HEX, Ledger};
use crate::network::NetworkManager;
use crate::rest::{HttpRateLimit, RestState, serve};
use crate::worker_network::WorkerRegistry;
use base64::Engine as _;
use methods::NEXUS_GUEST_ID;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::broadcast;

type AnyErr = Box<dyn std::error::Error + Send + Sync>;

/// Env-derived settings for the node boot sequence (B.5).
struct StartupConfig {
    port: u16,
    db_dir: String,
    initial_wallet: String,
    treasury_address: String,
    p2p_listen: String,
    enable_p2p: bool,
    rest_bind: String,
    http_rps: u64,
    is_prod: bool,
    is_mainnet: bool,
}

impl StartupConfig {
    fn from_env() -> Self {
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(5010);
        let db_dir_base = std::env::var("TET_DB_DIR")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "tet.db".to_string());
        let db_dir = if std::env::var("TET_DB_DIR")
            .ok()
            .filter(|s| !s.is_empty())
            .is_some()
        {
            db_dir_base.clone()
        } else {
            format!("{db_dir_base}_{port}")
        };
        let initial_wallet = std::env::var("TET_WALLET_ID")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                std::env::var("TET_NODE_LABEL")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "local-wallet".to_string())
            });
        let is_prod = std::env::var("TET_PROD")
            .ok()
            .as_deref()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
            || std::env::var("TET_MAINNET")
                .ok()
                .as_deref()
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
        let is_mainnet = std::env::var("TET_MAINNET")
            .ok()
            .as_deref()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let enable_p2p = std::env::var("TET_ENABLE_P2P")
            .ok()
            .as_deref()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(true);
        let p2p_listen =
            std::env::var("TET_P2P_LISTEN").unwrap_or_else(|_| "/ip4/0.0.0.0/tcp/4001".to_string());
        let rest_bind = std::env::var("TET_REST_BIND")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("0.0.0.0:{port}"));
        let http_rps = std::env::var("TET_HTTP_RPS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(25)
            .max(1);
        let treasury_address = match crate::ledger::treasury_address_from_env() {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[FATAL] {e}");
                std::process::exit(2);
            }
        };
        Self {
            port,
            db_dir,
            initial_wallet,
            treasury_address,
            p2p_listen,
            enable_p2p,
            rest_bind,
            http_rps,
            is_prod,
            is_mainnet,
        }
    }
}

fn init_tracing() {
    let _ = tracing_log::LogTracer::init();
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let json_logs = std::env::var("TET_JSON_LOG")
        .ok()
        .as_deref()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let fmt = tracing_subscriber::fmt().with_env_filter(env_filter);
    if json_logs {
        let _ = fmt.json().try_init();
    } else {
        let _ = fmt.try_init();
    }
}

fn fatal_db_lock_help(db_dir: &str, port: u16, e: &dyn std::error::Error) -> ! {
    eprintln!();
    eprintln!("[FATAL] Could not open ledger DB at `{db_dir}`.");
    eprintln!("[FATAL] {e}");
    eprintln!();
    eprintln!(
        "Most common cause: another TET-Core process is already running and holding the sled lock."
    );
    eprintln!();
    eprintln!("Fix options:");
    eprintln!("  1) Stop the existing process (recommended). On macOS:");
    eprintln!("     lsof -nP -iTCP:{port} -sTCP:LISTEN");
    eprintln!("     kill <PID>");
    eprintln!();
    eprintln!("  2) Run a separate sandbox DB (keeps your main ledger intact):");
    eprintln!("     TET_DB_DIR=tet_sandbox.db cargo run --bin TET-Core");
    eprintln!();
    std::process::exit(2);
}

#[tokio::main]
async fn main() -> Result<(), AnyErr> {
    // `TET_PEER_ID` was renamed `TET_NODE_LABEL` (PHASE_1_GENESIS_SPEC §2.4). Ignoring the old name
    // would quietly change this node's producer id, so a node that still sets it does not start.
    crate::consensus::refuse_retired_peer_id_env().map_err(|e| -> AnyErr { e.into() })?;
    // Phase 1: print this node's genesis validator entry (producer id + producer public key), for
    // the genesis validator set. Creates the producer key under TET_DB_DIR if it does not exist.
    // Usage: `TET_DB_DIR=… TET_WALLET_ID=… TET-Core --producer-key`
    if std::env::args().any(|a| a == "--producer-key") {
        // Before tracing starts: stdout must carry only the JSON entry, since scripts capture it.
        let config = StartupConfig::from_env();
        let key = crate::producer_key::ProducerKeypair::load_or_create(std::path::Path::new(
            &config.db_dir,
        ))
        .map_err(|e| format!("producer key: {e}"))?;
        let entry = crate::genesis::GenesisValidator {
            producer_id: config.initial_wallet.trim().to_ascii_lowercase(),
            key: key.public_key(),
        };
        println!("{}", serde_json::to_string(&entry)?);
        return Ok(());
    }

    init_tracing();

    // Phase 2.5: Node Operator Defense (default SAFE MODE).
    let safe_mode = crate::worker_config::configure_from_args();
    if safe_mode {
        log::info!(
            "Node started in SAFE MODE. Content filtering is ENABLED to protect the operator."
        );
    } else {
        log::warn!(
            "Node started in UNSAFE MODE. Content filtering is DISABLED (--unsafe-no-filter)."
        );
    }
    if crate::worker_config::enable_zk_prover() {
        log::info!("ZK PROVER: ENABLED (Strict Mode Active)");
    } else {
        log::info!("ZK PROVER: DISABLED (Optimistic Mode Active)");
    }

    crate::vision::fluid_net::log_startup_summary();
    let _caac = crate::vision::caac::profile();
    log::info!(
        "[vision][caac] role={:?} fingerprint_prefix={}…",
        _caac.role,
        _caac
            .hw
            .fingerprint_sha256_hex
            .chars()
            .take(12)
            .collect::<String>()
    );

    // Phase 1.3.1: Keygen CLI for E2E scripts.
    // Usage: `RISC0_SKIP_BUILD=1 cargo run --quiet --bin TET-Core -- --keygen`
    if std::env::args().any(|a| a == "--keygen") {
        use pqcrypto_kyber::kyber768;
        use pqcrypto_traits::kem::{PublicKey as _, SecretKey as _};
        use x25519_dalek::{PublicKey, StaticSecret};

        let x_sk = StaticSecret::random_from_rng(rand_core::OsRng);
        let x_pk = PublicKey::from(&x_sk);
        let (k_pk, k_sk) = kyber768::keypair();

        println!(
            "export GEN_X25519_SK=\"{}\"",
            base64::engine::general_purpose::STANDARD.encode(x_sk.to_bytes())
        );
        println!(
            "export GEN_X25519_PK=\"{}\"",
            base64::engine::general_purpose::STANDARD.encode(x_pk.as_bytes())
        );
        println!(
            "export GEN_MLKEM_SK=\"{}\"",
            base64::engine::general_purpose::STANDARD.encode(k_sk.as_bytes())
        );
        println!(
            "export GEN_MLKEM_PK=\"{}\"",
            base64::engine::general_purpose::STANDARD.encode(k_pk.as_bytes())
        );
        return Ok(());
    }

    // Chaos tester mode (anti-fragility).
    // Usage: `TET-Core chaos-sim` (no server).
    if std::env::args().any(|a| a == "chaos-sim") {
        let r = crate::chaos::simulate_reroute(20_000, 1_000, 500);
        if !r.ok_no_loss {
            let err: AnyErr = Box::new(std::io::Error::other(
                "chaos-sim failed: shard loss detected",
            ));
            return Err(err);
        }
        println!(
            "CHAOS_SIM_OK workers_total={} workers_online_after={} shards_total={} rerouted_shards={}",
            r.workers_total, r.workers_online_after, r.shards_total, r.rerouted_shards
        );
        return Ok(());
    }

    // --- Step 1: env / config ---
    let config = StartupConfig::from_env();

    // The genesis parameters are read on every signature check; refuse to start on a chain this
    // node cannot name, rather than panic on the first request.
    match crate::genesis::GenesisParams::from_env() {
        Ok(g) => log::info!(
            "[startup] genesis {} chain_id={} genesis_time_ms={} founder_cliff_ms={} validators={} leader_mode={}",
            g.hash(),
            g.chain_id,
            g.genesis_time_ms,
            g.founder_cliff_ms,
            g.validators.len(),
            g.leader_mode.as_str()
        ),
        Err(e) => {
            eprintln!("[startup] FATAL: invalid genesis configuration: {e}");
            std::process::exit(2);
        }
    }
    log::info!(
        "[startup] config loaded port={} db_dir={} enable_p2p={} rest_bind={}",
        config.port,
        config.db_dir,
        config.enable_p2p,
        config.rest_bind
    );

    // CRITICAL: production mode must never boot with an unencrypted ledger.
    if config.is_prod && NEXUS_GUEST_ID == [0u32; 8] {
        panic!("CRITICAL: ZK Guest ID is zero. Refusing to boot in production mode.");
    }
    if config.is_mainnet {
        let allow_mock_zk = std::env::var("TET_ALLOW_MOCK_ZK")
            .ok()
            .as_deref()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if allow_mock_zk {
            panic!("CRITICAL: TET_MAINNET=1 forbids TET_ALLOW_MOCK_ZK=1.");
        }
        let has_founder = std::env::var("TET_GENESIS_FOUNDER_WALLET_ID")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .is_some();
        if !has_founder {
            panic!("CRITICAL: TET_MAINNET=1 requires TET_GENESIS_FOUNDER_WALLET_ID.");
        }
    }
    if config.is_prod {
        let encrypt_mode = std::env::var("TET_DB_ENCRYPT")
            .ok()
            .unwrap_or_else(|| "strict".to_string())
            .to_ascii_lowercase();
        if encrypt_mode == "off" || encrypt_mode == "false" || encrypt_mode == "0" {
            eprintln!("[FATAL] Production mode forbids TET_DB_ENCRYPT=off.");
            std::process::exit(2);
        }
        let has_key = std::env::var("TET_DB_KEY_B64")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .is_some()
            || std::env::var("TET_DB_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .is_some();
        if !has_key {
            eprintln!(
                "[FATAL] Production mode requires an encryption key: set TET_DB_KEY_B64 (preferred) or TET_DB_KEY."
            );
            std::process::exit(2);
        }
    }

    // --- Step 2: libp2p keystore ---
    // One root secret, three wire identities (PHASE_1_GENESIS_SPEC §2.4): each swarm takes the
    // `PlaneKeys` and selects its own plane, so no two planes share a PeerId.
    let plane_keys = if config.enable_p2p {
        match crate::p2p_keystore::P2pKeystore::load_or_create(std::path::Path::new(&config.db_dir))
            .and_then(|ks| ks.plane_keys())
        {
            Ok(keys) => {
                use crate::p2p_keystore::Plane;
                log::info!(
                    "[startup] keystore loaded, block_peer_id={} nexus_peer_id={} ledger_peer_id={}",
                    keys.peer_id(Plane::Block),
                    keys.peer_id(Plane::Nexus),
                    keys.peer_id(Plane::Ledger)
                );
                crate::p2p_keystore::log_peer_id_banner(&keys, &config.p2p_listen);
                Some(keys)
            }
            Err(e) => {
                log::warn!("[startup] libp2p keystore unavailable: {e}");
                None
            }
        }
    } else {
        log::info!("[startup] keystore skipped (TET_ENABLE_P2P=0)");
        None
    };

    // Block-producer key (hybrid Ed25519 + ML-DSA-44). Not the wallet key: this node holds no
    // spending secret. Without it the node can follow but not produce.
    let producer_key =
        match crate::producer_key::ProducerKeypair::load_or_create(std::path::Path::new(&config.db_dir)) {
            Ok(k) => {
                log::info!(
                    "[startup] producer key ready ed25519={}",
                    k.public_key().ed25519_pk_hex
                );
                Some(Arc::new(k))
            }
            Err(e) => {
                log::warn!("[startup] producer key unavailable, this node will not produce: {e}");
                None
            }
        };

    if let Err(e) =
        tet_core::pqc_keystore::ensure_node_mldsa_keystore(std::path::Path::new(&config.db_dir))
    {
        log::warn!("ML-DSA node keystore: {e}");
    } else {
        log::info!("ML-DSA node keystore ready under `{}`", config.db_dir);
    }

    // --- Step 3: ledger ---
    let ledger = match Ledger::open(&config.db_dir) {
        Ok(l) => Arc::new(l),
        Err(e) => {
            let msg = format!("{e}");
            if msg.contains("could not acquire lock on")
                || msg.contains("Resource temporarily unavailable")
                || msg.contains("WouldBlock")
            {
                fatal_db_lock_help(&config.db_dir, config.port, &e);
            }
            // LedgerError may not be Send+Sync; return a portable error type.
            let err: AnyErr = Box::new(std::io::Error::other(msg));
            return Err(err);
        }
    };
    ledger.init_genesis_founder_premine_from_env()?;
    ledger.validate_treasury_address_at_startup(&config.treasury_address)?;
    let local_height = ledger.block_height().unwrap_or(0);
    log::info!(
        "[startup] ledger opened, local_height={local_height} treasury={}",
        config.treasury_address
    );

    // MVP tokenomics bootstrap: if ledger is empty, apply genesis to the Sovereign OS founder wallet
    // (`//Ferdie` pubkey hex). Must stay in sync with tet-network OsClient `FOUNDER_SIGNING_URI`.
    {
        let founder_wallet_id = std::env::var("TET_GENESIS_FOUNDER_WALLET_ID")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_ascii_lowercase())
            .unwrap_or_else(|| GENESIS_FOUNDER_DEV_PUBLIC_HEX.to_string());
        let supply0 = ledger.total_supply_micro().unwrap_or(0);
        if supply0 == 0 {
            let s = ledger
                .apply_genesis_allocation(&founder_wallet_id)
                .unwrap_or_else(|e| {
                    panic!(
                        "[ledger] FATAL: auto genesis (big bang) failed with supply unset/0: {e}"
                    )
                });
            log::info!(
                "[ledger] auto genesis OK founder={} total_supply_micro={}",
                s.founder_wallet_id,
                s.total_supply_micro
            );
        }
    }

    // Phase 1.1: Dev/test faucet for E2E loops (avoids "insufficient funds").
    // Guardrails:
    // - Disabled in prod/mainnet mode.
    // - Amount is explicit via env.
    if !config.is_prod
        && let Ok(v) = std::env::var("TET_DEV_FAUCET_MICRO")
        && let Ok(micro) = v.trim().parse::<u64>()
        && micro > 0
    {
        let payload =
            format!("dev_faucet|wallet={}|micro={micro}", config.initial_wallet).into_bytes();
        match ledger.mint_reward_with_proof(&config.initial_wallet, micro, &payload, None, false) {
            Ok((_gross, net, _fee, _proof_id)) => {
                eprintln!(
                    "[dev] faucet credited micro={} (net={}) wallet={}",
                    micro, net, config.initial_wallet
                );
            }
            Err(e) => {
                eprintln!(
                    "[dev] faucet failed micro={} wallet={} err={}",
                    micro, config.initial_wallet, e
                );
            }
        }
    }

    if !config.is_prod
        && matches!(
            std::env::var("TET_DEV_FORCE_POC")
                .ok()
                .as_deref()
                .map(str::trim),
            Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
        )
    {
        let rec = crate::ledger::CaacWorkerRecord {
            role: "POC".to_string(),
            latency_ms: 1,
            seed_hex: "dev-force-poc".to_string(),
            server_wall_ms: 1,
        };
        if let Err(e) = ledger.caac_put_worker_record(&config.initial_wallet, &rec) {
            log::warn!(
                "[dev] force POC CAAC record failed wallet={}: {e}",
                config.initial_wallet
            );
        } else {
            log::info!(
                "[dev] force POC CAAC record enabled wallet={}",
                config.initial_wallet
            );
        }
    }

    let mempool = Arc::new(tokio::sync::Mutex::new(Vec::new()));

    // Tmail node-local TTL buffer + key directory (off-ledger). Opened on the ledger's sled Db so
    // that deleting TET_DB_DIR also clears buffered mail (clean-restart correctness).
    let tmail_store = Arc::new(
        crate::tmail::store::TmailStore::open(&ledger.sled_db())
            .map_err(|e| -> AnyErr { Box::new(std::io::Error::other(format!("{e}"))) })?,
    );
    {
        // Background TTL reaper for the Tmail buffer (spec §A.1: entries expire per ttl_ms).
        let prune_interval_sec = std::env::var("TET_TMAIL_PRUNE_INTERVAL_SEC")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(300);
        let prune_store = tmail_store.clone();
        tokio::spawn(async move {
            let mut tick =
                tokio::time::interval(std::time::Duration::from_secs(prune_interval_sec));
            loop {
                tick.tick().await;
                let removed = prune_store.prune_expired();
                if removed > 0 {
                    log::info!("[tmail] pruned {removed} expired envelope(s)");
                }
            }
        });
    }

    // File Sharing node-local blob/meta/inbox store (off-ledger; Phase 0 spec). Same lifecycle as
    // the Tmail buffer: opened on the ledger's sled Db, with a background 30-day TTL reaper.
    let file_store = Arc::new(
        crate::files::storage::FileStore::open(&ledger.sled_db())
            .map_err(|e| -> AnyErr { Box::new(std::io::Error::other(format!("{e}"))) })?,
    );
    {
        let prune_interval_sec = std::env::var("TET_FILES_PRUNE_INTERVAL_SEC")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(300);
        let prune_store = file_store.clone();
        tokio::spawn(async move {
            let mut tick =
                tokio::time::interval(std::time::Duration::from_secs(prune_interval_sec));
            loop {
                tick.tick().await;
                let removed = prune_store.prune_expired();
                if removed > 0 {
                    log::info!("[files] pruned {removed} expired file(s)");
                }
            }
        });
    }

    // --- Step 4: P2P swarms (network, p2p_network, block-plane) ---
    let mut swarm_network = false;
    let mut swarm_p2p_network = false;
    let mut swarm_block = false;

    let p2p = if config.enable_p2p {
        match plane_keys.as_ref() {
            Some(keys) => {
                let mut nm = NetworkManager::new(config.initial_wallet.clone(), keys).await?;
                let tx = nm.tx();
                crate::replication::set_p2p_sender(Some(tx.clone()));
                tokio::spawn(async move {
                    let _ = nm.run().await;
                });
                swarm_network = true;
                Some(tx)
            }
            None => {
                log::warn!("[p2p] NetworkManager not started: libp2p keystore unavailable");
                crate::replication::set_p2p_sender(None);
                None
            }
        }
    } else {
        crate::replication::set_p2p_sender(None);
        None
    };

    // Solana removed 2026-09-28. A call to onchain::maybe_register_worker_before_p2p()
    // stood here: it registered and staked the worker in a Solana program, behind
    // TET_ONCHAIN_STAKE (default off), against a localnet validator at 127.0.0.1:8899.
    // Nothing ran it in production. Worker staking is a TET-ledger concern — see
    // PHASE_1_GENESIS_SPEC.md §2, which needs a Stake tx variant that does not exist yet.

    let nexus_p2p_client = match plane_keys.as_ref() {
        Some(keys) => match crate::p2p_network::start_p2p_node(ledger.clone(), keys) {
            Ok((c, _jh)) => {
                swarm_p2p_network = true;
                Some(c)
            }
            Err(e) => {
                eprintln!("[p2p][warn] TET P2P engine failed to start: {e}");
                None
            }
        },
        None => None,
    };

    let hello_registry = crate::sync::new_hello_registry();
    let catch_up_driver = crate::sync::new_catch_up_driver();

    // --- Step 5: BlockSyncBoard (REST + auto-mine sync gate) ---
    let block_sync_board = if config.enable_p2p && plane_keys.is_some() {
        let board =
            crate::sync::new_block_sync_board(hello_registry.clone(), catch_up_driver.clone());
        log::info!("[startup] sync board created (per-node Arc<BlockSyncBoard>)");
        Some(board)
    } else {
        log::info!("[startup] sync board skipped (p2p disabled or no keystore)");
        None
    };

    let block_p2p_listen = crate::p2p::parse_block_listen_multiaddr(&config.p2p_listen)
        .unwrap_or_else(|e| {
            log::warn!("[p2p][block] {e}; fallback /ip4/0.0.0.0/tcp/0");
            "/ip4/0.0.0.0/tcp/0".parse().expect("fallback listen addr")
        });
    // Liveness beacon for the block-plane swarm loop (feeds the systemd watchdog + /health/swarm).
    let swarm_health = crate::swarm_health::SwarmHealth::new();
    let (gossip_tx, files_fetch_tx, tx_submit_tx, anon_register_tx) = if config.enable_p2p {
        match plane_keys.as_ref() {
            Some(keys) => {
                match crate::p2p::start_mdns_ping_swarm(
                    ledger.clone(),
                    mempool.clone(),
                    keys,
                    block_p2p_listen.clone(),
                    hello_registry,
                    catch_up_driver,
                    block_sync_board
                        .clone()
                        .expect("block_sync_board required when block swarm starts"),
                    tmail_store.clone(),
                    file_store.clone(),
                    swarm_health.clone(),
                ) {
                    Ok((tx, files_fetch_tx, tx_submit_tx, anon_register_tx, _swarm_jh)) => {
                        swarm_block = true;
                        // Systemd watchdog: restarts the unit if the block-plane loop stalls,
                        // before a heavy-work stall can cascade into an OS-level TCP wedge.
                        let stall_ms = crate::swarm_health::stall_threshold_ms_from_env();
                        let _watchdog =
                            crate::swarm_health::spawn_watchdog(swarm_health.clone(), stall_ms);
                        (
                            Some(tx),
                            Some(files_fetch_tx),
                            Some(tx_submit_tx),
                            Some(anon_register_tx),
                        )
                    }
                    Err(e) => {
                        eprintln!("[p2p][warn] failed to start mdns/ping/gossip swarm: {e}");
                        (None, None, None, None)
                    }
                }
            }
            None => (None, None, None, None),
        }
    } else {
        (None, None, None, None)
    };

    let bootnodes = crate::vision::fluid_net::bootnode_addrs_from_env();
    if !bootnodes.is_empty() {
        log::info!(
            "[startup] bootnodes configured count={} addrs={bootnodes:?} (dial runs inside swarm tasks after listen)",
            bootnodes.len()
        );
    }

    let nexus_listen = std::env::var("TET_NEXUS_P2P_LISTEN")
        .unwrap_or_else(|_| "/ip4/0.0.0.0/tcp/4003".to_string());
    let ledger_listen = std::env::var("TET_LEDGER_P2P_LISTEN")
        .unwrap_or_else(|_| "/ip4/0.0.0.0/tcp/4005".to_string());
    log::info!(
        "[startup] 3 swarms spawned network={swarm_network} p2p_network={swarm_p2p_network} block_plane={swarm_block} block_listen={block_p2p_listen} block_listen_env=TET_P2P_LISTEN={} nexus_listen_env=TET_NEXUS_P2P_LISTEN={} ledger_listen_env=TET_LEDGER_P2P_LISTEN={}",
        config.p2p_listen,
        nexus_listen,
        ledger_listen
    );

    let chain_hello_interval_sec =
        std::env::var("TET_CHAIN_HELLO_INTERVAL_SEC").unwrap_or_else(|_| "15".to_string());
    let blacklist_ttl_sec =
        std::env::var("TET_BLACKLIST_TTL_SEC").unwrap_or_else(|_| "300".to_string());
    let idle_timeout_sec =
        std::env::var("TET_IDLE_TIMEOUT_SEC").unwrap_or_else(|_| "300".to_string());
    let kad_bootstrap_interval_sec =
        std::env::var("TET_KAD_BOOTSTRAP_INTERVAL_SEC").unwrap_or_else(|_| "60".to_string());
    log::info!(
        "[startup] catch-up tuning TET_CHAIN_HELLO_INTERVAL_SEC={chain_hello_interval_sec} (0=disabled) TET_BLACKLIST_TTL_SEC={blacklist_ttl_sec} (0=never-expire) TET_IDLE_TIMEOUT_SEC={idle_timeout_sec} (0=infinite) TET_KAD_BOOTSTRAP_INTERVAL_SEC={kad_bootstrap_interval_sec} (0=disabled)"
    );

    let addr: SocketAddr = config.rest_bind.parse()?;

    let (log_tx, _log_rx) = broadcast::channel::<String>(100);

    let state = RestState {
        ledger,
        wallet_id: config.initial_wallet.clone(),
        p2p_tx: p2p,
        p2p_client: nexus_p2p_client,
        gossip_tx,
        block_sync_board: block_sync_board.clone(),
        swarm_health: Some(swarm_health.clone()),
        mempool,
        pending_rebroadcast: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        tmail: tmail_store,
        files: file_store,
        files_fetch_tx,
        tx_submit_tx,
        anon_register_tx,
        http_ratelimit: Arc::new(tokio::sync::Mutex::new(HttpRateLimit::new(config.http_rps))),
        workers: Arc::new(StdMutex::new(WorkerRegistry::default())),
        e2ee_jobs: Arc::new(StdMutex::new(crate::rest::E2eeJobQueue::default())),
        genesis_1k_lock: Arc::new(tokio::sync::Mutex::new(())),
        log_tx,
        log_sse_connections: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        producer_key,
    };

    // Pending txs this node admitted over REST are re-published on a timer until they are mined.
    // Without it a tx submitted before the gossipsub txs-topic mesh grafts is published once,
    // fails with InsufficientPeers, and is never retried — it then sits in this node's mempool
    // forever unless this node happens to be a producer.
    // Restore transactions this node admitted over REST and had not yet seen mined. Before this,
    // a restart silently dropped them: the sender held a 202 for a transaction that no longer
    // existed anywhere. Restoring into BOTH the mempool and the rebroadcast tracker matters —
    // the tracker is the origin marker that decides what the sweep below re-publishes, so a tx
    // restored into the mempool alone would sit there until this node happened to mine.
    {
        let restored = state.ledger.mempool_restore();
        if !restored.is_empty() {
            let mut mp = state.mempool.lock().await;
            let mut tracker = state.pending_rebroadcast.lock().await;
            for (hash, env) in restored {
                mp.push(env);
                tracker.insert(hash, 0);
            }
            log::info!(
                "[startup] restored {} pending tx(s) from the previous run; rebroadcast resumes",
                mp.len()
            );
        }
    }

    match RestState::spawn_mempool_rebroadcast(state.clone()) {
        Some(_h) => log::info!(
            "[startup] mempool rebroadcast every {}s, max {} attempts/tx",
            RestState::tx_rebroadcast_interval_sec(),
            RestState::tx_rebroadcast_max_attempts()
        ),
        None => log::info!("[startup] mempool rebroadcast skipped (no gossip channel)"),
    }

    // --- Step 6: REST API ---
    log::info!("[startup] REST API listening on {addr}");

    // --- Step 7: auto-miner (sync gate may defer first mine until caught up) ---
    if crate::consensus::auto_mine_enabled_from_env() {
        let consensus_node_id = config.initial_wallet.trim().to_ascii_lowercase();
        let genesis_validators = crate::genesis::genesis_validators_from_env()?;
        if genesis_validators.is_empty() {
            log::info!("[startup] genesis lists no validators: dev chain, this node mines alone and accepts no peer blocks");
        }
        let validator_set =
            crate::consensus::ValidatorSet::for_local_mining(&genesis_validators, &consensus_node_id);
        let _auto_miner = crate::consensus::spawn_auto_miner(
            state.clone(),
            block_sync_board.clone(),
            consensus_node_id,
            validator_set,
        );
        log::info!("[startup] auto-miner spawned (will wait for sync gate when behind peers)");
    } else {
        log::info!("[startup] auto-miner disabled (TET_AUTO_MINE unset)");
    }

    if crate::worker_daemon::should_start_worker_daemon(&state.ledger, &config.initial_wallet) {
        if let Some(mnemonic) = crate::worker_daemon::worker_daemon_mnemonic_from_env() {
            let _worker_daemon = crate::worker_daemon::spawn_worker_daemon(
                state.clone(),
                config.initial_wallet.trim().to_ascii_lowercase(),
                mnemonic,
            );
        } else {
            log::warn!(
                "[worker-daemon] POC role detected but no TET_WORKER_MNEMONIC/TET_WALLET_MNEMONIC is configured; daemon not started"
            );
        }
    } else {
        log::info!("[worker-daemon] not started: node is not POC or daemon disabled");
    }

    // --- Step 8: block until shutdown ---
    serve(state, addr).await?;
    Ok(())
}
