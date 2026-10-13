/**
 * Tmail envelope builder — constructs a hybrid-signed E2EE `TmailEnvelopeV1` in the browser,
 * byte-compatible with tet-core `src/tmail/envelope.rs` (struct serde shape + §A.1.3 preimage).
 *
 * Pipeline: generate `msg_id` → E2EE the plaintext for the receiver → `payload_sha256` over the raw
 * ciphertext → canonical flags → build the §A.1.3 preimage → hybrid (Ed25519 + ML-DSA) sign →
 * assemble the envelope. Burn-after-read rides the signed `flags`; the optional
 * anonymous/time_lock/burn blocks are omitted entirely.
 */

import { encryptForReceiver } from "./tmail_e2ee";
import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { bytesToB64, bytesToHex } from "./encoding";
import { sha256 } from "@noble/hashes/sha2";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToTetEd25519Keypair, signTetEd25519 } from "./ed25519_tet";
import { mldsa44KeypairFromMnemonic } from "./pqc";
import { ANONYMOUS_SENTINEL } from "./anon_poster.mjs";

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
  /** Present only on anonymous envelopes (spec §A.1.2 `anonymous`). */
  anonymous?: {
    ephemeral_wallet_id: string;
    /** Absent on a fast post (no proof of its own; its posting key was registered by an earlier one). */
    anchor_proof?: { image_id_hex: string; journal_b64: string; receipt_sha256_hex: string };
  };
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
  /**
   * Burn-after-read (spec §A.3). The flag is part of the §A.1.3 signed preimage, so it cannot be
   * flipped in transit. The optional `burn` block is deliberately NOT sent: it is outside the
   * preimage, and the node rejects one that disagrees with this flag.
   */
  burnAfterRead?: boolean;
  /**
   * Scheduled release (spec §A.2). Absolute epoch-ms, and must be strictly after `sent_at_ms` —
   * the node refuses a schedule in the past rather than releasing immediately under a "scheduled"
   * label. Signed, so it cannot be moved in transit. Sets `flags.time_lock`.
   *
   * Not an enforced lock: see `TMAIL_TIME_LOCK_DISCLOSURE`.
   */
  releaseAtMs?: number;
};

/** One row of `GET /tmail/inbox` (mirrors Rust `TmailInboxRowV1`). */
export type TmailInboxRowV1 = Omit<TmailEnvelopeV1, "e2ee"> & {
  /**
   * **Absent while the message is still scheduled.** Treat missing as "not yet released", never as
   * an empty payload.
   */
  e2ee?: TmailE2eeBlock;
  locked?: boolean;
  locked_note?: string;
  /** Present on anonymous messages. Absent or `pending` both mean NOT verified. */
  anon_verdict?: import("./tmail_anon").AnonVerdict;
};

/**
 * Build a hybrid-signed E2EE {@link TmailEnvelopeV1} — Basic, optionally burn-after-read. Requires
 * an unlocked hybrid signer session whose `walletIdHex64` matches `senderWalletId`.
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
  const sentAtMsEarly = Date.now();
  const releaseAtMs = opts.releaseAtMs ?? 0;
  if (releaseAtMs !== 0 && releaseAtMs <= sentAtMsEarly) {
    throw new Error("Scheduled release must be in the future.");
  }
  const flags: TmailFlags = {
    basic: true,
    time_lock: releaseAtMs !== 0,
    burn_after_read: opts.burnAfterRead === true,
    anonymous: false,
  };
  const feePaidMicro = opts.feePaidMicro ?? TMAIL_DEFAULT_FEE_MICRO;
  const ttlMs = opts.ttlMs ?? TMAIL_DEFAULT_TTL_MS;
  const msgId = newMsgId();
  const sentAtMs = sentAtMsEarly;

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

/**
 * The one-day ephemeral signer for an anonymous message, as an ordinary 12-word wallet: the
 * mnemonic is the first 16 bytes of `tmail_ephemeral_seed_v1(member_secret, receiver, bucket)`, the
 * same 128 bits of entropy every TET wallet has. Derived, never stored: the member re-derives it.
 */
function ephemeralMnemonic(ephemeralSeed: Uint8Array): string {
  if (ephemeralSeed.length !== 32) throw new Error("ephemeral seed must be 32 bytes");
  return entropyToMnemonic(ephemeralSeed.slice(0, 16), wordlist);
}

