/**
 * Guards for the poster's side of an anonymous send — `app/lib/anon_poster.mjs` and
 * `app/lib/anon_tree.mjs`. Plain Node, no build step: `node scripts/anon_poster_guard.mjs`.
 * CI runs it in the `ui` job.
 *
 * 1. GOLDEN — the client derivations reproduce the vector tet-core pins in
 *    `anon_client_derivations_match_the_golden_vector`.
 * 2. SECURITY REGRESSION GUARD: the poster names itself to nobody. Every request the real
 *    `runAnonPost` makes to the node is recorded against a fake node, and none may carry the
 *    poster's wallet id, registry commitment or member secret. The node-side half is
 *    `anonymous_post_names_no_poster_to_the_node` in tet-core.
 *    Negative control (run, recorded in the commit): `runAnonPost` also requests
 *    `/tmail/anon/path/<commitment>` → FAILED.
 * 3. SECURITY REGRESSION GUARD: anonymous mode never takes the named send path, which signs with
 *    the user's own wallet. Negative control: `sendPathFor` returns "named" → FAILED.
 * 4. Every send ends. With no native prover the send ends in `failed` with ANON_PROVER_MISSING
 *    (a real refused connection, not a mock); a prover that never answers ends the send at the
 *    budget; a real local HTTP prover takes it to `sent`. Each run has a watchdog, so "stuck in
 *    proving" fails the guard instead of hanging it.
 *    Negative controls: `runAnonPost` awaits `prove` without `withinBudget` → FAILED (watchdog);
 *    `makeHelperProver` throws a plain Error on a refused connection → FAILED (message).
 */

import http from "node:http";
import { sha256 } from "@noble/hashes/sha2";
import {
  anonCommitment,
  anonEmptyHashes,
  anonMemberSecretFromBip39Seed,
  anonRootAndPath,
  tmailEphemeralSeed,
  toHex,
} from "../app/lib/anon_tree.mjs";
import {
  ANON_PROVER_MISSING,
  ANONYMOUS_SENTINEL,
  makeHelperProver,
  prewarmAnonProof,
  runAnonPost,
  sendPathFor,
} from "../app/lib/anon_poster.mjs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const fill = (n, b) => new Uint8Array(n).fill(b);

// ---- 1. golden vector -----------------------------------------------------------------------
const GOLDEN = {
  commitment7: "d1b67499baa9328884e4a9dcec455e95ba73d7720d62ccf750bf5a090b153eb1",
  root3: "817ca6b003ce70734406be37a3ae6a3141e4f7f52eb57e82bfd699c4a2c000b8",
  siblings3_sha: "2340a53722d8c4790d73d50f4aa1cf8f2bf4f718bee4f921083ceb0f5ca37051",
  emptyRoot: "554bab803f49ba2b3018008f1ce581365ccc662db3c21964e3a6f15d325ef1a3",
  ephemeral: "2cabb7226c4dccf14bc47735b4e462f380241e2ef46ae00b0495943bad0c6599",
  // Client-only (tet-core never sees the mnemonic); pinned so it cannot drift silently.
  memberSecret: "8b22ef7f46a7694f166f5311ac9e9c38db7092f897aa9ff1df9d8c5af28c397e",
};
{
  const leaves = [1, 2, 3].map((b) => anonCommitment(fill(32, b)));
  const { root, siblings } = anonRootAndPath(leaves, 2);
  const sib = sha256(Uint8Array.from(siblings.flatMap((s) => [...s])));
  check("golden: commitment", toHex(anonCommitment(fill(32, 7))) === GOLDEN.commitment7);
  check("golden: 3-leaf root", toHex(root) === GOLDEN.root3);
  check("golden: path of leaf 2", toHex(sib) === GOLDEN.siblings3_sha);
  check("golden: empty root", toHex(anonRootAndPath([], -1).root) === GOLDEN.emptyRoot);
  check("golden: empty root is E[20]", toHex(anonEmptyHashes()[20]) === GOLDEN.emptyRoot);
  check(
    "golden: ephemeral seed",
    toHex(tmailEphemeralSeed(fill(32, 7), fill(32, 0xab), 20000)) === GOLDEN.ephemeral,
  );
  check(
    "golden: member secret",
    toHex(anonMemberSecretFromBip39Seed(fill(64, 9))) === GOLDEN.memberSecret,
  );
}

// ---- a fake node that records what it is asked ----------------------------------------------
const POSTER_WALLET = "17".repeat(32);
const memberSecret = fill(32, 0x42);
const mine = toHex(anonCommitment(memberSecret));
const others = [1, 2, 3, 4].map((b) => anonCommitment(fill(32, b)));

