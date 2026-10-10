// Thread grants (docs/plans/TESTNET_REWARDS.md §2): which threads on public boards get a grant
// (practice unit, can't be exchanged for money), and how much. Pure: the operator script
// (scripts/thread_grants.mjs) reads the boards and pays; this decides. Guarded by
// scripts/thread_grants_guard.mjs, each rule with a negative control.

export const DAY_MS = 86_400_000;
export const WINDOW_MS = 7 * DAY_MS;
export const MIN_REPLIERS = 3;
export const BASE_GRANT_MICRO = 10_000_000; // 10 TET (practice)
export const GRANT_FLOOR_MICRO = 10_000; // 0.01 TET (practice)
export const HALVING_EVERY = 1_000; // vouched members
export const PERSON_DAILY_CAP_MICRO = 20_000_000; // 20 TET (practice) per person per UTC day
export const NETWORK_DAILY_CAP_MICRO = 200_000_000; // 200 TET (practice) per UTC day, network-wide

/** The grant per thread for a network of `vouchedMembers`: 10 ÷ 2^⌊members ÷ 1,000⌋, floor 0.01. */
export function grantMicro(vouchedMembers) {
  const halvings = Math.floor(Math.max(0, vouchedMembers) / HALVING_EVERY);
  if (halvings >= 52) return GRANT_FLOOR_MICRO;
  return Math.max(GRANT_FLOOR_MICRO, Math.floor(BASE_GRANT_MICRO / 2 ** halvings));
}

/** The member count at which the grant next halves. */
export function nextHalvingAt(vouchedMembers) {
  return (Math.floor(Math.max(0, vouchedMembers) / HALVING_EVERY) + 1) * HALVING_EVERY;
}

const utcDay = (ms) => Math.floor(ms / DAY_MS);

/**
 * Distinct people who replied within 7 days of the opening post, the starter excluded.
 * Named replies count by wallet (the verified signer). Anonymous replies count by daily ID, which
 * is one per member per board per UTC day: daily IDs from different days may be the same person,
 * so anonymous repliers are counted on the single day with the most, never added across days.
 *
 * @param {{ starter: { kind: "named" | "anonymous", key: string }, openedAtMs: number,
 *           replies: { kind: "named" | "anonymous", key: string, atMs: number }[] }} thread
 *   `key` is the verified wallet for named posts, the daily ID for anonymous ones.
 */
export function distinctRepliers(thread) {
  const end = thread.openedAtMs + WINDOW_MS;
  const inWindow = thread.replies.filter((r) => r.atMs >= thread.openedAtMs && r.atMs <= end && r.key);
  const starterDay = utcDay(thread.openedAtMs);
  const isStarter = (r) =>
    r.kind === thread.starter.kind && r.key === thread.starter.key && (r.kind === "named" || utcDay(r.atMs) === starterDay);
  const named = new Set(inWindow.filter((r) => r.kind === "named" && !isStarter(r)).map((r) => r.key));
  const anonByDay = new Map();
  for (const r of inWindow) {
    if (r.kind !== "anonymous" || isStarter(r)) continue;
    const d = utcDay(r.atMs);
    if (!anonByDay.has(d)) anonByDay.set(d, new Set());
    anonByDay.get(d).add(r.key);
  }
  const anon = Math.max(0, ...[...anonByDay.values()].map((s) => s.size));
  return named.size + anon;
}

/**
 * Decide today's thread grants.
 *
 * @param {object} a
 * @param {Array<{ id: string, board: string, starter: { kind: "named" | "anonymous", key: string, wallet: string | null },
 *                 openedAtMs: number, replies: Array<{ kind: string, key: string, atMs: number }> }>} a.threads
 * @param {number} a.nowMs
 * @param {Set<string>} a.alreadyGranted  thread ids granted before (never twice)
 * @param {Map<string, { threads: number, micro: number }>} a.personToday  granted so far today, by person key
 * @param {number} a.networkTodayMicro  granted so far today, network-wide
 * @param {number} a.vouchedMembers
 * @returns {{ grants: Array<{ thread: string, board: string, person: string, wallet: string, micro: number, repliers: number }>,
 *             skipped: Array<{ thread: string, reason: string }> }}
 */
export function decideThreadGrants(a) {
  const amount = grantMicro(a.vouchedMembers);
  const person = new Map([...a.personToday].map(([k, v]) => [k, { ...v }]));
  let network = a.networkTodayMicro;
  const grants = [];
  const skipped = [];
  // Oldest first, so the order of a run never depends on how boards were listed.
  const threads = [...a.threads].sort((x, y) => x.openedAtMs - y.openedAtMs || (x.id < y.id ? -1 : 1));
  for (const t of threads) {
    if (a.alreadyGranted.has(t.id)) continue;
    const repliers = distinctRepliers(t);
    if (repliers < MIN_REPLIERS) {
      if (a.nowMs > t.openedAtMs + WINDOW_MS) skipped.push({ thread: t.id, reason: `closed with ${repliers} distinct repliers` });
      continue;
    }
    if (t.starter.kind !== "named" || !t.starter.wallet) {
      skipped.push({ thread: t.id, reason: "anonymous starter: no payout wallet yet" });
      continue;
    }
    const p = person.get(t.starter.key) ?? { threads: 0, micro: 0 };
    if (p.threads >= 1) {
      skipped.push({ thread: t.id, reason: "this person already has a granted thread today" });
      continue;
    }
    if (p.micro + amount > PERSON_DAILY_CAP_MICRO) {
      skipped.push({ thread: t.id, reason: "this person's daily total is reached" });
      continue;
    }
    if (network + amount > NETWORK_DAILY_CAP_MICRO) {
      skipped.push({ thread: t.id, reason: "today's grants are used up" });
      continue;
    }
    p.threads += 1;
    p.micro += amount;
    person.set(t.starter.key, p);
    network += amount;
    grants.push({ thread: t.id, board: t.board, person: t.starter.key, wallet: t.starter.wallet, micro: amount, repliers });
  }
  return { grants, skipped };
}

/** What a transfer must send so that `netMicro` arrives after the transfer fee (rate `feeBps`). */
export function grossForNet(netMicro, feeBps = 100) {
  let g = Math.floor((netMicro * 10_000) / (10_000 - feeBps));
  while (g - Math.floor((g * feeBps) / 10_000) < netMicro) g += 1;
  return g;
}
