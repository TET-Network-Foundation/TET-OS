// Guard for money wording on Try TET (sibling of try_privacy_guard.mjs).
//
//   node --experimental-strip-types scripts/try_money_guard.mjs
//
// Testnet TET is a practice unit: no monetary value, and it can't be bought. So nothing the page
// shows talks like money: no prices, no "earn", no "invest", no buying, no yield, in English,
// Japanese or Chinese. Strict: there is no exception for denials ("earns nothing" is rephrased).
//
// 1. No such wording in anything /try shows: its panels, the libraries it takes text from, and the
//    ja / zh-HK dictionaries. Control: each kind of wording is caught.
// 1b. No money words either (added 2026-10-13): "money", "pay"/"paid"/"payment", "coin(s)", "funds",
//    お金 / 支払 / コイン, 金錢 / 付款 / 支付 / 硬幣. The only exceptions are the practice-unit
//    phrases that say TET is not money ("can't be exchanged for money" and its translations).
//    Control: the stevenexus.org lines that talked about sending money, coins and payments are caught.
// 2. Where the landing plan exists, its FAQ carries the one sanctioned line, word for word:
//    "Testnet TET is a practice unit. It has no monetary value and cannot be bought."
//    Control: the line itself doesn't trip check 1; a plan without it is caught.
//
// Not covered, on purpose: the older home, "participate" and /os pages (app/i18n/translations.ts,
// app/os). The demo serves only /try (deploy/demo/Caddyfile), and their wording is a separate
// decision; see the PR.

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

// What /try shows: its panels and dictionaries, and the lib modules those panels import.
const tryDir = new URL("app/try/", UI);
const panels = readdirSync(tryDir).filter((n) => /\.(?:tsx?|mjs)$/.test(n));
const libs = new Set();
for (const n of panels) {
  for (const m of read(new URL(n, tryDir)).matchAll(/from "\.\.\/lib\/([a-z_./]+)"/g)) {
    for (const ext of ["", ".ts", ".mjs", ".tsx"]) {
      const u = new URL(`app/lib/${m[1]}${ext}`, UI);
      if (existsSync(u) && !u.pathname.endsWith("/")) {
        libs.add(`app/lib/${m[1]}${ext}`);
        break;
      }
    }
  }
}
const files = [...panels.map((n) => [`app/try/${n}`, read(new URL(n, tryDir))]), ...[...libs].map((p) => [p, read(new URL(p, UI))])];

await check(`no money wording in what /try shows (${files.length} files)`, () => {
  const found = moneyWording(files);
  assert.equal(found.length, 0, found.join("\n     "));
});

// 1b. Money words, in what /try and /agents show.
export const MONEY_WORDS = /\bmoney\b|\bpay(?:s|ing|ment|ments|out|outs)?\b|\bpaid\b|\bcoins?\b|\bfunds?\b|お金|支払|コイン|金錢|付款|支付|硬幣/i;
const NOT_MONEY = [
  "can't be exchanged for money",
  "お金とは交換できません",
  "お金で手に入れることもできません",
  "お金には換えられません",
  "不能兌換成金錢",
  "沒有金錢價值",
  "無法用錢換取",
];
/** The text a file puts on the page: t("…") strings, dictionary entries, /agents text, and template
 *  strings (libraries return their messages that way). Identifiers, state names and comments aren't. */
