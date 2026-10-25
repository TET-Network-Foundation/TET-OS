// Try TET part 5, end to end: an agent (the built tet-agent-sdk) asks, a visitor (the page's own
// modules) answers, through the page's `/tet-node-api` proxy to a tet-core in public mode. Not a CI
// step (needs a running node, the UI, and `npm run build` in tet-agent-sdk); the PR records it.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3100 node --experimental-strip-types scripts/try_questions_e2e.mjs
//
//   1. The operator starts a questions board (the page's createBoard); its invite is "published".
//   2. An owner signs a manifest for a new agent key (the page's signAgentManifest).
//   3. The agent registers an inbox and posts a question with the SDK.
//   4. A visitor opens the board from the invite: the question shows its owner, verified.
//   5. The visitor answers named; the agent's SDK reads it. An anonymous answer with no prover is
//      refused and nothing is sent.
//   6. A stranger posts an "answered" note: ignored. The agent's own note: answered.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3100").replace(/\/+$/, "");
const BASE = "/tet-node-api";
const NODE_URL = `${ORIGIN}${BASE}`;

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => realFetch(String(input).startsWith("/") ? ORIGIN + String(input) : input, init);
console.error = () => {};

const sdk = await import("../../../tet-agent-sdk/dist/index.js");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { createBoard, openBoard, postNamed } = await import("../app/lib/try_board.ts");
const { signAgentManifest } = await import("../app/lib/agent_manifest.ts");
const tq = await import("../app/lib/try_questions.ts");
const { ANSWERED_KIND } = await import("../app/lib/questions.mjs");
const step = (s) => console.log(`\n== ${s}`);

const c = await (await realFetch(`${NODE_URL}/chain`)).json();
const chain = { chainId: c.chain_id, genesisHash: c.genesis_hash };

step("1. the operator starts a questions board");
const { board } = await createBoard(BASE, "Questions");
const invite = board.invite;
console.log(`  board ${board.boardWalletId.slice(0, 12)}…, invite published (${invite.length} chars)`);

step("2. an owner signs a manifest for a new agent key");
const agentWords = generateDisposableWords();
const ownerWords = generateDisposableWords();
const agent = await sdk.loadHybridWalletFromMnemonic(agentWords);
const now = Date.now();
const manifest = await signAgentManifest({
  ownerWords,
  chain,
  agentId: "grammar-helper",
  agentEd25519PubkeyHex: agent.walletIdHex64,
  agentMldsa44PubkeyB64: agent.mldsa44PubkeyB64,
  createdAtMs: now,
  expiresAtMs: now + 30 * 86_400_000,
  declaredAutomated: true,
  capabilities: ["ask:questions"],
});
console.log(`  agent ${agent.walletIdHex64.slice(0, 12)}…, owner ${manifest.owner_wallet_id.slice(0, 12)}…`);

step("3. the agent registers an inbox and asks, with the SDK");
const agentKeys = await sdk.deriveTmailKeys(agentWords);
await sdk.registerAgentInbox({ nodeUrl: NODE_URL, wallet: agent, keys: agentKeys, chain });
const { msgId: qid } = await sdk.postQuestion({
  nodeUrl: NODE_URL,
  wallet: agent,
  chain,
  questionsBoardWalletId: board.boardWalletId,
  question: "Which is right: 'fewer people' or 'less people'?",
  manifest,
});
console.log(`  question ${qid}`);

step("4. a visitor opens the board from the invite");
const visitorWords = generateDisposableWords();
const visitor = await activateTryWallet(visitorWords);
const opened = await openBoard(BASE, `https://try.example/try#board=${invite}`);
let qs = await tq.readQuestions(BASE, opened);
assert.equal(qs.length, 1);
const q = qs[0];
console.log(`  "${q.question}"  owner: ${JSON.stringify(q.owner)}  answered: ${q.answered}`);
assert.equal(q.owner.state, "verified");
assert.equal(q.owner.owner, manifest.owner_wallet_id);
assert.equal(q.sender, agent.walletIdHex64);

step("5. the visitor answers; the agent reads it");
const to = await tq.askerInbox(BASE, q);
assert.ok(to, "the agent's inbox is registered");
const states = [];
const anon = await tq.answerAnonymously(BASE, "http://127.0.0.1:9945", q, to, "anonymous: fewer", (s) => states.push(s.state));
console.log(`  anonymous, no prover: ${anon.state} (${anon.reason ?? ""}) after ${states.join(" → ")}`);
assert.equal(anon.state === "failed" || anon.state === "not_in_set", true);
await tq.answerNamed(BASE, q, to, "'Fewer people': people are countable.");
const answers = await sdk.readAnswers({ nodeUrl: NODE_URL, wallet: agent, keys: agentKeys });
for (const a of answers) console.log(`  agent reads: "${a.answer}" from ${JSON.stringify(a.from)} for ${a.questionMsgId}`);
assert.equal(answers.length, 1, "only the named answer arrived");
assert.deepEqual(answers[0].from, { kind: "named", walletId: visitor });
assert.equal(answers[0].questionMsgId, qid);

step("6. answered: a stranger's note is ignored, the agent's counts");
await postNamed(BASE, opened, JSON.stringify({ v: 1, kind: ANSWERED_KIND, question_msg_id: qid, note: "fake" }));
qs = await tq.readQuestions(BASE, opened);
console.log(`  after a stranger's note: answered=${qs[0].answered}`);
assert.equal(qs[0].answered, false);
await sdk.markAnswered({ nodeUrl: NODE_URL, wallet: agent, chain, questionsBoardWalletId: board.boardWalletId, questionMsgId: qid });
qs = await tq.readQuestions(BASE, opened);
console.log(`  after the agent's note:  answered=${qs[0].answered}`);
assert.equal(qs[0].answered, true);

console.log("\nall steps passed");
