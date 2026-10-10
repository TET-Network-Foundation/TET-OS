/**
 * Shelter, the page's side (tet-core tmail/shelter.rs; docs/plans/SHELTER.md "Implementation v1").
 *
 * - Every read is signed by this tab's wallet for one route (`x-tet-shelter-auth`), so the node
 *   serves Shelter only to its members. The node sees who reads; it never sees the board key.
 * - Records (invite, vouch, leave, nickname, case, appeal) are hybrid-signed with tet-core's
 *   pre-image. `met_in_person` is the voucher's own statement.
 * - The board key travels sealed: the voucher's page encrypts the board invite to the new member's
 *   messaging keys and gives the node only that ciphertext (`/shelter/key`); the member's page opens
 *   it after `/shelter/me`. Nothing is stored on the device.
 */
import { sha256 } from "@noble/hashes/sha2";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { toHex } from "./anon_tree.mjs";
import { expectedChainBinding } from "./chain_binding";
import { b64ToBytes } from "./encoding";
import { getHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { getTmailKeys } from "./tet_core_http";
import { buildTmailEnvelopeV1, type TmailEnvelopeV1 } from "./tmail";
import { decryptForReceiver } from "./tmail_e2ee";
import { getTmailKeySession } from "./tmail_session";
import { openBoard, type OpenBoard } from "./try_board";

export type ShelterAction = "invite" | "vouch" | "withdraw" | "nickname" | "case" | "appeal";

export type ShelterMe =
  | { member: false }
  | {
      member: true;
      moderator: boolean;
      board: string;
      nickname: string | null;
      via: string | null;
      joined_at_ms: number;
      vouches_left: number;
      suspended_until: number | null;
      anon_set_size: number;
      anon_min: number;
      in_anon_set: boolean;
      sealed_key: TmailEnvelopeV1 | null;
    };

export type ShelterMember = { wallet: string; number: number; nickname: string | null; via: string | null; joined_at_ms: number; moderator: boolean };
export type ShelterCase = {
  id: string;
  subject: string;
  voucher: string | null;
  at_ms: number;
  reason: string;
  appeal: "overturn" | "keep" | null;
  appeal_at_ms: number | null;
};
export type ShelterLogLine = { id: string; action: ShelterAction; by: string; subject: string; met_in_person: boolean; text: string; decision: string; at_ms: number };

/** The sealed key's plaintext: this marker and the board invite. */
const SEALED_KIND = "tet-shelter-key-v1";

/** Days: an appeal is decided within 14 of its case (tet-core SHELTER_APPEAL_MS). */
export const APPEAL_DAYS = 14;

const enc = (s: string) => new TextEncoder().encode(s);

function signer() {
  const s = getHybridSignerSession();
  if (!s) throw new Error("No ID in this tab yet.");
  return s;
}

async function hybridSign(msg: Uint8Array): Promise<{ ed: string; pq: string; pk: string; wallet: string }> {
  const s = signer();
  return {
    ed: u8ToStdBase64(await Promise.resolve(s.signEd25519(msg))),
    pq: await mldsa44SignDeterministic(s.mldsa44_keypair_b64, msg),
    pk: s.mldsa44_pubkey_b64.trim(),
    wallet: s.walletIdHex64,
  };
}

/** `x-tet-shelter-auth` for one read of `path` (the node's path, e.g. `/shelter/inbox`). */
export async function readAuth(baseUrl: string, path: string, atMs = Date.now()): Promise<string> {
  const s = signer();
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const msg = enc(
    `tet shelter read v1|chain_id=${chainId}|genesis_hash=${genesisHash}|wallet=${s.walletIdHex64}|path=${path}|at_ms=${atMs}|mldsa_pk=${s.mldsa44_pubkey_b64.trim()}`,
  );
  const sig = await hybridSign(msg);
  return `${sig.wallet}.${atMs}.${sig.ed}.${sig.pk}.${sig.pq}`;
}

async function signedGet<T>(baseUrl: string, sub: string, query = ""): Promise<{ status: number; data: T | null; error: string }> {
  const path = `/shelter/${sub}`;
  const r = await fetch(`${baseUrl}${path}${query}`, { headers: { "x-tet-shelter-auth": await readAuth(baseUrl, path) }, cache: "no-store" });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: r.ok ? (j as T) : null, error: r.ok ? "" : String(j?.error ?? `HTTP ${r.status}`) };
}

