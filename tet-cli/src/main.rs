use anyhow::{Context as _, Result};
use base64::Engine as _;
use clap::{Parser, Subcommand};
use ed25519_dalek::Signer as _;
use reqwest::StatusCode;
use sha2::Digest as _;
use std::path::Path;
use std::time::Duration;

const STEVEMON_F64: f64 = 1_000_000.0;

fn url_join(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn red_bold() -> &'static str {
    "\x1b[1;31m"
}
fn green_bold() -> &'static str {
    "\x1b[1;32m"
}
fn reset() -> &'static str {
    "\x1b[0m"
}

async fn http_text_or_error(r: reqwest::Response) -> Result<(StatusCode, String)> {
    let status = r.status();
    let body = r.text().await.unwrap_or_default();
    Ok((status, body))
}

async fn fetch_next_nonce(http: &reqwest::Client, base: &str, wallet_id: &str) -> Result<u64> {
    let url = url_join(base, format!("/wallet/nonce/{wallet_id}").as_str());
    let r = http
        .get(url.clone())
        .send()
        .await
        .with_context(|| format!("failed to GET {url}"))?;
    let (status, body) = http_text_or_error(r).await?;
    if !status.is_success() {
        anyhow::bail!("nonce lookup HTTP {}: {}", status.as_u16(), body.trim());
    }
    let v: serde_json::Value = serde_json::from_str(&body)
        .with_context(|| format!("invalid nonce JSON: {}", body.trim()))?;
    Ok(v.get("next_nonce").and_then(|x| x.as_u64()).unwrap_or(1))
}

async fn print_ledger_state(http: &reqwest::Client, base: &str) -> Result<()> {
    let url = url_join(base, "/ledger/state");
    let r = http
        .get(url.clone())
        .send()
        .await
        .with_context(|| format!("failed to GET {url}"))?;
    let (status, body) = http_text_or_error(r).await?;
    if !status.is_success() {
        anyhow::bail!("node status HTTP {}: {}", status.as_u16(), body.trim());
    }
    let v: serde_json::Value = serde_json::from_str(&body)
        .with_context(|| format!("invalid JSON from {url}: {}", body.trim()))?;
    let bh = v.get("block_height").and_then(|x| x.as_u64()).unwrap_or(0);
    let mp = v.get("mempool_len").and_then(|x| x.as_u64()).unwrap_or(0);
    let sr = v.get("state_root").and_then(|x| x.as_str()).unwrap_or("");

    println!("Node: {}", base);
    println!("Block Height: {}", bh);
    println!("Mempool: {} pending", mp);
    println!("State Root: {}", sr);
    Ok(())
}

