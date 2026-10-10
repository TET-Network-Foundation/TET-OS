// Guard: /.well-known/security.txt (RFC 9116; docs/THREAT_MODEL.md rule 11) names the same contacts
// as SECURITY.md and the Terms page, links the policy, and hasn't expired.
//
//   node scripts/security_txt_guard.mjs
//
// Negative control (run by hand, recorded in the commit): the Expires line removed → FAILED.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const txt = read("../public/.well-known/security.txt");
const security = read("../../../SECURITY.md");
const terms = read("../app/try/TermsPanel.tsx");
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
const field = (k) => [...txt.matchAll(new RegExp(`^${k}: (.+)$`, "gm"))].map((m) => m[1].trim());
check("the security contact is SECURITY.md's", () => {
  const email = /Email \*\*([^*]+)\*\*/.exec(security)?.[1];
  assert.ok(email && field("Contact").includes(`mailto:${email}`), `security.txt doesn't name ${email}`);
});
check("the abuse contact is the Terms page's", () => {
  const abuse = /ABUSE_CONTACT = "([^"]+)"/.exec(terms)?.[1];
  assert.ok(abuse && field("Contact").includes(`mailto:${abuse}`), `security.txt doesn't name ${abuse}`);
});
check("hello@ is the one What is TET shows, and both contacts are on the main domain", () => {
  const what = readFileSync(new URL("../app/try/WhatPanel.tsx", import.meta.url), "utf8");
  const hello = /mailto:(hello@[^"]+)"/.exec(what)?.[1];
  assert.ok(hello && field("Contact").includes(`mailto:${hello}`), `security.txt doesn't name ${hello}`);
  for (const c of field("Contact").filter((c) => /mailto:(abuse|hello)@/.test(c))) assert.match(c, /@tetnet\.org$/, c);
});
check("it links the policy (SECURITY.md)", () => {
  assert.ok(field("Policy").some((p) => p.endsWith("/SECURITY.md")));
});
check("it has one Expires, in the future, less than a year and a month away", () => {
  const e = field("Expires");
  assert.equal(e.length, 1, "Expires is required, once");
  const t = Date.parse(e[0]);
  assert.ok(t > Date.now(), "expired: renew it");
  assert.ok(t - Date.now() < 400 * 86_400_000, "RFC 9116 recommends less than a year");
});
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
