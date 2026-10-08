// A member's second anonymous post on the same board on the same UTC day, end to end against a real
// node and the real prover. Not a CI step (it needs a running node, UI and prover).
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3200 node --experimental-strip-types scripts/try_anon_repeat_e2e.mjs
//
//   1. A member joins the anonymity set and posts anonymously to a new board: verified, shown.
//   2. The same member posts anonymously again to the same board the same day: the node refuses it
//      before storing (repeat), and the board still shows one anonymous post.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const BASE = "/tet-node-api";
const PROVER = process.env.TET_TRY_PROVER || "http://127.0.0.1:9945";
const realFetch = globalThis.fetch;
globalThis.fetch = (i, o = {}) => realFetch(String(i).startsWith("/") ? ORIGIN + String(i) : String(i), o);
const tb = await import("../app/lib/try_board.ts");
const trySession = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await trySession.activateTryWallet(generateDisposableWords());
const { board } = await tb.createBoard(BASE, "repeat test");
console.log(`register: ${await tb.registerForAnon(BASE)}`);
const root = await (await fetch(`${BASE}/tmail/anon/root`)).json();
await sleep(Math.max(0, Number(root.next_epoch_at_ms ?? 0) - Date.now()) + 65_000);

const first = await tb.postAnonymous(BASE, PROVER, board, "first anonymous post", () => {});
console.log(`1st: ${first.state}${first.state === "failed" ? ` (${first.reason})` : ""}`);
assert.equal(first.state, "sent");
const second = await tb.postAnonymous(BASE, PROVER, board, "second anonymous post, same day", () => {});
console.log(`2nd: ${second.state}${second.state === "failed" ? ` (${second.reason.slice(0, 160)})` : ""}`);
assert.notEqual(second.state, "sent", "a same-day repeat was accepted");
assert.match(second.reason ?? "", /replay|nullifier/);
const posts = await tb.readBoard(BASE, board, 50);
console.log(`board shows: ${posts.map((p) => `[${p.label.text}] ${p.state === "open" ? p.text : "?"}`).join(" | ")}`);
assert.equal(posts.filter((p) => p.label.kind === "anonymous").length, 1);
assert.ok(posts.every((p) => p.label.tone !== "bad"));
console.log("\nall passed");
