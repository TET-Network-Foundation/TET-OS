// Guard for the Try TET anonymous board (part 1, docs/DEMO_NODE.md). Runs the page's own modules
// (`app/lib/board.mjs`, `app/lib/try_board.ts`) under Node against an in-memory node that records
// every request.
//
//   node --experimental-strip-types scripts/try_board_guard.mjs
//
// SECURITY properties:
// 1. The invite secret never reaches the node: no request made while creating, opening, reading or
//    posting to a board carries the board seed, the board's KEM secret keys, or the board wallet's
//    words.
// 2. Anonymous never falls back to named: with no prover, an anonymous post is refused and nothing
//    is sent; it is not quietly re-sent with the poster's wallet.
// 3. Labels come from the envelope and the node: a named post always says NAMED — NOT ANONYMOUS
//    and shows its sender; an anonymous post is VERIFIED only on the node's verified verdict.
// 4. An invite that doesn't derive the board's registered keys is refused.
// 5. Creating a board does not replace the visitor's own wallet session.
// 7. An anonymous post never yields an author, so the page can never offer a DM for it (the DM
//    link is drawn only from `postLabel(row).author`), even if a row carries a sender id.
//    Control: a label that falls back to the row's sender → FAILED.
// 6. Joining the anonymity set and sending anonymously never happen in the same action: a post fired
//    the moment a (public) join takes effect would point back at the join. Checked in the page's
//    sources: only `wallet.tsx`'s `joinAnon` registers, it sends nothing, and no block that calls
//    `joinAnon()` also sends anonymously. With controls.

import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
// The chain binding the page reads from its build env (docker-compose.yml's local-dev defaults).
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const board = await import("../app/lib/board.mjs");
const tb = await import("../app/lib/try_board.ts");
const trySession = await import("../app/lib/try_session.ts");
const signer = await import("../app/lib/hybrid_signer_session.ts");
const poster = await import("../app/lib/anon_poster.mjs");
const { toHex, anonCommitment, anonRootAndPath } = await import("../app/lib/anon_tree.mjs");
const tmailSession = await import("../app/lib/tmail_session.ts");

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

// ---- an in-memory node that records every request ----------------------------------------------
const FOUNDER = "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";
const requests = [];
const keys = new Map();
/** The anonymity set the stub node serves (hex leaves); filled once the visitor's wallet exists. */
let anonLeaves = [];
const inbox = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  requests.push({ url, method, body });
  const json = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
  if (!url.startsWith("http://node.test/")) throw new TypeError("fetch failed (nothing listening)");
  const path = new URL(url).pathname;
  let m;
  if (path === "/status") return json(200, { founder_wallet_id: FOUNDER });
  if ((m = path.match(/^\/tmail\/keys\/([0-9a-f]{64})$/))) {
    if (method === "PUT") {
      keys.set(m[1], JSON.parse(body));
      return json(200, { ok: true, registered_at_ms: Date.now() });
    }
    return keys.has(m[1]) ? json(200, { ok: true, registration: keys.get(m[1]) }) : json(404, { ok: false });
  }
  if ((m = path.match(/^\/tmail\/inbox\/([0-9a-f]{64})$/))) {
    return json(200, { ok: true, messages: inbox.get(m[1]) ?? [], locked_count: 0 });
  }
  if (path === "/tmail/anon/leaves") {
    const { root } = anonRootAndPath(anonLeaves.map((h) => Uint8Array.from(Buffer.from(h, "hex"))), 0);
    return json(200, {
      ok: true, epoch: 1, leaves: anonLeaves, total: anonLeaves.length, next_offset: null,
      merkle_root: toHex(root), next_epoch_at_ms: Date.now() + 60_000,
    });
  }
  if (path === "/tmail/send" && method === "POST") {
    const env = JSON.parse(body);
    const list = inbox.get(env.receiver_wallet_id) ?? [];
    list.unshift(env);
    inbox.set(env.receiver_wallet_id, list);
    return json(202, { ok: true, msg_id: env.msg_id });
  }
  return json(404, { ok: false });
};
const BASE = "http://node.test";
const NO_PROVER = "http://127.0.0.1:1"; // nothing listens: the stub fetch throws for it

