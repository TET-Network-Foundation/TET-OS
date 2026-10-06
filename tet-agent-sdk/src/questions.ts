/**
 * "AI asks a human" (Try TET part 5, docs/DEMO_NODE.md): an agent posts a question to a public
 * questions board and reads the answers people send it.
 *
 * - **The question** is an ordinary named Tmail from the agent's own key to the questions board
 *   wallet. The agent's Ed25519 key is a valid Tmail sender, so the node verifies it like any other
 *   message. The agent's `AgentManifestV1` rides inside, so a reader can see which wallet owns it.
 *   The board's read key is public (its invite is published), so the question is public.
 * - **Answers** are Tmail to the agent's wallet id: anonymous when the person has the native
 *   prover, named otherwise. Only the agent can decrypt them. The agent registers messaging keys,
 *   derived from its mnemonic exactly as the desktop and the try page derive a wallet's.
 * - **"Answered"** is a second named Tmail from the agent to the board, naming the question.
 *
 * The encryption, key derivation and envelope pre-image are ports of the UI's
 * (`tet-network/ui/app/lib/tmail_e2ee.ts`, `tmail_keys.ts`, `tmail.ts`), byte for byte. tet-core
 * verifies a question built here (`sdk_question_envelope_verifies_in_rust`) and the try page decrypts
 * and parses one (`scripts/try_questions_guard.mjs`).
 */
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { Kyber768 } from "crystals-kyber-js";

import { mldsa44SignDeterministic } from "./pqc_wasm.js";
import type { HybridKeyMaterial } from "./types.js";
import type { TetChainBinding } from "./agent.js";
import { normalizeMnemonicPhrase } from "./wallet_from_mnemonic.js";

export const QUESTION_KIND = "tet_question_v1";
export const ANSWERED_KIND = "tet_question_answered_v1";
export const ANSWER_KIND = "tet_answer_v1";
/** The longest question or note text: the same bound the UI puts on typed messages. */
export const MAX_TEXT_CHARS = 4096;
/**
 * The longest whole post. A manifest alone is ~7 KB (two ML-DSA-44 public keys and a signature),
 * so a question with its manifest exceeds the text bound; this keeps the envelope well inside a
 * gossip message.
 */
export const MAX_POST_BYTES = 16 * 1024;

const E2EE_SCHEME = "tet-e2ee-hybrid-v1";
const HKDF_INFO = new TextEncoder().encode("tet-e2ee-hybrid-v1");
const HKDF_SALT = new Uint8Array(32);
const X25519_INFO = new TextEncoder().encode("tet-tmail-x25519-v1");
const MLKEM_INFO = new TextEncoder().encode("tet-tmail-mlkem-v1");
const DEFAULT_FEE_MICRO = 100;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const hex = (u8: Uint8Array) => Buffer.from(u8).toString("hex");

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export type TmailKeys = {
  x25519_sk: Uint8Array;
  x25519_pub: Uint8Array;
  mlkem_sk: Uint8Array;
  mlkem_pub: Uint8Array;
};

/** The wallet's messaging keys from its mnemonic (UI `deriveTmailKeysFromMnemonic`). */
export async function deriveTmailKeys(mnemonic: string): Promise<TmailKeys> {
  const phrase = normalizeMnemonicPhrase(mnemonic);
  if (!validateMnemonic(phrase, wordlist)) throw new Error("invalid mnemonic");
  const seed = mnemonicToSeedSync(phrase, "");
  const x25519_sk = hkdf(sha256, seed, undefined, X25519_INFO, 32);
  const [mlkem_pub, mlkem_sk] = await new Kyber768().deriveKeyPair(hkdf(sha256, seed, undefined, MLKEM_INFO, 64));
  return { x25519_sk, x25519_pub: x25519.getPublicKey(x25519_sk), mlkem_sk, mlkem_pub };
}

function hybridKey(x: Uint8Array, k: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(x.length + k.length);
  ikm.set(x, 0);
  ikm.set(k, x.length);
  return hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32);
}

