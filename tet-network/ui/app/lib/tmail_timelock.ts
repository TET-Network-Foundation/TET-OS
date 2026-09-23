/**
 * Scheduled release — client side of spec §A.2.2 approach C.
 *
 * The sender picks a `release_at_ms`; it is part of the signed §A.1.3 pre-image, so it cannot be
 * moved in transit. Cooperating nodes then withhold the `e2ee` block from `GET /tmail/inbox` until
 * that moment, which is why an inbox row can legitimately arrive with no payload.
 *
 * **This is not an enforced lock.** The ciphertext is gossiped at send time and sits on every
 * relaying node from then on; the decryption key is the recipient's, not the network's. Anyone
 * holding that key who can see the ciphertext can read it immediately, and a node running modified
 * code simply serves it. {@link TMAIL_TIME_LOCK_DISCLOSURE} is the wording that must travel with the
 * feature anywhere a user can see it.
 */

/**
 * Locked user-facing wording for scheduled release — spec §A.2.5, risk **R6**, decision #1.
 *
 * Verbatim, and byte-identical to `TMAIL_TIME_LOCK_DISCLOSURE` in `tet-core/src/tmail/timelock.rs`
 * and to spec §A.2.5. Do not soften it, and do not use the word "time-lock" in user-facing copy
 * without it — R6 exists because that word implies an enforcement this does not have.
 */
export const TMAIL_TIME_LOCK_DISCLOSURE =
  "Scheduled release, not an enforced lock. The encrypted message reaches relaying nodes when it " +
  "is sent; cooperating nodes withhold it until the release time, and anyone holding the " +
  "recipient's keys could read it sooner.";

/** Shortest schedule the compose form accepts, so "scheduled" is never instantly released. */
export const TMAIL_MIN_SCHEDULE_MINUTES = 1;
/** Longest schedule the compose form offers: the node's maximum retention is 30 days. */
export const TMAIL_MAX_SCHEDULE_MINUTES = 30 * 24 * 60;

/** Format a release time for display. */
export function formatReleaseAt(releaseAtMs: number): string {
  return new Date(releaseAtMs).toLocaleString();
}

/** Human "time remaining" for a scheduled message, e.g. `2h 15m`. */
export function timeUntilRelease(releaseAtMs: number, nowMs: number = Date.now()): string {
  const ms = Math.max(0, releaseAtMs - nowMs);
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${rem}m`;
  if (mins > 0) return `${mins}m`;
  return "under a minute";
}
