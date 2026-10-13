// Guard: nothing calls Tmail's / Files' key exchange "ML-KEM" or "FIPS 203".
//
//   node scripts/kem_wording_guard.mjs
//
// The KEM is CRYSTALS-Kyber-768 Round 3 (pqcrypto-kyber 0.8.1 on the node, crystals-kyber-js 1.1.x
// in the browser), byte-incompatible with FIPS 203 ML-KEM-768; moving to ML-KEM is a Phase 1 item.
// Every line in the UI, tet-core, the root docs and docs/ that says "ML-KEM" or "FIPS 203" must, on
// that line or the one next to it, say it is not what runs today: "not", "byte-incompatible",
// "migration"/"move to", "legacy", or the ja/zh equivalents. History logs (DAILY_LOG_*, TET_STATE_*)
// and archive/ record past states and are left as they are. `mlkem_*` field names are protocol
// identifiers, not claims, and are not matched. Control: a plain "Tmail uses ML-KEM-768" is caught.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "tet-network/ui/app", "tet-core/src", "README.md", "SECURITY.md", "WHITEPAPER.md", "docs"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|mjs|rs|md|html)$/.test(f))
  .filter((f) => !/(^|\/)(DAILY_LOG_|TET_STATE_)|(^|\/)archive\//.test(f));

const MENTION = /ml-kem|fips[ -]?203/i;
const QUALIFIED = /\bnot\b|n't|byte-incompatib|incompatib|migrat|move to|moving to|switch to|legacy|rather than|instead of|overclaim|ではない|ではありません|移行|並非|尚未|不是/i;

function claims(entries) {
  const bad = [];
  for (const [f, text] of entries) {
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      if (!MENTION.test(l)) return;
      const near = [lines[i - 1] ?? "", l, lines[i + 1] ?? ""].join(" ");
      if (!QUALIFIED.test(near)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 110)}`);
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
check(`no unqualified "ML-KEM" / "FIPS 203" claim (${files.length} files)`, () => {
  const bad = claims(entries);
  assert.deepEqual(bad, [], bad.join("\n     "));
});
check("control: a plain \"Tmail uses ML-KEM-768\" is caught", () => {
  assert.equal(claims([["x.md", "Intro.\nTmail uses X25519 + ML-KEM-768 for key exchange.\nMore."]]).length, 1);
  assert.equal(claims([["x.tsx", 't("Key exchange: FIPS 203.")']]).length, 1);
  assert.equal(claims([["x.md", "The KEM is Kyber Round 3, not FIPS 203 ML-KEM."]]).length, 0);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
