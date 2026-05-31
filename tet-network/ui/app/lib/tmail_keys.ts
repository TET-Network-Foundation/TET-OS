/**
 * Deterministic Tmail KEM key derivation from a BIP39 mnemonic.
 *
 * The same 12-word phrase that backs the wallet's Ed25519 + ML-DSA keys also derives the messaging
 * keys, so users never manage a separate secret. Derivation is local-only; only the **public** keys
 * are published to the node key directory (`PUT /tmail/keys/:wallet_id`).
 *
 * Scheme:
 *   seed         = BIP39 mnemonicToSeed(phrase, "")            (64 bytes; matches @scure/bip39)
 *   x25519_sk    = HKDF-SHA256(seed, salt=0^32, info="tet-tmail-x25519-v1", 32)
 *   x25519_pub   = X25519.getPublicKey(x25519_sk)
 *   mlkem_seed   = HKDF-SHA256(seed, salt=0^32, info="tet-tmail-mlkem-v1", 64)
 *   (mlkem_pub, mlkem_sk) = Kyber768.deriveKeyPair(mlkem_seed)  (Round-3 CRYSTALS-KYBER)
 *
 * Mirrors the spirit of `ed25519_tet.ts` (BIP39 → key material), reusing its mnemonic normalizer.
 */

import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { Kyber768 } from "crystals-kyber-js";
import { normalizeMnemonicPhrase } from "./ed25519_tet";

/** HKDF salt — RFC 5869 default (32 zero bytes), consistent with the rest of the suite. */
const HKDF_SALT: Uint8Array = new Uint8Array(32);
const INFO_X25519: Uint8Array = new TextEncoder().encode("tet-tmail-x25519-v1");
const INFO_MLKEM: Uint8Array = new TextEncoder().encode("tet-tmail-mlkem-v1");

export type TmailKemKeys = {
  x25519_sk: Uint8Array;
  x25519_pub: Uint8Array;
  mlkem_sk: Uint8Array;
  mlkem_pub: Uint8Array;
};

/**
 * Derive the deterministic X25519 + Kyber768 keypairs for Tmail from a BIP39 mnemonic.
 * @throws Error on an invalid mnemonic.
 */
export async function deriveTmailKeysFromMnemonic(mnemonic: string): Promise<TmailKemKeys> {
  const norm = normalizeMnemonicPhrase(mnemonic);
  if (!validateMnemonic(norm, wordlist)) {
    throw new Error("invalid mnemonic");
  }
  const seed = mnemonicToSeedSync(norm, "");

  const x25519_sk = hkdf(sha256, seed, HKDF_SALT, INFO_X25519, 32);
  const x25519_pub = x25519.getPublicKey(x25519_sk);

  const mlkemSeed = hkdf(sha256, seed, HKDF_SALT, INFO_MLKEM, 64);
  const kyber = new Kyber768();
  const [mlkem_pub, mlkem_sk] = await kyber.deriveKeyPair(mlkemSeed);

  return { x25519_sk, x25519_pub, mlkem_sk, mlkem_pub };
}
