import type { KeyringPair } from "@polkadot/keyring/types";

export type HybridKeyMaterial = {
  walletIdHex64: string;
  mldsa44PubkeyB64: string;
  mldsa44KeypairB64: string;
  /** Sync Ed25519 sign (Polkadot pair). */
  signEd25519: (msg: Uint8Array) => Uint8Array;
};

export type LoadedHybridWallet = HybridKeyMaterial & {
  displayAddress: string;
  edPair: KeyringPair;
};
