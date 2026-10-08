// Anonymous polls, end to end against a real node and the real native prover: the page's own
// modules, through the page's `/tet-node-api` proxy. Not a CI step (it needs a running node, UI and
// prover); the PR records its output.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3100 node --experimental-strip-types scripts/try_poll_e2e.mjs
//
//   1. Members M1 and M2, and a stranger S, join the anonymity set; S is not listed in the poll.
//   2. A members-only poll naming an unregistered wallet is refused; one listing M1 and M2 is made,
//      and the node's root is the one it built from its own registry.
//   3. M1 and M2 vote (real proofs). Both count.
//   4. M1 votes again: not counted (one vote per member).
//   5. S proves against the whole anonymity set and sends a ballot to the poll: not counted (a
//      members-only poll takes only its own root). S's ordinary vote() stops before proving.
//   6. The tally is [1, 1] with 2 verified votes.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3100").replace(/\/+$/, "");
const BASE = "/tet-node-api";
const PROVER = process.env.TET_TRY_PROVER || "http://127.0.0.1:9945";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => realFetch(String(input).startsWith("/") ? ORIGIN + String(input) : String(input), init);

const tb = await import("../app/lib/try_board.ts");
const poll = await import("../app/lib/poll.ts");
const trySession = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const board = await import("../app/lib/board.mjs");

const step = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
console.log(`node via ${ORIGIN}${BASE}; prover at ${PROVER}: ${await board.probeProver({ url: PROVER })}`);

step("1. M1, M2 and a stranger S join the anonymity set");
const who = {};
for (const name of ["M1", "M2", "S"]) {
  const words = generateDisposableWords();
  const id = await trySession.activateTryWallet(words);
  console.log(`  ${name} ${id.slice(0, 12)}… register: ${await tb.registerForAnon(BASE)}`);
  who[name] = { words, id };
}
const root0 = await (await fetch(`${BASE}/tmail/anon/root`)).json();
const waitMs = Math.max(0, Number(root0.next_epoch_at_ms ?? 0) - Date.now()) + 3000;
console.log(`  waiting ${Math.round(waitMs / 1000)} s for the next epoch (S must be in the set for step 5)`);
await sleep(waitMs);

step("2. make the poll");
await trySession.activateTryWallet(generateDisposableWords()); // the creator, not a voter
const stranger = generateDisposableWords();
const unregistered = await trySession.activateTryWallet(stranger);
await assert.rejects(
  () => poll.createPoll(BASE, "stuffed?", ["yes", "no"], [who.M1.id, unregistered]),
  (e) => (console.log(`  with an unregistered wallet: refused: ${e.message}`), /not a registered member/.test(e.message)),
);
const def = await poll.createPoll(BASE, "Lunch on Friday?", ["yes", "no"], [who.M1.id, who.M2.id]);
console.log(`  poll ${poll.encodePoll(def).slice(0, 90)}…`);
const opened = await tb.openBoard(BASE, def.invite);
const reg = await poll.nodePollRoot(BASE, opened.boardWalletId);
assert.deepEqual(reg.members, [who.M1.id, who.M2.id].sort());
console.log(`  node's root ${reg.rootHex.slice(0, 16)}… for ${reg.members.length} members, day ${reg.day}`);

async function voteAs(name, choice) {
  await trySession.activateTryWallet(who[name].words);
  const s = Date.now();
  const out = await poll.vote(BASE, PROVER, def, choice, () => {});
  console.log(`  ${name} votes ${def.options[choice]}: ${out.state}${out.state === "failed" ? ` (${out.reason})` : ""} in ${Math.round((Date.now() - s) / 1000)} s`);
  return out;
}
async function settledTally(want) {
  let t;
  for (let i = 0; i < 30; i++) {
    t = await poll.tally(BASE, def);
    if (t.verified + t.unverified >= want && t.unverified === 0 ? true : t.verified + t.unverified >= want) break;
    await sleep(2000);
  }
  console.log(`  tally ${JSON.stringify(t)}`);
  return t;
}

step("3. M1 and M2 vote");
assert.equal((await voteAs("M1", 0)).state, "sent");
assert.equal((await voteAs("M2", 1)).state, "sent");
let t = await settledTally(2);
assert.deepEqual(t.counts, [1, 1]);

step("4. M1 votes again");
const again = await voteAs("M1", 0);
t = await settledTally(again.state === "sent" ? 3 : 2);
assert.deepEqual(t.counts, [1, 1], "a second vote counted");

step("5. S, in the anonymity set but not listed");
await trySession.activateTryWallet(who.S.words);
const bypass = await tb.postAnonymousTo(BASE, PROVER, tb.boardRecipient(opened), JSON.stringify({ vote: 0 }), () => {});
console.log(`  S proves against the whole set and sends: ${bypass.state}${bypass.state === "failed" ? ` (${bypass.reason})` : ""}`);
const ordinary = await voteAs("S", 0);
assert.notEqual(ordinary.state, "sent", "S's ordinary vote was sent");

step("6. the tally");
t = await settledTally(bypass.state === "sent" ? (again.state === "sent" ? 4 : 3) : 2);
assert.deepEqual(t.counts, [1, 1]);
assert.equal(t.verified, 2);
const refused = (await tb.readBoard(BASE, opened, 50)).filter((p) => p.label.tone !== "ok").map((p) => p.label.detail);
for (const r of refused) console.log(`  not counted: ${r}`);
assert.ok(refused.some((r) => /replay/.test(r)), "M1's second vote wasn't refused as a replay");
if (bypass.state === "sent") assert.ok(refused.some((r) => /root not recognised/.test(r)), "S's set-root ballot wasn't refused on the root");
console.log(`\nall passed in ${Math.round((Date.now() - t0) / 1000)} s`);