function fakeNode({ includePoster = true, fastRegistered = false } = {}) {
  const leaves = includePoster ? [others[0], anonCommitment(memberSecret), ...others.slice(1)] : others;
  const root = toHex(anonRootAndPath(leaves, -1).root);
  const requests = [];
  const node = async (path, init = {}) => {
    requests.push(`${init.method ?? "GET"} ${path} ${init.body ?? ""}`);
    const url = new URL(path, "http://node");
    if (url.pathname === "/tmail/anon/leaves") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const page = leaves.slice(offset, offset + 2); // tiny pages: paging is exercised
      const next = offset + 2 < leaves.length ? offset + 2 : null;
      return {
        status: 200,
        json: {
          ok: true, epoch: 7, merkle_root: root, total: leaves.length,
          leaves: page.map(toHex), next_offset: next, next_epoch_at_ms: 8000,
        },
      };
    }
    if (url.pathname === "/tmail/anon/receipt") return { status: 200, json: { ok: true } };
    if (url.pathname.startsWith("/tmail/anon/fast/")) return { status: 200, json: { ok: true, registered: fastRegistered } };
    if (url.pathname === "/tmail/send") {
      return { status: 202, json: { ok: true, msg_id: JSON.parse(init.body).msg_id } };
    }
    return { status: 404, json: null };
  };
  return { node, requests };
}

function deps(node, states, proveCalls) {
  return {
    node,
    now: () => 1_700_000_000_000,
    onState: (s) => states.push(s.state),
    ephemeralWalletId: async (seed) => toHex(sha256(seed)),
    prove: async (params) => {
      proveCalls.push(params);
      return {
        receipt_b64: "cmVjZWlwdA==",
        journal_b64: "am91cm5hbA==",
        image_id_hex: "00".repeat(32),
        receipt_sha256_hex: "ab".repeat(32),
      };
    },
    buildEnvelope: async (a) => ({
      _proof: a.proof,
      msg_id: "m-1",
      sender_wallet_id: ANONYMOUS_SENTINEL,
      receiver_wallet_id: a.receiverWalletId,
      sent_at_ms: a.sentAtMs,
      anonymous: { ephemeral_wallet_id: a.ephemeralWalletId },
      hybrid_sig: { ed25519_pubkey_hex: a.ephemeralWalletId },
    }),
  };
}

// ---- 2. the poster names itself to nobody ---------------------------------------------------
{
  const { node, requests } = fakeNode();
  const states = [];
  const proveCalls = [];
  const out = await runAnonPost(deps(node, states, proveCalls), {
    memberSecret,
    receiverWalletId: "cd".repeat(32),
    plaintext: "hello",
  });
  check("anonymous send reaches sent", out.state === "sent", JSON.stringify(out));
  check(
    "states in order",
    states.join(">") === "loading_set>proving>depositing>sending>sent",
    states.join(">"),
  );
  const needles = [POSTER_WALLET, mine, toHex(memberSecret)];
  const leaking = requests.filter((r) => needles.some((n) => r.toLowerCase().includes(n)));
  check(
    "SECURITY: no request to the node names the poster",
    leaking.length === 0,
    leaking.length ? leaking[0].slice(0, 160) : `${requests.length} requests`,
  );
  check(
    "SECURITY: no wallet-keyed registry route is used",
    !requests.some((r) => /\/tmail\/anon\/(path|send|job)\b/.test(r)),
  );
  check(
    "the member secret goes to the local prover only",
    proveCalls.length === 1 && proveCalls[0].secret_hex === toHex(memberSecret),
  );
  const sent = requests.find((r) => r.startsWith("POST /tmail/send"));
  const env = sent ? JSON.parse(sent.slice("POST /tmail/send ".length)) : null;
  check(
    "the envelope's sender is the sentinel and its signer is the ephemeral",
    env?.sender_wallet_id === ANONYMOUS_SENTINEL &&
      env?.hybrid_sig?.ed25519_pubkey_hex === env?.anonymous?.ephemeral_wallet_id,
  );
}

// A wallet whose commitment is not in the set stops after the download and says why.
{
  const { node, requests } = fakeNode({ includePoster: false });
  const proveCalls = [];
  const out = await runAnonPost(deps(node, [], proveCalls), {
    memberSecret,
    receiverWalletId: "cd".repeat(32),
    plaintext: "hello",
  });
  check("not in the set → not_in_set", out.state === "not_in_set" && out.nextEpochAtMs === 8000);
  check(
    "not in the set → nothing but the registry download",
    proveCalls.length === 0 && requests.every((r) => r.startsWith("GET /tmail/anon/leaves")),
  );
}

