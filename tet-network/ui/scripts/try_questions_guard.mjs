// Guard for "AI asks a human" (Try TET part 5, docs/DEMO_NODE.md). Runs the page's rules
// (`app/lib/questions.mjs`) on a question the agent SDK built
// (tet-core/src/testdata/agent_question_envelope_v1.json, which tet-core verifies in
// `sdk_question_envelope_verifies_in_rust`), carrying the UI-signed manifest tet-core re-signs
// byte for byte.
//
//   node --experimental-strip-types scripts/try_questions_guard.mjs
//
// SECURITY properties:
// 1. The owner shown is the manifest's only when it verifies and vouches for BOTH keys that signed
//    the question. A manifest for another key, an altered or expired one, or a question signed by
//    another key shows no owner.
// 2. "Answered" counts only from the key that asked.
// 3. An answer goes to the question's signed sender, never to an address written in the question.
// 4. A row whose signer is not its sender, or an anonymous row, is never a question.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const q = await import("../app/lib/questions.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const { deriveTmailKeysFromMnemonic } = await import("../app/lib/tmail_keys.ts");
const { decryptForReceiver } = await import("../app/lib/tmail_e2ee.ts");
const { mnemonicToTetEd25519Keypair } = await import("../app/lib/ed25519_tet.ts");
const { mldsa44KeypairFromMnemonic } = await import("../app/lib/pqc.ts");

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const doc = read("../../../tet-core/src/testdata/agent_question_envelope_v1.json");
const manDoc = read("../../../tet-core/src/testdata/agent_manifest_v1.json");
const chain = { chainId: doc.chain.chain_id, genesisHash: doc.chain.genesis_hash };
const NOW = manDoc.verify_at_ms;
const b64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const clone = (x) => JSON.parse(JSON.stringify(x));

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

// The SDK's question, decrypted with keys the PAGE derives from the board's words.
const env = doc.envelope;
const boardKeys = await deriveTmailKeysFromMnemonic(doc.board_mnemonic);
const plaintext = new TextDecoder().decode(
  await decryptForReceiver(
    {
      client_ephemeral_pub: b64(env.e2ee.client_ephemeral_pub_b64),
      mlkem_ciphertext: b64(env.e2ee.mlkem_ciphertext_b64),
      nonce: b64(env.e2ee.nonce_b64),
      ciphertext: b64(env.e2ee.ciphertext_b64),
    },
    boardKeys.x25519_sk,
    boardKeys.mlkem_sk,
  ),
);
const row = { ...env, e2ee: undefined };
const owner = (question, nowMs = NOW) => q.resolveOwner({ question, chain, nowMs, mldsa44Verify });

// Another wallet's keys, for forgeries.
const OTHER = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
const other = { ed: mnemonicToTetEd25519Keypair(OTHER).walletIdHex, ml: (await mldsa44KeypairFromMnemonic(OTHER)).pubkey_b64 };

await check("the page reads the SDK's question and shows the manifest's owner", async () => {
  assert.equal(Buffer.from(boardKeys.x25519_pub).toString("base64"), env.e2ee.receiver_x25519_pub_b64, "page and SDK derive different messaging keys");
  assert.equal(Buffer.from(boardKeys.mlkem_pub).toString("base64"), env.e2ee.receiver_mlkem_pub_b64, "page and SDK derive different Kyber keys");
  const item = q.classifyBoardItem(row, plaintext);
  assert.equal(item?.type, "question");
  assert.equal(item.question, doc.question);
  assert.equal(item.sender, manDoc.manifest.agent_ed25519_pubkey_hex);
  const o = await owner(item);
  assert.equal(o.state, "verified", JSON.stringify(o));
  assert.equal(o.owner, manDoc.manifest.owner_wallet_id);
  assert.equal(o.agentId, manDoc.manifest.agent_id);
});

await check("SECURITY: no owner unless the manifest verifies and names both signing keys", async () => {
  const base = q.classifyBoardItem(row, plaintext);
  const cases = [];
  // The same manifest, on a question signed by another key (both halves).
  cases.push(["signed by another key", { ...base, sender: other.ed, signer: { edHex: other.ed, mldsaPubB64: other.ml } }, /different key/]);
  // Same Ed25519 key, another ML-DSA key: half a match is no match.
  cases.push(["another ML-DSA key", { ...base, signer: { ...base.signer, mldsaPubB64: other.ml } }, /different key/]);
  const altered = clone(base.manifest);
  altered.capabilities = [...altered.capabilities, "spend"];
  cases.push(["a manifest altered after signing", { ...base, manifest: altered }, /does not verify/]);
  const renamed = clone(base.manifest);
  renamed.owner_wallet_id = other.ed;
  cases.push(["a manifest naming another owner", { ...base, manifest: renamed }, /not signed by the owner/]);
  for (const [what, item, re] of cases) {
    const o = await owner(item);
    assert.equal(o.state, "invalid", `${what}: ${JSON.stringify(o)}`);
    assert.match(o.reason, re, `${what}: ${o.reason}`);
  }
  const expired = await owner(base, base.manifest.expires_at_ms + 1);
  assert.equal(expired.state, "invalid");
  assert.match(expired.reason, /expired/);
  assert.equal((await owner({ ...base, manifest: null })).state, "none");
});

await check("SECURITY: \"answered\" counts only from the key that asked", () => {
  const question = q.classifyBoardItem(row, plaintext);
  const note = (sender) => ({ type: "answered", msgId: `n-${sender.slice(0, 4)}`, sender, questionMsgId: question.msgId, note: "" });
  assert.equal(q.questionsWithStatus([question])[0].answered, false);
  assert.equal(q.questionsWithStatus([question, note(other.ed)])[0].answered, false, "a stranger marked it answered");
  assert.equal(q.questionsWithStatus([question, note(question.sender)])[0].answered, true);
});

await check("SECURITY: an answer goes to the signed sender, not to an address in the question", () => {
  const body = JSON.parse(plaintext);
  body.reply_to = other.ed;
  body.sender_wallet_id = other.ed;
  const item = q.classifyBoardItem(row, JSON.stringify(body));
  assert.equal(q.answerRecipient(item), env.sender_wallet_id);
  const ans = JSON.parse(q.answerBody(item.msgId, "yes"));
  assert.deepEqual(ans, { v: 1, kind: q.ANSWER_KIND, question_msg_id: env.msg_id, answer: "yes" });
});

await check("SECURITY: a row whose signer isn't its sender, or an anonymous row, is never a question", () => {
  const forged = { ...row, sender_wallet_id: other.ed };
  assert.equal(q.classifyBoardItem(forged, plaintext), null);
  const anon = { ...row, flags: { ...row.flags, anonymous: true } };
  assert.equal(q.classifyBoardItem(anon, plaintext), null);
  assert.equal(q.classifyBoardItem(row, "not json"), null);
  assert.equal(q.classifyBoardItem(row, JSON.stringify({ kind: q.QUESTION_KIND, question: "  " })), null);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
