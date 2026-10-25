// Try TET, part 1: the anonymous board (docs/DEMO_NODE.md).
//
// A board is an ordinary Tmail wallet that people post to. What makes it a board:
//
// - **Its messaging keys are random,** not derived from a mnemonic. They come from a 32-byte board
//   seed, and the seed is the **invite**. Whoever holds the invite can decrypt the board's inbox,
//   so whoever holds the invite can read the board. Anyone can post: posting only needs the public
//   keys, which the node serves.
// - **The invite lives in the URL fragment** (`/try#board=…`), which browsers never send to a
//   server. Nothing in this module puts the seed or a secret key into a request, and
//   `scripts/try_board_guard.mjs` checks that.
// - **The board's signing identity is separate.** A board wallet has its own 12 words, used once to
//   register the board's keys. They are not in the invite, so an invite holder can read but cannot
//   re-register (replace) the board's keys.
//
// Posts are labelled by what the node and the envelope actually say, never by what the poster
// chose: an anonymous post is VERIFIED only when the node verified its membership proof, and a
// named post always says so and shows the sender.
//
// Plain ESM with injected I/O, so the guard and the local e2e run the same code as the page.

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { Kyber768 } from "crystals-kyber-js";

import { tmailBucketIndex, TMAIL_BUCKET_MS } from "./anon_tree.mjs";

/** Invite format version prefix. */
export const BOARD_INVITE_PREFIX = "tetboard1";
/** The longest board name an invite carries (display only, not authenticated). */
export const BOARD_NAME_MAX = 40;

const X25519_INFO = new TextEncoder().encode("tet-board-x25519-v1");
const MLKEM_INFO = new TextEncoder().encode("tet-board-mlkem-v1");

/** Where the docs explain the native prover (anonymous posting needs it). */
export const PROVER_DOCS_URL =
  "https://github.com/TET-Network-Foundation/TET-OS/blob/main/docs/RUNNING_A_NODE.md#anonymous-sending";

/** The label on a post sent with the poster's own wallet. */
export const NAMED_LABEL = "NAMED — NOT ANONYMOUS";

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invite: not base64url");
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64std(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** 32 random bytes from the platform CSPRNG: a new board's seed, i.e. its invite secret. */
export function newBoardSeed() {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  return seed;
}

/**
 * The board's X25519 + Kyber-768 keypairs from its seed. Distinct HKDF labels from the wallet
 * derivation (`tet-tmail-*-v1`), so a board seed and a wallet mnemonic never share keys.
 *
 * @param {Uint8Array} seed 32 bytes
 */
export async function boardKeysFromSeed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error("board seed must be 32 bytes");
  const x25519_sk = hkdf(sha256, seed, undefined, X25519_INFO, 32);
  const x25519_pub = x25519.getPublicKey(x25519_sk);
  const [mlkem_pub, mlkem_sk] = await new Kyber768().deriveKeyPair(hkdf(sha256, seed, undefined, MLKEM_INFO, 64));
  return { x25519_sk, x25519_pub, mlkem_sk, mlkem_pub };
}

/** The board's public keys as `PUT /tmail/keys` carries them (standard base64). */
export function boardPublicKeysB64(keys) {
  return { x25519_pub_b64: b64std(keys.x25519_pub), mlkem_pub_b64: b64std(keys.mlkem_pub) };
}

/**
 * `tetboard1.<board wallet id>.<seed>.<name>`: the whole invite, for the URL fragment.
 *
 * @param {{ boardWalletId: string, seed: Uint8Array, name?: string }} b
 */
export function encodeInvite(b) {
  const wid = String(b.boardWalletId).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(wid)) throw new Error("board wallet id must be 64 hex chars");
  if (!(b.seed instanceof Uint8Array) || b.seed.length !== 32) throw new Error("board seed must be 32 bytes");
  const name = (b.name ?? "").trim().slice(0, BOARD_NAME_MAX);
  return [BOARD_INVITE_PREFIX, wid, b64urlEncode(b.seed), b64urlEncode(new TextEncoder().encode(name))].join(".");
}

/**
 * Parse an invite: the bare `tetboard1.…` string, `#board=…`, or a whole URL that ends in one.
 * Throws on anything malformed; never returns a partial board.
 *
 * @param {string} text
 * @returns {{ boardWalletId: string, seed: Uint8Array, name: string }}
 */
export function parseInvite(text) {
  let s = String(text ?? "").trim();
  const at = s.indexOf("#board=");
  if (at >= 0) s = s.slice(at + "#board=".length);
  else if (s.startsWith("board=")) s = s.slice("board=".length);
  s = s.split("&")[0];
  const parts = s.split(".");
  if (parts.length !== 4 || parts[0] !== BOARD_INVITE_PREFIX) throw new Error("not a TET board invite");
  const wid = parts[1].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(wid)) throw new Error("invite: bad board wallet id");
  const seed = b64urlDecode(parts[2]);
  if (seed.length !== 32) throw new Error("invite: bad board seed");
  let name;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(b64urlDecode(parts[3])).slice(0, BOARD_NAME_MAX);
  } catch {
    throw new Error("invite: bad board name");
  }
  return { boardWalletId: wid, seed, name };
}

