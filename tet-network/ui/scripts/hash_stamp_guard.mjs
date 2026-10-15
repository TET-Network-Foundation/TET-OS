// Guard for the hash-only stamp ("Anchor on chain" after Mark as genuine; app/lib/hash_stamp.ts).
//
//   node --experimental-strip-types scripts/hash_stamp_guard.mjs
//
// 1. Nothing of the file leaves the tab: anchoring a marked image runs the stamp on the signed
//    RECORD, so the bytes it would upload are exactly the record (the image's SHA-256 + signatures)
//    and contain no part of the image, raw or base64. Control: a full .sig.json of the same image
//    (what the Sign panel's stamp uploads) is caught carrying it.
// 2. Only a hash-only record can be anchored: a full .sig.json is refused before anything is sent.
//    Control: the check that tells them apart says yes to a record and no to a .sig.json.
// 3. The receipt and the anchor link name the mined fee, and the node is told the record's own
//    bytes and that fee's hash.
// 4. The stamp id matches the node's (`sigs::stamp_file_id`): one fixed vector, checked on both sides.
import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { signFileHash } = await import("../app/lib/proof_code.ts");
const { signContent, sigJsonBytes, stampFileId } = await import("../app/lib/sign_anything.ts");
const { anchorRecord, isHashOnlyRecord } = await import("../app/lib/hash_stamp.ts");

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

/** Does `upload` carry any part of `file`: a 32-byte run of it, or 64 characters of its base64? */
export function carriesFile(upload, file) {
  const has = (hay, needle) => {
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  };
  for (let off = 0; off + 32 <= file.length; off += 512) if (has(upload, file.subarray(off, off + 32))) return true;
  const b64 = Buffer.from(file).toString("base64");
  const text = new TextDecoder().decode(upload).replace(/\\n|\s/g, "");
  for (let off = 0; off + 64 <= b64.length; off += 512) if (text.includes(b64.slice(off, off + 64))) return true;
  return false;
}

const chain = { chainId: "tet-local-dev", genesisHash: `0x${"00".repeat(32)}` };
const me = await activateTryWallet(generateDisposableWords());
const image = crypto.getRandomValues(new Uint8Array(4096));
const rec = await signFileHash(image, chain);
const TX = `0x${"ab".repeat(32)}`;

function recorder() {
  const seen = { uploads: [], links: [] };
  const deps = {
    buildFileEnvelopeV1: async (o) => {
      seen.uploads.push(o.fileBytes);
      return { envelope: { file_id: o.fileId }, bodyCiphertext: new Uint8Array(8) };
    },
    postFilesUpload: async () => ({ ok: true, status: 202, storageWallet: "storage" }),
    settleFileFee: async () => ({ state: "sponsored", txHash: TX, text: "" }),
    checkStamp: async () => ({ state: "anchored", height: 9, txHash: TX }),
    publishAnchor: async (_base, recordBytes, _chain, txHash) => {
      seen.links.push({ recordBytes, txHash });
      return { blockHeight: 9 };
    },
    fetchTx: async () => null,
    sleep: async () => {},
  };
  return { seen, deps };
}
const keys = { x25519_pub: new Uint8Array(32), mlkem_pub: new Uint8Array(1184) };

await check("anchoring a marked image uploads exactly the record, and nothing of the image", async () => {
  const { seen, deps } = recorder();
  await anchorRecord({ baseUrl: "/tet-node-api", record: rec.bytes, me, keys, chain, deps });
  assert.equal(seen.uploads.length, 1, "one upload");
  assert.deepEqual([...seen.uploads[0]], [...rec.bytes], "the upload isn't the record");
  assert.ok(!carriesFile(seen.uploads[0], image), "the upload carries part of the image");
  assert.ok(seen.uploads[0].length < 16 * 1024, `the record is ${seen.uploads[0].length} bytes`);
});
await check("control: a full .sig.json of the image is caught carrying it", async () => {
  const full = sigJsonBytes(await signContent(image, "image/png", chain));
  assert.ok(carriesFile(full, image), "the check misses an embedded image");
});

await check("a full .sig.json is refused before anything is sent", async () => {
  const { seen, deps } = recorder();
  const full = sigJsonBytes(await signContent(image, "image/png", chain));
  await assert.rejects(() => anchorRecord({ baseUrl: "/tet-node-api", record: full, me, keys, chain, deps }), /only a hash-only record/);
  assert.equal(seen.uploads.length, 0, "something was uploaded");
});
await check("control: a record is hash-only, a .sig.json isn't", async () => {
  assert.equal(isHashOnlyRecord(rec.bytes), true);
  assert.equal(isHashOnlyRecord(sigJsonBytes(await signContent(image, "image/png", chain))), false);
  assert.equal(isHashOnlyRecord(new TextEncoder().encode("not json")), false);
});

await check("the receipt and the anchor link name the mined fee and the record's own bytes", async () => {
  const { seen, deps } = recorder();
  const receipt = await anchorRecord({ baseUrl: "/tet-node-api", record: rec.bytes, me, keys, chain, deps });
  assert.equal(receipt.kind, "tet_stamp_v1");
  assert.equal(receipt.tx_hash, TX);
  assert.equal(receipt.block_height, 9);
  assert.equal(receipt.file_id, stampFileId(rec.bytes));
  assert.equal(seen.links.length, 1);
  assert.equal(seen.links[0].txHash, TX);
  assert.deepEqual([...seen.links[0].recordBytes], [...rec.bytes]);
});

await check("the stamp id matches the node's (fixed vector)", () => {
  assert.equal(stampFileId(new TextEncoder().encode("abc")), "ba7816bf-8f01-cfea-4141-40de5dae2223");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
