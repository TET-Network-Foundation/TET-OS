/**
 * Ed25519 + ML-DSA hybrid headers for `POST /ai/infer` (must match tet-core
 * `wallet::ai_infer_hybrid_auth_message_bytes` and `require_hybrid_sig` header names).
 */

import { getHybridSignerSession } from "./hybrid_signer_session";

export { requireHybridSignerSession } from "./hybrid_signer_session";
import { expectedChainBinding, sha256HexUtf8 } from "./chain_binding";
import { mldsa44SignDeterministic } from "./pqc";

export function u8ToStdBase64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(u8).toString("base64");
  }
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

export { sha256HexUtf8 };

/** Canonical UTF-8 bytes for hybrid signing (aligned with tet-core `ai_infer_hybrid_auth_message_bytes`). */
export async function aiInferHybridAuthMessageBytes(
  walletIdHex64: string,
  promptTrimmed: string,
  flops: bigint,
  nonce: bigint,
  baseUrl?: string,
): Promise<Uint8Array> {
  const w = walletIdHex64.trim().toLowerCase();
  const ph = await sha256HexUtf8(promptTrimmed);
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const line = `tet ai infer hybrid v1|chain_id=${chainId}|genesis_hash=${genesisHash}|${w}|${flops.toString()}|${nonce.toString()}|${ph}`;
  return new TextEncoder().encode(line);
}

/**
 * Headers: `x-tet-ed25519-pubkey-hex`, `x-tet-ed25519-sig-b64`, `x-tet-mldsa-pubkey-b64`, `x-tet-mldsa-sig-b64`.
 * Requires an unlocked wallet session (`setHybridSignerSession`). SSR returns {}.
 */
export async function buildAiInferHybridHeaders(
  walletIdHex64: string,
  promptTrimmed: string,
  flops: bigint,
  nonce: bigint,
  baseUrl?: string,
): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};

  const sess = getHybridSignerSession();
  if (!sess) {
    throw new Error("No Wallet: unlock your wallet before running AI inference.");
  }
  const w = walletIdHex64.trim().toLowerCase();
  if (w !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session wallet does not match inference wallet_id.");
  }

  const msg = await aiInferHybridAuthMessageBytes(walletIdHex64, promptTrimmed, flops, nonce, baseUrl);
  const sigU8 = await Promise.resolve(sess.signEd25519(msg));
  const edSigB64 = u8ToStdBase64(sigU8);
  const mldsaSigB64 = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  return {
    "x-tet-ed25519-pubkey-hex": sess.walletIdHex64,
    "x-tet-ed25519-sig-b64": edSigB64,
    "x-tet-mldsa-pubkey-b64": sess.mldsa44_pubkey_b64,
    "x-tet-mldsa-sig-b64": mldsaSigB64,
  };
}

/** Safe JSON u64 for `flops` field (avoid float drift). */
export function flopsBigIntToJsonNumber(flops: bigint): number {
  if (flops <= 0n) throw new Error("flops must be positive");
  if (flops > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("flops exceeds JS safe integer; narrow estimate");
  }
  return Number(flops);
}

/** Canonical bytes for `POST /ledger/initial_airdrop/claim` (aligned with tet-core `initial_airdrop_claim_hybrid_auth_message_bytes`). */
export function initialAirdropClaimHybridAuthMessageBytes(
  walletIdHex64: string,
  mldsaPubkeyB64: string,
  chainId: string,
  genesisHash: string,
): Uint8Array {
  const w = walletIdHex64.trim().toLowerCase();
  const p = mldsaPubkeyB64.trim();
  return new TextEncoder().encode(`tet initial airdrop claim hybrid v1|chain_id=${chainId}|genesis_hash=${genesisHash}|${w}|${p}`);
}

/**
 * Headers for welcome airdrop claim: `x-tet-ed25519-pubkey-hex`, `x-tet-ed25519-sig-b64`,
 * `x-tet-mldsa-pubkey-b64`, `x-tet-mldsa-sig-b64`, plus caller should set `x-tet-wallet-id`.
 */
export async function buildInitialAirdropClaimHybridHeaders(
  walletIdHex64: string,
  baseUrl?: string,
): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};

  const sess = getHybridSignerSession();
  if (!sess) {
    throw new Error("No Wallet: unlock your wallet before claiming the welcome airdrop.");
  }
  const w = walletIdHex64.trim().toLowerCase();
  if (w !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session wallet does not match claim wallet_id.");
  }

  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const msg = initialAirdropClaimHybridAuthMessageBytes(walletIdHex64, sess.mldsa44_pubkey_b64, chainId, genesisHash);
  const sigU8 = await Promise.resolve(sess.signEd25519(msg));
  const edSigB64 = u8ToStdBase64(sigU8);
  const mldsaSigB64 = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  return {
    "x-tet-ed25519-pubkey-hex": sess.walletIdHex64,
    "x-tet-ed25519-sig-b64": edSigB64,
    "x-tet-mldsa-pubkey-b64": sess.mldsa44_pubkey_b64,
    "x-tet-mldsa-sig-b64": mldsaSigB64,
  };
}
