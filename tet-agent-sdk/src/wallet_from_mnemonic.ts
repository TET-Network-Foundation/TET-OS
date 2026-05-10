import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, mnemonicValidate } from "@polkadot/util-crypto";
import { mldsa44KeypairFromMnemonic } from "./pqc_wasm.js";
import { walletIdHexFromPublicKey } from "./encoding.js";
import type { LoadedHybridWallet } from "./types.js";

/**
 * Same derivation as Sovereign OS `applyUnlockedHybridSessionFromMnemonic` (OsClient.tsx).
 */
export async function loadHybridWalletFromMnemonic(mnemonicNorm: string): Promise<LoadedHybridWallet> {
  await cryptoWaitReady();
  const phrase = mnemonicNorm.trim().toLowerCase().replace(/\s+/g, " ");
  if (!mnemonicValidate(phrase)) {
    throw new Error("invalid mnemonic");
  }
  const kr = new Keyring({ type: "ed25519", ss58Format: 42 });
  const edPair = kr.addFromMnemonic(phrase);
  const wid = walletIdHexFromPublicKey(edPair.publicKey).toLowerCase();
  const pqc = await mldsa44KeypairFromMnemonic(phrase);
  return {
    walletIdHex64: wid,
    edPair,
    displayAddress: edPair.address,
    mldsa44PubkeyB64: pqc.pubkey_b64,
    mldsa44KeypairB64: pqc.keypair_b64,
    signEd25519: (buf: Uint8Array) => edPair.sign(buf),
  };
}