/** The shareable link. The invite is after `#`, so it never reaches any server. */
export function inviteUrl(origin, invite) {
  return `${String(origin).replace(/\/+$/, "")}/try#board=${invite}`;
}

/**
 * Do the keys this invite derives equal the keys the node has registered for the board? If not,
 * the invite is for another board (or was altered), and posts would be unreadable to its holders.
 *
 * @param {{ x25519_pub: Uint8Array, mlkem_pub: Uint8Array }} keys
 * @param {{ x25519_pub_b64?: string, mlkem_pub_b64?: string } | null | undefined} registration
 */
export function inviteMatchesRegistration(keys, registration) {
  if (!registration) return false;
  const mine = boardPublicKeysB64(keys);
  return (
    String(registration.x25519_pub_b64 ?? "").trim() === mine.x25519_pub_b64 &&
    String(registration.mlkem_pub_b64 ?? "").trim() === mine.mlkem_pub_b64
  );
}

/**
 * How a post is labelled in the feed. Decided by the envelope's signed flags and the node's
 * verdict only:
 *
 * - named (flags.anonymous false): {@link NAMED_LABEL}, with the sender's wallet id;
 * - anonymous: VERIFIED only on the node's `verified` verdict; `failed` says so; anything else,
 *   including no verdict at all, is PENDING.
 *
 * @param {{ flags?: { anonymous?: boolean }, sender_wallet_id?: string, anon_verdict?: any }} row
 * @returns {{ kind: "named" | "anonymous", text: string, tone: "named" | "ok" | "pending" | "bad", author: string | null, detail: string }}
 */
export function postLabel(row) {
  if (row?.flags?.anonymous !== true) {
    const sender = String(row?.sender_wallet_id ?? "");
    return {
      kind: "named",
      text: NAMED_LABEL,
      tone: "named",
      author: sender,
      detail: "Sent with the poster's own wallet, which is shown.",
    };
  }
  const v = row.anon_verdict;
  if (v?.state === "verified") {
    return { kind: "anonymous", text: "ANONYMOUS — VERIFIED", tone: "ok", author: null, detail: "Membership proof checked by this node." };
  }
  if (v?.state === "failed") {
    return { kind: "anonymous", text: "ANONYMOUS — PROOF FAILED", tone: "bad", author: null, detail: String(v.reason ?? "") };
  }
  return {
    kind: "anonymous",
    text: "ANONYMOUS — PROOF PENDING",
    tone: "pending",
    author: null,
    detail: "The membership proof has not been verified yet.",
  };
}

/**
 * What a post does, given what the poster chose and whether a prover answered.
 *
 * **Anonymous never falls back to named.** If the poster chose anonymous and there is no prover,
 * the answer is a refusal that points at the docs; posting named is a separate, explicit choice.
 *
 * @param {{ mode: "anonymous" | "named", prover: "found" | "missing" | "unknown", hasWallet: boolean }} o
 * @returns {{ action: "anonymous" } | { action: "named" } | { action: "refuse", reason: string }}
 */
export function boardPostPlan(o) {
  if (!o.hasWallet) return { action: "refuse", reason: "Create a disposable wallet first." };
  if (o.mode === "named") return { action: "named" };
  if (o.mode === "anonymous") {
    if (o.prover === "found") return { action: "anonymous" };
    return {
      action: "refuse",
      reason: "Anonymous posting needs the native prover on your own computer. Nothing was sent.",
    };
  }
  return { action: "refuse", reason: "Choose anonymous or named." };
}

/**
 * The anonymous allowance: one post per member per board per UTC day (the node refuses a second
 * nullifier for the same day). Computed from the clock and what this tab already posted.
 *
 * @param {{ nowMs: number, postedBuckets: Set<number> | number[] }} o
 */
export function anonAllowance(o) {
  const bucket = tmailBucketIndex(o.nowMs);
  const used = new Set(o.postedBuckets).has(bucket);
  const resetsAtMs = (bucket + 1) * TMAIL_BUCKET_MS;
  return { bucket, remaining: used ? 0 : 1, resetsAtMs };
}

/**
 * Is there a native prover on this computer? Asks its `/health` only: nothing secret is sent. A
 * prover built without its guest still answers here and refuses `POST /prove_anon` with 503; the
 * post then ends in a refusal, never a silent fallback.
 *
 * @param {{ url: string, fetchImpl?: typeof fetch, timeoutMs?: number }} o
 * @returns {Promise<"found" | "missing">}
 */
export async function probeProver(o) {
  const fetchImpl = o.fetchImpl ?? globalThis.fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), o.timeoutMs ?? 1500);
  try {
    const r = await fetchImpl(`${o.url.replace(/\/+$/, "")}/health`, { signal: ctl.signal });
    if (!r.ok) return "missing";
    const j = await r.json().catch(() => null);
    return j?.ok === true ? "found" : "missing";
  } catch {
    return "missing";
  } finally {
    clearTimeout(t);
  }
}
