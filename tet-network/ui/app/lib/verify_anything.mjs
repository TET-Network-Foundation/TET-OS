// Try TET, part 4: verify anything (docs/DEMO_NODE.md). A file or text, its `.sig.json`, and
// optionally an owner's manifest and a pinned key, in; a graded verdict out.
//
// The verdict has three steps, and each says only what it proves:
//
//   1. The bytes match and both signatures are valid, by key X.
//   2. Key X belongs to agent A, owned by wallet W: only with a manifest that verifies (exactly as
//      tet-core's `verify_agent_manifest_v1`) and names that same key pair.
//   3. This is the key you pinned: only if you pinned one.
//
// Without a manifest or a pin the verdict stops at 1: a valid signature proves which key signed,
// not who holds it.
//
// Ported from two verifiers that already agree with tet-core: `verifySigEnvelope` in
// tet-agent-sdk/src/agent.ts and `verifyEntry` in stevenexus.org's files/tet-verify/verify.mjs (the
// devlog checker), minus the devlog-specific payload type and pin. The rules kept:
//
// - the chain binding is the verifier's (this node's `/chain`, or one the user types), never read
//   from the sidecar;
// - an envelope has exactly the known fields, exactly one signature of each kind, and each keyid
//   names the key it claims to;
// - ML-DSA-44 is enforced by size before any verification (the WASM verifier would accept a
//   consistent ML-DSA-65 pair);
// - the payload must be byte-identical to the content, checked before the signatures.
//
// Plain ESM; ML-DSA verification is injected (`mldsa44Verify`) so a guard runs this under Node.

import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";

export const PAE_DOMAIN = "tet agent payload v1";
/** A signature over a file's SHA-256 instead of the file (signature badge, proof codes). */
export const HASH_PAYLOAD_TYPE = "application/vnd.tet.sha256";
export const ED_PREFIX = "tet-ed25519:";
export const ML_PREFIX = "tet-mldsa44:";
export const AGENT_MANIFEST_PAYLOAD_TYPE = "tet agent manifest v1";
export const AGENT_MANIFEST_KIND = "tet_agent_manifest_v1";
const MLDSA44_PUB = 1312;
const MLDSA44_SIG = 2420;
const ED_SIG = 64;
const MAX_AGENT_ID = 128;
const MAX_CAPS = 32;
const MAX_CAP_LEN = 64;

const utf8 = (s) => new TextEncoder().encode(s);
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const is64hex = (s) => /^[0-9a-f]{64}$/.test(s);

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function b64ToBytes(s) {
  const t = String(s).trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t) || t.length % 4 !== 0) throw new Error("not base64");
  const bin = atob(t);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** `<len> SP <bytes> SP` per field (tet-core `agent::pae_fields`). */
function paeFields(fields) {
  const parts = [];
  for (const f of fields) parts.push(utf8(String(f.length)), utf8(" "), f, utf8(" "));
  return concat(parts);
}

/**
 * The bytes an agent key signs (tet-core `agent_payload_auth_message_bytes`).
 *
 * @param {{ chainId: string, genesisHash: string }} chain
 * @param {string} payloadType
 * @param {Uint8Array} payload
 */
export function agentPayloadAuthMessageBytes(chain, payloadType, payload) {
  return concat([
    utf8(PAE_DOMAIN),
    utf8(" "),
    paeFields([utf8(chain.chainId), utf8(chain.genesisHash), utf8(String(payloadType).trim()), payload]),
  ]);
}

/** `tet-mldsa44:` + SHA-256 of the raw public key, hex. */
export function mldsa44KeyId(pubB64) {
  return ML_PREFIX + hex(sha256(b64ToBytes(pubB64)));
}

/**
 * Manifest pre-image (tet-core `agent_manifest_auth_message_bytes`): the fields, PAE-encoded, then
 * wrapped as an agent payload of type `tet agent manifest v1`. The owner's ML-DSA key is a
 * parameter so it is the key the pre-image committed to.
 */
export function agentManifestAuthMessageBytes(chain, m, ownerMldsaPubB64) {
  const fields = [
    String(m.v),
    String(m.kind).trim(),
    String(m.agent_id),
    String(m.agent_ed25519_pubkey_hex).trim().toLowerCase(),
    String(m.agent_mldsa44_pubkey_b64).trim(),
    String(m.owner_wallet_id).trim().toLowerCase(),
    String(m.created_at_ms),
    String(m.expires_at_ms),
    m.declared_automated ? "1" : "0",
    String(m.capabilities.length),
    String(ownerMldsaPubB64).trim(),
    ...m.capabilities.map(String),
  ].map(utf8);
  return agentPayloadAuthMessageBytes(chain, AGENT_MANIFEST_PAYLOAD_TYPE, paeFields(fields));
}

