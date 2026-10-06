/**
 * "AI asks a human" (Try TET part 5): the agent's side against what the try page produces.
 *
 * - `readAnswers` reads an answer the PAGE built (`ui_answer_envelope_v1.json`, from
 *   `tet-network/ui/scripts/make_answer_fixture.mjs`), with keys the SDK derives itself.
 * - An anonymous answer is reported "verified" only on the node's verdict.
 * - An answer to someone else, or not an answer, is not returned.
 *
 * The other direction (the page reads the SDK's question) is `scripts/try_questions_guard.mjs`, and
 * tet-core verifies both envelopes in Rust.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadHybridWalletFromMnemonic } from "../src/wallet_from_mnemonic.js";
import { deriveTmailKeys, readAnswers } from "../src/questions.js";

const testdata = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "tet-core", "src", "testdata");
const answerDoc = JSON.parse(readFileSync(join(testdata, "ui_answer_envelope_v1.json"), "utf8"));
const manDoc = JSON.parse(readFileSync(join(testdata, "agent_manifest_v1.json"), "utf8"));

function serveInbox(rows: unknown[]) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, messages: rows }), { status: 200 })) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

const row = () => ({ ...answerDoc.envelope });

describe("the agent reads the try page's answers", () => {
  test("a named answer from the page is decrypted and attributed to its sender", async () => {
    const wallet = await loadHybridWalletFromMnemonic(manDoc.agent_mnemonic);
    expect(wallet.walletIdHex64).toBe(answerDoc.envelope.receiver_wallet_id);
    const keys = await deriveTmailKeys(manDoc.agent_mnemonic);
    const restore = serveInbox([row()]);
    try {
      const answers = await readAnswers({ nodeUrl: "http://node.test", wallet, keys });
      expect(answers).toHaveLength(1);
      expect(answers[0]!.answer).toBe(answerDoc.answer);
      expect(answers[0]!.questionMsgId).toBe(answerDoc.question_msg_id);
      expect(answers[0]!.from).toEqual({ kind: "named", walletId: answerDoc.answerer_wallet_id });
    } finally {
      restore();
    }
  });

  test("an anonymous answer is verified only on the node's verdict", async () => {
    const wallet = await loadHybridWalletFromMnemonic(manDoc.agent_mnemonic);
    const keys = await deriveTmailKeys(manDoc.agent_mnemonic);
    const anon = (verdict?: string) => ({
      ...row(),
      msg_id: `m-${verdict ?? "none"}`,
      sender_wallet_id: "anonymous",
      flags: { ...answerDoc.envelope.flags, anonymous: true },
      ...(verdict ? { anon_verdict: { state: verdict } } : {}),
    });
    const restore = serveInbox([anon(), anon("pending"), anon("verified"), anon("failed")]);
    try {
      const answers = await readAnswers({ nodeUrl: "http://node.test", wallet, keys });
      expect(answers.map((a) => a.from)).toEqual([
        { kind: "anonymous", verdict: "pending" },
        { kind: "anonymous", verdict: "pending" },
        { kind: "anonymous", verdict: "verified" },
        { kind: "anonymous", verdict: "failed" },
      ]);
    } finally {
      restore();
    }
  });

  test("another wallet cannot read the answer, and non-answers are skipped", async () => {
    const stranger = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
    const wallet = await loadHybridWalletFromMnemonic(stranger);
    const keys = await deriveTmailKeys(stranger);
    const restore = serveInbox([row(), { ...row(), e2ee: undefined }]);
    try {
      expect(await readAnswers({ nodeUrl: "http://node.test", wallet, keys })).toEqual([]);
    } finally {
      restore();
    }
  });
});
