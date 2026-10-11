// Guard: the Japanese terms the founder chose (2026-10-11) stay the only ones.
//
//   node scripts/ja_terms_guard.mjs
//
// - vouch is 推薦, never 保証 (保証 reads as a money guarantee). 保証 is allowed only in its ordinary
//   sense, "保証はありません" (no warranty).
// - the 12 words are パスフレーズ, never 合言葉.
// - the anonymity set is 匿名グループ, never 匿名セット.
// Scanned: the page's Japanese dictionary, the Japanese paper and the maintenance page. The guards'
// own lists of banned phrases (which name 保証 on purpose) are not scanned.
// Control: a sample with each old term is caught; the allowed "保証はありません" is not.

import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = new URL("../../../", import.meta.url).pathname;
const FILES = [
  "tet-network/ui/app/try/i18n_ja.ts",
  "tet-network/ui/app/whitepaper/paper_ja.ts",
  "deploy/demo/maintenance/maintenance.html",
];

/** The lines of `text` that use an old term. */
export function oldTerms(text) {
  return text.split("\n").filter((l) => /合言葉|匿名セット/.test(l) || /保証/.test(l.replace(/保証はありません/g, "")));
}

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

check("Japanese uses 推薦, パスフレーズ and 匿名グループ (no 保証 for vouch, no 合言葉, no 匿名セット)", () => {
  const bad = [];
  for (const f of FILES) {
    if (!existsSync(ROOT + f)) continue;
    for (const l of oldTerms(readFileSync(ROOT + f, "utf8"))) bad.push(`${f}: ${l.trim().slice(0, 120)}`);
  }
  assert.deepEqual(bad, []);
});
check("control: each old term is caught; 保証はありません is not", () => {
  assert.equal(oldTerms("公開できるのは保証を受けた人だけです。").length, 1);
  assert.equal(oldTerms("合言葉（12語）で ID を開く").length, 1);
  assert.equal(oldTerms("先に匿名セットに参加してください。").length, 1);
  assert.equal(oldTerms("コインに価値はなく、保証はありません。").length, 0);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
