#!/usr/bin/env node
/**
 * Debug Send Coins hybrid binding vs tet-core (no secrets required for message shape).
 * Usage:
 *   cd tet-network/ui
 *   NEXT_PUBLIC_TET_TREASURY_ADDRESS=... node scripts/debug-transfer-binding.mjs \
 *     --to 0000000000000000000000000000000000000000000000000000000000000002 \
 *     --amount-tet 1.00 --nonce 1
 */
import { createHash } from "node:crypto";

const FOUNDER = process.env.NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID?.trim() ||
  process.env.NEXT_PUBLIC_TET_FOUNDER_WALLET?.trim() ||
  "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";
const TREASURY = process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS?.trim() ||
  "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const CHAIN_ID = process.env.NEXT_PUBLIC_TET_CHAIN_ID?.trim() ||
  (process.env.NEXT_PUBLIC_TET_MAINNET === "1" ? "tet-mainnet-1" : "tet-local-dev");

function parseArgs() {
  const args = process.argv.slice(2);
  let to = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  let amountTet = "1.00";
  let nonce = "1";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--to" && args[i + 1]) to = args[++i];
    if (args[i] === "--amount-tet" && args[i + 1]) amountTet = args[++i];
    if (args[i] === "--nonce" && args[i + 1]) nonce = args[++i];
  }
  return { to, amountTet, nonce };
}

function sha256HexUtf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const STEVEMON = 1_000_000n;
const GENESIS_FOUNDER_SHARE_MICRO = 2_500_000_000n * STEVEMON;
const GENESIS_WORKER_POOL_SHARE_MICRO = 5_000_000_000n * STEVEMON;
const GENESIS_TREASURY_SHARE_MICRO = 2_500_000_000n * STEVEMON;
const MAX_SUPPLY_MICRO = 10_000_000_000n * STEVEMON;

function buildGenesisPayload(chainId, founder, treasury) {
  return (
    `tet-genesis-v1|chain_id=${chainId}|founder=${founder}|founder_micro=${GENESIS_FOUNDER_SHARE_MICRO}` +
    `|worker_pool=0000000000000000000000000000000000000000000000000000000000000001` +
    `|worker_pool_micro=${GENESIS_WORKER_POOL_SHARE_MICRO}|treasury=${treasury}` +
    `|treasury_micro=${GENESIS_TREASURY_SHARE_MICRO}|reserve=0000000000000000000000000000000000000000000000000000000000000003` +
    `|reserve_micro=0|max_supply_micro=${MAX_SUPPLY_MICRO}`
  );
}

function parseTet(s) {
  const m = String(s).trim().match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(8, "0") || "0");
  return whole * 1_000_000n + frac;
}

const { to, amountTet, nonce } = parseArgs();
const founder = FOUNDER.toLowerCase();
const treasury = TREASURY.toLowerCase();
const genesisPayload = buildGenesisPayload(CHAIN_ID, founder, treasury);
const genesisHash = `0x${sha256HexUtf8(genesisPayload)}`;
const amountMicro = parseTet(amountTet);
const amountMicroServer = Math.round(Number(amountMicro) / 1_000_000 * 1_000_000);
const mldsaPlaceholder = "<session-mldsa-pubkey-b64>";
const xferLine =
  `tet xfer hybrid v1|chain_id=${CHAIN_ID}|genesis_hash=${genesisHash}|${to.toLowerCase()}|` +
  `${amountMicro}|${nonce}|${mldsaPlaceholder}`;

console.log("=== debug-transfer-binding (UI logic reproduction) ===\n");
console.log(JSON.stringify({ chain_id: CHAIN_ID, founder_wallet: founder, treasury, genesis_hash: genesisHash }, null, 2));
console.log("\n--- genesis payload ---\n");
console.log(genesisPayload);
console.log("\n--- xfer hybrid line (ML-DSA pubkey placeholder) ---\n");
console.log(xferLine);
console.log("\n--- amount encoding ---\n");
console.log({ amount_tet_input: amountTet, amount_micro_signed: amountMicro.toString(), amount_micro_from_server_f64_round: String(amountMicroServer) });
console.log("\nCompare tet-core (same env as running node):");
console.log("  export TET_TREASURY_ADDRESS=" + treasury);
console.log("  # expected_genesis_hash_from_env() should equal genesis_hash above");
