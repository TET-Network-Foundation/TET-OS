// Guard for the signature badge and proof codes (app/lib/proof_code.ts, verify_anything.mjs).
//
//   node --experimental-strip-types scripts/try_badge_guard.mjs
//
// SECURITY properties:
// 1. A hash-only signature verifies only against a file with exactly that SHA-256; any other file
//    fails. Control: a verifier that skips the hash comparison is caught.
// 2. Checking a record without its file ("record only") is refused for anything but a hash-only
//    record, so a full signature can't skip its content comparison that way.
// 3. A proof code is `TET-XXXX-XXXX` from the record's bytes: stable, normalises typed input
//    (case, O→0, I/L→1), and any changed byte changes it.
// 4b. Publishing always sends the signer's consent for exactly the record (tet-core refuses without
//    it); a lookup honours its date bounds; the file search says exact files only and that the
//    file is never uploaded. Controls.
// 4. A lookup lists every matching record and checks each: a record whose signature was tampered
//    with is listed as not verified, never as signed. Control: a lookup that trusts the code alone
//    is caught.
// 5. Wording: the page never calls a proof code a key, and says "the code finds it; the signature
//    proves it". Control: a "proof key" string is caught.

import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const pc = await import("../app/lib/proof_code.ts");
const va = await import("../app/lib/verify_anything.mjs");
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
const wallet = await activateTryWallet("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
const file = new TextEncoder().encode("whitepaper v1.1, final PDF bytes\n");
const other = new TextEncoder().encode("whitepaper v1.1, final PDF bytes!\n");
const rec = await pc.signFileHash(file, chain);
const verify = (envelope, content, extra = {}) => va.verifyEnvelope({ envelope, content, chain, mldsa44Verify, ...extra });

/** Property (1), against a verifier. */
async function onlyThisFile(v) {
  assert.equal((await v(rec.env, file)).ok, true);
  assert.equal((await v(rec.env, other)).ok, false, "another file matched a hash-only signature");
}
await check("SECURITY: a hash-only signature verifies only against a file with exactly that SHA-256", () => onlyThisFile(verify));
await check("control: a verifier that skips the hash comparison is caught", async () => {
  const skipping = (env, content) => verify(env, content, { recordOnly: true });
  await assert.rejects(() => onlyThisFile(skipping));
});

await check("SECURITY: record-only checking is refused for anything but a hash-only record", async () => {
  assert.equal((await verify(rec.env, new Uint8Array(), { recordOnly: true })).ok, true);
  const full = await sa.signContent(file, "application/pdf", chain);
  const r = await verify(full, new Uint8Array(), { recordOnly: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /only a hash-only record/);
});

await check("a proof code is TET-XXXX-XXXX, stable, normalises input, and changes with any byte", () => {
  const code = pc.proofCode(rec.bytes);
  assert.match(code, pc.PROOF_CODE_RE);
  assert.equal(pc.proofCode(rec.bytes), code);
  const changed = rec.bytes.slice();
  changed[changed.length - 2] ^= 1;
  assert.notEqual(pc.proofCode(changed), code);
  const body = code.slice(4).replace("-", "");
  const sloppy = ` tet ${body.toLowerCase().replace(/0/g, "o").replace(/1/g, "l")} `;
  assert.equal(pc.parseProofCode(sloppy), code);
  assert.equal(pc.parseProofCode("TET-UUUU-UUUU"), null, "U is not Crockford");
  // The code's 40 bits are the start of the record's file id, so a lookup can fetch just that file.
  assert.equal(pc.codePrefixHex(code), sa.stampFileId(rec.bytes).replace(/-/g, "").slice(0, 10));
  assert.equal(pc.parseProofCode("hello"), null, "too short");
  assert.equal(pc.parseProofCode("TET-1234-567U"), null, "U is not Crockford");
});

// A tampered copy of the record: same file hash, a flipped ML-DSA signature byte.
const tampered = structuredClone(rec.env);
const sig = Buffer.from(tampered.signatures[1].sig, "base64");
sig[10] ^= 1;
tampered.signatures[1].sig = sig.toString("base64");
const records = async () => [
  { bytes: rec.bytes, publishedAtMs: 2 },
  { bytes: sa.sigJsonBytes(tampered), publishedAtMs: 1 },
];

/** Property (4), against a lookup. */
async function listsAndChecks(find) {
  const byHash = await find({ query: rec.fileSha256, chain, records, mldsa44Verify });
  assert.equal(byHash.length, 2, "every record for that hash is listed");
  assert.deepEqual(byHash.map((f) => f.verified), [true, false], "the tampered record must be listed as not verified");
  let askedPrefix;
  const byCode = await find({ query: pc.proofCode(rec.bytes), chain, records: (q) => ((askedPrefix = q.codePrefix), records()), mldsa44Verify });
  // The registry indexes records by the first 40 bits of their hash: a code lookup asks only for those.
  assert.equal(askedPrefix, sa.stampFileId(rec.bytes).replace(/-/g, "").slice(0, 10), "a code lookup must ask only for its own 40 bits");
  assert.equal(byCode.length, 1);
  assert.equal(byCode[0].verified, true);
  assert.equal(byCode[0].signerEd25519, wallet);
  const bySigner = await find({ query: wallet, chain, records, mldsa44Verify });
  assert.equal(bySigner.filter((f) => f.verified).length, 1);
  assert.deepEqual(await find({ query: "hello", chain, records, mldsa44Verify }), []);
}
await check("SECURITY: a lookup lists every match and marks a tampered record as not verified", () => listsAndChecks(pc.findSignatures));
await check("control: a lookup that trusts the code alone is caught", async () => {
  const trusting = async (o) => (await pc.findSignatures(o)).map((f) => ({ ...f, verified: true }));
  await assert.rejects(() => listsAndChecks(trusting));
});

// ── 4b. Publishing carries the signer's consent; dates bound a lookup; exact files only ────────
const PC_SRC = readFileSync(new URL("../app/lib/proof_code.ts", import.meta.url), "utf8");
const PUB = PC_SRC.slice(PC_SRC.indexOf("export async function publishRecord"), PC_SRC.indexOf("export type RecordQuery"));
const consents = (src) => {
  assert.ok(/signContent\(sha256\(recordBytes\), CONSENT_PAYLOAD_TYPE/.test(src), "publishing doesn't sign a consent over the record's hash");
  assert.ok(/consent_b64:/.test(src), "publishing doesn't send the consent");
  assert.ok(PC_SRC.includes('CONSENT_PAYLOAD_TYPE = "tet sig publish v1"'), "the consent type differs from tet-core's");
};
await check("publishing always sends the signer's consent for exactly this record", () => consents(PUB));
await check("control: publishing without a consent is caught", () => assert.throws(() => consents(PUB.replace(/consent_b64:[^}]*/, ""))));
await check("a lookup honours its date bounds", async () => {
  const all = await pc.findSignatures({ query: rec.fileSha256, chain, records, mldsa44Verify });
  const t = all[0].publishedAtMs;
  assert.equal((await pc.findSignatures({ query: rec.fileSha256, chain, fromMs: t + 1, records, mldsa44Verify })).length, 0, "a record before the range was listed");
  assert.ok((await pc.findSignatures({ query: rec.fileSha256, chain, fromMs: t, toMs: t, records, mldsa44Verify })).length >= 1);
});
const HOME = readFileSync(new URL("../app/try/HomePanel.tsx", import.meta.url), "utf8");
const PCX = readFileSync(new URL("../app/try/ProofCode.tsx", import.meta.url), "utf8");
const exactLine = (srcs) => {
  for (const src of srcs) assert.ok(src.includes("Exact files only: re-compressed or edited copies won't match."), "the exact-files line is gone");
  assert.ok(HOME.includes("the file is never uploaded"), "the file search doesn't say the file stays in the tab");
};
await check("file search says exact files only, and that the file is never uploaded", () => exactLine([HOME, PCX]));
await check("control: a page without the exact-files line is caught", () => assert.throws(() => exactLine([HOME.replace("Exact files only: re-compressed or edited copies won't match.", "")])));

// ── 5. Wording ─────────────────────────────────────────────────────────────────────────────────
const KEY_WORDING = /proof[- ]key|code[- ]key|key code|証明キー|証明鍵|證明鑰匙|證明金鑰/i;
const tryDir = new URL("../app/try/", import.meta.url);
const sources = readdirSync(tryDir).filter((n) => /\.tsx?$/.test(n)).map((n) => [n, readFileSync(new URL(n, tryDir), "utf8")]);
const lib = readFileSync(new URL("../app/lib/proof_code.ts", import.meta.url), "utf8");
function wordingOk(files) {
  for (const [n, src] of files) assert.ok(!KEY_WORDING.test(src), `${n} calls a proof code a key`);
  const all = files.map(([, s]) => s).join("\n");
  assert.ok(all.includes("The code finds it; the signature proves it."), "the page lacks \"The code finds it; the signature proves it.\"");
}
await check("wording: a proof code is never called a key; the page says the code finds and the signature proves", () => wordingOk([...sources, ["proof_code.ts", lib]]));
await check("control: a \"proof key\" string is caught", () => {
  assert.throws(() => wordingOk([...sources, ["x.tsx", 't("Your proof key is TET-…")']]));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
