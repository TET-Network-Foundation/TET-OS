// Thread grants, the operator's rewarder (docs/plans/TESTNET_REWARDS.md §2). Reads the public
// boards listed in the directory, as any visitor can, decides with app/lib/thread_grants.mjs, and
// (with --pay) pays each grant from a separate grant wallet by an ordinary signed transfer.
// Grants are in a practice unit that can't be exchanged for money.
//
//   TET_NODE=http://127.0.0.1:5010 TET_DIRECTORY_INVITE='<directory invite>' \
//   TET_THREAD_GRANT_WORDS=~/.tet/thread-grants.words \
//     node --experimental-strip-types scripts/thread_grants.mjs [--pay]
//
// Without --pay it only prints what it would grant. With --pay it still refuses until the node has
// vouched members (Shelter): until then the rewarder is dry-run only. The node only sees public inbox reads (and, with
// --pay, the transfers). Named posts count only when their signature checks here; anonymous posts
// count by daily ID. State (what was granted, today's totals) and one log line per grant (board,
// thread, number of counted repliers, amount; never post content) go to TET_THREAD_GRANT_STATE
// (default ~/.tet/thread-grants-state.json).

import { register } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const BASE = (process.env.TET_NODE || "http://127.0.0.1:5010").replace(/\/+$/, "");
const PAY = process.argv.includes("--pay");
const expand = (p) => p.replace(/^~(?=\/)/, homedir());
const STATE = expand(process.env.TET_THREAD_GRANT_STATE || "~/.tet/thread-grants-state.json");
const LOG = STATE.replace(/\.json$/, ".log");
const DAY = new Date().toISOString().slice(0, 10);

const tg = await import("../app/lib/thread_grants.mjs");
const { openBoard, readBoard, readDirectory } = await import("../app/lib/try_board.ts");
const { getTmailInbox } = await import("../app/lib/tet_core_http.ts");
const { verifyEnvelopeSender } = await import("../app/lib/key_trust.ts");
const { groupThreads } = await import("../app/lib/board_threads.mjs");

const invite = process.env.TET_DIRECTORY_INVITE;
if (!invite) throw new Error("set TET_DIRECTORY_INVITE (the public directory's invite)");

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { granted: {}, days: {} };
const today = (state.days[DAY] ??= { person: {}, network: 0 });

// Halving uses vouched members (Shelter). Until Shelter is live on this node, 0: the full grant.
let vouched = 0;
try {
  const r = await fetch(`${BASE}/shelter/status`);
  if (r.ok) vouched = Number((await r.json()).members ?? 0) || 0;
} catch {
  /* no Shelter here */
}

const directory = await openBoard(BASE, invite);
const listings = await readDirectory(BASE, directory);
const threads = [];
for (const l of listings) {
  const board = await openBoard(BASE, l.invite);
  // Who signed each named post, checked here (never the sender the node reports).
  const raw = await getTmailInbox(BASE, board.boardWalletId, 500);
  const signer = new Map();
  for (const row of raw.ok ? raw.messages : []) {
    if (row.flags?.anonymous) continue;
    if ((await verifyEnvelopeSender(row, BASE)) === "verified") signer.set(row.msg_id, row.sender_wallet_id.trim().toLowerCase());
  }
  const posts = (await readBoard(BASE, board, 500)).filter((p) => p.state === "open");
  for (const t of groupThreads(posts)) {
    if (!t.threadId) continue;
    const who = (p) =>
      p.label.kind === "named"
        ? signer.has(p.msgId)
          ? { kind: "named", key: signer.get(p.msgId) }
          : null
        : p.label.dailyId
          ? { kind: "anonymous", key: p.label.dailyId }
          : null;
    const [first, ...rest] = t.posts;
    const s = who(first);
    if (!s) continue;
    threads.push({
      id: `${board.boardWalletId}:${t.threadId}`,
      board: board.boardWalletId,
      starter: { ...s, wallet: s.kind === "named" ? s.key : null },
      openedAtMs: first.sentAtMs,
      replies: rest.map((p) => ({ ...(who(p) ?? { kind: "none", key: "" }), atMs: p.sentAtMs })),
    });
  }
}

const decision = tg.decideThreadGrants({
  threads,
  nowMs: Date.now(),
  alreadyGranted: new Set(Object.keys(state.granted)),
  personToday: new Map(Object.entries(today.person)),
  networkTodayMicro: today.network,
  vouchedMembers: vouched,
});
const tet = (m) => `${(m / 1e6).toLocaleString("en", { maximumFractionDigits: 6 })} TET (practice unit, can't be exchanged for money)`;
console.log(`${listings.length} public boards, ${threads.length} threads; vouched members ${vouched}, grant ${tet(tg.grantMicro(vouched))}, next halving at ${tg.nextHalvingAt(vouched)}`);
for (const s of decision.skipped) console.log(`skip ${s.thread}: ${s.reason}`);
for (const g of decision.grants) console.log(`${PAY ? "grant" : "would grant"} ${g.thread} → ${g.wallet.slice(0, 8)}… ${tet(g.micro)} (${g.repliers} distinct repliers)`);
if (!PAY || decision.grants.length === 0) process.exit(0);
// Dry run only until vouching exists (founder decision 2026-10-11): with free wallets, "3 distinct
// repliers" can be one person. --pay refuses while the node reports no vouched members.
if (vouched === 0) {
  console.log("not paying: thread grants pay only once vouching exists (Shelter's vouched members); this was a dry run");
  process.exit(2);
}

const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { buildTransferEnvelope } = await import("../app/lib/transfer.ts");
const wordsPath = expand(process.env.TET_THREAD_GRANT_WORDS || "~/.tet/thread-grants.words");
const payer = await activateTryWallet(readFileSync(wordsPath, "utf8").trim());
mkdirSync(dirname(STATE), { recursive: true });
for (const g of decision.grants) {
  if (g.wallet === payer) continue;
  const env = await buildTransferEnvelope(payer, g.wallet, BigInt(tg.grossForNet(g.micro)), BASE, 100);
  const r = await fetch(`${BASE}/tx/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env) });
  if (!r.ok) {
    console.log(`refused ${g.thread}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    continue;
  }
  state.granted[g.thread] = { wallet: g.wallet, micro: g.micro, at: new Date().toISOString() };
  const p = (today.person[g.person] ??= { threads: 0, micro: 0 });
  p.threads += 1;
  p.micro += g.micro;
  today.network += g.micro;
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), board: g.board, thread: g.thread, repliers: g.repliers, micro: g.micro, to: g.wallet }) + "\n");
  console.log(`granted ${g.thread}`);
}
console.log(`state: ${STATE}\nlog: ${join(dirname(LOG), LOG.split("/").pop())}`);
