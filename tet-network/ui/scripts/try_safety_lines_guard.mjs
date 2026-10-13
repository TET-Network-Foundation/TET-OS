// Guard: the three fixed sentences (docs/THREAT_MODEL.md rule 8) are where the 12 words are
// entered, saved or remembered, word for word, in every language.
//
//   node --experimental-strip-types scripts/try_safety_lines_guard.mjs
//
// Negative control (run by hand, recorded in the commit): <SafetyLines /> removed from the restore
// screen → FAILED.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
export const LINES = [
  "TET asks for your passphrase (12 words) only on the restore screen; support never DMs you.",
  "On a device managed by your school or employer, the admin can see everything.",
  "Lose your passphrase (12 words) and nobody can recover it.",
];
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
const cont = read("../app/try/ContinueBlock.tsx");
const page = read("../app/try/page.tsx");
const words = read("../app/lib/disposable_wallet.mjs");
const model = read("../../../docs/THREAT_MODEL.md");
const ja = read("../app/try/i18n_ja.ts");
const zh = read("../app/try/i18n_zh_hk.ts");

check("SafetyLines holds the three sentences word for word", () => {
  const comp = /export function SafetyLines\(\)[\s\S]*?\n}\n/.exec(cont)?.[0] ?? "";
  for (const l of LINES) assert.ok(comp.includes(`t(${JSON.stringify(l)})`), `missing: ${l}`);
});
check("they're on the restore screen and the remember-on-this-device screen", () => {
  const restore = /restoreOpen \? \([\s\S]*?\) : \(/.exec(cont)?.[0] ?? "";
  assert.ok(restore.includes("<SafetyLines />"), "not on the restore screen");
  const remember = /showRemember \? \([\s\S]*?\) : \(/.exec(cont)?.[0] ?? "";
  assert.ok(remember.includes("<SafetyLines />"), "not on the remember screen");
});
check("the save-your-passphrase line says the first and third", () => {
  for (const l of [LINES[0], LINES[2]]) assert.ok(page.includes(`t(${JSON.stringify(l)})`), `missing on the save line: ${l}`);
});
check("the saved words file says all three", () => {
  for (const l of LINES) assert.ok(words.includes(JSON.stringify(l)), `missing in the words file: ${l}`);
});
check("each is translated, and the threat model states the same text", () => {
  for (const l of LINES) {
    assert.ok(ja.includes(JSON.stringify(l) + ":"), `ja: ${l}`);
    assert.ok(zh.includes(JSON.stringify(l) + ":"), `zh-HK: ${l}`);
    assert.ok(model.includes(l), `THREAT_MODEL.md: ${l}`);
  }
});
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
