/**
 * What the page checks itself, instead of trusting the node (SECURITY.md, 2026-10-10):
 *
 * 1. **Recipient keys.** Before encrypting to someone (DM, files, Shelter's sealed key), the page
 *    fetches their messaging keys and checks the registration is signed by *their* wallet:
 *    Ed25519 with the wallet id as the public key, plus ML-DSA-44, over the v2 PAE pre-image
 *    (`tmail_keys.ts`). A node that serves other keys for a wallet can't sign as that wallet, so it
 *    is caught. An older registration (not v2) is refused with a plain message, never used.
 * 2. **Senders.** Before the page shows who sent something, it checks the envelope's signature is
 *    the sender's (`verifyEnvelopeSender`).
 * 3. **Safety numbers.** Both of the above trust the wallet id you typed or scanned. A safety
 *    number is a short fingerprint of both people's keys: the same on both screens means nobody
 *    in between swapped them.
 *
 * Still trusted: this page's own code, which is served by the site you opened.
 */
import { sha256 } from "@noble/hashes/sha2";
import { expectedChainBinding } from "./chain_binding";
import { verifyTetEd25519 } from "./ed25519_tet";
import { b64ToBytes } from "./encoding";
import { mldsa44Verify } from "./pqc";
import { getTmailKeys } from "./tet_core_http";
import { tmailEnvelopeAuthMessageBytes, type TmailFlags } from "./tmail";
import { tmailKeyRegistrationAuthMessageBytes, type TmailKeyRegistrationV1 } from "./tmail_keys";
import { fileEnvelopeAuthMessageBytes, type FileEnvelopeV1 } from "./files";

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const HEX64 = /^[0-9a-f]{64}$/;
const MLDSA44_PUB = 1312;
const MLDSA44_SIG = 2420;

export const KEYS_LEGACY =
  "Their messaging keys are from an older version of TET. Ask them to open TET once to re-register, then try again.";
export const KEYS_NOT_THEIRS =
  "These messaging keys aren't signed by that ID, so nothing was sent. The node may be faulty or dishonest.";
export const KEYS_NONE = "That ID hasn't turned on its inbox yet: nothing was sent.";

export type KeyCheck = { ok: true } | { ok: false; reason: "legacy" | "not_theirs" };

/** Is `reg` a v2 registration signed by `walletId` itself (both signatures)? */
export async function verifyKeyRegistration(reg: TmailKeyRegistrationV1, walletId: string, baseUrl?: string): Promise<KeyCheck> {
  const w = walletId.trim().toLowerCase();
  if (reg?.v !== 2) return { ok: false, reason: "legacy" };
  if (!HEX64.test(w) || reg.wallet_id?.trim().toLowerCase() !== w || reg.hybrid_sig?.ed25519_pubkey_hex?.trim().toLowerCase() !== w) {
    return { ok: false, reason: "not_theirs" };
  }
  const sig = reg.hybrid_sig;
  try {
    if (b64ToBytes(sig.mldsa_pubkey_b64).length !== MLDSA44_PUB || b64ToBytes(sig.mldsa_sig_b64).length !== MLDSA44_SIG) {
      return { ok: false, reason: "not_theirs" };
    }
    const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
    const msg = tmailKeyRegistrationAuthMessageBytes({
      walletId: w,
      x25519PubB64: reg.x25519_pub_b64,
      mlkemPubB64: reg.mlkem_pub_b64,
      registeredAtMs: reg.registered_at_ms,
      mldsaPubkeyB64: sig.mldsa_pubkey_b64,
      chainId,
      genesisHash,
    });
    const ed = await verifyTetEd25519(hexToBytes(w), msg, b64ToBytes(sig.ed25519_sig_b64));
    const pq = await mldsa44Verify(sig.mldsa_pubkey_b64, sig.mldsa_sig_b64, msg);
    return ed && pq ? { ok: true } : { ok: false, reason: "not_theirs" };
  } catch {
    return { ok: false, reason: "not_theirs" };
  }
}

export type TrustedKeys =
  | { ok: true; registration: TmailKeyRegistrationV1; x25519Pub: Uint8Array; mlkemPub: Uint8Array }
  | { ok: false; reason: "none" | "legacy" | "not_theirs" | "unreachable"; message: string };

/** `walletId`'s messaging keys, only if its own wallet signed them. Use these to encrypt. */
export async function trustedKeysFor(baseUrl: string, walletId: string): Promise<TrustedKeys> {
  const r = await getTmailKeys(baseUrl, walletId);
  if (!r.ok) return { ok: false, reason: "unreachable", message: r.text || `could not look up their keys (HTTP ${r.status})` };
  if (!r.registration) return { ok: false, reason: "none", message: KEYS_NONE };
  const c = await verifyKeyRegistration(r.registration, walletId, baseUrl);
  if (!c.ok) return { ok: false, reason: c.reason, message: c.reason === "legacy" ? KEYS_LEGACY : KEYS_NOT_THEIRS };
  return { ok: true, registration: r.registration, x25519Pub: b64ToBytes(r.registration.x25519_pub_b64), mlkemPub: b64ToBytes(r.registration.mlkem_pub_b64) };
}

