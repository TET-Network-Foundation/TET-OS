/**
 * Tmail E2EE — byte-level compatible with tet-core `src/e2ee.rs` (`encrypt_for_worker` /
 * `decrypt_on_worker`), the same hybrid scheme used for AI-inference E2EE.
 *
 * Suite (must match e2ee.rs exactly):
 *   - X25519 (sender ephemeral SK × receiver static PK) → 32-byte shared
 *   - Kyber768 **Round 3** KEM encapsulation to the receiver's ML-KEM public key → (ct, ss)
 *       IMPORTANT: tet-core uses `pqcrypto_kyber::kyber768` (CRYSTALS-Kyber Round 3), which is
 *       byte-incompatible with FIPS-203 ML-KEM-768. We therefore use `crystals-kyber-js@^1`
 *       (Round-3 CRYSTALS-KYBER) so a Rust reader using e2ee.rs could decapsulate identically.
 *   - HKDF-SHA256(salt = 32 zero bytes [Rust `Hkdf::new(None, ..)`], ikm = x25519_shared ‖ kem_ss,
 *       info = "tet-e2ee-hybrid-v1") → 32-byte key
 *   - ChaCha20-Poly1305 AEAD, 12-byte nonce, empty AAD (ciphertext = body ‖ 16-byte tag)
 *
 * For Tmail both encrypt (sender) and decrypt (receiver) run client-side in the browser; the node
 * only relays/buffers the opaque envelope.
 */

import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { Kyber768 } from "crystals-kyber-js";

/** HKDF `info` context — identical to e2ee.rs `derive_key_hybrid(.., b"tet-e2ee-hybrid-v1")`. */
const HKDF_INFO: Uint8Array = new TextEncoder().encode("tet-e2ee-hybrid-v1");
/** HKDF salt — Rust `Hkdf::<Sha256>::new(None, ..)` uses HashLen (32) zero bytes (RFC 5869 §2.2). */
const HKDF_SALT: Uint8Array = new Uint8Array(32);

/** Sender-side ciphertext bundle (mirrors the fields stored in the envelope `e2ee` block). */
export type CiphertextBundle = {
  /** 32-byte ephemeral X25519 public key. */
  client_ephemeral_pub: Uint8Array;
  /** Unused for the sender→receiver direction (kept for parity; empty). */
  client_mlkem_pub: Uint8Array;
  /** Kyber768 (Round 3) ciphertext (1088 bytes). */
  mlkem_ciphertext: Uint8Array;
  /** 12-byte ChaCha20-Poly1305 nonce. */
  nonce: Uint8Array;
  /** AEAD ciphertext (body ‖ 16-byte Poly1305 tag). */
  ciphertext: Uint8Array;
};

/** Receiver-side input needed to decrypt (subset of {@link CiphertextBundle}). */
export type DecryptBundle = {
  client_ephemeral_pub: Uint8Array;
  mlkem_ciphertext: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

function deriveHybridKey(x25519Shared: Uint8Array, mlkemShared: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(x25519Shared.length + mlkemShared.length);
  ikm.set(x25519Shared, 0);
  ikm.set(mlkemShared, x25519Shared.length);
  return hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32);
}

/**
 * Encrypt `plaintext` for a receiver given their registered X25519 + Kyber768 public keys.
 * Mirrors e2ee.rs `encrypt_for_worker` (receiver plays the worker role).
 */
export async function encryptForReceiver(
  plaintext: Uint8Array,
  receiver_x25519_pub: Uint8Array,
  receiver_mlkem_pub: Uint8Array,
): Promise<CiphertextBundle> {
  if (receiver_x25519_pub.length !== 32) {
    throw new Error("receiver X25519 public key must be 32 bytes");
  }
  const ephemeralSk = crypto.getRandomValues(new Uint8Array(32));
  const ephemeralPub = x25519.getPublicKey(ephemeralSk);
  const x25519Shared = x25519.getSharedSecret(ephemeralSk, receiver_x25519_pub);

  const kyber = new Kyber768();
  const [mlkemCt, kemSs] = await kyber.encap(receiver_mlkem_pub);

  const key = deriveHybridKey(x25519Shared, kemSs);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = chacha20poly1305(key, nonce).encrypt(plaintext);

  return {
    client_ephemeral_pub: ephemeralPub,
    client_mlkem_pub: new Uint8Array(0),
    mlkem_ciphertext: mlkemCt,
    nonce,
    ciphertext,
  };
}

/**
 * Decrypt a bundle addressed to the receiver, using their X25519 + Kyber768 secret keys.
 * Mirrors e2ee.rs `decrypt_on_worker`. Throws on authentication failure (wrong recipient/corrupt).
 */
export async function decryptForReceiver(
  bundle: DecryptBundle,
  receiver_x25519_sk: Uint8Array,
  receiver_mlkem_sk: Uint8Array,
): Promise<Uint8Array> {
  const x25519Shared = x25519.getSharedSecret(receiver_x25519_sk, bundle.client_ephemeral_pub);
  const kyber = new Kyber768();
  const kemSs = await kyber.decap(bundle.mlkem_ciphertext, receiver_mlkem_sk);
  const key = deriveHybridKey(x25519Shared, kemSs);
  return chacha20poly1305(key, bundle.nonce).decrypt(bundle.ciphertext);
}
