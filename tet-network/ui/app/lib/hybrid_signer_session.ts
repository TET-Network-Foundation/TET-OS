/**
 * In-memory hybrid signer for `POST /ai/infer` (Ed25519 + ML-DSA), populated after the user unlocks a local wallet.
 * Never persist private material here — only hold for the current tab session.
 */

export type HybridSignerSession = {
  /** 32-byte Ed25519 public key as 64 lowercase hex (ledger `wallet_id`). */
  walletIdHex64: string;
  signEd25519: (msg: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  mldsa44_keypair_b64: string;
  mldsa44_pubkey_b64: string;
  /** SS58 or short display label */
  displayAddress: string;
};

let session: HybridSignerSession | null = null;

export function setHybridSignerSession(next: HybridSignerSession | null): void {
  session = next;
}

export function getHybridSignerSession(): HybridSignerSession | null {
  return session;
}

export function requireHybridSignerSession(): HybridSignerSession {
  if (!session) {
    throw new Error("No Wallet: unlock your wallet before signing.");
  }
  return session;
}
