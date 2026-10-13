// The "Try TET" disposable wallet (docs/DEMO_NODE.md, part 0c).
//
// A fresh BIP39 phrase made in this tab, and the wallet id it implies. Plain ESM so
// `scripts/try_wallet_guard.mjs` can prove, under Node, the two promises the page makes:
//   - nothing here touches the network: the phrase is never sent anywhere, not even to our node
//     (tet-core's server-side `/wallet/mnemonic/*` routes are deliberately not reachable on the demo);
//   - nothing here persists: no localStorage, sessionStorage, IndexedDB or cookies. Close the tab and
//     the wallet is gone unless the visitor downloaded the words.
// Key derivation for signing and messaging happens in `try_session.ts`, from the same phrase, with
// the same functions the desktop uses.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";

ed.hashes.sha512 = (m) => new Uint8Array(sha512(m));

/** A new 12-word phrase (128 bits of entropy from the platform CSPRNG). */
export function generateDisposableWords() {
  return generateMnemonic(wordlist, 128);
}

/** @param {string} words */
export function normalizeWords(words) {
  return String(words).trim().toLowerCase().replace(/\s+/g, " ");
}

/** @param {string} words */
export function wordsAreValid(words) {
  return validateMnemonic(normalizeWords(words), wordlist);
}

/**
 * The wallet id (64-hex Ed25519 public key) for a phrase: BIP39 seed[0..32] as the Ed25519 secret,
 * exactly as tet-core's `wallet::signing_key_from_mnemonic` and the desktop's `ed25519_tet.ts`.
 * @param {string} words
 */
export function walletIdFromWords(words) {
  const norm = normalizeWords(words);
  if (!validateMnemonic(norm, wordlist)) throw new Error("not a valid 12-word phrase");
  const sk = mnemonicToSeedSync(norm, "").subarray(0, 32);
  const pk = ed.getPublicKey(sk);
  return Array.from(pk, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The text of the "download your words" file. The phrase is the whole wallet; the file says so.
 * @param {string} words
 * @param {string} walletId
 */
export function wordsFileText(words, walletId) {
  return [
    "TET testnet — disposable wallet from the Try TET page",
    "",
    "These 12 words ARE the wallet. Anyone holding them controls it.",
    "Testnet only: it holds no real value.",
    "Lose your passphrase (12 words) and nobody can recover it.",
    "TET asks for your passphrase (12 words) only on the restore screen; support never DMs you.",
    "On a device managed by your school or employer, the admin can see everything.",
    "",
    `words:     ${normalizeWords(words)}`,
    `wallet id: ${walletId}`,
    "",
  ].join("\n");
}
