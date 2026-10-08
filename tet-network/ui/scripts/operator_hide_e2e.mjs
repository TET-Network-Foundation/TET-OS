// Operator hide, end to end against a real node: hide one thread (by its posts' msg_ids, found with
// the board's invite on this machine), then the whole board. Not a CI step: it needs a running node
// with TET_ADMIN_API_KEY and its REST on loopback. The PR records the run.
//
//   TET_NODE=http://127.0.0.1:5010 TET_ADMIN_API_KEY=… TET_OPERATOR_LOG=<node's log path> \
//     node --experimental-strip-types scripts/operator_hide_e2e.mjs

import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const NODE = (process.env.TET_NODE || "http://127.0.0.1:5010").replace(/\/+$/, "");
const KEY = process.env.TET_ADMIN_API_KEY || "";
const LOG = process.env.TET_OPERATOR_LOG || "";
if (!KEY || !LOG) throw new Error("set TET_ADMIN_API_KEY and TET_OPERATOR_LOG");
const out = console.log;
console.error = () => {};
console.log = () => {};

const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const tb = await import("../app/lib/try_board.ts");
const { encodeThreadPost, newThreadId } = await import("../app/lib/board_threads.mjs");

let failed = 0;
const step = (name, ok, detail = "") => {
  out(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const operator = async (path, body) => {
  const r = await fetch(`${NODE}/operator/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.status;
};

const run = Date.now().toString(36).slice(-5);
const { board } = await tb.createBoard(NODE, `hide e2e ${run}`);
await activateTryWallet(generateDisposableWords());
const keep = newThreadId();
const gone = newThreadId();
for (const [id, title] of [[keep, "stays"], [gone, "reported"]]) {
  await tb.postNamed(NODE, board, encodeThreadPost({ threadId: id, title, body: `opening post of ${title}` }));
  await tb.postNamed(NODE, board, encodeThreadPost({ threadId: id, body: `a reply in ${title}` }));
}

// The operator's helper, as the operator runs it: the invite stays on this machine.
const helper = (args) =>
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/operator_thread_ids.mjs", board.invite, ...args], {
    env: { ...process.env, TET_NODE: NODE },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
const listing = helper([]);
step("the helper lists both threads", listing.includes(keep) && listing.includes(gone));
const ids = helper([gone]).trim().split("\n").filter(Boolean);
step("the helper gives the reported thread's two post ids", ids.length === 2, ids.join(", "));

for (const id of ids) step(`hide msg ${id}`, (await operator("hide", { kind: "msg", id, reason: `e2e report ${run}` })) === 200);
const after = helper([]);
step("the reported thread is no longer served; the other one is", !after.includes(gone) && after.includes(keep));

step("hide the board wallet", (await operator("hide", { kind: "wallet", id: board.boardWalletId, reason: `e2e board report ${run}` })) === 200);
let refused = "";
try {
  await tb.readBoard(NODE, board);
} catch (e) {
  refused = e instanceof Error ? e.message : String(e);
}
step("the page's board read says the operator hid it", refused === tb.HIDDEN_BOARD, refused.slice(0, 60));

const log = readFileSync(LOG, "utf8");
step("every hide is in the operator log", ids.every((id) => log.includes(id)) && log.includes(board.boardWalletId));
out(`\ninvite (for a screenshot of the hidden board): ${board.invite}`);
out(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
