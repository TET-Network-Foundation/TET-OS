/**
 * Turn the Try TET disposable phrase into the in-memory sessions the panels sign and decrypt with:
 * the hybrid signer (Ed25519 + ML-DSA-44) and the Tmail key session (X25519 + Kyber, and the
 * anonymity-set member secret). The same derivations as the desktop's unlock
 * (`os/OsClient.tsx` applyUnlockedHybridSessionFromMnemonic), so a phrase from the try page opens
 * the same wallet in the desktop. Nothing is persisted; `forgetTryWallet` clears both sessions.
 */
import { mnemonicToSeedSync } from "@scure/bip39";
import { anonMemberSecretFromBip39Seed } from "./anon_tree.mjs";
import { mnemonicToTetEd25519Keypair, normalizeMnemonicPhrase, signTetEd25519 } from "./ed25519_tet";
import { setHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44KeypairFromMnemonic, pqcInit } from "./pqc";
import { deriveTmailKeysFromMnemonic } from "./tmail_keys";
import { setTmailKeySession } from "./tmail_session";
import { walletIdFromWords, wordsAreValid } from "./disposable_wallet.mjs";

export async function activateTryWallet(words: string): Promise<string> {
  const phrase = normalizeMnemonicPhrase(words);
  if (!wordsAreValid(phrase)) throw new Error("Not a valid 12-word phrase.");
  await pqcInit();
  const ed = mnemonicToTetEd25519Keypair(phrase);
  const wid = ed.walletIdHex.toLowerCase();
  if (wid !== walletIdFromWords(phrase)) {
    throw new Error("wallet id derivation disagrees between modules");
  }
  const pqc = await mldsa44KeypairFromMnemonic(phrase);
  setHybridSignerSession({
    walletIdHex64: wid,
    signEd25519: (buf) => signTetEd25519(ed.secretKey, buf),
    mldsa44_keypair_b64: pqc.keypair_b64,
    mldsa44_pubkey_b64: pqc.pubkey_b64,
    displayAddress: `${wid.slice(0, 10)}…${wid.slice(-6)}`,
  });
  const km = await deriveTmailKeysFromMnemonic(phrase);
  setTmailKeySession({
    walletIdHex64: wid,
    x25519_sk: km.x25519_sk,
    x25519_pub: km.x25519_pub,
    mlkem_sk: km.mlkem_sk,
    mlkem_pub: km.mlkem_pub,
    anonMemberSecret: anonMemberSecretFromBip39Seed(mnemonicToSeedSync(phrase, "")),
  });
  return wid;
}

export function forgetTryWallet(): void {
  setHybridSignerSession(null);
  setTmailKeySession(null);
}
