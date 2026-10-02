/**
 * Byte-for-byte match: tet-core `wallet::ai_infer_hybrid_auth_message_bytes` and
 * `tet-network/ui/app/lib/ai_infer_hybrid.ts`.
 */
import { createHash } from "node:crypto";
import { mldsa44SignDeterministic } from "./pqc_wasm.js";
import { u8ToStdBase64 } from "./encoding.js";
import type { HybridKeyMaterial } from "./types.js";
import { tetSign, type TetChainBinding } from "./agent.js";

export async function aiInferHybridAuthMessageBytes(
  walletIdHex64: string,
  promptTrimmed: string,
  flops: bigint,
  nonce: bigint,
): Promise<Uint8Array> {
  const w = walletIdHex64.trim().toLowerCase();
  const ph = createHash("sha256").update(promptTrimmed, "utf8").digest("hex");
  const line = `tet ai infer hybrid v1|${w}|${flops.toString()}|${nonce.toString()}|${ph}`;
  return new TextEncoder().encode(line);
}

export function flopsBigIntToJsonNumber(flops: bigint): number {
  if (flops <= 0n) throw new Error("flops must be positive");
  if (flops > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("flops exceeds JS safe integer");
  }
  return Number(flops);
}

/**
 * The four hybrid headers, from an already-computed signature.
 *
 * One implementation, shared by the AI-infer path and the agent-payload path, so the header names
 * cannot drift apart between them. The two paths sign DIFFERENT pre-images — `tet ai infer hybrid v1`
 * versus `tet agent payload v1` — so a signature made for one can never be replayed as the other
 * even though the headers look identical on the wire. That is domain separation doing its job, not a
 * coincidence to rely on quietly.
 */
export function hybridSigHeaders(sig: {
  ed25519_pubkey_hex: string;
  ed25519_sig_b64: string;
  mldsa_pubkey_b64: string;
  mldsa_sig_b64: string;
}): Record<string, string> {
  return {
    "x-tet-ed25519-pubkey-hex": sig.ed25519_pubkey_hex,
    "x-tet-ed25519-sig-b64": sig.ed25519_sig_b64,
    "x-tet-mldsa-pubkey-b64": sig.mldsa_pubkey_b64,
    "x-tet-mldsa-sig-b64": sig.mldsa_sig_b64,
  };
}

export async function buildAiInferHybridHeaders(
  k: HybridKeyMaterial,
  promptTrimmed: string,
  flops: bigint,
  nonce: bigint,
): Promise<Record<string, string>> {
  const w = k.walletIdHex64.trim().toLowerCase();
  const msg = await aiInferHybridAuthMessageBytes(w, promptTrimmed, flops, nonce);
  return hybridSigHeaders({
    ed25519_pubkey_hex: k.walletIdHex64,
    ed25519_sig_b64: u8ToStdBase64(k.signEd25519(msg)),
    mldsa_pubkey_b64: k.mldsa44PubkeyB64,
    mldsa_sig_b64: await mldsa44SignDeterministic(k.mldsa44KeypairB64, msg),
  });
}

/**
 * Inline signature headers for an agent payload — the transport for messages and HTTP bodies, as
 * opposed to the detached `.sig.json` used for files.
 *
 * `x-tet-agent-payload-type` is what a receiver needs in order to rebuild the pre-image; without it
 * the four signature headers are unverifiable, because `payload_type` is bound in.
 */
export async function buildAgentPayloadHeaders(
  k: HybridKeyMaterial,
  payloadType: string,
  payload: Uint8Array,
  chain: TetChainBinding,
): Promise<Record<string, string>> {
  const sig = await tetSign(k, payloadType, payload, chain);
  return {
    "x-tet-agent-payload-type": payloadType.trim(),
    ...hybridSigHeaders(sig),
  };
}
