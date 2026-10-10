// Seed a local Try TET for a click-through: boards, a demo inbox, an agent asking a question, and
// verify-panel samples. Uses the page's own modules and the agent SDK (built). Writes everything to
// OUT_DIR and prints a JSON summary. Local use only.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3100 OUT_DIR=/path node --experimental-strip-types scripts/try_local_setup.mjs

import { register } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3100").replace(/\/+$/, "");
const OUT = process.env.OUT_DIR || "./try-local";
const BASE = "/tet-node-api";
const NODE_URL = `${ORIGIN}${BASE}`;
mkdirSync(OUT, { recursive: true });

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => realFetch(String(input).startsWith("/") ? ORIGIN + String(input) : input, init);
console.error = () => {};

const sdk = await import("../../../tet-agent-sdk/dist/index.js");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");
const { createBoard, postNamed, openBoard } = await import("../app/lib/try_board.ts");
const { signAgentManifest } = await import("../app/lib/agent_manifest.ts");
const { getTmailKeySession } = await import("../app/lib/tmail_session.ts");
const { buildTmailKeyRegistrationV1 } = await import("../app/lib/tmail_keys.ts");
const { putTmailKeys } = await import("../app/lib/tet_core_http.ts");

const c = await (await realFetch(`${NODE_URL}/chain`)).json();
const chain = { chainId: c.chain_id, genesisHash: c.genesis_hash };

// The demo inbox: a wallet the operator reads in the desktop (/os). Its keys are registered here.
const contactWords = generateDisposableWords();
const contactId = await activateTryWallet(contactWords);
{
  const ks = getTmailKeySession();
  const reg = await buildTmailKeyRegistrationV1({ x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub, baseUrl: BASE });
  const r = await putTmailKeys(BASE, contactId, reg);
  if (!r.ok) throw new Error(`demo inbox keys: ${r.text}`);
}

// A test board with one named welcome post, and the public questions board.
const { board: testBoard, ownerWords: testBoardWords } = await createBoard(BASE, "Local test board");
const opened = await openBoard(BASE, testBoard.invite);
await postNamed(BASE, opened, "Welcome to the local test board. This post is named: it shows the demo inbox's wallet id.");
const { board: questions, ownerWords: questionsWords } = await createBoard(BASE, "Questions");

// An agent, vouched for by an owner, asks a question.
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
const agentKeys = await sdk.deriveTmailKeys(agentWords);
await sdk.registerAgentInbox({ nodeUrl: NODE_URL, wallet: agent, keys: agentKeys, chain });
const { msgId: questionId } = await sdk.postQuestion({
  nodeUrl: NODE_URL,
  wallet: agent,
  chain,
  questionsBoardWalletId: questions.boardWalletId,
  question: "Which is right in formal English: 'fewer people' or 'less people'? One line is enough.",
  manifest,
});

// Verify-panel samples: a text signed by the agent on this chain, its .sig.json, the manifest, a pin.
const text = "This sentence was signed by the grammar-helper agent on the local Try TET chain.\n";
const envelope = await sdk.signPayloadEnvelope(agent, "text/plain", new TextEncoder().encode(text), chain);
const samples = join(OUT, "verify-samples");
mkdirSync(samples, { recursive: true });
writeFileSync(join(samples, "signed.txt"), text);
writeFileSync(join(samples, "signed.txt.sig.json"), JSON.stringify(envelope, null, 2) + "\n");
writeFileSync(join(samples, "agent.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(samples, "pin.json"), JSON.stringify({
  agent_ed25519_pubkey_hex: agent.walletIdHex64,
  agent_mldsa44_keyid: envelope.signatures.find((s) => s.keyid.startsWith("tet-mldsa44:")).keyid,
}, null, 2) + "\n");
writeFileSync(join(samples, "edited.txt"), text.replace("signed", "SIGNED"));

const summary = {
  chain,
  demo_contact: { wallet_id: contactId, words: contactWords },
  test_board: { invite_url: `${ORIGIN}/try#board=${testBoard.invite}`, board_wallet_words: testBoardWords },
  questions_board: { invite: questions.invite, wallet_id: questions.boardWalletId, board_wallet_words: questionsWords },
  agent: { wallet_id: agent.walletIdHex64, words: agentWords, owner_wallet_id: manifest.owner_wallet_id, owner_words: ownerWords, question_msg_id: questionId },
  verify_samples_dir: samples,
};
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