async fn admin_mine_and_print_status(http: &reqwest::Client, base: &str) -> Result<()> {
    let api_key = std::env::var("TET_ADMIN_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .context("TET_ADMIN_API_KEY is not set (required for mining)")?;

    let url = url_join(base, "/ledger/mine");
    let r = http
        .post(url.clone())
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .send()
        .await
        .with_context(|| format!("failed to POST {url}"))?;
    let (status, body) = http_text_or_error(r).await?;
    if !status.is_success() {
        anyhow::bail!("mine HTTP {}: {}", status.as_u16(), body.trim());
    }
    let v: serde_json::Value = serde_json::from_str(&body)
        .with_context(|| format!("invalid JSON from {url}: {}", body.trim()))?;
    let mined = v.get("mined").and_then(|x| x.as_bool()).unwrap_or(false);
    let bh = v.get("block_height").and_then(|x| x.as_u64()).unwrap_or(0);
    let tx_count = v.get("tx_count").and_then(|x| x.as_u64()).unwrap_or(0);
    let state_root = v.get("state_root").and_then(|x| x.as_str()).unwrap_or("");

    if mined {
        println!("{}Block mined.{}", green_bold(), reset());
        println!("block_height: {}", bh);
        println!("tx_count: {}", tx_count);
        println!("state_root: {}", state_root);
    } else {
        println!("Mine completed. block_height={bh} tx_count={tx_count}");
    }

    println!();
    println!("--- node status (post-mine) ---");
    print_ledger_state(http, base).await?;
    Ok(())
}

#[derive(Debug, Parser)]
#[command(name = "tet", version, about = "TET developer CLI (tet-cli)")]
struct Cli {
    /// Target node base URL (REST).
    #[arg(long, default_value = "http://localhost:8010", global = true)]
    node_url: String,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Keys {
        #[command(subcommand)]
        action: KeysAction,
    },
    Node {
        #[command(subcommand)]
        action: NodeAction,
    },
    Tx {
        #[command(subcommand)]
        action: TxAction,
    },
    Zk {
        #[command(subcommand)]
        action: ZkAction,
    },
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
}

#[derive(Debug, Subcommand)]
enum KeysAction {
    /// Placeholder: key management commands will live here.
    Dummy,
    /// Generate a new mnemonic + wallet address (non-custodial).
    Generate {
        /// Mnemonic word count (12 or 24).
        #[arg(long, default_value_t = 24)]
        words: u16,
    },
}

#[derive(Debug, Subcommand)]
enum NodeAction {
    /// Fetch node ledger state (height, mempool, state root).
    Status,
}

#[derive(Debug, Subcommand)]
enum TxAction {
    /// Send a signed transfer transaction.
    Send {
        to_address: String,
        amount_tet: f64,
        /// Mnemonic phrase (12/24 words). Wrap in quotes.
        #[arg(long)]
        mnemonic: String,
        /// Fee bps (currently accepted but not used in phase2 spend check).
        #[arg(long, default_value_t = 0)]
        fee_bps: u64,

        /// Auto-mine a block after this tx is accepted (God Mode).
        #[arg(long)]
        mine: bool,
    },
}

#[derive(Debug, Subcommand)]
enum ZkAction {
    /// Placeholder: ZK proof helpers will live here.
    Dummy,
    /// Verify a RISC Zero receipt and enqueue into mempool.
    Verify {
        receipt_path: String,
        /// Auto-mine a block after this proof is accepted (God Mode).
        #[arg(long)]
        mine: bool,
    },
}

#[derive(Debug, Subcommand)]
enum AdminAction {
    /// Grant test funds to an address using admin faucet.
    Faucet {
        address: String,
        /// Faucet amount in TET (human units). Default: 100.
        #[arg(long)]
        amount_tet: Option<f64>,
    },
    /// Mine a block from the mempool (admin-only).
    Mine,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Touch tet-core types to ensure path dependency is wired.
    let _type_smoke: Option<tet_core::protocol::SignedTxEnvelopeV1> = None;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .context("failed to build HTTP client")?;

    match cli.command {
        Command::Keys { action } => match action {
            KeysAction::Generate { words } => {
                let wi = tet_core::wallet::generate_new_wallet(words)?;
                let mnemonic = wi.mnemonic_12.as_deref().unwrap_or("<missing mnemonic>");

                println!();
                println!("==================== TET WALLET GENERATED ====================");
                println!("Public Address (ed25519 vk, hex):");
                println!("{}", wi.address_hex);
                println!();
                println!("ML-DSA Public Key (base64):");
                println!("{}", wi.dilithium_pubkey_b64);
                println!();
                println!("Mnemonic (DO NOT SHARE):");
                println!(
                    "{}NEVER SHARE THIS MNEMONIC. ANYONE WITH IT CAN STEAL YOUR FUNDS.{}",
                    red_bold(),
                    reset()
                );
                println!("{}", mnemonic);
                println!("==============================================================");
                println!();
            }
            other => {
                println!(
                    "Executing command... node_url={} action={:?}",
                    cli.node_url, other
                );
            }
        },
        Command::Node { action } => match action {
            NodeAction::Status => {
                let base = cli.node_url.trim_end_matches('/');

                let url = url_join(base, "/ledger/state");
                let r = http
                    .get(url.clone())
                    .send()
                    .await
                    .with_context(|| format!("failed to GET {url}"))?;
                let (status, body) = http_text_or_error(r).await?;

                if status == StatusCode::NOT_FOUND {
                    let url2 = url_join(base, "/network/stats");
                    let r2 = http
                        .get(url2.clone())
                        .send()
                        .await
                        .with_context(|| format!("failed to GET {url2}"))?;
                    let (s2, b2) = http_text_or_error(r2).await?;
                    if !s2.is_success() {
                        anyhow::bail!(
                            "node status: /ledger/state returned 404; /network/stats HTTP {}: {}",
                            s2.as_u16(),
                            b2.trim()
                        );
                    }
                    let v2: serde_json::Value = serde_json::from_str(&b2)
                        .with_context(|| format!("invalid JSON from {url2}: {}", b2.trim()))?;
                    let consensus_h = v2
                        .get("consensus_block_height")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let active_workers = v2
                        .get("active_worker_nodes")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let total_supply_micro = v2
                        .get("total_supply_micro")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);

                    println!("Node: {}", base);
                    println!("Consensus Block Height: {}", consensus_h);
                    println!("Active Workers: {}", active_workers);
                    println!("Total Supply (micro-TET): {}", total_supply_micro);
                    println!(
                        "{}Note:{} /ledger/state not available on this node; State Root / mempool size not reported.",
                        red_bold(),
                        reset()
                    );
                    return Ok(());
                }

                if !status.is_success() {
                    anyhow::bail!("node status HTTP {}: {}", status.as_u16(), body.trim());
                }
                let v: serde_json::Value = serde_json::from_str(&body)
                    .with_context(|| format!("invalid JSON from {url}: {}", body.trim()))?;
                let bh = v.get("block_height").and_then(|x| x.as_u64()).unwrap_or(0);
                let mp = v.get("mempool_len").and_then(|x| x.as_u64()).unwrap_or(0);
                let sr = v.get("state_root").and_then(|x| x.as_str()).unwrap_or("");

                println!("Node: {}", base);
                println!("Block Height: {}", bh);
                println!("Mempool: {} pending", mp);
                println!("State Root: {}", sr);
            }
        },
        Command::Tx { action } => {
            match action {
                TxAction::Send {
                    to_address,
                    amount_tet,
                    mnemonic,
                    fee_bps,
                    mine,
                } => {
                    if !amount_tet.is_finite() || amount_tet <= 0.0 {
                        anyhow::bail!("amount must be a positive number (TET)");
                    }
                    let amount_micro = (amount_tet * STEVEMON_F64).round().max(0.0) as u64;
                    if amount_micro == 0 {
                        anyhow::bail!("amount too small (rounded to 0 micro-TET)");
                    }

                    let wi = tet_core::wallet::recover_from_mnemonic_12(mnemonic.trim())
                        .context("invalid mnemonic")?;
                    let from_wallet = wi.address_hex;
                    let base = cli.node_url.trim_end_matches('/');
                    let next_nonce = fetch_next_nonce(&http, base, &from_wallet)
                        .await
                        .unwrap_or(1);

                    // Build tx.
                    let tx = tet_core::protocol::TxV1::Transfer {
                        from_wallet: from_wallet.clone(),
                        to_wallet: to_address.trim().to_ascii_lowercase(),
                        amount_micro,
                        fee_bps,
                    };
                    let tx_bytes = serde_json::to_vec(&tx).context("tx serialization failed")?;

                    // Sign (Ed25519: base64 sig over tx_bytes).
                    let sk = tet_core::wallet::ed25519_signing_key_from_mnemonic(mnemonic.trim())
                        .context("failed to derive ed25519 signing key")?;
                    let ed_sig = sk.sign(&tx_bytes);
                    let ed_sig_b64 =
                        base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes());

                    // Sign (ML-DSA: deterministic base64 sig over tx_bytes).
                    let mldsa_kp = tet_core::wallet::mldsa_keypair_from_mnemonic(mnemonic.trim())
                        .context("failed to derive ML-DSA keypair")?;
                    let mldsa_sig_bytes =
                        tet_core::wallet::mldsa_sign_deterministic(&mldsa_kp, &tx_bytes)
                            .context("ML-DSA signing failed")?;
                    let mldsa_sig_b64 =
                        base64::engine::general_purpose::STANDARD.encode(mldsa_sig_bytes);

                    let env = tet_core::protocol::SignedTxEnvelopeV1 {
                        v: 1,
                        tx,
                        sig: tet_core::protocol::HybridSigV1 {
                            ed25519_pubkey_hex: from_wallet.clone(),
                            ed25519_sig_b64: ed_sig_b64,
                            mldsa_pubkey_b64: wi.dilithium_pubkey_b64,
                            mldsa_sig_b64,
                        },
                        // In non-strict/dev mode, attestation is not required.
                        attestation: tet_core::protocol::AttestationV1 {
                            platform: String::new(),
                            report_b64: String::new(),
                        },
                    };

                    let txid = format!("0x{}", hex::encode(sha2::Sha256::digest(&tx_bytes)));
                    let url = url_join(base, "/ledger/transfer");
                    let r = http
                        .post(url.clone())
                        .json(&env)
                        .send()
                        .await
                        .with_context(|| format!("failed to POST {url}"))?;
                    let status = r.status();
                    let body = r.text().await.unwrap_or_default();

                    if status == StatusCode::ACCEPTED {
                        println!("{}Transaction sent to mempool.{}", green_bold(), reset());
                        println!("txid: {}", txid);
                        println!("from: {}", from_wallet);
                        println!("to:   {}", to_address.trim());
                        println!("amount_tet: {}", amount_tet);
                        println!("next_nonce (auto): {}", next_nonce);
                        if !body.trim().is_empty() {
                            println!("node_response: {}", body.trim());
                        }

                        if mine {
                            println!();
                            println!("--- auto mine (God Mode) ---");
                            admin_mine_and_print_status(&http, base).await?;
                        }
                    } else if status.is_success() {
                        // Unexpected success code but not 202.
                        println!(
                            "{}Transaction submitted (HTTP {}).{}",
                            green_bold(),
                            status.as_u16(),
                            reset()
                        );
                        println!("txid: {}", txid);
                        println!("node_response: {}", body.trim());
                    } else {
                        anyhow::bail!("transfer HTTP {}: {}", status.as_u16(), body.trim());
                    }
                }
            }
        }
        Command::Zk { action } => {
            match action {
                ZkAction::Verify { receipt_path, mine } => {
                    let base = cli.node_url.trim_end_matches('/');
                    let p = Path::new(receipt_path.trim());
                    let bytes = std::fs::read(p)
                        .with_context(|| format!("failed to read receipt file: {}", p.display()))?;

                    // Support dev-mode mock receipts by passing through UTF-8 starting with "MOCKJ1:".
                    let receipt_b64 = match std::str::from_utf8(&bytes) {
                        Ok(s) if s.trim_start().starts_with("MOCKJ1:") => s.trim().to_string(),
                        _ => base64::engine::general_purpose::STANDARD.encode(&bytes),
                    };

                    // Journal is best-effort; empty is allowed (server only attempts parse).
                    let journal_b64 = base64::engine::general_purpose::STANDARD.encode([]);
                    let image_id = methods::NEXUS_GUEST_ID;

                    // Create a signed envelope so tet-core accepts it (non-strict/dev: empty attestation ok).
                    let wi = tet_core::wallet::generate_new_wallet(12)?;
                    let mnemonic = wi.mnemonic_12.clone().unwrap_or_default();

                    let tx = tet_core::protocol::TxV1::VerifyZkProof {
                        image_id,
                        journal_b64,
                        receipt_b64,
                    };
                    let tx_bytes = serde_json::to_vec(&tx).context("tx serialization failed")?;

                    let sk = tet_core::wallet::ed25519_signing_key_from_mnemonic(mnemonic.trim())
                        .context("failed to derive ed25519 signing key")?;
                    let ed_sig = sk.sign(&tx_bytes);
                    let ed_sig_b64 =
                        base64::engine::general_purpose::STANDARD.encode(ed_sig.to_bytes());

                    let mldsa_kp = tet_core::wallet::mldsa_keypair_from_mnemonic(mnemonic.trim())
                        .context("failed to derive ML-DSA keypair")?;
                    let mldsa_sig_bytes =
                        tet_core::wallet::mldsa_sign_deterministic(&mldsa_kp, &tx_bytes)
                            .context("ML-DSA signing failed")?;
                    let mldsa_sig_b64 =
                        base64::engine::general_purpose::STANDARD.encode(mldsa_sig_bytes);

                    let env = tet_core::protocol::SignedTxEnvelopeV1 {
                        v: 1,
                        tx,
                        sig: tet_core::protocol::HybridSigV1 {
                            ed25519_pubkey_hex: wi.address_hex,
                            ed25519_sig_b64: ed_sig_b64,
                            mldsa_pubkey_b64: wi.dilithium_pubkey_b64,
                            mldsa_sig_b64,
                        },
                        attestation: tet_core::protocol::AttestationV1 {
                            platform: String::new(),
                            report_b64: String::new(),
                        },
                    };

                    let url = url_join(base, "/ledger/zk_verify");
                    let r = http
                        .post(url.clone())
                        .json(&env)
                        .send()
                        .await
                        .with_context(|| format!("failed to POST {url}"))?;
                    let (status, body) = http_text_or_error(r).await?;
                    if status == StatusCode::ACCEPTED {
                        println!(
                            "{}ZK Proof verified and added to mempool.{}",
                            green_bold(),
                            reset()
                        );
                        if !body.trim().is_empty() {
                            println!("node_response: {}", body.trim());
                        }
                        if mine {
                            println!();
                            println!("--- auto mine (God Mode) ---");
                            admin_mine_and_print_status(&http, base).await?;
                        }
                    } else if status.is_success() {
                        println!(
                            "{}ZK Proof submitted (HTTP {}).{}",
                            green_bold(),
                            status.as_u16(),
                            reset()
                        );
                        println!("node_response: {}", body.trim());
                    } else {
                        anyhow::bail!("zk verify HTTP {}: {}", status.as_u16(), body.trim());
                    }
                }
                other => {
                    println!(
                        "Executing command... node_url={} action={:?}",
                        cli.node_url, other
                    );
                }
            }
        }
        Command::Admin { action } => match action {
            AdminAction::Faucet {
                address,
                amount_tet,
            } => {
                let api_key = std::env::var("TET_ADMIN_API_KEY")
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .context("TET_ADMIN_API_KEY is not set (required for admin faucet)")?;

                let base = cli.node_url.trim_end_matches('/');
                let url = url_join(base, "/ledger/faucet");
                let payload = serde_json::json!({
                    "wallet_id": address.trim(),
                    "amount_tet": amount_tet,
                });
                let r = http
                    .post(url.clone())
                    .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
                    .json(&payload)
                    .send()
                    .await
                    .with_context(|| format!("failed to POST {url}"))?;
                let status = r.status();
                let body = r.text().await.unwrap_or_default();
                if !status.is_success() {
                    anyhow::bail!("faucet HTTP {}: {}", status.as_u16(), body.trim());
                }
                println!(
                    "{}Faucet succeeded.{} {}",
                    green_bold(),
                    reset(),
                    body.trim()
                );
            }
            AdminAction::Mine => {
                let base = cli.node_url.trim_end_matches('/');
                admin_mine_and_print_status(&http, base).await?;
            }
        },
    }

    Ok(())
}
