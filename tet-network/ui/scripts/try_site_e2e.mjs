// Signed sites, end to end against a real node: the page's own modules through the page's
// `/tet-node-api` proxy. Not a CI step (it needs a running node and UI); the PR records its output.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3200 node --experimental-strip-types scripts/try_site_e2e.mjs
//
//   1. Make a site; set its title and language; add a heading, text with formatting and a link, a
//      list, a quote, a link block and an image.
//   2. Fetch it and check the chain in this process (every signature and link), render it twice:
//      same bytes; the proves line is in the footer.
//   3. Remove a block; the version changes and the page loses that block.
//   4. Another key's edit for this site is refused by the node; a stale (replayed) edit too; a
//      second edit at the same position (a fork) is refused.
//   5. A tampered copy of the chain (served by a dishonest node) fails the reader's check.

import { register } from "node:module";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const BASE = "/tet-node-api";
const realFetch = globalThis.fetch;
globalThis.fetch = (i, o = {}) => realFetch(String(i).startsWith("/") ? ORIGIN + String(i) : String(i), o);

const L = await import("../app/lib/site_lang.ts");
const S = await import("../app/lib/site_store.ts");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const { expectedChainBinding } = await import("../app/lib/chain_binding.ts");
const step = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chain = await expectedChainBinding(BASE);

step("1. make a site and add six kinds of block");
const { siteId, words } = S.newSite();
console.log(`  site ${siteId}`);
// The demo gate allows 20 writes a minute per address: pace instead of failing.
async function append(op) {
  for (;;) {
    try {
      return await S.appendEdit(BASE, words, op);
    } catch (e) {
      if (!/busy/.test(e.message)) throw e;
      await sleep(4000);
    }
  }
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ops = [
  { op: "meta", title: "Club notes", lang: "en", template: "paper" },
  { op: "add", block: { type: "heading", level: 1, text: "Club notes" } },
  { op: "add", block: { type: "text", text: "We meet on **Fridays**. *Bring tea.*\n\nMinutes are [on the board](https://example.org/minutes)." } },
  { op: "add", block: { type: "list", ordered: true, items: ["Agenda", "Votes", "Tea"] } },
  { op: "add", block: { type: "quote", text: "Small and steady.", who: "the treasurer" } },
  { op: "add", block: { type: "link", url: "https://example.org/", label: "Our other page" } },
  { op: "add", block: { type: "image", mime: "image/png", data_b64: PNG, sha256: createHash("sha256").update(Buffer.from(PNG, "base64")).digest("hex"), alt: "one pixel" } },
];
let version = "";
for (const op of ops) version = await append(op);
console.log(`  ${ops.length} edits, version ${version.slice(0, 16)}…`);

step("2. fetch, check the chain, render");
let got = await S.fetchSite(BASE, siteId);
let v = await S.verifyChain(siteId, got.edits, chain, mldsa44Verify);
assert.ok(v.ok, JSON.stringify(v));
assert.equal(v.version, version);
let st = L.applyEdits(got.edits.map((e) => e.body));
const html = L.render(st, siteId, v.version);
assert.equal(html, L.render(L.applyEdits(got.edits.map((e) => e.body)), siteId, v.version), "not deterministic");
assert.ok(html.includes(L.esc(L.PROVES.en(v.version))));
assert.equal(st.blocks.length, 6);
console.log(`  checked: ${v.count} edits, every signature and link valid; ${st.blocks.length} blocks; ${html.length} bytes of HTML; same bytes twice`);

step("3. remove a block");
const v2 = await append({ op: "remove", index: 3 });
got = await S.fetchSite(BASE, siteId);
v = await S.verifyChain(siteId, got.edits, chain, mldsa44Verify);
st = L.applyEdits(got.edits.map((e) => e.body));
assert.ok(v.ok && v.version === v2 && v.version !== version);
assert.ok(!st.blocks.some((b) => b.type === "quote"), "the quote is still there");
console.log(`  version ${version.slice(0, 12)}… → ${v2.slice(0, 12)}…; ${st.blocks.length} blocks`);

step("4. the node refuses another key, a stale edit and a fork");
await sleep(6000);
const post = (e) => fetch(`${BASE}/sites/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) });
const other = S.newSite();
const head = got.head;
const foreign = await S.signEdit(other.words, head.len, head.head_hash, JSON.stringify({ op: "add", block: { type: "text", text: "not yours" } }), chain, Date.now());
foreign.site_wallet_id = siteId;
let r = await post(foreign);
console.log(`  another key: HTTP ${r.status} ${(await r.json()).error}`);
assert.equal(r.status, 400);
const stale = await S.signEdit(words, head.len, head.head_hash, JSON.stringify({ op: "remove", index: 0 }), chain, Date.now() - 3_600_000);
r = await post(stale);
console.log(`  signed an hour ago: HTTP ${r.status} ${(await r.json()).error}`);
assert.equal(r.status, 400);
const fork = await S.signEdit(words, head.len - 1, got.edits[head.len - 2].prev_hash === undefined ? S.ZERO_HASH : S.editHash(got.edits[head.len - 2]), JSON.stringify({ op: "remove", index: 0 }), chain, Date.now());
r = await post(fork);
console.log(`  a second edit at position ${head.len - 1}: HTTP ${r.status}`);
assert.equal(r.status, 409);

step("5. a tampered copy fails the reader's check");
const tampered = got.edits.map((e, i) => (i === 2 ? { ...e, body: e.body.replace("Fridays", "Mondays") } : e));
const tv = await S.verifyChain(siteId, tampered, chain, mldsa44Verify);
console.log(`  ${tv.ok ? "ACCEPTED" : `refused at edit ${tv.at}: ${tv.reason}`}`);
assert.equal(tv.ok, false);
console.log(`\nall passed · view it at ${ORIGIN}/s/${siteId}`);
