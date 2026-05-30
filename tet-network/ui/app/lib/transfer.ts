/**
 * Send Coins → consensus-routed transfer.
 *
 * Builds a hybrid-signed `SignedTxEnvelopeV1` (carrying a `TxV1::Transfer`) and POSTs it to
 * `POST /wallet/transfer`. The node verifies the signature, enqueues it into the mempool, and
 * gossips it to peers; it returns `202 Accepted` with a pending `tx_hash`. The transfer is then
 * applied deterministically by every node once a producer mines it into a block (no local-only
 * balance mutation, so Send Coins can no longer create a hidden fork).
 *
 * The signed message matches tet-core `wallet::tx_v1_auth_message_bytes`:
 *   `tet tx v1|chain_id=..|genesis_hash=..|mldsa=<pk>|tx=<canonical-json>`
 * where `<canonical-json>` is serde's compact serialization of `TxV1::Transfer`.
 */

import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";

/** Default protocol maintenance fee (1%) — mirrors tet-core `PROTOCOL_MAINTENANCE_FEE_BPS`. */
export const TRANSFER_FEE_BPS = 100;

/** Hybrid-signed transaction envelope (mirrors tet-core `protocol::SignedTxEnvelopeV1`). */
export type SignedTxEnvelopeV1 = {
  v: 1;
  tx: {
    kind: "transfer";
    from_wallet: string;
    to_wallet: string;
    amount_micro: number;
    fee_bps: number;
  };
  sig: {
    ed25519_pubkey_hex: string;
    ed25519_sig_b64: string;
    mldsa_pubkey_b64: string;
    mldsa_sig_b64: string;
  };
  attestation: { platform: string; report_b64: string };
};

/** `202 Accepted` body returned by `POST /wallet/transfer` (pending until mined). */
export type WalletTransferAcceptedResp = {
  ok: boolean;
  status: string;
  tx_hash: string;
  from_wallet_id: string;
  to_wallet_id: string;
  amount_micro: number;
};

/** `GET /wallet/nonce/:wallet` response (kept for compatibility; not required by the envelope path). */
export type WalletTransferNonceResp = {
  wallet_id: string;
  last_nonce: number;
  next_nonce: number;
};

/** Stevemon micro → number for the JSON `amount_micro` field (u64, must be a safe integer). */
function amountMicroToJsonNumber(amountMicro: bigint): number {
  if (amountMicro <= 0n) throw new Error("amount must be positive");
  if (amountMicro > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("amount too large for JS number conversion");
  }
  return Number(amountMicro);
}

/**
 * Canonical serde JSON for `TxV1::Transfer` (internally tagged via `#[serde(tag = "kind")]`).
 * Field order is normative and MUST byte-match tet-core `serde_json::to_string(&TxV1::Transfer { .. })`.
 */
export function transferTxCanonicalJson(
  from: string,
  to: string,
  amountMicro: bigint,
  feeBps: number,
): string {
  return (
    `{"kind":"transfer","from_wallet":"${from}","to_wallet":"${to}",` +
    `"amount_micro":${amountMicro.toString()},"fee_bps":${feeBps}}`
  );
}

/** Canonical signing bytes — mirrors tet-core `wallet::tx_v1_auth_message_bytes`. */
async function transferEnvelopeAuthMessageBytes(
  txCanonicalJson: string,
  mldsaPubkeyB64: string,
  baseUrl?: string,
): Promise<Uint8Array> {
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const line =
    `tet tx v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
    `|mldsa=${mldsaPubkeyB64.trim()}|tx=${txCanonicalJson}`;
  return new TextEncoder().encode(line);
}

/**
 * Build a hybrid-signed transfer envelope (requires an unlocked wallet session).
 */
export async function buildTransferEnvelope(
  fromWalletIdHex64: string,
  toWalletIdHex64: string,
  amountMicro: bigint,
  baseUrl?: string,
  feeBps: number = TRANSFER_FEE_BPS,
): Promise<SignedTxEnvelopeV1> {
  const sess = requireHybridSignerSession();
  const from = fromWalletIdHex64.trim().toLowerCase();
  const to = toWalletIdHex64.trim().toLowerCase();
  if (from !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match From address.");
  }
  if (from === to) {
    throw new Error("Cannot transfer to the same wallet.");
  }

  const amountJson = amountMicroToJsonNumber(amountMicro);
  const txCanonical = transferTxCanonicalJson(from, to, amountMicro, feeBps);
  const msg = await transferEnvelopeAuthMessageBytes(
    txCanonical,
    sess.mldsa44_pubkey_b64,
    baseUrl,
  );

  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const ed25519_sig_b64 = u8ToStdBase64(edSig);
  const mldsa_sig_b64 = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  return {
    v: 1,
    tx: {
      kind: "transfer",
      from_wallet: from,
      to_wallet: to,
      amount_micro: amountJson,
      fee_bps: feeBps,
    },
    sig: {
      ed25519_pubkey_hex: from,
      ed25519_sig_b64,
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64,
    },
    attestation: { platform: "", report_b64: "" },
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
  if (status === 429 || lower.includes("mempool") || lower.includes("too many")) {
    return "The node mempool is busy. Try sending again in a moment.";
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
