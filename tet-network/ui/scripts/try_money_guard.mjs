// Guard for money wording on Try TET (sibling of try_privacy_guard.mjs).
//
//   node --experimental-strip-types scripts/try_money_guard.mjs
//
// Testnet TET is a practice unit: no monetary value, and it can't be bought. So nothing the page
// shows talks like money: no prices, no "earn", no "invest", no buying, no yield, in English,
// Japanese or Chinese. Strict: there is no exception for denials ("earns nothing" is rephrased).
//
// 1. No such wording in anything /try or the /os corner shows: their pages (/os/start included),
//    the libraries they import, and the ja / zh-HK dictionaries. Control: each kind is caught.
// 2. Where the landing plan exists, its FAQ carries the one sanctioned line, word for word:
//    "Testnet TET is a practice unit. It has no monetary value and cannot be bought."
//    Control: the line itself doesn't trip check 1; a plan without it is caught.
//
// The old home and "participate" pages are gone (the founder's decision, 2026-10-08); /os stays as a
// hidden corner and is covered. The remaining old pages (understand, setup, whitepaper, …) are not
// served by the demo and are not covered.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const UI = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const read = (u) => readFileSync(u, "utf8");

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

export const FAQ_LINE = "Testnet TET is a practice unit. It has no monetary value and cannot be bought.";

export const MONEY = new RegExp(
  [
    "\\b(?:price[sd]?|pricing|priced)\\b",
    "\\bearn(?:s|ed|ing|ings)?\\b",
    "\\binvest(?:s|ed|ing|ment|ments|or|ors)?\\b",
    "\\b(?:profit(?:s|able)?|yield(?:s)?|APY|APR|ROI)\\b",
    "\\b(?:buy|buying|purchase|purchasing)\\s+(?:TET|tokens?|coins?)\\b",
    "\\b(?:presale|pre-sale|token sale|market cap)\\b",
    // 儲 alone is "store" in Chinese (儲存); the money sense is Japanese 儲け / 儲かる.
    "価格|値段|稼(?:ぐ|げ|ぎ|い)|投資|儲(?:け|か)|利回り|購入",
    "價格|價錢|賺|投資|收益|購買",
  ].join("|"),
  "i",
);

function moneyWording(files) {
  const found = [];
  for (const [path, text] of files) {
    text.split("\n").forEach((line, i) => {
      // Code comments don't reach the page.
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
      const m = MONEY.exec(line);
      if (m) found.push(`${path}:${i + 1}: "${m[0]}" in ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

// What /try and the /os corner show: their pages and dictionaries, and the lib modules they import.
const DIRS = ["app/try/", "app/os/", "app/os/start/"];
const pages = [];
for (const d of DIRS) {
  const dir = new URL(d, UI);
  if (!existsSync(dir)) continue;
  for (const n of readdirSync(dir).filter((n) => /\.(?:tsx?|mjs)$/.test(n))) pages.push(`${d}${n}`);
}
const libs = new Set();
for (const p of pages) {
  for (const m of read(new URL(p, UI)).matchAll(/from "(?:\.\.\/)+lib\/([A-Za-z_./]+)"/g)) {
    for (const ext of ["", ".ts", ".mjs", ".tsx"]) {
      const u = new URL(`app/lib/${m[1]}${ext}`, UI);
      if (existsSync(u) && !u.pathname.endsWith("/")) {
        libs.add(`app/lib/${m[1]}${ext}`);
        break;
      }
    }
  }
}
const files = [...pages.map((p) => [p, read(new URL(p, UI))]), ...[...libs].map((p) => [p, read(new URL(p, UI))])];

await check(`no money wording in what /try and /os show (${files.length} files)`, () => {
  const found = moneyWording(files);
  assert.equal(found.length, 0, found.join("\n     "));
});

await check("control: each kind of money wording is caught; the FAQ line isn't", () => {
  for (const s of ["Earn TET by posting.", "Prices start at 1 TET.", "A good investment.", "Buy TET now.", "Daily yield 5%.", "TETで稼ぐ", "価格は1 TET", "投資ではありません", "儲かる", "賺取 TET", "價格"]) {
    assert.equal(moneyWording([["x.tsx", `t("${s}")`]]).length, 1, s);
  }
  assert.equal(moneyWording([["x.tsx", `t("${FAQ_LINE}")`]]).length, 0, "the sanctioned FAQ line trips the guard");
  assert.equal(moneyWording([["x.ts", `"save": "儲存"`]]).length, 0, "Chinese 儲存 (save) is not money");
});

const plan = new URL("docs/LANDING_PLAN.md", ROOT);
await check("the landing plan's FAQ has the practice-unit line word for word (when the plan exists)", () => {
  if (!existsSync(plan)) return;
  assert.ok(read(plan).includes(FAQ_LINE), "docs/LANDING_PLAN.md lacks the FAQ line");
});

await check("control: a plan without the line is caught", () => {
  const without = "## FAQ\n\nTestnet TET is a test unit.\n";
  assert.throws(() => assert.ok(without.includes(FAQ_LINE)));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
