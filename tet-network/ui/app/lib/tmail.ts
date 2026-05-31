/**
 * Tmail Basic E2EE envelope builder + types (mirror tet-core `src/tmail/envelope.rs` and
 * `src/tmail/keys.rs`). Field order and the hybrid-signature preimage MUST byte-match the backend
 * so `verify_tmail_envelope_v1` / `verify_tmail_key_registration_v1` accept the message.
 *
 * Only Basic E2EE is supported here: `flags = { basic:true, time_lock:false, burn_after_read:false,
 * anonymous:false }`. Time-lock / Burn / Anonymous are out of scope (separate sprint).
 */

import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { bytesToB64, b64ToBytes, bytesToHex } from "./encoding";
import { sha256 } from "@noble/hashes/sha2";
import { type CiphertextBundle, decryptForReceiver, encryptForReceiver } from "./tmail_e2ee";
import type { TmailKemKeys } from "./tmail_keys";

/** Default off-ledger fee recorded in the signed preimage (no on-chain charge in Phase 0). */
export const TMAIL_DEFAULT_FEE_MICRO = 0;
/** Default buffer TTL (7 days) — node clamps to `TET_TMAIL_MAX_TTL_MS`. */
export const TMAIL_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** E2EE scheme tag — must equal tet-core `TMAIL_E2EE_SCHEME`. */
export const TMAIL_E2EE_SCHEME = "tet-e2ee-hybrid-v1";

export type TmailFlags = {
  basic: boolean;
  time_lock: boolean;
  burn_after_read: boolean;
  anonymous: boolean;
};

export type TmailE2eeBlock = {
  v: number;
  scheme: string;
  client_ephemeral_pub_b64: string;
  client_mlkem_pub_b64: string;
  receiver_x25519_pub_b64: string;
  receiver_mlkem_pub_b64: string;
  mlkem_ciphertext_b64: string;
  nonce_b64: string;
  ciphertext_b64: string;
};

export type TmailHybridSig = {
  ed25519_pubkey_hex: string;
  ed25519_sig_b64: string;
  mldsa_pubkey_b64: string;
  mldsa_sig_b64: string;
};

export type TmailEnvelopeV1 = {
  v: 1;
  kind: "tmail_envelope_v1";
  msg_id: string;
  flags: TmailFlags;
  sender_wallet_id: string;
  receiver_wallet_id: string;
  sent_at_ms: number;
  release_at_ms: number;
  ttl_ms: number;
  fee_paid_micro: number;
  pin_stake_micro: number;
  e2ee: TmailE2eeBlock;
  hybrid_sig: TmailHybridSig;
};

export type TmailKeyRegistrationV1 = {
  wallet_id: string;
  x25519_pub_b64: string;
  mlkem_pub_b64: string;
  registered_at_ms: number;
  hybrid_sig: TmailHybridSig;
};

/** Canonical flag encoding — must equal tet-core `TmailFlags::canonical`. */
function flagsCanonical(f: TmailFlags): string {
  const b = (v: boolean) => (v ? "1" : "0");
  return `basic=${b(f.basic)},time_lock=${b(f.time_lock)},burn_after_read=${b(f.burn_after_read)},anonymous=${b(f.anonymous)}`;
}

/** hex(SHA256(decoded ciphertext)) — matches tet-core `TmailEnvelopeV1::payload_sha256_hex`. */
function payloadSha256Hex(ciphertextB64: string): string {
  return bytesToHex(sha256(b64ToBytes(ciphertextB64.trim())));
}

/**
 * Hybrid-signature preimage for an envelope (tet-core `tmail_envelope_auth_message_bytes`):
 * `tet tmail envelope v1|chain_id=..|genesis_hash=..|msg_id=..|flags=..|sender=..|receiver=..|`
 * `release_at_ms=..|fee_micro=..|payload_sha256=..|mldsa_pk=..`
 */
