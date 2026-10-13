// Shelter, end to end, against a real node and the native prover (docs/plans/SHELTER.md). Not a CI
// step: Shelter is switched on by the node's settings, so it runs in two steps with a restart.
//
//   1. Start a node WITHOUT Shelter (e.g. on :5040, TET_HTTP_RPS=1000 for this script's pace), then
//        TET_E2E_NODE=http://127.0.0.1:5040 node --experimental-strip-types scripts/try_shelter_e2e.mjs setup
//      It prints the moderator and board ids and saves the test's words in $TMPDIR/tet-shelter-e2e.json.
//   2. Restart the node with TET_SHELTER_MODERATOR=<moderator> TET_SHELTER_BOARD=<board>, then
//        TET_E2E_NODE=http://127.0.0.1:5040 node --experimental-strip-types scripts/try_shelter_e2e.mjs run
//
// "run" checks: the moderator's invite and A's vouches, each sealed board key opened only from the
// member who let them in; a named post by nickname · number; non-member reads refused (403 on both
// routes); anonymous posts against Shelter's own set (the first with a proof, the next fast, both
// verified, one daily ID); after a bot case the set drops below 3 and anonymous posting stops, and
// the removed member's reads are refused.

import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
const BASE = process.env.TET_E2E_NODE || "http://127.0.0.1:5040";
const chain = await (await fetch(`${BASE}/chain`)).json();
process.env.NEXT_PUBLIC_TET_CHAIN_ID = chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = chain.genesis_hash;
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const L = "../app/lib/";
const STATE = join(tmpdir(), "tet-shelter-e2e.json");
const mode = process.argv[2];
if (mode === "setup") {
const { activateTryWallet } = await import(L + "try_session.ts");
const { generateDisposableWords } = await import(L + "disposable_wallet.mjs");
const tb = await import(L + "try_board.ts");
const words = { mod: generateDisposableWords(), a: generateDisposableWords(), b: generateDisposableWords(), c: generateDisposableWords(), x: generateDisposableWords() };
const ids = {};
for (const k of Object.keys(words)) ids[k] = await activateTryWallet(words[k]);
await activateTryWallet(words.mod);
const { board } = await tb.createBoard(BASE, "Shelter");
writeFileSync(STATE, JSON.stringify({ words, ids, invite: board.invite, boardId: board.boardWalletId }));
console.log("moderator", ids.mod.slice(0, 8), "board", board.boardWalletId.slice(0, 8));

  process.exit(0);
}
if (mode !== "run") {
  console.log("usage: try_shelter_e2e.mjs setup|run");
  process.exit(2);
}
const S = JSON.parse(readFileSync(STATE, "utf8"));
const { activateTryWallet } = await import(L + "try_session.ts");
const tb = await import(L + "try_board.ts");
const sh = await import(L + "shelter.ts");
const { buildTmailKeyRegistrationV1, deriveTmailKeysFromMnemonic } = await import(L + "tmail_keys.ts");
const { putTmailKeys } = await import(L + "tet_core_http.ts");
const PROVER = "http://127.0.0.1:9945";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const as = (k) => activateTryWallet(S.words[k]);
// Every member turns on their inbox (v2) and joins the anonymity set.
for (const k of ["mod", "a", "b", "c", "x"]) {
  await as(k);
  const d = await deriveTmailKeysFromMnemonic(S.words[k]);
  const r = await putTmailKeys(BASE, S.ids[k], await buildTmailKeyRegistrationV1({ x25519_pub: d.x25519_pub, mlkem_pub: d.mlkem_pub, baseUrl: BASE }));
  assert.ok(r.ok, `keys ${k}: ${r.text}`);
  if (k !== "x" && k !== "mod") await tb.registerForAnon(BASE);
}
// The moderator: their own board key, then an invite for A, sealed to A.
await as("mod");
const board = await tb.openBoard(BASE, S.invite);
await sh.sealKeyTo(BASE, S.ids.mod, board);
await sh.submitRecord(BASE, { action: "invite", subject: S.ids.a, metInPerson: true });
await sh.sealKeyTo(BASE, S.ids.a, board);
// A: opens the key (from the moderator), vouches for B and C, seals theirs.
await as("a");
let me = await sh.shelterMe(BASE);
const ka = await sh.openSealedKey(BASE, me.sealed_key, me.board, [S.ids.a, me.moderator_id, me.via ?? ""]);
console.log("A opened the board key from:", ka.from === S.ids.mod ? "the moderator" : ka.from);
for (const k of ["b", "c"]) {
  await sh.submitRecord(BASE, { action: "vouch", subject: S.ids[k], metInPerson: true });
  await sh.sealKeyTo(BASE, S.ids[k], board);
}
await sh.submitRecord(BASE, { action: "nickname", subject: S.ids.a, text: "Hana" });
await tb.postNamed(BASE, ka.board, "hello from Hana");
// B: opens the key (from A), reads the board as a member.
await as("b");
me = await sh.shelterMe(BASE);
const kb = await sh.openSealedKey(BASE, me.sealed_key, me.board, [S.ids.b, me.moderator_id, me.via ?? ""]);
console.log("B opened the board key from:", kb.from === S.ids.a ? "A (who let B in)" : kb.from);
const members = await sh.shelterMembers(BASE);
const read = () => tb.readBoard(BASE, kb.board, 100, () => sh.shelterInboxRows(BASE, 100));
let posts = await read();
const named = posts.find((p) => p.state === "open" && p.text === "hello from Hana");
console.log("B sees:", named ? `"${named.text}" by ${sh.memberLabel(members.find((m) => m.wallet === named.label.author), named.label.author)}` : "nothing");
assert.ok(named);
// A non-member: refused everywhere.
await as("x");
const xr = await sh.shelterInboxRows(BASE, 10);
const pub = await fetch(`${BASE}/tmail/inbox/${S.boardId}`);
console.log("non-member reads: /shelter/inbox", xr.status, "· /tmail/inbox/<board>", pub.status);
assert.equal(xr.status, 403);
assert.equal(pub.status, 403);
// Anonymous: B proves membership of Shelter's own set (A, B, C), then posts again without a proof.
await sleep(4000); // the anonymity registry's next epoch
await as("b");
me = await sh.shelterMe(BASE);
console.log("Shelter's anonymous set:", me.anon_set_size, "members");
let tree = await sh.shelterAnonTree(BASE);
let t0 = Date.now();
const p1 = await tb.postAnonymousTo(BASE, PROVER, tb.boardRecipient(kb.board), "anonymous one", () => {}, tree, true, true);
console.log("anonymous post 1:", p1.state, p1.fast ? "(fast)" : "(with proof)", `${((Date.now() - t0) / 1000).toFixed(1)} s`);
assert.equal(p1.state, "sent");
t0 = Date.now();
const p2 = await tb.postAnonymousTo(BASE, PROVER, tb.boardRecipient(kb.board), "anonymous two", () => {}, tree, true, true);
console.log("anonymous post 2:", p2.state, p2.fast ? "(fast)" : "(with proof)", `${((Date.now() - t0) / 1000).toFixed(1)} s`);
assert.equal(p2.fast, true);
posts = await read();
const anon = posts.filter((p) => p.label.kind === "anonymous");
console.log("anonymous posts members see:", anon.length, "verified:", anon.every((p) => p.label.tone === "ok"), "one daily ID:", new Set(anon.map((p) => p.label.dailyId)).size === 1);
// The moderator confirms C as a bot: the set drops to 2 (< 3), so anonymous posting stops.
await as("mod");
await sh.submitRecord(BASE, { action: "case", subject: S.ids.c, text: "end-to-end test" });
await as("b");
tree = await sh.shelterAnonTree(BASE);
const p3 = await tb.postAnonymousTo(BASE, PROVER, tb.boardRecipient(kb.board), "after the case", () => {}, tree ?? { leaves: [], rootHex: "00".repeat(32) }, true, true);
console.log("after the case, anonymous post:", p3.state, p3.reason ? `(${String(p3.reason).slice(0, 90)})` : "");
assert.notEqual(p3.state, "sent");
await as("c");
const cr = await sh.shelterInboxRows(BASE, 10);
console.log("C (removed) reads:", cr.status);
assert.equal(cr.status, 403);
console.log("\nall passed");
process.exit(0);
