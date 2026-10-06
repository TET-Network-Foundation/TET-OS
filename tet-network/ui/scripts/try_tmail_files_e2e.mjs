// Try TET parts 2–3, end to end: the page's own modules through the page's `/tet-node-api` proxy to
// a tet-core in public mode with the file-fee sponsor on. Not a CI step (needs a running node and
// UI); the PR records its output.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3100 TET_TRY_EXPECT=<sponsored|sponsor_low> [TET_TRY_FILES=3] \
//     node --experimental-strip-types scripts/try_tmail_files_e2e.mjs
//
// Two visitors, A and B, with disposable wallets:
//   1. Both register messaging keys. A messages B and itself; B reads and decrypts.
//   2. A sends B files. Each fee is settled the try page's way (`settleFileFee`, "demo-sponsor").
//      The first must come out as TET_TRY_EXPECT; with a per-client cap of 2, the third must be
//      refused with daily_cap_ip. Every file is delivered and decrypts, whatever happened to its fee.
//   3. /files/fee is never called.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3100").replace(/\/+$/, "");
const EXPECT = process.env.TET_TRY_EXPECT || "sponsored";
const FILES = Number(process.env.TET_TRY_FILES || 1);
const BASE = "/tet-node-api";

const http = await import("../app/lib/tet_core_http.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { getTmailKeySession } = await import("../app/lib/tmail_session.ts");
const { buildTmailKeyRegistrationV1 } = await import("../app/lib/tmail_keys.ts");
const { buildTmailEnvelopeV1 } = await import("../app/lib/tmail.ts");
const { decryptForReceiver } = await import("../app/lib/tmail_e2ee.ts");
const { buildFileEnvelopeV1 } = await import("../app/lib/files.ts");
const { decryptFileForReceiver } = await import("../app/lib/files_e2ee.ts");
const { b64ToBytes } = await import("../app/lib/encoding.ts");
const { settleFileFee } = await import("../app/lib/files_fee.ts");

const log = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input).startsWith("/") ? ORIGIN + String(input) : String(input);
  const r = await realFetch(url, init);
  log.push({ path: new URL(url).pathname, method: (init.method ?? "GET").toUpperCase(), status: r.status });
  return r;
};
console.error = () => {};
const step = (s) => console.log(`\n== ${s}`);

const wordsA = generateDisposableWords();
const wordsB = generateDisposableWords();
async function as(words) {
  const id = await activateTryWallet(words);
  return { id, keys: getTmailKeySession() };
}
async function registerKeys() {
  const ks = getTmailKeySession();
  const reg = await buildTmailKeyRegistrationV1({ x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub, baseUrl: BASE });
  const r = await http.putTmailKeys(BASE, ks.walletIdHex64, reg);
  assert.ok(r.ok, `key registration: ${r.text}`);
}
async function inboxTexts(me) {
  const r = await http.getTmailInbox(BASE, me.id, 20);
  assert.ok(r.ok, r.text);
  const out = [];
  for (const row of r.messages) {
    const pt = await decryptForReceiver(
      {
        client_ephemeral_pub: b64ToBytes(row.e2ee.client_ephemeral_pub_b64),
        mlkem_ciphertext: b64ToBytes(row.e2ee.mlkem_ciphertext_b64),
        nonce: b64ToBytes(row.e2ee.nonce_b64),
        ciphertext: b64ToBytes(row.e2ee.ciphertext_b64),
      },
      me.keys.x25519_sk,
      me.keys.mlkem_sk,
    );
    out.push({ from: row.sender_wallet_id, text: new TextDecoder().decode(pt) });
  }
  return out;
}

step(`1. Tmail via ${ORIGIN}${BASE}`);
const B = await as(wordsB);
await registerKeys();
const A = await as(wordsA);
await registerKeys();
for (const [to, text] of [[B.id, "hello B, from A"], [A.id, "a note to myself"]]) {
  const keys = await http.getTmailKeys(BASE, to);
  const env = await buildTmailEnvelopeV1({
    senderWalletId: A.id,
    receiverWalletId: to,
    plaintextUtf8: text,
    receiverX25519Pub: b64ToBytes(keys.registration.x25519_pub_b64),
    receiverMlkemPub: b64ToBytes(keys.registration.mlkem_pub_b64),
    baseUrl: BASE,
  });
  const r = await http.postTmailSend(BASE, env);
  assert.ok(r.ok, r.text);
}
const selfBox = await inboxTexts(A);
console.log(`  A's inbox: ${JSON.stringify(selfBox.map((m) => m.text))}`);
assert.ok(selfBox.some((m) => m.text === "a note to myself" && m.from === A.id));
const Bnow = await as(wordsB);
const bBox = await inboxTexts(Bnow);
console.log(`  B's inbox: ${JSON.stringify(bBox.map((m) => m.text))}`);
assert.ok(bBox.some((m) => m.text === "hello B, from A" && m.from === A.id));

