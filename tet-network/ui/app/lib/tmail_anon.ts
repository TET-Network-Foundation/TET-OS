/**
 * Anonymous mode — client side of spec §A.4.
 *
 * Two screens, two different sets of states, and they must not be conflated:
 *
 * **Sender (compose).** `loading_set` → `proving` → `depositing` → `sending` → `sent`, or
 * `not_in_set` / `failed`. Runs in the browser (`anon_poster.mjs`): the node is never told which
 * wallet is sending. `not_in_set` has a deterministic end when the wallet has just registered (the
 * next epoch boundary), so it is shown with that time.
 *
 * **Receiver (inbox).** `pending` → `verified` | `failed`. A message is **never** labelled
 * anonymous-verified before its proof has been checked — absent or pending is not "probably fine".
 */

import { anonCommitment, anonRegistrationAuthMessageBytes, toHex } from "./anon_tree.mjs";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { expectedChainBinding } from "./chain_binding";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";

/** Locked disclosure — mirrors `TMAIL_ANON_DISCLOSURE` in `tet-core/src/tmail/anon.rs`. */
export const TMAIL_ANON_DISCLOSURE =
  "Anonymous among the registrations your node has seen - on today's testnet that set is small " +
  "and anonymity is correspondingly weak. Registration is free; sybil resistance arrives with " +
  "the Phase 1 escrow.";

/** What the node concluded about an anonymous message's proof. */
export type AnonVerdict =
  | { state: "pending" }
  | { state: "verified"; nullifier_hex: string; verified_at_ms: number }
  | { state: "failed"; reason: string; failed_at_ms: number };

/**
 * Sender-side state, as `runAnonPost` (`anon_poster.mjs`) reports it. Every run ends in `sent`,
 * `not_in_set` or `failed`; there is no state that waits on the node indefinitely.
 */
export type AnonSendState =
  | { state: "idle" }
  | { state: "loading_set" }
  | { state: "not_in_set"; nextEpochAtMs: number }
  | { state: "proving"; startedAtMs: number }
  | { state: "depositing" }
  | { state: "sending" }
  | { state: "sent"; msgId: string }
  | { state: "failed"; reason: string };

/** A hybrid-signed anonymity-set registration (Rust `TmailAnonRegistrationV1`). */
export type TmailAnonRegistrationV1 = {
  v: 1;
  kind: "tmail_anon_registration_v1";
  wallet_id: string;
  commitment_hex: string;
  registered_at_ms: number;
  hybrid_sig: {
    ed25519_pubkey_hex: string;
    ed25519_sig_b64: string;
    mldsa_pubkey_b64: string;
    mldsa_sig_b64: string;
  };
};

/**
 * Register the unlocked wallet's commitment `SHA256("tet-anon-v1" ‖ member_secret)`, signed by the
 * wallet. The member secret comes from the Tmail key session and never leaves the browser.
 */
export async function buildTmailAnonRegistrationV1(opts: {
  memberSecret: Uint8Array;
  baseUrl?: string;
}): Promise<TmailAnonRegistrationV1> {
  const sess = requireHybridSignerSession();
  const walletId = sess.walletIdHex64.trim().toLowerCase();
  const commitmentHex = toHex(anonCommitment(opts.memberSecret));
  const registeredAtMs = Date.now();
  const { chainId, genesisHash } = await expectedChainBinding(opts.baseUrl);
  const msg = anonRegistrationAuthMessageBytes({
    chainId,
    genesisHash,
    walletId,
    commitmentHex,
    registeredAtMs,
    mldsaPubkeyB64: sess.mldsa44_pubkey_b64,
  });
  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);
  return {
    v: 1,
    kind: "tmail_anon_registration_v1",
    wallet_id: walletId,
    commitment_hex: commitmentHex,
    registered_at_ms: registeredAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: walletId,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
  };
}

/**
 * How an anonymous message should be labelled in the inbox.
 *
 * Deliberately returns a *label*, not a boolean: there is no question anywhere in the UI of the
 * form "is this verified?" that could be answered optimistically by a missing field.
 */
export function anonLabel(verdict: AnonVerdict | undefined): {
  text: string;
  tone: "pending" | "ok" | "bad";
  detail: string;
} {
  switch (verdict?.state) {
    case "verified":
      return {
        text: "ANONYMOUS — VERIFIED",
        tone: "ok",
        detail: "Membership proof checked by this node.",
      };
    case "failed":
      return {
        text: "ANONYMOUS — PROOF FAILED",
        tone: "bad",
        detail: verdict.reason,
      };
    // `pending` and *absent* collapse to the same answer on purpose. A missing verdict means this
    // node has not checked yet, which is exactly as unproven as an explicit pending.
    default:
      return {
        text: "ANONYMOUS — PROOF PENDING",
        tone: "pending",
        detail: "The sender's membership proof has not been verified yet.",
      };
  }
}

/** Seconds until an instant, floored at zero. */
export function secondsUntil(atMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((atMs - nowMs) / 1000));
}
