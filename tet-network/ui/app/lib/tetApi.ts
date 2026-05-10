import { tetCoreUrl } from "./tet_core_http";

export type AuditEvent =
  | { t: "wallet_ready"; walletIdHex: string }
  | { t: "infer_ok"; task_id_hex: string; extrinsic_hash: string }
  | { t: "infer_err"; status: number; message: string };

export type TetCoreInferResponse = {
  logs: string[];
  task_id_hex: string;
  worker_pubkey_hex: string;
  model_id: string;
  input_hash_hex: string;
  output_hash_hex: string;
  nonce: number;
  worker_signature_hex: string;
  mldsa_pubkey_b64: string;
  mldsa_signature_b64: string;
  extrinsic_hash: string;
  ollama_response: string;
}

export async function inferViaTetCore(
  baseUrl: string,
  payload: { model: string; prompt: string; nonce?: number },
): Promise<TetCoreInferResponse> {
  const r = await fetch(tetCoreUrl(baseUrl, "/v0/infer"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`TET-Core infer failed: ${r.status} ${text}`);
  return JSON.parse(text) as TetCoreInferResponse;
}