// ---- 5. fast anonymous posting (docs/plans/FAST_ANON_POSTING.md) ----------------------------
// A known member whose posting key is registered today: one question, one send, no proof, nothing
// that names the poster. Not registered: the full path, with the proof. A caller that doesn't know
// it's a member, and a poll, never ask about the posting key; the background prewarm never does.
// Negative control (run by hand, recorded in the commit): the `input.knownMember` condition removed
// from `runAnonPost` → "never asks about the posting key unless known to be a member" FAILED.
{
  const needles = [POSTER_WALLET, mine, toHex(memberSecret)];
  {
    const { node, requests } = fakeNode({ fastRegistered: true });
    const states = [];
    const proveCalls = [];
    const out = await runAnonPost(deps(node, states, proveCalls), { memberSecret, receiverWalletId: "cd".repeat(32), plaintext: "fast", knownMember: true });
    const sent = requests.find((r) => r.startsWith("POST /tmail/send"));
    const env = sent ? JSON.parse(sent.slice("POST /tmail/send ".length)) : null;
    check("fast: a registered key posts at once, with no proof", out.state === "sent" && out.fast === true && proveCalls.length === 0 && env?._proof === null, states.join(">"));
    check("fast: one question and one send, no registry download", requests.length === 2 && requests[0].startsWith("GET /tmail/anon/fast/") && requests[1].startsWith("POST /tmail/send"), requests.map((r) => r.slice(0, 40)).join(" | "));
    check("SECURITY: fast: no request names the poster", !requests.some((r) => needles.some((n) => r.toLowerCase().includes(n))));
  }
  {
    const { node, requests } = fakeNode({ fastRegistered: false });
    const proveCalls = [];
    const out = await runAnonPost(deps(node, [], proveCalls), { memberSecret, receiverWalletId: "cd".repeat(32), plaintext: "first", knownMember: true });
    const sent = requests.find((r) => r.startsWith("POST /tmail/send"));
    const env = sent ? JSON.parse(sent.slice("POST /tmail/send ".length)) : null;
    check("fast: an unregistered key takes the full path, with its proof", out.state === "sent" && proveCalls.length === 1 && env?._proof !== null);
  }
  {
    const { node, requests } = fakeNode({ fastRegistered: true });
    await runAnonPost(deps(node, [], []), { memberSecret, receiverWalletId: "cd".repeat(32), plaintext: "x" });
    const leaves = [anonCommitment(memberSecret)];
    const { node: n2, requests: r2 } = fakeNode({ fastRegistered: true });
    await runAnonPost(deps(n2, [], []), { memberSecret, receiverWalletId: "cd".repeat(32), plaintext: "ballot", knownMember: true, memberTree: { leaves, rootHex: toHex(anonRootAndPath(leaves, -1).root) } });
    check("SECURITY: never asks about the posting key unless known to be a member", !requests.some((r) => r.includes("/tmail/anon/fast/")));
    check("SECURITY: a poll never takes the fast path", !r2.some((r) => r.includes("/tmail/anon/fast/")));
  }
  {
    const { node, requests } = fakeNode({ fastRegistered: true });
    const proveCalls = [];
    const cache = new Map();
    const d = { ...deps(node, [], proveCalls), proofCache: cache };
    const r1 = await prewarmAnonProof(d, { memberSecret, receiverWalletId: "cd".repeat(32), registeredToday: true });
    check("prewarm: a key the tab knows is registered → nothing asked, nothing proved", r1 === "registered" && requests.length === 0 && proveCalls.length === 0);
    const r2 = await prewarmAnonProof(d, { memberSecret, receiverWalletId: "cd".repeat(32) });
    const r3 = await prewarmAnonProof(d, { memberSecret, receiverWalletId: "cd".repeat(32) });
    check("SECURITY: prewarm never asks the node about the posting key", r2 === "started" && r3 === "cached" && proveCalls.length === 1 && !requests.some((r) => r.includes("/tmail/anon/fast/")));
  }
}