async function encryptFor(plaintext: Uint8Array, rx: Uint8Array, rk: Uint8Array) {
  if (rx.length !== 32) throw new Error("receiver x25519 key must be 32 bytes");
  if (rk.length !== 1184) throw new Error("receiver Kyber-768 key must be 1184 bytes");
  const esk = randomBytes(32);
  const [ct, shared] = await new Kyber768().encap(rk);
  const key = hybridKey(x25519.getSharedSecret(esk, rx), shared);
  const nonce = randomBytes(12);
  return { epk: x25519.getPublicKey(esk), ct, nonce, ciphertext: chacha20poly1305(key, nonce).encrypt(plaintext) };
}

async function decryptWith(row: TmailRow, keys: TmailKeys): Promise<Uint8Array> {
  const e = row.e2ee!;
  const shared = await new Kyber768().decap(unb64(e.mlkem_ciphertext_b64), keys.mlkem_sk);
  const key = hybridKey(x25519.getSharedSecret(keys.x25519_sk, unb64(e.client_ephemeral_pub_b64)), shared);
  return chacha20poly1305(key, unb64(e.nonce_b64)).decrypt(unb64(e.ciphertext_b64));
}

type Flags = { basic: boolean; time_lock: boolean; burn_after_read: boolean; anonymous: boolean };
const flagsCanonical = (f: Flags) =>
  `basic=${+f.basic},time_lock=${+f.time_lock},burn_after_read=${+f.burn_after_read},anonymous=${+f.anonymous}`;

/** UI `tmailEnvelopeAuthMessageBytes` / tet-core `tmail_envelope_auth_message_bytes`. */
export function tmailEnvelopeAuthMessageBytes(o: {
  chain: TetChainBinding;
  msgId: string;
  flags: Flags;
  sender: string;
  receiver: string;
  releaseAtMs: number;
  feeMicro: number;
  payloadSha256Hex: string;
  mldsaPubkeyB64: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `tet tmail envelope v1|chain_id=${o.chain.chainId}|genesis_hash=${o.chain.genesisHash}` +
      `|msg_id=${o.msgId.trim()}|flags=${flagsCanonical(o.flags)}` +
      `|sender=${o.sender.trim().toLowerCase()}|receiver=${o.receiver.trim().toLowerCase()}` +
      `|release_at_ms=${o.releaseAtMs}|fee_micro=${o.feeMicro}` +
      `|payload_sha256=${o.payloadSha256Hex}|mldsa_pk=${o.mldsaPubkeyB64.trim()}`,
  );
}

/** A named, end-to-end encrypted Tmail from `wallet` (UI `buildTmailEnvelopeV1`, basic flags). */
export async function buildNamedTmailEnvelope(o: {
  wallet: HybridKeyMaterial;
  chain: TetChainBinding;
  receiverWalletId: string;
  receiverX25519Pub: Uint8Array;
  receiverMlkemPub: Uint8Array;
  plaintext: string;
  msgId?: string;
  sentAtMs?: number;
}) {
  const receiver = o.receiverWalletId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(receiver)) throw new Error("receiver wallet id must be 64 hex chars");
  const sender = o.wallet.walletIdHex64.trim().toLowerCase();
  const enc = await encryptFor(new TextEncoder().encode(o.plaintext), o.receiverX25519Pub, o.receiverMlkemPub);
  const flags: Flags = { basic: true, time_lock: false, burn_after_read: false, anonymous: false };
  const msgId = o.msgId ?? globalThis.crypto.randomUUID();
  const msg = tmailEnvelopeAuthMessageBytes({
    chain: o.chain,
    msgId,
    flags,
    sender,
    receiver,
    releaseAtMs: 0,
    feeMicro: DEFAULT_FEE_MICRO,
    payloadSha256Hex: hex(sha256(enc.ciphertext)),
    mldsaPubkeyB64: o.wallet.mldsa44PubkeyB64,
  });
  return {
    v: 1,
    kind: "tmail_envelope_v1",
    msg_id: msgId,
    flags,
    sender_wallet_id: sender,
    receiver_wallet_id: receiver,
    sent_at_ms: o.sentAtMs ?? Date.now(),
    release_at_ms: 0,
    ttl_ms: DEFAULT_TTL_MS,
    fee_paid_micro: DEFAULT_FEE_MICRO,
    pin_stake_micro: 0,
    e2ee: {
      v: 1,
      scheme: E2EE_SCHEME,
      client_ephemeral_pub_b64: b64(enc.epk),
      client_mlkem_pub_b64: "",
      receiver_x25519_pub_b64: b64(o.receiverX25519Pub),
      receiver_mlkem_pub_b64: b64(o.receiverMlkemPub),
      mlkem_ciphertext_b64: b64(enc.ct),
      nonce_b64: b64(enc.nonce),
      ciphertext_b64: b64(enc.ciphertext),
    },
    hybrid_sig: {
      ed25519_pubkey_hex: sender,
      ed25519_sig_b64: b64(o.wallet.signEd25519(msg)),
      mldsa_pubkey_b64: o.wallet.mldsa44PubkeyB64,
      mldsa_sig_b64: await mldsa44SignDeterministic(o.wallet.mldsa44KeypairB64, msg),
    },
  };
}

