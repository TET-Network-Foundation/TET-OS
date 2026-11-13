// "Check a machine's log" (Try TET): the browser's copy of `notebook.py verify`
// (tools/machine-notebook/notebook.py, `check_chain` and `permit_problem`), run on a notebook folder
// the visitor drops. Same checks, same order, same wording for every problem it finds itself.
//
// No new cryptography. Every envelope (records/<seq>.json.sig.json, permits/<id>.json.sig.json) is
// checked by `verifyEnvelope` (lib/verify_anything.mjs), the page's port of tet-core's
// `AgentSigEnvelopeV1::verify`, which is what `tet-cli agent verify --sig … --payload …` runs. When a
// signature fails, the reason is that verifier's wording, not tet-cli's.
//
// The chain binding is read from the folder's chain.json, exactly as notebook.py does (it passes it
// to tet-cli as TET_CHAIN_ID / TET_GENESIS_HASH, which tet-core trims, and lowercases the hash).
//
// Nothing here reads device.key: the caller hands a `read(path)` and this module asks only for the
// paths below, plus every permits/<id>.json(.sig.json) for the /agents permit list. The stamp check (`verify --node`) is not done here.
//
// Plain ESM; ML-DSA verification is injected (`mldsa44Verify`) so a guard runs this under Node.

import { sha256 } from "@noble/hashes/sha2";
import { verifyEnvelope } from "./verify_anything.mjs";

export const KIND = "tet_machine_log_v1";
export const PAYLOAD_TYPE = "application/vnd.tet.machine-log+json";
export const PERMIT_KIND = "tet_machine_permit_v1";
export const PERMIT_PAYLOAD_TYPE = "application/vnd.tet.machine-permit+json";
const ZERO = "0".repeat(64);

/** Word for word notebook.py's SHOWS (scripts/try_machine_log_guard.mjs pins it). */
export const SHOWS = [
  "which key signed each record",
  "that the records are in this order",
  "that each record was written before the next one",
  "that no one-time permission was used twice in this log, or after it ran out",
];

/** Word for word notebook.py's DOES_NOT_SHOW (scripts/try_machine_log_guard.mjs pins it). */
export const DOES_NOT_SHOW = [
  "that the reading is true",
  "that the machine's clock was right",
  "where the machine was",
  "who runs the machine",
  "that the key was not copied",
  "that a copied key did not use the same permission in another log",
];

/**
 * The most records this page checks. Each one is two signature checks in the visitor's tab; a longer
 * log is refused with this number named, never cut short (notebook.py verify has no limit).
 */
export const MAX_RECORDS = 5000;

/**
 * The most permit files this page lists for one folder (/agents). Each is two signature checks; past
 * this, the listing is refused with the count named (`permitsTooMany`), never cut short. The verdict
 * itself is unaffected: it checks only the permits records cite, as notebook.py verify does.
 */
export const MAX_PERMITS = 1000;

const SECRET = "device.key";

// ── Python's JSON, so a record is compared byte for byte with notebook.py's canonical() ─────────────
//
// canonical(obj) = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True). To
// re-serialize what json.loads read, a number must stay what Python made of it: an int (exact, any
// size) or a float (written back by repr). JSON.parse loses that, so this parser keeps each number
// as a PyNum. It accepts what json.loads accepts (NaN, Infinity, -Infinity included, no control
// characters inside strings); a duplicated key keeps the last value, as Python's dict does.

export class PyNum {
  constructor(raw) {
    this.isInt = /^-?(0|[1-9][0-9]*)$/.test(raw);
    this.big = this.isInt ? BigInt(raw) : null;
    this.value = raw === "NaN" ? NaN : raw === "Infinity" ? Infinity : raw === "-Infinity" ? -Infinity : Number(raw);
  }
}

class NotJson extends Error {}

export function parsePyJson(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const fail = () => {
    throw new NotJson("not JSON");
  };
  function value() {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj = new Map();
      ws();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const k = string();
        ws();
        if (text[i++] !== ":") fail();
        obj.set(k, value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") {
          i++;
          return obj;
        } else fail();
      }
    }
    if (c === "[") {
      i++;
      const arr = [];
      ws();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") {
          i++;
          return arr;
        } else fail();
      }
    }
    if (c === '"') return string();
    for (const [lit, v] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return v;
      }
    }
    for (const lit of ["NaN", "Infinity", "-Infinity"]) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return new PyNum(lit);
      }
    }
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(text.slice(i));
    if (!m) fail();
    i += m[0].length;
    return new PyNum(m[0]);
  }
  function string() {
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail();
      const c = text[i++];
      if (c === '"') return out;
      if (c.charCodeAt(0) < 0x20) fail();
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = text[i++];
      const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[e];
      if (simple !== undefined) out += simple;
      else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) {
        out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16));
        i += 4;
      } else fail();
    }
  }
  const v = value();
  ws();
  if (i !== text.length) fail();
  return v;
}

