#!/usr/bin/env node
/**
 * Guard: the UI's genesis binding (app/lib/chain_binding.ts, the copy the browser signs with) computes
 * the same genesis hashes as tet-core (src/genesis.rs).
 *
 *   cd tet-network/ui && node --experimental-strip-types scripts/verify-genesis-hash.mjs
 *
 * It imports the shipped module, not a replica, and reads the vectors and dev constants out of
 * genesis.rs, so neither side can move without the other:
 *   0. the dev founder is genesis.rs GENESIS_FOUNDER_DEV_PUBLIC_HEX;
 *   1. with no NEXT_PUBLIC_TET_CHAIN_ID, publicChainId() is genesis.rs DEV_CHAIN_ID;
 *   2. the dev default (DEV_CHAIN_ID, dev founder, dev treasury) hashes to the vector that
 *      `a_fresh_dev_node_is_clearly_local_and_not_the_old_public_chain` pins, and carries `|dev=1`;
 *   3. the legacy public chain (LEGACY_PUBLIC_CHAIN_ID, same keys) hashes to OLD_PUBLIC_GENESIS, the
 *      hash paper marks, the devlog pin and the offline verifier name, with no marker;
 *   4. any other named chain carries no marker.
 */
import { readFileSync } from "node:fs";

const RUST = readFileSync(new URL("../../../tet-core/src/genesis.rs", import.meta.url), "utf8");
function rust(re, what) {
  const m = RUST.match(re);
  if (!m) {
    console.error(`FAIL: could not find ${what} in tet-core/src/genesis.rs`);
    process.exit(1);
  }
  return m[1];
}
const R_DEV_CHAIN_ID = rust(/pub const DEV_CHAIN_ID: &str = "([^"]+)";/, "DEV_CHAIN_ID");
const R_LEGACY_CHAIN_ID = rust(/pub const LEGACY_PUBLIC_CHAIN_ID: &str = "([^"]+)";/, "LEGACY_PUBLIC_CHAIN_ID");
const R_TREASURY_DEV = rust(/pub const TREASURY_DEV_HEX: &str = "([0-9a-f]{64})";/, "TREASURY_DEV_HEX");
const R_FOUNDER_DEV = rust(/pub const GENESIS_FOUNDER_DEV_PUBLIC_HEX: &str =\s*"([0-9a-f]{64})";/, "GENESIS_FOUNDER_DEV_PUBLIC_HEX");
const R_OLD_PUBLIC = rust(/const OLD_PUBLIC_GENESIS: &str = "(0x[0-9a-f]{64})";/, "OLD_PUBLIC_GENESIS");
const R_DEV_VECTOR = rust(
  /fn a_fresh_dev_node_is_clearly_local_and_not_the_old_public_chain\(\)[\s\S]*?assert_eq!\(h, "(0x[0-9a-f]{64})"\)/,
  "the dev golden vector",
);

delete process.env.NEXT_PUBLIC_TET_CHAIN_ID;
delete process.env.NEXT_PUBLIC_TET_MAINNET;
const cb = await import("../app/lib/chain_binding.ts");

let failed = 0;
function check(ok, msg) {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failed++;
}

const dev = { founderWalletId: cb.GENESIS_FOUNDER_DEV_PUBLIC_HEX, treasuryWalletId: R_TREASURY_DEV };

check(cb.GENESIS_FOUNDER_DEV_PUBLIC_HEX === R_FOUNDER_DEV, `the dev founder is the same on both sides (Rust ${R_FOUNDER_DEV}, UI ${cb.GENESIS_FOUNDER_DEV_PUBLIC_HEX})`);
check(cb.DEV_CHAIN_ID === R_DEV_CHAIN_ID, `DEV_CHAIN_ID is ${R_DEV_CHAIN_ID} on both sides (UI: ${cb.DEV_CHAIN_ID})`);
check(cb.publicChainId() === R_DEV_CHAIN_ID, `no NEXT_PUBLIC_TET_CHAIN_ID -> ${R_DEV_CHAIN_ID} (UI: ${cb.publicChainId()})`);

const devPayload = cb.buildGenesisPayloadV1({ chainId: cb.publicChainId(), ...dev });
const devHash = await cb.deterministicGenesisHashHex({ chainId: cb.publicChainId(), ...dev });
check(devPayload.endsWith("|dev=1"), "the dev default's payload ends in |dev=1");
check(devHash === R_DEV_VECTOR, `dev default hashes to the Rust vector ${R_DEV_VECTOR} (UI: ${devHash})`);
check(devHash !== R_OLD_PUBLIC, "a fresh dev build does not compute the old public chain's genesis");

const legacyPayload = cb.buildGenesisPayloadV1({ chainId: R_LEGACY_CHAIN_ID, ...dev });
const legacyHash = await cb.deterministicGenesisHashHex({ chainId: R_LEGACY_CHAIN_ID, ...dev });
check(!legacyPayload.includes("dev=1"), `${R_LEGACY_CHAIN_ID} carries no marker`);
check(legacyHash === R_OLD_PUBLIC, `${R_LEGACY_CHAIN_ID} hashes to OLD_PUBLIC_GENESIS ${R_OLD_PUBLIC} (UI: ${legacyHash})`);

const named = cb.buildGenesisPayloadV1({ chainId: "tet-testnet-2", founderWalletId: "11".repeat(32), treasuryWalletId: "22".repeat(32) });
check(!named.includes("dev=1"), "a named public chain carries no marker");

if (failed) {
  console.error(`verify-genesis-hash: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("verify-genesis-hash: the UI genesis binding matches tet-core");
