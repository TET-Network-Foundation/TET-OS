// Signature search, end to end against a real node: the page's own modules through `/tet-node-api`.
// Not a CI step (it needs a running node and UI); the PR records its output.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3200 node --experimental-strip-types scripts/try_sigsearch_e2e.mjs
//
//   1. A signs a file's hash and publishes the record (with A's consent). Its proof code finds it.
//   2. The same file (hashed here, never sent) finds it; a one-byte-different copy finds nothing.
//   3. A's key lists A's public signatures; a date range before the publish lists nothing.
//   4. B, holding A's .sig.json, tries to publish it with B's own consent: refused. A record of A's
//      that A never published isn't found.

import { register } from "node:module";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const BASE = "/tet-node-api";
const realFetch = globalThis.fetch;
globalThis.fetch = (i, o = {}) => realFetch(String(i).startsWith("/") ? ORIGIN + String(i) : String(i), o);

const pc = await import("../app/lib/proof_code.ts");
const sa = await import("../app/lib/sign_anything.ts");
const trySession = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const { expectedChainBinding } = await import("../app/lib/chain_binding.ts");
const chain = await expectedChainBinding(BASE);
const step = (s) => console.log(`\n== ${s}`);
const find = (query, extra = {}) => pc.findSignatures({ query, chain, records: (q) => pc.registryRecords(BASE, q), mldsa44Verify, ...extra });
const sha = (b) => createHash("sha256").update(b).digest("hex");

step("1. A signs a file's hash and publishes it");
const A = await trySession.activateTryWallet(generateDisposableWords());
const file = new TextEncoder().encode(`lab notebook page 12 · ${Date.now()}`);
const rec = await pc.signFileHash(file, chain);
const before = Date.now();
const code = await pc.publishRecord(BASE, rec.bytes, chain);
console.log(`  proof code ${code}`);
let hits = await find(code);
assert.equal(hits.length, 1);
assert.ok(hits[0].verified);
console.log(`  code finds it: signed by ${hits[0].signerEd25519.slice(0, 12)}… · verified`);

step("2. by file (hashed here)");
hits = await find(sha(file));
assert.equal(hits.length, 1);
console.log(`  the same file: ${hits.length} match, verified=${hits[0].verified}`);
const edited = new Uint8Array(file);
edited[0] ^= 1;
assert.equal((await find(sha(edited))).length, 0);
console.log("  a copy one byte different: 0 matches (exact files only)");

step("3. by signer, and by date");
hits = await find(A);
assert.ok(hits.length >= 1 && hits.every((h) => h.signerEd25519 === A));
console.log(`  A's key: ${hits.length} public signature(s)`);
assert.equal((await find(A, { toMs: before - 60_000 })).length, 0);
console.log("  A's key, published before a minute ago: 0");

step("4. consent");
const unpublished = await pc.signFileHash(new TextEncoder().encode("A never published this"), chain);
await trySession.activateTryWallet(generateDisposableWords());
// B signs a consent over A's record with B's own key and posts it.
const consent = await sa.signContent(createHash("sha256").update(unpublished.bytes).digest(), pc.CONSENT_PAYLOAD_TYPE, chain);
const b64 = (u) => Buffer.from(u).toString("base64");
const r = await fetch(`${BASE}/sigs/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record_b64: b64(unpublished.bytes), consent_b64: b64(sa.sigJsonBytes(consent)) }) });
const j = await r.json();
console.log(`  B publishing A's record: HTTP ${r.status} ${j.error}`);
assert.equal(r.status, 400);
assert.equal((await find(pc.proofCode(unpublished.bytes))).length, 0);
console.log("  A's unpublished record: not found");
console.log("\nall passed");
