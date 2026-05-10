import type { UnlockedVault } from "./pin_vault";
import { bytesToB64 } from "./encoding";

export type SessionWallet = {
  walletIdHex: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
};

export function walletFromUnlockedVault(v: UnlockedVault): SessionWallet {
  return { walletIdHex: v.walletIdHex, publicKey: v.publicKey, privateKey: v.privateKey };
}

export async function signPromptPlusNonce(wallet: SessionWallet, prompt: string, nonce: number): Promise<string> {
  const msg = new TextEncoder().encode(`${prompt}${nonce}`);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, wallet.privateKey, msg);
  return bytesToB64(new Uint8Array(sig));
}
