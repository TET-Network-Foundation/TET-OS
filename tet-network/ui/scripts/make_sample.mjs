// Mark the sample file (public/sample/tet-sample.txt) as genuine on a node, once, and print the proof
// code for NEXT_PUBLIC_TET_SAMPLE_CODE. The ID that marks it is made here and thrown away: nothing
// secret is written anywhere. Run it again on a new node (records belong to the node they're on).
//
//   TET_TRY_ORIGIN=https://<demo host> node --experimental-strip-types scripts/make_sample.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const realFetch = globalThis.fetch;
globalThis.fetch = (i, o = {}) => realFetch(String(i).startsWith("/") ? ORIGIN + String(i) : String(i), o);

const pc = await import("../app/lib/proof_code.ts");
const trySession = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { expectedChainBinding } = await import("../app/lib/chain_binding.ts");

const sample = new Uint8Array(readFileSync(new URL("../public/sample/tet-sample.txt", import.meta.url)));
await trySession.activateTryWallet(generateDisposableWords()); // a throwaway ID, never saved
const chain = await expectedChainBinding("/tet-node-api");
const rec = await pc.signFileHash(sample, chain);
const code = await pc.publishRecord("/tet-node-api", rec.bytes, chain);
console.log(`NEXT_PUBLIC_TET_SAMPLE_CODE=${code}`);
