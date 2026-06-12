/**
 * Worker consensus registration — builds hybrid-signed `TxV1::WorkerRegister` envelopes.
 */

import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import type { SignedTxEnvelopeV1 } from "./transfer";

export type WorkerHardwareProfile = {
  hardwareIdHex: string;
  hardwareProfile: string;
  capabilities: string[];
  tflopsDeclared: number;
};

/** Canonical tx JSON — field order must match Rust `serde` for `TxV1::WorkerRegister`. */
export function workerRegisterTxCanonicalJson(
  walletId: string,
  hardwareIdHex: string,
  hardwareProfile: string,
  capabilities: string[],
  tflopsDeclared: number,
): string {
  const caps = capabilities.map((c) => c.trim().toLowerCase()).filter(Boolean);
  return (
    `{"kind":"worker_register","wallet_id":"${walletId.toLowerCase()}",` +
    `"hardware_id_hex":"${hardwareIdHex.trim()}",` +
    `"hardware_profile":"${hardwareProfile.trim()}",` +
    `"capabilities":${JSON.stringify(caps)},` +
    `"tflops_declared":${Number.isFinite(tflopsDeclared) ? tflopsDeclared : 0}}`
  );
}

export async function buildWorkerRegisterEnvelopeV1(opts: {
  walletId: string;
  profile: WorkerHardwareProfile;
  baseUrl?: string;
}): Promise<SignedTxEnvelopeV1> {
  const sess = requireHybridSignerSession();
  const wallet = opts.walletId.trim().toLowerCase();
  if (wallet !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match wallet_id.");
  }
  const { hardwareIdHex, hardwareProfile, capabilities, tflopsDeclared } = opts.profile;
  if (!hardwareIdHex.trim()) throw new Error("hardware_id_hex required");
  if (!hardwareProfile.trim()) throw new Error("hardware_profile required");

  const txCanonical = workerRegisterTxCanonicalJson(
    wallet,
    hardwareIdHex,
    hardwareProfile,
    capabilities,
    tflopsDeclared,
  );
  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = new TextEncoder().encode(
    `tet tx v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
      `|mldsa=${sess.mldsa44_pubkey_b64.trim()}|tx=${txCanonical}`,
  );

  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  return {
    v: 1,
    tx: {
      kind: "worker_register",
      wallet_id: wallet,
      hardware_id_hex: hardwareIdHex.trim(),
      hardware_profile: hardwareProfile.trim(),
      capabilities: capabilities.map((c) => c.trim().toLowerCase()).filter(Boolean),
      tflops_declared: Number.isFinite(tflopsDeclared) ? tflopsDeclared : 0,
    },
    sig: {
      ed25519_pubkey_hex: wallet,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
    attestation: { platform: "", report_b64: "" },
  };
}
