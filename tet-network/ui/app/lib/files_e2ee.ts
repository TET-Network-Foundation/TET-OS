/**
 * File Sharing Basic E2EE primitives — same crypto stack as Tmail (`tmail_e2ee.ts`), tuned to the
 * File Sharing spec (`docs/PHASE_0_FILE_SHARING_SPEC.md` §3).
 *
 * Suite:
 *   - X25519 key agreement (sender ephemeral SK ✕ receiver static PK)
 *   - ML-KEM-768 / Kyber768 (round-3) encapsulation against the receiver PK
 *   - HKDF-SHA256(ikm = x25519_shared ‖ mlkem_shared, salt = 32 zero bytes, info = "tet-file-v1")
 *     → one 32-byte key (NOTE: distinct info from Tmail's "tet-e2ee-hybrid-v1")
 *   - ChaCha20-Poly1305 AEAD, 12-byte nonce, no AAD
 *
 * A single hybrid KEM encapsulation yields one key; the filename, MIME type, and body are each
 * encrypted under that key with a **distinct** nonce (spec §3). The node is a blind relay — it never
 * derives this key or sees plaintext. Signing lives in `files.ts` (mirrors Tmail's split).
 */

import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { Kyber768 } from "crystals-kyber-js";

/** HKDF `info` for the per-file key (spec §3 / §9) — differs from Tmail. */
const HKDF_INFO = new TextEncoder().encode("tet-file-v1");
/** HKDF salt — 32 zero bytes (RFC 5869 `None` salt), matching the Rust stack. */
const HKDF_SALT = new Uint8Array(32);

export const X25519_PUB_LEN = 32;
export const X25519_SK_LEN = 32;
export const MLKEM768_PUB_LEN = 1184;
export const AEAD_NONCE_LEN = 12;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** HKDF-SHA256 hybrid key derivation (info = "tet-file-v1"). */
function deriveKeyHybrid(x25519Shared: Uint8Array, mlkemShared: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(x25519Shared.length + mlkemShared.length);
  ikm.set(x25519Shared, 0);
  ikm.set(mlkemShared, x25519Shared.length);
  return hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32);
}

/** Encrypted file material produced by {@link encryptFileForReceiver}. All fields are raw bytes. */
export type FileCiphertextBundle = {
  /** Sender ephemeral X25519 public key (32 bytes). */
  client_ephemeral_pub: Uint8Array;
  /** Kyber768 encapsulation ciphertext (1088 bytes). */
  mlkem_ciphertext: Uint8Array;
  filename_nonce: Uint8Array;
  mime_nonce: Uint8Array;
  body_nonce: Uint8Array;
  /** AEAD ciphertext (‖ 16-byte tag) of the UTF-8 filename. */
  filename_ciphertext: Uint8Array;
  /** AEAD ciphertext (‖ tag) of the MIME type. */
  mime_ciphertext: Uint8Array;
  /** AEAD ciphertext (‖ tag) of the file body — uploaded as the blob. */
  body_ciphertext: Uint8Array;
};

/**
 * Encrypt a file's body + filename + MIME for a receiver, given their registered static X25519 +
 * ML-KEM-768 public keys. One fresh ephemeral X25519 keypair + one Kyber768 encapsulation per call;
 * three distinct nonces (filename / MIME / body) under the single derived key.
 */
export async function encryptFileForReceiver(opts: {
  fileBytes: Uint8Array;
  filename: string;
  mimeType: string;
  receiver_x25519_pub: Uint8Array;
  receiver_mlkem_pub: Uint8Array;
}): Promise<FileCiphertextBundle> {
  if (opts.receiver_x25519_pub.length !== X25519_PUB_LEN) {
    throw new Error(`receiver x25519 pub must be ${X25519_PUB_LEN} bytes`);
  }
  if (opts.receiver_mlkem_pub.length !== MLKEM768_PUB_LEN) {
    throw new Error(`receiver ML-KEM-768 pub must be ${MLKEM768_PUB_LEN} bytes`);
  }

  const ephemeralSk = randomBytes(X25519_SK_LEN);
  const ephemeralPub = x25519.getPublicKey(ephemeralSk);
  const x25519Shared = x25519.getSharedSecret(ephemeralSk, opts.receiver_x25519_pub);

  const kyber = new Kyber768();
  const [mlkemCt, mlkemShared] = await kyber.encap(opts.receiver_mlkem_pub);

  const key = deriveKeyHybrid(x25519Shared, mlkemShared);
  const enc = new TextEncoder();
  const filename_nonce = randomBytes(AEAD_NONCE_LEN);
  const mime_nonce = randomBytes(AEAD_NONCE_LEN);
  const body_nonce = randomBytes(AEAD_NONCE_LEN);

  const filename_ciphertext = chacha20poly1305(key, filename_nonce).encrypt(enc.encode(opts.filename));
  const mime_ciphertext = chacha20poly1305(key, mime_nonce).encrypt(enc.encode(opts.mimeType));
  const body_ciphertext = chacha20poly1305(key, body_nonce).encrypt(opts.fileBytes);

  return {
    client_ephemeral_pub: ephemeralPub,
    mlkem_ciphertext: mlkemCt,
    filename_nonce,
    mime_nonce,
    body_nonce,
    filename_ciphertext,
    mime_ciphertext,
    body_ciphertext,
  };
}

