use std::{net::SocketAddr, str::FromStr, sync::Arc};

use anyhow::{anyhow, Context as _};
use axum::{
	extract::State,
	http::StatusCode,
	response::IntoResponse,
	routing::{get, post},
	Json, Router,
};
use base64::Engine as _;
use dilithium::{MlDsaKeyPair, ML_DSA_44};
use ed25519_dalek::{Signature as Ed25519Signature, Signer as _, SigningKey as Ed25519SigningKey};
use rand::RngCore as _;
use serde::{Deserialize, Serialize};
use subxt::{config::PolkadotConfig, dynamic::Value, tx::TxStatus, OnlineClient};
use subxt_signer::{sr25519::Keypair as Sr25519Keypair, SecretUri};
use tokio::signal;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt as _, util::SubscriberInitExt as _};

#[derive(Clone)]
struct AppState {
	ollama_url: String,
	chain_ws: String,
	submitter: Sr25519Keypair,
	worker_ed25519: Ed25519SigningKey,
	worker_mldsa: MlDsaKeyPair,
	reqwest: reqwest::Client,
	subxt: OnlineClient<PolkadotConfig>,
}

#[derive(Debug, Deserialize)]
struct InferRequest {
	/// e.g. "llama3:8b"
	model: String,
	prompt: String,
	/// Optional: user-provided nonce for determinism/testing.
	nonce: Option<u64>,
}

#[derive(Debug, Serialize)]
struct InferResponse {
	logs: Vec<String>,
	task_id_hex: String,
	worker_pubkey_hex: String,
	model_id: String,
	input_hash_hex: String,
	output_hash_hex: String,
	nonce: u64,
	worker_signature_hex: String,
	mldsa_pubkey_b64: String,
	mldsa_signature_b64: String,
	extrinsic_hash: String,
	ollama_response: String,
}

#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
	model: String,
	response: String,
	done: bool,
	// ignore extra fields (durations etc.)
}

#[derive(Debug, Serialize)]
struct HealthResponse {
	ok: bool,
	ollama_url: String,
	chain_ws: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	tracing_subscriber::registry()
		.with(tracing_subscriber::EnvFilter::from_default_env().add_directive("info".parse()?))
		.with(tracing_subscriber::fmt::layer())
		.init();

	let ollama_url = std::env::var("TET_OLLAMA_URL").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
	let chain_ws = std::env::var("TET_CHAIN_WS").unwrap_or_else(|_| "ws://127.0.0.1:9944".to_string());

	let submitter_uri = std::env::var("TET_SUBMITTER_URI").unwrap_or_else(|_| "//Alice".to_string());
	let submitter = {
		let suri = SecretUri::from_str(&submitter_uri).context("parse TET_SUBMITTER_URI")?;
		Sr25519Keypair::from_uri(&suri).context("build submitter keypair")?
	};

	let worker_ed25519 = load_ed25519_from_env()?;
	let worker_mldsa = load_mldsa_from_env()?;

	let reqwest = reqwest::Client::builder()
		.timeout(std::time::Duration::from_secs(300))
		.build()
		.context("build reqwest client")?;

	let subxt = OnlineClient::<PolkadotConfig>::from_url(&chain_ws)
		.await
		.context("connect to chain ws")?;

	let state = Arc::new(AppState {
		ollama_url,
		chain_ws,
		submitter,
		worker_ed25519,
		worker_mldsa,
		reqwest,
		subxt,
	});

	let app = Router::new()
		.route("/health", get(health))
		.route("/v0/infer", post(infer))
		.layer(CorsLayer::permissive())
		.layer(TraceLayer::new_for_http())
		.with_state(state);

