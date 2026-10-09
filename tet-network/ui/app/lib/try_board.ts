/**
 * Try TET, part 1: the board's node-facing side. The rules live in `board.mjs`; this file signs
 * and sends.
 *
 * - **Create:** a new board wallet (its own 12 words) registers the board's seed-derived keys with
 *   `PUT /tmail/keys`. It signs with a signer local to this call, so the visitor's own wallet
 *   session is never touched or replaced.
 * - **Open:** an invite resolves to the board only if the node's registered keys equal the keys
 *   the invite derives.
 * - **Read:** the board's inbox, decrypted in the tab with the invite's keys, each row labelled by
 *   `postLabel`.
 * - **Post named:** an ordinary Tmail from the visitor's wallet to the board.
 * - **Post anonymously:** `runAnonPost` with the native prover, exactly as the desktop does. It
 *   names nothing about the poster to the node.
 */

import {
  boardKeysFromSeed,
  boardPublicKeysB64,
  encodeInvite,
  inviteMatchesRegistration,
  newBoardSeed,
  parseInvite,
  postLabel,
  shownOnBoard,
} from "./board.mjs";
import { generateDisposableWords } from "./disposable_wallet.mjs";
import { fetchAnonLeaves, makeHelperProver, prewarmAnonProof, runAnonPost, type AnonProof } from "./anon_poster.mjs";
import { anonCommitment, toHex } from "./anon_tree.mjs";
import { expectedChainBinding } from "./chain_binding";
import { mnemonicToTetEd25519Keypair, signTetEd25519 } from "./ed25519_tet";
import { b64ToBytes } from "./encoding";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic, pqcInit } from "./pqc";
import { buildAnonymousTmailEnvelopeV1, buildTmailEnvelopeV1, ephemeralWalletIdFromSeed } from "./tmail";
import { buildTmailAnonRegistrationV1, type AnonSendState } from "./tmail_anon";
import { decryptForReceiver } from "./tmail_e2ee";
import { tmailKeyRegistrationAuthMessageBytes, type TmailKeyRegistrationV1 } from "./tmail_keys";
import { getHybridSignerSession, setHybridSignerSession } from "./hybrid_signer_session";
import { encodeAnnouncement, parseListings } from "./board_directory.mjs";
import { getTmailKeySession } from "./tmail_session";
import {
  anonNodeAdapter,
  getTmailAnonRoot,
  getTmailInbox,
  getTmailKeys,
  postTmailAnonRegister,
  postTmailSend,
  putTmailKeys,
} from "./tet_core_http";

export type BoardKeys = Awaited<ReturnType<typeof boardKeysFromSeed>>;

/** An open board: what the invite holds, plus the keys it derives. */
export type OpenBoard = {
  boardWalletId: string;
  name: string;
  invite: string;
  keys: BoardKeys;
};

export type BoardPost = {
  msgId: string;
  sentAtMs: number;
  label: ReturnType<typeof postLabel>;
} & ({ state: "open"; text: string } | { state: "unreadable" });

/**
 * Create a board: new board wallet, new seed, keys registered on the node. Returns the invite and
 * the board wallet's 12 words (needed only to re-register its keys; they are not in the invite).
 */
export async function createBoard(
  baseUrl: string,
  name: string,
): Promise<{ board: OpenBoard; ownerWords: string }> {
  await pqcInit();
  const ownerWords = generateDisposableWords();
  const ed = mnemonicToTetEd25519Keypair(ownerWords);
  const walletId = ed.walletIdHex.toLowerCase();
  const pqc = await mldsa44KeypairFromMnemonic(ownerWords);
  const seed = newBoardSeed();
  const keys = await boardKeysFromSeed(seed);
  const pub = boardPublicKeysB64(keys);
  const registeredAtMs = Date.now();
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const msg = tmailKeyRegistrationAuthMessageBytes({
    walletId,
    x25519PubB64: pub.x25519_pub_b64,
    mlkemPubB64: pub.mlkem_pub_b64,
    registeredAtMs,
    mldsaPubkeyB64: pqc.pubkey_b64,
    chainId,
    genesisHash,
  });
  const reg: TmailKeyRegistrationV1 = {
    wallet_id: walletId,
    x25519_pub_b64: pub.x25519_pub_b64,
    mlkem_pub_b64: pub.mlkem_pub_b64,
    registered_at_ms: registeredAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: walletId,
      ed25519_sig_b64: u8ToStdBase64(await signTetEd25519(ed.secretKey, msg)),
      mldsa_pubkey_b64: pqc.pubkey_b64,
      mldsa_sig_b64: await mldsa44SignDeterministic(pqc.keypair_b64, msg),
    },
  };
  const r = await putTmailKeys(baseUrl, walletId, reg);
  if (!r.ok) throw new Error(r.text || `the node refused the board's keys (HTTP ${r.status})`);
  const invite = encodeInvite({ boardWalletId: walletId, seed, name });
  return { board: { boardWalletId: walletId, name: name.trim(), invite, keys }, ownerWords };
}

