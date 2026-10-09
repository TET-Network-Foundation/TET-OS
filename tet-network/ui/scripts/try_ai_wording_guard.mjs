// Guard: never claim AI can't access TET, can't enter, or that a space is "AI-free, guaranteed".
//
//   node scripts/try_ai_wording_guard.mjs
//
// What TET can say (founder, 2026-10-09): "Members-only spaces are encrypted; public pages opt out of
// AI training crawlers that respect robots.txt." robots.txt is a request and public chain data is
// readable by anyone running a node, so absolute claims are false. Scans the UI (all languages),
// tet-core, the root docs and docs/ (history logs and archive/ excepted). A line that quotes the rule
// as something never to say ("never", 「言わない」, 「書かない」, 切勿 …) on it or next to it passes.
// Also requires the FAQ's sentence. Controls: each banned phrase, in en/ja/zh, is caught.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "tet-network/ui/app", "tet-core/src", "docs", "*.md", "*.html", "deploy"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|mjs|rs|md|html|txt)$/.test(f) && !/(^|\/)(DAILY_LOG_|TET_STATE_)|(^|\/)archive\//.test(f));

const BANNED = [
  /\bAI\s+(?:cannot|can't|can not|won't|will not)\s+(?:access|enter|reach|read|get into|see)\b/i,
  /\bno\s+AI\s+(?:can|will)\s+(?:access|enter|reach|read)\b/i,
  /\bAI[- ]free\b[^.\n]{0,30}\bguarantee|guarantee[sd]?\s+(?:to be\s+)?AI[- ]free|\b100\s*%\s*AI[- ]free/i,
  /\bhumans only,?\s+guaranteed/i,
  /AI\s*(?:は|が)\s*(?:入れない|入れません|アクセスできない|アクセスできません|入れなく)/,
  /AI\s*フリー\s*(?:を)?\s*保証|AI\s*ゼロ\s*保証/,
  /AI\s*(?:無法|不能|不可)\s*(?:進入|存取|訪問|讀取)|保證\s*(?:沒有|無)\s*AI/,
];
const QUOTED_AS_RULE = /\bnever\b|don't say|do not say|banned|言わない|書かない|禁止|使わない|切勿|不要說|不得/i;

function claims(entries) {
  const bad = [];
  for (const [f, text] of entries) {
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      if (!BANNED.some((r) => r.test(l))) return;
      const near = [lines[i - 1] ?? "", l, lines[i + 1] ?? ""].join(" ");
      if (!QUOTED_AS_RULE.test(near)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 110)}`);
    });
  }
  return bad;
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
const entries = files.map((f) => [f, readFileSync(`${ROOT}/${f}`, "utf8")]);
check(`no absolute "AI can't access / AI-free" claim (${files.length} files)`, () => {
  const bad = claims(entries);
  assert.deepEqual(bad, [], bad.join("\n     "));
});
check("controls: each banned phrase is caught, and a quoted rule passes", () => {
  for (const x of ["AI cannot access TET.", "AI cannot enter the Shelter.", "An AI-free space, guaranteed.", "AI-free guaranteed", "AIは入れない場所です。", "AIフリー保証", "AI 無法進入。"]) {
    assert.equal(claims([["x.tsx", `t(${JSON.stringify(x)})`]]).length, 1, x);
  }
  assert.equal(claims([["x.md", 'Never write "AI cannot access TET".']]).length, 0);
});
check("the FAQ says what TET can say about AI", () => {
  const how = readFileSync(`${ROOT}/tet-network/ui/app/try/HowPanel.tsx`, "utf8");
  assert.ok(how.includes('t("Members-only spaces are encrypted; public pages opt out of AI training crawlers that respect robots.txt.")'));
  assert.match(how, /can be read by anyone who runs a node, AI included/);
});
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
