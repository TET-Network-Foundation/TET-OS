// TetSearch v1, end to end against a real node with Shelter on (not a CI step):
//   TET_E2E_NODE=http://127.0.0.1:5040 TET_E2E_MODERATOR_WORDS="<the node's TET_SHELTER_MODERATOR words>" \
//     node --experimental-strip-types scripts/try_tetsearch_e2e.mjs
// The moderator invites a member; the member builds a site and lists it (member + site signatures);
// the member searches and finds it; a non-member can't read the listings or list a site.
import { register } from "node:module";
import assert from "node:assert/strict";
register("./lib/ts_hooks.mjs", import.meta.url);
const BASE = process.env.TET_E2E_NODE || "http://127.0.0.1:5040";
const chainInfo = await (await fetch(`${BASE}/chain`)).json();
process.env.NEXT_PUBLIC_TET_CHAIN_ID = chainInfo.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = chainInfo.genesis_hash;
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const sh = await import("../app/lib/shelter.ts");
const ss = await import("../app/lib/site_store.ts");
const ts = await import("../app/lib/tetsearch.ts");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");

assert.ok(await sh.shelterOpen(BASE), "Shelter is off on this node");
const memberWords = generateDisposableWords();
const member = await activateTryWallet(memberWords);
await activateTryWallet(process.env.TET_E2E_MODERATOR_WORDS);
await sh.submitRecord(BASE, { action: "invite", subject: member, metInPerson: true });
await activateTryWallet(memberWords);

const { words: siteWords, siteId } = ss.newSite();
await ss.appendEdit(BASE, siteWords, { op: "add", block: { type: "heading", level: 1, text: "Titration results, week 3" } });
await ss.appendEdit(BASE, siteWords, { op: "add", block: { type: "text", text: "Three runs at 0.1 M NaOH, endpoint by phenolphthalein, mean 24.6 mL." } });
const listed = await ts.listSite(BASE, siteWords);
assert.ok(listed.ok, listed.error);
console.log(`member ${member.slice(0, 8)}… listed site ${siteId.slice(0, 8)}…`);

const l = await ts.fetchListings(BASE);
assert.equal(l.status, 200, l.error);
const docs = await ts.loadDocs(BASE, l.listings, mldsa44Verify);
const hits = ts.rank(docs, "phenolphthalein titration");
assert.ok(hits.some((h) => h.siteId === siteId), "the member's own site wasn't found");
console.log(`search "phenolphthalein titration": ${hits.length} result(s); top "${hits[0].title}" (version ${hits[0].version})`);

// A non-member: can't read the listings, can't list.
await activateTryWallet(generateDisposableWords());
assert.equal((await ts.fetchListings(BASE)).status, 403, "a non-member read the listings");
const { words: w2 } = ss.newSite();
await ss.appendEdit(BASE, w2, { op: "add", block: { type: "text", text: "spam" } });
const refused = await ts.listSite(BASE, w2);
assert.ok(!refused.ok && /vouched members/.test(refused.error), `a non-member listed a site: ${JSON.stringify(refused)}`);
console.log("a non-member can't read the listings or list a site\nall passed");
