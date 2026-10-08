// Guard for "Mark as genuine" and its plain check (app/try/GenuinePanel.tsx, GenuineCheck.tsx).
//
//   node --experimental-strip-types scripts/try_genuine_guard.mjs
//
// 1. A copy "matches" only if it is byte for byte the marked file or text; one changed byte, one
//    byte more or less, says "doesn't match". Control: a check by length or by prefix is caught.
// 2. No jargon on these pages (en, and the strings they use): no signature, key, wallet, .sig.json,
//    nullifier, payload, hash, Ed25519 or ML-DSA. Control: a jargon string is caught.
// 3. The honest lines stay: what a mark shows and doesn't (not who is behind the ID, not that the
//    content is original or true); one changed byte makes a different fingerprint; exact files only.
//    Control: a page without them is caught.
// 4. Marking sends the fingerprint, never the file: the page hashes and signs in the tab and
//    publishes the record with consent; nothing posts the file's bytes. Control: an upload is caught.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const { createHash } = await import("node:crypto");
const G = await import("../app/try/GenuineCheck.tsx").catch(() => null);
const PANEL = readFileSync(new URL("../app/try/GenuinePanel.tsx", import.meta.url), "utf8");
const CHECK = readFileSync(new URL("../app/try/GenuineCheck.tsx", import.meta.url), "utf8");

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

// 1. exact match (the same rule as sameAsMarked, which is SHA-256 of the copy against the mark)
const sha = (b) => createHash("sha256").update(b).digest("hex");
const same = G?.sameAsMarked ?? ((m, c) => sha(c) === m.toLowerCase());
assert.ok(CHECK.includes("return hex(sha256(copy)) === markedSha256.toLowerCase();"), "sameAsMarked isn't a full-fingerprint comparison");
const marked = new TextEncoder().encode("The TET sample file.\nChange one letter and it won't match.\n");
const exact = (fn) => {
  assert.equal(fn(sha(marked), marked), true, "the exact file must match");
  const one = new Uint8Array(marked);
  one[3] ^= 0x20;
  assert.equal(fn(sha(marked), one), false, "one changed byte matched");
  assert.equal(fn(sha(marked), marked.slice(0, -1)), false, "one byte less matched");
  assert.equal(fn(sha(marked), new Uint8Array([...marked, 10])), false, "one byte more matched");
};
await check("a copy matches only if it is byte for byte the marked one", () => exact(same));
await mustThrow("a check by length is caught", () => exact((m, c) => c.length === marked.length));
await mustThrow("a check by prefix is caught", () => exact((m, c) => new TextDecoder().decode(c).startsWith("The TET")));

// 2. no jargon
const literals = (src) => [...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
const JARGON = /\bsignature|\bsign(?:ed|ing)?\b|\bkeys?\b|\bwallet|\.sig\.json|nullifier|payload|\bhash\b|Ed25519|ML-DSA/i;
const plain = (srcs) => {
  const bad = srcs.flatMap(literals).filter((s) => JARGON.test(s));
  assert.deepEqual(bad, [], `jargon: ${bad.join(" | ")}`);
};
await check("no jargon on the mark and check pages", () => plain([PANEL, CHECK]));
await mustThrow("a jargon string is caught", () => plain([PANEL + '\nt("Download the .sig.json signed with your key")']));

// 3. honest lines
const LINES = [
  [CHECK, "It doesn't show who is behind the ID, or that the content is original or true."],
  [PANEL, "It doesn't show who is behind the ID, or that the content is original or true."],
  [CHECK, "Even one changed byte makes a different fingerprint."],
  [CHECK, "Exact files only: re-compressed or edited copies won't match."],
  [PANEL, "never the content"],
];
const honest = (pairs) => {
  for (const [src, line] of pairs) assert.ok(src.includes(line), `missing: ${line}`);
};
await check("the honest lines stay", () => honest(LINES));
await mustThrow("a page without them is caught", () => honest([[CHECK.replace("Even one changed byte makes a different fingerprint.", ""), "Even one changed byte makes a different fingerprint."]]));

// 4. the fingerprint, never the file
const fingerprintOnly = (src) => {
  assert.ok(/signFileHash\(bytes, chain\)/.test(src), "marking doesn't sign the fingerprint");
  assert.ok(/publishRecord\(BASE, rec\.bytes, chain\)/.test(src), "marking doesn't publish the record (with consent)");
  assert.ok(!/fetch\(|FormData|postFilesUpload|files\/upload/.test(src), "the mark page sends something itself");
};
await check("marking sends the fingerprint, never the file", () => fingerprintOnly(PANEL));
await mustThrow("an upload is caught", () => fingerprintOnly(PANEL.replace("const chain = await", "await fetch('/tet-node-api/files/upload', { method: 'POST', body: bytes });\n      const chain = await")));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