function shownText(path, text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    const take = (re) => { for (const m of line.matchAll(re)) out.push([i + 1, m[1]]); };
    take(/\bt\("((?:[^"\\]|\\.)*)"/g);
    take(/`((?:[^`\\]|\\.)*)`/g);
    if (/i18n_[a-z_]+\.ts$|agents_text\.ts$/.test(path)) take(/"((?:[^"\\]|\\.)*)"/g);
  });
  return out;
}
export function moneyWords(files) {
  const found = [];
  for (const [path, text] of files) {
    for (const [n, str] of shownText(path, text)) {
      let shown = str;
      for (const p of NOT_MONEY) shown = shown.split(p).join("");
      const m = MONEY_WORDS.exec(shown);
      if (m) found.push(`${path}:${n}: "${m[0]}" in ${str.slice(0, 100)}`);
    }
  }
  return found;
}
const agentsDir = new URL("app/agents/", UI);
const agentFiles = existsSync(agentsDir) ? readdirSync(agentsDir).filter((n) => /\.tsx?$/.test(n)).map((n) => [`app/agents/${n}`, read(new URL(n, agentsDir))]) : [];
await check(`no money words in what /try and /agents show (${files.length + agentFiles.length} files)`, () => {
  const found = moneyWords([...files, ...agentFiles]);
  assert.equal(found.length, 0, found.join("\n     "));
});
await check("control: the stevenexus.org money lines are caught; the practice-unit phrases aren't", () => {
  for (const s of [
    "with a small desktop on top where you send money, send messages and send files, all with one key.",
    "- **Send coins.** Transfers go through consensus like any chain.",
    "Most apps keep your messages, files and payment history on their servers",
    "- **Computation you can check.** Pay other nodes to run AI models",
    "seven that could move other people's money.",
    "A second claim returns `already_claimed` and pays nothing.",
    "デジタルのお金",
    "費用由示範的贊助者支付",
  ]) assert.equal(moneyWords([["x.tsx", `t("${s}")`]]).length, 1, s);
  for (const s of ["{amount} TET (practice unit, can't be exchanged for money)", "練習用の単位。お金とは交換できません", "練習用單位，不能兌換成金錢", "沒有金錢價值"]) {
    assert.equal(moneyWords([["x.tsx", `t("${s}")`]]).length, 0, s);
  }
});

await check("control: each kind of money wording is caught; the FAQ line isn't", () => {
  for (const s of ["Earn TET by posting.", "Prices start at 1 TET.", "A good investment.", "Buy TET now.", "Daily yield 5%.", "TETで稼ぐ", "価格は1 TET", "投資ではありません", "儲かる", "賺取 TET", "價格"]) {
    assert.equal(moneyWording([["x.tsx", `t("${s}")`]]).length, 1, s);
  }
  assert.equal(moneyWording([["x.tsx", `t("${FAQ_LINE}")`]]).length, 0, "the sanctioned FAQ line trips the guard");
  assert.equal(moneyWording([["x.ts", `"save": "儲存"`]]).length, 0, "Chinese 儲存 (save) is not money");
});

// Balances: what a wallet holds is shown only as a practice unit (founder, 2026-10-09):
// "120 TET (practice unit, can't be exchanged for money)". Any string that shows an amount of TET
// held ({amount}/{balance} TET, or a number followed by TET) carries that line. (The Files fee
// line is in µTET, a cost rather than a holding, and keeps its own guard.)
const BALANCE = /\{(?:amount|balance)\}\s*TET\b|\b\d[\d,.]*\s+TET\b/;
const PRACTICE = /practice unit, can't be exchanged for money/;
function balancesWithoutPractice(list) {
  const found = [];
  for (const [path, text] of list) {
    for (const m of text.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) {
      if (BALANCE.test(m[1]) && !PRACTICE.test(m[1])) found.push(`${path}: ${m[1].slice(0, 90)}`);
    }
  }
  return found;
}
await check("every TET balance shown carries \"practice unit, can't be exchanged for money\"", () => {
  const found = balancesWithoutPractice(files);
  assert.equal(found.length, 0, found.join("\n     "));
  assert.ok(files.some(([, text]) => text.includes(`t("{amount} TET (practice unit, can't be exchanged for money)"`)), "the balance line is gone");
});
await check("control: a bare balance is caught", () => {
  assert.equal(balancesWithoutPractice([["x.tsx", 't("{amount} TET")']]).length, 1);
  assert.equal(balancesWithoutPractice([["x.tsx", 't("You have 120 TET.")']]).length, 1);
  assert.equal(balancesWithoutPractice([["x.tsx", 't("{amount} TET (practice unit, can\'t be exchanged for money)")']]).length, 0);
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
