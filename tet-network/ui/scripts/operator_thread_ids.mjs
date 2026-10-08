// Operator helper: a thread's post ids, for hiding the thread with deploy/operator-hide.sh.
//
// Runs on the operator's own machine. The board is opened with its invite here; the node only ever
// sees a read of the board wallet's inbox (the same public route the page uses), never the invite
// or the board's keys.
//
//   TET_NODE=https://try.stevenexus.org/tet-node-api \
//     node --experimental-strip-types scripts/operator_thread_ids.mjs '<invite>'            # list threads
//   TET_NODE=… node --experimental-strip-types scripts/operator_thread_ids.mjs '<invite>' <thread id>
//
// The second form prints one msg_id per line; hide each with:
//   deploy/operator-hide.sh hide msg <msg_id> "<reason>"

import { register } from "node:module";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const [invite, threadId] = process.argv.slice(2);
const base = (process.env.TET_NODE || "").replace(/\/+$/, "");
if (!invite || !base) {
  console.error("usage: TET_NODE=<node api base> node --experimental-strip-types scripts/operator_thread_ids.mjs '<invite>' [thread id]");
  process.exit(2);
}
const log = console.log;
console.error = () => {};
console.log = () => {};

const { openBoard, readBoard } = await import("../app/lib/try_board.ts");
const { groupThreads } = await import("../app/lib/board_threads.mjs");

const board = await openBoard(base, invite);
const posts = (await readBoard(base, board, 200)).filter((p) => p.state === "open");
const threads = groupThreads(posts);

if (!threadId) {
  log(`board ${board.boardWalletId} (hide the whole board: operator-hide.sh hide wallet ${board.boardWalletId} "<reason>")`);
  for (const t of threads) log(`${t.threadId || "(no thread)"}\t${t.count} posts\t${t.title ?? ""}`);
  process.exit(0);
}
const t = threads.find((x) => x.threadId === threadId.trim().toLowerCase());
if (!t) {
  console.warn(`no thread ${threadId} among the board's newest 200 posts`);
  process.exit(1);
}
for (const p of t.posts) log(p.msgId);