function ed25519Verify(pubHex, sigB64, msg) {
  try {
    const sig = b64ToBytes(sigB64);
    if (sig.length !== ED_SIG) return false;
    return ed25519.verify(sig, msg, hexToBytes(pubHex));
  } catch {
    return false;
  }
}

const no = (reason) => ({ ok: false, reason });

/**
 * Step 1: is `content` exactly what the envelope signed, and do both signatures verify on `chain`?
 *
 * @param {{ envelope: any, content: Uint8Array, recordOnly?: boolean, chain: { chainId: string, genesisHash: string },
 *           mldsa44Verify: (pub: string, sig: string, msg: Uint8Array) => Promise<boolean> }} o
 * @returns {Promise<{ ok: true, edHex: string, mldsaPubB64: string, mldsaKeyId: string, payloadType: string }
 *                   | { ok: false, reason: string }>}
 */
export async function verifyEnvelope(o) {
  const e = o.envelope;
  if (!e || typeof e !== "object" || Array.isArray(e)) return no("the .sig.json is not a JSON object");
  if (!e.tet || e.tet.v !== 1) return no("unsupported envelope version");
  if (e.tet.pae !== PAE_DOMAIN) return no(`unknown pre-image encoding ${JSON.stringify(e.tet.pae)}`);
  for (const k of Object.keys(e)) {
    if (!["payloadType", "payload", "signatures", "tet"].includes(k)) return no(`unexpected field ${JSON.stringify(k)}`);
  }
  for (const k of Object.keys(e.tet)) {
    if (!["v", "pae", "agent_ed25519_pubkey_hex", "agent_mldsa44_pubkey_b64"].includes(k)) {
      return no(`unexpected field tet.${k}`);
    }
  }
  if (typeof e.payloadType !== "string" || !e.payloadType.trim()) return no("payloadType is missing");
  if (!Array.isArray(e.signatures) || e.signatures.length !== 2) {
    return no(`expected exactly 2 signatures, got ${e.signatures?.length ?? 0}`);
  }
  const pick = (prefix) => e.signatures.filter((s) => typeof s?.keyid === "string" && s.keyid.startsWith(prefix));
  const eds = pick(ED_PREFIX);
  const mls = pick(ML_PREFIX);
  if (eds.length !== 1) return no("missing or duplicated ed25519 signature");
  if (mls.length !== 1) return no("missing or duplicated ml-dsa-44 signature");

  const edHex = String(e.tet.agent_ed25519_pubkey_hex ?? "");
  const mlPub = String(e.tet.agent_mldsa44_pubkey_b64 ?? "").trim();
  if (!is64hex(edHex)) return no("the ed25519 key is not 64 lowercase hex");
  if (eds[0].keyid !== ED_PREFIX + edHex) return no("ed25519 keyid does not match the key it names");
  let mlKeyId;
  let payload;
  let mlSig;
  try {
    mlKeyId = mldsa44KeyId(mlPub);
    payload = b64ToBytes(e.payload ?? "");
    mlSig = b64ToBytes(mls[0].sig);
  } catch {
    return no("envelope is not valid base64");
  }
  if (mls[0].keyid !== mlKeyId) return no("ml-dsa-44 keyid does not match the key it names");
  // Level pinning before any verification.
  if (b64ToBytes(mlPub).length !== MLDSA44_PUB) return no("ml-dsa key is not ML-DSA-44");
  if (mlSig.length !== MLDSA44_SIG) return no("ml-dsa signature is not ML-DSA-44");

  if (o.recordOnly) {
    // Checking a published hash-only record without the file (proof-code lookup): allowed only for
    // the hash type, so no other envelope can skip its content comparison this way.
    if (e.payloadType.trim() !== HASH_PAYLOAD_TYPE) return no("only a hash-only record can be checked without its file");
    if (payload.length !== 32) return no("a hash-only signature must carry exactly 32 bytes");
  } else if (e.payloadType.trim() === HASH_PAYLOAD_TYPE) {
    // A hash-only signature (signature badge, proof codes): the payload is the file's SHA-256, and
    // only a file that hashes to exactly it matches. The file itself was never signed or published.
    if (payload.length !== 32) return no("a hash-only signature must carry exactly 32 bytes");
    if (!sameBytes(payload, sha256(o.content))) return no("the file's SHA-256 differs from the one that was signed");
  } else if (!sameBytes(payload, o.content)) {
    return no(`the content differs from what was signed (signed ${payload.length} bytes, given ${o.content.length})`);
  }
  const msg = agentPayloadAuthMessageBytes(o.chain, e.payloadType, payload);
  if (!ed25519Verify(edHex, eds[0].sig, msg)) {
    return no("ed25519 signature does not verify (on this chain binding)");
  }
  if (!(await o.mldsa44Verify(mlPub, String(mls[0].sig).trim(), msg))) {
    return no("ml-dsa-44 signature does not verify (on this chain binding)");
  }
  return { ok: true, edHex, mldsaPubB64: mlPub, mldsaKeyId: mlKeyId, payloadType: e.payloadType.trim() };
}

