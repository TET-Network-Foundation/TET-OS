// Guard: nothing describes the founder beyond "Steve" — no "student", age, school, town or country.
//
//   node scripts/founder_privacy_guard.mjs
//
// Founder's rule: no personal details (age, school, town) anywhere. Every mention of Steve or of
// the founder/operator in the UI (all languages), tet-core, the root docs and docs/ must not have a
// personal detail within 160 characters. Controls: "Steve, a student in Switzerland" and
// 「スイスの学生、Steve」 are caught; "Built by Steve." passes.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "tet-network/ui/app", "tet-core/src", "docs", "*.md", "*.html"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|mjs|rs|md|html)$/.test(f) && !/(^|\/)archive\//.test(f));

const WHO = /\bSteve\b|\bfounder\b|創業者|創辦人|運営者|開発者|作者本人/g;
const PERSONAL = /\bstudents?\b|学生|學生|\bpupil\b|\b\d{1,2}\s*(?:years?[ -]old|yo\b)|\d{1,2}\s*歳|\d{1,2}\s*歲|\b(?:high |secondary |middle )?school\b|学校|高校|中学|大学|學校|中學|大學|gymnasi|\btown\b|\bvillage\b|\bhometown\b|地元|故郷|Switzerland|Swiss|スイス|瑞士|Z[uü]rich|Geneva|Gen[eè]ve|\bBern\b|Basel|Lausanne|Lucerne|Luzern/i;

function leaks(entries) {
  const bad = [];
  for (const [f, text] of entries) {
    for (const m of text.matchAll(WHO)) {
      const win = text.slice(Math.max(0, m.index - 160), m.index + 160);
      const p = PERSONAL.exec(win);
      if (p) bad.push(`${f}: "${win.replace(/\s+/g, " ").slice(Math.max(0, win.indexOf(p[0]) - 60), win.indexOf(p[0]) + 60)}"`);
    }
  }
  return [...new Set(bad)];
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
check(`no personal detail next to the founder (${files.length} files)`, () => {
  const bad = leaks(entries);
  assert.deepEqual(bad, [], bad.join("\n     "));
});
check("control: student / town / age next to Steve are caught; \"Built by Steve.\" passes", () => {
  assert.equal(leaks([["x.tsx", 't("Built and run by Steve, a student in Switzerland.")']]).length, 1);
  assert.equal(leaks([["x.ts", '"x": "スイスの学生、Steve が作っています。"']]).length, 1);
  assert.equal(leaks([["x.md", "The founder, 17 years old, ..."]]).length, 1);
  assert.equal(leaks([["x.tsx", 't("Built by Steve.")']]).length, 0);
});
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
