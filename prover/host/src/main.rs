//! HTTP Prover Daemon: `POST /prove`（送金）、`POST /prove_ai`（AI 推論の指紋）→ zkVM guest、`Receipt` を Borsh + hex で返す。

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tet_prover_methods::{
    TET_AI_INFERENCE_GUEST_ELF, TET_AI_INFERENCE_GUEST_ID, TET_TRANSFER_GUEST_ELF,
    TET_TRANSFER_GUEST_ID,
};
use tower_http::cors::{Any, CorsLayer};

/// Must match `tet_transfer_guest::TransferProveInput` (serde layout).
#[derive(Debug, Serialize, Deserialize)]
pub struct ProveRequest {
    pub dest: String,
    pub value: String,
    pub memo: String,
}

/// Must match `tet_ai_inference_guest::AiInferenceInput` (serde layout).
#[derive(Debug, Serialize, Deserialize)]
pub struct ProveAiRequest {
    pub prompt: String,
    pub response: String,
}

#[derive(Debug, Serialize)]
struct ProveResponseOk {
    receipt_borsh_hex: String,
    image_id_hex: String,
}

#[derive(Debug, Serialize)]
struct ProveResponseErr {
    error: String,
}

struct AppState {
    transfer_image_id_hex: String,
    ai_inference_image_id_hex: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port: u16 = std::env::var("PROVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(9945);

    let transfer_image_id_hex: String = TET_TRANSFER_GUEST_ID
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .map(|b| format!("{b:02x}"))
        .collect();
    let ai_inference_image_id_hex: String = TET_AI_INFERENCE_GUEST_ID
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .map(|b| format!("{b:02x}"))
        .collect();

    let state = Arc::new(AppState {
        transfer_image_id_hex,
        ai_inference_image_id_hex,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/prove", post(prove_handler))
        .route("/prove_ai", post(prove_ai_handler))
        .route("/health", get(health_handler))
        .route("/image_id", get(image_id_handler))
        .layer(cors)
        .with_state(state);

    let bind = format!("127.0.0.1:{port}");
    eprintln!("tet-prover-host listening on http://{bind} (POST /prove, POST /prove_ai)");
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

async fn image_id_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "transfer_image_id_hex": state.transfer_image_id_hex,
        "ai_inference_image_id_hex": state.ai_inference_image_id_hex,
    }))
}

async fn prove_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ProveRequest>,
) -> Response {
    if TET_TRANSFER_GUEST_ELF.is_empty() {
        return json_err(
            StatusCode::SERVICE_UNAVAILABLE,
            "Guest ELF empty — build without RISC0_SKIP_BUILD=1",
        );
    }

    let env = match ExecutorEnv::builder().write(&body) {
        Ok(b) => match b.build() {
            Ok(e) => e,
            Err(e) => {
                return json_err(StatusCode::BAD_REQUEST, &format!("executor env build: {e}"))
            }
        },
        Err(e) => return json_err(StatusCode::BAD_REQUEST, &format!("executor env write: {e}")),
    };

    let receipt = match default_prover().prove(env, TET_TRANSFER_GUEST_ELF) {
        Ok(info) => info.receipt,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("prove: {e}")),
    };

    if let Err(e) = receipt.verify(TET_TRANSFER_GUEST_ID) {
        return json_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("local verify: {e}"),
        );
    }

    let receipt_bytes = match borsh::to_vec(&receipt) {
        Ok(b) => b,
        Err(e) => {
            return json_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("borsh receipt: {e}"),
            )
        }
    };

    let receipt_borsh_hex = format!("0x{}", hex::encode(receipt_bytes));

    (
        StatusCode::OK,
        Json(ProveResponseOk {
            receipt_borsh_hex,
            image_id_hex: state.transfer_image_id_hex.clone(),
        }),
    )
        .into_response()
}

async fn prove_ai_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ProveAiRequest>,
) -> Response {
    if TET_AI_INFERENCE_GUEST_ELF.is_empty() {
        return json_err(
            StatusCode::SERVICE_UNAVAILABLE,
            "AI guest ELF empty — build without RISC0_SKIP_BUILD=1",
        );
    }

    let env = match ExecutorEnv::builder().write(&body) {
        Ok(b) => match b.build() {
            Ok(e) => e,
            Err(e) => {
                return json_err(StatusCode::BAD_REQUEST, &format!("executor env build: {e}"))
            }
        },
        Err(e) => return json_err(StatusCode::BAD_REQUEST, &format!("executor env write: {e}")),
    };

    let receipt = match default_prover().prove(env, TET_AI_INFERENCE_GUEST_ELF) {
        Ok(info) => info.receipt,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("prove: {e}")),
    };

    if let Err(e) = receipt.verify(TET_AI_INFERENCE_GUEST_ID) {
        return json_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("local verify: {e}"),
        );
    }

    let receipt_bytes = match borsh::to_vec(&receipt) {
        Ok(b) => b,
        Err(e) => {
            return json_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("borsh receipt: {e}"),
            )
        }
    };

    let receipt_borsh_hex = format!("0x{}", hex::encode(receipt_bytes));

    (
        StatusCode::OK,
        Json(ProveResponseOk {
            receipt_borsh_hex,
            image_id_hex: state.ai_inference_image_id_hex.clone(),
        }),
    )
        .into_response()
}

fn json_err(code: StatusCode, msg: &str) -> Response {
    let body = ProveResponseErr {
        error: msg.to_string(),
    };
    (code, Json(body)).into_response()
}
