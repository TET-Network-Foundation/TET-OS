// Fast anonymous posting, end to end, with the real prover and two nodes (docs/plans/FAST_ANON_POSTING.md).
// Not a CI step: it needs two running nodes, the UI's API proxy and the native prover.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3200 TET_SECOND_NODE=http://127.0.0.1:5020 \
//     node --experimental-strip-types scripts/try_fast_anon_e2e.mjs
//
// 1. The first anonymous post of the day on board A carries a proof (timed).
// 2. The next ten carry no proof: the first five instant, the rest paced a few seconds apart by the
//    invisible flood guard (posted back to back, faster than anyone types). None is refused.
// 3. A post signed with board A's posting key but sent to board B is refused, and not stored.
// 4. Both nodes serve all eleven on board A, verified, with one daily ID. The second node learns of
//    them only by gossip (registration verified there after pulling the receipt; fast posts held,
//    then verified).

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const SECOND = (process.env.TET_SECOND_NODE || "http://127.0.0.1:5020").replace(/\/+$/, "");
const BASE = "/tet-node-api";
const PROVER = process.env.TET_TRY_PROVER || "http://127.0.0.1:9945";
const realFetch = globalThis.fetch;
globalThis.fetch = (i, o = {}) => realFetch(String(i).startsWith("/") ? ORIGIN + String(i) : String(i), o);
const tb = await import("../app/lib/try_board.ts");
const trySession = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { tmailEphemeralSeed, tmailBucketIndex, fromHex } = await import("../app/lib/anon_tree.mjs");
const { ephemeralWalletIdFromSeed, buildAnonymousTmailEnvelopeV1 } = await import("../app/lib/tmail.ts");
const { getTmailKeySession } = await import("../app/lib/tmail_session.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await trySession.activateTryWallet(generateDisposableWords());
const { board: boardA } = await tb.createBoard(BASE, "fast A");
const { board: boardB } = await tb.createBoard(BASE, "fast B");
console.log(`register: ${await tb.registerForAnon(BASE)}`);
const root = await (await fetch(`${BASE}/tmail/anon/root`)).json();
await sleep(Math.max(0, Number(root.next_epoch_at_ms ?? 0) - Date.now()) + 65_000);

// 1. The first post proves.
let t = Date.now();
const first = await tb.postAnonymous(BASE, PROVER, boardA, "post 1 (with proof)", () => {}, true);
const firstMs = Date.now() - t;
console.log(`post 1: ${first.state}${first.fast ? " (fast)" : " (proof)"} in ${(firstMs / 1000).toFixed(1)} s`);
assert.equal(first.state, "sent");
assert.ok(!first.fast, "the first post should carry the proof");

// 2. The next ten need no proof: the first five instant, the rest paced by the flood guard.
const times = [];
for (let i = 2; i <= 11; i++) {
  t = Date.now();
  const out = await tb.postAnonymous(BASE, PROVER, boardA, `post ${i} (fast)`, () => {}, true);
  times.push(Date.now() - t);
  assert.equal(out.state, "sent", `post ${i}: ${out.reason ?? ""}`);
  assert.equal(out.fast, true, `post ${i} wasn't fast`);
}
console.log(`posts 2–11: fast, ${times.map((x) => (x / 1000).toFixed(2)).join(" / ")} s`);
// The invisible flood guard: posted back to back (faster than a person types), the first 5 are
// instant; after that each waits a few seconds (the node says "try again in a moment" and the page
// retries quietly). None is refused.
assert.ok(times.slice(0, 5).every((x) => x < 1_000), "a fast post in the burst took 1 s or more");
assert.ok(times.slice(5).every((x) => x < 5_000), "a paced post took 5 s or more");

// 3. Board A's posting key, used on board B: refused, not stored.
const ks = getTmailKeySession();
const bucket = tmailBucketIndex(Date.now());
const seedA = tmailEphemeralSeed(ks.anonMemberSecret, fromHex(boardA.boardWalletId), bucket);
const keysB = await (await fetch(`${BASE}/tmail/keys/${boardB.boardWalletId}`)).json();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const stray = await buildAnonymousTmailEnvelopeV1({
  ephemeralSeed: seedA,
  ephemeralWalletId: await ephemeralWalletIdFromSeed(seedA),
  receiverWalletId: boardB.boardWalletId,
  plaintextUtf8: "board A's key on board B",
  receiverX25519Pub: b64(keysB.registration.x25519_pub_b64),
  receiverMlkemPub: b64(keysB.registration.mlkem_pub_b64),
  sentAtMs: Date.now(),
  proof: null,
  baseUrl: BASE,
});
const r = await fetch(`${BASE}/tmail/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stray) });
console.log(`A's key on board B: HTTP ${r.status} ${await r.text()}`);
assert.equal(r.status, 403);

// 4. Both nodes serve all eleven, verified, one daily ID.
const show = (posts) => posts.filter((p) => p.label.kind === "anonymous");
const onA = show(await tb.readBoard(BASE, boardA, 100));
console.log(`node 1, board A: ${onA.length} anonymous, ${new Set(onA.map((p) => p.label.dailyId)).size} daily ID(s), verified: ${onA.every((p) => p.label.tone === "ok")}`);
assert.equal(onA.length, 11);
assert.ok(onA.every((p) => p.label.tone === "ok"));
assert.equal(new Set(onA.map((p) => p.label.dailyId)).size, 1);
let onB = [];
for (let i = 0; i < 30; i++) {
  globalThis.fetch = (u, o = {}) => realFetch(String(u).startsWith(BASE) ? SECOND + String(u).slice(BASE.length) : String(u).startsWith("/") ? ORIGIN + String(u) : String(u), o);
  onB = show(await tb.readBoard(BASE, boardA, 100)).filter((p) => p.label.tone === "ok");
  if (onB.length === 11) break;
  await sleep(3_000);
}
console.log(`node 2 (gossip only), board A: ${onB.length} verified anonymous`);
assert.equal(onB.length, 11, "the second node didn't verify all eleven");
const stored = await (await realFetch(`${SECOND}/tmail/inbox/${boardB.boardWalletId}?limit=50`)).json();
assert.ok(!(stored.messages ?? []).some((m) => m.msg_id === stray.msg_id), "the stray post reached board B on node 2");
console.log("\nall passed");
process.exit(0);
