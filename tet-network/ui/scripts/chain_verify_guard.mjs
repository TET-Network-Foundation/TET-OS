// Verify without TET, Level 2 (app/lib/chain_verify.mjs), on a real export from a node
// (scripts/fixtures/chain_export_v1.json, made by try_chain_verify_e2e.mjs). The untouched export
// verifies; each tampering is caught with its own reason (each is a negative control).
import { register } from "node:module";
import assert from "node:assert/strict";
register("./lib/ts_hooks.mjs", import.meta.url);
import { readFileSync } from "node:fs";
const cv = await import("../app/lib/chain_verify.mjs");
const { sha256, ed25519Verify } = await import("../app/lib/offline_verify.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");

const exported = JSON.parse(readFileSync(new URL("./fixtures/chain_export_v1.json", import.meta.url), "utf8"));
const st = JSON.parse(readFileSync(new URL("./fixtures/chain_export_v1.stamp.json", import.meta.url), "utf8"));
const stamp = { txHash: st.txHash, fileId: st.fileId };
const chain = exported.chain;
const run = (e, over = {}) => cv.verifyChainExport({ exported: e, chain, stamp, sha256, ed25519Verify, mldsa44Verify, ...over });
const copy = () => JSON.parse(JSON.stringify(exported));

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n")[0]}`);
  }
};
const refused = async (e, re, over) => {
  const r = await run(e, over);
  assert.equal(r.ok, false, "accepted");
  assert.match(r.reason, re);
};
const si = (e) => e.blocks[0].tx_hashes.findIndex((h) => h === stamp.txHash);

await check("a real export verifies; the stamp is found with its confirmations", async () => {
  const r = await run(exported);
  assert.ok(r.ok, r.reason);
  assert.equal(r.stamp.height, exported.blocks[0].height);
  assert.equal(r.stamp.confirmations, exported.blocks.length - 1);
});
await check("control: a changed state root breaks the block id", async () => {
  const e = copy();
  e.blocks[1].state_root = "0x" + "11".repeat(32);
  await refused(e, /id doesn't match/);
});
await check("control: a block out of line (wrong parent) is caught", async () => {
  const e = copy();
  e.blocks.splice(1, 1);
  await refused(e, /doesn't follow/);
});
await check("control: a changed transaction no longer matches its hash", async () => {
  const e = copy();
  const t = e.blocks[0].txs[si(e)];
  t.tx_json = t.tx_json.replace(/"file_id":"/, '"file_id":"0');
  await refused(e, /doesn't match its hash/);
});
await check("control: a forged signature is caught", async () => {
  const e = copy();
  const t = e.blocks[0].txs[si(e)];
  t.ed25519_sig_b64 = t.ed25519_sig_b64.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  await refused(e, /signatures don't verify/);
});
await check("control: a different file's stamp doesn't count", async () => {
  await refused(exported, /different file/, { stamp: { ...stamp, fileId: "00000000-0000-0000-0000-000000000000" } });
});
await check("control: an export from another chain is refused", async () => {
  await refused(exported, /another chain/, { chain: { ...chain, genesisHash: "0x" + "22".repeat(32) } });
});
await check("control: a stamp not in the export is reported", async () => {
  await refused(exported, /isn't in this export/, { stamp: { ...stamp, txHash: "0x" + "33".repeat(32) } });
});
// The built offline CLI (public/verify/tet-verify.mjs) runs Level 2 the same way.
{
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "tet-l2-"));
  writeFileSync(join(dir, "x.sig.json"), Buffer.from(st.sig_json_b64, "base64"));
  writeFileSync(join(dir, "x.stamp.json"), JSON.stringify({ tx_hash: stamp.txHash, file_id: stamp.fileId }));
  const bad = copy();
  bad.blocks[1].state_root = "0x" + "11".repeat(32);
  writeFileSync(join(dir, "bad.json"), JSON.stringify(bad));
  const cli = (exp) => {
    try {
      return execFileSync("node", ["public/verify/tet-verify.mjs", join(dir, "x.sig.json"), "--chain", chain.chainId, chain.genesisHash, "--chain-export", exp, "--stamp", join(dir, "x.stamp.json")], { encoding: "utf8" });
    } catch (e) {
      return `${e.stdout ?? ""}exit ${e.status}`;
    }
  };
  await check("the offline CLI confirms the stamp in the export", () => assert.match(cli(new URL("./fixtures/chain_export_v1.json", import.meta.url).pathname), /STAMP \(Level 2\)\s+in block \d+/));
  await check("control: the offline CLI refuses a tampered export", () => assert.match(cli(join(dir, "bad.json")), /STAMP DOES NOT VERIFY: block \d+: its id doesn't match/));
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
