/**
 * Verify without TET, Level 1: "this key signed this hash", fully offline, no chain needed.
 *
 * This module is inlined, unchanged, into the standalone verifier (public/verify/tet-verify.html)
 * and the CLI (public/verify/tet-verify.mjs), so it imports nothing: SHA-256 and Ed25519 come from
 * the platform's own WebCrypto, and ML-DSA-44 from an injected function (the inlined WASM).
 * It mirrors `verify_anything.mjs` `verifyEnvelope` check for check (tet-core `agent.rs`), and
 * scripts/offline_verify_guard.mjs runs both on the same valid and tampered records: they must agree.
 *
 * What a pass proves: the two keys named in the record signed that SHA-256 (and, if a file is given,
 * that the file hashes to it), bound to the named chain. What it doesn't prove: who holds the keys,
 * that the file's content is true, or when it was signed (that needs Level 2: a chain copy).
 */

export const PAE_DOMAIN = "tet agent payload v1";
export const HASH_PAYLOAD_TYPE = "application/vnd.tet.sha256";
const ED_PREFIX = "tet-ed25519:";
const ML_PREFIX = "tet-mldsa44:";
const MLDSA44_PUB = 1312;
const MLDSA44_SIG = 2420;
const ED_SIG = 64;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const enc = new TextEncoder();
const utf8 = (s) => enc.encode(s);
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
function b64ToBytes(s) {
  const bin = atob(String(s).trim());
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const is64hex = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const no = (reason) => ({ ok: false, reason });

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function ed25519Verify(pubHex, sigB64, msg) {
  try {
    const sig = b64ToBytes(sigB64);
    if (sig.length !== ED_SIG) return false;
    const key = await crypto.subtle.importKey("raw", hexToBytes(pubHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, msg);
  } catch {
    return false;
  }
}

/** Does this platform's WebCrypto have Ed25519? (Browsers since 2024–25, Node 20+.) */
export async function hasEd25519() {
  try {
    await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "Ed25519" }, false, ["verify"]);
    return true;
  } catch {
    return false;
  }
}

/** The bytes a key signs (tet-core `agent_payload_auth_message_bytes`): PAE, chain-bound. */
export function payloadAuthMessageBytes(chain, payloadType, payload) {
  const fields = [utf8(chain.chainId), utf8(chain.genesisHash), utf8(String(payloadType).trim()), payload];
  const parts = [utf8(PAE_DOMAIN), utf8(" ")];
  for (const f of fields) parts.push(utf8(String(f.length)), utf8(" "), f, utf8(" "));
  return concat(parts);
}

/** `TET-XXXX-XXXX`: 40 bits of SHA-256(record bytes), Crockford base32 (`proof_code.ts`). */
export async function proofCode(recordBytes) {
  const h = await sha256(recordBytes);
  let bits = 0n;
  for (const b of h.slice(0, 5)) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 7; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return `TET-${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * Level 1. `recordBytes`: the .sig.json / .record.json exactly as saved. `file` (optional): the file
 * it marks; without it, only a hash-only record can be checked (it then says which SHA-256 was
 * signed). `chain`: { chainId, genesisHash } the signature is bound to.
 *
 * @returns {Promise<{ ok: true, signer: string, mldsaKeyId: string, payloadType: string, signedSha256: string | null, fileMatches: boolean | null, proofCode: string }
 *                   | { ok: false, reason: string }>}
 */
export async function verifyRecordOffline({ recordBytes, file, chain, mldsa44Verify }) {
  let e;
  try {
    e = JSON.parse(new TextDecoder().decode(recordBytes));
  } catch {
    return no("the record is not JSON");
  }
  if (!e || typeof e !== "object" || Array.isArray(e)) return no("the record is not a JSON object");
  if (!e.tet || e.tet.v !== 1) return no("unsupported envelope version");
  if (e.tet.pae !== PAE_DOMAIN) return no(`unknown pre-image encoding ${JSON.stringify(e.tet.pae)}`);
  for (const k of Object.keys(e)) if (!["payloadType", "payload", "signatures", "tet"].includes(k)) return no(`unexpected field ${JSON.stringify(k)}`);
  for (const k of Object.keys(e.tet)) {
    if (!["v", "pae", "agent_ed25519_pubkey_hex", "agent_mldsa44_pubkey_b64"].includes(k)) return no(`unexpected field tet.${k}`);
  }
  if (typeof e.payloadType !== "string" || !e.payloadType.trim()) return no("payloadType is missing");
  if (!Array.isArray(e.signatures) || e.signatures.length !== 2) return no(`expected exactly 2 signatures, got ${e.signatures?.length ?? 0}`);
  const pick = (p) => e.signatures.filter((s) => typeof s?.keyid === "string" && s.keyid.startsWith(p));
  const eds = pick(ED_PREFIX);
  const mls = pick(ML_PREFIX);
  if (eds.length !== 1) return no("missing or duplicated ed25519 signature");
  if (mls.length !== 1) return no("missing or duplicated ml-dsa-44 signature");
  const edHex = String(e.tet.agent_ed25519_pubkey_hex ?? "");
  const mlPub = String(e.tet.agent_mldsa44_pubkey_b64 ?? "").trim();
  if (!is64hex(edHex)) return no("the ed25519 key is not 64 lowercase hex");
  if (eds[0].keyid !== ED_PREFIX + edHex) return no("ed25519 keyid does not match the key it names");
  let payload, mlSig, mlPubBytes;
  try {
    payload = b64ToBytes(e.payload ?? "");
    mlSig = b64ToBytes(mls[0].sig);
    mlPubBytes = b64ToBytes(mlPub);
  } catch {
    return no("envelope is not valid base64");
  }
  const mlKeyId = ML_PREFIX + hex(await sha256(mlPubBytes));
  if (mls[0].keyid !== mlKeyId) return no("ml-dsa-44 keyid does not match the key it names");
  if (mlPubBytes.length !== MLDSA44_PUB) return no("ml-dsa key is not ML-DSA-44");
  if (mlSig.length !== MLDSA44_SIG) return no("ml-dsa signature is not ML-DSA-44");
  const type = e.payloadType.trim();
  let signedSha256 = null;
  let fileMatches = null;
  if (type === HASH_PAYLOAD_TYPE) {
    if (payload.length !== 32) return no("a hash-only signature must carry exactly 32 bytes");
    signedSha256 = hex(payload);
    if (file) {
      fileMatches = same(payload, await sha256(file));
      if (!fileMatches) return no("the file's SHA-256 differs from the one that was signed");
    }
  } else {
    if (!file) return no("this record signs its content, not a hash: give the file too");
    fileMatches = same(payload, file);
    if (!fileMatches) return no(`the content differs from what was signed (signed ${payload.length} bytes, given ${file.length})`);
  }
  const msg = payloadAuthMessageBytes(chain, e.payloadType, payload);
  if (!(await ed25519Verify(edHex, eds[0].sig, msg))) return no("ed25519 signature does not verify (on this chain binding)");
  if (!(await mldsa44Verify(mlPub, String(mls[0].sig).trim(), msg))) return no("ml-dsa-44 signature does not verify (on this chain binding)");
  return { ok: true, signer: edHex, mldsaKeyId: mlKeyId, payloadType: type, signedSha256, fileMatches, proofCode: await proofCode(recordBytes) };
}
