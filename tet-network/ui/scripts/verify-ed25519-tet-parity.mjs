#!/usr/bin/env node
/**
 * Cross-check: UI ed25519_tet derivation vs tet-core wallet_client (same as wallet.rs L42-46).
 * Run: cd tet-network/ui && npm run verify:ed25519
 */
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { tetWalletIdFromMnemonic } from "../../../tet-core/scripts/wallet_client_entry.mjs";

ed.hashes.sha512 = sha512;
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m));

function uiWalletIdFromMnemonic(mnemonic) {
  const norm = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(norm, wordlist)) throw new Error("invalid mnemonic");
  const seed = mnemonicToSeedSync(norm, "");
  const sk = seed.subarray(0, 32);
  const pub = ed.getPublicKey(sk);
  let hex = "";
  for (let i = 0; i < pub.length; i++) hex += pub[i].toString(16).padStart(2, "0");
  return hex;
}

const GENESIS_FOUNDER_DEV =
  "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";

const samples = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  process.argv[2],
].filter(Boolean);

console.log("=== ed25519_tet parity (UI logic vs tet-core wallet_client) ===\n");
console.log("tet-core GENESIS_FOUNDER_DEV_PUBLIC_HEX:", GENESIS_FOUNDER_DEV);
console.log("(founder mnemonic is private — match 57e0… only when you pass it as argv[2])\n");

let ok = true;
for (const phrase of samples) {
  const ui = uiWalletIdFromMnemonic(phrase);
  const core = tetWalletIdFromMnemonic(phrase);
  const match = ui === core;
  if (!match) ok = false;
  console.log(`mnemonic: ${phrase.slice(0, 36)}…`);
  console.log(`  ui wallet_id:   ${ui}`);
  console.log(`  core wallet_id: ${core}`);
  console.log(`  match: ${match}\n`);
}

if (!ok) {
  console.error("FAIL: wallet_id mismatch");
  process.exit(1);
}
console.log("OK: UI ed25519 derivation matches tet-core wallet_client (BIP39 seed[0..32])");
