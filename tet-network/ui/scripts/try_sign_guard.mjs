// Guard for Try TET "Sign anything" and its stamp (app/lib/sign_anything.ts): the page's own code.
//
//   node --experimental-strip-types scripts/try_sign_guard.mjs
//
// SECURITY properties:
// 1. What the page signs is exactly what Verify accepts (verify_anything.mjs, the mirror of tet-core):
//    a page-signed .sig.json passes step 1; changed content, another chain, or a swapped signature
//    byte do not.
// 2. A stamp's file id is the first 128 bits of SHA-256(the .sig.json bytes), as a UUID: the same
//    bytes give the same id, and any changed byte gives another.
// 3. A stamp counts only for a file-fee transaction, on this chain, in a canonical block, whose
//    file_id is the stamp of exactly these .sig.json bytes. Control: a checker that ignores the
//    file_id → FAILED.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const sa = await import("../app/lib/sign_anything.ts");
const va = await import("../app/lib/verify_anything.mjs");
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
const other = { chainId: "tet-other", genesisHash: "0x" + "cd".repeat(32) };
const wallet = await activateTryWallet("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
const content = new TextEncoder().encode("lab result 2026-10-07: sample 14, negative\n");
const env = await sa.signContent(content, "text/plain", chain);
const verify = (envelope, c, ch) => va.verifyEnvelope({ envelope, content: c, chain: ch, mldsa44Verify });

await check("SECURITY: a page-signed .sig.json passes Verify's step 1, signed by the tab's wallet", async () => {
  const r = await verify(env, content, chain);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.edHex, wallet);
  assert.equal(r.payloadType, "text/plain");
});

await check("SECURITY: changed content, another chain, or a changed signature fails", async () => {
  assert.equal((await verify(env, new TextEncoder().encode("lab result 2026-10-07: sample 14, positive\n"), chain)).ok, false);
  assert.equal((await verify(env, content, other)).ok, false);
  const bad = structuredClone(env);
  const sig = Buffer.from(bad.signatures[0].sig, "base64");
  sig[0] ^= 1;
  bad.signatures[0].sig = sig.toString("base64");
  assert.equal((await verify(bad, content, chain)).ok, false);
});

await check("the stamp id is SHA-256(.sig.json bytes)[0..16] as a UUID; any changed byte changes it", () => {
  const bytes = sa.sigJsonBytes(env);
  const id = sa.stampFileId(bytes);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(sa.stampFileId(sa.sigJsonBytes(env)), id);
  const changed = bytes.slice();
  changed[changed.length - 2] ^= 1;
  assert.notEqual(sa.stampFileId(changed), id);
});

const bytes = sa.sigJsonBytes(env);
const fid = sa.stampFileId(bytes);
const HASH = "e".repeat(64);
const row = (over = {}) => ({ found: true, block_height: 120, canonical: true, tx: { tx: { kind: "file_fee", file_id: fid, ...over.tx } }, ...over.row });

/** The property in (3), run against a checker. */
async function onlyThisFilesFeeAnchors(checkStamp) {
  const run = (r, receipt = { tx_hash: HASH }) => checkStamp({ sigBytes: bytes, receipt, fetchTx: async () => r });
  assert.deepEqual(await run(row()), { state: "anchored", height: 120, txHash: HASH });
  for (const [why, r] of [
    ["another file", row({ tx: { file_id: "00000000-0000-0000-0000-000000000000" } })],
    ["not a file fee", row({ tx: { kind: "transfer" } })],
    ["an orphaned block", row({ row: { canonical: false } })],
    ["not mined", { found: false }],
    ["no height", row({ row: { block_height: 0 } })],
    ["nothing", null],
  ]) {
    assert.equal((await run(r)).state, "not_anchored", `anchored on ${why}`);
  }
  assert.equal((await run(row(), { tx_hash: "nope" })).state, "not_anchored", "anchored with no hash");
}

await check("SECURITY: a stamp counts only for this .sig.json's file fee, mined in a canonical block", async () => {
  await onlyThisFilesFeeAnchors(sa.checkStamp);
});

await check("control: a checker that ignores the file id is caught", async () => {
  const sloppy = (o) =>
    sa.checkStamp({ ...o, fetchTx: async (h) => {
      const r = await o.fetchTx(h);
      return r?.tx?.tx ? { ...r, tx: { tx: { ...r.tx.tx, file_id: sa.stampFileId(o.sigBytes) } } } : r;
    } });
  await assert.rejects(() => onlyThisFilesFeeAnchors(sloppy));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
