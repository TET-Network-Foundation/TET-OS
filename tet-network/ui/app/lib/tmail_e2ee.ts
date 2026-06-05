/**
 * Tmail Basic E2EE primitives — byte-compatible with tet-core `src/e2ee.rs`.
 *
 * Suite (must match `e2ee.rs` exactly):
 *   - X25519 key agreement (sender ephemeral SK ✕ receiver static PK)
 *   - ML-KEM-768 / Kyber768 (round-3, PQClean-derived) encapsulation against the receiver PK
 *   - HKDF-SHA256(ikm = x25519_shared ‖ mlkem_shared, salt = 32 zero bytes, info = "tet-e2ee-hybrid-v1") → 32-byte key
 *   - ChaCha20-Poly1305 AEAD, 12-byte nonce, no AAD
 *
 * Tmail crypto is client-to-client: the sender UI encrypts and the receiver UI decrypts. The node
 * only forwards/buffers the opaque ciphertext bundle (never decrypts), so this scheme is symmetric
 * with `e2ee.rs` and self-consistent across the two UI peers (same Kyber768 implementation on both
 * ends via `crystals-kyber-js`, which matches Rust `pqcrypto_kyber::kyber768`).
 */

import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { Kyber768 } from "crystals-kyber-js";

/** HKDF `info` — mirrors `e2ee.rs` `derive_key_hybrid(.., b"tet-e2ee-hybrid-v1")`. */
const HKDF_INFO = new TextEncoder().encode("tet-e2ee-hybrid-v1");
/** HKDF salt — `e2ee.rs` uses `Hkdf::<Sha256>::new(None, ..)` ≡ a 32-byte zero salt (RFC 5869). */
const HKDF_SALT = new Uint8Array(32);

/** X25519 / Kyber768 / ChaCha20-Poly1305 fixed sizes (bytes). */
export const X25519_PUB_LEN = 32;
export const X25519_SK_LEN = 32;
export const MLKEM768_PUB_LEN = 1184;
export const MLKEM768_SK_LEN = 2400;
export const MLKEM768_CT_LEN = 1088;
export const AEAD_NONCE_LEN = 12;

/**
 * Ciphertext bundle produced by {@link encryptForReceiver}. All `Uint8Array`s are raw bytes; the
 * envelope builder base64-encodes them into `TmailE2eeBlock`.
 */
export type CiphertextBundle = {
  /** Sender ephemeral X25519 public key (32 bytes). */
  client_ephemeral_pub: Uint8Array;
  /**
   * Unused for the sender→receiver direction (shared secret uses the receiver's ML-KEM key). Kept
   * for byte-symmetry with `e2ee.rs` response flows; always zero-length here.
   */
  client_mlkem_pub: Uint8Array;
  /** Kyber768 encapsulation ciphertext (1088 bytes). */
  mlkem_ciphertext: Uint8Array;
  /** ChaCha20-Poly1305 nonce (12 bytes). */
  nonce: Uint8Array;
  /** ChaCha20-Poly1305 ciphertext ‖ 16-byte Poly1305 tag. */
  ciphertext: Uint8Array;
};

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** HKDF-SHA256 hybrid key derivation — mirrors `e2ee.rs::derive_key_hybrid`. */
function deriveKeyHybrid(x25519Shared: Uint8Array, mlkemShared: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(x25519Shared.length + mlkemShared.length);
  ikm.set(x25519Shared, 0);
  ikm.set(mlkemShared, x25519Shared.length);
  return hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32);
}

/**
 * Encrypt `plaintext` for a receiver given their registered static X25519 + ML-KEM-768 public keys.
 * Generates a fresh ephemeral X25519 keypair and a fresh Kyber768 encapsulation per call.
 */
export async function encryptForReceiver(
  plaintext: Uint8Array,
  receiver_x25519_pub: Uint8Array,
  receiver_mlkem_pub: Uint8Array,
): Promise<CiphertextBundle> {
  if (receiver_x25519_pub.length !== X25519_PUB_LEN) {
    throw new Error(`receiver x25519 pub must be ${X25519_PUB_LEN} bytes`);
  }
  if (receiver_mlkem_pub.length !== MLKEM768_PUB_LEN) {
    throw new Error(`receiver ML-KEM-768 pub must be ${MLKEM768_PUB_LEN} bytes`);
  }

  const ephemeralSk = randomBytes(X25519_SK_LEN);
  const ephemeralPub = x25519.getPublicKey(ephemeralSk);
  const x25519Shared = x25519.getSharedSecret(ephemeralSk, receiver_x25519_pub);

  const kyber = new Kyber768();
  const [mlkemCt, mlkemShared] = await kyber.encap(receiver_mlkem_pub);

  const key = deriveKeyHybrid(x25519Shared, mlkemShared);
  const nonce = randomBytes(AEAD_NONCE_LEN);
  const ciphertext = chacha20poly1305(key, nonce).encrypt(plaintext);

  return {
    client_ephemeral_pub: ephemeralPub,
    client_mlkem_pub: new Uint8Array(0),
    mlkem_ciphertext: mlkemCt,
    nonce,
    ciphertext,
  };
}

/** Subset of {@link CiphertextBundle} needed to decrypt (sender's ephemeral pub + KEM ct + AEAD). */
export type CiphertextBundleForDecrypt = {
  client_ephemeral_pub: Uint8Array;
  mlkem_ciphertext: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

/**
 * Decrypt a {@link CiphertextBundle} with the receiver's static X25519 + ML-KEM-768 secret keys.
 * Throws if the Poly1305 tag fails (wrong recipient or tampered ciphertext).
 */
export async function decryptForReceiver(
  bundle: CiphertextBundleForDecrypt,
  receiver_x25519_sk: Uint8Array,
  receiver_mlkem_sk: Uint8Array,
): Promise<Uint8Array> {
  if (receiver_x25519_sk.length !== X25519_SK_LEN) {
    throw new Error(`receiver x25519 sk must be ${X25519_SK_LEN} bytes`);
  }
  if (bundle.client_ephemeral_pub.length !== X25519_PUB_LEN) {
    throw new Error(`client ephemeral pub must be ${X25519_PUB_LEN} bytes`);
  }

  const x25519Shared = x25519.getSharedSecret(receiver_x25519_sk, bundle.client_ephemeral_pub);

  const kyber = new Kyber768();
  const mlkemShared = await kyber.decap(bundle.mlkem_ciphertext, receiver_mlkem_sk);

  const key = deriveKeyHybrid(x25519Shared, mlkemShared);
  return chacha20poly1305(key, bundle.nonce).decrypt(bundle.ciphertext);
}
