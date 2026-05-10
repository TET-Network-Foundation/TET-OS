/**
 * Byte-for-byte match: tet-core `wallet::ai_infer_hybrid_auth_message_bytes` and
 * `tet-network/ui/app/lib/ai_infer_hybrid.ts`.
 */
import { createHash } from "node:crypto";
import { mldsa44SignDeterministic } from "./pqc_wasm.js";
import { u8ToStdBase64 } from "./encoding.js";
import type { HybridKeyMaterial } from "./types.js";

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

export async function buildAiInferHybridHeaders(
  k: HybridKeyMaterial,
  promptTrimmed: string,
  flops: bigint,
  nonce: bigint,
): Promise<Record<string, string>> {
  const w = k.walletIdHex64.trim().toLowerCase();
  const msg = await aiInferHybridAuthMessageBytes(w, promptTrimmed, flops, nonce);
  const sigU8 = k.signEd25519(msg);
  const edSigB64 = u8ToStdBase64(sigU8);
  const mldsaSigB64 = await mldsa44SignDeterministic(k.mldsa44KeypairB64, msg);
  return {
    "x-tet-ed25519-pubkey-hex": k.walletIdHex64,
    "x-tet-ed25519-sig-b64": edSigB64,
    "x-tet-mldsa-pubkey-b64": k.mldsa44PubkeyB64,
    "x-tet-mldsa-sig-b64": mldsaSigB64,
  };
}
