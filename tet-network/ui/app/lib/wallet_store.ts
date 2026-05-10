/**
 * @deprecated Legacy format: **mnemonic was stored in plaintext** alongside PIN hash.
 * New accounts use `tet_wallet_keystore` (AES-GCM) in `inapp_wallet.ts`. Remaining records
 * are migrated to the keystore on unlock.
 */
export type WalletStoreV0 = {
  v: 0;
  mnemonic12: string;
  pin_sha256_hex: string;
  created_at_ms: number;
  is_founder?: boolean;
};

const KEY = "tet.wallet.v0";
const FOUNDER_KEY = "tet.founder.v0";
const PIN_RE_8 = /^\d{8}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const dig = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(dig));
}

export function isValidPin8(pin: string): boolean {
  return PIN_RE_8.test((pin ?? "").trim());
}

export function loadWalletStore(): WalletStoreV0 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<WalletStoreV0> | null;
    if (!j || j.v !== 0) return null;
    if (typeof j.mnemonic12 !== "string") return null;
    if (typeof j.pin_sha256_hex !== "string") return null;
    if (typeof j.created_at_ms !== "number") return null;
    if (typeof j.is_founder !== "undefined" && typeof j.is_founder !== "boolean") return null;
    return j as WalletStoreV0;
  } catch {
    return null;
  }
}

export function saveWalletStore(v: WalletStoreV0) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(v));
}

export function clearWalletStore() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function hasFounderMarker(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FOUNDER_KEY) === "1";
}

export function setFounderMarker() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FOUNDER_KEY, "1");
}

