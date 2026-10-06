// Try TET part 1, end to end against a real node: the page's own modules, through the page's own
// `/tet-node-api` proxy, to a tet-core in public mode. Not a CI step (it needs a running node and a
// running UI); the PR records its output.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3100 node --experimental-strip-types scripts/try_board_e2e.mjs
//
// The modules get the page's own base, the relative `/tet-node-api`, and relative URLs resolve
// against the UI's origin, as they do in a browser.
//
// Two visitors, A and B, each with a disposable wallet:
//   1. A creates a board. B opens it from the invite link.
//   2. A and B each post named. Both read the feed: two posts, labelled named, with their senders.
//   3. An invite with the right board id but another seed is refused; an unknown board says so.
//   4. A joins the anonymity set, waits for the next epoch, posts anonymously with no prover
//      running: refused with the prover message, and the feed is unchanged.
//   5. No request in the whole run carried the board seed or the board's KEM secret keys.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3100").replace(/\/+$/, "");
const BASE = "/tet-node-api";
const PROVER = process.env.TET_TRY_PROVER || "http://127.0.0.1:9945";

const board = await import("../app/lib/board.mjs");
const tb = await import("../app/lib/try_board.ts");
const trySession = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { toHex } = await import("../app/lib/anon_tree.mjs");
const poster = await import("../app/lib/anon_poster.mjs");

const log = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input).startsWith("/") ? ORIGIN + String(input) : String(input);
  const r = await realFetch(url, init);
  log.push({ url, method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : "", status: r.status });
  return r;
};
const step = (s) => console.log(`\n== ${s}`);
const t0 = Date.now();

step(`node via ${ORIGIN}${BASE}`);
const root0 = await (await realFetch(`${ORIGIN}${BASE}/tmail/anon/root`)).json();
console.log(`anonymity set: ${root0.members} members, epoch ${root0.epoch}`);
console.log(`prover at ${PROVER}: ${await board.probeProver({ url: PROVER })}`);

step("1. A creates a board; B opens it from the invite link");
const wordsA = generateDisposableWords();
const wordsB = generateDisposableWords();
const idA = await trySession.activateTryWallet(wordsA);
const { board: created } = await tb.createBoard(BASE, "e2e board");
const link = board.inviteUrl("https://try.example", created.invite);
console.log(`board ${created.boardWalletId}\ninvite link ${link.slice(0, 60)}… (${link.length} chars)`);
const idB = await trySession.activateTryWallet(wordsB);
const openedB = await tb.openBoard(BASE, link);
assert.equal(openedB.boardWalletId, created.boardWalletId);
console.log(`B opened "${openedB.name}"`);

step("2. A and B post named; both read the feed");
await trySession.activateTryWallet(wordsA);
const m1 = await tb.postNamed(BASE, created, "first post, from A");
await trySession.activateTryWallet(wordsB);
const m2 = await tb.postNamed(BASE, openedB, "second post, from B");
console.log(`posted ${m1} (A), ${m2} (B)`);
for (const [who, b] of [["A", created], ["B", openedB]]) {
  const feed = await tb.readBoard(BASE, b);
  for (const p of feed) console.log(`  ${who} sees: [${p.label.text}] from ${p.label.author?.slice(0, 12)}… "${p.state === "open" ? p.text : "(unreadable)"}"`);
  assert.equal(feed.length, 2);
  assert.ok(feed.every((p) => p.state === "open" && p.label.text === board.NAMED_LABEL));
  assert.deepEqual(new Set(feed.map((p) => p.label.author)), new Set([idA, idB]));
}

step("3. a forged invite and an unknown board are refused");
const forged = board.encodeInvite({ boardWalletId: created.boardWalletId, seed: board.newBoardSeed(), name: "forged" });
await assert.rejects(() => tb.openBoard(BASE, forged), (e) => (console.log(`  forged: ${e.message}`), /doesn't match/.test(e.message)));
const unknown = board.encodeInvite({ boardWalletId: "cd".repeat(32), seed: board.newBoardSeed(), name: "" });
await assert.rejects(() => tb.openBoard(BASE, unknown), (e) => (console.log(`  unknown: ${e.message}`), /no board with that id/.test(e.message)));

step("4. A joins the anonymity set, then posts anonymously with no prover running");
await trySession.activateTryWallet(wordsA);
console.log(`  register: ${await tb.registerForAnon(BASE)}`);
const epochMs = 60_000;
let st;
for (let i = 0; i < 20; i++) {
  const states = [];
  st = await tb.postAnonymous(BASE, PROVER, created, "this must not be sent", (s) => states.push(s.state));
  if (st.state !== "not_in_set") {
    console.log(`  states: ${states.join(" → ")}`);
    break;
  }
  console.log(`  not in the set yet; next epoch at ${new Date(st.nextEpochAtMs).toISOString()}`);
  await new Promise((r) => setTimeout(r, Math.min(epochMs, Math.max(5_000, st.nextEpochAtMs - Date.now() + 2_000))));
}
console.log(`  result: ${st.state}${st.reason ? ` (${st.reason})` : ""}`);
assert.equal(st.state, "failed");
assert.ok(st.reason.startsWith(poster.ANON_PROVER_MISSING));
const feedAfter = await tb.readBoard(BASE, created);
assert.equal(feedAfter.length, 2, "the refused anonymous post must not appear");
console.log(`  feed still has ${feedAfter.length} posts`);

step("5. what the node was sent");
const inv = board.parseInvite(created.invite);
const secrets = [Buffer.from(inv.seed).toString("base64url"), toHex(inv.seed), Buffer.from(created.keys.x25519_sk).toString("base64"), toHex(created.keys.x25519_sk), Buffer.from(created.keys.mlkem_sk).toString("base64").slice(0, 64), created.invite];
for (const r of log) for (const s of secrets) assert.ok(!r.url.includes(s) && !r.body.includes(s), `${r.method} ${r.url} carries a board secret`);
const byRoute = {};
for (const r of log) {
  const k = `${r.method} ${new URL(r.url).pathname.replace(/[0-9a-f]{64}/g, ":id")} → ${r.status}`;
  byRoute[k] = (byRoute[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(byRoute)) console.log(`  ${n}× ${k}`);
console.log(`  ${log.length} requests; none carried the board seed or its secret keys`);

console.log(`\nall steps passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
