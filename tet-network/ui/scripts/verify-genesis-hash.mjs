#!/usr/bin/env node
/**
 * Static cross-check: UI genesis payload + SHA-256 vs tet-core `deterministic_genesis_hash`.
 * Run from tet-network/ui: node scripts/verify-genesis-hash.mjs
 */
import { createHash } from "node:crypto";

const STEVEMON = 1_000_000n;
const MAX_SUPPLY_MICRO = 10_000_000_000n * STEVEMON;
const GENESIS_FOUNDER_SHARE_MICRO = 2_500_000_000n * STEVEMON;
const GENESIS_WORKER_POOL_SHARE_MICRO = 5_000_000_000n * STEVEMON;
const GENESIS_TREASURY_SHARE_MICRO = 2_500_000_000n * STEVEMON;
const GENESIS_PROTOCOL_RESERVE_SHARE_MICRO = 0n;
const WALLET_WORKER_POOL =
  "0000000000000000000000000000000000000000000000000000000000000001";
const WALLET_PROTOCOL_RESERVE =
  "0000000000000000000000000000000000000000000000000000000000000003";
const GENESIS_FOUNDER_DEV_PUBLIC_HEX =
  "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";
const TREASURY_DEV =
  "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

function buildGenesisPayloadV1({ chainId, founderWalletId, treasuryWalletId }) {
  const founder = founderWalletId.trim().toLowerCase();
  const treasury = treasuryWalletId.trim().toLowerCase();
  return (
    `tet-genesis-v1|chain_id=${chainId}` +
    `|founder=${founder}` +
    `|founder_micro=${GENESIS_FOUNDER_SHARE_MICRO}` +
    `|worker_pool=${WALLET_WORKER_POOL}` +
    `|worker_pool_micro=${GENESIS_WORKER_POOL_SHARE_MICRO}` +
    `|treasury=${treasury}` +
    `|treasury_micro=${GENESIS_TREASURY_SHARE_MICRO}` +
    `|reserve=${WALLET_PROTOCOL_RESERVE}` +
    `|reserve_micro=${GENESIS_PROTOCOL_RESERVE_SHARE_MICRO}` +
    `|max_supply_micro=${MAX_SUPPLY_MICRO}`
  );
}

function deterministicGenesisHashHex(inputs) {
  const payload = buildGenesisPayloadV1(inputs);
  const hex = createHash("sha256").update(payload, "utf8").digest("hex");
  return { payload, hash: `0x${hex}` };
}

const inputs = {
  chainId: "tet-local-dev",
  founderWalletId: GENESIS_FOUNDER_DEV_PUBLIC_HEX,
  treasuryWalletId: TREASURY_DEV,
};

const { payload, hash } = deterministicGenesisHashHex(inputs);

console.log("=== Genesis binding verify (dev defaults) ===\n");
console.log("inputs:", JSON.stringify(inputs, null, 2));
console.log("\n--- payload (UTF-8, must match tet-core format!()) ---\n");
console.log(payload);
console.log("\n--- SHA-256 → genesis_hash ---\n");
console.log(hash);
console.log(
  "\nCompare with tet-core:\n" +
    "  cd tet-core && cargo test --lib ledger:: -- --nocapture 2>/dev/null ||\n" +
    "  RUST_LOG=off cargo run --quiet --example …  # or startup log / fresh DB meta\n" +
    "\nManual: same TET_TREASURY_ADDRESS + founder + TET_CHAIN_ID on node, then:\n" +
    "  curl -s http://127.0.0.1:5010/status | jq .   # founder_wallet_id if set\n" +
    "  # genesis_hash is NOT in /ledger/me — see docs/RUNNING_A_NODE.md § UI\n",
);

// Golden vector: run `cd tet-core && cargo test genesis_hash_vector -- --exact` if added later.
const EXPECTED_PAYLOAD_PREFIX = "tet-genesis-v1|chain_id=tet-local-dev|founder=";
if (!payload.startsWith(EXPECTED_PAYLOAD_PREFIX)) {
  console.error("FAIL: unexpected payload prefix");
  process.exit(1);
}
if (!payload.includes("|treasury=") || payload.includes("|ecosystem=")) {
  console.error("FAIL: treasury field missing or legacy ecosystem field present");
  process.exit(1);
}
const GOLDEN_DEV =
  "0x9d6ccb1354b31419ade378aef68de58e854938df795b69cf76777e3483efbb36";
if (hash !== GOLDEN_DEV) {
  console.error(`FAIL: hash ${hash} !== golden ${GOLDEN_DEV}`);
  process.exit(1);
}

console.log("\nOK: payload uses treasury= (Phase 2B), not ecosystem= / system:worker_pool");
console.log("OK: SHA-256 matches dev golden vector (cross-checked with shasum -a 256)");
process.exit(0);