/** UI `tmailKeyRegistrationAuthMessageBytes` / tet-core `tmail_key_registration_auth_message_bytes`. */
export function tmailKeyRegistrationAuthMessageBytes(o: {
  chain: TetChainBinding;
  walletId: string;
  x25519PubB64: string;
  mlkemPubB64: string;
  registeredAtMs: number;
  mldsaPubkeyB64: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `tet tmail key v1|chain_id=${o.chain.chainId}|genesis_hash=${o.chain.genesisHash}` +
      `|wallet_id=${o.walletId.trim().toLowerCase()}|x25519_pub=${o.x25519PubB64.trim()}` +
      `|mlkem_pub=${o.mlkemPubB64.trim()}|registered_at_ms=${o.registeredAtMs}|mldsa_pk=${o.mldsaPubkeyB64.trim()}`,
  );
}

function join(nodeUrl: string, path: string): string {
  return `${nodeUrl.replace(/\/+$/, "")}${path}`;
}

async function call(nodeUrl: string, path: string, init?: RequestInit): Promise<{ status: number; json: any; text: string }> {
  const r = await fetch(join(nodeUrl, path), {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, json, text };
}

/** Register the agent's messaging keys, so people can send it answers. Public by design. */
export async function registerAgentInbox(o: { nodeUrl: string; wallet: HybridKeyMaterial; keys: TmailKeys; chain: TetChainBinding }) {
  const registeredAtMs = Date.now();
  const walletId = o.wallet.walletIdHex64.toLowerCase();
  const x = b64(o.keys.x25519_pub);
  const k = b64(o.keys.mlkem_pub);
  const msg = tmailKeyRegistrationAuthMessageBytes({
    chain: o.chain,
    walletId,
    x25519PubB64: x,
    mlkemPubB64: k,
    registeredAtMs,
    mldsaPubkeyB64: o.wallet.mldsa44PubkeyB64,
  });
  const body = {
    wallet_id: walletId,
    x25519_pub_b64: x,
    mlkem_pub_b64: k,
    registered_at_ms: registeredAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: walletId,
      ed25519_sig_b64: b64(o.wallet.signEd25519(msg)),
      mldsa_pubkey_b64: o.wallet.mldsa44PubkeyB64,
      mldsa_sig_b64: await mldsa44SignDeterministic(o.wallet.mldsa44KeypairB64, msg),
    },
  };
  const r = await call(o.nodeUrl, `/tmail/keys/${walletId}`, { method: "PUT", body: JSON.stringify(body) });
  if (r.status !== 200) throw new Error(`key registration refused (HTTP ${r.status}): ${r.text.slice(0, 200)}`);
}

async function boardKeys(nodeUrl: string, boardWalletId: string) {
  const r = await call(nodeUrl, `/tmail/keys/${boardWalletId.trim().toLowerCase()}`);
  if (r.status !== 200 || !r.json?.registration) throw new Error(`no questions board ${boardWalletId} on this node`);
  return { x: unb64(r.json.registration.x25519_pub_b64), k: unb64(r.json.registration.mlkem_pub_b64) };
}

