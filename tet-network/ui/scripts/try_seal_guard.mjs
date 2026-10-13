// Guard for sealed predictions (app/lib/seal.ts, app/try/SealPanel.tsx).
//
//   node --experimental-strip-types scripts/try_seal_guard.mjs
//
// 1. The seal is exact: one changed character of the text, the opening date or the salt changes the
//    fingerprint; a reveal link carries the exact sealed bytes. Control: a seal of the text alone is caught.
// 2. Each seal has a fresh 16-byte random salt, so a short prediction can't be guessed from its
//    fingerprint. Control: a fixed salt is caught.
// 3. The card, the share link and the X post carry only the code, the date and the chain height —
//    never the prediction or its salt. Control: a card with the text is caught.
// 4. A reveal counts only a verified record matched by the sealed bytes' fingerprint (the earliest).
//    Control: a reveal accepting any verified hit is caught.
// 5. The honest lines stay (written when recorded and unchanged; not that it was right; not that the
//    author didn't seal many predictions) and the 1–30 day limit is said. Control: a page without them.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const S = await import("../app/lib/seal.ts");
const PANEL = readFileSync(new URL("../app/try/SealPanel.tsx", import.meta.url), "utf8");

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

const salt = new Uint8Array(16).fill(3);
const text = "東京で12月1日に雪が降る";
// 1. exact
const exact = (seal) => {
  const a = seal(text, "2026-12-01", salt);
  assert.equal(S.sealFingerprint(a), createHash("sha256").update(a).digest("hex"));
  assert.notEqual(S.sealFingerprint(seal(text + "。", "2026-12-01", salt)), S.sealFingerprint(a), "a changed text kept the fingerprint");
  assert.notEqual(S.sealFingerprint(seal(text, "2026-12-02", salt)), S.sealFingerprint(a), "a changed date kept the fingerprint");
  assert.notEqual(S.sealFingerprint(seal(text, "2026-12-01", new Uint8Array(16).fill(4))), S.sealFingerprint(a), "a changed salt kept the fingerprint");
  const r = S.parseReveal("#" + S.revealFragment(a));
  assert.ok(r && Buffer.from(r.bytes).equals(Buffer.from(a)), "the reveal link doesn't carry the exact bytes");
  assert.equal(r.sealed.text, text);
};
await check("the seal is exact, and the reveal link carries the exact bytes", () => exact(S.sealBytes));
await mustThrow("a seal of the text alone is caught", () => exact((t) => new TextEncoder().encode(t)));

// 2. fresh salt
const fresh = (mk) => assert.notEqual(S.sealFingerprint(mk(text, "2026-12-01")), S.sealFingerprint(mk(text, "2026-12-01")), "two seals of the same text share a fingerprint");
await check("each seal has a fresh random salt", () => fresh(S.newSeal));
await mustThrow("a fixed salt is caught", () => fresh((t, o) => S.sealBytes(t, o, salt)));

// 3. nothing hidden on the card, the share link or the X post
const lines = S.cardLines({ code: "TET-ABCD-EFGH", opens: "2026-12-01", height: 1234 });
const publicOnly = (ls, src) => {
  assert.ok(ls.every((l) => !l.includes(text) && !l.includes("03030303")), "the card carries the text or salt");
  assert.deepEqual(ls, ["sealed · block #1234 · opens 2026-12-01", "TET-ABCD-EFGH"]);
  const share = src.slice(src.indexOf("const shareLink ="), src.indexOf("\n", src.indexOf("const shareLink =")));
  assert.ok(/\/try#code=\$\{code\}`/.test(share) && !/text|bytes|reveal/.test(share.replace("shareLink", "")), "the share link carries more than the code");
  const x = src.slice(src.indexOf("x.com/intent/post"), src.indexOf("target=", src.indexOf("x.com/intent/post")));
  assert.ok(!/revealLink|\btext\b|bytes|salt/.test(x.replace("intent/post?text=", "").replace(/t\("[^"]*"/g, "")), "the X post carries the prediction or the reveal link");
};
await check("the card, the share link and the X post carry no hidden text", () => publicOnly(lines, PANEL));
await mustThrow("a card with the text is caught", () => publicOnly([...lines, text], PANEL));

// 4. reveal counts only verified fingerprint matches
const revealRule = (src) => assert.ok(src.includes('found.filter((f) => f.match === "file" && f.verified)'), "the reveal doesn't require a verified fingerprint match");
await check("a reveal counts only a verified record of exactly these bytes", () => revealRule(PANEL));
await mustThrow("a reveal accepting any verified hit is caught", () => revealRule(PANEL.replace('f.match === "file" && f.verified', "f.verified")));

// 5. honest lines and the limit
const HONEST = [
  "It doesn't show the prediction was right, or that the author didn't seal many different predictions and open only the one that came true.",
  "(this node allows 1 to 30 days)",
];
const honest = (src) => {
  for (const l of HONEST) assert.ok(src.includes(l), `missing: ${l}`);
  assert.equal(S.SEAL_MIN_DAYS, 1);
  assert.equal(S.SEAL_MAX_DAYS, 30);
};
await check("the honest lines and the 1–30 day limit stay", () => honest(PANEL));
await mustThrow("a page without them is caught", () => honest(PANEL.replaceAll("or that the author didn't seal many different predictions and open only the one that came true", "")));
await mustThrow("an X post with the reveal link is caught", () => publicOnly(lines, PANEL.replace("\" #TET予言 \" + done.shareLink", "\" #TET予言 \" + done.revealLink")));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
