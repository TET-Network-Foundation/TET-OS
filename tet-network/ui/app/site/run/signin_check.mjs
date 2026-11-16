// "Sign in with TET", the site's side, in the page: tools/sign-in/signin.py `State.issue` and
// `State.accept`, the same checks in the same order with the same reasons:
//   payload type → signature → one Ed25519 key id → challenge JSON → domain → nonce issued here
//   → the exact challenge issued → nonce not used before → not expired
// A `signature:` reason is the page verifier's wording (lib/verify_anything.mjs, the port of
// tet-core's AgentSigEnvelopeV1::verify), as on the machine-log tab; signin.py prints tet-cli's.
//
// No new cryptography: the signature check is verifyEnvelope, passed in (`c.verifyEnvelope`,
// `c.mldsa44Verify`) so a guard can swap it. scripts/site_run_guard.mjs holds every reason below to
// the text of signin.py.
//
// Plain ESM, state in memory only, as the prototype's server.

import { PyNum, parsePyJson, pyCanonical } from "../../lib/machine_log.mjs";

export const KIND = "tet_signin_challenge_v1";
export const PAYLOAD_TYPE = "application/vnd.tet.signin-challenge+json";
export const TTL = 8;

const utf8 = new TextDecoder("utf-8", { fatal: true });
const enc = new TextEncoder();

/** Python repr() of a str (signin.py's domain message uses !r). */
function repr(v) {
  if (typeof v !== "string") return v === undefined || v === null ? "None" : String(v);
  const q = v.includes("'") && !v.includes('"') ? '"' : "'";
  return q + v.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`) + q;
}

function nonceHex() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The challenge's canonical bytes (signin.py canonical()). */
export function challengeBytes(ch) {
  const m = new Map(Object.entries(ch).map(([k, v]) => [k, typeof v === "number" ? new PyNum(String(v)) : v]));
  return enc.encode(pyCanonical(m));
}

export class Refused extends Error {}

/** One site: signin.py's State, in memory. */
export function newSite(domain, chain) {
  return { domain, chain, seq: 0, issued: new Map(), used: new Set() };
}

/** State.issue: a new challenge, good while the site's seq is at most expires_seq. */
export function issue(site) {
  site.seq += 1;
  const ch = { v: 1, kind: KIND, domain: site.domain, nonce: nonceHex(), expires_seq: site.seq + TTL };
  site.issued.set(ch.nonce, utf8.decode(challengeBytes(ch)));
  return ch;
}

/**
 * State.accept: the signer's key id if `env` answers an open challenge of this site; otherwise throws
 * Refused with signin.py's reason.
 */
export async function accept(site, env, c) {
  if (!env || typeof env !== "object" || Array.isArray(env) || env.payloadType !== PAYLOAD_TYPE) {
    throw new Refused(`payload type: not ${PAYLOAD_TYPE}`);
  }
  // tet-cli agent verify --sig (no --payload): the envelope's own payload is what is checked.
  let payload;
  try {
    payload = Uint8Array.from(atob(String(env.payload ?? "")), (x) => x.charCodeAt(0));
  } catch {
    payload = new Uint8Array();
  }
  const v = await c.verifyEnvelope({ envelope: env, content: payload, chain: site.chain, mldsa44Verify: c.mldsa44Verify });
  if (!v.ok) throw new Refused(`signature: ${v.reason}`);
  const eds = (env.signatures ?? []).map((s) => String(s?.keyid ?? "")).filter((k) => k.startsWith("tet-ed25519:"));
  if (eds.length !== 1) throw new Refused("signature: no single Ed25519 key id");
  const key = eds[0];
  let body;
  let ch;
  try {
    body = utf8.decode(payload);
    ch = parsePyJson(body);
  } catch {
    throw new Refused("challenge: not JSON");
  }
  if (!(ch instanceof Map) || ch.get("kind") !== KIND || pyCanonical(ch) !== body) {
    throw new Refused(`challenge: not a canonical ${KIND}`);
  }
  if (ch.get("domain") !== site.domain) {
    throw new Refused(`domain: the challenge is for ${repr(ch.get("domain"))}, this is ${repr(site.domain)}`);
  }
  const nonce = ch.get("nonce");
  if (!site.issued.has(nonce)) throw new Refused("nonce: not issued here");
  if (site.issued.get(nonce) !== body) throw new Refused("challenge: not the one issued for this nonce");
  if (site.used.has(nonce)) throw new Refused("nonce: already used");
  const exp = ch.get("expires_seq");
  const expN = exp instanceof PyNum ? exp.value : exp;
  if (site.seq > expN) throw new Refused(`expired: seq is ${site.seq}, the challenge was good to ${expN}`);
  site.used.add(nonce);
  return key;
}
