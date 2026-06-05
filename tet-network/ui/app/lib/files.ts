/**
 * File Sharing envelope builder — constructs a hybrid-signed `FileEnvelopeV1` in the browser,
 * byte-compatible with tet-core `src/files/mod.rs` (struct serde shape + §3.1 preimage).
 *
 * Pipeline: generate `file_id` → E2EE the body/filename/MIME for the receiver (`files_e2ee.ts`) →
 * `file_sha256` over the encrypted body → build the §3.1 preimage → hybrid (Ed25519 + ML-DSA) sign →
 * assemble the envelope. The encrypted body is returned alongside for the multipart upload.
 */

import { encryptFileForReceiver } from "./files_e2ee";
import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { bytesToB64, bytesToHex } from "./encoding";
import { sha256 } from "@noble/hashes/sha2";

/** Stable `kind` discriminator — mirrors Rust `FILE_ENVELOPE_KIND`. */
export const FILE_ENVELOPE_KIND = "file_envelope_v1";
/** E2EE scheme identifier — mirrors Rust `FILE_E2EE_SCHEME`. */
export const FILE_E2EE_SCHEME = "tet-file-hybrid-v1";
/** Per-file fee (µTET), bound into the signature — mirrors Rust `FILE_FEE_MICRO`. Settled in Step 4. */
export const FILE_FEE_MICRO = 1000;
/** Default envelope TTL (30 days) — the node clamps to its own max. */
export const FILE_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Phase 0 hard cap on the encrypted body size (5 MiB) — mirrors Rust `MAX_FILE_BODY_BYTES`. */
export const MAX_FILE_BODY_BYTES = 5 * 1024 * 1024;

export type FileHybridSig = {
  ed25519_pubkey_hex: string;
  ed25519_sig_b64: string;
  mldsa_pubkey_b64: string;
  mldsa_sig_b64: string;
};

/** E2EE material (spec §3) — mirrors Rust `FileE2eeBlock`. */
export type FileE2eeBlock = {
  v: number;
  scheme: string;
  client_ephemeral_pub_b64: string;
  receiver_x25519_pub_b64: string;
  receiver_mlkem_pub_b64: string;
  mlkem_ciphertext_b64: string;
  filename_nonce_b64: string;
  mime_nonce_b64: string;
  body_nonce_b64: string;
};

/** File transfer envelope (spec §3) — mirrors Rust `FileEnvelopeV1`. */
export type FileEnvelopeV1 = {
  v: number;
  kind: string;
  file_id: string;
  sender_wallet_id: string;
  receiver_wallet_id: string;
  file_size: number;
  file_sha256: string;
  filename_encrypted_b64: string;
  mime_type_encrypted_b64: string;
  storage_node: string;
  fee_micro: number;
  created_at_ms: number;
  ttl_ms: number;
  e2ee: FileE2eeBlock;
  hybrid_sig: FileHybridSig;
};

/** Sender-authenticated delete request (spec §5) — mirrors Rust `FileDeleteRequestV1`. */
export type FileDeleteRequestV1 = {
  file_id: string;
  sender_wallet_id: string;
  created_at_ms: number;
  hybrid_sig: FileHybridSig;
};

/**
 * §3.1 hybrid-signature preimage — byte-exact with Rust `files::file_envelope_preimage_v1`.
 */
