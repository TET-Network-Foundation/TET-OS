// Guard: boards have an invisible flood guard and no visible per-minute limit (founder, 2026-10-09).
//
//   node scripts/try_flood_guard.mjs
//
// 1. A burst of 5 named posts goes out at once; the 6th waits a few seconds (SPACING_MS).
// 2. Normal conversation never waits: a post every 15 seconds for 10 minutes, and 4 quick posts.
// 3. BoardPanel asks the guard before each named post, and shows no per-minute limit text.
// Controls: a guard that waits from the first post, and a "1 post per minute" line, are caught.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { BURST, SPACING_MS, delayBeforeNext } from "../app/lib/flood_guard.mjs";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Waits a sequence of attempted send times would get. */
function waits(delayFn, attempts) {
  const sent = [];
  return attempts.map((at) => {
    const w = delayFn(sent, at);
    sent.push(at + w);
    return w;
  });
}
function burstThenSpaced(delayFn) {
  const w = waits(delayFn, [0, 100, 200, 300, 400, 500, 600]);
  assert.deepEqual(w.slice(0, BURST), [0, 0, 0, 0, 0], "the first 5 posts must go out at once");
  assert.ok(w[5] > 0 && w[5] <= SPACING_MS, `the 6th post should wait a few seconds, waited ${w[5]} ms`);
  assert.ok(w[6] > 0, "a 7th rapid post keeps being spaced");
}
function normalNeverWaits(delayFn) {
  const every15s = Array.from({ length: 40 }, (_, i) => i * 15_000);
  assert.ok(waits(delayFn, every15s).every((w) => w === 0), "a post every 15 s was delayed");
  assert.ok(waits(delayFn, [0, 2_000, 5_000, 9_000]).every((w) => w === 0), "4 quick replies were delayed");
}
check("a burst of 5 goes at once; then posts are spaced a few seconds", () => burstThenSpaced(delayBeforeNext));
check("normal conversation never waits", () => normalNeverWaits(delayBeforeNext));
check("control: a guard that spaces every post is caught", () => {
  const always = (sent, now) => (sent.length ? Math.max(0, sent[sent.length - 1] + SPACING_MS - now) : 0);
  assert.throws(() => burstThenSpaced(always));
  assert.throws(() => normalNeverWaits(always));
});

const BOARD = readFileSync(new URL("../app/try/BoardPanel.tsx", import.meta.url), "utf8");
const VISIBLE_LIMIT = /per minute|a minute|every \d+ seconds|分に\d|毎分|每分鐘|每分钟/i;
function boardOk(src) {
  assert.match(src, /delayBeforeNext\(sentTimes\.current, Date\.now\(\)\)[\s\S]{0,200}postNamed\(/, "the board doesn't ask the guard before a named post");
  const shown = [...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((x) => VISIBLE_LIMIT.test(x));
  assert.deepEqual(shown, [], "the board shows a per-minute limit");
}
check("the board uses the guard and shows no per-minute limit", () => boardOk(BOARD));
check("control: a visible limit, or no guard, is caught", () => {
  assert.throws(() => boardOk(BOARD.replace('t("Post")', 't("1 post per minute")')));
  assert.throws(() => boardOk(BOARD.replace("delayBeforeNext(sentTimes.current, Date.now())", "0")));
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
