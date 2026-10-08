/**
 * Sealed predictions: commit now, reveal later, on the proof-code mechanism (lib/proof_code.ts).
 *
 * - **Sealing** builds the sealed bytes — `{"v":1,"kind":"tet_seal_v1","text":…,"opens":"YYYY-MM-DD",
 *   "salt":<16 random bytes, hex>}` — and marks their fingerprint exactly as a file is marked, so the
 *   registry holds the hash and a proof code, never the text. The salt stops anyone guessing a short
 *   prediction from its hash.
 * - **The card and its share link** carry only the code, the opening date and the chain height at
 *   sealing: never the text, never the salt.
 * - **The reveal link** carries the sealed bytes (base64url) after `#reveal=`. Opening it hashes them,
 *   finds the record by fingerprint and shows "written at <time>, unchanged" — or red if they don't
 *   match. Anyone holding that link can reveal: sharing it is publishing.
 * - **Proves:** this exact text existed when this node recorded it, unchanged since. **Doesn't
 *   prove:** that the prediction was right, or that the author didn't seal many different
 *   predictions (and reveal only the one that came true).
 */
import { sha256 } from "@noble/hashes/sha2";

export const SEAL_KIND = "tet_seal_v1";
export const SEAL_MIN_DAYS = 1;
export const SEAL_MAX_DAYS = 30;

export type Sealed = { v: 1; kind: typeof SEAL_KIND; text: string; opens: string; salt: string };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64url = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** A UTC date `days` after `nowMs`, as YYYY-MM-DD. */
export function opensOn(nowMs: number, days: number): string {
  return new Date(nowMs + days * 86_400_000).toISOString().slice(0, 10);
}

/** The exact bytes that get sealed (and later revealed). Field order is fixed. */
export function sealBytes(text: string, opens: string, salt: Uint8Array): Uint8Array {
  if (salt.length !== 16) throw new Error("the salt is 16 bytes");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opens)) throw new Error("opens is YYYY-MM-DD");
  const s: Sealed = { v: 1, kind: SEAL_KIND, text, opens, salt: hex(salt) };
  return new TextEncoder().encode(JSON.stringify(s));
}

/** New sealed bytes with a fresh random salt. */
export function newSeal(text: string, opens: string): Uint8Array {
  return sealBytes(text, opens, crypto.getRandomValues(new Uint8Array(16)));
}

/** The fingerprint the registry records (SHA-256 of the sealed bytes). */
export function sealFingerprint(bytes: Uint8Array): string {
  return hex(sha256(bytes));
}

/** The reveal link's fragment: `reveal=<sealed bytes, base64url>`. */
export function revealFragment(bytes: Uint8Array): string {
  return `reveal=${b64url(bytes)}`;
}

/** Sealed bytes from a reveal fragment, parsed; null if it isn't one. */
export function parseReveal(fragment: string): { bytes: Uint8Array; sealed: Sealed } | null {
  const m = /(?:^|[#&])reveal=([A-Za-z0-9_-]+)/.exec(fragment);
  if (!m) return null;
  try {
    const bytes = fromB64url(m[1]);
    const s = JSON.parse(new TextDecoder().decode(bytes)) as Sealed;
    if (s?.v !== 1 || s.kind !== SEAL_KIND || typeof s.text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.opens) || !/^[0-9a-f]{32}$/.test(s.salt)) return null;
    return { bytes, sealed: s };
  } catch {
    return null;
  }
}

/** The card's public text: code, opening date, chain height at sealing. Never the text or salt. */
export function cardLines(o: { code: string; opens: string; height: number | null }): string[] {
  return [`sealed · ${o.height !== null ? `block #${o.height}` : "block —"} · opens ${o.opens}`, o.code];
}

/** Has the opening date arrived (UTC)? */
export function isOpen(opens: string, nowMs: number): boolean {
  return new Date(nowMs).toISOString().slice(0, 10) >= opens;
}
