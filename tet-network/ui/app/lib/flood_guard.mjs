// An invisible flood guard for board posts (founder, 2026-10-09): no visible per-minute limit.
// A person's first BURST posts within WINDOW_MS go out at once; after that, each post waits,
// silently, until SPACING_MS after the previous one. Normal conversation (a few posts a minute)
// never waits. SPACING_MS matches the node's per-address write refill (20 a minute), so the
// node's own limit isn't reached either.

export const BURST = 5;
export const WINDOW_MS = 60_000;
export const SPACING_MS = 3_000;

/**
 * How long to wait before sending the next post, given when the earlier ones were sent.
 * @param {number[]} sentAtMs
 * @param {number} nowMs
 */
export function delayBeforeNext(sentAtMs, nowMs) {
  const recent = sentAtMs.filter((t) => nowMs - t < WINDOW_MS);
  if (recent.length < BURST) return 0;
  return Math.max(0, Math.max(...recent) + SPACING_MS - nowMs);
}
