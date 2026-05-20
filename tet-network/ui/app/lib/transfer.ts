/**
 * Hybrid wallet transfer (`POST /wallet/transfer`).
 * Message bytes match tet-core `wallet::transfer_hybrid_auth_message_bytes`.
 */

import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";

export type WalletTransferSignedReq = {
  from_address: string;
  to_address: string;
  amount_tet: number;
  nonce: number;
  /** Ed25519 detached signature: 128 lowercase hex chars (64 bytes). */
  signature: string;
  mldsa_pubkey_b64: string;
  mldsa_signature_b64: string;
};

export type WalletTransferResp = {
  from_wallet_id: string;
  to_wallet_id: string;
  amount_micro: number;
  net_micro: number;
  fee_micro: number;
};

export type WalletTransferNonceResp = {
  wallet_id: string;
  last_nonce: number;
  next_nonce: number;
};

export async function transferHybridAuthMessageBytes(
  toWalletId: string,
  amountMicro: bigint,
  nonce: bigint,
  mldsaPubkeyB64: string,
  baseUrl?: string,
): Promise<Uint8Array> {
  const t = toWalletId.trim().toLowerCase();
  const p = mldsaPubkeyB64.trim();
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const line =
    `tet xfer hybrid v1|chain_id=${chainId}|genesis_hash=${genesisHash}|${t}|` +
    `${amountMicro.toString()}|${nonce.toString()}|${p}`;
  return new TextEncoder().encode(line);
}

function ed25519SigToHex(sig: Uint8Array): string {
  if (sig.length !== 64) {
    throw new Error(`Ed25519 signature must be 64 bytes (got ${sig.length})`);
  }
  let hex = "";
  for (let i = 0; i < sig.length; i++) hex += sig[i]!.toString(16).padStart(2, "0");
  return hex;
}

/** Stevemon micro → `amount_tet` for REST (6 decimal TET). */
export function amountMicroToAmountTet(amountMicro: bigint): number {
  if (amountMicro <= 0n) throw new Error("amount must be positive");
  if (amountMicro > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("amount too large for JS number conversion");
  }
  return Number(amountMicro) / 1_000_000;
}

export type SignedWalletTransfer = {
  body: WalletTransferSignedReq;
  amountMicro: bigint;
  nonce: number;
};

/**
 * Build hybrid-signed `POST /wallet/transfer` body (requires unlocked wallet session).
 */
export async function buildSignedWalletTransfer(
  fromWalletIdHex64: string,
  toWalletIdHex64: string,
  amountMicro: bigint,
  nonce: number,
  baseUrl?: string,
): Promise<SignedWalletTransfer> {
  const sess = requireHybridSignerSession();
  const from = fromWalletIdHex64.trim().toLowerCase();
  const to = toWalletIdHex64.trim().toLowerCase();
  if (from !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match From address.");
  }
  if (from === to) {
    throw new Error("Cannot transfer to the same wallet.");
  }
  if (!Number.isFinite(nonce) || nonce <= 0) {
    throw new Error("Invalid transfer nonce.");
  }

  const msg = await transferHybridAuthMessageBytes(
    to,
    amountMicro,
    BigInt(nonce),
    sess.mldsa44_pubkey_b64,
    baseUrl,
  );
  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const signature = ed25519SigToHex(edSig);
  const mldsa_signature_b64 = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  return {
    amountMicro,
    nonce,
    body: {
      from_address: from,
      to_address: to,
      amount_tet: amountMicroToAmountTet(amountMicro),
      nonce,
      signature,
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_signature_b64,
    },
  };
}

export function userFacingTransferError(status: number, text?: string): string {
  const raw = (text ?? "").trim();
  if (process.env.NODE_ENV === "development" && raw) {
    console.error("[transfer] server response (raw):", raw);
  }
  const lower = raw.toLowerCase();
  if (status === 0) {
    return "Cannot reach the node. Check that TET-Core is running and the API URL is correct.";
  }
  if (status === 401 || lower.includes("hybrid") || lower.includes("signature")) {
    return "Signature rejected. Check treasury / genesis env and unlock the correct wallet.";
  }
  if (status === 409 || lower.includes("nonce")) {
    return "Nonce conflict. Try sending again.";
  }
  if (lower.includes("insufficient")) {
    return "Insufficient balance for this transfer (amount + protocol fee).";
  }
  if (lower.includes("attestation")) {
    return "This node requires hardware attestation for transfers.";
  }
  if (raw) return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  return `Transfer failed (HTTP ${status}).`;
}