/** repr(float) in Python 3: shortest round-trip digits, exponent form below 1e-4 and from 1e16. */
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mant, expS] = x.toExponential().split("e");
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  const exp = parseInt(expS, 10);
  let s;
  if (exp < -4 || exp >= 16) {
    s = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  } else if (exp < 0) {
    s = `0.${"0".repeat(-exp - 1)}${digits}`;
  } else {
    s = `${digits.slice(0, exp + 1).padEnd(exp + 1, "0")}.${digits.slice(exp + 1) || "0"}`;
  }
  return (neg ? "-" : "") + s;
}

/** json.dumps(s, ensure_ascii=True) for one string. */
function pyJsonString(s) {
  let out = '"';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    const code = s.charCodeAt(k);
    const named = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" }[c];
    if (named) out += named;
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += c;
  }
  return `${out}"`;
}

/** Python's str ordering (by code point), for sort_keys. */
function byCodePoint(a, b) {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k] - y[k];
  return x.length - y.length;
}

/** notebook.py canonical(), as a string (ASCII by construction). */
export function pyCanonical(v) {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (v instanceof PyNum) return v.isInt ? v.big.toString() : pyFloatRepr(v.value);
  if (typeof v === "string") return pyJsonString(v);
  if (Array.isArray(v)) return `[${v.map(pyCanonical).join(",")}]`;
  const keys = [...v.keys()].sort(byCodePoint);
  return `{${keys.map((k) => `${pyJsonString(k)}:${pyCanonical(v.get(k))}`).join(",")}}`;
}

/** Python `v == n` for an int n: an int or float of that value, or a bool (True == 1). */
const pyEqInt = (v, n) => (v instanceof PyNum ? v.value === n : typeof v === "boolean" ? Number(v) === n : false);

/** Python `isinstance(v, int) and not isinstance(v, bool)`. */
const pyIsInt = (v) => v instanceof PyNum && v.isInt;

