// TetSearch v1 (app/lib/tetsearch.ts, app/try/SearchPanel.tsx). Each rule with a negative control.
// 1. Ranking: every query word must appear; a title match counts more; ONE result per member (a
//    member's thousand pages are one voice); then the newer signed version.
// 2. A listed site is searched only if its whole edit chain verifies (loadDocs).
// 3. Wording: the required lines are on the screen; never "AI cannot access", "AI cannot create
//    keys" or "humans only".
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
register("./lib/ts_hooks.mjs", import.meta.url);
const { rank } = await import("../app/lib/tetsearch.ts");

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n")[0]}`);
  }
};
const fails = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const doc = (siteId, member, title, body, signedAtMs = 1) => ({ siteId, member, title, body, version: 1, signedAtMs });
const docs = [
  doc("s1", "alice", "Titration results", "week 3 titration with NaOH", 10),
  doc("s2", "alice", "More titration", "titration again", 20),
  doc("s3", "bob", "Lab notes", "we did a titration today", 30),
  doc("s4", "carol", "Gardening", "tomatoes", 40),
];
const rule1 = (r) => {
  const hits = r(docs, "titration");
  // alice's two pages score the same (title and body); the newer one stands for her; bob's is body-only.
  assert.deepEqual(hits.map((h) => h.siteId), ["s2", "s3"]);
  assert.equal(hits.filter((h) => h.member === "alice").length, 1, "one result per member");
  assert.equal(hits[0].member, "alice", "a title match ranks above a body-only match");
  assert.equal(r(docs, "titration tomatoes").length, 0, "every word must appear");
  assert.equal(r(docs, "   ").length, 0);
};
check("ranking: all words, title first, one result per member", () => rule1(rank));
check("control: no one-per-member limit FAILS", () => assert.ok(fails(() => rule1((d, q) => d.filter((x) => (x.title + x.body).toLowerCase().includes(q.trim().split(/\s+/)[0] ?? "")).map((x) => ({ ...x, score: 1, snippet: "" }))))));

const lib = readFileSync(new URL("../app/lib/tetsearch.ts", import.meta.url), "utf8");
const chainRule = (src) => {
  assert.match(src, /const v = await verifyChain\(l\.site_wallet_id, site\.edits, chain, mldsa44Verify\);\n\s*if \(!v\.ok\) continue;/);
};
check("a site is searched only if its whole edit chain verifies", () => chainRule(lib));
check("control: skipping the chain check FAILS", () => assert.ok(fails(() => chainRule(lib.replace("if (!v.ok) continue;", "")))));

const panel = readFileSync(new URL("../app/try/SearchPanel.tsx", import.meta.url), "utf8");
const wording = (src) => {
  assert.ok(src.includes("Only vouched people can publish. Built to keep out mass AI generation."));
  assert.ok(src.includes("Keys without a human vouch can't publish."));
  assert.ok(src.includes("A member can still paste AI-written text"));
  assert.doesNotMatch(src, /AI cannot access|AI can't access|AI cannot create keys|humans only/i);
};
check("the required lines are on the screen, and no overclaim", () => wording(panel));
check("control: an overclaim FAILS", () => assert.ok(fails(() => wording(panel.replace("Keys without a human vouch can't publish.", "Keys without a human vouch can't publish. Humans only, guaranteed.")))));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
