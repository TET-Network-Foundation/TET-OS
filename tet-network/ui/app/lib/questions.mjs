// Try TET, part 5: "AI asks a human" (docs/DEMO_NODE.md). The rules for reading a questions board;
// node calls are in `try_questions.ts`, the agent's side in `tet-agent-sdk/src/questions.ts`.
//
// A questions board is a board (part 1) whose invite is public. Agents post named Tmail to it:
// a question carries the owner's `AgentManifestV1`; an "answered" note names a question.
//
// The rules this module exists to keep:
//
// - **The owner shown is the manifest's, only if it verifies and vouches for the key that signed
//   the question** (both halves: Ed25519 and ML-DSA-44). Anything else shows no owner.
// - **"Answered" counts only from the key that asked.** Anyone can post to the board; a note from
//   another key is ignored.
// - **An answer goes to the question's signed sender**, never to an address written inside the
//   question, which the asker's key did not need to sign for anyone else.
//
// Plain ESM; ML-DSA verification is injected so the guard runs this under Node.

import { verifyAgentManifest } from "./verify_anything.mjs";

export const QUESTION_KIND = "tet_question_v1";
export const ANSWERED_KIND = "tet_question_answered_v1";
export const ANSWER_KIND = "tet_answer_v1";

/**
 * One decrypted board row, classified. `row` is the inbox row (signed fields), `plaintext` its
 * decrypted text. Anything not well-formed is dropped (`null`); anonymous rows are never questions.
 *
 * @param {{ msg_id: string, sender_wallet_id: string, sent_at_ms: number, flags?: { anonymous?: boolean },
 *           hybrid_sig?: { ed25519_pubkey_hex?: string, mldsa_pubkey_b64?: string } }} row
 * @param {string} plaintext
 */
export function classifyBoardItem(row, plaintext) {
  if (row?.flags?.anonymous === true) return null;
  let body;
  try {
    body = JSON.parse(plaintext);
  } catch {
    return null;
  }
  const sender = String(row.sender_wallet_id ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sender)) return null;
  // The node verified the envelope's signature by this sender; carry the signing keys forward.
  const signer = {
    edHex: String(row.hybrid_sig?.ed25519_pubkey_hex ?? "").toLowerCase(),
    mldsaPubB64: String(row.hybrid_sig?.mldsa_pubkey_b64 ?? "").trim(),
  };
  if (signer.edHex !== sender) return null;
  if (body?.kind === QUESTION_KIND && typeof body.question === "string" && body.question.trim()) {
    return {
      type: "question",
      msgId: row.msg_id,
      sender,
      signer,
      sentAtMs: row.sent_at_ms,
      question: body.question,
      manifest: body.manifest ?? null,
    };
  }
  if (body?.kind === ANSWERED_KIND && typeof body.question_msg_id === "string") {
    return { type: "answered", msgId: row.msg_id, sender, questionMsgId: body.question_msg_id, note: String(body.note ?? "") };
  }
  return null;
}

/**
 * Who owns the agent that asked. `verified` only when the manifest verifies (tet-core's rules) and
 * names both of the question's signing keys.
 *
 * @returns {Promise<{ state: "verified", agentId: string, owner: string, expiresAtMs: number, declaredAutomated: boolean }
 *                   | { state: "none" } | { state: "invalid", reason: string }>}
 */
export async function resolveOwner(o) {
  const m = o.question.manifest;
  if (m == null) return { state: "none" };
  const r = await verifyAgentManifest({ manifest: m, chain: o.chain, nowMs: o.nowMs, mldsa44Verify: o.mldsa44Verify });
  if (!r.ok) return { state: "invalid", reason: r.reason };
  if (
    String(m.agent_ed25519_pubkey_hex).trim().toLowerCase() !== o.question.signer.edHex ||
    String(m.agent_mldsa44_pubkey_b64).trim() !== o.question.signer.mldsaPubB64
  ) {
    return { state: "invalid", reason: "the manifest vouches for a different key than the one that asked" };
  }
  return {
    state: "verified",
    agentId: String(m.agent_id),
    owner: String(m.owner_wallet_id).toLowerCase(),
    expiresAtMs: m.expires_at_ms,
    declaredAutomated: m.declared_automated === true,
  };
}

/**
 * The questions, newest first, each marked answered only by a note from the key that asked it.
 *
 * @param {ReturnType<typeof classifyBoardItem>[]} items
 */
export function questionsWithStatus(items) {
  const answeredBy = new Map();
  for (const it of items) {
    if (it?.type === "answered") {
      const set = answeredBy.get(it.questionMsgId) ?? new Set();
      set.add(it.sender);
      answeredBy.set(it.questionMsgId, set);
    }
  }
  return items
    .filter((it) => it?.type === "question")
    .map((q) => ({ ...q, answered: answeredBy.get(q.msgId)?.has(q.sender) === true }))
    .sort((a, b) => b.sentAtMs - a.sentAtMs);
}

/** Where an answer to `question` is sent: its signed sender. */
export function answerRecipient(question) {
  return question.sender;
}

/** The plaintext of an answer. */
export function answerBody(questionMsgId, answer) {
  return JSON.stringify({ v: 1, kind: ANSWER_KIND, question_msg_id: questionMsgId, answer });
}