export function fileEnvelopeAuthMessageBytes(opts: {
  chainId: string;
  genesisHash: string;
  fileId: string;
  senderWalletId: string;
  receiverWalletId: string;
  fileSize: number;
  fileSha256Hex: string;
  filenameEncryptedB64: string;
  mimeTypeEncryptedB64: string;
  storageNode: string;
  feeMicro: number;
  createdAtMs: number;
  mldsaPubkeyB64: string;
}): Uint8Array {
  const line =
    `tet file envelope v1|chain_id=${opts.chainId}|genesis_hash=${opts.genesisHash}` +
    `|file_id=${opts.fileId}` +
    `|sender=${opts.senderWalletId.trim().toLowerCase()}` +
    `|receiver=${opts.receiverWalletId.trim().toLowerCase()}` +
    `|size=${opts.fileSize}` +
    `|sha256=${opts.fileSha256Hex.trim().toLowerCase()}` +
    `|filename=${opts.filenameEncryptedB64.trim()}` +
    `|mime=${opts.mimeTypeEncryptedB64.trim()}` +
    `|storage_node=${opts.storageNode.trim()}` +
    `|fee_micro=${opts.feeMicro}` +
    `|created_at_ms=${opts.createdAtMs}` +
    `|mldsa_pk=${opts.mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

/** §5 delete preimage — byte-exact with Rust `files::file_delete_preimage_v1`. */
export function fileDeleteAuthMessageBytes(opts: {
  chainId: string;
  genesisHash: string;
  fileId: string;
  senderWalletId: string;
  createdAtMs: number;
  mldsaPubkeyB64: string;
}): Uint8Array {
  const line =
    `tet file delete v1|chain_id=${opts.chainId}|genesis_hash=${opts.genesisHash}` +
    `|file_id=${opts.fileId}` +
    `|sender=${opts.senderWalletId.trim().toLowerCase()}` +
    `|created_at_ms=${opts.createdAtMs}` +
    `|mldsa_pk=${opts.mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

function newFileId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback RFC-4122 v4 from random bytes.
  const r = new Uint8Array(16);
  globalThis.crypto.getRandomValues(r);
  r[6] = (r[6]! & 0x0f) | 0x40;
  r[8] = (r[8]! & 0x3f) | 0x80;
  const h = bytesToHex(r);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type BuildFileEnvelopeOpts = {
  senderWalletId: string;
  receiverWalletId: string;
  fileBytes: Uint8Array;
  filename: string;
  mimeType: string;
  receiverX25519Pub: Uint8Array;
  receiverMlkemPub: Uint8Array;
  /** libp2p PeerId of the storage node. Phase 0 uses the local node ("local" sentinel). */
  storageNode?: string;
  baseUrl?: string;
  feeMicro?: number;
  ttlMs?: number;
};

export type BuiltFileEnvelope = {
  envelope: FileEnvelopeV1;
  /** Encrypted body — upload as the `body` multipart field. */
  bodyCiphertext: Uint8Array;
};

/**
 * Build a hybrid-signed {@link FileEnvelopeV1}. Requires an unlocked hybrid signer session whose
 * `walletIdHex64` matches `senderWalletId`. Returns the envelope + the encrypted body to upload.
 */
export async function buildFileEnvelopeV1(opts: BuildFileEnvelopeOpts): Promise<BuiltFileEnvelope> {
  const sess = requireHybridSignerSession();
  const sender = opts.senderWalletId.trim().toLowerCase();
  const receiver = opts.receiverWalletId.trim().toLowerCase();
  if (sender !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match sender wallet.");
  }
  if (!/^[0-9a-f]{64}$/.test(receiver)) {
    throw new Error("Recipient wallet id must be 64 lowercase hex chars.");
  }
  if (opts.fileBytes.length === 0) {
    throw new Error("File is empty.");
  }

  const bundle = await encryptFileForReceiver({
    fileBytes: opts.fileBytes,
    filename: opts.filename,
    mimeType: opts.mimeType || "application/octet-stream",
    receiver_x25519_pub: opts.receiverX25519Pub,
    receiver_mlkem_pub: opts.receiverMlkemPub,
  });

  const bodyCiphertext = bundle.body_ciphertext;
  const fileSize = bodyCiphertext.length;
  if (fileSize > MAX_FILE_BODY_BYTES) {
    throw new Error(`Encrypted file exceeds the ${MAX_FILE_BODY_BYTES} byte limit.`);
  }
  const fileSha256Hex = bytesToHex(sha256(bodyCiphertext));
  const filenameEncryptedB64 = bytesToB64(bundle.filename_ciphertext);
  const mimeTypeEncryptedB64 = bytesToB64(bundle.mime_ciphertext);
  const storageNode = (opts.storageNode ?? "local").trim() || "local";
  const feeMicro = opts.feeMicro ?? FILE_FEE_MICRO;
  const ttlMs = opts.ttlMs ?? FILE_DEFAULT_TTL_MS;
  const createdAtMs = Date.now();
  const fileId = newFileId();

  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = fileEnvelopeAuthMessageBytes({
    chainId,
    genesisHash,
    fileId,
    senderWalletId: sender,
    receiverWalletId: receiver,
    fileSize,
    fileSha256Hex,
    filenameEncryptedB64,
    mimeTypeEncryptedB64,
    storageNode,
    feeMicro,
    createdAtMs,
    mldsaPubkeyB64: sess.mldsa44_pubkey_b64,
  });

  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  const e2ee: FileE2eeBlock = {
    v: 1,
    scheme: FILE_E2EE_SCHEME,
    client_ephemeral_pub_b64: bytesToB64(bundle.client_ephemeral_pub),
    receiver_x25519_pub_b64: bytesToB64(opts.receiverX25519Pub),
    receiver_mlkem_pub_b64: bytesToB64(opts.receiverMlkemPub),
    mlkem_ciphertext_b64: bytesToB64(bundle.mlkem_ciphertext),
    filename_nonce_b64: bytesToB64(bundle.filename_nonce),
    mime_nonce_b64: bytesToB64(bundle.mime_nonce),
    body_nonce_b64: bytesToB64(bundle.body_nonce),
  };

  const envelope: FileEnvelopeV1 = {
    v: 1,
    kind: FILE_ENVELOPE_KIND,
    file_id: fileId,
    sender_wallet_id: sender,
    receiver_wallet_id: receiver,
    file_size: fileSize,
    file_sha256: fileSha256Hex,
    filename_encrypted_b64: filenameEncryptedB64,
    mime_type_encrypted_b64: mimeTypeEncryptedB64,
    storage_node: storageNode,
    fee_micro: feeMicro,
    created_at_ms: createdAtMs,
    ttl_ms: ttlMs,
    e2ee,
    hybrid_sig: {
      ed25519_pubkey_hex: sender,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
  };

  return { envelope, bodyCiphertext };
}

/**
 * Build a hybrid-signed {@link FileDeleteRequestV1} (sender-only cancel). Requires the unlocked
 * hybrid signer session for `senderWalletId`.
 */
export async function buildFileDeleteRequestV1(opts: {
  fileId: string;
  senderWalletId: string;
  baseUrl?: string;
}): Promise<FileDeleteRequestV1> {
  const sess = requireHybridSignerSession();
  const sender = opts.senderWalletId.trim().toLowerCase();
  if (sender !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match sender wallet.");
  }
  const createdAtMs = Date.now();
  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = fileDeleteAuthMessageBytes({
    chainId,
    genesisHash,
    fileId: opts.fileId,
    senderWalletId: sender,
    createdAtMs,
    mldsaPubkeyB64: sess.mldsa44_pubkey_b64,
  });
  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);
  return {
    file_id: opts.fileId,
    sender_wallet_id: sender,
    created_at_ms: createdAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: sender,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
  };
}
