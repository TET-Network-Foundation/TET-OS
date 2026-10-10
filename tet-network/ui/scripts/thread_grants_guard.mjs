// Thread grants (app/lib/thread_grants.mjs; docs/plans/TESTNET_REWARDS.md §2). Each rule with a
// negative control: a broken implementation of that rule must fail its check.
import assert from "node:assert/strict";
import * as tg from "../app/lib/thread_grants.mjs";

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n")[0]}`);
  }
};
const fails = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const T0 = Date.UTC(2026, 9, 12, 9);
const H = 3_600_000;
const W = (c) => c.repeat(64);
const named = (k, atMs) => ({ kind: "named", key: W(k), atMs });
const anon = (k, atMs) => ({ kind: "anonymous", key: k, atMs });
const thread = (id, starterKey, replies, extra = {}) => ({
  id,
  board: "b1",
  starter: { kind: "named", key: W(starterKey), wallet: W(starterKey) },
  openedAtMs: T0,
  replies,
  ...extra,
});
const base = { nowMs: T0 + 2 * H, alreadyGranted: new Set(), personToday: new Map(), networkTodayMicro: 0, vouchedMembers: 0 };

// 1. three distinct people, not three replies
const rule1 = (impl) => {
  assert.equal(impl.distinctRepliers(thread("t", "a", [named("b", T0 + H), named("b", T0 + H), named("c", T0 + H)])), 2, "3 replies from 2 people");
  assert.equal(impl.distinctRepliers(thread("t", "a", [named("b", T0 + H), named("c", T0 + H), named("d", T0 + H)])), 3);
};
check("3 replies from 2 distinct people grant nothing; 3 people do", () => rule1(tg));
check("control: counting replies instead of people FAILS", () =>
  assert.ok(fails(() => rule1({ distinctRepliers: (t) => t.replies.length }))),
);

// 2. the starter's own replies don't count
const rule2 = (impl) => assert.equal(impl.distinctRepliers(thread("t", "a", [named("a", T0 + H), named("b", T0 + H), named("c", T0 + H)])), 2);
check("the starter's own replies don't count", () => rule2(tg));
check("control: counting the starter FAILS", () =>
  assert.ok(fails(() => rule2({ distinctRepliers: (t) => new Set(t.replies.map((r) => r.key)).size }))),
);

// 3. anonymous daily IDs are not added across days; replies after 7 days don't count
const rule3 = (dr) => {
  const t = thread("t", "a", [anon("x", T0 + H), anon("y", T0 + H), anon("z", T0 + 25 * H)]);
  assert.equal(dr(t), 2, "x and y on day 1; z on day 2 may be x or y");
  assert.equal(dr(thread("t", "a", [named("b", T0 + 8 * 24 * H), named("c", T0 + H), named("d", T0 + H)])), 2);
};
check("anonymous repliers count within one day only, and only within 7 days", () => rule3(tg.distinctRepliers));
check("control: adding daily IDs across days FAILS", () =>
  assert.ok(fails(() => rule3((t) => new Set(t.replies.filter((r) => r.key !== t.starter.key).map((r) => r.key)).size))),
);

// 4. the per-person daily cap: one granted thread per person per day
const twoThreads = [thread("t1", "a", [named("b", T0 + H), named("c", T0 + H), named("d", T0 + H)]), thread("t2", "a", [named("b", T0 + H), named("c", T0 + H), named("e", T0 + H)], { openedAtMs: T0 + 1 })];
const rule4 = (decide) => {
  const r = decide({ ...base, threads: twoThreads });
  assert.equal(r.grants.length, 1, "one granted thread per person per day");
  assert.ok(r.skipped.some((s) => /already has a granted thread today/.test(s.reason)));
};
check("one granted thread per person per day", () => rule4(tg.decideThreadGrants));
check("control: no per-person cap FAILS", () =>
  assert.ok(fails(() => rule4((a) => ({ grants: a.threads.map((t) => ({ thread: t.id })), skipped: [] })))),
);

// 5. the person's daily total and the network's daily total
const rule5 = (decide) => {
  const today = new Map([[W("a"), { threads: 0, micro: tg.PERSON_DAILY_CAP_MICRO - 1 }]]);
  assert.equal(decide({ ...base, personToday: today, threads: twoThreads.slice(0, 1) }).grants.length, 0);
  const full = decide({ ...base, networkTodayMicro: tg.NETWORK_DAILY_CAP_MICRO, threads: twoThreads.slice(0, 1) });
  assert.equal(full.grants.length, 0);
};
check("a person's daily total and the network's daily total hold", () => rule5(tg.decideThreadGrants));
check("control: ignoring the daily totals FAILS", () =>
  assert.ok(fails(() => rule5((a) => tg.decideThreadGrants({ ...a, personToday: new Map(), networkTodayMicro: 0 })))),
);

// 6. never twice; anonymous starters have no payout wallet yet
const rule6 = (decide) => {
  assert.equal(decide({ ...base, alreadyGranted: new Set(["t1"]), threads: twoThreads.slice(0, 1) }).grants.length, 0);
  const a = thread("t3", "a", [named("b", T0 + H), named("c", T0 + H), named("d", T0 + H)], { starter: { kind: "anonymous", key: "dayid", wallet: null } });
  assert.equal(decide({ ...base, threads: [a] }).grants.length, 0);
};
check("a thread is never granted twice; an anonymous starter isn't paid", () => rule6(tg.decideThreadGrants));
check("control: forgetting earlier grants FAILS", () =>
  assert.ok(fails(() => rule6((a) => tg.decideThreadGrants({ ...a, alreadyGranted: new Set() })))),
);

// 7. the halving schedule
const rule7 = (g) => {
  assert.equal(g(0), 10_000_000);
  assert.equal(g(999), 10_000_000);
  assert.equal(g(1_000), 5_000_000);
  assert.equal(g(2_000), 2_500_000);
  assert.equal(g(1_000_000), tg.GRANT_FLOOR_MICRO, "floor 0.01");
};
check("the grant is 10, 5, 2.5 at 0, 1,000 and 2,000 members, floor 0.01", () => rule7(tg.grantMicro));
check("control: no halving FAILS", () => assert.ok(fails(() => rule7(() => 10_000_000))));
check("the next halving point", () => assert.equal(tg.nextHalvingAt(1_234), 2_000));

// 8. exactly the grant arrives after the transfer fee
const rule8 = (gross) => {
  for (const net of [10_000_000, 5_000_000, 2_500_000, 10_000]) {
    const g = gross(net);
    assert.ok(g - Math.floor((g * 100) / 10_000) >= net && g - 1 - Math.floor(((g - 1) * 100) / 10_000) < net, `net ${net}`);
  }
};
check("the transfer sends enough that exactly the grant arrives", () => rule8(tg.grossForNet));
check("control: sending the net amount FAILS", () => assert.ok(fails(() => rule8((n) => n))));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
