export type HybridKeyMaterial = {
  walletIdHex64: string;
  mldsa44PubkeyB64: string;
  mldsa44KeypairB64: string;
  /** Sync Ed25519 sign over the exact bytes given (no hashing, no prefix). */
  signEd25519: (msg: Uint8Array) => Uint8Array;
};

export type LoadedHybridWallet = HybridKeyMaterial & {
  /** Truncated wallet id for logs — same shape the Sovereign OS shell shows. */
  displayAddress: string;
};
