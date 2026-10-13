// The welcome grant, end to end, against a real node and the native prover (tet-core grants.rs).
// Not a CI step. Two steps with a restart, because grants are switched on by the node's settings:
//
//   1. A node WITHOUT grants that mines (TET_AUTO_MINE=1), then
//        TET_E2E_NODE=http://127.0.0.1:5040 node --experimental-strip-types scripts/try_grants_e2e.mjs fund
//      It makes a grant wallet, claims its testnet airdrop (1,000 TET, practice) and writes its words
//      to $TMPDIR/tet-grant.words.
//   2. Restart the node with TET_GRANT_MNEMONIC_FILE=$TMPDIR/tet-grant.words, then
//        TET_E2E_NODE=http://127.0.0.1:5040 node --experimental-strip-types scripts/try_grants_e2e.mjs run
//
// "run": a member registers, proves membership made out to the grant on day 0, and claims for their
// wallet: 202, and the wallet receives exactly 100 TET (practice) in a block. The same member's
// second claim, to another wallet, is refused (409, already claimed).

import { register } from "node:module";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
const BASE = process.env.TET_E2E_NODE || "http://127.0.0.1:5040";
const PROVER = process.env.TET_TRY_PROVER || "http://127.0.0.1:9945";
const chain = await (await fetch(`${BASE}/chain`)).json();
process.env.NEXT_PUBLIC_TET_CHAIN_ID = chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = chain.genesis_hash;
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { postInitialAirdropClaim } = await import("../app/lib/tet_core_http.ts");
const tb = await import("../app/lib/try_board.ts");
const gr = await import("../app/lib/grants.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const balance = async (w) => (await (await fetch(`${BASE}/ledger/balance/${w}`)).json()).balance_tet ?? 0;
const until = async (f, ms = 90_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return true;
    await sleep(2_000);
  }
  return false;
};

if (process.argv[2] === "fund") {
  const words = generateDisposableWords();
  const id = await activateTryWallet(words);
  const r = await postInitialAirdropClaim(BASE, id);
  assert.ok(r.ok, `airdrop: ${r.text}`);
  assert.ok(await until(async () => (await balance(id)) >= 1_000), "the airdrop wasn't mined");
  writeFileSync(join(tmpdir(), "tet-grant.words"), words + "\n", { mode: 0o600 });
  console.log(`grant wallet ${id.slice(0, 8)}… funded: ${await balance(id)} TET (practice)`);
  process.exit(0);
}

const status = await gr.grantsStatus(BASE);
assert.ok(status, "grants are off on this node");
console.log(`grants on: ${status.granted} of ${status.cap} granted, ${status.amountMicro / 1e6} TET (practice) each`);
const member = await activateTryWallet(generateDisposableWords());
console.log(`register: ${await tb.registerForAnon(BASE)}`);
await sleep(4_000); // the registry's next epoch
const before = await balance(member);
let t = Date.now();
const out = await gr.claimWelcome(BASE, PROVER, member, () => {});
console.log(`claim: ${out.state}${out.reason ? ` (${out.reason})` : ""} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
assert.equal(out.state, "granted");
assert.ok(await until(async () => (await balance(member)) >= before + 100), "the grant wasn't mined");
console.log(`the member's wallet: ${before} → ${await balance(member)} TET (practice)`);
const other = generateDisposableWords();
const otherId = (await import("../app/lib/disposable_wallet.mjs")).walletIdFromWords(other);
const again = await gr.claimWelcome(BASE, PROVER, otherId, () => {});
console.log(`the same member again, to another wallet: ${again.state}${again.reason ? ` (${again.reason})` : ""}`);
assert.equal(again.state, "failed");
assert.match(again.reason, /already claimed/);
console.log("\nall passed");
process.exit(0);
