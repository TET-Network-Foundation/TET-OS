// Verify without TET, Level 2, end to end against a real node (not a CI step):
//   TET_E2E_NODE=http://127.0.0.1:5040 node --experimental-strip-types scripts/try_chain_verify_e2e.mjs
// A wallet signs a file, stamps it (the .sig.json stored to itself, the file fee paid by itself),
// the fee is mined; the chain is exported from that block to the tip; the export checks offline.
// Writes scripts/fixtures/chain_export_v1.json (+ the stamp) for chain_verify_guard.
import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
register("./lib/ts_hooks.mjs", import.meta.url);
const BASE = process.env.TET_E2E_NODE || "http://127.0.0.1:5040";
const chainInfo = await (await fetch(`${BASE}/chain`)).json();
process.env.NEXT_PUBLIC_TET_CHAIN_ID = chainInfo.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = chainInfo.genesis_hash;
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const chain = { chainId: chainInfo.chain_id, genesisHash: chainInfo.genesis_hash };
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const http = await import("../app/lib/tet_core_http.ts");
const { getTmailKeySession } = await import("../app/lib/tmail_session.ts");
const { buildTmailKeyRegistrationV1 } = await import("../app/lib/tmail_keys.ts");
const { buildFileEnvelopeV1 } = await import("../app/lib/files.ts");
const { settleFileFee } = await import("../app/lib/files_fee.ts");
const pc = await import("../app/lib/proof_code.ts");
const { stampFileId } = await import("../app/lib/sign_anything.ts");
const cv = await import("../app/lib/chain_verify.mjs");
const { sha256, ed25519Verify } = await import("../app/lib/offline_verify.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const balance = async (w) => (await (await fetch(`${BASE}/ledger/balance/${w}`)).json()).balance_tet ?? 0;
const height = async () => (await (await fetch(`${BASE}/ledger/state`)).json()).block_height;

const me = await activateTryWallet(generateDisposableWords());
assert.ok((await http.postInitialAirdropClaim(BASE, me)).ok, "airdrop");
for (let i = 0; i < 45 && (await balance(me)) < 1; i++) await sleep(2_000);
const ks = getTmailKeySession();
const reg = await buildTmailKeyRegistrationV1({ x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub, baseUrl: BASE });
assert.ok((await http.putTmailKeys(BASE, me, reg)).ok, "keys");

const sig = await pc.signFileHash(new TextEncoder().encode("a file worth stamping " + Date.now()), chain);
const fileId = stampFileId(sig.bytes);
const built = await buildFileEnvelopeV1({ senderWalletId: me, receiverWalletId: me, fileBytes: sig.bytes, filename: "x.sig.json", mimeType: "application/json", receiverX25519Pub: ks.x25519_pub, receiverMlkemPub: ks.mlkem_pub, baseUrl: BASE, fileId });
const up = await http.postFilesUpload(BASE, built.envelope, built.bodyCiphertext);
assert.ok(up.ok, `upload: ${up.text}`);
const before = await height();
const fee = await settleFileFee({ mode: "self", baseUrl: BASE, fileId, senderWalletId: me, storageWallet: up.storageWallet ?? "" });
assert.equal(fee.state, "paid", fee.text);

// Find the fee's block and transaction hash.
let found = null;
for (let i = 0; i < 40 && !found; i++) {
  await sleep(3_000);
  for (let h = before; h <= (await height()) && !found; h++) {
    const b = await (await fetch(`${BASE}/explorer/block/${h}`)).json().catch(() => null);
    const j = b?.txs?.findIndex((t) => t.tx_json.includes(`"file_id":"${fileId}"`)) ?? -1;
    if (j >= 0) found = { height: h, txHash: b.tx_hashes[j] };
  }
}
assert.ok(found, "the stamp's fee wasn't mined");
console.log(`stamped: file id ${fileId}, tx ${found.txHash.slice(0, 18)}… in block ${found.height}`);
const target = found.height + 3;
while ((await height()) < target) await sleep(2_000);

const out = "scripts/fixtures/chain_export_v1.json";
execFileSync("node", ["scripts/chain_export.mjs", BASE, "--from", String(found.height), "--to", String(target), "--out", out], { stdio: "inherit" });
const exported = JSON.parse(readFileSync(out, "utf8"));
const stamp = { txHash: found.txHash, fileId };
writeFileSync("scripts/fixtures/chain_export_v1.stamp.json", JSON.stringify({ ...stamp, sig_json_b64: Buffer.from(sig.bytes).toString("base64") }, null, 2) + "\n");
const r = await cv.verifyChainExport({ exported, chain, stamp, sha256, ed25519Verify, mldsa44Verify });
assert.ok(r.ok, r.reason);
console.log(`offline: the stamp is in block ${r.stamp.height}, ${r.stamp.confirmations} blocks under the export's tip ${r.tipBlockId.slice(0, 18)}…\nall passed`);
