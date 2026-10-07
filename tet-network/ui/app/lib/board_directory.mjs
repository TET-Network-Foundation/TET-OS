// Try TET: public boards and the directory. No node change and no consensus change.
//
// Two kinds of board:
// - **invite** (as before): only people with the invite link can read it.
// - **public**: its invite is published in the directory, so anyone can read it.
//
// The **directory** is an ordinary board whose invite is itself published (the node's
// `NEXT_PUBLIC_TET_DIRECTORY_INVITE`), so anyone can read it. A board is listed by a **signed
// announcement**: a named Tmail to the directory whose plaintext is
//
//     {"kind":"tet_board_announce_v1","invite":"tetboard1…","announced_at_ms":…}
//
// and which is **signed by the listed board's own wallet** (the node checks a named post's hybrid
// signature against its sender). A listing counts only when the sender is the board wallet the
// invite names, so:
// - only whoever holds a board's 12 words (its creator) can list it;
// - nobody can list someone else's invite-only board, even with its invite;
// - anonymous posts and posts by any other wallet are ignored, whatever they contain.
//
// Limits that follow from the node (the directory notice says them): the node keeps each sender's
// newest 5 posts for 7 days, so a listing lasts 7 days from its newest announcement unless the
// creator announces again; the page reads the directory's newest 200 posts.
//
// Plain ESM, no I/O, so the guard runs the page's own code (scripts/try_directory_guard.mjs).

import { parseInvite, BOARD_NAME_MAX } from "./board.mjs";

export const ANNOUNCE_KIND = "tet_board_announce_v1";
/** How long a listing lasts without a new announcement (the node's Tmail TTL). */
export const LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The plaintext of an announcement for `invite`. */
export function encodeAnnouncement(invite, nowMs) {
  const inv = parseInvite(invite);
  if (!inv.name) throw new Error("A public board needs a name.");
  return JSON.stringify({ kind: ANNOUNCE_KIND, invite: String(invite).trim(), announced_at_ms: Math.floor(nowMs) });
}

/**
 * The listings a directory's posts support. `posts`: `{ msgId, sentAtMs, sender, named, text }`,
 * where `sender` is the node's sender wallet id and `named` is false for anonymous posts. Returns
 * one listing per board, the newest valid announcement winning: `{ boardWalletId, name, invite,
 * listedAtMs }`, newest first.
 */
export function parseListings(posts) {
  const best = new Map();
  for (const p of posts) {
    if (!p.named || typeof p.text !== "string") continue;
    let j;
    try {
      j = JSON.parse(p.text);
    } catch {
      continue;
    }
    if (!j || j.kind !== ANNOUNCE_KIND || typeof j.invite !== "string") continue;
    let inv;
    try {
      inv = parseInvite(j.invite);
    } catch {
      continue;
    }
    // Signed by the board's own wallet, or it doesn't list anything.
    if (String(p.sender).toLowerCase() !== inv.boardWalletId) continue;
    const name = String(inv.name ?? "").trim();
    if (!name || /[\r\n]/.test(name) || [...name].length > BOARD_NAME_MAX) continue;
    const prev = best.get(inv.boardWalletId);
    if (!prev || p.sentAtMs > prev.listedAtMs) {
      best.set(inv.boardWalletId, { boardWalletId: inv.boardWalletId, name, invite: j.invite.trim(), listedAtMs: p.sentAtMs });
    }
  }
  return [...best.values()].sort((a, b) => b.listedAtMs - a.listedAtMs);
}

/** Listings whose name contains `query` (case- and width-insensitive). */
export function searchListings(listings, query) {
  const fold = (s) => String(s).normalize("NFKC").toLowerCase();
  const q = fold(query).trim();
  return q ? listings.filter((l) => fold(l.name).includes(q)) : listings;
}
