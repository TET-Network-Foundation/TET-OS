/**
 * What Try TET may remember on this device (decision 2026-10-08). The only module that touches
 * browser storage for /try; `try_wallet_guard` keeps forbidding storage everywhere else in /try, and
 * `scripts/try_storage_guard.mjs` checks this module.
 *
 * 1. **Plain UI state** (localStorage), only the keys in `UI_KEYS`: non-secret things like the last
 *    public board, drafts, the language, and whether this device has been here before. Never a key,
 *    never anything derived from one, never an invite-only board's invite (that invite is its key).
 * 2. **The 12 words, opt-in only, encrypted with the user's passphrase** (WebCrypto): AES-256-GCM
 *    under a key from PBKDF2-SHA-256, at least `KDF_ITERATIONS_MIN` iterations, a fresh random salt
 *    and IV per save. Only ciphertext is stored; a wrong passphrase opens nothing; parameters below
 *    the floor are refused on save and on open. "Forget this device" removes it.
 *
 * Every read and write is wrapped: storage can be missing or throw (private windows, blocked site
 * data), and the page works without it.
 */

export const UI_KEYS = ["tet.ui.v1.lastBoard", "tet.ui.v1.drafts", "tet.ui.v1.lang", "tet.ui.v1.visited"] as const;
export type UiKey = (typeof UI_KEYS)[number];
export const VAULT_KEY = "tet.vault.v1";
export const KDF_ITERATIONS = 600_000;
export const KDF_ITERATIONS_MIN = 600_000;

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ── 1. Plain UI state ─────────────────────────────────────────────────────────────────────────────
export function setUi(key: UiKey, value: string | null): void {
  if (!(UI_KEYS as readonly string[]).includes(key)) throw new Error(`not a UI key: ${key}`);
  const s = store();
  try {
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch {
    /* storage unavailable: forget it */
  }
}

export function getUi(key: UiKey): string | null {
  if (!(UI_KEYS as readonly string[]).includes(key)) throw new Error(`not a UI key: ${key}`);
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

// ── 2. The key, encrypted ─────────────────────────────────────────────────────────────────────────
export type VaultRecord = { v: 1; kdf: "PBKDF2-SHA-256"; iterations: number; salt: string; iv: string; ct: string };

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!(iterations >= KDF_ITERATIONS_MIN)) throw new Error("the stored key uses too few KDF iterations");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Encrypt the words with the passphrase and remember them on this device. */
export async function rememberKey(words: string, passphrase: string, iterations = KDF_ITERATIONS): Promise<void> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  if (iterations < KDF_ITERATIONS_MIN) throw new Error("too few KDF iterations");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(words) as BufferSource));
  const rec: VaultRecord = { v: 1, kdf: "PBKDF2-SHA-256", iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  const s = store();
  if (!s) throw new Error("This browser won't let the page remember anything.");
  s.setItem(VAULT_KEY, JSON.stringify(rec));
}

export function hasRememberedKey(): boolean {
  try {
    return !!store()?.getItem(VAULT_KEY);
  } catch {
    return false;
  }
}

/** The remembered words, or an error: wrong passphrase, tampered or weakened record. */
export async function openRememberedKey(passphrase: string): Promise<string> {
  let rec: VaultRecord;
  try {
    rec = JSON.parse(store()?.getItem(VAULT_KEY) ?? "");
  } catch {
    throw new Error("Nothing is remembered on this device.");
  }
  if (rec?.v !== 1 || rec.kdf !== "PBKDF2-SHA-256") throw new Error("Unknown record format.");
  const key = await deriveKey(passphrase, unb64(rec.salt), rec.iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) as BufferSource }, key, unb64(rec.ct) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("Wrong passphrase.");
  }
}

/** "Forget this device": the key and every UI key. */
export function forgetDevice(): void {
  const s = store();
  try {
    s?.removeItem(VAULT_KEY);
    for (const k of UI_KEYS) s?.removeItem(k);
  } catch {
    /* nothing to forget */
  }
}
