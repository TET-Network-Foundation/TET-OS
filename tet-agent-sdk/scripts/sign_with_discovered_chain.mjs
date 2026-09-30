/**
 * Sign a payload using ONLY the chain binding discovered from a node's `GET /chain`.
 *
 *   node scripts/sign_with_discovered_chain.mjs <baseUrl> <outDir>
 *
 * Deliberately reads no chain configuration from the environment, and asserts that neither
 * TET_CHAIN_ID nor TET_GENESIS_HASH is set: if either were, this could appear to work while actually
 * using a value it was handed rather than one it discovered, and the test above it would prove
 * nothing about discovery.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadHybridWalletFromMnemonic } from "../dist/wallet_from_mnemonic.js";
import { fetchChainBinding, signPayloadEnvelope } from "../dist/agent.js";

const [baseUrl, outDir] = process.argv.slice(2);
if (!baseUrl || !outDir) {
  console.error("usage: sign_with_discovered_chain.mjs <baseUrl> <outDir>");
  process.exit(2);
}
for (const k of ["TET_CHAIN_ID", "TET_GENESIS_HASH"]) {
  if (process.env[k]) {
    console.error(`${k} is set; this script must discover the binding, not be told it`);
    process.exit(2);
  }
}

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PAYLOAD_TYPE = "application/vnd.tet.devlog+json";
const PAYLOAD = Buffer.from(
  JSON.stringify({ date: "2026-09-30", project: "tet", title: "Signed against a discovered chain" }),
  "utf8",
);

const chain = await fetchChainBinding(baseUrl);
const wallet = await loadHybridWalletFromMnemonic(MNEMONIC);
const envelope = await signPayloadEnvelope(wallet, PAYLOAD_TYPE, new Uint8Array(PAYLOAD), chain);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "payload.bin"), PAYLOAD);
writeFileSync(join(outDir, "payload.bin.sig.json"), `${JSON.stringify(envelope, null, 2)}\n`);
writeFileSync(
  join(outDir, "discovered.json"),
  `${JSON.stringify({ chain_id: chain.chainId, genesis_hash: chain.genesisHash }, null, 2)}\n`,
);
console.log(`discovered chain_id=${chain.chainId} genesis_hash=${chain.genesisHash}`);
console.log(`signed ${PAYLOAD.length} bytes as ${PAYLOAD_TYPE}`);