	let bind = std::env::var("TET_CORE_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
	let addr: SocketAddr = bind.parse().context("parse TET_CORE_BIND")?;

	info!(%addr, "tet-core listening");

	let listener = tokio::net::TcpListener::bind(addr).await?;
	axum::serve(listener, app)
		.with_graceful_shutdown(async {
			let _ = signal::ctrl_c().await;
			warn!("shutdown signal received");
		})
		.await?;

	Ok(())
}

async fn health(State(st): State<Arc<AppState>>) -> impl IntoResponse {
	Json(HealthResponse {
		ok: true,
		ollama_url: st.ollama_url.clone(),
		chain_ws: st.chain_ws.clone(),
	})
}

async fn infer(State(st): State<Arc<AppState>>, Json(req): Json<InferRequest>) -> impl IntoResponse {
	match infer_inner(st, req).await {
		Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
		Err(e) => {
			warn!(error = %e, "infer failed");
			(StatusCode::INTERNAL_SERVER_ERROR, Json(json_error(e))).into_response()
		}
	}
}

#[derive(Serialize)]
struct ErrorBody {
	error: String,
}

fn json_error(e: anyhow::Error) -> ErrorBody {
	ErrorBody { error: format!("{e:#}") }
}

async fn infer_inner(st: Arc<AppState>, req: InferRequest) -> anyhow::Result<InferResponse> {
	let mut logs: Vec<String> = Vec::new();
	logs.push("[TET-CORE] v0.infer: accepted request".to_string());
	logs.push(format!("[TET-CORE] ollama_url={}", st.ollama_url));
	logs.push(format!("[TET-CORE] chain_ws={}", st.chain_ws));

	// 1) Call Ollama (pure execution).
	logs.push(format!("[OLLAMA] POST /api/generate model=\"{}\" stream=false", req.model));
	let ollama = ollama_generate(&st.reqwest, &st.ollama_url, &req.model, &req.prompt).await?;
	if !ollama.done {
		return Err(anyhow!("ollama returned done=false with stream disabled"));
	}
	logs.push("[OLLAMA] done=true (response received)".to_string());

	let nonce = req.nonce.unwrap_or_else(|| {
		let mut b = [0u8; 8];
		rand::rngs::OsRng.fill_bytes(&mut b);
		u64::from_le_bytes(b)
	});
	logs.push(format!("[RECEIPT] nonce={nonce}"));

	// 2) Build receipt fields.
	let model_id_bytes = req.model.as_bytes().to_vec();
	let input_hash = sp_core::hashing::blake2_256(req.prompt.as_bytes());
	let output_hash = sp_core::hashing::blake2_256(ollama.response.as_bytes());
	logs.push(format!("[RECEIPT] input_hash=0x{}", hex::encode(input_hash)));
	logs.push(format!("[RECEIPT] output_hash=0x{}", hex::encode(output_hash)));

	let task_id = {
		let mut v = Vec::with_capacity(128);
		v.extend_from_slice(b"TET::TASK::V0");
		v.extend_from_slice(&input_hash);
		v.extend_from_slice(&output_hash);
		v.extend_from_slice(&nonce.to_le_bytes());
		sp_core::H256::from(sp_core::hashing::blake2_256(&v))
	};
	logs.push(format!("[RECEIPT] task_id=0x{}", hex::encode(task_id.as_bytes())));

	let worker_pubkey = st.worker_ed25519.verifying_key().to_bytes(); // [u8; 32]
	logs.push(format!("[ED25519] pubkey=0x{}", hex::encode(worker_pubkey)));

	// 3) Canonical message hash (must match pallet).
	let msg = receipt_signing_message(
		&task_id,
		&worker_pubkey,
		&model_id_bytes,
		&input_hash,
		&output_hash,
		nonce,
	);
	logs.push(format!("[RECEIPT] signing_message=0x{}", hex::encode(msg)));

	// 4) Real Ed25519 signature.
	let ed_sig: Ed25519Signature = st.worker_ed25519.sign(&msg);
	let worker_signature = ed_sig.to_bytes().to_vec(); // 64 bytes
	logs.push("[ED25519] signature generated (64 bytes)".to_string());

	// 5) Real ML-DSA-44 signature.
	logs.push("[ML-DSA-44] signing...".to_string());
	let mldsa_sig = st
		.worker_mldsa
		.sign(&msg, b"")
		.context("mldsa sign")?;
	let mldsa_pubkey_tagged = st.worker_mldsa.public_key_bytes(); // [mode_tag|pk]
	logs.push(format!("[ML-DSA-44] pubkey_tagged_len={}", mldsa_pubkey_tagged.len()));
	logs.push(format!("[ML-DSA-44] signature_len={}", mldsa_sig.as_bytes().len()));

	// 6) Send extrinsic via subxt dynamic.
	logs.push("[SUBXT] building extrinsic TetCore.submit_inference_receipt".to_string());
	let tx_hash = submit_inference_receipt_via_subxt(
		&st.subxt,
		&st.submitter,
		task_id,
		worker_pubkey,
		model_id_bytes.clone(),
		input_hash,
		output_hash,
		nonce,
		worker_signature.clone(),
		mldsa_pubkey_tagged.clone(),
		mldsa_sig.as_bytes().to_vec(),
	)
	.await
	.context("submit extrinsic")?;
	logs.push(format!("[SUBXT] extrinsic submitted hash={tx_hash}"));

	Ok(InferResponse {
		logs,
		task_id_hex: hex::encode(task_id.as_bytes()),
		worker_pubkey_hex: hex::encode(worker_pubkey),
		model_id: req.model,
		input_hash_hex: hex::encode(input_hash),
		output_hash_hex: hex::encode(output_hash),
		nonce,
		worker_signature_hex: hex::encode(worker_signature),
		mldsa_pubkey_b64: base64::engine::general_purpose::STANDARD.encode(mldsa_pubkey_tagged),
		mldsa_signature_b64: base64::engine::general_purpose::STANDARD.encode(mldsa_sig.as_bytes()),
		extrinsic_hash: tx_hash,
		ollama_response: ollama.response,
	})
}

async fn ollama_generate(
	client: &reqwest::Client,
	ollama_url: &str,
	model: &str,
	prompt: &str,
) -> anyhow::Result<OllamaGenerateResponse> {
	let url = format!("{}/api/generate", ollama_url.trim_end_matches('/'));
	let body = serde_json::json!({
		"model": model,
		"prompt": prompt,
		"stream": false,
	});

	let res = client
		.post(url)
		.json(&body)
		.send()
		.await
		.context("ollama request")?;

	let status = res.status();
	let bytes = res.bytes().await.context("read ollama response body")?;
	if !status.is_success() {
		return Err(anyhow!(
			"ollama error status={} body={}",
			status,
			String::from_utf8_lossy(&bytes)
		));
	}

	let parsed: OllamaGenerateResponse =
		serde_json::from_slice(&bytes).context("parse ollama JSON response")?;
	Ok(parsed)
}

fn receipt_signing_message(
	task_id: &sp_core::H256,
	worker_pubkey: &[u8; 32],
	model_id: &[u8],
	input_hash: &[u8; 32],
	output_hash: &[u8; 32],
	nonce: u64,
) -> [u8; 32] {
	let mut v = Vec::with_capacity(64 + model_id.len());
	v.extend_from_slice(b"TET::INFERENCE_RECEIPT::V0");
	v.extend_from_slice(task_id.as_bytes());
	v.extend_from_slice(worker_pubkey);
	v.extend_from_slice(model_id);
	v.extend_from_slice(input_hash);
	v.extend_from_slice(output_hash);
	v.extend_from_slice(&nonce.to_le_bytes());
	sp_core::hashing::blake2_256(&v)
}

async fn submit_inference_receipt_via_subxt(
	client: &OnlineClient<PolkadotConfig>,
	submitter: &Sr25519Keypair,
	task_id: sp_core::H256,
	worker_pubkey: [u8; 32],
	model_id: Vec<u8>,
	input_hash: [u8; 32],
	output_hash: [u8; 32],
	nonce: u64,
	worker_signature: Vec<u8>,
	mldsa_pubkey: Vec<u8>,
	mldsa_signature: Vec<u8>,
) -> anyhow::Result<String> {
	let tx = subxt::dynamic::tx(
		"TetCore",
		"submit_inference_receipt",
		vec![
			Value::from_bytes(task_id.as_bytes()),
			Value::from_bytes(worker_pubkey),
			Value::from_bytes(model_id),
			Value::from_bytes(input_hash),
			Value::from_bytes(output_hash),
			Value::from(nonce),
			Value::from_bytes(worker_signature),
			Value::from_bytes(mldsa_pubkey),
			Value::from_bytes(mldsa_signature),
		],
	);

	let progress = client
		.tx()
		.sign_and_submit_then_watch_default(&tx, submitter)
		.await
		.context("submit+watch")?;

	let mut progress = progress;
	loop {
		let evt = progress
			.next()
			.await
			.ok_or_else(|| anyhow!("tx progress stream ended unexpectedly"))??;
		match evt {
			TxStatus::InBestBlock(info) => {
				let hash = info.extrinsic_hash();
				return Ok(format!("{hash:?}"));
			}
			TxStatus::InFinalizedBlock(info) => {
				let hash = info.extrinsic_hash();
				return Ok(format!("{hash:?}"));
			}
			TxStatus::Dropped { message } => return Err(anyhow!("tx dropped: {message}")),
			TxStatus::Invalid { message } => return Err(anyhow!("tx invalid: {message}")),
			TxStatus::Error { message } => return Err(anyhow!("tx error: {message}")),
			_ => {}
		}
	}
}

fn load_ed25519_from_env() -> anyhow::Result<Ed25519SigningKey> {
	// Prefer explicit secret seed.
	if let Ok(hex_seed) = std::env::var("TET_WORKER_ED25519_SEED_HEX") {
		let bytes = hex::decode(hex_seed.trim()).context("decode TET_WORKER_ED25519_SEED_HEX")?;
		let seed: [u8; 32] = bytes
			.as_slice()
			.try_into()
			.map_err(|_| anyhow!("TET_WORKER_ED25519_SEED_HEX must be 32 bytes hex"))?;
		return Ok(Ed25519SigningKey::from_bytes(&seed));
	}

	// Or base64 seed.
	if let Ok(b64_seed) = std::env::var("TET_WORKER_ED25519_SEED_B64") {
		let bytes = base64::engine::general_purpose::STANDARD
			.decode(b64_seed.trim())
			.context("decode TET_WORKER_ED25519_SEED_B64")?;
		let seed: [u8; 32] = bytes
			.as_slice()
			.try_into()
			.map_err(|_| anyhow!("TET_WORKER_ED25519_SEED_B64 must be 32 bytes"))?;
		return Ok(Ed25519SigningKey::from_bytes(&seed));
	}

	Err(anyhow!(
		"missing worker Ed25519 seed. Set TET_WORKER_ED25519_SEED_HEX (64 hex chars) or TET_WORKER_ED25519_SEED_B64 (32 bytes)."
	))
}

fn load_mldsa_from_env() -> anyhow::Result<MlDsaKeyPair> {
	// Hex-encoded keypair bytes, format produced by dilithium-rs `to_bytes()`: [mode_tag|pk|sk]
	if let Ok(hex_kp) = std::env::var("TET_WORKER_MLDSA_KEYPAIR_HEX") {
		let bytes = hex::decode(hex_kp.trim()).context("decode TET_WORKER_MLDSA_KEYPAIR_HEX")?;
		let kp = MlDsaKeyPair::from_bytes(&bytes).context("parse ML-DSA keypair bytes")?;
		if kp.mode() != ML_DSA_44 {
			return Err(anyhow!("ML-DSA keypair mode must be ML-DSA-44 for Phase 0"));
		}
		return Ok(kp);
	}

	// Base64-encoded keypair bytes
	if let Ok(b64_kp) = std::env::var("TET_WORKER_MLDSA_KEYPAIR_B64") {
		let bytes = base64::engine::general_purpose::STANDARD
			.decode(b64_kp.trim())
			.context("decode TET_WORKER_MLDSA_KEYPAIR_B64")?;
		let kp = MlDsaKeyPair::from_bytes(&bytes).context("parse ML-DSA keypair bytes")?;
		if kp.mode() != ML_DSA_44 {
			return Err(anyhow!("ML-DSA keypair mode must be ML-DSA-44 for Phase 0"));
		}
		return Ok(kp);
	}

	Err(anyhow!(
		"missing worker ML-DSA keypair. Set TET_WORKER_MLDSA_KEYPAIR_HEX or TET_WORKER_MLDSA_KEYPAIR_B64 (format: dilithium-rs to_bytes())."
	))
}

