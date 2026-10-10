/**
 * Try TET, part 5: the questions window's node-facing side. Rules in `questions.mjs`.
 *
 * - **Read:** open the questions board from its public invite (part 1's `openBoard`, which checks
 *   the invite's keys against the node), decrypt every row, classify it, and resolve each asker's
 *   owner from its manifest on this node's chain.
 * - **Answer:** a Tmail to the question's signed sender, named or anonymous (part 1's send paths).
 *   The asker must have registered an inbox; without one there is nowhere to send.
 */

import { answerBody, answerRecipient, classifyBoardItem, questionsWithStatus, resolveOwner } from "./questions.mjs";
import { b64ToBytes } from "./encoding";
import { mldsa44Verify } from "./pqc";
import { decryptForReceiver } from "./tmail_e2ee";
import { getTmailInbox } from "./tet_core_http";
import { trustedKeysFor } from "./key_trust";
import { postAnonymousTo, postNamedTo, type OpenBoard, type Recipient } from "./try_board";
import type { AnonSendState } from "./tmail_anon";

/** A question as the window shows it (`questions.mjs` `questionsWithStatus` plus its owner). */
export type Question = {
  type: "question";
  msgId: string;
  /** The envelope's signed sender: the agent's key, and where answers go. */
  sender: string;
  signer: { edHex: string; mldsaPubB64: string };
  sentAtMs: number;
  question: string;
  manifest: unknown;
  answered: boolean;
  owner:
    | { state: "verified"; agentId: string; owner: string; expiresAtMs: number; declaredAutomated: boolean }
    | { state: "none" }
    | { state: "invalid"; reason: string };
};

async function nodeChain(baseUrl: string): Promise<{ chainId: string; genesisHash: string }> {
  const r = await fetch(`${baseUrl}/chain`);
  const j = r.ok ? await r.json() : null;
  if (!j?.chain_id || !j?.genesis_hash) throw new Error("could not read this node's chain");
  return { chainId: j.chain_id, genesisHash: j.genesis_hash };
}

/** The board's questions, newest first, with their owners and answered state. */
export async function readQuestions(baseUrl: string, board: OpenBoard): Promise<Question[]> {
  const r = await getTmailInbox(baseUrl, board.boardWalletId, 100);
  if (!r.ok) throw new Error(r.text || `could not read the questions (HTTP ${r.status})`);
  const items = [];
  for (const row of r.messages) {
    if (!row.e2ee) continue;
    try {
      const pt = await decryptForReceiver(
        {
          client_ephemeral_pub: b64ToBytes(row.e2ee.client_ephemeral_pub_b64),
          mlkem_ciphertext: b64ToBytes(row.e2ee.mlkem_ciphertext_b64),
          nonce: b64ToBytes(row.e2ee.nonce_b64),
          ciphertext: b64ToBytes(row.e2ee.ciphertext_b64),
        },
        board.keys.x25519_sk,
        board.keys.mlkem_sk,
      );
      items.push(classifyBoardItem(row, new TextDecoder().decode(pt)));
    } catch {
      /* not readable with this invite: not a question */
    }
  }
  const qs = questionsWithStatus(items) as Omit<Question, "owner">[];
  if (qs.length === 0) return [];
  const chain = await nodeChain(baseUrl);
  const nowMs = Date.now();
  return Promise.all(
    qs.map(async (q) => ({ ...q, owner: (await resolveOwner({ question: q, chain, nowMs, mldsa44Verify })) as Question["owner"] })),
  );
}

/** The asker's inbox, or `null` when it has registered none. */
export async function askerInbox(baseUrl: string, q: Question): Promise<Recipient | null> {
  const to = answerRecipient(q);
  // Only keys the agent's own wallet signed (checked here, not trusted from the node).
  const k = await trustedKeysFor(baseUrl, to);
  if (!k.ok) {
    if (k.reason === "none") return null;
    throw new Error(k.message);
  }
  return { walletId: to, x25519Pub: k.x25519Pub, mlkemPub: k.mlkemPub };
}

export async function answerNamed(baseUrl: string, q: Question, to: Recipient, answer: string): Promise<string> {
  return postNamedTo(baseUrl, to, answerBody(q.msgId, answer));
}

export async function answerAnonymously(
  baseUrl: string,
  proverUrl: string,
  q: Question,
  to: Recipient,
  answer: string,
  onState: (s: AnonSendState) => void,
): Promise<AnonSendState> {
  return postAnonymousTo(baseUrl, proverUrl, to, answerBody(q.msgId, answer), onState);
}
