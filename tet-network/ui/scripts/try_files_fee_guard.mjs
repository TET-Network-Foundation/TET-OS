// Guard for the try page's file fees (Try TET parts 2–3, docs/DEMO_NODE.md "File fees"). Runs the
// page's own `app/lib/files_fee.ts` against a recording fetch.
//
//   node --experimental-strip-types scripts/try_files_fee_guard.mjs
//
// SECURITY properties:
// 1. On the try page the visitor's wallet never pays: in "demo-sponsor" mode the only request is
//    one POST to /demo/files/sponsor-fee, never /files/fee, and no FileFee transaction is signed.
// 2. A refusal is final and says so: every reason ends as "unpaid" with the design's wording, after
//    exactly one request (no retry).
// 3. Every file fee on the try page is in "demo-sponsor" mode: each desktop Files panel and each
//    direct `settleFileFee` call (checked in the page's sources, with a control).

import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const fee = await import("../app/lib/files_fee.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");

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

const FOUNDER = "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";
let requests = [];
let answer = () => ({ status: 202, body: { ok: true, sponsored: true } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const path = new URL(url, "http://node.test").pathname;
  requests.push({ path, method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : "" });
  if (path.endsWith("/status")) return new Response(JSON.stringify({ founder_wallet_id: FOUNDER }), { status: 200 });
  const a = answer(path);
  if (a.throws) throw new TypeError("fetch failed");
  return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
};
console.error = () => {}; // tet_core_http logs every refusal; the guard reads the outcomes instead

const wallet = await activateTryWallet("legal winner thank year wave sausage worth useful legal winner thank yellow");
const base = {
  baseUrl: "/tet-node-api", // the page's own, relative base
  fileId: "6f1c2e8a-4b7d-4c3e-9a1f-2d5e8b7c0a91",
  senderWalletId: wallet,
  storageWallet: "storage-node",
};
const nodeRequests = () => requests.filter((r) => !r.path.endsWith("/status"));

await check("SECURITY: demo-sponsor mode asks the sponsor once and never pays from the visitor's wallet", async () => {
  requests = [];
  answer = () => ({ status: 202, body: { ok: true, sponsored: true } });
  const out = await fee.settleFileFee({ ...base, mode: "demo-sponsor" });
  assert.equal(out.state, "sponsored", out.text);
  const rs = nodeRequests();
  assert.deepEqual(rs.map((r) => `${r.method} ${r.path}`), ["POST /tet-node-api/demo/files/sponsor-fee"]);
  const body = JSON.parse(rs[0].body);
  assert.deepEqual(Object.keys(body).sort(), ["file_id", "hybrid_sig", "requested_at_ms", "sender_wallet_id"]);
  assert.equal(body.sender_wallet_id, wallet);
  assert.ok(!rs[0].body.includes("file_fee") && !rs[0].body.includes("fee_micro"), "a fee transaction was sent");
});

await check("SECURITY: every refusal is final, worded as the design says, after one request", async () => {
  const cases = [
    [429, "daily_cap_ip", /daily limit for your connection/],
    [429, "daily_cap_wallet", /daily limit for this wallet/],
    [429, "daily_cap_global", /daily limit for everyone/],
    [402, "sponsor_low", /sponsor wallet is low/],
    [404, "not_sponsorable", /can't be sponsored here/],
    [404, "no_sponsor", /no sponsor/],
  ];
  for (const [status, reason, re] of cases) {
    requests = [];
    answer = () => ({ status, body: { ok: false, reason } });
    const out = await fee.settleFileFee({ ...base, mode: "demo-sponsor" });
    assert.equal(out.state, "unpaid", reason);
    assert.equal(out.reason, reason);
    assert.match(out.text, /^Your file was delivered\. Its fee wasn't sponsored \(/, out.text);
    assert.match(out.text, /that doesn't affect the file\.$/);
    assert.match(out.text, re);
    assert.equal(nodeRequests().length, 1, `${reason}: ${nodeRequests().length} requests (a retry?)`);
    assert.ok(!nodeRequests().some((r) => r.path.endsWith("/files/fee")), `${reason}: fell back to paying`);
  }
  requests = [];
  answer = () => ({ status: 429, body: "rate limit exceeded for this address" });
  const limited = await fee.settleFileFee({ ...base, mode: "demo-sponsor" });
  assert.equal(limited.reason, "rate_limited", "the node's rate limit is named as such");
  assert.match(limited.text, /too many requests from your connection/);
  assert.equal(nodeRequests().length, 1, "retried after the rate limit");
  requests = [];
  answer = () => ({ throws: true });
  const out = await fee.settleFileFee({ ...base, mode: "demo-sponsor" });
  assert.equal(out.state, "unpaid");
  assert.equal(nodeRequests().length, 1, "retried after a network failure");
});

await check("the desktop's own mode still pays with the sender's wallet", async () => {
  requests = [];
  answer = () => ({ status: 202, body: { ok: true, file_id: base.fileId } });
  const out = await fee.settleFileFee({ ...base, mode: "self" });
  assert.equal(out.state, "paid", out.text);
  assert.deepEqual(nodeRequests().map((r) => r.path), ["/tet-node-api/files/fee"]);
  assert.equal(JSON.parse(nodeRequests()[0].body).tx.kind, "file_fee");
});

/**
 * Every way the try page can settle a file fee, checked in its sources: a desktop `<FilesPanel>` must
 * carry `feeMode="demo-sponsor"`, and every `settleFileFee(...)` call must pass a literal
 * `mode: "demo-sponsor"` (not a variable, not "self"). Returns the problems and how many fee sites
 * were found.
 */
function feeSites(sources) {
  const problems = [];
  let sites = 0;
  for (const [f, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/<FilesPanel\b[^>]*>/gs)) {
      sites++;
      if (!/feeMode="demo-sponsor"/.test(m[0])) problems.push(`${f}: a Files panel without feeMode="demo-sponsor"`);
    }
    for (const m of src.matchAll(/\bsettleFileFee\s*\(\s*\{([^}]*)\}/gs)) {
      sites++;
      if (!/\bmode\s*:\s*"demo-sponsor"/.test(m[1])) problems.push(`${f}: a settleFileFee call without mode: "demo-sponsor"`);
    }
    // A call that doesn't start with an object literal can't be checked: refuse it.
    for (const m of src.matchAll(/\bsettleFileFee\s*\(\s*(?!\{)/g)) problems.push(`${f}: settleFileFee called without a literal options object (at ${m.index})`);
  }
  return { problems, sites };
}

await check("SECURITY: every file fee on the try page goes through the demo's sponsor", () => {
  const dir = new URL("../app/try/", import.meta.url);
  const sources = Object.fromEntries(
    readdirSync(dir)
      .filter((n) => /\.tsx?$/.test(n))
      .map((n) => [n, readFileSync(new URL(n, dir), "utf8")]),
  );
  const { problems, sites } = feeSites(sources);
  assert.deepEqual(problems, []);
  assert.ok(sites >= 1, "no file-fee site found on the try page");
});

await check("control: the source check catches a self-paid fee, a variable mode and a bare panel", () => {
  const cases = {
    "self.tsx": `await settleFileFee({ mode: "self", baseUrl: BASE });`,
    "variable.tsx": `await settleFileFee({ mode, baseUrl: BASE });`,
    "spread.tsx": `await settleFileFee(opts);`,
    "panel.tsx": `<FilesPanel baseUrl={BASE} myWalletId={id} />`,
  };
  for (const [f, src] of Object.entries(cases)) {
    assert.ok(feeSites({ [f]: src }).problems.length >= 1, `${f} was not caught`);
  }
  assert.deepEqual(feeSites({ "ok.tsx": `await settleFileFee({ mode: "demo-sponsor", baseUrl: BASE });` }).problems, []);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