/**
 * tet-core `verify_agent_manifest_v1`, in the same order: structure, signer binding, signature,
 * schedule and expiry. `nowMs` is a parameter.
 *
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function verifyAgentManifest(o) {
  const m = o.manifest;
  if (!m || typeof m !== "object") return no("the manifest is not a JSON object");
  if (m.v !== 1) return no(`unsupported manifest version ${m.v}`);
  if (String(m.kind ?? "").trim() !== AGENT_MANIFEST_KIND) return no(`not a manifest (kind ${JSON.stringify(m.kind)})`);
  const idLen = utf8(String(m.agent_id ?? "")).length;
  if (typeof m.agent_id !== "string" || idLen === 0 || idLen > MAX_AGENT_ID) return no("agent_id must be 1–128 bytes");
  if (!Array.isArray(m.capabilities) || m.capabilities.length > MAX_CAPS) return no("too many capabilities");
  for (const c of m.capabilities) {
    const n = utf8(String(c)).length;
    if (typeof c !== "string" || n === 0 || n > MAX_CAP_LEN) return no("a capability is empty or too long");
  }
  if (!Number.isSafeInteger(m.created_at_ms) || !Number.isSafeInteger(m.expires_at_ms)) {
    return no("created_at_ms and expires_at_ms must be integers");
  }
  if (typeof m.declared_automated !== "boolean") return no("declared_automated must be true or false");
  const agentEd = String(m.agent_ed25519_pubkey_hex ?? "").trim().toLowerCase();
  if (!is64hex(agentEd)) return no("the agent's ed25519 key is not 64 hex");
  const owner = String(m.owner_wallet_id ?? "").trim().toLowerCase();
  if (!is64hex(owner)) return no("the owner wallet id is not 64 hex");
  if (agentEd === owner) return no("the agent key is the owner's own key");
  const sig = m.hybrid_sig ?? {};
  const len = (b) => {
    try {
      return b64ToBytes(b ?? "").length;
    } catch {
      return 0;
    }
  };
  if (len(m.agent_mldsa44_pubkey_b64) !== MLDSA44_PUB) return no("the agent's ml-dsa key is not ML-DSA-44");
  if (len(sig.mldsa_pubkey_b64) !== MLDSA44_PUB) return no("the owner's ml-dsa key is not ML-DSA-44");
  if (String(sig.ed25519_pubkey_hex ?? "").trim().toLowerCase() !== owner) {
    return no("the manifest is not signed by the owner it names");
  }
  const msg = agentManifestAuthMessageBytes(o.chain, m, sig.mldsa_pubkey_b64);
  if (!ed25519Verify(owner, sig.ed25519_sig_b64, msg)) return no("the owner's ed25519 signature does not verify");
  if (!(await o.mldsa44Verify(String(sig.mldsa_pubkey_b64).trim(), String(sig.mldsa_sig_b64 ?? "").trim(), msg))) {
    return no("the owner's ml-dsa-44 signature does not verify");
  }
  if (m.expires_at_ms <= m.created_at_ms) return no("the manifest expires before it starts");
  if (o.nowMs > m.expires_at_ms) return no(`the manifest expired at ${new Date(m.expires_at_ms).toISOString()}`);
  return { ok: true };
}

/**
 * A pin: an ed25519 key (64 hex), an `tet-mldsa44:` keyid, both, or a pin.json with
 * `agent_ed25519_pubkey_hex` / `agent_mldsa44_keyid`. Every key the pin names must match.
 */
