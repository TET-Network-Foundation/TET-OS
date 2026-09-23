/**
 * Burn-after-read revoke builder — constructs a hybrid-signed `TmailBurnRevokeV1` in the browser,
 * byte-compatible with tet-core `src/tmail/burn.rs` (struct serde shape + §A.3.2 preimage).
 *
 * The node destroys its copy and gossips the revoke to peers; cooperating nodes purge too.
 */

import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import type { TmailHybridSig } from "./tmail";

/** Stable `kind` discriminator — mirrors Rust `TMAIL_BURN_REVOKE_KIND`. */
export const TMAIL_BURN_REVOKE_KIND = "tmail_burn_revoke_v1";

/**
 * Locked user-facing burn copy — spec §A.3.2 Layer 3, **final decision #2**.
 *
 * Reproduced verbatim. Do not soften, shorten or paraphrase it: it is the only thing standing
 * between "best-effort network burn" and a cryptographic guarantee the protocol does not make.
 * Risk R4 in the spec register is precisely a post-ship false sense of security here.
 */
export const TMAIL_BURN_DISCLOSURE =
  "Best-effort burn. Cooperating nodes will purge after read receipt. " +
  "Non-cooperating peers may retain encrypted copies.";

/** Burn revoke / read receipt (mirrors Rust `TmailBurnRevokeV1`). */
export type TmailBurnRevokeV1 = {
  v: number;
  kind: string;
  msg_id: string;
  reader_wallet_id: string;
  read_at_ms: number;
  hybrid_sig: TmailHybridSig;
};

/**
 * §A.3.2 hybrid-signature preimage — byte-exact with Rust
 * `burn.rs::tmail_burn_revoke_auth_message_bytes`.
 */
export function tmailBurnRevokeAuthMessageBytes(opts: {
  chainId: string;
  genesisHash: string;
  msgId: string;
  readerWalletId: string;
  readAtMs: number;
  mldsaPubkeyB64: string;
}): Uint8Array {
  const line =
    `tet tmail burn revoke v1|chain_id=${opts.chainId}|genesis_hash=${opts.genesisHash}` +
    `|msg_id=${opts.msgId.trim()}` +
    `|reader=${opts.readerWalletId.trim().toLowerCase()}` +
    `|read_at_ms=${opts.readAtMs}` +
    `|mldsa_pk=${opts.mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

/**
 * Build a hybrid-signed {@link TmailBurnRevokeV1}. Requires an unlocked hybrid signer session; the
 * node will only honour it if this wallet is the sender or the receiver of `msgId`.
 */
export async function buildTmailBurnRevokeV1(opts: {
  msgId: string;
  readerWalletId: string;
  baseUrl?: string;
}): Promise<TmailBurnRevokeV1> {
  const sess = requireHybridSignerSession();
  const reader = opts.readerWalletId.trim().toLowerCase();
  if (reader !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session signer does not match reader wallet.");
  }
  const readAtMs = Date.now();
  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = tmailBurnRevokeAuthMessageBytes({
    chainId,
    genesisHash,
    msgId: opts.msgId,
    readerWalletId: reader,
    readAtMs,
    mldsaPubkeyB64: sess.mldsa44_pubkey_b64,
  });

  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);

  return {
    v: 1,
    kind: TMAIL_BURN_REVOKE_KIND,
    msg_id: opts.msgId,
    reader_wallet_id: reader,
    read_at_ms: readAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: reader,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
  };
}