/** Python str(v), for the values notebook.py puts in a message. */
function pyStr(v) {
  if (v === undefined || v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v;
  return pyCanonical(v);
}

/** Python repr(v) for a str or None (the payload type message uses !r). */
function pyRepr(v) {
  if (typeof v !== "string") return v === undefined || v === null ? "None" : pyStr(v);
  const q = v.includes("'") && !v.includes('"') ? '"' : "'";
  return q + v.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`) + q;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** json.loads on bytes: a value, or undefined when Python would raise ValueError. */
function loads(bytes) {
  try {
    return parsePyJson(utf8.decode(bytes));
  } catch {
    return undefined;
  }
}

/** A plain JSON object (for an envelope), or {} when it is not one, as notebook.py's `except ValueError: env = {}`. */
function loadsEnvelope(bytes) {
  try {
    const v = JSON.parse(utf8.decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** notebook.py ed_keyid: the one tet-ed25519 keyid among the signatures, else None. */
function edKeyId(env) {
  const sigs = Array.isArray(env.signatures) ? env.signatures : [];
  const ids = sigs.map((s) => String(s?.keyid ?? "")).filter((k) => k.startsWith("tet-ed25519:"));
  return ids.length === 1 ? ids[0] : null;
}

// ── the folder ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The paths of a dropped folder, relative to the notebook folder itself. A dropped folder arrives as
 * `<name>/records/1.json`; its contents dropped loose arrive as `records/1.json`.
 */
export function notebookPaths(raw) {
  const paths = raw.map((p) => String(p).replace(/\\/g, "/").replace(/^\/+/, ""));
  // Files picked one by one (a phone cannot pick a folder) arrive as bare names. Their places follow
  // from the names, which cannot collide: a record is digits, a permit 32 hex.
  if (paths.length && paths.every((p) => !p.includes("/"))) {
    return paths.map((p) =>
      /^[0-9]+\.(json|json\.sig\.json|hash\.sig\.json)$/.test(p)
        ? `records/${p}`
        : /^[0-9a-f]{32}\.json(\.sig\.json)?$/.test(p)
          ? `permits/${p}`
          : p,
    );
  }
  const atRoot = (ps) => ps.some((p) => p === "chain.json" || p === "chain.txt" || p.startsWith("records/") || p.startsWith("permits/"));
  if (atRoot(paths)) return paths;
  const first = new Set(paths.map((p) => p.split("/")[0]));
  if (first.size === 1) {
    const strip = paths.map((p) => p.split("/").slice(1).join("/")).filter(Boolean);
    if (atRoot(strip)) return strip;
  }
  return paths;
}

/**
 * Check a notebook folder.
 *
 * @param {{ paths: string[], read: (path: string) => Promise<Uint8Array>,
 *           mldsa44Verify: (pub: string, sig: string, msg: Uint8Array) => Promise<boolean> }} o
 *   `paths` relative to the notebook folder (see notebookPaths); `read` is asked only for the files
 *   notebook.py verify opens, never device.key.
 * @returns {Promise<
 *   | { kind: "verdict", valid: boolean, problems: { seq: number | null, why: string }[], records: number,
 *       signer: string | null, uses: { seq: number, permit: { permitId: string, action: string, expiresSeq: bigint } }[],
 *       chain: { chainId: string, genesisHash: string }, hasDeviceKey: boolean, keyid: string | null,
 *       citations: { seq: number, permitId: string | null, ok: boolean }[],
 *       permits: { permitId: string, permit: { permitId: string, action: string, expiresSeq: bigint } | null, why: string | null }[],
 *       permitsTooMany: number | null }
 *   | { kind: "error", error: "no_chain" | "too_many", records: number, hasDeviceKey: boolean }>}
 */
export async function checkMachineLog(o) {
  const have = new Set(o.paths);
  const hasDeviceKey = have.has(SECRET);
  const read = async (p) => {
    if (p === SECRET) throw new Error("device.key is never read");
    return o.read(p);
  };
  const exists = (p) => have.has(p);

  const names = [];
  for (const p of o.paths) {
    const m = /^records\/([0-9]+)\.json$/.exec(p);
    if (m) names.push([parseInt(m[1], 10), p.slice("records/".length)]);
  }
  names.sort((a, b) => a[0] - b[0] || byCodePoint(a[1], b[1]));
  const problems = [];
  if (!names.length) {
    return { kind: "verdict", valid: false, problems: [{ seq: null, why: "no records" }], records: 0, signer: null, uses: [], chain: null, hasDeviceKey, keyid: null, citations: [], permits: [], permitsTooMany: null };
  }
  if (names.length > MAX_RECORDS) return { kind: "error", error: "too_many", records: names.length, hasDeviceKey };
  // notebook.py's chain_env: without chain.json it stops (an error, not a verdict) at the first check.
  if (!exists("chain.json")) return { kind: "error", error: "no_chain", records: names.length, hasDeviceKey };
  const c = loadsEnvelope(await read("chain.json"));
  if (typeof c.chain_id !== "string" || typeof c.genesis_hash !== "string") {
    return { kind: "error", error: "no_chain", records: names.length, hasDeviceKey };
  }
  const chain = { chainId: c.chain_id.trim(), genesisHash: c.genesis_hash.trim().toLowerCase() };

  const text = async (p) => (exists(p) ? new TextDecoder().decode(await read(p)) : null);
  const chainTxt = await text("chain.txt");
  const chainLines = chainTxt == null ? [] : chainTxt.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  if (chainLines.length !== names.length) {
    problems.push({ seq: null, why: `chain.txt lists ${chainLines.length} records, records/ holds ${names.length}` });
  }
  const keyidTxt = await text("device.keyid");
  const wantKeyid = keyidTxt == null ? null : keyidTxt.trim();

  /** tet-cli agent verify --sig sig --payload payload: null when it passes, else why not. */
  const agentVerify = async (env, payload) => {
    const r = await verifyEnvelope({ envelope: env, content: payload, chain, mldsa44Verify: o.mldsa44Verify });
    return r.ok ? null : r.reason;
  };

  /**
   * notebook.py permit_problem: why record `seq` may not cite permit `pid`, or null if it may, as
   * { why, permit }. One reason per citation, in notebook.py's order, so each reason has exactly one
   * check that can give it: a permit id; in the notebook; its envelope verifies over exactly these
   * bytes; permit payload type; signed by this device's key; a permit, and the one the file name says;
   * still open at this seq; not cited before. `used` maps a permit id to the record that cited it first.
   */
  async function permitProblem(pid, seq, used, device) {
    if (typeof pid !== "string" || !/^[0-9a-f]{32}$/.test(pid)) return { why: "permit: not a permit id (32 hex)", permit: null };
    const path = `permits/${pid}.json`;
    const sig = `${path}.sig.json`;
    if (!exists(path) || !exists(sig)) return { why: `permit: ${pid} is not in this notebook`, permit: null };
    const body = await read(path);
    const sigBytes = await read(sig);
    let envObj;
    try {
      envObj = JSON.parse(utf8.decode(sigBytes));
    } catch {
      envObj = undefined;
    }
    const sigWhy = envObj === undefined ? "the .sig.json is not JSON" : await agentVerify(envObj, body);
    if (sigWhy !== null) return { why: `permit: ${pid}: signature: ${sigWhy}`, permit: null };
    // Only after the envelope verified, as notebook.py: each keyid then names the key that signed.
    const env = loadsEnvelope(sigBytes);
    if (env.payloadType !== PERMIT_PAYLOAD_TYPE) {
      return { why: `permit: ${pid}: payload type is ${pyRepr(env.payloadType)}, not ${PERMIT_PAYLOAD_TYPE}`, permit: null };
    }
    const signer = edKeyId(env);
    if (!device || signer !== device) return { why: `permit: ${pid} is signed by ${pyStr(signer)}, not this device's ${pyStr(device)}`, permit: null };
    const p = loads(body);
    const isMap = p instanceof Map;
    if (
      !isMap ||
      [...p.keys()].sort().join(",") !== "action,expires_seq,kind,permit_id" ||
      p.get("kind") !== PERMIT_KIND ||
      pyCanonical(p) !== utf8.decode(body) ||
      typeof p.get("action") !== "string" ||
      !pyIsInt(p.get("expires_seq"))
    ) {
      return { why: `permit: ${pid} is not a ${PERMIT_KIND} permit`, permit: null };
    }
    // The id inside the signed bytes, not the file name, is the permit: a copy under a second name is
    // not a second permit.
    if (p.get("permit_id") !== pid) return { why: `permit: ${pid}.json holds permit ${pyStr(p.get("permit_id"))}`, permit: null };
    const permit = { permitId: pid, action: p.get("action"), expiresSeq: p.get("expires_seq").big };
    if (BigInt(seq) > permit.expiresSeq) return { why: `permit: ${pid} expired after seq ${permit.expiresSeq}`, permit };
    if (used.has(pid)) return { why: `permit: ${pid} was already used by record ${used.get(pid)}`, permit };
    return { why: null, permit };
  }

  const signers = [];
  const used = new Map(); // permit id -> the record that cited it first
  const uses = []; // { seq, permit } for every citation that checked out
  const citations = []; // { seq, permitId, ok } for every record that names a permit, refused or not
  let prevHash = ZERO;
  for (const [idx, [n, name]] of names.entries()) {
    const i = idx + 1;
    const path = `records/${name}`;
    const body = await read(path);
    const h = hex(sha256(body));
    const add = (why) => problems.push({ seq: n, why });
    let k = null;
    if (n !== i) add(`seq: file ${name} where record ${i} should be (a record is missing)`);
    // 1. the envelope: both signature halves, and the payload is exactly this file
    const sig = `${path}.sig.json`;
    if (!exists(sig)) {
      add("signature: no envelope");
    } else {
      const sigBytes = await read(sig);
      let envObj;
      try {
        envObj = JSON.parse(utf8.decode(sigBytes));
      } catch {
        envObj = undefined;
      }
      const why = envObj === undefined ? "the .sig.json is not JSON" : await agentVerify(envObj, body);
      if (why !== null) add(`signature: ${why}`);
      const env = loadsEnvelope(sigBytes);
      if (env.payloadType !== PAYLOAD_TYPE) add(`signature: payload type is ${pyRepr(env.payloadType)}, not ${PAYLOAD_TYPE}`);
      k = edKeyId(env);
      signers.push(k);
      if (wantKeyid && k !== wantKeyid) add(`key: signed by ${pyStr(k)}, not this device's ${wantKeyid}`);
    }
    // 2. the record itself
    const rec = loads(body);
    if (rec === undefined) {
      add("record: not JSON");
      prevHash = h;
      continue;
    }
    const get = (k) => (rec instanceof Map ? rec.get(k) : undefined);
    if (pyCanonical(rec) !== utf8.decode(body)) add("record: not canonical JSON");
    if (!pyEqInt(get("v"), 1) || get("kind") !== KIND) add("record: not a tet_machine_log_v1 record");
    if (!pyEqInt(get("seq"), i)) add(`seq: says ${pyStr(get("seq"))}, is record ${i} in order`);
    if (get("prev") !== prevHash) add("prev: does not name the record before it");
    if (i <= chainLines.length && chainLines[i - 1] !== h) add("chain.txt: hash differs from the record");
    // 3. the permit it cites, if any: this device's own, still open at this seq, not cited before
    if (rec instanceof Map && rec.has("permit")) {
      const pid = rec.get("permit");
      const { why, permit } = await permitProblem(pid, i, used, wantKeyid || k);
      if (why) add(why);
      else uses.push({ seq: n, permit });
      citations.push({ seq: n, permitId: typeof pid === "string" ? pid : null, ok: !why });
      // notebook.py's used.setdefault: a citation counts as the first use even when it was refused.
      if (typeof pid === "string" && !used.has(pid)) used.set(pid, n);
    }
    prevHash = h;
  }
  const distinct = new Set(signers);
  if (distinct.size > 1) problems.push({ seq: null, why: `key: ${distinct.size} different keys signed this log` });

  // Every permit file in the folder, for /agents' list (notebook.py verify opens only the cited ones;
  // this changes no verdict). Each goes through the same permitProblem as a citation, with nothing
  // marked used and at seq 0, so `permit` is set exactly when the permit is genuine and this device's.
  // The device is device.keyid, else the one key that signed every record; with neither, no permit is
  // this device's.
  const permitIds = [...new Set(o.paths.map((p) => /^permits\/([0-9a-f]{32})\.json$/.exec(p)?.[1]).filter(Boolean))].sort();
  const device = wantKeyid || (distinct.size === 1 ? [...distinct][0] : null);
  const permits = [];
  let permitsTooMany = null;
  if (permitIds.length > MAX_PERMITS) permitsTooMany = permitIds.length;
  else {
    for (const pid of permitIds) {
      const { why, permit } = await permitProblem(pid, 0, new Map(), device);
      permits.push({ permitId: pid, permit, why: permit ? null : why });
    }
  }
  return {
    kind: "verdict",
    valid: problems.length === 0,
    problems,
    records: names.length,
    signer: problems.length === 0 ? signers[0] : null,
    uses: problems.length === 0 ? uses : [],
    chain,
    hasDeviceKey,
    keyid: wantKeyid || null,
    citations,
    permits,
    permitsTooMany,
  };
}