// ---- 6. members-only trees (polls, Shelter) -------------------------------------------------
// Shelter has its own member tree and allows fast posts (allowFast); a poll never does. Neither
// takes a cached proof: that one is against the node's open anonymity set, not the member tree.
// Negative control (run by hand, recorded in the commit): the memberTree condition removed from
// the cache lookup → "a member tree never takes a cached proof" FAILED.
{
  const leaves = [others[0], anonCommitment(memberSecret), others[1]];
  const tree = { leaves, rootHex: toHex(anonRootAndPath(leaves, -1).root) };
  {
    const { node, requests } = fakeNode({ fastRegistered: true });
    const out = await runAnonPost(deps(node, [], []), { memberSecret, receiverWalletId: "cd".repeat(32), plaintext: "s", knownMember: true, memberTree: tree, allowFast: true });
    check("Shelter (member tree + allowFast) takes the fast path", out.state === "sent" && out.fast === true && requests.some((r) => r.includes("/tmail/anon/fast/")));
  }
  {
    const { node, requests } = fakeNode({ fastRegistered: false });
    const proveCalls = [];
    const cache = new Map([[`${"cd".repeat(32)}:${Math.floor(1_700_000_000_000 / 86_400_000)}`, Promise.resolve({ receipt_b64: "x", journal_b64: "x", image_id_hex: "11".repeat(32), receipt_sha256_hex: "cached" })]]);
    const d = { ...deps(node, [], proveCalls), proofCache: cache };
    const out = await runAnonPost(d, { memberSecret, receiverWalletId: "cd".repeat(32), plaintext: "s", knownMember: true, memberTree: tree, allowFast: true });
    check("SECURITY: a member tree never takes a cached proof", out.state === "sent" && proveCalls.length === 1 && !requests.some((r) => r.includes('"cached"')));
  }
}

// ---- 3. anonymous mode never takes the named path -------------------------------------------
check("SECURITY: anonymous mode uses the anonymous path", sendPathFor({ anonymous: true }) === "anonymous");
check("named mode uses the named path", sendPathFor({ anonymous: false }) === "named");

// ---- 4. every send ends -----------------------------------------------------------------------
const WATCHDOG_MS = 5000;
async function endsWithin(run) {
  let timer;
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ state: "still running", reason: `after ${WATCHDOG_MS} ms` }), WATCHDOG_MS);
  });
  try {
    return await Promise.race([run(), watchdog]);
  } finally {
    clearTimeout(timer);
  }
}
const input = { memberSecret, receiverWalletId: "cd".repeat(32), plaintext: "hello" };

// No prover: a port that was just closed, so the refusal is real.
{
  const port = await new Promise((resolve) => {
    const srv = http.createServer().listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
  const { node } = fakeNode();
  const states = [];
  const d = { ...deps(node, states, []), prove: makeHelperProver({ url: `http://127.0.0.1:${port}` }) };
  const out = await endsWithin(() => runAnonPost(d, input));
  check(
    "no native prover → failed with the documented message",
    out.state === "failed" && out.reason.startsWith(ANON_PROVER_MISSING),
    JSON.stringify(out),
  );
  check("…and the last state is not proving", states[states.length - 1] === "failed", states.join(">"));
}

// A prover that never answers: the send's own budget ends it.
{
  const { node } = fakeNode();
  const d = { ...deps(node, [], []), prove: () => new Promise(() => {}), proveBudgetMs: 100 };
  const t0 = Date.now();
  const out = await endsWithin(() => runAnonPost(d, input));
  check(
    "a silent prover → failed at the budget, not proving forever",
    out.state === "failed" && /did not finish/.test(out.reason) && Date.now() - t0 < WATCHDOG_MS,
    JSON.stringify(out),
  );
}

// A daemon built without its guest answers 503: that is "no usable prover", said the same way.
{
  const { node } = fakeNode();
  const fetchImpl = async () => new Response('{"error":"guest ELF empty"}', { status: 503 });
  const d = { ...deps(node, [], []), prove: makeHelperProver({ fetchImpl }) };
  const out = await endsWithin(() => runAnonPost(d, input));
  check("prover without its guest → the documented message", out.state === "failed" && out.reason.startsWith(ANON_PROVER_MISSING), JSON.stringify(out));
}

// A real local HTTP prover: the request it receives, and a send that reaches sent.
{
  let seen = null;
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { path: req.url, body: JSON.parse(body) };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        receipt_b64: "cmVjZWlwdA==", journal_b64: "am91cm5hbA==",
        image_id_hex: "00".repeat(32), receipt_sha256_hex: "ab".repeat(32),
      }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { node } = fakeNode();
  const d = { ...deps(node, [], []), prove: makeHelperProver({ url: `http://127.0.0.1:${srv.address().port}` }) };
  const out = await endsWithin(() => runAnonPost(d, input));
  srv.close();
  check("local prover → sent", out.state === "sent", JSON.stringify(out));
  check(
    "the prover gets the guest inputs, path computed by the client",
    seen?.path === "/prove_anon" && seen.body.siblings_hex.length === 20 && seen.body.index === 1,
    seen ? `index=${seen.body.index}` : "no request",
  );
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
