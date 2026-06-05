/**
 * Shared display formatters for the TET Sovereign OS desktop.
 *
 * These are pure functions extracted from `OsClient.tsx` (Step 6) so panels can import them
 * directly instead of receiving them via prop drilling. Output is byte-identical to the
 * former module-local helpers.
 */

import { microTetToTet } from "../../lib/worker_cockpit";

/** Truncate a long hex/string to `head…tail` (returns "—" for empty). */
export function shortHash(s: string, head = 10, tail = 8): string {
  if (!s) return "—";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Format a micro-TET integer amount as a `"<n> TET"` display string. */
export function formatWorkerTet(micro: number): string {
  const tet = microTetToTet(micro);
  return `${tet.toLocaleString("en-US", { maximumFractionDigits: tet >= 100 ? 2 : 6 })} TET`;
}

/** Format a TFLOPS estimate as a `"<n> TFLOPS"` display string. */
export function formatTflops(v: number): string {
  return `${(Number.isFinite(v) ? v : 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} TFLOPS`;
}