export async function shelterOpen(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/shelter/status`, { cache: "no-store" });
    return r.ok && (await r.json())?.on === true;
  } catch {
    return false;
  }
}

export async function shelterMe(baseUrl: string): Promise<ShelterMe> {
  const r = await signedGet<ShelterMe>(baseUrl, "me");
  if (!r.data) throw new Error(r.error);
  return r.data;
}

export async function shelterMembers(baseUrl: string): Promise<ShelterMember[]> {
  const r = await signedGet<{ members: ShelterMember[] }>(baseUrl, "members");
  if (!r.data) throw new Error(r.error);
  return r.data.members;
}

export async function shelterLog(baseUrl: string): Promise<{ log: ShelterLogLine[]; cases: ShelterCase[] }> {
  const r = await signedGet<{ log: ShelterLogLine[]; cases: ShelterCase[] }>(baseUrl, "log");
  if (!r.data) throw new Error(r.error);
  return r.data;
}

/** Shelter's board rows (members only), in `/tmail/inbox`'s shape. */
export async function shelterInboxRows(baseUrl: string, limit = 100) {
  const r = await signedGet<{ messages: unknown[] }>(baseUrl, "inbox", `?limit=${limit}`);
  return { ok: !!r.data, status: r.status, messages: (r.data?.messages ?? []) as never[], count: r.data?.messages?.length ?? 0, lockedCount: 0, text: r.error };
}

/** Shelter's own anonymous set (members only): the tree an anonymous post proves membership of. */
export async function shelterAnonTree(baseUrl: string): Promise<{ leaves: Uint8Array[]; rootHex: string } | null> {
  const r = await signedGet<{ leaves: string[]; root: string | null }>(baseUrl, "anon/leaves");
  if (!r.data?.root) return null;
  return { leaves: r.data.leaves.map((h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16))), rootHex: r.data.root };
}

/** Sign and submit a record. Returns its id (a case's id is what an appeal names). */
export async function submitRecord(
  baseUrl: string,
  o: { action: ShelterAction; subject: string; metInPerson?: boolean; text?: string; decision?: "" | "overturn" | "keep" },
): Promise<string> {
  const s = signer();
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const rec = {
    v: 1,
    kind: "tet_shelter_record_v1",
    action: o.action,
    signer: s.walletIdHex64,
    subject: o.subject.trim().toLowerCase(),
    met_in_person: o.metInPerson === true,
    text: o.text ?? "",
    decision: o.decision ?? "",
    at_ms: Date.now(),
  };
  const msg = enc(
    `tet shelter record v1|chain_id=${chainId}|genesis_hash=${genesisHash}|action=${rec.action}|signer=${rec.signer}|subject=${rec.subject}|met_in_person=${rec.met_in_person}|text_sha256=${toHex(sha256(enc(rec.text)))}|decision=${rec.decision}|at_ms=${rec.at_ms}|mldsa_pk=${s.mldsa44_pubkey_b64.trim()}`,
  );
  const sig = await hybridSign(msg);
  const body = { ...rec, hybrid_sig: { ed25519_pubkey_hex: sig.wallet, ed25519_sig_b64: sig.ed, mldsa_pubkey_b64: sig.pk, mldsa_sig_b64: sig.pq } };
  const r = await fetch(`${baseUrl}/shelter/record`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String(j?.error ?? `HTTP ${r.status}`));
  return String(j?.id ?? "");
}

/**
 * Seal the board's invite to `member` (their published messaging keys) and hand it to the node.
 * The node keeps ciphertext it can't open; only `member` gets it back.
 */
export async function sealKeyTo(baseUrl: string, member: string, board: OpenBoard): Promise<void> {
  const s = signer();
  const k = await getTmailKeys(baseUrl, member);
  if (!k.registration) throw new Error("They haven't published their messaging keys yet: ask them to open Shelter on their phone first.");
  const env = await buildTmailEnvelopeV1({
    senderWalletId: s.walletIdHex64,
    receiverWalletId: member,
    plaintextUtf8: JSON.stringify({ kind: SEALED_KIND, invite: board.invite }),
    receiverX25519Pub: b64ToBytes(k.registration.x25519_pub_b64),
    receiverMlkemPub: b64ToBytes(k.registration.mlkem_pub_b64),
    baseUrl,
  });
  const r = await fetch(`${baseUrl}/shelter/key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(env) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String(j?.error ?? `HTTP ${r.status}`));
}

/** Open this member's sealed key: the board, checked against the board the node names. */
export async function openSealedKey(baseUrl: string, sealed: TmailEnvelopeV1, boardWalletId: string): Promise<OpenBoard> {
  const ks = getTmailKeySession();
  if (!ks) throw new Error("No ID in this tab yet.");
  const e = sealed.e2ee;
  const pt = await decryptForReceiver(
    {
      client_ephemeral_pub: b64ToBytes(e.client_ephemeral_pub_b64),
      mlkem_ciphertext: b64ToBytes(e.mlkem_ciphertext_b64),
      nonce: b64ToBytes(e.nonce_b64),
      ciphertext: b64ToBytes(e.ciphertext_b64),
    },
    ks.x25519_sk,
    ks.mlkem_sk,
  );
  const j = JSON.parse(new TextDecoder().decode(pt));
  if (j?.kind !== SEALED_KIND || typeof j.invite !== "string") throw new Error("That isn't a Shelter key.");
  const board = await openBoard(baseUrl, j.invite);
  if (board.boardWalletId !== boardWalletId) throw new Error("That key is for another board.");
  return board;
}

/** The join code a member scans: this wallet's id. */
export const JOIN_PREFIX = "tet-shelter-join:";
export function joinCode(walletId: string): string {
  return `${JOIN_PREFIX}${walletId}`;
}
/** A scanned or typed join code (or a bare wallet id, spaces and dashes allowed) → wallet id. */
export function parseJoinCode(text: string): string | null {
  const t = text.trim().toLowerCase().replace(JOIN_PREFIX, "").replace(/[\s-]/g, "");
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}
/** The wallet id in groups of 4, for reading out or typing. */
export function groupedId(walletId: string): string {
  return (walletId.match(/.{1,4}/g) ?? []).join(" ");
}

/**
 * How a member is shown: nickname and member number ("Hana · 7"). The number comes from the order
 * members were let in (tet-core ShelterMember::number), so nobody can choose or copy it; a
 * look-alike nickname still shows a different number. Someone no longer a member: the start of
 * their ID.
 */
export function memberLabel(m: { number: number; nickname: string | null } | undefined, wallet: string): string {
  if (!m) return `${wallet.slice(0, 8)}…`;
  return m.nickname ? `${m.nickname} · ${m.number}` : `#${m.number}`;
}
