/**
 * Ed25519 key derivation matching tet-core `wallet::signing_key_from_mnemonic`
 * (BIP39 `to_seed("")` → first 32 bytes → ed25519_dalek / @noble/ed25519).
 */
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";

/** @noble/ed25519 v3: wire SHA-512 (RFC 8032). */
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(sha512(m));
ed.hashes.sha512Async = async (m: Uint8Array) => new Uint8Array(sha512(m));

export type TetEd25519Keypair = {
  /** 32-byte secret scalar (BIP39 seed prefix). */
  secretKey: Uint8Array;
  /** 32-byte public key. */
  publicKey: Uint8Array;
  /** 64-char lowercase hex wallet_id (Ed25519 verifying key). */
  walletIdHex: string;
};

export function normalizeMnemonicPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

/** BIP39 seed[0..32] — matches `wallet.rs` `signing_key_from_mnemonic`. */
export function tetSecretKey32FromMnemonic(mnemonic: string): Uint8Array {
  const norm = normalizeMnemonicPhrase(mnemonic);
  if (!validateMnemonic(norm, wordlist)) {
    throw new Error("invalid mnemonic");
  }
  const seed = mnemonicToSeedSync(norm, "");
  return seed.subarray(0, 32);
}

export function mnemonicToTetEd25519Keypair(mnemonic: string): TetEd25519Keypair {
  const sk = tetSecretKey32FromMnemonic(mnemonic);
  const publicKey = ed.getPublicKey(sk);
  return {
    secretKey: sk,
    publicKey,
    walletIdHex: bytesToHex(publicKey),
  };
}

export async function signTetEd25519(
  secretKey: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  return ed.sign(message, secretKey);
}

export async function verifyTetEd25519(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  return ed.verify(signature, message, publicKey);
}