/** The fields of an envelope (or inbox row) the sender's signature covers. */
export type SignedEnvelopeFields = {
  msg_id: string;
  flags: TmailFlags;
  sender_wallet_id: string;
  receiver_wallet_id: string;
  release_at_ms: number;
  fee_paid_micro: number;
  e2ee?: { ciphertext_b64: string } | null;
  hybrid_sig: { ed25519_pubkey_hex: string; ed25519_sig_b64: string; mldsa_pubkey_b64: string; mldsa_sig_b64: string };
};

/**
 * Did `sender_wallet_id` sign this envelope (both signatures)? `"locked"` for a scheduled message
 * whose ciphertext isn't here yet (its signature can't be checked until then). Anonymous posts
 * name no sender: they're checked by their membership proof instead, and return `"anonymous"`.
 */
export async function verifyEnvelopeSender(env: SignedEnvelopeFields, baseUrl?: string): Promise<"verified" | "forged" | "locked" | "anonymous"> {
  if (env.flags?.anonymous) return "anonymous";
  if (!env.e2ee?.ciphertext_b64) return "locked";
  const sender = env.sender_wallet_id.trim().toLowerCase();
  const sig = env.hybrid_sig;
  try {
    if (!HEX64.test(sender) || sig.ed25519_pubkey_hex.trim().toLowerCase() !== sender) return "forged";
    if (b64ToBytes(sig.mldsa_pubkey_b64).length !== MLDSA44_PUB || b64ToBytes(sig.mldsa_sig_b64).length !== MLDSA44_SIG) return "forged";
    const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
    const payload = Array.from(sha256(b64ToBytes(env.e2ee.ciphertext_b64)), (b) => b.toString(16).padStart(2, "0")).join("");
    const msg = tmailEnvelopeAuthMessageBytes({
      chainId,
      genesisHash,
      msgId: env.msg_id,
      flags: env.flags,
      senderWalletId: sender,
      receiverWalletId: env.receiver_wallet_id,
      releaseAtMs: env.release_at_ms,
      feeMicro: env.fee_paid_micro,
      payloadSha256Hex: payload,
      mldsaPubkeyB64: sig.mldsa_pubkey_b64,
    });
    const ed = await verifyTetEd25519(hexToBytes(sender), msg, b64ToBytes(sig.ed25519_sig_b64));
    const pq = await mldsa44Verify(sig.mldsa_pubkey_b64, sig.mldsa_sig_b64, msg);
    return ed && pq ? "verified" : "forged";
  } catch {
    return "forged";
  }
}

/**
 * A safety number for two people: 20 digits in 4 groups of 5, the same on both screens. Made from
 * both wallet ids and both sets of messaging keys (sorted, so it doesn't matter who computes it).
 * If someone in between had swapped either person's keys, the two screens would differ.
 */
export function safetyNumber(
  a: { walletId: string; x25519PubB64: string; mlkemPubB64: string },
  b: { walletId: string; x25519PubB64: string; mlkemPubB64: string },
): string {
  const part = (p: typeof a) => `${p.walletId.trim().toLowerCase()}:${p.x25519PubB64.trim()}:${p.mlkemPubB64.trim()}`;
  const [x, y] = [part(a), part(b)].sort();
  const h = sha256(new TextEncoder().encode(`tet safety number v1\n${x}\n${y}`));
  // 4 groups of 5 digits, each from 5 bytes mod 100000 (bias negligible at this size).
  const groups: string[] = [];
  for (let i = 0; i < 4; i++) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + h[i * 5 + j]!;
    groups.push(String(n % 100_000).padStart(5, "0"));
  }
  return groups.join(" ");
}

/** Did `sender_wallet_id` sign this file envelope (both signatures)? */
export async function verifyFileSender(env: FileEnvelopeV1, baseUrl?: string): Promise<"verified" | "forged"> {
  const sender = env.sender_wallet_id.trim().toLowerCase();
  const sig = env.hybrid_sig;
  try {
    if (!HEX64.test(sender) || sig.ed25519_pubkey_hex.trim().toLowerCase() !== sender) return "forged";
    if (b64ToBytes(sig.mldsa_pubkey_b64).length !== MLDSA44_PUB || b64ToBytes(sig.mldsa_sig_b64).length !== MLDSA44_SIG) return "forged";
    const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
    const msg = fileEnvelopeAuthMessageBytes({
      chainId,
      genesisHash,
      fileId: env.file_id,
      senderWalletId: sender,
      receiverWalletId: env.receiver_wallet_id,
      fileSize: env.file_size,
      fileSha256Hex: env.file_sha256,
      filenameEncryptedB64: env.filename_encrypted_b64,
      mimeTypeEncryptedB64: env.mime_type_encrypted_b64,
      storageNode: env.storage_node,
      feeMicro: env.fee_micro,
      createdAtMs: env.created_at_ms,
      mldsaPubkeyB64: sig.mldsa_pubkey_b64,
    });
    const ed = await verifyTetEd25519(hexToBytes(sender), msg, b64ToBytes(sig.ed25519_sig_b64));
    const pq = await mldsa44Verify(sig.mldsa_pubkey_b64, sig.mldsa_sig_b64, msg);
    return ed && pq ? "verified" : "forged";
  } catch {
    return "forged";
  }
}