step(`2. A sends B ${FILES} file(s); fees settled the try page's way (expect ${EXPECT} first)`);
await as(wordsA);
const bKeys = await http.getTmailKeys(BASE, B.id);
const sent = [];
for (let i = 0; i < FILES; i++) {
  // A person's pace: the public node refills one write every 3 s (20 a minute, burst 10).
  if (i > 0) await new Promise((r) => setTimeout(r, 6_500));
  const bytes = new TextEncoder().encode(`file ${i}: ${"x".repeat(1000 + i)}`);
  const built = await buildFileEnvelopeV1({
    senderWalletId: A.id,
    receiverWalletId: B.id,
    fileBytes: bytes,
    filename: `e2e-${i}.txt`,
    mimeType: "text/plain",
    receiverX25519Pub: b64ToBytes(bKeys.registration.x25519_pub_b64),
    receiverMlkemPub: b64ToBytes(bKeys.registration.mlkem_pub_b64),
    baseUrl: BASE,
  });
  const up = await http.postFilesUpload(BASE, built.envelope, built.bodyCiphertext);
  assert.ok(up.ok, `upload ${i}: ${up.text}`);
  const fee = await settleFileFee({
    mode: "demo-sponsor",
    baseUrl: BASE,
    fileId: up.fileId,
    senderWalletId: A.id,
    storageWallet: up.storageWallet ?? "",
  });
  console.log(`  file ${i} ${up.fileId.slice(0, 8)}…: ${fee.state}${fee.reason ? ` (${fee.reason})` : ""}: ${fee.text}`);
  sent.push({ id: up.fileId, bytes, fee });
}
assert.equal(sent[0].fee.state === "sponsored" ? "sponsored" : sent[0].fee.reason, EXPECT);
if (FILES >= 3) assert.equal(sent[2].fee.reason, "daily_cap_ip", "the third file should hit the per-client cap of 2");

step("3. B receives every file, whatever happened to its fee");
const Bfiles = await as(wordsB);
const inbox = await http.getFilesInbox(BASE, B.id, 50);
for (const s of sent) {
  const env = inbox.files.find((f) => f.file_id === s.id);
  assert.ok(env, `file ${s.id} is not in B's inbox (status ${inbox.status}, ${inbox.files.length} files: ${inbox.files.map((f) => f.file_id).join(", ")}; ${inbox.text ?? ""})`);
  const blob = await http.getFilesFetch(BASE, s.id);
  assert.ok(blob.ok, blob.text);
  const d = await decryptFileForReceiver(
    {
      client_ephemeral_pub: b64ToBytes(env.e2ee.client_ephemeral_pub_b64),
      mlkem_ciphertext: b64ToBytes(env.e2ee.mlkem_ciphertext_b64),
      filename_nonce: b64ToBytes(env.e2ee.filename_nonce_b64),
      mime_nonce: b64ToBytes(env.e2ee.mime_nonce_b64),
      body_nonce: b64ToBytes(env.e2ee.body_nonce_b64),
      filename_ciphertext: b64ToBytes(env.filename_encrypted_b64),
      mime_ciphertext: b64ToBytes(env.mime_type_encrypted_b64),
      body_ciphertext: blob.bytes,
    },
    Bfiles.keys.x25519_sk,
    Bfiles.keys.mlkem_sk,
  );
  assert.deepEqual(Array.from(d.fileBytes), Array.from(s.bytes));
  console.log(`  ${d.filename}: ${d.fileBytes.length} bytes, decrypted and identical (fee ${s.fee.state})`);
}

step("4. what was called");
assert.ok(!log.some((r) => r.path.endsWith("/files/fee")), "/files/fee was called");
const byRoute = {};
for (const r of log) {
  const k = `${r.method} ${r.path.replace(/[0-9a-f]{64}/g, ":id").replace(/[0-9a-f-]{36}/g, ":file")} → ${r.status}`;
  byRoute[k] = (byRoute[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(byRoute)) console.log(`  ${n}× ${k}`);
console.log("\nall steps passed");
