/**
 * The sample wallet on /future, as plain data and two pure functions. No request, no storage, no
 * real key: a key here is a letter and a flag, a note is a letter and a number of sample units.
 *
 * It models the idea in docs/research/ONE_SHOT_TET.md: handing a note over uses the sender's key up,
 * and a used key cannot hand a second note. On an ordinary computer that rule is only this code
 * refusing; a copy of the state could be used again. The page says so under the wallet.
 *
 * scripts/future_concept_guard.mjs runs these functions: one hand-over marks the key used and the
 * note arrives once; a used key is refused and nothing changes; the units add up before and after.
 */

export type SampleKey = { readonly id: string; readonly units: number; readonly used: boolean };
export type SampleNote = { readonly from: string; readonly units: number };
/** "mine": the visitor's sample keys. "theirs": the notes that arrived with the other sample person. */
export type SampleWallets = { readonly mine: readonly SampleKey[]; readonly theirs: readonly SampleNote[] };
export type HandResult =
  | { readonly ok: true; readonly wallets: SampleWallets; readonly key: string; readonly units: number }
  | { readonly ok: false; readonly wallets: SampleWallets; readonly key: string; readonly reason: "used" | "unknown" };

/** A fresh pair: three unused sample keys on one side, nothing on the other. */
export function makeSampleWallets(): SampleWallets {
  return {
    mine: [
      { id: "A", units: 100, used: false },
      { id: "B", units: 40, used: false },
      { id: "C", units: 25, used: false },
    ],
    theirs: [],
  };
}

/**
 * Hand the note held by key `id` to the other person. The key is marked used and its note arrives
 * on the other side, once. A used or unknown key is refused, and the wallets come back unchanged
 * (the same object). The input is never changed.
 */
export function handOver(w: SampleWallets, id: string): HandResult {
  const key = w.mine.find((k) => k.id === id);
  if (!key) return { ok: false, wallets: w, key: id, reason: "unknown" };
  if (key.used) return { ok: false, wallets: w, key: id, reason: "used" };
  return {
    ok: true,
    key: id,
    units: key.units,
    wallets: {
      mine: w.mine.map((k) => (k.id === id ? { id: k.id, units: 0, used: true } : k)),
      theirs: [...w.theirs, { from: id, units: key.units }],
    },
  };
}

/** Units on each side: what the unused keys hold, and what arrived. */
export function sideTotals(w: SampleWallets): { mine: number; theirs: number } {
  return {
    mine: w.mine.filter((k) => !k.used).reduce((a, k) => a + k.units, 0),
    theirs: w.theirs.reduce((a, n) => a + n.units, 0),
  };
}
