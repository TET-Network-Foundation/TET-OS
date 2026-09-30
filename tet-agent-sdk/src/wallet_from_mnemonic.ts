/**
 * Hybrid wallet from a BIP39 mnemonic — the SAME derivation the node, the browser wallet and the
 * Sovereign OS UI use.
 *
 *   Ed25519 secret : BIP39 `to_seed("")[0..32]`
 *                    (`tet-core/src/wallet.rs` `signing_key_from_mnemonic`,
 *                     `tet-network/ui/app/lib/ed25519_tet.ts` `tetSecretKey32FromMnemonic`)
 *   ML-DSA-44      : HKDF-SHA256(seed, info = "tet:pqc:mldsa44-seed:v1") via tet-pqc-wasm
 *
 * Until 2026-09-30 this file derived Ed25519 with `@polkadot/keyring`'s
 * `addFromMnemonic`, which is NOT BIP39: substrate runs PBKDF2 over the mnemonic *entropy* with
 * salt "mnemonic" and takes 32 bytes of that (`substrate-bip39` mini-secret), while BIP39 runs
 * PBKDF2 over the mnemonic *phrase*. Measured on the standard 12-word vector, the same mnemonic
 * gave wallet id 9125f505… under polkadot and c5785e18… everywhere else in TET.
 *
 * Nothing rejected it, which is why it survived: the Ed25519 half was self-consistent, the ML-DSA
 * half came from the wasm and so was already correct, and `mldsa_pk` is inside every pre-image, so
 * `verify_hybrid` passed. The agent simply acted as a wallet its owner could not open in the UI
 * with the same phrase — one identity whose two halves belonged to two different wallets.
 */
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

import { mldsa44KeypairFromMnemonic } from "./pqc_wasm.js";
import { walletIdHexFromPublicKey } from "./encoding.js";
import type { LoadedHybridWallet } from "./types.js";

// @noble/ed25519 v2 needs sync SHA-512 injected, and different builds look for it on `etc` vs
// `utils`. Set both, exactly as `tet-core/scripts/wallet_client_entry.mjs` does.
const sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
  const concat =
    ((ed as never as { etc?: { concatBytes?: (...m: Uint8Array[]) => Uint8Array } }).etc
      ?.concatBytes) ??
    ((ed as never as { utils?: { concatBytes?: (...m: Uint8Array[]) => Uint8Array } }).utils
      ?.concatBytes);
  const msg = concat ? concat(...messages) : messages[0]!;
  return sha512(msg);
};
const edEtc = (ed as never as { etc?: Record<string, unknown> }).etc;
const edUtils = (ed as never as { utils?: Record<string, unknown> }).utils;
if (edEtc) edEtc.sha512Sync = sha512Sync;
if (edUtils) edUtils.sha512Sync = sha512Sync;

export function normalizeMnemonicPhrase(phrase: string): string {
  return String(phrase ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function loadHybridWalletFromMnemonic(mnemonicNorm: string): Promise<LoadedHybridWallet> {
  const phrase = normalizeMnemonicPhrase(mnemonicNorm);
  if (!validateMnemonic(phrase, wordlist)) {
    throw new Error("invalid mnemonic");
  }
  const sk32 = mnemonicToSeedSync(phrase, "").subarray(0, 32);
  const wid = walletIdHexFromPublicKey(ed.getPublicKey(sk32)).toLowerCase();
  const pqc = await mldsa44KeypairFromMnemonic(phrase);
  return {
    walletIdHex64: wid,
    displayAddress: `${wid.slice(0, 10)}…${wid.slice(-6)}`,
    mldsa44PubkeyB64: pqc.pubkey_b64,
    mldsa44KeypairB64: pqc.keypair_b64,
    signEd25519: (buf: Uint8Array) => ed.sign(buf, sk32),
  };
}
