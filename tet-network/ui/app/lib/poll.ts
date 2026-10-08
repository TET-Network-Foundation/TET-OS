/**
 * Anonymous polls in a thread (docs/plans/MEMBERS_POLL.md): options set by the thread's author; one
 * vote per member; results public; ballots unlinkable to keys.
 *
 * - **A poll** has its own wallet (made like a board's); its definition is posted in the thread as
 *   a named post by the author: question, options, the poll's invite, its day, and, for a
 *   members-only poll, how many members it lists (the list itself is on the node: it wouldn't fit
 *   in a post).
 * - **A ballot** is an anonymous post to the poll's wallet: `{"vote": n}`. Everyone in this node's
 *   anonymity set can vote in an open poll; in a members-only poll the proof is against the poll's
 *   own member tree. The poll's wallet signs the member list; **the node** builds the tree's root
 *   from its own registry (tet-core tmail/poll.rs), so a poll can't list invented members. Voters
 *   take the list and root from the node, not from the thread post.
 * - **One vote per member:** a nullifier is one per (member, receiver, UTC day) and the node refuses
 *   a second ballot with the same nullifier; the poll closes at 00:00 UTC on the day it opens, and
 *   the node refuses ballots after that. Every poll (open or members-only) is registered, so its
 *   wallet stores only verified ballots and none can be crowded out.
 * - **The tally** counts only ballots the node verified. Anyone who can read the thread sees votes
 *   as they arrive. A vote is hidden only among the listed members (or the anonymity set); the
 *   node still sees voters' IP addresses.
 */
import { sha256 } from "@noble/hashes/sha2";
import { anonCommitment, fromHex, tmailBucketIndex, toHex } from "./anon_tree.mjs";
import { expectedChainBinding } from "./chain_binding";
import { mnemonicToTetEd25519Keypair, signTetEd25519 } from "./ed25519_tet";
import { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic, pqcInit } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { createBoard, openBoard, postAnonymousTo, readBoard, boardRecipient } from "./try_board";
import type { AnonSendState } from "./tmail_anon";
import { tetCoreUrl } from "./tet_core_http";

export const POLL_KIND = "tet_poll_v1";
export const POLL_MAX_OPTIONS = 6;
/** tet-core's POLL_MIN_MEMBERS: with one or two listed, a ballot all but names its voter. */
export const POLL_MIN_MEMBERS = 3;
/** tet-core's POLL_MAX_MEMBERS, and the most ballots one tally reads. */
export const POLL_MAX_BALLOTS = 1000;

export type PollDef = {
  kind: typeof POLL_KIND;
  invite: string;
  question: string;
  options: string[];
  /** UTC day the poll is open (it closes at the next 00:00 UTC). */
  day: number;
  /** How many members a members-only poll lists, or null: everyone in this node's anonymity set. */
  members: number | null;
};

/** The poll definition's text, as posted in the thread. */
export function encodePoll(def: PollDef): string {
  return JSON.stringify(def);
}

/** A poll definition from a post's text, or null if it isn't one (or is malformed). */
export function parsePoll(text: string): PollDef | null {
  let j: unknown;
  try {
    j = JSON.parse(text.trim());
  } catch {
    return null;
  }
  const p = j as Partial<PollDef>;
  if (!p || p.kind !== POLL_KIND || typeof p.invite !== "string" || typeof p.question !== "string") return null;
  if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > POLL_MAX_OPTIONS || !p.options.every((o) => typeof o === "string" && o.trim())) return null;
  if (typeof p.day !== "number" || !Number.isInteger(p.day)) return null;
  const members = p.members === null ? null : Number.isInteger(p.members) && (p.members as number) > 0 ? (p.members as number) : undefined;
  if (members === undefined) return null;
  return { kind: POLL_KIND, invite: p.invite, question: p.question, options: p.options, day: p.day, members };
}

/** Is the poll still open (its UTC day)? */
export function pollOpen(def: PollDef, nowMs: number): boolean {
  return tmailBucketIndex(nowMs) === def.day;
}

async function fetchJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const r = await fetch(tetCoreUrl(baseUrl, path), init);
  let json: Record<string, unknown> | null = null;
  try {
    json = await r.json();
  } catch {
    /* not JSON */
  }
  return { status: r.status, json };
}

/** The listed members' commitments, in the tree's canonical order (wallet id ascending). */
export async function memberLeaves(baseUrl: string, members: string[]): Promise<Uint8Array[]> {
  const ids = [...new Set(members.map((m) => m.trim().toLowerCase()))].sort();
  const leaves: Uint8Array[] = [];
  for (const id of ids) {
    const r = await fetchJson(baseUrl, `/tmail/anon/commitment/${id}`);
    if (r.status === 404) throw new Error(`${id.slice(0, 8)}… is not a registered member`);
    if (r.status !== 200 || typeof r.json?.commitment_hex !== "string") throw new Error(`couldn't read the member list from the node (HTTP ${r.status}); try again in a minute`);
    leaves.push(fromHex(r.json.commitment_hex as string));
  }
  return leaves;
}

/** A members-only poll as the node registered it: the signed list and the node's root. */
export async function nodePollRoot(baseUrl: string, pollWallet: string): Promise<{ members: string[]; rootHex: string; day: number } | null> {
  const r = await fetchJson(baseUrl, `/tmail/poll/root/${pollWallet}`);
  const p = r.json?.poll_root as { root_hex?: string | null; poll?: { members?: string[]; bucket_index?: number } } | undefined;
  if (r.status !== 200 || !p?.root_hex || !Array.isArray(p.poll?.members)) return null;
  return { members: p.poll.members, rootHex: p.root_hex, day: Number(p.poll.bucket_index) };
}

