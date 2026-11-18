/**
 * A machine notebook held in the tab. The page writes chain.json, device.keyid, records/<seq>.json
 * and its .sig.json, chain.txt, and permits/<id>.json and its .sig.json: the folder files that
 * `tools/machine-notebook/notebook.py` writes, byte for byte in the same canonical JSON, signed by a
 * test key from page_key.ts. It writes no device.key (the key lives in memory and is never written
 * down) and no device.pin. `notebook.py verify` needs the signer's pin, both key ids, from a file
 * kept outside the folder (`--pin`); a folder alone does not say which key it should have been.
 *
 * Checking is always the page's real checker, lib/machine_log.mjs `checkMachineLog` (the port of
 * notebook.py verify), passed in as `c.checkMachineLog` so a guard can swap it. A permit is claimed
 * the way notebook.py `record --permit` does it: the record is checked before it is kept, and a
 * refused claim leaves the log exactly as it was.
 */
import { sha256 } from "@noble/hashes/sha2";
import { KIND, PAYLOAD_TYPE, PERMIT_KIND, PERMIT_PAYLOAD_TYPE, PyNum, pyCanonical } from "../../lib/machine_log.mjs";
import { bytesToHex } from "../../lib/ed25519_tet";
import { signEnvelope, type Chain, type Checkers, type TestKey } from "./page_key";

const ZERO = "0".repeat(64);
const enc = new TextEncoder();

type Plain = string | number | boolean | null | Plain[] | { [k: string]: Plain };

/** notebook.py canonical() of a plain value (integers only, as every record here). */
export function canonical(v: Plain): string {
  const conv = (x: Plain): unknown => {
    if (typeof x === "number") {
      if (!Number.isInteger(x)) throw new Error("only integers in a page notebook");
      return new PyNum(String(x));
    }
    if (Array.isArray(x)) return x.map(conv);
    if (x && typeof x === "object") return new Map(Object.entries(x).map(([k, y]) => [k, conv(y)]));
    return x;
  };
  return pyCanonical(conv(v));
}

export type Notebook = { key: TestKey; chain: Chain; files: Map<string, Uint8Array>; hashes: string[] };

export function newNotebook(key: TestKey, chain: Chain): Notebook {
  const files = new Map<string, Uint8Array>();
  files.set("chain.json", enc.encode(`${JSON.stringify({ chain_id: chain.chainId, genesis_hash: chain.genesisHash })}\n`));
  files.set("device.keyid", enc.encode(`${key.keyid}\n`));
  return { key, chain, files, hashes: [] };
}

function randomHex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** notebook.py permit: a one-time permit for `action`, open up to record `expiresSeq`. Its id. */
export async function addPermit(nb: Notebook, action: string, expiresSeq: number): Promise<string> {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(action)) throw new Error("an action is a short name: 1 to 64 of A-Z a-z 0-9 . _ -");
  if (!Number.isInteger(expiresSeq) || expiresSeq < 1) throw new Error("expires_seq must be 1 or more");
  const pid = randomHex(16);
  const body = enc.encode(canonical({ kind: PERMIT_KIND, permit_id: pid, action, expires_seq: expiresSeq }));
  const env = await signEnvelope(nb.key, nb.chain, PERMIT_PAYLOAD_TYPE, body);
  nb.files.set(`permits/${pid}.json`, body);
  nb.files.set(`permits/${pid}.json.sig.json`, enc.encode(JSON.stringify(env)));
  return pid;
}

function withChainTxt(files: Map<string, Uint8Array>, hashes: string[]): Map<string, Uint8Array> {
  const out = new Map(files);
  if (hashes.length) out.set("chain.txt", enc.encode(hashes.map((h) => `${h}\n`).join("")));
  else out.delete("chain.txt");
  return out;
}

/** Run the checker over a set of files. */
export function checkFiles(files: Map<string, Uint8Array>, c: Checkers) {
  return c.checkMachineLog({
    paths: [...files.keys()],
    read: async (p: string) => {
      const b = files.get(p);
      if (!b) throw new Error(`not in the notebook: ${p}`);
      return b;
    },
    mldsa44Verify: c.mldsa44Verify,
  });
}

export const checkNotebook = (nb: Notebook, c: Checkers) => checkFiles(withChainTxt(nb.files, nb.hashes), c);

export type Reading = { value: string | number | boolean; unit: string };
export type Written = { ok: true; seq: number; hash: string } | { ok: false; seq: number; why: string[] };

/**
 * notebook.py record: sign the next record and keep it. With a permit, the record is first checked
 * together with the log (the real checker); if the checker finds a problem with this record, it is
 * not kept and the reasons are returned.
 */
export async function addRecord(nb: Notebook, reading: Reading, c: Checkers, permit?: string): Promise<Written> {
  const seq = nb.hashes.length + 1;
  const rec: { [k: string]: Plain } = {
    v: 1,
    kind: KIND,
    seq,
    prev: nb.hashes.length ? nb.hashes[nb.hashes.length - 1] : ZERO,
    reading: { source: "stdin-json", value: reading.value, unit: reading.unit },
    clock_utc: `${new Date().toISOString().slice(0, 19)}Z`,
  };
  if (permit !== undefined) rec.permit = permit;
  const body = enc.encode(canonical(rec));
  const env = await signEnvelope(nb.key, nb.chain, PAYLOAD_TYPE, body);
  const hash = bytesToHex(sha256(body));
  const files = new Map(nb.files);
  files.set(`records/${seq}.json`, body);
  files.set(`records/${seq}.json.sig.json`, enc.encode(JSON.stringify(env)));
  if (permit !== undefined) {
    const r = await checkFiles(withChainTxt(files, [...nb.hashes, hash]), c);
    const mine = r.kind === "verdict" ? r.problems.filter((p) => p.seq === seq).map((p) => p.why) : ["the log could not be checked"];
    if (mine.length) return { ok: false, seq, why: mine };
  }
  nb.files = files;
  nb.hashes.push(hash);
  return { ok: true, seq, hash };
}
