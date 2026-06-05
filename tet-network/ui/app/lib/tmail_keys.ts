/**
 * Deterministic Tmail KEM key derivation + key-registration builder.
 *
 * The same BIP39 mnemonic that backs the wallet's Ed25519 / ML-DSA identity also derives a pair of
 * messaging KEM keys (X25519 + ML-KEM-768) via HKDF-SHA256 with distinct `info` labels. The derived
 * public keys are published through `PUT /tmail/keys/:wallet_id` (a hybrid-signed
 * `TmailKeyRegistrationV1`, mirroring tet-core `src/tmail/keys.rs`).
 */

import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { Kyber768 } from "crystals-kyber-js";

import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { bytesToB64 } from "./encoding";
import type { TmailHybridSig } from "./tmail";

/** HKDF `info` for the X25519 messaging secret key (32-byte output). */
const X25519_INFO = new TextEncoder().encode("tet-tmail-x25519-v1");
/** HKDF `info` for the ML-KEM-768 deterministic key-derivation seed (64-byte output). */
const MLKEM_INFO = new TextEncoder().encode("tet-tmail-mlkem-v1");

/** Raw derived messaging keys (held only in memory for the unlocked tab session). */
export type TmailDerivedKeys = {
  x25519_sk: Uint8Array;
  x25519_pub: Uint8Array;
  mlkem_sk: Uint8Array;
  mlkem_pub: Uint8Array;
};

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Derive the wallet's X25519 + ML-KEM-768 messaging keypairs deterministically from its mnemonic.
 * Re-running with the same mnemonic always yields the same keys (so a re-unlock keeps the inbox
 * decryptable). The KEM keypair is independent of the wallet's Ed25519 / ML-DSA signing keys.
 */
export async function deriveTmailKeysFromMnemonic(mnemonic: string): Promise<TmailDerivedKeys> {
  const norm = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(norm, wordlist)) {
    throw new Error("invalid mnemonic");
  }
  const seed = mnemonicToSeedSync(norm, "");

  const x25519_sk = hkdf(sha256, seed, undefined, X25519_INFO, 32);
  const x25519_pub = x25519.getPublicKey(x25519_sk);

  const mlkemSeed = hkdf(sha256, seed, undefined, MLKEM_INFO, 64);
  const kyber = new Kyber768();
  const [mlkem_pub, mlkem_sk] = await kyber.deriveKeyPair(mlkemSeed);

  return { x25519_sk, x25519_pub, mlkem_sk, mlkem_pub };
}

/** Receiver KEM public-key registration (mirrors tet-core `keys.rs::TmailKeyRegistrationV1`). */
export type TmailKeyRegistrationV1 = {
  wallet_id: string;
  x25519_pub_b64: string;
  mlkem_pub_b64: string;
  registered_at_ms: number;
  hybrid_sig: TmailHybridSig;
};

/**
 * Hybrid-signature preimage for a key registration — byte-exact with tet-core
 * `keys.rs::tmail_key_registration_auth_message_bytes`.
 */
export function tmailKeyRegistrationAuthMessageBytes(opts: {
  walletId: string;
  x25519PubB64: string;
  mlkemPubB64: string;
  registeredAtMs: number;
  mldsaPubkeyB64: string;
  chainId: string;
  genesisHash: string;
}): Uint8Array {
  const line =
    `tet tmail key v1|chain_id=${opts.chainId}|genesis_hash=${opts.genesisHash}` +
    `|wallet_id=${opts.walletId.trim().toLowerCase()}` +
    `|x25519_pub=${opts.x25519PubB64.trim()}` +
    `|mlkem_pub=${opts.mlkemPubB64.trim()}` +
    `|registered_at_ms=${opts.registeredAtMs}` +
    `|mldsa_pk=${opts.mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

/**
 * Build a hybrid-signed {@link TmailKeyRegistrationV1} for the unlocked wallet. The Ed25519 signer
 * (= `wallet_id`) and the ML-DSA keypair come from the active hybrid signer session; the X25519 /
 * ML-KEM public keys come from {@link deriveTmailKeysFromMnemonic}.
 */
export async function buildTmailKeyRegistrationV1(opts: {
  x25519_pub: Uint8Array;
  mlkem_pub: Uint8Array;
  baseUrl?: string;
  registeredAtMs?: number;
}): Promise<TmailKeyRegistrationV1> {
  const sess = requireHybridSignerSession();
  const walletId = sess.walletIdHex64.trim().toLowerCase();
  const x25519PubB64 = bytesToB64(opts.x25519_pub);
  const mlkemPubB64 = bytesToB64(opts.mlkem_pub);
  const registeredAtMs = opts.registeredAtMs ?? Date.now();

  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = tmailKeyRegistrationAuthMessageBytes({
    walletId,
    x25519PubB64,
    mlkemPubB64,
    registeredAtMs,
    mldsaPubkeyB64: sess.mldsa44_pubkey_b64,
    chainId,
    genesisHash,
  });

  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  return {
    wallet_id: walletId,
    x25519_pub_b64: x25519PubB64,
    mlkem_pub_b64: mlkemPubB64,
    registered_at_ms: registeredAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: walletId,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
  };
}
