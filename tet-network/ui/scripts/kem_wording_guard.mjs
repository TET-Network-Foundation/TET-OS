// Guard: nothing calls Tmail's / Files' key exchange "ML-KEM" or "FIPS 203".
//
//   node scripts/kem_wording_guard.mjs
//
// The KEM is CRYSTALS-Kyber-768 Round 3 (pqcrypto-kyber 0.8.1 on the node, crystals-kyber-js 1.1.x
// in the browser), byte-incompatible with FIPS 203 ML-KEM-768; moving to ML-KEM is a Phase 1 item.
// Every SENTENCE in the UI, tet-core, the root docs and docs/ that says "ML-KEM" or "FIPS 203" must
// itself say it is not what runs today: "not", "byte-incompatible", "migration"/"move to", "legacy",
// "inaccurate", or the ja/zh equivalents. (Until 2026-10-13 a qualifier on the NEXT line counted, so
// "the key exchange moved to the final ML-KEM standard" passed because the line after it said "not
// only data centres".) A sentence ends at . ! ? 。 ！ ？, a blank line, a list item or a table row;
// comment markers are stripped first. History logs (DAILY_LOG_*, TET_STATE_*) and archive/ record
// past states and are left as they are. `mlkem_*` field names are protocol identifiers, not claims,
// and are not matched. Controls: a plain "Tmail uses ML-KEM-768" is caught; so are the stevenexus.org
// lines that said TET had moved to ML-KEM, and a claim borrowing a "not" from the next line.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "tet-network/ui/app", "tet-core/src", "README.md", "SECURITY.md", "WHITEPAPER.md", "docs"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|mjs|rs|md|html)$/.test(f))
  .filter((f) => !/(^|\/)(DAILY_LOG_|TET_STATE_)|(^|\/)archive\//.test(f));

const MENTION = /ml-kem|fips[ -]?203/i;
const QUALIFIED = /\bnot\b|n't|byte-incompatib|incompatib|migrat|\bmov(?:e|ing)\b[^.。]{0,40}\bto\b|switch to|legacy|rather than|instead of|overclaim|inaccurat|incorrect|ではない|ではありません|まだ|移行|並非|尚未|不是/i;

/** The text cut into sentences, each with the line it starts on. */
export function sentences(text) {
  const out = [];
  let cur = "";
  let start = 0;
  const flush = () => {
    if (cur.trim()) out.push([start, cur.trim()]);
    cur = "";
  };
  text.split("\n").forEach((raw, i) => {
    const l = raw.replace(/^\s*(?:\/\/[!/]?|\/?\*+\/?|#+(?=\s))\s?/, "");
    // A blank line, a list item, a heading or a table row starts a new sentence.
    if (!l.trim() || /^\s*(?:[-*+]\s|\d+\.\s|\||<p>-\s|#)/.test(l)) flush();
    if (!l.trim()) return;
    if (!cur) start = i + 1;
    for (const part of l.split(/(?<=[.!?。！？])\s+/)) {
      if (!cur) start = i + 1;
      cur += (cur ? " " : "") + part;
      if (/[.!?。！？]["')\]]*$/.test(part)) flush();
    }
  });
  flush();
  return out;
}

function claims(entries) {
  const bad = [];
  for (const [f, text] of entries)
    for (const [line, s] of sentences(text)) if (MENTION.test(s) && !QUALIFIED.test(s)) bad.push(`${f}:${line}: ${s.slice(0, 110)}`);
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
check(`no unqualified "ML-KEM" / "FIPS 203" claim (${files.length} files)`, () => {
  const bad = claims(entries);
  assert.deepEqual(bad, [], bad.join("\n     "));
});
check("control: a plain \"Tmail uses ML-KEM-768\" is caught", () => {
  assert.equal(claims([["x.md", "Intro.\nTmail uses X25519 + ML-KEM-768 for key exchange.\nMore."]]).length, 1);
  assert.equal(claims([["x.tsx", 't("Key exchange: FIPS 203.")']]).length, 1);
  assert.equal(claims([["x.md", "The KEM is Kyber Round 3, not FIPS 203 ML-KEM."]]).length, 0);
});
check("control: the stevenexus.org lines that said TET had moved to ML-KEM are caught", () => {
  const site = [
    "- **Safe after quantum computers.** Post-quantum signatures from day one, and the key exchange moved to the final ML-KEM standard, so nothing signed today can be forged later.",
    "- **Runs on normal machines.** Consensus that adapts to the hardware, so a laptop can take part, not only data centres.",
  ].join("\n");
  assert.equal(claims([["content.js", site]]).length, 1, "the ML-KEM claim borrowed the next line's \"not\"");
  assert.equal(claims([["x.md", "Messages use ML-KEM.\nThis is not a drill."]]).length, 1, "a qualifier in the next sentence doesn't count");
  assert.equal(claims([["x.md", "Moving both planes to FIPS 203 ML-KEM-768 is a Phase 1 item."]]).length, 0, "a planned move is qualified");
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
