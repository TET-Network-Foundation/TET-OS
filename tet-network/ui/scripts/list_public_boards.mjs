// Pre-launch: list the boards in this node's public directory (name, board wallet, when listed), so
// the operator can hide the test ones before the demo goes public (deploy/demo/README.md §10).
//
//   TET_TRY_ORIGIN=https://<demo host> NEXT_PUBLIC_TET_DIRECTORY_INVITE=<invite> \
//     node --experimental-strip-types scripts/list_public_boards.mjs
//
// Read-only: it reads the directory the same way the page does. Hiding is the operator's command,
// run on the host: deploy/operator-hide.sh hide wallet <board wallet> "test board before launch".

import { register } from "node:module";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const realFetch = globalThis.fetch;
globalThis.fetch = (i, o = {}) => realFetch(String(i).startsWith("/") ? ORIGIN + String(i) : String(i), o);
const tb = await import("../app/lib/try_board.ts");
const invite = (process.env.NEXT_PUBLIC_TET_DIRECTORY_INVITE ?? "").trim();
if (!invite) {
  console.error("Set NEXT_PUBLIC_TET_DIRECTORY_INVITE to the node's directory invite.");
  process.exit(2);
}
const dir = await tb.openBoard("/tet-node-api", invite);
const listings = await tb.readDirectory("/tet-node-api", dir);
console.log(`${listings.length} public boards on ${ORIGIN}:\n`);
for (const l of listings) console.log(`${new Date(l.listedAtMs).toISOString().slice(0, 16)}  ${l.boardWalletId}  ${l.name}`);
console.log("\nTo hide one before launch (on the host): deploy/operator-hide.sh hide wallet <board wallet> \"test board before launch\"");
