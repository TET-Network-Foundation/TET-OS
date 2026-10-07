// Try TET public boards, end to end against a real node: the directory lists a board only when the
// board's own wallet signed the announcement. The page's own modules, through the page's
// `/tet-node-api` proxy to a tet-core in public mode. Not a CI step (needs a running node and UI);
// the PR records it.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3100 TET_DIRECTORY_INVITE=<invite> \
//     node --experimental-strip-types scripts/try_directory_e2e.mjs
//
//   1. A visitor (their own wallet) announces an invite-only board they hold the invite to:
//      the directory does not list it.
//   2. An anonymous-looking attempt is not possible from a wallet-less tab, and anonymous posts are
//      ignored by the parser (the guard covers that); here: a named post with a forged sender field
//      in the JSON is ignored too.
//   3. The board's own wallet announces it: listed, with its name.

import { register } from "node:module";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3100").replace(/\/+$/, "");
const DIRECTORY_INVITE = process.env.TET_DIRECTORY_INVITE || "";
if (!DIRECTORY_INVITE) throw new Error("set TET_DIRECTORY_INVITE");
const BASE = "/tet-node-api";
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => realFetch(String(input).startsWith("/") ? ORIGIN + String(input) : input, init);
console.error = () => {};

const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const tb = await import("../app/lib/try_board.ts");
const { encodeAnnouncement } = await import("../app/lib/board_directory.mjs");

let failed = 0;
const step = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

const directory = await tb.openBoard(BASE, DIRECTORY_INVITE);
const run = Date.now().toString(36).slice(-5);
const { board, ownerWords } = await tb.createBoard(BASE, `e2e listed ${run}`);
const visitor = await activateTryWallet(generateDisposableWords());

// 1. The visitor announces the board (they hold its invite, not its wallet).
await tb.postNamed(BASE, directory, encodeAnnouncement(board.invite, Date.now()));
// 2. And a JSON body naming the board as the sender, which the parser must ignore (the sender is
//    the node's, not the body's).
await tb.postNamed(BASE, directory, JSON.stringify({ kind: "tet_board_announce_v1", invite: board.invite, announced_at_ms: Date.now(), sender: board.boardWalletId }));
let listed = (await tb.readDirectory(BASE, directory)).some((l) => l.boardWalletId === board.boardWalletId);
step("SECURITY: a board announced by another wallet (with its valid invite) is not listed", !listed, `visitor ${visitor.slice(0, 8)}`);

// 3. The board's own wallet announces it.
await tb.announceBoard(BASE, directory, board, ownerWords);
const after = await tb.readDirectory(BASE, directory);
const mine = after.find((l) => l.boardWalletId === board.boardWalletId);
step("the board's own wallet lists it, with its name", mine?.name === `e2e listed ${run}`, mine ? mine.name : "not listed");
// The tab's own wallet is back after the announcement.
const { getHybridSignerSession } = await import("../app/lib/hybrid_signer_session.ts");
step("the tab's wallet is restored after announcing", getHybridSignerSession()?.walletIdHex64 === visitor);
// Opening the listing checks its keys against the node.
const opened = await tb.openBoard(BASE, mine?.invite ?? "");
step("the listing opens and its keys match the node", opened.boardWalletId === board.boardWalletId);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
