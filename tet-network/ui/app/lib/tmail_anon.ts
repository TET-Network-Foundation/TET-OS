/**
 * Anonymous mode — client side of spec §A.4.
 *
 * Two screens, two different sets of states, and they must not be conflated:
 *
 * **Sender (compose).** `registration_propagating` → `proving` → sent. The first has a
 * *deterministic* end (the next epoch boundary), so it is shown as a countdown; the second is a
 * ~33 s job, so it is shown as work in progress. Send stays disabled until eligible.
 *
 * **Receiver (inbox).** `pending` → `verified` | `failed`. A message is **never** labelled
 * anonymous-verified before its proof has been checked — absent or pending is not "probably fine".
 */

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

/** Sender-side state from `POST /tmail/anon/send`. */
export type AnonSendState =
  | { state: "not_registered" }
  | { state: "registration_propagating"; eligibleAtMs: number; secondsRemaining: number }
  | { state: "proving"; jobId: string; expectedDurationMs: number };

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