/** Open a board from an invite, checking its keys against the node's registration. */
export async function openBoard(baseUrl: string, inviteText: string): Promise<OpenBoard> {
  const inv = parseInvite(inviteText);
  const keys = await boardKeysFromSeed(inv.seed);
  const r = await getTmailKeys(baseUrl, inv.boardWalletId);
  if (!r.ok) throw new Error(r.text || `could not look up the board (HTTP ${r.status})`);
  if (!r.registration) throw new Error("This node has no board with that id.");
  if (!inviteMatchesRegistration(keys, r.registration)) {
    throw new Error("This invite doesn't match the board's registered keys: it is for another board, or altered.");
  }
  return {
    boardWalletId: inv.boardWalletId,
    name: inv.name,
    invite: encodeInvite({ boardWalletId: inv.boardWalletId, seed: inv.seed, name: inv.name }),
    keys,
  };
}

/** What the page says when the node answers 410: its operator stopped serving this board. */
export const HIDDEN_BOARD = "This node no longer serves this board: its operator hid it. Hiding is local to this node; see Terms.";

/** The board's posts, newest first, decrypted with the invite's keys. */
export async function readBoard(baseUrl: string, board: OpenBoard, limit = 100): Promise<BoardPost[]> {
  const r = await getTmailInbox(baseUrl, board.boardWalletId, limit);
  if (r.status === 410) throw new Error(HIDDEN_BOARD);
  if (!r.ok) throw new Error(r.text || `could not read the board (HTTP ${r.status})`);
  const out: BoardPost[] = [];
  for (const row of r.messages) {
    const base = { msgId: row.msg_id, sentAtMs: row.sent_at_ms, label: postLabel(row) };
    if (!shownOnBoard(base.label)) continue;
    if (!row.e2ee) {
      out.push({ ...base, state: "unreadable" });
      continue;
    }
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
      out.push({ ...base, state: "open", text: new TextDecoder().decode(pt) });
    } catch {
      out.push({ ...base, state: "unreadable" });
    }
  }
  return out;
}

/** Where a Tmail goes: a wallet id and its messaging public keys. */
export type Recipient = { walletId: string; x25519Pub: Uint8Array; mlkemPub: Uint8Array };

export const boardRecipient = (board: OpenBoard): Recipient => ({
  walletId: board.boardWalletId,
  x25519Pub: board.keys.x25519_pub,
  mlkemPub: board.keys.mlkem_pub,
});

/** A named post: an ordinary Tmail from the visitor's wallet, which the board shows. */
export async function postNamed(baseUrl: string, board: OpenBoard, text: string): Promise<string> {
  return postNamedTo(baseUrl, boardRecipient(board), text);
}

/** A named Tmail from the visitor's wallet to `to`. */
export async function postNamedTo(baseUrl: string, to: Recipient, text: string): Promise<string> {
  const sess = getHybridSignerSession();
  if (!sess) throw new Error("Create a disposable wallet first.");
  const env = await buildTmailEnvelopeV1({
    senderWalletId: sess.walletIdHex64,
    receiverWalletId: to.walletId,
    plaintextUtf8: text,
    receiverX25519Pub: to.x25519Pub,
    receiverMlkemPub: to.mlkemPub,
    baseUrl,
  });
  const r = await postTmailSend(baseUrl, env);
  if (!r.ok) throw new Error(r.text || `the node refused the post (HTTP ${r.status})`);
  return r.msgId ?? env.msg_id;
}

/** How many members the node's anonymity set has (the set you'd be anonymous among). */
export async function anonSetSize(baseUrl: string): Promise<number | null> {
  const r = await getTmailAnonRoot(baseUrl);
  return r.ok ? (r.members ?? null) : null;
}

/**
 * Is this tab's wallet in the node's anonymity set yet, how big is the set, and when does the next
 * epoch start (a registration takes effect then)? Downloads the whole registry, as a post does:
 * the request names no wallet.
 */
export async function anonMembership(
  baseUrl: string,
): Promise<{ member: boolean; members: number; nextEpochAtMs: number } | null> {
  const ks = getTmailKeySession();
  if (!ks) return null;
  const set = await fetchAnonLeaves(anonNodeAdapter(baseUrl));
  const mine = toHex(anonCommitment(ks.anonMemberSecret));
  return {
    member: set.leaves.some((l: Uint8Array) => toHex(l) === mine),
    members: set.leaves.length,
    nextEpochAtMs: set.nextEpochAtMs,
  };
}

/** Join the anonymity set. Public by design: it says this wallet is a member, not what it posts. */
export async function registerForAnon(baseUrl: string): Promise<string> {
  const ks = getTmailKeySession();
  if (!ks) throw new Error("Create a disposable wallet first.");
  const reg = await buildTmailAnonRegistrationV1({ memberSecret: ks.anonMemberSecret, baseUrl });
  const r = await postTmailAnonRegister(baseUrl, reg);
  if (!r.ok) throw new Error(r.text || `registration failed (HTTP ${r.status})`);
  return r.outcome ?? "registered";
}

