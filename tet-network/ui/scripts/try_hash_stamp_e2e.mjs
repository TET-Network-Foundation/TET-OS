// The hash-only stamp, end to end against a real node (not a CI step; the PR records its output):
// a test image is marked as genuine, the record is anchored on chain ("Anchor on chain"), and the
// proof code is looked up and its anchor re-checked, all with the page's own modules through the
// UI's /tet-node-api proxy. Every request body is recorded, to show no part of the image is sent.
//
//   source <the UI's build env> && TET_TRY_ORIGIN=http://127.0.0.1:3300 \
//     node --experimental-strip-types scripts/try_hash_stamp_e2e.mjs
//
// Needs a node built from this branch with the demo file-fee sponsor on, and the UI built against it.
// Run it on a local or review node: it publishes a record and spends one sponsored file fee.
import { register } from "node:module";
import assert from "node:assert/strict";
register("./lib/ts_hooks.mjs", import.meta.url);
const ORIGIN = process.env.TET_TRY_ORIGIN;
const BASE = "/tet-node-api";
const bodies = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input).startsWith("/") ? ORIGIN + String(input) : String(input);
  const req = new Request(url, init);
  if (init.body != null) bodies.push({ path: new URL(url).pathname, bytes: new Uint8Array(await req.clone().arrayBuffer()) });
  return realFetch(req);
};
console.error = () => {};
const { expectedChainBinding } = await import("../app/lib/chain_binding.ts");
const http = await import("../app/lib/tet_core_http.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { getTmailKeySession } = await import("../app/lib/tmail_session.ts");
const { buildTmailKeyRegistrationV1 } = await import("../app/lib/tmail_keys.ts");
const { signFileHash, publishRecord, registryRecords, findSignatures, codePrefixHex } = await import("../app/lib/proof_code.ts");
const { anchorRecord, explorerTx } = await import("../app/lib/hash_stamp.ts");
const { checkStamp } = await import("../app/lib/sign_anything.ts");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");

const chain = await expectedChainBinding(BASE);
const me = await activateTryWallet(generateDisposableWords());
const ks = getTmailKeySession();
const put = await http.putTmailKeys(BASE, ks.walletIdHex64, await buildTmailKeyRegistrationV1({ x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub, baseUrl: BASE }));
assert.ok(put.ok, `inbox: ${put.text}`);
console.log(`1. disposable ID ${me.slice(0, 8)}…, inbox on (keys published)`);

const image = new Uint8Array(24 * 1024);
crypto.getRandomValues(image.subarray(8));
image.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // a PNG signature up front: a "test image"
const rec = await signFileHash(image, chain);
const code = await publishRecord(BASE, rec.bytes, chain);
console.log(`2. marked as genuine: ${code} (record ${rec.bytes.length} bytes, image ${image.length} bytes)`);

const steps = [];
const receipt = await anchorRecord({ baseUrl: BASE, record: rec.bytes, me, keys: { x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub }, chain, onStep: (s) => steps.push(s) });
console.log(`3. anchored: block ${receipt.block_height}, tx ${receipt.tx_hash.slice(0, 18)}…, steps ${steps.join(" → ")}`);

const listed = await registryRecords(BASE, { codePrefix: codePrefixHex(code) });
assert.equal(listed.length, 1, "the code finds the record");
assert.equal(listed[0].anchor?.blockHeight, receipt.block_height, "the registry lists the anchor");
const hits = await findSignatures({ query: code, chain, records: (q) => registryRecords(BASE, q), mldsa44Verify });
assert.equal(hits.length, 1);
assert.ok(hits[0].verified, "the record's signatures check");
const recheck = await checkStamp({ sigBytes: hits[0].recordBytes, receipt: { tx_hash: hits[0].anchor.txHash }, fetchTx: (h) => explorerTx(BASE, h) });
assert.equal(recheck.state, "anchored", JSON.stringify(recheck));
console.log(`4. lookup of ${code}: verified, anchor listed at block ${hits[0].anchor.blockHeight}; re-check in the tab: ${recheck.state} at block ${recheck.height}`);

// Nothing of the image left: no request body holds a 32-byte run of it or 64 chars of its base64.
const b64 = Buffer.from(image).toString("base64");
const leaks = bodies.filter(({ bytes }) => {
  const text = new TextDecoder().decode(bytes);
  for (let off = 0; off + 64 <= b64.length; off += 256) if (text.includes(b64.slice(off, off + 64))) return true;
  const hay = Buffer.from(bytes);
  for (let off = 8; off + 32 <= image.length; off += 256) if (hay.indexOf(Buffer.from(image.subarray(off, off + 32))) >= 0) return true;
  return false;
});
const sent = bodies.map((b) => `${b.path.replace("/tet-node-api", "")} ${b.bytes.length} B`).join(" · ");
console.log(`5. request bodies sent: ${sent}`);
assert.equal(leaks.length, 0, `image bytes found in: ${leaks.map((l) => l.path).join(", ")}`);
console.log(`   none contains any part of the ${image.length}-byte image`);
console.log(`CODE=${code}`);