/**
 * Create a poll: its wallet, and for a members-only poll its member root, signed by that wallet and
 * registered with the node. Returns the definition to post in the thread.
 */
export async function createPoll(baseUrl: string, question: string, options: string[], members: string[] | null): Promise<PollDef> {
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (opts.length < 2 || opts.length > POLL_MAX_OPTIONS) throw new Error(`A poll has 2 to ${POLL_MAX_OPTIONS} options.`);
  const { board, ownerWords } = await createBoard(baseUrl, `Poll: ${question.slice(0, 60)}`);
  const day = tmailBucketIndex(Date.now());
  let ids: string[] = [];
  if (members) {
    ids = [...new Set(members.map((m) => m.trim().toLowerCase()).filter(Boolean))].sort();
    if (ids.length < POLL_MIN_MEMBERS) throw new Error(`List at least ${POLL_MIN_MEMBERS} members, or make the poll open to everyone.`);
    const bad = ids.find((m) => !/^[0-9a-f]{64}$/.test(m));
    if (bad) throw new Error(`Not a wallet id: ${bad.slice(0, 16)}`);
  }
  // Every poll is registered (an open one with no list), so its wallet takes only verified ballots.
  await registerPollRoot(baseUrl, ownerWords, board.boardWalletId, ids, day);
  const count = members ? ids.length : null;
  return { kind: POLL_KIND, invite: board.invite, question: question.trim(), options: opts, day, members: count };
}

/** Sign (with the poll wallet's words) and register a poll (its member list, empty if open): tet-core's pre-image. */
async function registerPollRoot(baseUrl: string, pollWords: string, pollWallet: string, members: string[], day: number): Promise<void> {
  await pqcInit();
  const ed = mnemonicToTetEd25519Keypair(pollWords);
  if (ed.walletIdHex.toLowerCase() !== pollWallet) throw new Error("internal: poll words don't match the poll wallet");
  const pqc = await mldsa44KeypairFromMnemonic(pollWords);
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const registeredAtMs = Date.now();
  const membersSha = toHex(sha256(new TextEncoder().encode(members.join(","))));
  const msg = new TextEncoder().encode(
    `tet tmail poll root v1|chain_id=${chainId}|genesis_hash=${genesisHash}|poll_wallet_id=${pollWallet}|members_sha256=${membersSha}|bucket_index=${day}|registered_at_ms=${registeredAtMs}|mldsa_pk=${pqc.pubkey_b64.trim()}`,
  );
  const body = {
    v: 1,
    kind: "tmail_poll_root_v1",
    poll_wallet_id: pollWallet,
    members,
    bucket_index: day,
    registered_at_ms: registeredAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: pollWallet,
      ed25519_sig_b64: u8ToStdBase64(await Promise.resolve(signTetEd25519(ed.secretKey, msg))),
      mldsa_pubkey_b64: pqc.pubkey_b64,
      mldsa_sig_b64: await mldsa44SignDeterministic(pqc.keypair_b64, msg),
    },
  };
  const r = await fetchJson(baseUrl, "/tmail/poll/root", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status !== 202) throw new Error(String(r.json?.error ?? `the node refused the poll (HTTP ${r.status})`));
}

/** Cast an anonymous ballot (through the native prover). */
export async function vote(baseUrl: string, proverUrl: string, def: PollDef, choice: number, onState: (s: AnonSendState) => void): Promise<AnonSendState> {
  if (!(choice >= 0 && choice < def.options.length)) throw new Error("Not an option of this poll.");
  const poll = await openBoard(baseUrl, def.invite);
  let memberTree: { leaves: Uint8Array[]; rootHex: string } | undefined;
  if (def.members) {
    // The node's list and root, not the post's: the post is only a pointer.
    const reg = await nodePollRoot(baseUrl, poll.boardWalletId);
    if (!reg) throw new Error("This node doesn't have this poll's member list (polls are kept on the node they were made on).");
    memberTree = { leaves: await memberLeaves(baseUrl, reg.members), rootHex: reg.rootHex };
  }
  return postAnonymousTo(baseUrl, proverUrl, boardRecipient(poll), JSON.stringify({ vote: choice }), onState, memberTree);
}

export type Tally = { counts: number[]; verified: number; unverified: number; capped?: boolean };

/** Count the ballots: only those the node verified (one per nullifier, the node refuses repeats). */
export async function tally(baseUrl: string, def: PollDef): Promise<Tally> {
  const poll = await openBoard(baseUrl, def.invite);
  const posts = await readBoard(baseUrl, poll, POLL_MAX_BALLOTS);
  return { ...countBallots(posts, def.options.length), capped: posts.length >= POLL_MAX_BALLOTS };
}

type BallotPost = { state: string; text?: string; label: { kind: string; tone: string } };

/** Pure: verified anonymous `{"vote": n}` posts per option; anything else isn't a vote. */
export function countBallots(posts: BallotPost[], nOptions: number): Tally {
  const counts = Array.from({ length: nOptions }, () => 0);
  let verified = 0;
  let unverified = 0;
  for (const p of posts) {
    if (p.label.kind !== "anonymous" || p.state !== "open") continue;
    let n: number;
    try {
      n = Number((JSON.parse(p.text ?? "") as { vote?: unknown }).vote);
    } catch {
      continue;
    }
    if (!Number.isInteger(n) || n < 0 || n >= nOptions) continue;
    if (p.label.tone === "ok") {
      counts[n]++;
      verified++;
    } else {
      unverified++;
    }
  }
  return { counts, verified, unverified };
}

/** This tab's own commitment (to tell a member whether they're on a members-only poll's list). */
export function myCommitmentHex(memberSecret: Uint8Array): string {
  return toHex(anonCommitment(memberSecret));
}