function b64std(u8) {
  return Buffer.from(u8).toString("base64");
}
function b64url(u8) {
  return Buffer.from(u8).toString("base64url");
}

// ---- 1, 4, 5: create, open, read, post named ------------------------------------------------------
const visitorWords = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const visitorId = await trySession.activateTryWallet(visitorWords);

const { board: created, ownerWords } = await tb.createBoard(BASE, "guard board");
const inv = board.parseInvite(created.invite);

await check("SECURITY: creating a board does not replace the visitor's wallet session", () => {
  assert.equal(signer.getHybridSignerSession()?.walletIdHex64, visitorId);
});

const opened = await tb.openBoard(BASE, `https://try.example/try#board=${created.invite}`);
await tb.postNamed(BASE, opened, "hello from a named poster");
const feed = await tb.readBoard(BASE, opened);

await check("SECURITY: no request carries the board seed, its KEM secret keys or the board wallet's words", () => {
  const secrets = {
    "seed (base64url)": b64url(inv.seed),
    "seed (hex)": toHex(inv.seed),
    "x25519 secret (base64)": b64std(opened.keys.x25519_sk),
    "x25519 secret (hex)": toHex(opened.keys.x25519_sk),
    "kyber secret (base64, prefix)": b64std(opened.keys.mlkem_sk).slice(0, 64),
    "board wallet words": ownerWords,
    "invite": created.invite,
  };
  assert.ok(requests.length >= 5, `expected the flows to make requests, saw ${requests.length}`);
  for (const r of requests) {
    for (const [what, s] of Object.entries(secrets)) {
      assert.ok(!r.url.includes(s) && !r.body.includes(s), `${r.method} ${r.url} carries the ${what}`);
    }
  }
});

await check("the board reads back a named post, labelled named with its sender", () => {
  assert.equal(feed.length, 1);
  assert.equal(feed[0].state, "open");
  assert.equal(feed[0].text, "hello from a named poster");
  assert.equal(feed[0].label.text, board.NAMED_LABEL);
  assert.equal(feed[0].label.author, visitorId);
});

