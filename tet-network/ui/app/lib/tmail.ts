/**
 * Tmail envelope builder — constructs a hybrid-signed Basic E2EE `TmailEnvelopeV1` in the browser,
 * byte-compatible with tet-core `src/tmail/envelope.rs` (struct serde shape + §A.1.3 preimage).
 *
 * Pipeline: generate `msg_id` → E2EE the plaintext for the receiver → `payload_sha256` over the raw
 * ciphertext → canonical flags → build the §A.1.3 preimage → hybrid (Ed25519 + ML-DSA) sign →
 * assemble the envelope (optional anonymous/time_lock/burn blocks omitted in the Basic build).
 */

import { encryptForReceiver } from "./tmail_e2ee";
import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { bytesToB64, bytesToHex } from "./encoding";
import { sha256 } from "@noble/hashes/sha2";

/** Stable `kind` discriminator — mirrors Rust `TMAIL_ENVELOPE_KIND`. */
export const TMAIL_ENVELOPE_KIND = "tmail_envelope_v1";
/** E2EE scheme identifier — mirrors Rust `TMAIL_E2EE_SCHEME`. */
export const TMAIL_E2EE_SCHEME = "tet-e2ee-hybrid-v1";
/** Default off-ledger maintenance fee bound into the signature (Stevemon micro). */
export const TMAIL_DEFAULT_FEE_MICRO = 100;
/** Default envelope TTL (7 days). The node may further clamp this in its buffer. */
export const TMAIL_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** UI guard: keep plaintext within a sane single-message bound. */
export const TMAIL_MAX_PLAINTEXT_CHARS = 4096;

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

/** Basic E2EE Tmail envelope (mirrors Rust `TmailEnvelopeV1`; optional blocks omitted). */
export type TmailEnvelopeV1 = {
  v: number;
  kind: string;
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

/** Canonical flags string for the §A.1.3 preimage — mirrors Rust `TmailFlags::canonical()`. */
function flagsCanonical(flags: TmailFlags): string {
  const b = (v: boolean) => (v ? "1" : "0");
  return `basic=${b(flags.basic)},time_lock=${b(flags.time_lock)},burn_after_read=${b(
    flags.burn_after_read,
  )},anonymous=${b(flags.anonymous)}`;
}

/**
 * §A.1.3 hybrid-signature preimage — byte-exact with Rust
 * `envelope.rs::tmail_envelope_auth_message_bytes`.
 */
export function tmailEnvelopeAuthMessageBytes(opts: {
  chainId: string;
  genesisHash: string;
  msgId: string;
  flags: TmailFlags;
  senderWalletId: string;
  receiverWalletId: string;
  releaseAtMs: number;
  feeMicro: number;
  payloadSha256Hex: string;
  mldsaPubkeyB64: string;
}): Uint8Array {
  const line =
    `tet tmail envelope v1|chain_id=${opts.chainId}|genesis_hash=${opts.genesisHash}` +
    `|msg_id=${opts.msgId.trim()}` +
    `|flags=${flagsCanonical(opts.flags)}` +
    `|sender=${opts.senderWalletId.trim().toLowerCase()}` +
    `|receiver=${opts.receiverWalletId.trim().toLowerCase()}` +
    `|release_at_ms=${opts.releaseAtMs}` +
    `|fee_micro=${opts.feeMicro}` +
    `|payload_sha256=${opts.payloadSha256Hex}` +
    `|mldsa_pk=${opts.mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

function newMsgId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const r = new Uint8Array(16);
  globalThis.crypto.getRandomValues(r);
  return bytesToHex(r);
}

export type BuildTmailEnvelopeOpts = {
  senderWalletId: string;
  receiverWalletId: string;
  plaintextUtf8: string;
  receiverX25519Pub: Uint8Array;
  receiverMlkemPub: Uint8Array;
  baseUrl?: string;
  feePaidMicro?: number;
  ttlMs?: number;
};

/**
 * Build a hybrid-signed Basic E2EE {@link TmailEnvelopeV1}. Requires an unlocked hybrid signer
 * session whose `walletIdHex64` matches `senderWalletId`.
 */
export async function buildTmailEnvelopeV1(opts: BuildTmailEnvelopeOpts): Promise<TmailEnvelopeV1> {
  const sess = requireHybridSignerSession();
  const sender = opts.senderWalletId.trim().toLowerCase();
  const receiver = opts.receiverWalletId.trim().toLowerCase();
  if (sender !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match sender wallet.");
  }
  if (!/^[0-9a-f]{64}$/.test(receiver)) {
    throw new Error("Recipient wallet id must be 64 lowercase hex chars.");
  }

  const plaintext = new TextEncoder().encode(opts.plaintextUtf8);
  const bundle = await encryptForReceiver(plaintext, opts.receiverX25519Pub, opts.receiverMlkemPub);

  const payloadSha256Hex = bytesToHex(sha256(bundle.ciphertext));
  const flags: TmailFlags = {
    basic: true,
    time_lock: false,
    burn_after_read: false,
    anonymous: false,
  };
  const feePaidMicro = opts.feePaidMicro ?? TMAIL_DEFAULT_FEE_MICRO;
  const ttlMs = opts.ttlMs ?? TMAIL_DEFAULT_TTL_MS;
  const releaseAtMs = 0;
  const msgId = newMsgId();
  const sentAtMs = Date.now();

  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = tmailEnvelopeAuthMessageBytes({
    chainId,
    genesisHash,
    msgId,
    flags,
    senderWalletId: sender,
    receiverWalletId: receiver,
    releaseAtMs,
    feeMicro: feePaidMicro,
    payloadSha256Hex,
    mldsaPubkeyB64: sess.mldsa44_pubkey_b64,
  });

  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  const e2ee: TmailE2eeBlock = {
    v: 1,
    scheme: TMAIL_E2EE_SCHEME,
    client_ephemeral_pub_b64: bytesToB64(bundle.client_ephemeral_pub),
    client_mlkem_pub_b64: bytesToB64(bundle.client_mlkem_pub),
    receiver_x25519_pub_b64: bytesToB64(opts.receiverX25519Pub),
    receiver_mlkem_pub_b64: bytesToB64(opts.receiverMlkemPub),
    mlkem_ciphertext_b64: bytesToB64(bundle.mlkem_ciphertext),
    nonce_b64: bytesToB64(bundle.nonce),
    ciphertext_b64: bytesToB64(bundle.ciphertext),
  };

  return {
    v: 1,
    kind: TMAIL_ENVELOPE_KIND,
    msg_id: msgId,
    flags,
    sender_wallet_id: sender,
    receiver_wallet_id: receiver,
    sent_at_ms: sentAtMs,
    release_at_ms: releaseAtMs,
    ttl_ms: ttlMs,
    fee_paid_micro: feePaidMicro,
    pin_stake_micro: 0,
    e2ee,
    hybrid_sig: {
      ed25519_pubkey_hex: sender,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
  };
}