/** notebook.py verify's problem line: `record 3: prev: …` or `log: …`. */
export function problemLine(p) {
  return `${p.seq !== null ? `record ${p.seq}` : "log"}: ${p.why}`;
}

/** notebook.py verify's line for a permit used in a VALID log. */
export function useLine(u) {
  return `permit ${u.permit.permitId} (${u.permit.action}): used once, by record ${u.seq}; open until seq ${u.permit.expiresSeq}`;
}

/**
 * The one short sentence a result leads with, as a kind (the page words it):
 *   consistent       VALID;
 *   reused           INVALID, and every problem is a one-time permission cited again;
 *   expired          INVALID, and every problem is a permission cited after it ran out;
 *   inconsistent     INVALID for any other reason, or a mix (the specific sentences are used only
 *                    when they are the whole story; the reasons are behind "Show details");
 *   not_checked      notebook.py verify would stop with an error (no chain.json, or too long here).
 */
export function verdictKind(r) {
  if (r.kind !== "verdict") return "not_checked";
  if (r.valid) return "consistent";
  const all = (re) => r.problems.length > 0 && r.problems.every((p) => re.test(p.why));
  if (all(/^permit: [0-9a-f]{32} was already used by record \d+$/)) return "reused";
  if (all(/^permit: [0-9a-f]{32} expired after seq \d+$/)) return "expired";
  return "inconsistent";
}

/** A folder held as { path: base64 } (the bundled samples), as checkMachineLog's paths and read. */
export function base64Folder(files) {
  const paths = Object.keys(files);
  const read = async (p) => {
    if (!(p in files)) throw new Error(`not in the folder: ${p}`);
    const bin = atob(files[p]);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
  return { paths, read };
}
