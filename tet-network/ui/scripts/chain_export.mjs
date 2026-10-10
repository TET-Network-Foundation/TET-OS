// Export a stretch of the chain for "Verify without TET" Level 2: blocks from --from to the tip
// (or --to), each as GET /explorer/block/:height gives it.
//
//   node scripts/chain_export.mjs <node API> --from <height> [--to <height>] [--out export.json]
//   e.g. node scripts/chain_export.mjs https://tetnet.org/tet-node-api --from 123900
//
// The file holds public chain data only. Check it offline with the verifier (Level 2) or
// scripts/chain_verify_cli.mjs. It shows the copy holds together; to know it is the chain everyone
// else sees, compare its tip block id with other nodes (and, from Phase 1, producer signatures).
import { writeFileSync } from "node:fs";

const base = (process.argv[2] || "").replace(/\/+$/, "");
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!/^https?:\/\//.test(base) || !arg("--from")) throw new Error("usage: chain_export.mjs <node API> --from <height> [--to <height>] [--out file]");
const from = Number(arg("--from"));
const chain = await (await fetch(`${base}/chain`)).json();
const blocks = [];
for (let h = from; ; h++) {
  if (arg("--to") && h > Number(arg("--to"))) break;
  const r = await fetch(`${base}/explorer/block/${h}`);
  if (r.status === 404) break;
  if (!r.ok) throw new Error(`block ${h}: HTTP ${r.status}`);
  blocks.push(await r.json());
  if (blocks.length >= 10_000) break;
}
if (!blocks.length) throw new Error(`no block at ${from}`);
const out = { v: 1, kind: "tet-chain-export", chain: { chainId: chain.chain_id, genesisHash: chain.genesis_hash }, exported_at_ms: Date.now(), blocks };
const file = arg("--out") || `tet-chain-${from}-${blocks.at(-1).height}.json`;
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`${blocks.length} blocks (${from}–${blocks.at(-1).height}), tip ${blocks.at(-1).block_id} → ${file}`);