async function tmailEnvelopeAuthMessageBytes(
  env: TmailEnvelopeV1,
  mldsaPubkeyB64: string,
  baseUrl?: string,
): Promise<Uint8Array> {
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const payloadSha256 = payloadSha256Hex(env.e2ee.ciphertext_b64);
  const line =
    `tet tmail envelope v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
    `|msg_id=${env.msg_id.trim()}|flags=${flagsCanonical(env.flags)}` +
    `|sender=${env.sender_wallet_id.trim().toLowerCase()}` +
    `|receiver=${env.receiver_wallet_id.trim().toLowerCase()}` +
    `|release_at_ms=${env.release_at_ms}|fee_micro=${env.fee_paid_micro}` +
    `|payload_sha256=${payloadSha256}|mldsa_pk=${mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

export type BuildTmailEnvelopeOpts = {
  senderWalletIdHex64: string;
  receiverWalletIdHex64: string;
  plaintextUtf8: string;
  receiverX25519Pub: Uint8Array;
  receiverMlkemPub: Uint8Array;
  baseUrl?: string;
  feePaidMicro?: number;
  ttlMs?: number;
};

/**
 * Build a hybrid-signed Tmail Basic E2EE envelope (requires an unlocked wallet session).
 *
 * Steps: encrypt the body for the receiver → assemble the `e2ee` block → compute the §A.1.3
 * preimage → Ed25519 + ML-DSA sign → return the envelope.
 */
export async function buildTmailEnvelopeV1(opts: BuildTmailEnvelopeOpts): Promise<TmailEnvelopeV1> {
  const sess = requireHybridSignerSession();
  const sender = opts.senderWalletIdHex64.trim().toLowerCase();
  const receiver = opts.receiverWalletIdHex64.trim().toLowerCase();
  if (sender !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match sender wallet.");
  }
  if (!/^[0-9a-f]{64}$/.test(receiver)) {
    throw new Error("Recipient wallet must be 64 hex chars.");
  }

  const plaintext = new TextEncoder().encode(opts.plaintextUtf8);
  const bundle: CiphertextBundle = await encryptForReceiver(
    plaintext,
    opts.receiverX25519Pub,
    opts.receiverMlkemPub,
  );

  const e2ee: TmailE2eeBlock = {
    v: 1,
    scheme: TMAIL_E2EE_SCHEME,
    client_ephemeral_pub_b64: bytesToB64(bundle.client_ephemeral_pub),
    client_mlkem_pub_b64: "",
    receiver_x25519_pub_b64: bytesToB64(opts.receiverX25519Pub),
    receiver_mlkem_pub_b64: bytesToB64(opts.receiverMlkemPub),
    mlkem_ciphertext_b64: bytesToB64(bundle.mlkem_ciphertext),
    nonce_b64: bytesToB64(bundle.nonce),
    ciphertext_b64: bytesToB64(bundle.ciphertext),
  };

  const env: TmailEnvelopeV1 = {
    v: 1,
    kind: "tmail_envelope_v1",
    msg_id: crypto.randomUUID(),
    flags: { basic: true, time_lock: false, burn_after_read: false, anonymous: false },
    sender_wallet_id: sender,
    receiver_wallet_id: receiver,
    sent_at_ms: Date.now(),
    release_at_ms: 0,
    ttl_ms: opts.ttlMs ?? TMAIL_DEFAULT_TTL_MS,
    fee_paid_micro: opts.feePaidMicro ?? TMAIL_DEFAULT_FEE_MICRO,
    pin_stake_micro: 0,
    e2ee,
    hybrid_sig: {
      ed25519_pubkey_hex: sender,
      ed25519_sig_b64: "",
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: "",
    },
  };

  const msg = await tmailEnvelopeAuthMessageBytes(env, sess.mldsa44_pubkey_b64, opts.baseUrl);
  const edSig = await Promise.resolve(sess.signEd25519(msg));
  env.hybrid_sig.ed25519_sig_b64 = u8ToStdBase64(edSig);
  env.hybrid_sig.mldsa_sig_b64 = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);
  return env;
}

/** Decrypt a received envelope to its UTF-8 plaintext using the receiver's derived KEM keys. */
export async function decryptTmailEnvelope(
  env: TmailEnvelopeV1,
  kem: TmailKemKeys,
): Promise<string> {
  const plaintext = await decryptForReceiver(
    {
      client_ephemeral_pub: b64ToBytes(env.e2ee.client_ephemeral_pub_b64),
      mlkem_ciphertext: b64ToBytes(env.e2ee.mlkem_ciphertext_b64),
      nonce: b64ToBytes(env.e2ee.nonce_b64),
      ciphertext: b64ToBytes(env.e2ee.ciphertext_b64),
    },
    kem.x25519_sk,
    kem.mlkem_sk,
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Hybrid-signature preimage for a key registration (tet-core
 * `tmail_key_registration_auth_message_bytes`):
 * `tet tmail key v1|chain_id=..|genesis_hash=..|wallet_id=..|x25519_pub=..|mlkem_pub=..|`
 * `registered_at_ms=..|mldsa_pk=..`
 */
async function tmailKeyRegistrationAuthMessageBytes(
  reg: TmailKeyRegistrationV1,
  mldsaPubkeyB64: string,
  baseUrl?: string,
): Promise<Uint8Array> {
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const line =
    `tet tmail key v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
    `|wallet_id=${reg.wallet_id.trim().toLowerCase()}` +
    `|x25519_pub=${reg.x25519_pub_b64.trim()}|mlkem_pub=${reg.mlkem_pub_b64.trim()}` +
    `|registered_at_ms=${reg.registered_at_ms}|mldsa_pk=${mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

/** Build a hybrid-signed key registration for the unlocked wallet's derived KEM public keys. */
export async function buildTmailKeyRegistrationV1(
  walletIdHex64: string,
  kem: TmailKemKeys,
  baseUrl?: string,
): Promise<TmailKeyRegistrationV1> {
  const sess = requireHybridSignerSession();
  const w = walletIdHex64.trim().toLowerCase();
  if (w !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match wallet_id.");
  }
  const reg: TmailKeyRegistrationV1 = {
    wallet_id: w,
    x25519_pub_b64: bytesToB64(kem.x25519_pub),
    mlkem_pub_b64: bytesToB64(kem.mlkem_pub),
    registered_at_ms: Date.now(),
    hybrid_sig: {
      ed25519_pubkey_hex: w,
      ed25519_sig_b64: "",
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: "",
    },
  };
  const msg = await tmailKeyRegistrationAuthMessageBytes(reg, sess.mldsa44_pubkey_b64, baseUrl);
  const edSig = await Promise.resolve(sess.signEd25519(msg));
  reg.hybrid_sig.ed25519_sig_b64 = u8ToStdBase64(edSig);
  reg.hybrid_sig.mldsa_sig_b64 = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);
  return reg;
}

export type { TmailKemKeys };