/** An anonymous post, the desktop's path: nothing sent to the node names the poster. */
export async function postAnonymous(
  baseUrl: string,
  proverUrl: string,
  board: OpenBoard,
  text: string,
  onState: (s: AnonSendState) => void,
): Promise<AnonSendState> {
  return postAnonymousTo(baseUrl, proverUrl, boardRecipient(board), text, onState);
}

/** An anonymous Tmail to `to`, through the native prover. Nothing sent to the node names the sender. */
/** Today's proofs started in the background, by `board:bucket` (fast anonymous posting). */
const PROOF_CACHE = new Map<string, Promise<AnonProof>>();

/**
 * When a member opens a board: start today's proof for it in the background, unless this node
 * already has today's posting key registered. The first anonymous post then needn't wait the whole
 * ~30 s; every later one that day is instant (docs/plans/FAST_ANON_POSTING.md).
 */
export async function prewarmBoardProof(baseUrl: string, proverUrl: string, board: OpenBoard): Promise<string> {
  const ks = getTmailKeySession();
  if (!ks) return "no wallet";
  return prewarmAnonProof(
    { node: anonNodeAdapter(baseUrl), prove: makeHelperProver({ url: proverUrl }), ephemeralWalletId: ephemeralWalletIdFromSeed, now: () => Date.now(), proofCache: PROOF_CACHE },
    { memberSecret: ks.anonMemberSecret, receiverWalletId: board.boardWalletId },
  );
}

export async function postAnonymousTo(
  baseUrl: string,
  proverUrl: string,
  to: Recipient,
  text: string,
  onState: (s: AnonSendState) => void,
  memberTree?: { leaves: Uint8Array[]; rootHex: string },
): Promise<AnonSendState> {
  const ks = getTmailKeySession();
  if (!ks) return { state: "failed", reason: "Create a disposable wallet first." };
  return (await runAnonPost(
    {
      node: anonNodeAdapter(baseUrl),
      prove: makeHelperProver({ url: proverUrl }),
      proofCache: PROOF_CACHE,
      ephemeralWalletId: ephemeralWalletIdFromSeed,
      buildEnvelope: (a: {
        ephemeralSeed: Uint8Array;
        ephemeralWalletId: string;
        receiverWalletId: string;
        plaintext: string;
        sentAtMs: number;
        proof: { journal_b64: string; image_id_hex: string; receipt_sha256_hex: string } | null;
      }) =>
        buildAnonymousTmailEnvelopeV1({
          ephemeralSeed: a.ephemeralSeed,
          ephemeralWalletId: a.ephemeralWalletId,
          receiverWalletId: a.receiverWalletId,
          plaintextUtf8: a.plaintext,
          receiverX25519Pub: to.x25519Pub,
          receiverMlkemPub: to.mlkemPub,
          sentAtMs: a.sentAtMs,
          proof: a.proof,
          baseUrl,
        }),
      now: () => Date.now(),
      onState,
    },
    { memberSecret: ks.anonMemberSecret, receiverWalletId: to.walletId, plaintext: text, memberTree },
  )) as AnonSendState;
}

/**
 * List a public board in the directory: a named post to the directory, signed by **the board's own
 * wallet** (its 12 words), which is the only signature the directory accepts for that board
 * (`board_directory.mjs`). The tab's own wallet is restored afterwards, whatever happens; a post
 * from this tab racing this one fails on the sender check rather than being signed by the board.
 */
export async function announceBoard(baseUrl: string, directory: OpenBoard, board: OpenBoard, boardWords: string): Promise<string> {
  await pqcInit();
  const ed = mnemonicToTetEd25519Keypair(boardWords);
  const wid = ed.walletIdHex.toLowerCase();
  if (wid !== board.boardWalletId) throw new Error("Those 12 words are not this board's wallet.");
  const pqc = await mldsa44KeypairFromMnemonic(boardWords);
  const previous = getHybridSignerSession();
  setHybridSignerSession({
    walletIdHex64: wid,
    signEd25519: (buf) => signTetEd25519(ed.secretKey, buf),
    mldsa44_keypair_b64: pqc.keypair_b64,
    mldsa44_pubkey_b64: pqc.pubkey_b64,
    displayAddress: `${wid.slice(0, 10)}…`,
  });
  try {
    return await postNamedTo(baseUrl, boardRecipient(directory), encodeAnnouncement(board.invite, Date.now()));
  } finally {
    setHybridSignerSession(previous);
  }
}

/** The public boards the directory lists (its newest 200 posts), newest listing first. */
export async function readDirectory(baseUrl: string, directory: OpenBoard) {
  const posts = await readBoard(baseUrl, directory, 200);
  return parseListings(
    posts.flatMap((p) =>
      p.state === "open" ? [{ msgId: p.msgId, sentAtMs: p.sentAtMs, sender: p.label.author ?? "", named: p.label.kind === "named", text: p.text }] : [],
    ),
  );
}

