// Guard for plain words on the try page (founder: non-technical people first).
//
//   node --experimental-strip-types scripts/try_plain_guard.mjs
//
// 1. The everyday pages (home, boards, messages, files, polls, sites, mark as genuine, sealed
//    prediction, the top bar, footer and continue line) say "ID", "passphrase (12 words)", "inbox",
//    "proof file": never "wallet", ".sig.json", "nullifier", "your/the key(s)", or a bare
//    "12 words". Control: a jargon string is caught.
// 2. "nullifier" appears on no page except How it works (where technical terms belong). Control.
// The Sign, Verify and QR tools are signature-file tools for developers and keep their terms.

import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const DIR = new URL("../app/try/", import.meta.url);
const read = (f) => readFileSync(new URL(f, DIR), "utf8");
const EVERYDAY = ["BoardPanel.tsx", "MailPanel.tsx", "FilesTryPanel.tsx", "PollBox.tsx", "page.tsx", "ContinueBlock.tsx", "SitePanel.tsx", "NewBoardPanel.tsx", "DirectoryPanel.tsx", "HomePanel.tsx", "wallet.tsx", "ui.tsx", "GenuinePanel.tsx", "GenuineCheck.tsx", "SealPanel.tsx", "InsidePanel.tsx"].filter((f) => {
  try {
    read(f);
    return true;
  } catch {
    return false;
  }
});
const JARGON = /\bwallet|nullifier|\.sig\.json|\b(?:your|the|this|a|messaging|its|own)\s+keys?\b|(?<!passphrase \()12 words/i;
const literals = (src) => [...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));

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

const plain = (files) => {
  const bad = files.flatMap(([f, src]) => literals(src).filter((s) => JARGON.test(s)).map((s) => `${f}: ${s.slice(0, 80)}`));
  assert.deepEqual(bad, [], bad.join("\n     "));
};
const everyday = EVERYDAY.map((f) => [f, read(f)]);
check("the everyday pages use plain words", () => plain(everyday));
check("control: a jargon string is caught", () => assert.throws(() => plain([...everyday, ["x.tsx", 't("Save your wallet\'s 12 words")']])));

const noNullifier = (files) => {
  const bad = files.filter(([f, src]) => f !== "HowPanel.tsx" && literals(src).some((s) => /nullifier/i.test(s))).map(([f]) => f);
  assert.deepEqual(bad, []);
};
const all = readdirSync(DIR).filter((n) => n.endsWith(".tsx")).map((f) => [f, read(f)]);
check("\"nullifier\" is on no page but How it works", () => noNullifier(all));
check("control: a nullifier string is caught", () => assert.throws(() => noNullifier([...all, ["BoardPanel2.tsx", 't("the nullifier")']])));

// 3. The testnet line stays where people look for it: the footer, Terms and the FAQ each say it's a
//    testnet and that data may be reset (the home title has no "trial" badge; this is the place).
function testnetLines(files) {
  const has = (f, re, what) => assert.match(files[f], re, `${f}: ${what}`);
  has("page.tsx", /t\("This is a testnet\. Data may be reset\."\)/, "the footer's testnet line is gone");
  has("TermsPanel.tsx", /t\("[^"]*testnet[^"]*can be reset[^"]*"\)/, "Terms no longer says it's a testnet that can be reset");
  const faq = files["HowPanel.tsx"].split('t("FAQ")')[1]?.split("</div>")[0] ?? "";
  assert.match(faq, /t\("This is a testnet\. Data may be reset\."\)/, "the FAQ's testnet line is gone");
}
const LINE_FILES = Object.fromEntries(["page.tsx", "TermsPanel.tsx", "HowPanel.tsx"].map((f) => [f, read(f)]));
check("the footer, Terms and FAQ keep \"testnet, data may be reset\"", () => testnetLines(LINE_FILES));
check("control: removing it from the FAQ is caught", () =>
  assert.throws(() => testnetLines({ ...LINE_FILES, "HowPanel.tsx": LINE_FILES["HowPanel.tsx"].replace('<p className="mt-1">{t("This is a testnet. Data may be reset.")}</p>', "") })),
);
check("control: removing it from the footer is caught", () =>
  assert.throws(() => testnetLines({ ...LINE_FILES, "page.tsx": LINE_FILES["page.tsx"].replace('t("This is a testnet. Data may be reset.")', 't("Hello.")') })),
);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
