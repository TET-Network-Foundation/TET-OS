// Guard for the "What is TET" page (app/try/WhatPanel.tsx) and its translations.
//
//   node --experimental-strip-types scripts/try_what_guard.mjs
//
// 1. No "first" claims, in any language: QRL and others already use post-quantum signatures, so
//    TET claims the combination, never a first. Control: "the first …" is caught.
// 2. No dates beyond Phase 1: the only year anywhere on the page is 2027, on the Phase 1 line; the
//    vision (phases 2–10) has no dates. Control: a vision item with a year is caught.
// 3. The page keeps its honest lines: this demo shows only part of TET; where TET is weaker today
//    (testnet only, one block producer, no audit, very few users); "no dates; the order may change";
//    the volunteer line; QRL named. Control: a page missing one is caught.
// 4. Every string on the page, including the comparison table and the vision list, has Japanese
//    and Hong Kong Chinese.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const SRC = readFileSync(new URL("../app/try/WhatPanel.tsx", import.meta.url), "utf8");
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");

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
function mustThrow(name, fn) {
  return check(`control: ${name}`, async () => {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    assert.ok(threw, "the check did not catch it");
  });
}

/** Every English string the page shows: t("…") literals and the ROWS / VISION arrays. */
function strings(src) {
  const out = new Set();
  for (const m of src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  const block = (name) => {
    const i = src.indexOf(`export const ${name}`);
    return i < 0 ? "" : src.slice(i, src.indexOf("];", i));
  };
  for (const m of (block("ROWS") + block("VISION")).matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  return [...out];
}
const pageText = (src, ja = JA, zh = ZH_HK) => {
  const en = strings(src);
  return { en, all: [...en, ...en.map((k) => ja[k] ?? ""), ...en.map((k) => zh[k] ?? "")] };
};

// 1. no "first"
const FIRST = /\bfirst\b|世界初|初の|最初の|初めての|首個|首創|第一個|全球首|首個/i;
const noFirst = (src, ja, zh) => {
  const bad = pageText(src, ja, zh).all.filter((s) => FIRST.test(s));
  assert.deepEqual(bad, [], `"first" claims: ${bad.join(" | ")}`);
};
await check("no \"first\" claims, in any language", () => noFirst(SRC));
await mustThrow("a \"first\" claim is caught", () => noFirst(SRC.replace('"Checking who made something, and when"', '"The first network for checking who made something"')));
await mustThrow("a Japanese \"first\" claim is caught", () => noFirst(SRC, { ...JA, "Checking who made something, and when": "世界初の、作者を確かめるネットワーク" }));

// 2. no dates beyond Phase 1
const PHASE1 = "Phase 1: genesis, the start of the real network. Target: Q1 2027. A target, not a promise; it moves if the work isn't ready.";
const datesOk = (src, ja, zh) => {
  const { en } = pageText(src, ja, zh);
  for (const k of en) {
    for (const s of [k, (ja ?? JA)[k] ?? "", (zh ?? ZH_HK)[k] ?? ""]) {
      const years = [...s.matchAll(/(?:19|20)\d\d/g)].map((m) => m[0]);
      if (k === PHASE1) assert.deepEqual(years, ["2027"], `Phase 1 must name 2027 only: ${s}`);
      else if (k.startsWith("Proof of stake since")) assert.deepEqual(years, ["2022"], "Ethereum's switch year, a past fact");
      else assert.deepEqual(years, [], `a date outside Phase 1: ${s}`);
      if (k !== PHASE1) assert.ok(!/\bQ[1-4]\b|第[1-4一二三四]四半期|第[一二三四]季/.test(s), `a quarter outside Phase 1: ${s}`);
    }
  }
  assert.ok(en.includes(PHASE1), "the Phase 1 line is gone");
};
await check("no dates beyond Phase 1 (the vision is undated)", () => datesOk(SRC));
await mustThrow("a vision item with a year is caught", () => datesOk(SRC.replace('"An outside security audit"', '"An outside security audit (2028)"')));

// 3. honest lines
const REQUIRED = [
  "This demo shows only part of what TET can do.",
  "It's a testnet only: nothing on it is meant to last or has value.",
  "One block producer makes every block.",
  "No security audit has been done.",
  "Very few people use it.",
  "After that: the vision. No dates; the order may change.",
  "TET is a volunteer open-source project. There are no paid roles or tokens to offer.",
];
const honest = (src) => {
  const { en } = pageText(src);
  for (const r of REQUIRED) assert.ok(en.includes(r), `missing: ${r}`);
  assert.ok(en.some((s) => /QRL/.test(s)), "QRL isn't named (the combination, not a first)");
};
await check("the page keeps its honest lines", () => honest(SRC));
await mustThrow("a page missing the weaker-today line is caught", () => honest(SRC.replace('t("No security audit has been done.")', 't("Audited.")')));

// 4. translations
await check("every string on the page has Japanese and Hong Kong Chinese", () => {
  const missing = strings(SRC).filter((k) => !JA[k] || !ZH_HK[k]);
  assert.deepEqual(missing, []);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
