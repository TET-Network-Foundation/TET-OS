// Thread grants, end to end, against a real node (not a CI step):
//   TET_E2E_NODE=http://127.0.0.1:5040 node --experimental-strip-types scripts/try_thread_grants_e2e.mjs
// A node that mines. Makes a directory and a public board; thread 1 gets named replies from 3
// distinct people, thread 2 from 2. The rewarder (scripts/thread_grants.mjs) dry-run lists only
// thread 1; --pay refuses while the node has no vouched members (dry run only until vouching
// exists), and the starter receives nothing.
import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
register("./lib/ts_hooks.mjs", import.meta.url);
const BASE = process.env.TET_E2E_NODE || "http://127.0.0.1:5040";
const chain = await (await fetch(`${BASE}/chain`)).json();
process.env.NEXT_PUBLIC_TET_CHAIN_ID = chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = chain.genesis_hash;
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { postInitialAirdropClaim } = await import("../app/lib/tet_core_http.ts");
const tb = await import("../app/lib/try_board.ts");
const { encodeThreadPost, newThreadId } = await import("../app/lib/board_threads.mjs");
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
const dir = mkdtempSync(join(tmpdir(), "tet-thread-grants-"));

// The grant wallet: its testnet airdrop (1,000 TET, practice).
const grantWords = generateDisposableWords();
const grantId = await activateTryWallet(grantWords);
assert.ok((await postInitialAirdropClaim(BASE, grantId)).ok, "airdrop");
assert.ok(await until(async () => (await balance(grantId)) >= 1_000), "the airdrop wasn't mined");
writeFileSync(join(dir, "grant.words"), grantWords, { mode: 0o600 });

await activateTryWallet(generateDisposableWords());
const { board: directory } = await tb.createBoard(BASE, "Directory");
const { board, ownerWords } = await tb.createBoard(BASE, "Talk");
await tb.announceBoard(BASE, directory, board, ownerWords);

const starter = await activateTryWallet(generateDisposableWords());
const t1 = newThreadId();
const t2 = newThreadId();
await tb.postNamed(BASE, board, encodeThreadPost({ threadId: t1, title: "One", body: "opening" }));
await tb.postNamed(BASE, board, encodeThreadPost({ threadId: t2, title: "Two", body: "opening" }));
const repliers = [];
for (let i = 0; i < 3; i++) repliers.push(generateDisposableWords());
for (const [i, w] of repliers.entries()) {
  await activateTryWallet(w);
  await tb.postNamed(BASE, board, encodeThreadPost({ threadId: t1, body: `reply ${i}` }));
  if (i < 2) await tb.postNamed(BASE, board, encodeThreadPost({ threadId: t2, body: `reply ${i}` }));
}
console.log(`board ${board.boardWalletId.slice(0, 8)}…: thread 1 has 3 distinct repliers, thread 2 has 2`);

const env = { ...process.env, TET_NODE: BASE, TET_DIRECTORY_INVITE: directory.invite, TET_THREAD_GRANT_WORDS: join(dir, "grant.words"), TET_THREAD_GRANT_STATE: join(dir, "state.json") };
const run = (...a) => {
  try {
    return execFileSync("node", ["--experimental-strip-types", "scripts/thread_grants.mjs", ...a], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return `${e.stdout ?? ""}exit ${e.status}`;
  }
};
const dry = run();
console.log(dry.trim().split("\n").map((l) => `  dry: ${l}`).join("\n"));
assert.match(dry, new RegExp(`would grant ${board.boardWalletId}:${t1} `), "thread 1 is granted");
assert.doesNotMatch(dry, new RegExp(`grant ${board.boardWalletId}:${t2} `), "thread 2 (2 people) is not");

const before = await balance(starter);
const paid = run("--pay");
assert.match(paid, /not paying: thread grants pay only once vouching exists/, "--pay must refuse without vouched members");
assert.match(paid, /exit 2$/);
await sleep(8_000);
assert.equal(await balance(starter), before, "nothing was paid");
console.log("--pay refused without vouched members; the starter received nothing\nall passed");
