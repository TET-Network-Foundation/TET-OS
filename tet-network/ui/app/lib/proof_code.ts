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
 * - **Where records live:** in this node's public signature registry (tet-core `sigs.rs`). A record
 *   is there only because its signer published it: publishing sends the record together with the
 *   signer's **consent**, a second signature by the same keys over the record's exact SHA-256, so
 *   nobody else can publish a `.sig.json` they were given. The registry finds records by proof
 *   code, file SHA-256, signer and date; every result is re-checked here. Keep the `.sig.json`.
 * - **Exact files only:** a file search hashes the file in this tab (it is never uploaded), and only
 *   a byte-identical file has that hash: re-compressed or edited copies won't match.
 */
import { sha256 } from "@noble/hashes/sha2";
import { HASH_PAYLOAD_TYPE, verifyEnvelope } from "./verify_anything.mjs";
import { signContent, sigJsonBytes, type Chain, type SigEnvelope } from "./sign_anything";
import { tetCoreUrl } from "./tet_core_http";

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
 * `TET-XXXX-XXXX`: 40 bits of SHA-256(record bytes), Crockford base32. The registry indexes records
 * by those same 40 bits, so a code lookup reads only the records that share them.
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

/** The 10 hex digits (40 bits) a code stands for: the start of the record's hash and file id. */
export function codePrefixHex(code: string): string | null {
  const c = parseProofCode(code);
  if (!c) return null;
  let bits = 0n;
  for (const ch of c.slice(4).replace("-", "")) bits = (bits << 5n) | BigInt(CROCKFORD.indexOf(ch));
  return bits.toString(16).padStart(10, "0");
}

/** The payload type of a signer's consent to publish one record (tet-core `sigs::CONSENT_PAYLOAD_TYPE`). */
export const CONSENT_PAYLOAD_TYPE = "tet sig publish v1";

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Publish a record to this node's signature registry, with the tab key's consent for exactly these
 * bytes (signed now, by the same keys as the record). Returns its proof code.
 */
export async function publishRecord(baseUrl: string, recordBytes: Uint8Array, chain: Chain): Promise<string> {
  const consent = await signContent(sha256(recordBytes), CONSENT_PAYLOAD_TYPE, chain);
  const r = await fetch(tetCoreUrl(baseUrl, "/sigs/publish"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record_b64: b64(recordBytes), consent_b64: b64(sigJsonBytes(consent)) }),
  });
  if (r.status !== 202) {
    let why = `HTTP ${r.status}`;
    try {
      why = String(((await r.json()) as { error?: string }).error ?? why);
    } catch {
      /* not JSON */
    }
    throw new Error(`the node refused the record: ${why}`);
  }
  return proofCode(recordBytes);
}

export type RecordQuery = { codePrefix?: string; file?: string; signer?: string; fromMs?: number; toMs?: number };

/** Published records matching `q`, from this node's registry (not yet checked), newest first. */
export async function registryRecords(baseUrl: string, q: RecordQuery): Promise<{ bytes: Uint8Array; publishedAtMs: number }[]> {
  const params: Record<string, string> = {};
  if (q.codePrefix) params.code = q.codePrefix;
  if (q.file) params.file = q.file;
  if (q.signer) params.signer = q.signer;
  if (q.fromMs !== undefined) params.from = String(q.fromMs);
  if (q.toMs !== undefined) params.to = String(q.toMs);
  const r = await fetch(tetCoreUrl(baseUrl, "/sigs/search", params));
  if (!r.ok) throw new Error(`the registry didn't answer (HTTP ${r.status})`);
  const j = (await r.json()) as { records?: { record_b64: string; published_at_ms: number }[] };
  return (j.records ?? []).map((x) => ({ bytes: Uint8Array.from(atob(x.record_b64), (c) => c.charCodeAt(0)), publishedAtMs: x.published_at_ms }));
}

export type FoundSignature = {
  code: string;
  /** How it matched the query: by proof code, by the file's fingerprint, or by the ID. */
  match: "code" | "file" | "signer";
  fileSha256: string;
  signerEd25519: string;
  publishedAtMs: number;
  verified: boolean;
  reason?: string;
  /** The record's exact bytes (download it to check a file in Verify). */
  recordBytes: Uint8Array;
};

/**
 * Records matching `query`: a proof code, a file SHA-256 or a signer key (64 hex), optionally
 * between two dates. Every match is listed and its signatures checked (no file needed: a record
 * signs a hash). `records` is injected (the page passes `registryRecords`), and so is
 * `mldsa44Verify` (lib/pqc).
 */
export async function findSignatures(o: {
  query: string;
  chain: Chain;
  fromMs?: number;
  toMs?: number;
  records: (q: RecordQuery) => Promise<{ bytes: Uint8Array; publishedAtMs: number }[]>;
  mldsa44Verify: (pubB64: string, sigB64: string, msg: Uint8Array) => Promise<boolean>;
}): Promise<FoundSignature[]> {
  const code = parseProofCode(o.query);
  const h = o.query.trim().toLowerCase().replace(/^0x/, "");
  const isHex = /^[0-9a-f]{64}$/.test(h);
  if (!code && !isHex && o.fromMs === undefined && o.toMs === undefined) return [];
  const dates = { fromMs: o.fromMs, toMs: o.toMs };
  // A 64-hex query is either a file's SHA-256 or a signer's key: ask for both.
  const batches = code
    ? [await o.records({ codePrefix: codePrefixHex(code) ?? undefined, ...dates })]
    : isHex
      ? [await o.records({ file: h, ...dates }), await o.records({ signer: h, ...dates })]
      : [await o.records(dates)];
  const seen = new Set<string>();
  const recs = batches.flat().filter((r) => {
    const k = proofCode(r.bytes) + r.bytes.length;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const out: FoundSignature[] = [];
  for (const rec of recs) {
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
    const hit = code ? c === code : isHex ? fileHash === h || signer === h : true;
    if (o.fromMs !== undefined && rec.publishedAtMs < o.fromMs) continue;
    if (o.toMs !== undefined && rec.publishedAtMs > o.toMs) continue;
    if (!hit) continue;
    const v = await verifyEnvelope({ envelope: env, content: new Uint8Array(), recordOnly: true, chain: o.chain, mldsa44Verify: o.mldsa44Verify });
    const match: FoundSignature["match"] = code ? "code" : fileHash === h ? "file" : "signer";
    out.push({ code: c, match, fileSha256: fileHash, signerEd25519: signer, publishedAtMs: rec.publishedAtMs, verified: v.ok === true, reason: v.ok ? undefined : v.reason, recordBytes: rec.bytes });
  }
  // A file's markings: the earliest first, so the first person to mark it is the one shown on top
  // (later markings of the same file by others can't take its place). Everything else: newest first.
  const byFile = out.filter((f) => f.match === "file").sort((a, b) => a.publishedAtMs - b.publishedAtMs);
  const rest = out.filter((f) => f.match !== "file").sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  return [...byFile, ...rest];
}
