// Guard: Shelter's board key travels only between the right people (app/lib/shelter.ts).
//
//   node --experimental-strip-types scripts/shelter_guard.mjs
//
// The real shelter.ts runs against a fake node (fetch replaced), with real signatures:
// 1. SECURITY: the board key is never sealed to keys the member's own wallet didn't sign (a node
//    that swaps them, or serves an older unsigned registration, gets nothing).
// 2. SECURITY: a sealed key is opened only if its sender's signature checks out and the sender is
//    allowed (the member, the moderator, or the member who let them in): a forged sender and an
//    outsider are refused.
// 3. The honest path works both ways: sealed by the voucher, opened by the member.
// Negative controls (run by hand, recorded in the commit): sealKeyTo using the raw key lookup →
// 1 FAILED; openSealedKey without the allowed-sender check → 2 FAILED.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const sh = await import("../app/lib/shelter.ts");
const { buildTmailKeyRegistrationV1, deriveTmailKeysFromMnemonic } = await import("../app/lib/tmail_keys.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { boardKeysFromSeed, boardPublicKeysB64, encodeInvite, newBoardSeed } = await import("../app/lib/board.mjs");

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

// Fake node: key registrations by wallet; the last /shelter/key body.
const keys = new Map();
let sealedPosted = null;
globalThis.fetch = async (input, init = {}) => {
  const u = String(input);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const m = /\/tmail\/keys\/([0-9a-f]{64})/.exec(u);
  if (m) {
    const reg = keys.get(m[1]);
    return reg ? json({ ok: true, registration: reg }) : json({ ok: false }, 404);
  }
  if (u.endsWith("/shelter/key")) {
    sealedPosted = JSON.parse(init.body);
    return json({ ok: true });
  }
  throw new Error(`unexpected request ${u}`);
};
const BASE = "http://fake-node";

const words = {
  voucher: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  member: "legal winner thank year wave sausage worth useful legal winner thank yellow",
  outsider: "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
};
const ids = {};
for (const [k, w] of Object.entries(words)) {
  ids[k] = await activateTryWallet(w);
  const d = await deriveTmailKeysFromMnemonic(w);
  keys.set(ids[k], await buildTmailKeyRegistrationV1({ x25519_pub: d.x25519_pub, mlkem_pub: d.mlkem_pub, baseUrl: BASE }));
}
// The board: its keys registered (openBoard compares them with the invite).
const seed = newBoardSeed();
const boardKeys = await boardKeysFromSeed(seed);
const pub = boardPublicKeysB64(boardKeys);
const boardId = "b0".repeat(32);
keys.set(boardId, { v: 2, wallet_id: boardId, x25519_pub_b64: pub.x25519_pub_b64, mlkem_pub_b64: pub.mlkem_pub_b64, registered_at_ms: 1, hybrid_sig: {} });
const board = { boardWalletId: boardId, name: "Shelter", invite: encodeInvite({ boardWalletId: boardId, seed, name: "Shelter" }), keys: boardKeys };

await check("the honest path: sealed by the voucher, opened by the member", async () => {
  await activateTryWallet(words.voucher);
  await sh.sealKeyTo(BASE, ids.member, board);
  assert.ok(sealedPosted, "nothing was sealed");
  await activateTryWallet(words.member);
  const r = await sh.openSealedKey(BASE, sealedPosted, boardId, [ids.member, ids.voucher]);
  assert.equal(r.board.boardWalletId, boardId);
  assert.equal(r.from, ids.voucher);
});

await check("SECURITY: the board key is never sealed to keys the member's wallet didn't sign", async () => {
  await activateTryWallet(words.voucher);
  const honest = keys.get(ids.member);
  const swapped = { ...honest, x25519_pub_b64: keys.get(ids.outsider).x25519_pub_b64 };
  for (const [what, reg] of [["swapped keys", swapped], ["an older registration", { ...honest, v: undefined }], ["another wallet's registration", keys.get(ids.outsider)]]) {
    keys.set(ids.member, reg);
    sealedPosted = null;
    await assert.rejects(sh.sealKeyTo(BASE, ids.member, board), undefined, `sealed to ${what}`);
    assert.equal(sealedPosted, null, `${what}: something was sent`);
  }
  keys.set(ids.member, honest);
});

await check("SECURITY: a sealed key from a forged or unallowed sender is never opened", async () => {
  await activateTryWallet(words.outsider);
  await sh.sealKeyTo(BASE, ids.member, board);
  const fromOutsider = sealedPosted;
  await activateTryWallet(words.member);
  await assert.rejects(sh.openSealedKey(BASE, fromOutsider, boardId, [ids.member, ids.voucher]), /didn't let you in/);
  const forged = JSON.parse(JSON.stringify(fromOutsider));
  forged.sender_wallet_id = ids.voucher; // claims to be from the voucher; the outsider signed it
  forged.hybrid_sig.ed25519_pubkey_hex = ids.voucher;
  await assert.rejects(sh.openSealedKey(BASE, forged, boardId, [ids.member, ids.voucher]), /signature isn't its sender's/);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