/** KEM material + filename/MIME ciphertexts — enough to label an inbox row without the body. */
export type FileMetaForDecrypt = {
  client_ephemeral_pub: Uint8Array;
  mlkem_ciphertext: Uint8Array;
  filename_nonce: Uint8Array;
  mime_nonce: Uint8Array;
  filename_ciphertext: Uint8Array;
  mime_ciphertext: Uint8Array;
};

/**
 * Decrypt only the filename + MIME type (no body) — used to render an inbox row before the (larger)
 * encrypted blob is fetched on demand. Performs one KEM decapsulation.
 */
export async function decryptFileMeta(
  meta: FileMetaForDecrypt,
  receiver_x25519_sk: Uint8Array,
  receiver_mlkem_sk: Uint8Array,
): Promise<{ filename: string; mimeType: string }> {
  if (receiver_x25519_sk.length !== X25519_SK_LEN) {
    throw new Error(`receiver x25519 sk must be ${X25519_SK_LEN} bytes`);
  }
  if (meta.client_ephemeral_pub.length !== X25519_PUB_LEN) {
    throw new Error(`client ephemeral pub must be ${X25519_PUB_LEN} bytes`);
  }
  const x25519Shared = x25519.getSharedSecret(receiver_x25519_sk, meta.client_ephemeral_pub);
  const kyber = new Kyber768();
  const mlkemShared = await kyber.decap(meta.mlkem_ciphertext, receiver_mlkem_sk);
  const key = deriveKeyHybrid(x25519Shared, mlkemShared);
  const dec = new TextDecoder();
  const filename = dec.decode(chacha20poly1305(key, meta.filename_nonce).decrypt(meta.filename_ciphertext));
  const mimeType = dec.decode(chacha20poly1305(key, meta.mime_nonce).decrypt(meta.mime_ciphertext));
  return { filename, mimeType };
}

/** Bytes needed to decrypt a received file (KEM material + per-field nonces + ciphertexts). */
export type FileCiphertextForDecrypt = {
  client_ephemeral_pub: Uint8Array;
  mlkem_ciphertext: Uint8Array;
  filename_nonce: Uint8Array;
  mime_nonce: Uint8Array;
  body_nonce: Uint8Array;
  filename_ciphertext: Uint8Array;
  mime_ciphertext: Uint8Array;
  body_ciphertext: Uint8Array;
};

/** Plaintext recovered from a received file. */
export type DecryptedFile = {
  fileBytes: Uint8Array;
  filename: string;
  mimeType: string;
};

/**
 * Decrypt a {@link FileCiphertextForDecrypt} with the receiver's static X25519 + ML-KEM-768 secret
 * keys. Throws if any Poly1305 tag fails (wrong recipient or tampered ciphertext).
 */
export async function decryptFileForReceiver(
  bundle: FileCiphertextForDecrypt,
  receiver_x25519_sk: Uint8Array,
  receiver_mlkem_sk: Uint8Array,
): Promise<DecryptedFile> {
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

  const dec = new TextDecoder();
  const filename = dec.decode(chacha20poly1305(key, bundle.filename_nonce).decrypt(bundle.filename_ciphertext));
  const mimeType = dec.decode(chacha20poly1305(key, bundle.mime_nonce).decrypt(bundle.mime_ciphertext));
  const fileBytes = chacha20poly1305(key, bundle.body_nonce).decrypt(bundle.body_ciphertext);

  return { fileBytes, filename, mimeType };
}