async function sendToBoard(o: {
  nodeUrl: string;
  wallet: HybridKeyMaterial;
  chain: TetChainBinding;
  questionsBoardWalletId: string;
  body: unknown;
}): Promise<string> {
  const text = JSON.stringify(o.body);
  if (new TextEncoder().encode(text).length > MAX_POST_BYTES) throw new Error(`the post is larger than ${MAX_POST_BYTES} bytes`);
  const keys = await boardKeys(o.nodeUrl, o.questionsBoardWalletId);
  const env = await buildNamedTmailEnvelope({
    wallet: o.wallet,
    chain: o.chain,
    receiverWalletId: o.questionsBoardWalletId,
    receiverX25519Pub: keys.x,
    receiverMlkemPub: keys.k,
    plaintext: text,
  });
  const r = await call(o.nodeUrl, "/tmail/send", { method: "POST", body: JSON.stringify(env) });
  if (r.status < 200 || r.status >= 300) throw new Error(`the node refused the post (HTTP ${r.status}): ${r.text.slice(0, 200)}`);
  return env.msg_id;
}

/**
 * Post a question to the questions board, as the agent. `manifest` is the owner's
 * `AgentManifestV1` for this agent's key; without one, readers see the agent's key and no owner.
 */
export async function postQuestion(o: {
  nodeUrl: string;
  wallet: HybridKeyMaterial;
  chain: TetChainBinding;
  questionsBoardWalletId: string;
  question: string;
  manifest?: unknown;
}): Promise<{ msgId: string }> {
  if (!o.question.trim()) throw new Error("the question is empty");
  if (o.question.length > MAX_TEXT_CHARS) throw new Error(`the question is longer than ${MAX_TEXT_CHARS} characters`);
  const msgId = await sendToBoard({
    ...o,
    body: { v: 1, kind: QUESTION_KIND, question: o.question, asked_at_ms: Date.now(), manifest: o.manifest ?? null },
  });
  return { msgId };
}

/** Tell the board a question is answered. Readers honour it only from the key that asked. */
export async function markAnswered(o: {
  nodeUrl: string;
  wallet: HybridKeyMaterial;
  chain: TetChainBinding;
  questionsBoardWalletId: string;
  questionMsgId: string;
  note?: string;
}): Promise<{ msgId: string }> {
  if ((o.note ?? "").length > MAX_TEXT_CHARS) throw new Error(`the note is longer than ${MAX_TEXT_CHARS} characters`);
  const msgId = await sendToBoard({
    ...o,
    body: { v: 1, kind: ANSWERED_KIND, question_msg_id: o.questionMsgId, note: o.note ?? "" },
  });
  return { msgId };
}

type TmailRow = {
  msg_id: string;
  sender_wallet_id: string;
  sent_at_ms: number;
  flags?: { anonymous?: boolean };
  anon_verdict?: { state?: string };
  e2ee?: { client_ephemeral_pub_b64: string; mlkem_ciphertext_b64: string; nonce_b64: string; ciphertext_b64: string };
};

export type Answer = {
  msgId: string;
  questionMsgId: string;
  answer: string;
  sentAtMs: number;
  /** Who sent it: a wallet id for a named answer; for an anonymous one, the node's verdict. */
  from: { kind: "named"; walletId: string } | { kind: "anonymous"; verdict: "verified" | "pending" | "failed" };
};

/** The answers in the agent's inbox, newest first. Anonymous answers are "verified" only on the node's verdict. */
export async function readAnswers(o: { nodeUrl: string; wallet: HybridKeyMaterial; keys: TmailKeys }): Promise<Answer[]> {
  const r = await call(o.nodeUrl, `/tmail/inbox/${o.wallet.walletIdHex64.toLowerCase()}?limit=100`);
  if (r.status !== 200) throw new Error(`could not read the inbox (HTTP ${r.status})`);
  const out: Answer[] = [];
  for (const row of (r.json?.messages ?? []) as TmailRow[]) {
    if (!row.e2ee) continue;
    let body: any;
    try {
      body = JSON.parse(new TextDecoder().decode(await decryptWith(row, o.keys)));
    } catch {
      continue;
    }
    if (body?.kind !== ANSWER_KIND || typeof body.answer !== "string" || typeof body.question_msg_id !== "string") continue;
    const anonymous = row.flags?.anonymous === true;
    const v = row.anon_verdict?.state;
    out.push({
      msgId: row.msg_id,
      questionMsgId: body.question_msg_id,
      answer: body.answer,
      sentAtMs: row.sent_at_ms,
      from: anonymous
        ? { kind: "anonymous", verdict: v === "verified" ? "verified" : v === "failed" ? "failed" : "pending" }
        : { kind: "named", walletId: row.sender_wallet_id },
    });
  }
  return out;
}