/** The ephemeral's wallet id (its Ed25519 public key), which the membership proof commits to. */
export async function ephemeralWalletIdFromSeed(ephemeralSeed: Uint8Array): Promise<string> {
  return mnemonicToTetEd25519Keypair(ephemeralMnemonic(ephemeralSeed)).walletIdHex;
}

/**
 * Build an anonymous envelope (spec §A.1.2): sender is the sentinel, the signer is the ephemeral,
 * and the anchor proof is metadata only — the receipt was deposited separately.
 *
 * **The user's own wallet is not an input**, so it cannot end up in the envelope. This is the
 * builder anonymous mode must use; `buildTmailEnvelopeV1` signs with the unlocked wallet.
 */
export async function buildAnonymousTmailEnvelopeV1(opts: {
  ephemeralSeed: Uint8Array;
  ephemeralWalletId: string;
  receiverWalletId: string;
  plaintextUtf8: string;
  receiverX25519Pub: Uint8Array;
  receiverMlkemPub: Uint8Array;
  sentAtMs: number;
  /** `null` for a fast post: no proof of its own (docs/plans/FAST_ANON_POSTING.md). */
  proof: { journal_b64: string; image_id_hex: string; receipt_sha256_hex: string } | null;
  baseUrl?: string;
}): Promise<TmailEnvelopeV1> {
  const receiver = opts.receiverWalletId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(receiver)) {
    throw new Error("Recipient wallet id must be 64 lowercase hex chars.");
  }
  const words = ephemeralMnemonic(opts.ephemeralSeed);
  const ed = mnemonicToTetEd25519Keypair(words);
  if (ed.walletIdHex !== opts.ephemeralWalletId.trim().toLowerCase()) {
    throw new Error("ephemeral key does not match the posting key");
  }
  const pqc = await mldsa44KeypairFromMnemonic(words);

  const plaintext = new TextEncoder().encode(opts.plaintextUtf8);
  const bundle = await encryptForReceiver(plaintext, opts.receiverX25519Pub, opts.receiverMlkemPub);
  const payloadSha256Hex = bytesToHex(sha256(bundle.ciphertext));
  const flags: TmailFlags = { basic: true, time_lock: false, burn_after_read: false, anonymous: true };
  const msgId = newMsgId();
  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = tmailEnvelopeAuthMessageBytes({
    chainId,
    genesisHash,
    msgId,
    flags,
    senderWalletId: ANONYMOUS_SENTINEL,
    receiverWalletId: receiver,
    releaseAtMs: 0,
    feeMicro: TMAIL_DEFAULT_FEE_MICRO,
    payloadSha256Hex,
    mldsaPubkeyB64: pqc.pubkey_b64,
  });
  const edSig = await signTetEd25519(ed.secretKey, msg);
  const mldsaSig = await mldsa44SignDeterministic(pqc.keypair_b64, msg);

  return {
    v: 1,
    kind: TMAIL_ENVELOPE_KIND,
    msg_id: msgId,
    flags,
    sender_wallet_id: ANONYMOUS_SENTINEL,
    receiver_wallet_id: receiver,
    sent_at_ms: opts.sentAtMs,
    release_at_ms: 0,
    ttl_ms: TMAIL_DEFAULT_TTL_MS,
    fee_paid_micro: TMAIL_DEFAULT_FEE_MICRO,
    pin_stake_micro: 0,
    e2ee: {
      v: 1,
      scheme: TMAIL_E2EE_SCHEME,
      client_ephemeral_pub_b64: bytesToB64(bundle.client_ephemeral_pub),
      client_mlkem_pub_b64: bytesToB64(bundle.client_mlkem_pub),
      receiver_x25519_pub_b64: bytesToB64(opts.receiverX25519Pub),
      receiver_mlkem_pub_b64: bytesToB64(opts.receiverMlkemPub),
      mlkem_ciphertext_b64: bytesToB64(bundle.mlkem_ciphertext),
      nonce_b64: bytesToB64(bundle.nonce),
      ciphertext_b64: bytesToB64(bundle.ciphertext),
    },
    hybrid_sig: {
      ed25519_pubkey_hex: ed.walletIdHex,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: pqc.pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
    anonymous: opts.proof
      ? {
          ephemeral_wallet_id: ed.walletIdHex,
          anchor_proof: {
            image_id_hex: opts.proof.image_id_hex,
            journal_b64: opts.proof.journal_b64,
            receipt_sha256_hex: opts.proof.receipt_sha256_hex,
          },
        }
      : { ephemeral_wallet_id: ed.walletIdHex },
  };
}
