// Guard: every refusal in the record verifiers fires for its own reason.
//
//   node --experimental-strip-types scripts/verifier_refusals_guard.mjs
//
// The offline verifier (app/lib/offline_verify.mjs), the page's verifier (verify_anything.mjs
// verifyEnvelope) and the published CLI (public/verify/tet-verify.mjs, run as a subprocess) are each
// given one record per refusal, built so that every earlier check passes and only the check under
// test can refuse it. Each assertion names the exact reason; none accepts "any refusal". A guard that
// only asks "was it refused?" passes when a check is deleted and a later one happens to refuse.
//
// Hybrid signatures are broken one half at a time: the other record's VALID Ed25519 (or ML-DSA-44)
// signature from the same key over another file is swapped in, so exactly one half is wrong.
//
// Negative controls (by hand, recorded in the commit): each check removed or inverted in turn, in
// offline_verify.mjs (then the CLI rebuilt from it) and in verify_anything.mjs; each makes this FAIL.

import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const UI = new URL("../", import.meta.url);
const ov = await import("../app/lib/offline_verify.mjs");
const va = await import("../app/lib/verify_anything.mjs");
const pc = await import("../app/lib/proof_code.ts");
const sa = await import("../app/lib/sign_anything.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

const chain = { chainId: "tet-local-dev", genesisHash: "0x" + "ab".repeat(32) };
await activateTryWallet("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
const te = new TextEncoder();
const fileA = te.encode("a file someone marked");
const fileB = te.encode("another file, same key");
const recA = await pc.signFileHash(fileA, chain);
const recB = await pc.signFileHash(fileB, chain);
const content = te.encode("signed content, not a hash");
const recC = sa.sigJsonBytes(await sa.signContent(content, "text/plain", chain));

const dec = (b) => JSON.parse(new TextDecoder().decode(b));
const enc = (o) => te.encode(JSON.stringify(o));
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const sha256Hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
const sigOf = (e, prefix) => e.signatures.find((s) => s.keyid.startsWith(prefix));
const A = () => dec(recA.bytes);

const dir = mkdtempSync(join(tmpdir(), "tet-refusals-"));
let n = 0;
function cli(recordBytes, file, c) {
  const rec = join(dir, `r${++n}.json`);
  writeFileSync(rec, recordBytes);
  const args = ["public/verify/tet-verify.mjs", rec];
  if (file) {
    const f = join(dir, `f${n}.bin`);
    writeFileSync(f, file);
    args.push(f);
  }
  args.push("--chain", c.chainId, c.genesisHash);
  const r = spawnSync("node", args, { cwd: UI, encoding: "utf8" });
  const m = /DOES NOT VERIFY: (.*)/.exec(r.stdout);
  return { status: r.status, reason: m ? m[1].trim() : null, out: r.stdout + r.stderr };
}

// One case: the record bytes, the file given with it (null = record only), and the exact reason each
// verifier must give. `page` defaults to `offline`; `null` means the case does not apply to it.
async function refuse(name, { bytes, file = fileA, offline, page = offline, c = chain }) {
  await check(name, async () => {
    if (offline !== null) {
      const a = await ov.verifyRecordOffline({ recordBytes: bytes, file, chain: c, mldsa44Verify });
      assert.equal(a.ok, false, `offline verifier accepted it`);
      assert.equal(a.reason, offline, "offline verifier");
      const r = cli(bytes, file, c);
      assert.equal(r.status, 1, `CLI exit ${r.status}: ${r.out}`);
      assert.equal(r.reason, offline, "CLI");
    }
    if (page !== null) {
      let env;
      try { env = dec(bytes); } catch { env = undefined; }
      const b = await va.verifyEnvelope({ envelope: env, content: file ?? new Uint8Array(), recordOnly: !file, chain: c, mldsa44Verify });
      assert.equal(b.ok, false, `page verifier accepted it`);
      assert.equal(b.reason, page, "page verifier");
    }
  });
}

// The fixtures themselves, so a refusal below is never the fixture's own fault.
await check("baseline: the three records verify in all three verifiers", async () => {
  for (const [bytes, file] of [[recA.bytes, fileA], [recA.bytes, null], [recB.bytes, fileB], [recC, content]]) {
    const a = await ov.verifyRecordOffline({ recordBytes: bytes, file, chain, mldsa44Verify });
    assert.ok(a.ok, `offline: ${a.reason}`);
    const b = await va.verifyEnvelope({ envelope: dec(bytes), content: file ?? new Uint8Array(), recordOnly: !file, chain, mldsa44Verify });
    assert.ok(b.ok, `page: ${b.reason}`);
    const r = cli(bytes, file, chain);
    assert.equal(r.status, 0, r.out);
  }
  assert.notEqual(sigOf(A(), "tet-ed25519:").sig, sigOf(dec(recB.bytes), "tet-ed25519:").sig);
  assert.notEqual(sigOf(A(), "tet-mldsa44:").sig, sigOf(dec(recB.bytes), "tet-mldsa44:").sig);
});

await refuse("bytes that are not JSON", { bytes: te.encode("not json"), offline: "the record is not JSON", page: null });
await refuse("a payload that is not base64", { bytes: enc({ ...A(), payload: "!!!!" }), offline: "envelope is not valid base64" });
await refuse("a JSON array is not a record", { bytes: enc([A()]), offline: "the record is not a JSON object", page: "the .sig.json is not a JSON object" });
await refuse("JSON null is not a record", { bytes: te.encode("null"), offline: "the record is not a JSON object", page: "the .sig.json is not a JSON object" });
await refuse("another envelope version", { bytes: enc({ ...A(), tet: { ...A().tet, v: 2 } }), offline: "unsupported envelope version" });
await refuse("another pre-image encoding", { bytes: enc({ ...A(), tet: { ...A().tet, pae: "DSSEv1" } }), offline: 'unknown pre-image encoding "DSSEv1"' });
await refuse("an extra top-level field", { bytes: enc({ ...A(), note: "x" }), offline: 'unexpected field "note"' });
await refuse("an extra field in the tet block", { bytes: enc({ ...A(), tet: { ...A().tet, chain_id: "tet-other" } }), offline: "unexpected field tet.chain_id" });
await refuse("a blank payloadType", { bytes: enc({ ...A(), payloadType: "   " }), offline: "payloadType is missing" });
await refuse("three signatures", { bytes: enc({ ...A(), signatures: [...A().signatures, sigOf(A(), "tet-mldsa44:")] }), offline: "expected exactly 2 signatures, got 3" });
await refuse("two Ed25519 signatures and no ML-DSA one", {
  bytes: (() => { const e = A(); const ed = sigOf(e, "tet-ed25519:"); e.signatures = [ed, { ...ed }]; return enc(e); })(),
  offline: "missing or duplicated ed25519 signature",
});
await refuse("an Ed25519 signature and an unlabelled one", {
  bytes: (() => { const e = A(); const ml = sigOf(e, "tet-mldsa44:"); ml.keyid = "tet-other:" + ml.keyid.slice(12); return enc(e); })(),
  offline: "missing or duplicated ml-dsa-44 signature",
});
// Upper-case hex everywhere it appears, so the key id matches and only the form check can refuse.
await refuse("an upper-case Ed25519 key", {
  bytes: (() => { const e = A(); const k = e.tet.agent_ed25519_pubkey_hex.toUpperCase(); e.tet.agent_ed25519_pubkey_hex = k; sigOf(e, "tet-ed25519:").keyid = "tet-ed25519:" + k; return enc(e); })(),
  offline: "the ed25519 key is not 64 lowercase hex",
});
await refuse("an Ed25519 key id naming another key", {
  bytes: (() => { const e = A(); sigOf(e, "tet-ed25519:").keyid = "tet-ed25519:" + "00".repeat(32); return enc(e); })(),
  offline: "ed25519 keyid does not match the key it names",
});
await refuse("an ML-DSA key id naming another key", {
  bytes: (() => { const e = A(); sigOf(e, "tet-mldsa44:").keyid = "tet-mldsa44:" + "cd".repeat(32); return enc(e); })(),
  offline: "ml-dsa-44 keyid does not match the key it names",
});
// The key id is recomputed for the substituted key, so only the level pin can refuse it.
const wrongKey = new Uint8Array(1952).fill(3);
const wrongKeyRecord = await (async () => { const e = A(); e.tet.agent_mldsa44_pubkey_b64 = b64(wrongKey); sigOf(e, "tet-mldsa44:").keyid = "tet-mldsa44:" + (await sha256Hex(wrongKey)); return enc(e); })();
await refuse("an ML-DSA key of another level, its key id matching", { bytes: wrongKeyRecord, offline: "ml-dsa key is not ML-DSA-44" });
await refuse("an ML-DSA signature of another length", {
  bytes: (() => { const e = A(); sigOf(e, "tet-mldsa44:").sig = b64(new Uint8Array(3309).fill(5)); return enc(e); })(),
  offline: "ml-dsa signature is not ML-DSA-44",
});
const shortHash = (() => { const e = A(); e.payload = b64(new Uint8Array(31).fill(9)); return enc(e); })();
await refuse("a hash-only record carrying 31 bytes, with the file", { bytes: shortHash, offline: "a hash-only signature must carry exactly 32 bytes" });
await refuse("a hash-only record carrying 31 bytes, record only", { bytes: shortHash, file: null, offline: "a hash-only signature must carry exactly 32 bytes" });
await refuse("a hash-only record with another file", { bytes: recA.bytes, file: fileB, offline: "the file's SHA-256 differs from the one that was signed" });
await refuse("a content record without its content", {
  bytes: recC,
  file: null,
  offline: "this record signs its content, not a hash: give the file too",
  page: "only a hash-only record can be checked without its file",
});
await refuse("a content record with other content", {
  bytes: recC,
  file: te.encode("other"),
  offline: `the content differs from what was signed (signed ${content.length} bytes, given 5)`,
});
await refuse("the Ed25519 half swapped for a valid one over another file", {
  bytes: (() => { const e = A(); sigOf(e, "tet-ed25519:").sig = sigOf(dec(recB.bytes), "tet-ed25519:").sig; return enc(e); })(),
  offline: "ed25519 signature does not verify (on this chain binding)",
});
await refuse("the ML-DSA-44 half swapped for a valid one over another file", {
  bytes: (() => { const e = A(); sigOf(e, "tet-mldsa44:").sig = sigOf(dec(recB.bytes), "tet-mldsa44:").sig; return enc(e); })(),
  offline: "ml-dsa-44 signature does not verify (on this chain binding)",
});
await refuse("the right record checked against another genesis hash", {
  bytes: recA.bytes,
  c: { ...chain, genesisHash: "0x" + "cd".repeat(32) },
  offline: "ed25519 signature does not verify (on this chain binding)",
});

rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
