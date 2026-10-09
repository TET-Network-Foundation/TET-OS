/**
 * In-memory Tmail KEM key session — the X25519 + Kyber-768 (round 3) secret/public keypairs derived from the
 * unlocked wallet's mnemonic (see {@link deriveTmailKeysFromMnemonic}). Mirrors the
 * `hybrid_signer_session` pattern: secret material lives only for the current tab session and is
 * cleared on lock. Never persist this.
 */

export type TmailKeySession = {
  /** 64-char lowercase hex wallet id this KEM keypair belongs to. */
  walletIdHex64: string;
  x25519_sk: Uint8Array;
  x25519_pub: Uint8Array;
  mlkem_sk: Uint8Array;
  mlkem_pub: Uint8Array;
  /**
   * Anonymity-set member secret, `HKDF(bip39_seed, "tet-anon-member-v1")` (`anon_tree.mjs`).
   * Proves membership; whoever holds it can post as this member. Same lifetime as the KEM keys.
   */
  anonMemberSecret: Uint8Array;
};

let session: TmailKeySession | null = null;

export function setTmailKeySession(next: TmailKeySession | null): void {
  session = next;
}

export function getTmailKeySession(): TmailKeySession | null {
  return session;
}