export function parsePin(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  let ed = null;
  let ml = null;
  if (t.startsWith("{")) {
    const j = JSON.parse(t);
    ed = j.agent_ed25519_pubkey_hex ?? null;
    ml = j.agent_mldsa44_keyid ?? null;
  } else {
    for (const part of t.split(/[\s,]+/)) {
      if (part.startsWith(ML_PREFIX)) ml = part;
      else if (part.startsWith(ED_PREFIX)) ed = part.slice(ED_PREFIX.length);
      else if (part) ed = part;
    }
  }
  ed = ed == null ? null : String(ed).trim().toLowerCase();
  ml = ml == null ? null : String(ml).trim().toLowerCase();
  if (ed != null && !is64hex(ed)) throw new Error("the pinned ed25519 key is not 64 hex");
  if (ml != null && !/^tet-mldsa44:[0-9a-f]{64}$/.test(ml)) throw new Error("the pinned ml-dsa keyid is malformed");
  if (ed == null && ml == null) throw new Error("the pin names no key");
  return { ed, ml };
}

/**
 * The graded verdict.
 *
 * @param {{ content: Uint8Array, envelope: any, manifest?: any, pin?: string,
 *           chain: { chainId: string, genesisHash: string }, nowMs: number,
 *           mldsa44Verify: (pub: string, sig: string, msg: Uint8Array) => Promise<boolean> }} o
 * @returns {Promise<{ level: 0 | 1 | 2 | 3, steps: { n: 1 | 2 | 3, status: "ok" | "failed" | "skipped", text: string }[] }>}
 */
export async function gradedVerdict(o) {
  const steps = [];
  const s1 = await verifyEnvelope(o);
  if (!s1.ok) {
    steps.push({ n: 1, status: "failed", text: `Not verified: ${s1.reason}.` });
    steps.push({ n: 2, status: "skipped", text: "Not checked: step 1 failed." });
    steps.push({ n: 3, status: "skipped", text: "Not checked: step 1 failed." });
    return { level: 0, steps };
  }
  steps.push({
    n: 1,
    status: "ok",
    text: `The bytes match and both signatures are valid, by key ${s1.edHex} (${s1.mldsaKeyId}), payload type ${JSON.stringify(s1.payloadType)}.`,
  });

  let manifestOk = false;
  if (o.manifest == null) {
    steps.push({ n: 2, status: "skipped", text: "No manifest given, so who holds this key is unknown." });
  } else {
    const r = await verifyAgentManifest(o);
    const m = o.manifest;
    if (!r.ok) {
      steps.push({ n: 2, status: "failed", text: `The manifest does not verify: ${r.reason}.` });
    } else if (
      String(m.agent_ed25519_pubkey_hex).trim().toLowerCase() !== s1.edHex ||
      String(m.agent_mldsa44_pubkey_b64).trim() !== s1.mldsaPubB64
    ) {
      steps.push({ n: 2, status: "failed", text: "The manifest is valid but vouches for a different key than the one that signed." });
    } else {
      manifestOk = true;
      steps.push({
        n: 2,
        status: "ok",
        text:
          `Key ${s1.edHex.slice(0, 12)}… belongs to agent ${JSON.stringify(m.agent_id)}, owned by wallet ` +
          `${String(m.owner_wallet_id).toLowerCase()}, until ${new Date(m.expires_at_ms).toISOString()}. ` +
          `The owner ${m.declared_automated ? "declares" : "does not declare"} it automated (a declaration, not a proof).`,
      });
    }
  }

  let pinOk = false;
  let pin = null;
  try {
    pin = parsePin(o.pin);
  } catch (e) {
    steps.push({ n: 3, status: "failed", text: `The pin is not usable: ${e instanceof Error ? e.message : String(e)}.` });
  }
  if (steps.length === 2) {
    if (!pin) {
      steps.push({ n: 3, status: "skipped", text: "No key pinned." });
    } else if ((pin.ed == null || pin.ed === s1.edHex) && (pin.ml == null || pin.ml === s1.mldsaKeyId)) {
      pinOk = true;
      steps.push({ n: 3, status: "ok", text: "This is the key you pinned." });
    } else {
      steps.push({ n: 3, status: "failed", text: "This is NOT the key you pinned." });
    }
  }
  return { level: pinOk ? 3 : manifestOk ? 2 : 1, steps };
}
