/**
 * Proof codes (signature badge): a short code like `TET-7F3K-Q9WX` that finds a published,
 * hash-only signature record.
 *
 * - **A record** is a `.sig.json` signed with the tab's key over a file's SHA-256 (payload type
 *   `application/vnd.tet.sha256`), never over the file: publishing it reveals the hash and the
 *   signer's keys, not the file.
 * - **The code** is 40 bits of the record's SHA-256 in Crockford base32 (no I, L, O, U). It is a
 *   lookup handle, not a proof: someone willing to spend the compute could craft another record
 *   with the same code. So a lookup lists *every* record with that code and verifies each one's
 *   signatures; only verified records are shown as signed. "The code finds it; the signature proves
 *   it." It is never called a key, and the secret key stays one per person.
 * - **Where records live today:** as small files sent to a public "signatures" board's wallet on this
 *   node (`NEXT_PUBLIC_TET_SIGNATURES_INVITE`); the board's invite is published, so anyone can read
 *   them. A record is ~5 KB (the ML-DSA-44 signature and key), more than a board post holds, hence a
 *   file. Files are kept 7 days on the demo. Keep the `.sig.json`.
 */
import { sha256 } from "@noble/hashes/sha2";
import { HASH_PAYLOAD_TYPE, verifyEnvelope } from "./verify_anything.mjs";
import { signContent, sigJsonBytes, stampFileId, type Chain, type SigEnvelope } from "./sign_anything";
import { type OpenBoard } from "./try_board";
import { buildFileEnvelopeV1 } from "./files";
import { decryptFileForReceiver } from "./files_e2ee";
import { settleFileFee } from "./files_fee";
import { b64ToBytes } from "./encoding";
import { getFilesFetch, getFilesInbox, postFilesUpload } from "./tet_core_http";
import { getHybridSignerSession } from "./hybrid_signer_session";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PROOF_CODE_RE = /^TET-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Sign a file's SHA-256 with the tab's key: the record a proof code points at. */
export async function signFileHash(file: Uint8Array, chain: Chain): Promise<{ env: SigEnvelope; bytes: Uint8Array; fileSha256: string }> {
  const h = sha256(file);
  const env = await signContent(h, HASH_PAYLOAD_TYPE, chain);
  return { env, bytes: sigJsonBytes(env), fileSha256: hex(h) };
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * `TET-XXXX-XXXX`: 40 bits of SHA-256(record bytes), Crockford base32. The record is stored as a
 * file whose id is that same hash (`stampFileId`), so a code lookup fetches only the file whose id
 * starts with the code's 40 bits instead of every record (the node rate-limits reads).
 */
export function proofCode(recordBytes: Uint8Array): string {
  const h = sha256(recordBytes);
  let bits = 0n;
  for (const b of h.slice(0, 5)) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 7; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return `TET-${out.slice(0, 4)}-${out.slice(4)}`;
}

/** A typed code, normalised (case, spaces, Crockford look-alikes O→0, I/L→1), or null. */
export function parseProofCode(input: string): string | null {
  const raw = input.trim().toUpperCase().replace(/[\s_]/g, "").replace(/^TET-?/, "");
  const body = raw.replace(/-/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(body)) return null;
  return `TET-${body.slice(0, 4)}-${body.slice(4)}`;
}

const RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Publish a record as a small file to the signatures board's wallet (readable by anyone with the
 * board's published invite); returns its proof code. The demo's sponsor pays the file fee when it
 * can; the file is delivered either way.
 */
export async function publishRecord(baseUrl: string, board: OpenBoard, recordBytes: Uint8Array): Promise<string> {
  const sess = getHybridSignerSession();
  if (!sess) throw new Error("No wallet in this tab.");
  const built = await buildFileEnvelopeV1({
    senderWalletId: sess.walletIdHex64,
    receiverWalletId: board.boardWalletId,
    fileBytes: recordBytes,
    filename: "record.sig.json",
    mimeType: "application/json",
    receiverX25519Pub: board.keys.x25519_pub,
    receiverMlkemPub: board.keys.mlkem_pub,
    baseUrl,
    ttlMs: RECORD_TTL_MS,
    fileId: stampFileId(recordBytes),
  });
  const up = await postFilesUpload(baseUrl, built.envelope, built.bodyCiphertext);
  if (!up.ok) throw new Error(up.text || `the node refused the record (HTTP ${up.status})`);
  void settleFileFee({ mode: "demo-sponsor", baseUrl, fileId: built.envelope.file_id, senderWalletId: sess.walletIdHex64, storageWallet: up.storageWallet ?? "" }).catch(() => undefined);
  return proofCode(recordBytes);
}

/** The 10 hex digits (40 bits) a code stands for: the start of the record's hash and file id. */
export function codePrefixHex(code: string): string | null {
  const c = parseProofCode(code);
  if (!c) return null;
  let bits = 0n;
  for (const ch of c.slice(4).replace("-", "")) bits = (bits << 5n) | BigInt(CROCKFORD.indexOf(ch));
  return bits.toString(16).padStart(10, "0");
}

/**
 * The signatures board's records, decrypted with the board's (published) keys; newest first.
 * With `fileIdPrefix` (a code lookup) only files whose id starts with it are fetched; otherwise
 * only the newest `scan` records, to stay inside the node's read limits.
 */
export async function loadRecords(baseUrl: string, board: OpenBoard, fileIdPrefix?: string, scan = 20): Promise<{ bytes: Uint8Array; publishedAtMs: number }[]> {
  const inbox = await getFilesInbox(baseUrl, board.boardWalletId, 200);
  if (!inbox.ok) throw new Error(inbox.text || `HTTP ${inbox.status}`);
  const wanted = fileIdPrefix
    ? inbox.files.filter((f) => f.file_id.replace(/-/g, "").startsWith(fileIdPrefix))
    : [...inbox.files].sort((a, b) => b.created_at_ms - a.created_at_ms).slice(0, scan);
  const out: { bytes: Uint8Array; publishedAtMs: number }[] = [];
  for (const env of wanted) {
    try {
      const blob = await getFilesFetch(baseUrl, env.file_id);
      if (!blob.ok || !blob.bytes) continue;
      const d = await decryptFileForReceiver(
        {
          client_ephemeral_pub: b64ToBytes(env.e2ee.client_ephemeral_pub_b64),
          mlkem_ciphertext: b64ToBytes(env.e2ee.mlkem_ciphertext_b64),
          filename_nonce: b64ToBytes(env.e2ee.filename_nonce_b64),
          mime_nonce: b64ToBytes(env.e2ee.mime_nonce_b64),
          body_nonce: b64ToBytes(env.e2ee.body_nonce_b64),
          filename_ciphertext: b64ToBytes(env.filename_encrypted_b64),
          mime_ciphertext: b64ToBytes(env.mime_type_encrypted_b64),
          body_ciphertext: blob.bytes,
        },
        board.keys.x25519_sk,
        board.keys.mlkem_sk,
      );
      out.push({ bytes: d.fileBytes, publishedAtMs: env.created_at_ms });
    } catch {
      /* an unreadable file is skipped */
    }
  }
  return out.sort((a, b) => b.publishedAtMs - a.publishedAtMs);
}

export type FoundSignature = {
  code: string;
  fileSha256: string;
  signerEd25519: string;
  publishedAtMs: number;
  verified: boolean;
  reason?: string;
  /** The record's exact bytes (download it to check a file in Verify). */
  recordBytes: Uint8Array;
};

/**
 * Records matching `query`: a proof code, a file SHA-256 or a signer key (64 hex). Every match is
 * listed and its signatures checked (no file needed: a record signs a hash). `records` is injected
 * (the page passes `loadRecords`), and so is `mldsa44Verify` (lib/pqc).
 */
export async function findSignatures(o: {
  query: string;
  chain: Chain;
  /** Called with the code's file-id prefix for a code lookup, without one otherwise. */
  records: (fileIdPrefix?: string) => Promise<{ bytes: Uint8Array; publishedAtMs: number }[]>;
  mldsa44Verify: (pubB64: string, sigB64: string, msg: Uint8Array) => Promise<boolean>;
}): Promise<FoundSignature[]> {
  const code = parseProofCode(o.query);
  const h = o.query.trim().toLowerCase().replace(/^0x/, "");
  const isHex = /^[0-9a-f]{64}$/.test(h);
  if (!code && !isHex) return [];
  const out: FoundSignature[] = [];
  for (const rec of await o.records(code ? (codePrefixHex(code) ?? undefined) : undefined)) {
    const text = new TextDecoder().decode(rec.bytes);
    let env: SigEnvelope;
    try {
      env = JSON.parse(text);
    } catch {
      continue;
    }
    if (env?.payloadType !== HASH_PAYLOAD_TYPE) continue;
    const c = proofCode(rec.bytes);
    let fileHash = "";
    try {
      fileHash = hex(Uint8Array.from(atob(env.payload), (ch) => ch.charCodeAt(0)));
    } catch {
      continue;
    }
    const signer = String(env.tet?.agent_ed25519_pubkey_hex ?? "").toLowerCase();
    const hit = code ? c === code : fileHash === h || signer === h;
    if (!hit) continue;
    const v = await verifyEnvelope({ envelope: env, content: new Uint8Array(), recordOnly: true, chain: o.chain, mldsa44Verify: o.mldsa44Verify });
    out.push({ code: c, fileSha256: fileHash, signerEd25519: signer, publishedAtMs: rec.publishedAtMs, verified: v.ok === true, reason: v.ok ? undefined : v.reason, recordBytes: rec.bytes });
  }
  return out.sort((a, b) => b.publishedAtMs - a.publishedAtMs);
}
