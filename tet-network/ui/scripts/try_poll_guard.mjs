// Guard for anonymous polls (app/lib/poll.ts, tet-core src/tmail/poll.rs).
//
//   node --experimental-strip-types scripts/try_poll_guard.mjs
//
// SECURITY properties:
// 1. The page signs exactly tet-core's poll pre-image: the same fields in the same order. Control:
//    a template with a field dropped is caught.
// 2. Registering a members-only poll sends the member wallet ids only — never a root or a leaf, so
//    the node builds the root from its own registry and a poll can't list invented members.
//    Control: a body carrying a root is caught.
// 3. A voter proves against the node's registered list and root, not the thread post's. Control:
//    a vote() reading the post's root is caught.
// 4. The tally counts only ballots the node verified, one option each; pending, failed, named or
//    out-of-range ballots don't count. Control: a counter that counts pending ballots is caught.
// 5. A malformed poll definition is not a poll.
// 6. Every poll is registered with the node, open ones too (so its wallet takes only verified
//    ballots and none can be crowded out). Control: registration only for members-only is caught.
// 7. The poll box says how anonymous a vote really is: hidden only among the listed members, the
//    maker chose the list, timing can give a vote away, the node sees IP addresses. Control: a
//    box missing the maker line is caught.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const poll = await import("../app/lib/poll.ts");
const TS = readFileSync(new URL("../app/lib/poll.ts", import.meta.url), "utf8");
const BOX = readFileSync(new URL("../app/try/PollBox.tsx", import.meta.url), "utf8");
const RS = readFileSync(new URL("../../../tet-core/src/tmail/poll.rs", import.meta.url), "utf8");

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}
function mustThrow(name, fn) {
  return check(`control: ${name}`, async () => {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    assert.ok(threw, "the check did not catch it");
  });
}

// 1. pre-image parity
const rsFields = (src) => {
  const m = src.match(/"tet tmail poll root v1\|([^"]+)"/);
  assert.ok(m, "tet-core's poll pre-image not found");
  return m[1].split("|").map((f) => f.split("=")[0]);
};
const tsFields = (src) => {
  const m = src.match(/`tet tmail poll root v1\|([^`]+)`/);
  assert.ok(m, "the page's poll pre-image not found");
  return m[1].split("|").map((f) => f.split("=")[0]);
};
const sameFields = (ts, rs) => assert.deepEqual(tsFields(ts), rsFields(rs));
await check("the page signs tet-core's poll pre-image, field for field", () => sameFields(TS, RS));
await mustThrow("a dropped field is caught", () => sameFields(TS.replace("|bucket_index=${day}", ""), RS));

// 2. no root or leaf in the registration
const bodyOf = (src) => {
  const i = src.indexOf("async function registerPollRoot");
  const j = src.indexOf("const body = {", i);
  return src.slice(j, src.indexOf("\n  };", j));
};
const noRoot = (src) => {
  const b = bodyOf(src);
  const keys = [...b.matchAll(/^\s*(\w+)\s*[:,]/gm)].map((m) => m[1]);
  assert.ok(keys.includes("members"), "the body doesn't carry the member list");
  const bad = keys.filter((k) => /root|commitment|lea(f|ves)/i.test(k));
  assert.deepEqual(bad, [], "the registration carries a root or leaf");
};
await check("a poll registration sends wallet ids, never a root or leaf", () => noRoot(TS));
await mustThrow("a body carrying a root is caught", () => noRoot(TS.replace("    poll_wallet_id: pollWallet,\n", "    poll_wallet_id: pollWallet,\n    root_hex: rootHex,\n")));

// 3. voters use the node's root
const voteSrc = (src) => src.slice(src.indexOf("export async function vote("), src.indexOf("export type Tally"));
const nodeRoot = (src) => {
  const v = voteSrc(src);
  assert.ok(/nodePollRoot\(/.test(v), "vote() doesn't read the node's registered poll");
  assert.ok(!/def\.root_hex/.test(v), "vote() trusts the post's root");
};
await check("a vote proves against the node's list and root", () => nodeRoot(TS));
await mustThrow("a vote() reading the post's root is caught", () => nodeRoot(TS.replace("rootHex: reg.rootHex", "rootHex: def.root_hex")));

// 4. the tally
const post = (vote, tone, kind = "anonymous", state = "open") => ({ state, text: JSON.stringify({ vote }), label: { kind, tone } });
const ballots = [post(0, "ok"), post(1, "ok"), post(1, "ok"), post(0, "pending"), post(1, "bad"), post(0, "named", "named"), post(5, "ok"), post(-1, "ok"), post(1.5, "ok"), { state: "open", text: "not json", label: { kind: "anonymous", tone: "ok" } }];
const sound = (count) => {
  const t = count(ballots, 2);
  assert.deepEqual(t.counts, [1, 2]);
  assert.equal(t.verified, 3);
  assert.equal(t.unverified, 2);
};
await check("the tally counts only verified ballots for real options", () => sound(poll.countBallots));
await mustThrow("a counter that counts pending ballots is caught", () =>
  sound((ps, n) => {
    const t = poll.countBallots(ps.map((p) => (p.label.tone === "pending" ? { ...p, label: { ...p.label, tone: "ok" } } : p)), n);
    return t;
  }),
);

// 5. definitions
const base = { kind: poll.POLL_KIND, invite: "x", question: "q?", options: ["a", "b"], day: 1, members: null };
await check("a well-formed poll parses", () => {
  assert.ok(poll.parsePoll(JSON.stringify(base)));
  assert.equal(poll.parsePoll(JSON.stringify({ ...base, members: 3 }))?.members, 3);
});
await check("malformed polls don't", () => {
  for (const bad of [
    { ...base, options: ["a"] },
    { ...base, options: ["a", "b", "c", "d", "e", "f", "g"] },
    { ...base, options: ["a", " "] },
    { ...base, kind: "other" },
    { ...base, members: 0 },
    { ...base, members: ["ab".repeat(32)] },
    { ...base, day: 1.5 },
  ]) assert.equal(poll.parsePoll(JSON.stringify(bad)), null, JSON.stringify(bad));
  assert.equal(poll.parsePoll("not json"), null);
});

// 6. every poll registered
const registersAll = (src) => {
  const f = src.slice(src.indexOf("export async function createPoll("), src.indexOf("async function registerPollRoot"));
  const call = f.split("\n").find((l) => l.includes("registerPollRoot("));
  assert.ok(call, "createPoll doesn't register the poll");
  assert.match(call, /^  await registerPollRoot\(/, "registration isn't unconditional in createPoll");
};
await check("every poll is registered, open ones too", () => registersAll(TS));
await mustThrow("registration only for members-only polls is caught", () =>
  registersAll(TS.replace("  await registerPollRoot(baseUrl, ownerWords", "  if (members) await registerPollRoot(baseUrl, ownerWords")),
);

// 7. honest anonymity
const LINES = [
  "Your vote is hidden only among the {n} listed members.",
  "The poll's maker chose the list: if they control most of those wallets, they can work out how the others voted.",
  "the timing can give a vote away",
  "The node sees your IP address.",
];
const honest = (src) => {
  for (const l of LINES) assert.ok(src.includes(l), `the poll box lost: ${l}`);
};
await check("the poll box says how anonymous a vote is", () => honest(BOX));
await mustThrow("a box missing the maker line is caught", () => honest(BOX.replace("The poll's maker chose the list: if they control most of those wallets, they can work out how the others voted.", "")));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
