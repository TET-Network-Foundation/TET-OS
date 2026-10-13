// Guard for the home view's search over public threads (app/lib/public_search.ts).
//
//   node --experimental-strip-types scripts/try_search_guard.mjs
//
// 1. Every word of the query must match (title, board name or text), case- and width-insensitive
//    (ＣＨＥＭ finds chem). Control: a case-sensitive matcher is caught.
// 2. An empty query finds nothing (the box never lists everything by accident).

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
const { searchThreads } = await import("../app/lib/public_search.ts");

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

const T = [
  { title: "Titration results, week 3", board: "Chemistry club", invite: "a", count: 3, lastAtMs: 2, text: "0.1 M NaOH, endpoint by phenolphthalein" },
  { title: "Which pH meter do you trust?", board: "Chemistry club", invite: "a", count: 2, lastAtMs: 1, text: "calibration at pH 4 and 7" },
  { title: "自転車の修理", board: "Bike repair", invite: "b", count: 1, lastAtMs: 3, text: "チェーンの油" },
];

function behaves(search) {
  assert.deepEqual(search(T, "titration").map((h) => h.title), ["Titration results, week 3"]);
  assert.deepEqual(search(T, "ＣＨＥＭＩＳＴＲＹ calibration").map((h) => h.title), ["Which pH meter do you trust?"]);
  assert.deepEqual(search(T, "trust naoh").map((h) => h.title), [], "every word must match the same thread");
  assert.deepEqual(search(T, "チェーン").map((h) => h.board), ["Bike repair"]);
  assert.deepEqual(search(T, "   "), []);
}

await check("every word matches, case- and width-insensitive; an empty query finds nothing", () => behaves(searchThreads));
await check("control: a case-sensitive matcher is caught", () => {
  const naive = (ts, q) => (q.trim() ? ts.filter((t) => q.split(/\s+/).filter(Boolean).every((w) => `${t.title}\n${t.board}\n${t.text}`.includes(w))) : []);
  assert.throws(() => behaves(naive));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
