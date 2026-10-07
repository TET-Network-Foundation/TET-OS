// Try TET part 4, end to end: the verify panel's verifier on real, published signatures, with the
// chain binding taken from a running node through the page's `/tet-node-api` proxy, as the panel
// does. Not a CI step (needs a node, the UI, and a checkout of the devlog site); the PR records it.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3100 TET_TRY_SITE_DIR=~/site \
//     node --experimental-strip-types scripts/try_verify_e2e.mjs
//
// The devlog on stevenexus.org signs each entry with an agent key on chain `tet-local-dev`. A
// local-dev node serves that same binding at `/chain`, so the panel verifies those signatures
// against the node's chain with no chain typed in. The content is rebuilt from the site's own
// `content.js`, independently of the payload inside the sidecar.

import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3100").replace(/\/+$/, "");
const SITE = (process.env.TET_TRY_SITE_DIR || `${process.env.HOME}/site`).replace(/^~/, process.env.HOME);

const v = await import("../app/lib/verify_anything.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");

const step = (s) => console.log(`\n== ${s}`);

step(`the node's chain, via ${ORIGIN}/tet-node-api/chain`);
const c = await (await fetch(`${ORIGIN}/tet-node-api/chain`)).json();
const chain = { chainId: c.chain_id, genesisHash: c.genesis_hash };
console.log(`  ${chain.chainId} ${chain.genesisHash}`);

step(`devlog entries from ${SITE}`);
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(SITE, "content.js"), "utf8"), ctx);
const posts = ctx.window.POSTS ?? [];
const pin = readFileSync(join(SITE, "files/tet-verify/pin.json"), "utf8");
const pinJ = JSON.parse(pin);
assert.equal(pinJ.chain_id, chain.chainId, "the devlog is pinned to another chain than this node's");
assert.equal(pinJ.genesis_hash, chain.genesisHash, "the devlog is pinned to another genesis than this node's");
const sigFiles = new Set(readdirSync(join(SITE, "sigs")));
// The site's own definitions (files/tet-verify/verify.mjs), so the content is derived the way the
// site derives it, not read back out of the sidecar.
const site = await import(join(SITE, "files/tet-verify/verify.mjs"));
const signed = posts.filter((p) => sigFiles.has(`${site.entryId(p)}.sig.json`));
console.log(`  ${posts.length} posts, ${signed.length} with a sidecar`);
assert.ok(signed.length > 0);

step("each signed entry: graded with the site's pin, without a manifest");
let n = 0;
for (const p of signed) {
  const envelope = JSON.parse(readFileSync(join(SITE, "sigs", `${site.entryId(p)}.sig.json`), "utf8"));
  const content = site.entryPayloadBytes(p);
  const r = await v.gradedVerdict({ content, envelope, pin, chain, nowMs: Date.now(), mldsa44Verify });
  const marks = r.steps.map((s) => ({ ok: "✓", failed: "✗", skipped: "–" })[s.status]).join(" ");
  console.log(`  ${marks}  level ${r.level}  ${p.date} ${String(p.title).slice(0, 50)}`);
  assert.equal(r.steps[0].status, "ok", r.steps[0].text);
  assert.equal(r.steps[1].status, "skipped");
  assert.equal(r.steps[2].status, "ok", r.steps[2].text);
  n++;
}
console.log(`  ${n} entries verified to level 3 (signature + pinned key; owner unknown, no manifest)`);

step("the same signature on an edited entry, on another chain, and against another pin");
const p0 = signed[signed.length - 1];
const env0 = JSON.parse(readFileSync(join(SITE, "sigs", `${site.entryId(p0)}.sig.json`), "utf8"));
const edited = site.entryPayloadBytes({ ...p0, body: `${p0.body} ` });
for (const [what, o] of [
  ["one space added to the body", { content: edited, chain }],
  ["checked on another chain", { content: site.entryPayloadBytes(p0), chain: { ...chain, chainId: "tet-testnet-1" } }],
]) {
  const r = await v.gradedVerdict({ ...o, envelope: env0, nowMs: Date.now(), mldsa44Verify });
  console.log(`  ${what}: level ${r.level}: ${r.steps[0].text}`);
  assert.equal(r.level, 0);
}
const wrongPin = await v.gradedVerdict({
  content: site.entryPayloadBytes(p0), envelope: env0, chain, nowMs: Date.now(), mldsa44Verify, pin: "ab".repeat(32),
});
console.log(`  another pin: level ${wrongPin.level}: ${wrongPin.steps[2].text}`);
assert.equal(wrongPin.level, 1);

console.log("\nall steps passed");