await check("SECURITY: an invite that doesn't derive the registered keys is refused", async () => {
  const forged = board.encodeInvite({ boardWalletId: opened.boardWalletId, seed: board.newBoardSeed(), name: "x" });
  await assert.rejects(() => tb.openBoard(BASE, forged), /doesn't match/);
  await assert.rejects(() => tb.openBoard(BASE, "tetboard1.zz.yy.xx"), /bad board wallet id/);
  await assert.rejects(() => tb.openBoard(BASE, "hello"), /not a TET board invite/);
});

// ---- 2: anonymous never falls back to named --------------------------------------------------------
await check("SECURITY: with no prover, an anonymous post is refused and nothing is sent", async () => {
  for (const prover of ["missing", "unknown"]) {
    const plan = board.boardPostPlan({ mode: "anonymous", prover, hasWallet: true });
    assert.equal(plan.action, "refuse", `prover ${prover} gave ${plan.action}`);
  }
  assert.equal(board.boardPostPlan({ mode: "named", prover: "missing", hasWallet: true }).action, "named");
  assert.equal(board.boardPostPlan({ mode: "anonymous", prover: "found", hasWallet: false }).action, "refuse");

  // The anonymous path itself, against a prover that isn't there. The visitor IS in the set, so the
  // post gets as far as proving; it must end failed with the prover message, and no envelope (named
  // or not) may reach /tmail/send.
  anonLeaves = [toHex(anonCommitment(tmailSession.getTmailKeySession().anonMemberSecret))];
  const states = [];
  const before = requests.length;
  const out = await tb.postAnonymous(BASE, NO_PROVER, opened, "should not be sent", (st) => states.push(st.state));
  const sends = requests.slice(before).filter((r) => r.url.endsWith("/tmail/send"));
  assert.equal(sends.length, 0, "an envelope was sent");
  assert.ok(states.includes("proving"), `never reached the prover: ${states.join(" → ")}`);
  assert.equal(out.state, "failed");
  assert.ok(out.reason.startsWith(poster.ANON_PROVER_MISSING), out.reason);
});

// ---- 3: labels -----------------------------------------------------------------------------------
await check("SECURITY: anonymous posts are VERIFIED only on the node's verdict; named always says so", () => {
  const anon = (v) => board.postLabel({ flags: { anonymous: true }, sender_wallet_id: "anonymous", anon_verdict: v });
  assert.equal(anon(undefined).text, "ANONYMOUS — PROOF PENDING");
  assert.equal(anon({ state: "pending" }).text, "ANONYMOUS — PROOF PENDING");
  assert.equal(anon({ state: "verified", nullifier_hex: "00", verified_at_ms: 1 }).text, "ANONYMOUS — VERIFIED");
  assert.equal(anon({ state: "failed", reason: "bad", failed_at_ms: 1 }).text, "ANONYMOUS — PROOF FAILED");
  assert.equal(anon({ state: "verified" }).author, null);
  // A named envelope cannot borrow an anonymous label, whatever verdict it is paired with.
  const named = board.postLabel({ flags: { anonymous: false }, sender_wallet_id: visitorId, anon_verdict: { state: "verified" } });
  assert.equal(named.text, board.NAMED_LABEL);
  assert.equal(named.author, visitorId);
  assert.equal(board.postLabel({ sender_wallet_id: visitorId }).text, board.NAMED_LABEL);
});

// ---- the rest ------------------------------------------------------------------------------------
await check("invites round-trip, from a bare string or a whole URL", () => {
  const seed = board.newBoardSeed();
  const wid = "ab".repeat(32);
  const s = board.encodeInvite({ boardWalletId: wid, seed, name: "Ünïcode board" });
  for (const form of [s, `#board=${s}`, `https://x.example/try#board=${s}`]) {
    const p = board.parseInvite(form);
    assert.equal(p.boardWalletId, wid);
    assert.equal(toHex(p.seed), toHex(seed));
    assert.equal(p.name, "Ünïcode board");
  }
  assert.throws(() => board.parseInvite(`${s}.extra`));
  assert.throws(() => board.parseInvite(s.replace("tetboard1", "tetboard2")));
});

await check("the anonymous allowance is one per UTC day", () => {
  const day = 86_400_000;
  const t = 20_000 * day + 5_000;
  const a = board.anonAllowance({ nowMs: t, postedBuckets: [] });
  assert.equal(a.remaining, 1);
  assert.equal(board.anonAllowance({ nowMs: t, postedBuckets: [a.bucket] }).remaining, 0);
  assert.equal(board.anonAllowance({ nowMs: t + day, postedBuckets: [a.bucket] }).remaining, 1);
  assert.equal(a.resetsAtMs, 20_001 * day);
});

await check("board keys are not the wallet's messaging keys", async () => {
  const k1 = await board.boardKeysFromSeed(new Uint8Array(32).fill(7));
  const k2 = await board.boardKeysFromSeed(new Uint8Array(32).fill(7));
  assert.equal(toHex(k1.x25519_pub), toHex(k2.x25519_pub), "derivation must be deterministic");
  assert.notEqual(toHex(k1.x25519_sk), toHex(opened.keys.x25519_sk));
});

await check("the prover probe says missing when nothing answers, without sending anything secret", async () => {
  const seen = [];
  const r = await board.probeProver({
    url: "http://127.0.0.1:9945",
    fetchImpl: async (u, init) => {
      seen.push({ u, body: init?.body });
      throw new TypeError("fetch failed");
    },
  });
  assert.equal(r, "missing");
  assert.deepEqual(seen.map((s) => [s.u, s.body]), [["http://127.0.0.1:9945/health", undefined]]);
  assert.equal(poster.ANON_PROVER_MISSING.length > 0, true);
});

globalThis.fetch = realFetch;
const ANON_SEND = /\b(postAnonymous|postAnonymousTo|answerAnonymously|runAnonPost)\s*\(/;

/** The smallest `{…}` block around `at` in `src` (or the whole source when there is none). */
function enclosingBlock(src, at) {
  let depth = 0;
  let start = 0;
  for (let i = at; i >= 0; i--) {
    if (src[i] === "}") depth++;
    else if (src[i] === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Where the try page could join and send anonymously in one action. */
function joinPostProblems(sources) {
  const problems = [];
  for (const [f, src] of Object.entries(sources)) {
    if (/\bregisterForAnon\s*\(/.test(src) && f !== "wallet.tsx") problems.push(`${f}: registers for the anonymity set outside wallet.tsx's joinAnon`);
    if (f === "wallet.tsx" && ANON_SEND.test(src)) problems.push(`${f}: the join code sends anonymously`);
    for (const m of src.matchAll(/\bjoinAnon\s*\(/g)) {
      // The handler that joins, up to its enclosing function: two levels out covers `onClick={() => {…}}`.
      const inner = enclosingBlock(src, m.index);
      const outer = enclosingBlock(src, Math.max(0, src.indexOf(inner) - 1));
      for (const b of [inner, outer.length < 4000 ? outer : ""]) {
        if (ANON_SEND.test(b)) problems.push(`${f}: joins and sends anonymously in one action`);
      }
    }
  }
  return [...new Set(problems)];
}

await check("SECURITY: joining the anonymity set and posting anonymously are never one action", () => {
  const dir = new URL("../app/try/", import.meta.url);
  const sources = Object.fromEntries(
    readdirSync(dir)
      .filter((n) => /\.tsx?$/.test(n))
      .map((n) => [n, readFileSync(new URL(n, dir), "utf8")]),
  );
  assert.deepEqual(joinPostProblems(sources), []);
  assert.match(sources["wallet.tsx"], /\bregisterForAnon\s*\(/, "wallet.tsx should hold the one join");
  const joins = Object.values(sources).join("\n").match(/\bjoinAnon\s*\(/g) ?? [];
  assert.ok(joins.length >= 2, "the board and the answers should both join through joinAnon");
});

await check("control: the join/post check catches join-then-post, a stray register and a sending join", () => {
  const cases = {
    "a.tsx": `async function onPost() { if (!anon.member) { await joinAnon(); } await postAnonymous(BASE, P, board, body, f); }`,
    "b.tsx": `<Button onClick={() => { void joinAnon().then(() => answerAnonymously(BASE, P, q, to, body, f)); }} />`,
    "c.tsx": `async function go() { await registerForAnon(BASE); }`,
    "wallet.tsx": `const joinAnon = async () => { await registerForAnon(BASE); await postAnonymousTo(BASE, P, to, t, f); };`,
  };
  for (const [f, src] of Object.entries(cases)) assert.ok(joinPostProblems({ [f]: src }).length >= 1, `${f} was not caught`);
  assert.deepEqual(joinPostProblems({ "ok2.tsx": `<B onClick={() => { void joinAnon(); }} /> <C onClick={() => void onPost()} />` }), []);
});

/** The property in (7), run against a label function. */
function anonymousHasNoDmTarget(label) {
  const rows = [
    { flags: { anonymous: true }, sender_wallet_id: "ab".repeat(32), anon_verdict: { state: "verified" } },
    { flags: { anonymous: true }, sender_wallet_id: "ab".repeat(32), anon_verdict: { state: "failed", reason: "x" } },
    { flags: { anonymous: true }, sender_wallet_id: "ab".repeat(32) },
  ];
  for (const r of rows) assert.equal(label(r).author, null, `an anonymous row (${r.anon_verdict?.state ?? "pending"}) gave an author`);
  assert.equal(label({ sender_wallet_id: "cd".repeat(32) }).author, "cd".repeat(32), "a named post lost its author");
}

await check("SECURITY: an anonymous post never yields an author, so it never offers a DM", () => {
  anonymousHasNoDmTarget(board.postLabel);
});

await check("control: a label that falls back to the row's sender is caught", () => {
  const leaky = (row) => ({ ...board.postLabel(row), author: board.postLabel(row).author ?? row.sender_wallet_id ?? null });
  assert.throws(() => anonymousHasNoDmTarget(leaky));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
